import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest } from "./_lib/http.js";
import { signJwt } from "./_lib/crypto.js";
import { audit } from "./_lib/audit.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) {
    const err = new Error("Missing ADMIN_PASSWORD");
    err.code = "CONFIG";
    err.status = 500;
    err.hint = "Set ADMIN_PASSWORD in Netlify → Site configuration → Environment variables.";
    throw err;
  }

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  const password = (body.password || "").toString();
  if (!password) return badRequest("Missing password", cors);

  if (password !== adminPass) {
    await audit("admin", "ADMIN_LOGIN_FAIL", null, { ip: req.headers.get("x-nf-client-connection-ip") || null });
    return json(401, { error: "Invalid credentials" }, cors);
  }

  await audit("admin", "ADMIN_LOGIN_OK");
  const token = signJwt({ role: "admin" }, 12 * 60 * 60);
  return json(200, { token }, cors);
});
