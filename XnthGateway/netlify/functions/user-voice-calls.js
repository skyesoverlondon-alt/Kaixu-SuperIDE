import { wrap } from "./_lib/wrap.js";
import { buildCors, json } from "./_lib/http.js";
import { getBearer } from "./_lib/http.js";
import { resolveAuth } from "./_lib/authz.js";
import { q } from "./_lib/db.js";

function clampInt(v, def, min, max) {
  const n = parseInt(String(v ?? def), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const token = getBearer(req);
  if (!token) return json(401, { error: "Missing Authorization: Bearer <virtual_key>" }, cors);

  const keyRow = await resolveAuth(token);
  if (!keyRow) return json(401, { error: "Invalid or revoked key" }, cors);

  const url = new URL(req.url);
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 500);

  const r = await q(`select id, provider, provider_call_sid, from_number, to_number, status, started_at, ended_at, duration_seconds, est_cost_cents, bill_cost_cents
                     from voice_calls where customer_id=$1 order by started_at desc limit $2`, [keyRow.customer_id, limit]);

  return json(200, { calls: r.rows }, cors);
});
