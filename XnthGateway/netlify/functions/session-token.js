import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { lookupKey } from "./_lib/authz.js";
import { signJwt } from "./_lib/crypto.js";

/**
 * Mint a short-lived user session token.
 * POST /.netlify/functions/session-token
 * Header: Authorization: Bearer <sub_key>
 * Body (optional): { ttl_seconds?: number }
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const token = getBearer(req);
  if (!token) return json(401, { error: "Missing Authorization: Bearer <virtual_key>" }, cors);

  // Only allow minting from a real sub-key (not from a JWT).
  if (token.split(".").length === 3) {
    return json(400, { error: "Provide a sub-key (not a session token) to mint a session token." }, cors);
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    // optional
  }

  const keyRow = await lookupKey(token);
  if (!keyRow) return json(401, { error: "Invalid or revoked key" }, cors);
  if (!keyRow.is_active) return json(403, { error: "Customer disabled" }, cors);

  const ttlDefault = parseInt(process.env.USER_SESSION_TTL_SECONDS || "3600", 10);
  const ttl_seconds = Number.isFinite(body.ttl_seconds) ? Math.max(60, Math.min(86400, parseInt(body.ttl_seconds, 10))) : ttlDefault;

  const session = signJwt({
    type: "user_session",
    api_key_id: keyRow.api_key_id,
    customer_id: keyRow.customer_id,
    key_last4: keyRow.key_last4 || null
  }, ttl_seconds);

  return json(200, { token: session, expires_in: ttl_seconds, key_last4: keyRow.key_last4 || null }, cors);
});
