import { q } from "./_lib/db.js";

/**
 * Scheduled retention purge for async_jobs.
 *
 * Defaults:
 * - succeeded/failed: 7 days
 * - queued/running: 30 days (safety cleanup for stuck jobs)
 *
 * Configure:
 * - ASYNC_JOB_SUCCESS_RETENTION_DAYS (default 7)
 * - ASYNC_JOB_RETENTION_DAYS (default 30)
 */
export const config = {
  schedule: "@daily"
};

function intEnv(name, fallback) {
  const raw = (process.env[name] || "").toString().trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export default async () => {
  const successDays = intEnv("ASYNC_JOB_SUCCESS_RETENTION_DAYS", 7);
  const otherDays = intEnv("ASYNC_JOB_RETENTION_DAYS", 30);

  // Purge completed jobs after successDays.
  await q(
    `delete from async_jobs
     where status in ('succeeded','failed')
       and completed_at is not null
       and completed_at < (now() - ($1 * interval '1 day'))`,
    [successDays]
  );

  // Purge stuck queued/running after otherDays.
  await q(
    `delete from async_jobs
     where status in ('queued','running')
       and created_at < (now() - ($1 * interval '1 day'))`,
    [otherDays]
  );

  return new Response(
    JSON.stringify({ ok: true, purged: true, success_retention_days: successDays, other_retention_days: otherDays }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};
