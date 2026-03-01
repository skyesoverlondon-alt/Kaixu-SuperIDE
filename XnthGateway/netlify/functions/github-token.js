import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { q } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { getGitHubTokenForCustomer, setGitHubTokenForCustomer, clearGitHubTokenForCustomer } from "./_lib/githubTokens.js";
import { ghGet } from "./_lib/github.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  if (req.method === "GET") {
    requireKeyRole(krow, "viewer");

    const r = await q(
      `select token_type, scopes, updated_at from customer_github_tokens where customer_id=$1 limit 1`,
      [krow.customer_id]
    );
    const connected = !!r.rowCount;

    // Avoid calling GitHub unless token exists AND caller is admin/owner
    let whoami = null;
    if (connected && (krow.role === "admin" || krow.role === "owner")) {
      const token = await getGitHubTokenForCustomer(krow.customer_id);
      if (token) {
        try {
          whoami = await ghGet("/user", token);
        } catch {
          // ignore - connection may still exist but token invalid
        }
      }
    }

    return json(200, {
      ok: true,
      connected,
      token_type: connected ? r.rows[0].token_type : null,
      scopes: connected ? (r.rows[0].scopes || []) : [],
      updated_at: connected ? r.rows[0].updated_at : null,
      whoami
    }, cors);
  }

  if (req.method === "POST") {
    // Token impacts the whole tenant; require admin/owner
    requireKeyRole(krow, "admin");

    let body;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

    const token = (body.token || "").toString().trim();
    if (!token) return badRequest("Missing token", cors);

    const token_type = (body.token_type || "pat").toString().slice(0, 32);
    const scopes = Array.isArray(body.scopes) ? body.scopes : [];

    await setGitHubTokenForCustomer(krow.customer_id, token, token_type, scopes);

    await audit(`key:${krow.key_last4}`, "GITHUB_TOKEN_SET", `customer:${krow.customer_id}`, {
      token_type,
      scopes_count: Array.isArray(scopes) ? scopes.length : 0
    });

    return json(200, { ok: true }, cors);
  }

  if (req.method === "DELETE") {
    requireKeyRole(krow, "admin");
    await clearGitHubTokenForCustomer(krow.customer_id);

    await audit(`key:${krow.key_last4}`, "GITHUB_TOKEN_CLEAR", `customer:${krow.customer_id}`);

    return json(200, { ok: true }, cors);
  }

  return json(405, { error: "Method not allowed" }, cors);
});
