import { wrap } from "./_lib/wrap.js";
import { buildCors, json } from "./_lib/http.js";
import { emitEvent, getRequestId, inferFunctionName, requestMeta } from "./_lib/monitor.js";

function safeStr(v, max=12000){
  if (v == null) return null;
  const s = String(v);
  return s.length <= max ? s : s.slice(0,max) + `…(+${s.length-max} chars)`;
}

function safeJson(obj, max=20000){
  try {
    if (obj == null) return null;
    const s = JSON.stringify(obj);
    return s.length <= max ? JSON.parse(s) : { _truncated: true, preview: s.slice(0, max) + `…(+${s.length-max} chars)` };
  } catch {
    return { _unserializable: true };
  }
}

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const required = (process.env.CLIENT_ERROR_TOKEN || "").trim();
  if (required) {
    const got = (req.headers.get("x-kaixu-error-token") || "").trim();
    if (!got || got !== required) return json(403, { error: "Forbidden" }, cors);
  }

  let body = null;
  try {
    const raw = await req.text();
    if (raw && raw.length > 250_000) return json(413, { error: "Payload too large" }, cors);
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json(400, { error: "Invalid JSON body" }, cors);
  }

  const rid = getRequestId(req);
  const meta = requestMeta(req);
  const fn = inferFunctionName(req);

  const client = body?.client || body || {};
  const err = body?.error || body?.err || {};

  const name = safeStr(err.name || client.name, 300);
  const message = safeStr(err.message || client.message, 8000) || "Client error reported";
  const stack = safeStr(err.stack || client.stack, 20000);

  const extra = {
    client: safeJson({
      url: client.url || client.href || null,
      route: client.route || null,
      source: client.source || null,
      lineno: Number.isFinite(client.lineno) ? client.lineno : null,
      colno: Number.isFinite(client.colno) ? client.colno : null,
      user_agent: client.user_agent || meta.user_agent || null,
      platform: client.platform || null,
      language: client.language || null,
      viewport: client.viewport || null,
      feature_flags: client.feature_flags || client.flags || null,
      env: client.env || null,
      tags: client.tags || null,
      breadcrumb: client.breadcrumb || null
    }),
    context: safeJson(body?.context || null),
    raw: safeJson(body?.raw || null)
  };

  await emitEvent({
    request_id: rid,
    level: "error",
    kind: "client_error",
    function_name: fn,
    ...meta,
    http_status: 200,
    duration_ms: null,
    error_code: safeStr(name, 200),
    error_message: message,
    error_stack: stack,
    extra
  });

  return json(200, { ok: true, request_id: rid }, cors);
});
