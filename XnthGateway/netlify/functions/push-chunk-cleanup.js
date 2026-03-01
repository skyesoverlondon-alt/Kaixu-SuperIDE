import { getStore } from "@netlify/blobs";
import { q } from "./_lib/db.js";
import { buildCors, json } from "./_lib/http.js";
import { wrap } from "./_lib/wrap.js";

function chunkStore() {
  return getStore({ name: "kaixu_push_chunks", consistency: "strong" });
}

function hoursInt(v, dflt) {
  const n = parseInt(String(v || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/**
 * Scheduled cleanup for stale KaixuPush chunk blobs.
 * Netlify Scheduled Functions run via netlify.toml schedule.
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  // Allow GET (scheduled) and POST (manual) only.
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const retentionHrs = hoursInt(process.env.PUSH_CHUNK_RETENTION_HOURS, 48);
  const cutoff = new Date(Date.now() - retentionHrs * 3600 * 1000).toISOString();

  const store = chunkStore();
  let deleted_chunks = 0;
  let expired_jobs = 0;
  let jobs_examined = 0;

  // Process multiple batches per run so we don't build up backlog.
  for (let batch = 0; batch < 5; batch++) {
    const res = await q(
      `select j.id as job_id, j.sha1, j.parts, p.push_id
       from push_jobs j
       join push_pushes p on p.id = j.push_row_id
       where j.status in ('uploading','queued','assembling','error','blocked_cap')
         and j.updated_at < $1
       order by j.updated_at asc
       limit 200`,
      [cutoff]
    );

    jobs_examined += res.rowCount || 0;
    if (!res.rowCount) break;

    for (const row of res.rows || []) {
      const parts = Math.max(0, parseInt(row.parts || "0", 10));
      const pushId = row.push_id;
      const sha1 = row.sha1;

      try {
        for (let i = 0; i < parts; i++) {
          await store.delete(`chunks/${pushId}/${sha1}/${i}`);
          deleted_chunks++;
        }
      } catch {
        // best effort; continue
      }

      await q(
        `update push_jobs
         set status='expired',
             error=$2,
             bytes_staged=0,
             part_bytes='{}'::jsonb,
             updated_at=now()
         where id=$1`,
        [row.job_id, `Expired after ${retentionHrs}h; chunks cleaned`]
      );
      expired_jobs++;
    }
  }

  return json(200, { ok: true, retention_hours: retentionHrs, cutoff, jobs_examined, expired_jobs, deleted_chunks }, cors);
});
