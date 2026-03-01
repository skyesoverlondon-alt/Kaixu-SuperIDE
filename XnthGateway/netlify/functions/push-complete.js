import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer, sleep, monthKeyUTC } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { audit } from "./_lib/audit.js";
import { getNetlifyTokenForCustomer } from "./_lib/netlifyTokens.js";
import { getDeploy } from "./_lib/pushNetlify.js";
import { getPushPricing } from "./_lib/pushCaps.js";

/**
 * Push completion can be slow because Netlify deploys may take time.
 * For production resilience, this endpoint defaults to ASYNC completion:
 *  - It sets push state to "finalizing"
 *  - It triggers push-complete-background (a background function)
 *  - Clients poll /push-status for final state + URL
 *
 * If you truly want synchronous completion, pass { wait: true } in the JSON body.
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  requireKeyRole(krow, "deployer");

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  const pushId = (body.pushId || "").toString();
  const wait = !!body.wait;

  if (!pushId) return badRequest("Missing pushId", cors);

  const pres = await q(
    `select id, customer_id, api_key_id, deploy_id, required_digests, uploaded_digests, state
     from push_pushes where push_id=$1 limit 1`,
    [pushId]
  );
  if (!pres.rowCount) return json(404, { error: "Push not found" }, cors);
  const push = pres.rows[0];
  if (push.customer_id !== krow.customer_id) return json(403, { error: "Forbidden" }, cors);

  const required = push.required_digests || [];
  const uploaded = new Set(push.uploaded_digests || []);
  const missing = required.filter((d) => !uploaded.has(d));
  if (missing.length) {
    return json(409, { error: "Missing required uploads", code: "MISSING_UPLOADS", missingCount: missing.length }, cors);
  }

  // Default: async finalize to avoid function timeouts
  if (!wait) {
    await q(`update push_pushes set state='finalizing', updated_at=now() where id=$1`, [push.id]);

    const origin = process.env.URL || new URL(req.url).origin;
    const workerSecret = process.env.JOB_WORKER_SECRET;

    if (!workerSecret) return json(500, { error: "Missing JOB_WORKER_SECRET", code: "CONFIG", hint: "Set JOB_WORKER_SECRET in your Netlify environment variables." }, cors);

    // Fire and forget. Background function does the real work.
    await fetch(`${origin}/.netlify/functions/push-complete-background`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "x-kaixu-job-secret": workerSecret
      },
      body: JSON.stringify({ pushId })
    });

    await audit(`key:${krow.key_last4}`, "PUSH_COMPLETE_ASYNC", `push:${pushId}`, { state: "finalizing" });

    return json(202, { ok: true, queued: true, state: "finalizing", pushId, deployId: push.deploy_id }, cors);
  }

  // Synchronous (best-effort) finalize
  const netlify_token = await getNetlifyTokenForCustomer(krow.customer_id);

  let d = await getDeploy({ deploy_id: push.deploy_id, netlify_token });
  const start = Date.now();
  while (Date.now() - start < 120000) { // 120s hard limit; beyond that you should use async
    if (d?.state === "ready" || d?.state === "error") break;
    await sleep(1500);
    d = await getDeploy({ deploy_id: push.deploy_id, netlify_token });
  }

  const state = d?.state || "unknown";
  const url = d?.ssl_url || d?.url || null;
  const err = state === "error" ? (d?.error_message || "Netlify deploy error") : null;

  await q(
    `update push_pushes set state=$2, url=$3, error=$4, updated_at=now() where id=$1`,
    [push.id, state, url, err]
  );

  const month = monthKeyUTC();
  const cfg = await getPushPricing(krow.customer_id);
  const pv = cfg?.pricing_version ?? 1;

  



// Idempotency: avoid double-writing deploy_ready/deploy_error if caller retries sync completion.
const evType = state === "ready" ? "deploy_ready" : "deploy_error";
const exists = await q(
  `select id from push_usage_events where push_row_id=$1 and event_type=$2 limit 1`,
  [push.id, evType]
);
if (!exists.rowCount) {
  await q(
    `insert into push_usage_events(customer_id, api_key_id, push_row_id, event_type, bytes, pricing_version, cost_cents, meta)
     values ($1,$2,$3,$4,0,$6,0,$5::jsonb)`,
    [krow.customer_id, krow.api_key_id, push.id, evType, JSON.stringify({ url, error: err, month }), pv]
  );
}

await audit(`key:${krow.key_last4}`, "PUSH_COMPLETE", `push:${pushId}`, { state, url, error: err });

  if (state === "error") return json(502, { error: "Netlify deploy failed", details: err, state }, cors);
  if (state !== "ready") return json(504, { error: "Timed out waiting for Netlify deploy; poll push-status", state, deployId: push.deploy_id, pushId }, cors);

  return json(200, { ok: true, state, url, deployId: push.deploy_id }, cors);
});
