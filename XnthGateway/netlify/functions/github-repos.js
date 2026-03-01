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
  if (!token) return json(404, { error: "No GitHub token configured", code: "NO_GITHUB_TOKEN" }, cors);

  const r = await ghGet({ token, path: "/user/repos?per_page=100&sort=updated" });
  const repos = (r.data || []).map((x) => ({
    id: x.id,
    full_name: x.full_name,
    private: x.private,
    default_branch: x.default_branch,
    html_url: x.html_url,
    pushed_at: x.pushed_at,
    updated_at: x.updated_at
  }));

  return json(200, { ok: true, repos }, cors);
});
