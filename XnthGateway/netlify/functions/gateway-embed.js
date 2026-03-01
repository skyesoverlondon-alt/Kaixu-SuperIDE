/**
 * gateway-embed  —  kAIxU Gateway 13 Embeddings Lane
 *
 * POST /.netlify/functions/gateway-embed
 * Authorization: Bearer <KAIXU_VIRTUAL_KEY>
 *
 * Body:
 * {
 *   "provider": "gemini",
 *   "model":    "gemini-embedding-001",
 *   "input":    "text to embed"  | ["text1","text2"],
 *   "taskType": "RETRIEVAL_QUERY",              // optional
 *   "title":    "doc title",                     // optional  (best with RETRIEVAL_DOCUMENT)
 *   "outputDimensionality": 1536                // optional  (default 3072)
 * }
 *
 * Response:
 * {
 *   "provider": "gemini",
 *   "model":    "gemini-embedding-001",
 *   "embeddings": [ [0.012, -0.034, …] , … ],
 *   "dimensions": 1536,
 *   "usage": { "input_tokens": 42, "cost_cents": 0 },
 *   "month": { … },
 *   "telemetry": { "install_id": … }
 * }
 */

import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer, monthKeyUTC, getInstallId, getClientIp, getUserAgent } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { costCents } from "./_lib/pricing.js";
import { callGeminiEmbed } from "./_lib/providers.js";
import { resolveAuth, getMonthRollup, getKeyMonthRollup, customerCapCents, keyCapCents } from "./_lib/authz.js";
import { enforceRpm } from "./_lib/ratelimit.js";
import { hmacSha256Hex } from "./_lib/crypto.js";
import { maybeCapAlerts } from "./_lib/alerts.js";
import { enforceDevice } from "./_lib/devices.js";
import { assertAllowed } from "./_lib/allowlist.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  // ── Auth ──────────────────────────────────────────────────────────
  const token = getBearer(req);
  if (!token) return json(401, { error: "Missing Authorization: Bearer <virtual_key>" }, cors);

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  const provider = (body.provider || "").toString().trim().toLowerCase();
  const model    = (body.model    || "").toString().trim();
  const rawInput = body.input;
  const taskType = body.taskType ? String(body.taskType).trim() : undefined;
  const title    = body.title    ? String(body.title).trim()    : undefined;
  const outputDimensionality = Number.isFinite(body.outputDimensionality)
    ? parseInt(body.outputDimensionality, 10)
    : undefined;

  if (!provider) return badRequest("Missing provider (gemini)", cors);
  if (!model)    return badRequest("Missing model (e.g. gemini-embedding-001)", cors);

  // Normalize input to array of strings
  const texts = Array.isArray(rawInput)
    ? rawInput.map(v => String(v)).filter(Boolean)
    : [String(rawInput || "")].filter(Boolean);
  if (!texts.length) return badRequest("Missing or empty input text", cors);

  // ── Resolve key ───────────────────────────────────────────────────
  const keyRow = await resolveAuth(token);
  if (!keyRow) return json(401, { error: "Invalid or revoked key" }, cors);
  if (!keyRow.is_active) return json(403, { error: "Customer disabled" }, cors);

  const install_id = getInstallId(req);
  const ua  = getUserAgent(req);
  const ip  = getClientIp(req);
  const ip_hash = ip ? hmacSha256Hex(process.env.KEY_PEPPER || process.env.JWT_SECRET || "kaixu", ip) : null;

  // ── Allowlist check ───────────────────────────────────────────────
  const allow = assertAllowed({ provider, model, keyRow });
  if (!allow.ok) return json(allow.status || 403, { error: allow.error }, cors);

  // ── Device binding ────────────────────────────────────────────────
  const dev = await enforceDevice({ keyRow, install_id, ua, actor: "gateway-embed" });
  if (!dev.ok) return json(dev.status || 403, { error: dev.error }, cors);

  // ── Rate limit ────────────────────────────────────────────────────
  const rl = await enforceRpm({ customerId: keyRow.customer_id, apiKeyId: keyRow.api_key_id, rpmOverride: keyRow.rpm_limit });
  if (!rl.ok) {
    return json(429, { error: "Rate limit exceeded", ratelimit: { remaining: rl.remaining, reset: rl.reset } }, cors);
  }

  // ── Monthly cap check ─────────────────────────────────────────────
  const month    = monthKeyUTC();
  const custRoll = await getMonthRollup(keyRow.customer_id, month);
  const keyRoll  = await getKeyMonthRollup(keyRow.api_key_id, month);

  const customer_cap = customerCapCents(keyRow, custRoll);
  const key_cap      = keyCapCents(keyRow, custRoll);

  if ((custRoll.spent_cents || 0) >= customer_cap) {
    return json(402, {
      error: "Monthly cap reached", scope: "customer",
      month: { month, cap_cents: customer_cap, spent_cents: custRoll.spent_cents || 0,
               customer_cap_cents: customer_cap, customer_spent_cents: custRoll.spent_cents || 0,
               key_cap_cents: key_cap, key_spent_cents: keyRoll.spent_cents || 0 }
    }, cors);
  }
  if ((keyRoll.spent_cents || 0) >= key_cap) {
    return json(402, {
      error: "Monthly cap reached", scope: "key",
      month: { month, cap_cents: customer_cap, spent_cents: custRoll.spent_cents || 0,
               customer_cap_cents: customer_cap, customer_spent_cents: custRoll.spent_cents || 0,
               key_cap_cents: key_cap, key_spent_cents: keyRoll.spent_cents || 0 }
    }, cors);
  }

  // ── Upstream call ─────────────────────────────────────────────────
  let allEmbeddings = [];
  let totalInputTokens = 0;
  let dimensions = 0;

  try {
    if (provider === "gemini") {
      // Process each text — Gemini embedContent is per-text
      for (const text of texts) {
        const result = await callGeminiEmbed({ model, input: text, taskType, title, outputDimensionality });
        allEmbeddings.push(result.embedding);
        totalInputTokens += result.input_tokens || 0;
        dimensions = result.dimensions;
      }
    } else {
      return badRequest("Embedding provider not supported yet. Use gemini.", cors);
    }
  } catch (e) {
    return json(e?.status || 500, { error: e?.message || "Provider error", provider }, cors);
  }

  // ── Usage tracking ────────────────────────────────────────────────
  const input_tokens  = totalInputTokens;
  const output_tokens = 0;   // embeddings produce no output tokens
  const cost = costCents(provider, model, input_tokens, output_tokens);

  await q(
    `insert into usage_events(customer_id, api_key_id, provider, model, input_tokens, output_tokens, cost_cents, install_id, ip_hash, ua)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [keyRow.customer_id, keyRow.api_key_id, provider, model, input_tokens, output_tokens, cost, install_id, ip_hash, ua]
  );

  await q(
    `update api_keys
     set last_seen_at=now(),
         last_seen_install_id = coalesce($1, last_seen_install_id)
     where id=$2`,
    [install_id, keyRow.api_key_id]
  );

  await q(
    `insert into monthly_usage(customer_id, month, spent_cents, input_tokens, output_tokens)
     values ($1,$2,$3,$4,$5)
     on conflict (customer_id, month)
     do update set
       spent_cents  = monthly_usage.spent_cents  + excluded.spent_cents,
       input_tokens = monthly_usage.input_tokens + excluded.input_tokens,
       output_tokens = monthly_usage.output_tokens + excluded.output_tokens,
       updated_at = now()`,
    [keyRow.customer_id, month, cost, input_tokens, output_tokens]
  );

  await q(
    `insert into monthly_key_usage(api_key_id, customer_id, month, spent_cents, input_tokens, output_tokens, calls)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (api_key_id, month)
     do update set
       spent_cents  = monthly_key_usage.spent_cents  + excluded.spent_cents,
       input_tokens = monthly_key_usage.input_tokens + excluded.input_tokens,
       output_tokens = monthly_key_usage.output_tokens + excluded.output_tokens,
       calls        = monthly_key_usage.calls        + excluded.calls,
       updated_at = now()`,
    [keyRow.api_key_id, keyRow.customer_id, month, cost, input_tokens, output_tokens, 1]
  );

  // ── Post-call rollups + alerts ────────────────────────────────────
  const newCustRoll = await getMonthRollup(keyRow.customer_id, month);
  const newKeyRoll  = await getKeyMonthRollup(keyRow.api_key_id, month);

  const customer_cap_after = customerCapCents(keyRow, newCustRoll);
  const key_cap_after      = keyCapCents(keyRow, newCustRoll);

  await maybeCapAlerts({
    customer_id: keyRow.customer_id,
    api_key_id:  keyRow.api_key_id,
    month,
    customer_cap_cents: customer_cap_after,
    customer_spent_cents: newCustRoll.spent_cents || 0,
    key_cap_cents: key_cap_after,
    key_spent_cents: newKeyRoll.spent_cents || 0
  });

  // ── Response ──────────────────────────────────────────────────────
  return json(200, {
    provider,
    model,
    embeddings: allEmbeddings,
    dimensions,
    usage: { input_tokens, cost_cents: cost },
    month: {
      month,
      cap_cents: customer_cap_after,
      spent_cents: newCustRoll.spent_cents || 0,
      customer_cap_cents: customer_cap_after,
      customer_spent_cents: newCustRoll.spent_cents || 0,
      key_cap_cents: key_cap_after,
      key_spent_cents: newKeyRoll.spent_cents || 0
    },
    telemetry: { install_id: install_id || null }
  }, cors);
});
