import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { getGitHubTokenForCustomer } from "./_lib/githubTokens.js";
import { ghGet } from "./_lib/github.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);

  const url = new URL(req.url);
  const customer_id = parseInt((url.searchParams.get("customer_id") || "").trim(), 10);
  if (!Number.isFinite(customer_id)) return badRequest("Missing customer_id", cors);

  const token = await getGitHubTokenForCustomer(customer_id);
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
