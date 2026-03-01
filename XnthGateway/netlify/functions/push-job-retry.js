import { q } from "./_lib/db.js";
import { buildCors, json, badRequest } from "./_lib/http.js";

/**
 * Scheduled retry runner for KaixuPush chunk upload jobs.
 *
 * - Runs on a cron schedule (see netlify.toml).
 * - Requeues jobs in status retry_wait/error_transient whose next_attempt_at is due.
 * - Invokes push-uploadfile-background with JOB_WORKER_SECRET only (no Bearer required).
 */
export default async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const secret = process.env.JOB_WORKER_SECRET;
  if (!secret) {
    // Not fatal; just log and exit OK so the schedule doesn't keep retrying noisily.
    try {
      await q(
        `insert into gateway_events(level, function_name, message, meta)
         values ('warn',$1,$2,'{}'::jsonb)`,
        ["push-job-retry", "JOB_WORKER_SECRET not set; retry scheduler idle"]
      );
    } catch {}
    return json(200, { ok: true, skipped: true, reason: "JOB_WORKER_SECRET missing" }, cors);
  }

  // Allow manual trigger with ?limit=... but keep bounded.
  const url = new URL(req.url);
  const limit = Math.min(25, Math.max(1, parseInt(url.searchParams.get("limit") || "15", 10) || 15));

  // Find due jobs
  const jobs = await q(
    `select j.id as job_id, j.sha1, p.push_id
     from push_jobs j
     join push_pushes p on p.id = j.push_row_id
     where j.status in ('retry_wait','error_transient')
       and (j.next_attempt_at is null or j.next_attempt_at <= now())
     order by coalesce(j.next_attempt_at, j.updated_at) asc
     limit $1`,
    [limit]
  );

  const origin = process.env.URL || new URL(req.url).origin;

  let triggered = 0;
  let claimed = 0;

  for (const row of jobs.rows || []) {
    // Claim the job to prevent duplicate triggers if schedules overlap.
    const claim = await q(
      `update push_jobs
       set status='queued', updated_at=now()
       where id=$1 and status in ('retry_wait','error_transient')
       returning id`,
      [row.job_id]
    );
    if (!claim.rowCount) continue;
    claimed++;

    try {
      await fetch(`${origin}/.netlify/functions/push-uploadfile-background`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kaixu-job-secret": secret
        },
        body: JSON.stringify({ pushId: row.push_id, sha1: row.sha1 })
      });
      triggered++;
    } catch (e) {
      // Put it back into retry_wait quickly if trigger failed.
      await q(
        `update push_jobs
         set status='retry_wait',
             error=$2,
             last_error=$2,
             last_error_at=now(),
             next_attempt_at=now() + interval '30 seconds',
             updated_at=now()
         where id=$1`,
        [row.job_id, `retry trigger failed: ${(e?.message || String(e)).slice(0, 400)}`]
      );
    }
  }

  return json(200, { ok: true, scanned: jobs.rowCount || 0, claimed, triggered }, cors);
};
