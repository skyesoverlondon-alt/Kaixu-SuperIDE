import { getStore } from "@netlify/blobs";
import { wrap } from "./_lib/wrap.js";
import { buildCors, json } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";

function store() {
  const name = (process.env.MONITOR_ARCHIVE_STORE || "kaixu_monitor_events").trim() || "kaixu_monitor_events";
  return getStore({ name, consistency: "strong" });
}

function clampInt(v, dflt, min, max) {
  const n = parseInt(String(v ?? dflt), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  // Admin auth only; keeps blob access off the front-end.
  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);

  const url = new URL(req.url);
  const key = (url.searchParams.get("key") || "").trim();
  const prefix = (url.searchParams.get("prefix") || "gateway_events/").trim();
  const cursor = (url.searchParams.get("cursor") || "").trim() || undefined;
  const limit = clampInt(url.searchParams.get("limit"), 200, 10, 2000);

  const st = store();

  // Download a specific object
  if (key) {
    const body = await st.get(key, { type: "text" });
    if (body == null) return json(404, { error: "Not found" }, cors);
    const filename = key.split("/").pop() || "archive.ndjson";
    return new Response(body, {
      status: 200,
      headers: {
        ...cors,
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`
      }
    });
  }

  // List objects
  const res = await st.list({ prefix, cursor, limit });
  const items = (res.blobs || []).map((b) => ({ key: b.key, size: b.size, updated_at: b.updatedAt }));

  return json(200, {
    ok: true,
    prefix,
    limit,
    cursor: res.cursor || null,
    items
  }, cors);
});
