import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { getGitHubTokenForCustomer } from "./_lib/githubTokens.js";
import { ghPost } from "./_lib/github.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  requireKeyRole(krow, "admin");

  const token = await getGitHubTokenForCustomer(krow.customer_id);
  if (!token) return json(404, { error: "No GitHub token configured", code: "NO_GITHUB_TOKEN" }, cors);

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  const name = (body.name || "").toString().trim();
  if (!name) return badRequest("Missing name", cors);

  const description = (body.description || "").toString();
  const priv = !!body.private;
  const homepage = (body.homepage || "").toString().trim();
  const hasIssues = body.has_issues === undefined ? true : !!body.has_issues;
  const hasProjects = body.has_projects === undefined ? false : !!body.has_projects;
  const hasWiki = body.has_wiki === undefined ? false : !!body.has_wiki;
  const autoInit = body.auto_init === undefined ? true : !!body.auto_init;

  const r = await ghPost({
    token,
    path: "/user/repos",
    body: { name, description, private: priv, homepage, has_issues: hasIssues, has_projects: hasProjects, has_wiki: hasWiki, auto_init: autoInit }
  });

  return json(200, { ok: true, repo: { id: r.data?.id, full_name: r.data?.full_name, html_url: r.data?.html_url, default_branch: r.data?.default_branch } }, cors);
});
