import { wrap } from "./_lib/wrap.js";
import { buildCors, badRequest, getBearer, monthKeyUTC, getInstallId, getClientIp, getUserAgent } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { costCents } from "./_lib/pricing.js";
import { resolveAuth, getMonthRollup, getKeyMonthRollup, customerCapCents, keyCapCents } from "./_lib/authz.js";
import { enforceRpm } from "./_lib/ratelimit.js";
import { streamOpenAI, streamAnthropic, streamGemini } from "./_lib/providers.js";
import { hmacSha256Hex } from "./_lib/crypto.js";
import { maybeCapAlerts } from "./_lib/alerts.js";
import { enforceDevice } from "./_lib/devices.js";
import { assertAllowed } from "./_lib/allowlist.js";
import { enforceKaixuMessages } from "./_lib/kaixu.js";

/**
 * SSE endpoint:
 * POST /.netlify/functions/gateway-stream
 * Headers: Authorization: Bearer <virtual_key|user_session_jwt>
 * Body: { provider, model, messages, max_tokens, temperature }
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...cors, "content-type": "application/json" } });

  const token = getBearer(req);
  if (!token) return new Response(JSON.stringify({ error: "Missing Authorization: Bearer <virtual_key>" }), { status: 401, headers: { ...cors, "content-type": "application/json" } });

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
  if (!keyRow) return new Response(JSON.stringify({ error: "Invalid or revoked key" }), { status: 401, headers: { ...cors, "content-type": "application/json" } });
  if (!keyRow.is_active) return new Response(JSON.stringify({ error: "Customer disabled" }), { status: 403, headers: { ...cors, "content-type": "application/json" } });

  const install_id = getInstallId(req);
  const ua = getUserAgent(req);
  const ip = getClientIp(req);
  const ip_hash = ip ? hmacSha256Hex(process.env.KEY_PEPPER || process.env.JWT_SECRET || "kaixu", ip) : null;

  const allow = assertAllowed({ provider, model, keyRow });
  if (!allow.ok) return new Response(JSON.stringify({ error: allow.error }), { status: allow.status || 403, headers: { ...cors, "content-type": "application/json" } });

  const dev = await enforceDevice({ keyRow, install_id, ua, actor: 'gateway' });
  if (!dev.ok) return new Response(JSON.stringify({ error: dev.error }), { status: dev.status || 403, headers: { ...cors, "content-type": "application/json" } });


  // Rate limit
  const rl = await enforceRpm({ customerId: keyRow.customer_id, apiKeyId: keyRow.api_key_id, rpmOverride: keyRow.rpm_limit });
  if (!rl.ok) return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429, headers: { ...cors, "content-type": "application/json" } });

  const month = monthKeyUTC();
  const custRoll = await getMonthRollup(keyRow.customer_id, month);
  const keyRoll = await getKeyMonthRollup(keyRow.api_key_id, month);
  const customer_cap_cents = customerCapCents(keyRow, custRoll);
  const key_cap_cents = keyCapCents(keyRow, custRoll);

  if ((custRoll.spent_cents || 0) >= customer_cap_cents) {
    return new Response(JSON.stringify({
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
    }), { status: 402, headers: { ...cors, "content-type": "application/json" } });
  }

  if ((keyRoll.spent_cents || 0) >= key_cap_cents) {
    return new Response(JSON.stringify({
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
    }), { status: 402, headers: { ...cors, "content-type": "application/json" } });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let buffer = "";
  let lastUsage = { input_tokens: 0, output_tokens: 0 };
  let input_tokens = 0, output_tokens = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, dataObj) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(dataObj)}\n\n`));
      };

      send("meta", {
        provider,
        model,
        telemetry: { install_id: install_id || null },
        month: {
          month,
          cap_cents: customer_cap_cents,
          spent_cents: custRoll.spent_cents || 0,
          customer_cap_cents,
          customer_spent_cents: custRoll.spent_cents || 0,
          key_cap_cents,
          key_spent_cents: keyRoll.spent_cents || 0
        }
      });

      // Keep-alive ping so intermediaries don’t drop idle SSE streams.
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`event: ping\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ t: Date.now() })}\n\n`));
        } catch {}
      }, 15000);

      // Create upstream adapter AFTER we’ve already started streaming.
      let adapter;
      try {
        if (provider === "openai") adapter = await streamOpenAI({ model, messages, max_tokens, temperature });
        else if (provider === "anthropic") adapter = await streamAnthropic({ model, messages, max_tokens, temperature });
        else if (provider === "gemini") adapter = await streamGemini({ model, messages, max_tokens, temperature });
        else {
          send("error", { error: "Unknown provider. Use openai|anthropic|gemini." });
          clearInterval(ping);
controller.close();
          return;
        }
      } catch (e) {
        send("error", { error: e?.message || "Provider error" });
        clearInterval(ping);
controller.close();
        return;
      }


      try {
        const reader = adapter.upstream.body.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Parse by lines to avoid splitting JSON/SSE messages mid-line.
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";

          for (const line of lines) {
            const parsedEvents = adapter.parse(line);
            for (const ev of parsedEvents) {
              if (ev.type === "delta" && ev.text) {
                send("delta", { text: ev.text });
              } else if ((ev.type === "usage" || ev.type === "done") && ev.usage) {
                lastUsage = ev.usage;
              }
            }
          }
        }

        // finalize usage
        input_tokens = lastUsage.input_tokens || 0;
        output_tokens = lastUsage.output_tokens || 0;

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

        await maybeCapAlerts({
          customer_id: keyRow.customer_id,
          api_key_id: keyRow.api_key_id,
          month,
          customer_cap_cents: customer_cap_cents_after,
          customer_spent_cents: newCustRoll.spent_cents || 0,
          key_cap_cents: key_cap_cents_after,
          key_spent_cents: newKeyRoll.spent_cents || 0
        });

        send("done", {
          usage: { input_tokens, output_tokens, cost_cents },
          month: {
            month,
            cap_cents: customer_cap_cents_after,
            spent_cents: newCustRoll.spent_cents || 0,
            customer_cap_cents: customer_cap_cents_after,
            customer_spent_cents: newCustRoll.spent_cents || 0,
            key_cap_cents: key_cap_cents_after,
            key_spent_cents: newKeyRoll.spent_cents || 0
          }
        });
        clearInterval(ping);
        controller.close();
      } catch (err) {
        clearInterval(ping);
        const message = err?.message || "Stream error";
        controller.enqueue(encoder.encode(`event: error\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
        clearInterval(ping);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...cors,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive"
    }
  });
});