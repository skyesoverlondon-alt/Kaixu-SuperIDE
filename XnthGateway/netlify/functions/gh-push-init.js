import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { q } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { getGitHubTokenForCustomer } from "./_lib/githubTokens.js";

function makeJobId() {
  return `gh_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  requireKeyRole(krow, "deployer");

  const token = await getGitHubTokenForCustomer(krow.customer_id);
  if (!token) return json(409, { error: "No GitHub token configured for this customer", code: "NO_GITHUB_TOKEN" }, cors);

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  const owner = (body.owner || "").toString().trim();
  const repo = (body.repo || "").toString().trim();
  const branch = (body.branch || "main").toString().trim();
  const message = (body.message || "Kaixu GitHub Push").toString().slice(0, 200);

  if (!owner) return badRequest("Missing owner", cors);
  if (!repo) return badRequest("Missing repo", cors);

  const job_id = makeJobId();

  const ins = await q(
    `insert into gh_push_jobs(customer_id, api_key_id, job_id, owner, repo, branch, commit_message, status, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,'uploading',now(),now())
     returning id`,
    [krow.customer_id, krow.api_key_id, job_id, owner, repo, branch, message]
  );

  await q(
    `insert into gh_push_events(customer_id, api_key_id, job_row_id, event_type, bytes, meta)
     values ($1,$2,$3,'init',0,$4::jsonb)`,
    [krow.customer_id, krow.api_key_id, ins.rows[0].id, JSON.stringify({ owner, repo, branch })]
  );

  await audit(`key:${krow.key_last4}`, "GITHUB_PUSH_INIT", `gh:${job_id}`, { owner, repo, branch });

  return json(200, { ok: true, jobId: job_id, upload: { chunk: "/.netlify/functions/gh-push-upload-chunk", complete: "/.netlify/functions/gh-push-upload-complete" } }, cors);
});
