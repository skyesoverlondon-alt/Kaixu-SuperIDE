import { wrap } from "./_lib/wrap.js";
import { q } from "./_lib/db.js";
import { getBearer, sleep, monthKeyUTC } from "./_lib/http.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { getNetlifyTokenForCustomer } from "./_lib/netlifyTokens.js";
import { getDeploy } from "./_lib/pushNetlify.js";
import { audit } from "./_lib/audit.js";
import { getPushPricing } from "./_lib/pushCaps.js";

/**
 * Background completion worker.
 * Triggered by push-complete (async mode) and protected by optional JOB_WORKER_SECRET.
 *
 * Endpoint: POST /.netlify/functions/push-complete-background
 * Body: { pushId }
 */
export default wrap(async (req) => {
  try {
    // Optional hard lock: only allow internal trigger if JOB_WORKER_SECRET is set.
    const secret = process.env.JOB_WORKER_SECRET;
if (!secret) {
  // Fail closed in production: background workers should be gated by a secret header.
  try {
    await q(
      `insert into gateway_events(level, function_name, message, meta)
       values ('warn',$1,$2,'{}'::jsonb)`,
      ["push-complete-background", "JOB_WORKER_SECRET not set; background worker refused"]
    );
  } catch {}
  return new Response("", { status: 202 });
}
const got = (req.headers.get("x-kaixu-job-secret") || req.headers.get("x-job-worker-secret") || "");
if (got !== secret) return new Response("", { status: 202 });

    if (req.method !== "POST") return new Response("", { status: 202 });

    const key = getBearer(req);
    if (!key) return new Response("", { status: 202 });

    const krow = await lookupKey(key);
    if (!krow) return new Response("", { status: 202 });

    requireKeyRole(krow, "deployer");

    let body;
    try { body = await req.json(); } catch { return new Response("", { status: 202 }); }
    const pushId = (body.pushId || "").toString();
    if (!pushId) return new Response("", { status: 202 });

    const pres = await q(
      `select id, customer_id, api_key_id, deploy_id, required_digests, uploaded_digests, state
       from push_pushes where push_id=$1 limit 1`,
      [pushId]
    );
    if (!pres.rowCount) return new Response("", { status: 202 });
    const push = pres.rows[0];
    if (push.customer_id !== krow.customer_id) return new Response("", { status: 202 });

    // Don’t finalize until required uploads are present
    const required = push.required_digests || [];
    const uploaded = new Set(push.uploaded_digests || []);
    const missing = required.filter((d) => !uploaded.has(d));
    if (missing.length) {
      await q(`update push_pushes set state='missing_uploads', error=$2, updated_at=now() where id=$1`,
        [push.id, `Missing ${missing.length} required uploads`]
      );
      return new Response("", { status: 202 });
    }

    await q(`update push_pushes set state='finalizing', updated_at=now() where id=$1`, [push.id]);

    const netlify_token = await getNetlifyTokenForCustomer(krow.customer_id);

    // Poll up to 10 minutes
    let d = await getDeploy({ deploy_id: push.deploy_id, netlify_token });
    const start = Date.now();
    while (Date.now() - start < 600000) {
      if (d?.state === "ready" || d?.state === "error") break;
      await sleep(2000);
      d = await getDeploy({ deploy_id: push.deploy_id, netlify_token });
    }

    const state = d?.state || "unknown";
    const url = d?.ssl_url || d?.url || null;
    const err = state === "error" ? (d?.error_message || "Netlify deploy error") : (state === "ready" ? null : "Timed out waiting for deploy");

    await q(
      `update push_pushes set state=$2, url=$3, error=$4, updated_at=now() where id=$1`,
      [push.id, state, url, err]
    );

    // Insert usage event once (avoid duplicates)
    const evType = state === "ready" ? "deploy_ready" : "deploy_error";
    const already = await q(
      `select id from push_usage_events where push_row_id=$1 and event_type=$2 limit 1`,
      [push.id, evType]
    );
    if (!already.rowCount) {
      const month = monthKeyUTC();
      const cfg = await getPushPricing(krow.customer_id);
      const pv = cfg?.pricing_version ?? 1;

      await q(
        `insert into push_usage_events(customer_id, api_key_id, push_row_id, event_type, bytes, pricing_version, cost_cents, meta)
         values ($1,$2,$3,$4,0,$6,0,$5::jsonb)`,
        [krow.customer_id, krow.api_key_id, push.id, evType, JSON.stringify({ url, error: err, month }), pv]
      );
    }

    await audit(`key:${krow.key_last4}`, "PUSH_COMPLETE_BG", `push:${pushId}`, { state, url, error: err });
    return new Response("", { status: 202 });
  } catch {
    return new Response("", { status: 202 });
  }
});
