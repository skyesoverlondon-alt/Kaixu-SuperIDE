/**
 * Safe local end-to-end smoke test for Kaixu Gateway13.
 *
 * Requires `netlify dev` running on http://localhost:8888 and env vars loaded (see env.template).
 *
 * This script DOES NOT print sensitive tokens/keys.
 */

const origin = (process.env.KAIXU_ORIGIN || "http://localhost:8888").replace(/\/$/, "");
const fnBase = `${origin}/.netlify/functions`;

const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  console.error("Missing ADMIN_PASSWORD in environment.");
  process.exit(1);
}

function defaultModelFor(p) {
  if (p === "openai") return "gpt-4o-mini";
  if (p === "anthropic") return "claude-3-5-sonnet-20241022";
  if (p === "gemini") return "gemini-2.5-flash";
  return "gpt-4o-mini";
}

const explicitProvider = (process.env.E2E_PROVIDER || "").trim().toLowerCase();
const explicitModel = (process.env.E2E_MODEL || "").trim();

const providerModelPairs = explicitProvider
  ? [{ provider: explicitProvider, model: explicitModel || defaultModelFor(explicitProvider) }]
  : [
      { provider: "openai", model: "gpt-4o-mini" },
      { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
      { provider: "gemini", model: "gemini-2.5-flash" }
    ];

const installId = (process.env.E2E_INSTALL_ID || `e2e-${Date.now()}`).trim();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readJsonSafe(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _non_json: text };
  }
}

async function httpJson(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      ...(body !== undefined ? { "content-type": "application/json" } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const data = await readJsonSafe(res);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function summarizeError(err) {
  const status = err?.status;
  const msg = err?.message || String(err);
  const data = err?.data;
  const safe = {
    status,
    message: msg,
    error: data?.error,
    provider: data?.provider,
    upstream: data?.upstream,
    hint: data?.hint,
    code: data?.code
  };
  return safe;
}

async function main() {
  console.log(`Base: ${origin}`);
  if (explicitProvider) console.log(`Provider/model: ${explicitProvider}/${explicitModel || defaultModelFor(explicitProvider)}`);
  else console.log(`Provider/model: auto (openai → anthropic → gemini)`);

  // 1) Admin login (JWT flow)
  const login = await httpJson("POST", `${fnBase}/admin-login`, { password: adminPassword });
  const adminJwt = login?.token;
  if (!adminJwt) throw new Error("admin-login did not return token");

  // 2) Create customer
  const email = `e2e+${Date.now()}@example.com`;
  const cust = await httpJson(
    "POST",
    `${fnBase}/admin-customers`,
    { email, plan_name: "starter", monthly_cap_cents: 2000 },
    { authorization: `Bearer ${adminJwt}` }
  );
  const customerId = cust?.customer?.id;
  if (!customerId) throw new Error("admin-customers did not return customer.id");

  // 3) Create key
  const keyRes = await httpJson(
    "POST",
    `${fnBase}/admin-keys`,
    { customer_id: parseInt(customerId, 10), label: "e2e", role: "deployer" },
    { authorization: `Bearer ${adminJwt}` }
  );
  const apiKeyId = keyRes?.api_key?.id;
  const apiKey = keyRes?.api_key?.key;
  const keyLast4 = keyRes?.api_key?.key_last4;
  if (!apiKeyId || !apiKey) throw new Error("admin-keys did not return api_key.id/key");

  console.log(`Created customer_id=${customerId}`);
  console.log(`Created api_key_id=${apiKeyId} (last4=${keyLast4 || "????"})`);

  const authHeaders = {
    authorization: `Bearer ${apiKey}`,
    "x-kaixu-install-id": installId,
    "x-kaixu-app": "e2e-local",
    "x-kaixu-build": "dev"
  };

  // 4) Gateway chat (sync) — try providers until one works
  let chosen = null;
  let chat = null;
  for (const cand of providerModelPairs) {
    try {
      const c = await httpJson(
        "POST",
        `${fnBase}/gateway-chat`,
        {
          provider: cand.provider,
          model: cand.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 64,
          temperature: 0
        },
        authHeaders
      );
      chosen = cand;
      chat = c;
      break;
    } catch (e) {
      const s = summarizeError(e);
      console.log(`gateway-chat failed for ${cand.provider}/${cand.model}: ${s.error || s.message}`);
      if (explicitProvider) throw e;
    }
  }
  if (!chosen || !chat) throw new Error("No provider succeeded; check provider API keys in .env");

  console.log(`gateway-chat ok via ${chosen.provider}/${chosen.model}; cost_cents=${chat?.usage?.cost_cents ?? "?"}; output_len=${(chat?.output_text || "").length}`);

  // 5) Gateway async job
  const jobSubmit = await httpJson(
    "POST",
    `${fnBase}/gateway-job-submit`,
    {
      provider: chosen.provider,
      model: chosen.model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 64,
      temperature: 0
    },
    authHeaders
  );

  const jobId = jobSubmit?.job_id;
  if (!jobId) throw new Error("gateway-job-submit did not return job_id");

  console.log(`job submitted: ${jobId}`);

  // Poll status until done
  const statusUrl = `${fnBase}/gateway-job-status?id=${encodeURIComponent(jobId)}`;
  const resultUrl = `${fnBase}/gateway-job-result?id=${encodeURIComponent(jobId)}`;

  const deadline = Date.now() + 60_000;
  let lastStatus = "";
  let polls = 0;

  while (Date.now() < deadline) {
    polls++;
    const s = await httpJson("GET", statusUrl + (polls === 6 ? "&kick=1" : ""), undefined, authHeaders);
    const st = s?.job?.status;
    if (st && st !== lastStatus) {
      lastStatus = st;
      console.log(`job status: ${st}`);
    }

    if (st === "succeeded") break;
    if (st === "failed") {
      throw Object.assign(new Error("Job failed"), { status: 500, data: { error: s?.job?.error || "Job failed" } });
    }

    await sleep(1000);
  }

  const result = await httpJson("GET", resultUrl, undefined, authHeaders);
  console.log(`job result ok; cost_cents=${result?.usage?.cost_cents ?? "?"}; output_len=${(result?.output_text || "").length}`);

  console.log("E2E OK");
}

main().catch((err) => {
  console.error("E2E FAILED", summarizeError(err));
  process.exit(1);
});
