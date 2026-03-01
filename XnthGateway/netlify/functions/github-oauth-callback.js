import { wrap } from "./_lib/wrap.js";
import { buildCors } from "./_lib/http.js";
import { verifyJwt } from "./_lib/crypto.js";
import { setGitHubTokenForCustomer } from "./_lib/githubTokens.js";
import { audit } from "./_lib/audit.js";

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

async function exchangeCode({ code }) {
  const client_id = needEnv("GITHUB_CLIENT_ID");
  const client_secret = needEnv("GITHUB_CLIENT_SECRET");

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({ client_id, client_secret, code })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error("OAuth exchange failed");
    err.code = "GITHUB_OAUTH_EXCHANGE_FAILED";
    err.status = 502;
    err.details = data;
    throw err;
  }
  return data;
}

function htmlPage(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; background:#0b1020; color:#fff; padding:28px}
.card{max-width:880px;margin:0 auto;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:18px 20px}
a{color:#b794ff}</style></head><body><div class="card">${body}</div></body></html>`;
}

export default wrap(async (req) => {
  const cors = buildCors(req);
  // OAuth callback is a browser redirect; do not block with CORS.
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") || "").toString();
  const state = (url.searchParams.get("state") || "").toString();
  if (!code || !state) {
    return new Response(htmlPage("GitHub OAuth Error", "<h2>Missing code/state.</h2>"), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const payload = verifyJwt(state);
  if (!payload || payload.typ !== "github_oauth_state") {
    return new Response(htmlPage("GitHub OAuth Error", "<h2>Invalid or expired state.</h2>"), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const tokenData = await exchangeCode({ code });
  const token = tokenData.access_token;
  const scopeStr = (tokenData.scope || "").toString();
  const scopes = scopeStr ? scopeStr.split(",").map(s => s.trim()).filter(Boolean) : [];

  await setGitHubTokenForCustomer(payload.customer_id, token, "oauth", scopes);
  await audit(`key:${payload.key_last4 || "????"}`, "GITHUB_OAUTH_CONNECTED", `customer:${payload.customer_id}`, { scopes });

  const ret = payload.return_to ? `<p><a href="${payload.return_to}">Return</a></p>` : "";
  return new Response(
    htmlPage("GitHub Connected", `<h2>GitHub Connected ✅</h2><p>Token stored for customer <strong>${payload.customer_id}</strong>.</p><p>Scopes: <code>${scopes.join(", ") || "(unknown)"}</code></p>${ret}`),
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
});
