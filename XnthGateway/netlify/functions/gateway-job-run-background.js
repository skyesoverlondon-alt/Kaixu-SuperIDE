import { q } from "./_lib/db.js";
import { callOpenAI, callAnthropic, callGemini } from "./_lib/providers.js";
import { costCents } from "./_lib/pricing.js";
import { getBearer, monthKeyUTC } from "./_lib/http.js";
import { resolveAuth, lookupKeyById, getMonthRollup, getKeyMonthRollup, customerCapCents, keyCapCents } from "./_lib/authz.js";
import { assertAllowed } from "./_lib/allowlist.js";
import { enforceDevice } from "./_lib/devices.js";

// NOTE: This is a Netlify Background Function.
// Naming rule: must include "-background" in filename (Netlify docs).
export default async (req) => {
  if (req.method !== "POST") return;

  const secret = (process.env.JOB_WORKER_SECRET || "").trim();
  const gotSecret = (req.headers.get("x-kaixu-job-secret") || req.headers.get("x-job-worker-secret") || "").trim();

  let body;
  try { body = await req.json(); } catch { return; }
  const id = (body?.id || "").toString().trim();
  if (!id) return;

  // Load job
  const jr = await q(`select * from async_jobs where id = $1`, [id]);
  if (!jr.rows.length) return;

  const job = jr.rows[0];
  if (job.status === "succeeded" || job.status === "failed") return;

  // --- Authorization for worker kick ---
  // If JOB_WORKER_SECRET is configured, require it.
  // Otherwise require Authorization: Bearer <key|user_session_jwt> matching the job's api_key_id.
  if (secret) {
    if (!gotSecret || gotSecret !== secret) return;
  } else {
    const token = getBearer(req);
    if (!token) return;
    const invoker = await resolveAuth(token);
    if (!invoker) return;
    if (String(invoker.api_key_id) !== String(job.api_key_id)) return;
    if (String(invoker.customer_id) !== String(job.customer_id)) return;
    if (!invoker.is_active) return;
  }

  // Load authoritative current key/customer state (revocations / plan changes)
  const keyRow = await lookupKeyById(job.api_key_id);
  if (!keyRow) {
    await q(
      `update async_jobs set status='failed', completed_at=now(), heartbeat_at=now(), error=$2 where id=$1`,
      [id, "Invalid or revoked key"]
    );
    return;
  }
  if (String(keyRow.customer_id) !== String(job.customer_id)) {
    await q(
      `update async_jobs set status='failed', completed_at=now(), heartbeat_at=now(), error=$2 where id=$1`,
      [id, "Job ownership mismatch"]
    );
    return;
  }
  if (!keyRow.is_active) {
    await q(
      `update async_jobs set status='failed', completed_at=now(), heartbeat_at=now(), error=$2 where id=$1`,
      [id, "Customer disabled"]
    );
    return;
  }

  // Mark running (best-effort)
  await q(
    `update async_jobs set status = 'running', started_at = coalesce(started_at, now()), heartbeat_at = now()
     where id = $1`,
    [id]
  );

  let request;
  try {
    request = typeof job.request === "string" ? JSON.parse(job.request) : job.request;
  } catch {
    request = job.request || {};
  }

  let meta = {};
  try {
    meta = typeof job.meta === "string" ? JSON.parse(job.meta) : (job.meta || {});
  } catch {
    meta = job.meta || {};
  }

  const telemetry = meta?.telemetry || {};
  const install_id = (telemetry.install_id || "").toString().trim().slice(0, 80) || null;
  const ip_hash = (telemetry.ip_hash || "").toString().trim().slice(0, 128) || null;
  const ua = (telemetry.ua || "").toString().trim().slice(0, 240) || null;

  const provider = String(job.provider || request.provider || "").toLowerCase();
  const model = String(job.model || request.model || "");
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const max_tokens = Number.isFinite(request.max_tokens) ? parseInt(request.max_tokens, 10) : 4096;
  const temperature = Number.isFinite(request.temperature) ? request.temperature : 1;

  // Re-apply governance gates at execution time
  const allow = assertAllowed({ provider, model, keyRow });
  if (!allow.ok) {
    await q(
      `update async_jobs set status='failed', completed_at=now(), heartbeat_at=now(), error=$2 where id=$1`,
      [id, allow.error || "Forbidden"]
    );
    return;
  }

  const dev = await enforceDevice({ keyRow, install_id, ua, actor: "job_worker" });
  if (!dev.ok) {
    await q(
      `update async_jobs set status='failed', completed_at=now(), heartbeat_at=now(), error=$2 where id=$1`,
      [id, dev.error || "Device not allowed"]
    );
    return;
  }

  // Cap gate (best-effort; cost is unknown until after completion)
  const month = monthKeyUTC();
  const custRoll = await getMonthRollup(keyRow.customer_id, month);
  const keyRoll = await getKeyMonthRollup(keyRow.api_key_id, month);
  const customer_cap_cents = customerCapCents(keyRow, custRoll);
  const key_cap_cents = keyCapCents(keyRow, custRoll);

  if ((custRoll.spent_cents || 0) >= customer_cap_cents) {
    await q(
      `update async_jobs set status='failed', completed_at=now(), heartbeat_at=now(), error=$2 where id=$1`,
      [id, `Monthly cap reached (customer)`]
    );
    return;
  }

  if ((keyRoll.spent_cents || 0) >= key_cap_cents) {
    await q(
      `update async_jobs set status='failed', completed_at=now(), heartbeat_at=now(), error=$2 where id=$1`,
      [id, `Monthly cap reached (key)`]
    );
    return;
  }

  try {
    let result;
    if (provider === "openai") result = await callOpenAI({ model, messages, max_tokens, temperature });
    else if (provider === "anthropic") result = await callAnthropic({ model, messages, max_tokens, temperature });
    else if (provider === "gemini") result = await callGemini({ model, messages, max_tokens, temperature });
    else throw new Error("Unknown provider. Use openai|anthropic|gemini.");

    const output_text = result.output_text || "";
    const input_tokens = result.input_tokens || 0;
    const output_tokens = result.output_tokens || 0;
    const cost_cents = costCents(provider, model, input_tokens, output_tokens);

    const meta = {
      raw: result.raw || null,
      max_tokens,
      temperature
    };

    await q(
      `update async_jobs set status='succeeded', completed_at=now(), heartbeat_at=now(),
        output_text=$2, input_tokens=$3, output_tokens=$4, cost_cents=$5, meta=$6::jsonb
       where id=$1`,
      [id, output_text, input_tokens, output_tokens, cost_cents, JSON.stringify(meta)]
    );

    // Metering (same logic as gateway-chat)
    const month = monthKeyUTC();

    await q(
      `insert into usage_events(customer_id, api_key_id, provider, model, input_tokens, output_tokens, cost_cents, install_id, ip_hash, ua)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [job.customer_id, job.api_key_id, provider, model, input_tokens, output_tokens, cost_cents, install_id, ip_hash, ua]
    );

    await q(
      `update api_keys
       set last_seen_at=now(),
           last_seen_install_id = coalesce($1, last_seen_install_id)
       where id=$2`,
      [install_id, job.api_key_id]
    );

    await q(
      `insert into monthly_usage(customer_id, month, spent_cents, input_tokens, output_tokens)
       values ($1,$2,$3,$4,$5)
       on conflict (customer_id, month)
       do update set
         spent_cents = monthly_usage.spent_cents + excluded.spent_cents,
         input_tokens = monthly_usage.input_tokens + excluded.input_tokens,
         output_tokens = monthly_usage.output_tokens + excluded.output_tokens,
         updated_at = now()`,
      [job.customer_id, month, cost_cents, input_tokens, output_tokens]
    );

    await q(
      `insert into monthly_key_usage(api_key_id, customer_id, month, spent_cents, input_tokens, output_tokens, calls)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (api_key_id, month)
       do update set
         spent_cents = monthly_key_usage.spent_cents + excluded.spent_cents,
         input_tokens = monthly_key_usage.input_tokens + excluded.input_tokens,
         output_tokens = monthly_key_usage.output_tokens + excluded.output_tokens,
         calls = monthly_key_usage.calls + excluded.calls,
         updated_at = now()`,
      [job.api_key_id, job.customer_id, month, cost_cents, input_tokens, output_tokens, 1]
    );
  } catch (e) {
    const msg = e?.message || "Job failed";
    await q(
      `update async_jobs set status='failed', completed_at=now(), heartbeat_at=now(), error=$2 where id=$1`,
      [id, msg]
    );
  }
};
