import { q } from "./_lib/db.js";
import { buildCors, json } from "./_lib/http.js";

/**
 * Scheduled retry runner for GitHub Push jobs.
 *
 * - Runs every 5 minutes (netlify.toml).
 * - Claims jobs in retry_wait whose next_attempt_at is due, then invokes gh-push-background using JOB_WORKER_SECRET.
 */
export default async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const secret = (process.env.JOB_WORKER_SECRET || "").trim();
  if (!secret) {
    try {
      await q(
        `insert into gateway_events(level, function_name, message, meta)
         values ('warn',$1,$2,'{}'::jsonb)`,
        ["gh-job-retry", "JOB_WORKER_SECRET not set; GitHub retry scheduler idle"]
      );
    } catch {}
    return json(200, { ok: true, skipped: true, reason: "JOB_WORKER_SECRET missing" }, cors);
  }

  const url = new URL(req.url);
  const limit = Math.min(25, Math.max(1, parseInt(url.searchParams.get("limit") || "15", 10) || 15));

  const jobs = await q(
    `select id, job_id
     from gh_push_jobs
     where status='retry_wait'
       and (next_attempt_at is null or next_attempt_at <= now())
     order by coalesce(next_attempt_at, updated_at) asc
     limit $1`,
    [limit]
  );

  const origin = process.env.URL || new URL(req.url).origin;

  let claimed = 0;
  let triggered = 0;

  for (const row of jobs.rows || []) {
    const claim = await q(
      `update gh_push_jobs
       set status='queued', updated_at=now()
       where id=$1 and status='retry_wait'
       returning id`,
      [row.id]
    );
    if (!claim.rowCount) continue;
    claimed++;

    try {
      await fetch(`${origin}/.netlify/functions/gh-push-background`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kaixu-job-secret": secret
        },
        body: JSON.stringify({ jobId: row.job_id })
      });
      triggered++;
    } catch (e) {
      await q(
        `update gh_push_jobs
         set status='retry_wait',
             last_error=$2,
             last_error_at=now(),
             next_attempt_at=now() + interval '30 seconds',
             updated_at=now()
         where id=$1`,
        [row.id, `retry trigger failed: ${(e?.message || String(e)).slice(0, 400)}`]
      );
    }
  }

  return json(200, { ok: true, scanned: jobs.rowCount || 0, claimed, triggered }, cors);
};
