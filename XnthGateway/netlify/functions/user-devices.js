import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { resolveAuth } from "./_lib/authz.js";
import { listDevicesForKey, setDeviceRevoked } from "./_lib/devices.js";
import { audit } from "./_lib/audit.js";

/**
 * User device management for the current key.
 * GET   /.netlify/functions/user-devices
 * PATCH /.netlify/functions/user-devices  { install_id, revoked: true|false }
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const token = getBearer(req);
  if (!token) return json(401, { error: "Missing Authorization" }, cors);

  const keyRow = await resolveAuth(token);
  if (!keyRow) return json(401, { error: "Invalid or revoked key" }, cors);

  if (req.method === "GET") {
    const devices = await listDevicesForKey(keyRow.api_key_id, 200);
    return json(200, { api_key_id: keyRow.api_key_id, devices }, cors);
  }

  if (req.method === "PATCH") {
    let body;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

    const install_id = (body.install_id || "").toString().trim();
    if (!install_id) return badRequest("Missing install_id", cors);

    const revoked = body.revoked === true;
    await setDeviceRevoked({ api_key_id: keyRow.api_key_id, install_id, revoked, actor: `user:key${keyRow.key_last4}` });

    await audit("user", revoked ? "DEVICE_REVOKE" : "DEVICE_UNREVOKE", `key:${keyRow.api_key_id}`, { install_id });

    const devices = await listDevicesForKey(keyRow.api_key_id, 200);
    return json(200, { ok: true, devices }, cors);
  }

  return json(405, { error: "Method not allowed" }, cors);
});
