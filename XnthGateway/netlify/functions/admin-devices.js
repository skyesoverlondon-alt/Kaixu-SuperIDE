import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";
import { setDeviceRevoked } from "./_lib/devices.js";
import { audit } from "./_lib/audit.js";

/**
 * Admin device management.
 * GET   /.netlify/functions/admin-devices?customer_id=123&api_key_id=456
 * PATCH /.netlify/functions/admin-devices { api_key_id, install_id, revoked }
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const customer_id = url.searchParams.get("customer_id") ? parseInt(url.searchParams.get("customer_id"), 10) : null;
    const api_key_id = url.searchParams.get("api_key_id") ? parseInt(url.searchParams.get("api_key_id"), 10) : null;
    const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "200", 10)));

    if (!customer_id) return badRequest("Missing customer_id", cors);

    const params = [customer_id];
    let where = "d.customer_id=$1";
    if (api_key_id) {
      params.push(api_key_id);
      where += " and d.api_key_id=$2";
    }
    params.push(limit);
    const limitPos = params.length;

    const res = await q(
      `select d.api_key_id, k.key_last4, k.label as key_label,
              d.install_id, d.device_label, d.first_seen_at, d.last_seen_at, d.revoked_at, d.revoked_by, d.last_seen_ua
       from key_devices d
       join api_keys k on k.id=d.api_key_id
       where ${where}
       order by d.last_seen_at desc nulls last, d.first_seen_at desc
       limit $${limitPos}`,
      params
    );

    return json(200, { devices: res.rows }, cors);
  }

  if (req.method === "PATCH") {
    let body;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

    const api_key_id = parseInt(body.api_key_id, 10);
    const install_id = (body.install_id || "").toString().trim();
    const revoked = body.revoked === true;

    if (!Number.isFinite(api_key_id)) return badRequest("Missing api_key_id", cors);
    if (!install_id) return badRequest("Missing install_id", cors);

    await setDeviceRevoked({ api_key_id, install_id, revoked, actor: `admin:${admin.sub || 'admin'}` });
    await audit("admin", revoked ? "DEVICE_REVOKE" : "DEVICE_UNREVOKE", `key:${api_key_id}`, { install_id });

    return json(200, { ok: true }, cors);
  }

  return json(405, { error: "Method not allowed" }, cors);
});
