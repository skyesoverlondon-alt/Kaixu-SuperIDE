import { wrap } from "./_lib/wrap.js";
import { buildCors, json } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);

  const url = new URL(req.url);
  const month = (url.searchParams.get("month") || "").trim() || null;

  const r = month
    ? await q(`select * from voice_usage_monthly where month=$1 order by bill_cost_cents desc limit 1000`, [month])
    : await q(`select * from voice_usage_monthly order by id desc limit 1000`, []);

  return json(200, { voice_usage: r.rows }, cors);
});
