import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { getNetlifyTokenForCustomer } from "./_lib/netlifyTokens.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { getDeploy } from "./_lib/pushNetlify.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  requireKeyRole(krow, "viewer");

  const netlify_token = await getNetlifyTokenForCustomer(krow.customer_id);

  const url = new URL(req.url);
  const pushId = (url.searchParams.get("pushId") || "").toString();
  if (!pushId) return badRequest("Missing pushId", cors);

  const pres = await q(
    `select id, customer_id, push_id, branch, title, deploy_id, state, url, error, required_digests, uploaded_digests, created_at, updated_at
     from push_pushes where push_id=$1 limit 1`,
    [pushId]
  );
  if (!pres.rowCount) return json(404, { error: "Not found" }, cors);
  const push = pres.rows[0];
  if (push.customer_id !== krow.customer_id) return json(403, { error: "Forbidden" }, cors);

  let live = null;
  try {
    live = await getDeploy({ deploy_id: push.deploy_id, netlify_token });
    const state = live?.state || push.state;
    const urlLive = live?.ssl_url || live?.url || push.url || null;
    const err = state === "error" ? (live?.error_message || "Netlify deploy error") : null;
    await q(`update push_pushes set state=$2, url=$3, error=$4, updated_at=now() where id=$1`, [push.id, state, urlLive, err]);
  } catch {}

  const refreshed = await q(
    `select push_id, branch, title, deploy_id, state, url, error, required_digests, uploaded_digests, created_at, updated_at
     from push_pushes where id=$1 limit 1`,
    [push.id]
  );

  return json(200, { push: refreshed.rows[0], live }, cors);
});
