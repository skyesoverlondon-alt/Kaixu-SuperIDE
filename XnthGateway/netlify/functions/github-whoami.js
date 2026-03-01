import { wrap } from "./_lib/wrap.js";
import { buildCors, json, getBearer } from "./_lib/http.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { getGitHubTokenForCustomer } from "./_lib/githubTokens.js";
import { ghGet } from "./_lib/github.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  requireKeyRole(krow, "admin");

  const token = await getGitHubTokenForCustomer(krow.customer_id);
  if (!token) return json(404, { error: "No GitHub token configured for this customer", code: "NO_GITHUB_TOKEN" }, cors);

  const r = await ghGet({ token, path: "/user" });
  const scopes = (r.headers.get("x-oauth-scopes") || "").toString();
  return json(200, { ok: true, customer_id: krow.customer_id, user: r.data, scopes }, cors);
});
