import { wrap } from "./_lib/wrap.js";
import { buildCors, json, getBearer } from "./_lib/http.js";
import { lookupKey } from "./_lib/authz.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const row = await lookupKey(key);
  if (!row) return json(401, { error: "Invalid Kaixu Key" }, cors);

  return json(200, {
    ok: true,
    api_key_id: row.api_key_id,
    customer_id: row.customer_id,
    customer_email: row.customer_email || null,
    role: row.role || "deployer",
    key_last4: row.key_last4
  }, cors);
});
