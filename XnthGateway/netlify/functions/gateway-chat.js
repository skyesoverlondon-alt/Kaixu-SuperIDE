import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer, monthKeyUTC, getInstallId, getClientIp, getUserAgent } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { costCents } from "./_lib/pricing.js";
import { callOpenAI, callAnthropic, callGemini } from "./_lib/providers.js";
import { resolveAuth, getMonthRollup, getKeyMonthRollup, customerCapCents, keyCapCents } from "./_lib/authz.js";
import { enforceRpm } from "./_lib/ratelimit.js";
import { hmacSha256Hex } from "./_lib/crypto.js";
import { maybeCapAlerts } from "./_lib/alerts.js";
import { enforceDevice } from "./_lib/devices.js";
import { assertAllowed } from "./_lib/allowlist.js";
import { enforceKaixuMessages } from "./_lib/kaixu.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const token = getBearer(req);
  if (!token) return json(401, { error: "Missing Authorization: Bearer <virtual_key>" }, cors);

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  const provider = (body.provider || "").toString().trim().toLowerCase();
  const model = (body.model || "").toString().trim();
  const messages_in = body.messages;
  const max_tokens = Number.isFinite(body.max_tokens) ? parseInt(body.max_tokens, 10) : 1024;
  const temperature = Number.isFinite(body.temperature) ? body.temperature : 1;

  if (!provider) return badRequest("Missing provider (openai|anthropic|gemini)", cors);
  if (!model) return badRequest("Missing model", cors);
  if (!Array.isArray(messages_in) || messages_in.length === 0) return badRequest("Missing messages[]", cors);

  const messages = enforceKaixuMessages(messages_in);


  const keyRow = await resolveAuth(token);
  if (!keyRow) return json(401, { error: "Invalid or revoked key" }, cors);
  if (!keyRow.is_active) return json(403, { error: "Customer disabled" }, cors);

  const install_id = getInstallId(req);
  const ua = getUserAgent(req);
  const ip = getClientIp(req);
  const ip_hash = ip ? hmacSha256Hex(process.env.KEY_PEPPER || process.env.JWT_SECRET || "kaixu", ip) : null;

  const allow = assertAllowed({ provider, model, keyRow });
  if (!allow.ok) return json(allow.status || 403, { error: allow.error }, cors);

  const dev = await enforceDevice({ keyRow, install_id, ua, actor: 'gateway' });
  if (!dev.ok) return json(dev.status || 403, { error: dev.error }, cors);


  // Rate limit (DB-backed, fixed 60s window)
  const rl = await enforceRpm({ customerId: keyRow.customer_id, apiKeyId: keyRow.api_key_id, rpmOverride: keyRow.rpm_limit });
  if (!rl.ok) {
    return json(429, { error: "Rate limit exceeded", ratelimit: { remaining: rl.remaining, reset: rl.reset } }, cors);
  }

  const month = monthKeyUTC();
  const custRoll = await getMonthRollup(keyRow.customer_id, month);
  const keyRoll = await getKeyMonthRollup(keyRow.api_key_id, month);

  const customer_cap_cents = customerCapCents(keyRow, custRoll);
  const key_cap_cents = keyCapCents(keyRow, custRoll);

  if ((custRoll.spent_cents || 0) >= customer_cap_cents) {
    return json(402, {
      error: "Monthly cap reached",
      scope: "customer",
      month: {
        month,
        cap_cents: customer_cap_cents,
        spent_cents: custRoll.spent_cents || 0,
        customer_cap_cents,
        customer_spent_cents: custRoll.spent_cents || 0,
        key_cap_cents,
        key_spent_cents: keyRoll.spent_cents || 0
      }
    }, cors);
  }

  if ((keyRoll.spent_cents || 0) >= key_cap_cents) {
    return json(402, {
      error: "Monthly cap reached",
      scope: "key",
      month: {
        month,
        cap_cents: customer_cap_cents,
        spent_cents: custRoll.spent_cents || 0,
        customer_cap_cents,
        customer_spent_cents: custRoll.spent_cents || 0,
        key_cap_cents,
        key_spent_cents: keyRoll.spent_cents || 0
      }
    }, cors);
  }

  let result;
  try {
    if (provider === "openai") result = await callOpenAI({ model, messages, max_tokens, temperature });
    else if (provider === "anthropic") result = await callAnthropic({ model, messages, max_tokens, temperature });
    else if (provider === "gemini") result = await callGemini({ model, messages, max_tokens, temperature });
    else return badRequest("Unknown provider. Use openai|anthropic|gemini.", cors);
  } catch (e) {
    return json(500, { error: e?.message || "Provider error", provider }, cors);
  }

  const input_tokens = result.input_tokens || 0;
  const output_tokens = result.output_tokens || 0;
  const cost_cents = costCents(provider, model, input_tokens, output_tokens);

  await q(
    `insert into usage_events(customer_id, api_key_id, provider, model, input_tokens, output_tokens, cost_cents, install_id, ip_hash, ua)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [keyRow.customer_id, keyRow.api_key_id, provider, model, input_tokens, output_tokens, cost_cents, install_id, ip_hash, ua]
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
       spent_cents = monthly_usage.spent_cents + excluded.spent_cents,
       input_tokens = monthly_usage.input_tokens + excluded.input_tokens,
       output_tokens = monthly_usage.output_tokens + excluded.output_tokens,
       updated_at = now()`,
    [keyRow.customer_id, month, cost_cents, input_tokens, output_tokens]
  );

  await q(
    `insert into monthly_key_usage(api_key_id, customer_id, month, spent_cents, input_tokens, output_tokens, calls)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (api_key_id, month)
     do update set
       spent_cents = monthly_key_usage.spent_cents + excluded.spent_cents,
       input_tokens = monthly_key_usage.input_tokens + excluded.input_tokens,
       output_tokens = monthly_key_usage.output_tokens + excluded.output_tokens,
       calls = monthly_key_usage.calls + excluded.calls,
       updated_at = now()`,
    [keyRow.api_key_id, keyRow.customer_id, month, cost_cents, input_tokens, output_tokens, 1]
  );

  const newCustRoll = await getMonthRollup(keyRow.customer_id, month);
  const newKeyRoll = await getKeyMonthRollup(keyRow.api_key_id, month);

  const customer_cap_cents_after = customerCapCents(keyRow, newCustRoll);
  const key_cap_cents_after = keyCapCents(keyRow, newCustRoll);

  // best-effort alerts
  await maybeCapAlerts({
    customer_id: keyRow.customer_id,
    api_key_id: keyRow.api_key_id,
    month,
    customer_cap_cents: customer_cap_cents_after,
    customer_spent_cents: newCustRoll.spent_cents || 0,
    key_cap_cents: key_cap_cents_after,
    key_spent_cents: newKeyRoll.spent_cents || 0
  });

  return json(200, {
    provider,
    model,
    output_text: result.output_text || "",
    usage: { input_tokens, output_tokens, cost_cents },
    month: {
      month,
      cap_cents: customer_cap_cents_after,
      spent_cents: newCustRoll.spent_cents || 0,
      customer_cap_cents: customer_cap_cents_after,
      customer_spent_cents: newCustRoll.spent_cents || 0,
      key_cap_cents: key_cap_cents_after,
      key_spent_cents: newKeyRoll.spent_cents || 0
    },
    telemetry: { install_id: install_id || null }
  }, cors);
});