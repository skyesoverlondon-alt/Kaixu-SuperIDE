import { getStore } from "@netlify/blobs";
import { wrap } from "./_lib/wrap.js";
import { buildCors, json } from "./_lib/http.js";
import { q } from "./_lib/db.js";

function store() {
  const name = (process.env.MONITOR_ARCHIVE_STORE || "kaixu_monitor_events").trim() || "kaixu_monitor_events";
  return getStore({ name, consistency: "strong" });
}

function clampInt(v, dflt, min, max) {
  const n = parseInt(String(v ?? dflt), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function toNdjson(rows) {
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const retentionDays = clampInt(process.env.MONITOR_RETENTION_DAYS, 30, 1, 3650);
  const batchSize = clampInt(process.env.MONITOR_ARCHIVE_BATCH_SIZE, 2000, 100, 5000);
  const maxBatches = clampInt(process.env.MONITOR_ARCHIVE_MAX_BATCHES, 6, 1, 20);

  const cutoffTs = Date.now() - retentionDays * 24 * 3600 * 1000;
  const cutoffIso = new Date(cutoffTs).toISOString();

  const st = store();
  let totalExported = 0;
  let totalDeleted = 0;
  let batches = 0;
  let lastId = null;
  let archiveKeys = [];

  while (batches < maxBatches) {
    const res = await q(
      `select id, request_id, level, kind, function_name, method, path, origin, referer, user_agent, ip,
              app_id, build_id, customer_id, api_key_id, provider, model, http_status, duration_ms,
              error_code, error_message, error_stack, upstream_status, upstream_body, extra, created_at
       from gateway_events
       where created_at < $1
       order by id asc
       limit $2`,
      [cutoffIso, batchSize]
    );

    if (!res.rowCount) break;
    const rows = res.rows;
    const firstId = rows[0].id;
    const lastBatchId = rows[rows.length - 1].id;
    lastId = lastBatchId;

    const created = rows[0].created_at ? new Date(rows[0].created_at) : new Date(cutoffIso);
    const dayPrefix = created.toISOString().slice(0, 10);
    const key = `gateway_events/${dayPrefix}/batch-${firstId}-${lastBatchId}.ndjson`;

    await st.set(key, toNdjson(rows), { contentType: "application/x-ndjson" });
    archiveKeys.push(key);

    const ids = rows.map((r) => r.id);
    await q(`delete from gateway_events where id = any($1::bigint[])`, [ids]);

    totalExported += rows.length;
    totalDeleted += rows.length;
    batches += 1;
  }

  return json(200, {
    ok: true,
    retention_days: retentionDays,
    cutoff: cutoffIso,
    batch_size: batchSize,
    batches,
    exported: totalExported,
    deleted: totalDeleted,
    last_id: lastId,
    archive_keys: archiveKeys
  }, cors);
});
