import { wrap } from "./_lib/wrap.js";
import { buildCors } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";

function clampInt(v, def, min, max) {
  const n = parseInt(String(v ?? def), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...cors, "content-type": "application/json" } });

  const admin = requireAdmin(req);
  if (!admin) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "content-type": "application/json" } });

  const url = new URL(req.url);
  let lastId = clampInt(url.searchParams.get("after_id"), 0, 0, 1_000_000_000);
  const level = (url.searchParams.get("level") || "").trim() || null;
  const function_name = (url.searchParams.get("function") || url.searchParams.get("fn") || "").trim() || null;
  const app_id = (url.searchParams.get("app") || "").trim() || null;
  const request_id = (url.searchParams.get("request_id") || "").trim() || null;
  const since = (url.searchParams.get("since") || "").trim() || null;
  const kind = (url.searchParams.get("kind") || "").trim() || null;


  const enc = new TextEncoder();

  const headers = {
    ...cors,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive"
  };

  let timer = null;
  let pingTimer = null;

  const stream = new ReadableStream({
    async start(controller) {
      function send(event, data) {
        const payload = typeof data === "string" ? data : JSON.stringify(data);
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${payload}\n\n`));
      }

      // Hello
      send("hello", { ok: true, after_id: lastId, now: new Date().toISOString() });

      pingTimer = setInterval(() => {
        try { send("ping", { t: Date.now() }); } catch {}
      }, 15000);

      timer = setInterval(async () => {
        try {
          const where = ["id > $1"];
          const params = [lastId];
          let p = 2;
          if (level) { where.push(`level = $${p++}`); params.push(level); }
          if (function_name) { where.push(`function_name = $${p++}`); params.push(function_name); }
          if (app_id) { where.push(`app_id = $${p++}`); params.push(app_id); }
          if (request_id) { where.push(`request_id = $${p++}`); params.push(request_id); }
          if (since) { where.push(`created_at >= $${p++}::timestamptz`); params.push(since); }
          if (kind) { where.push(`kind = $${p++}`); params.push(kind); }
          params.push(200);

          const res = await q(
            `select id, created_at, request_id, level, kind, function_name,
                    method, path, origin, referer, user_agent, ip,
                    app_id, build_id, customer_id, api_key_id, provider, model,
                    http_status, duration_ms,
                    error_code, error_message, error_stack,
                    upstream_status, upstream_body,
                    extra
             from gateway_events
             where ${where.join(" and ")}
             order by id asc
             limit $${p}`,
            params
          );
          const events = res.rows || [];
          for (const ev of events) {
            lastId = Math.max(lastId, ev.id);
            send("event", ev);
          }
        } catch (e) {
          try { send("warn", { error: e?.message || String(e) }); } catch {}
        }
      }, 1000);
    },
    cancel() {
      try { if (timer) clearInterval(timer); } catch {}
      try { if (pingTimer) clearInterval(pingTimer); } catch {}
    }
  });

  return new Response(stream, { status: 200, headers });
});
