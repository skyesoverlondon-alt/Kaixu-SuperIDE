import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { signJwt } from "./_lib/crypto.js";

function needEnv(name) {
  const v = (process.env[name] || "").toString().trim();
  if (!v) {
    const err = new Error(`Missing ${name}`);
    err.code = "CONFIG";
    err.status = 500;
    throw err;
  }
  return v;
}

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  // Connecting a token affects the whole tenant; require admin/owner
  requireKeyRole(krow, "admin");

  const client_id = needEnv("GITHUB_CLIENT_ID");
  const redirect_uri = needEnv("GITHUB_OAUTH_REDIRECT_URL");

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  const scopes = (body.scopes && Array.isArray(body.scopes) ? body.scopes : ["repo", "workflow"]).map(String);
  const return_to = (body.return_to || "").toString().trim();

  const state = signJwt({
    typ: "github_oauth_state",
    customer_id: krow.customer_id,
    api_key_id: krow.api_key_id,
    key_last4: krow.key_last4,
    return_to
  }, 10 * 60);

  const scopeStr = encodeURIComponent(scopes.join(" "));
  const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirect_uri)}&scope=${scopeStr}&state=${encodeURIComponent(state)}`;

  return json(200, { authorize_url: url, state, redirect_uri, scopes }, cors);
});
