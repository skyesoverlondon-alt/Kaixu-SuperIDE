import { getStore } from "@netlify/blobs";
import { q } from "./_lib/db.js";
import { buildCors, json } from "./_lib/http.js";

/**
 * Scheduled cleanup for GitHub Push chunk blobs.
 *
 * Why it exists:
 * - GitHub Push jobs stage ZIP parts in Netlify Blobs.
 * - If a job is abandoned or repeatedly fails, those blobs would otherwise persist.
 *
 * Runs: @daily (netlify.toml)
 * Retention: GITHUB_CHUNK_RETENTION_HOURS (default 48)
 */
function store() {
  return getStore({ name: "kaixu_github_push_chunks", consistency: "strong" });
}

function hoursInt(v, dflt) {
  const n = parseInt(String(v || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

export default async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const retentionHrs = hoursInt(process.env.GITHUB_CHUNK_RETENTION_HOURS, 48);
  const cutoff = new Date(Date.now() - retentionHrs * 3600 * 1000).toISOString();

  const st = store();
  let jobs_examined = 0;
  let expired_jobs = 0;
  let deleted_chunks = 0;

  // Process in bounded batches so a single run can’t explode
  for (let batch = 0; batch < 5; batch++) {
    const res = await q(
      `select job_id, parts
       from gh_push_jobs
       where status in ('uploading','queued','assembling','retry_wait','error_transient')
         and updated_at < $1
       order by updated_at asc
       limit 200`,
      [cutoff]
    );

    jobs_examined += res.rowCount || 0;
    if (!res.rowCount) break;

    for (const row of res.rows) {
      const jobId = row.job_id;
      const parts = Math.max(0, parseInt(row.parts || "0", 10));

      try {
        for (let i = 0; i < parts; i++) {
          await st.delete(`ghzip/${jobId}/${i}`);
          deleted_chunks++;
        }
      } catch {
        // best-effort deletes; we still expire the job record
      }

      await q(
        `update gh_push_jobs
         set status='expired',
             last_error=$2,
             last_error_at=now(),
             bytes_staged=0,
             part_bytes='{}'::jsonb,
             received_parts='{}'::int[],
             updated_at=now()
         where job_id=$1`,
        [jobId, `Expired after ${retentionHrs}h; chunks cleaned`]
      );
      expired_jobs++;
    }
  }

  return json(
    200,
    { ok: true, retention_hours: retentionHrs, cutoff, jobs_examined, expired_jobs, deleted_chunks },
    cors
  );
};
