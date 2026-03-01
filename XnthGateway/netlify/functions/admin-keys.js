import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";
import { randomKey, keyHashHex, encryptSecret, decryptSecret } from "./_lib/crypto.js";
import { audit } from "./_lib/audit.js";

function parseProviders(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(String).map(s=>s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map(s=>s.trim()).filter(Boolean);
  return null;
}

function parseModels(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  }
  return null;
}

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);

  const url = new URL(req.url);
  const customer_id = url.searchParams.get("customer_id") ? parseInt(url.searchParams.get("customer_id"), 10) : null;

  if (req.method === "GET") {
    // --- Reveal a single key (admin only) ---
    const reveal_key_id = url.searchParams.get("reveal_key_id") ? parseInt(url.searchParams.get("reveal_key_id"), 10) : null;
    if (reveal_key_id) {
      const row = await q(
        `select id, key_last4, label, encrypted_key, revoked_at from api_keys where id=$1 limit 1`,
        [reveal_key_id]
      );
      if (!row.rowCount) return json(404, { error: "Key not found" }, cors);
      const k = row.rows[0];
      if (!k.encrypted_key) return json(409, { error: "Key was created before vault storage was enabled. Rotate the key to generate a new one that can be retrieved." }, cors);
      let plainKey;
      try { plainKey = decryptSecret(k.encrypted_key); } catch { return json(500, { error: "Decryption failed — check DB_ENCRYPTION_KEY / JWT_SECRET env var" }, cors); }
      if (!plainKey) return json(500, { error: "Decryption returned empty — encryption key mismatch" }, cors);

      await audit("admin", "KEY_REVEAL", `key:${reveal_key_id}`);
      return json(200, { id: k.id, key_last4: k.key_last4, label: k.label, key: plainKey }, cors);
    }

    // --- List all keys for a customer ---
    if (!customer_id) return badRequest("Missing customer_id", cors);
    const res = await q(
      `select id, key_last4, label, role, monthly_cap_cents, rpm_limit, rpd_limit,
              max_devices, require_install_id, allowed_providers, allowed_models,
              created_at, revoked_at,
              (encrypted_key is not null) as can_reveal
       from api_keys
       where customer_id=$1
       order by created_at desc
       limit 200`,
      [customer_id]
    );
    return json(200, { keys: res.rows }, cors);
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

    const cid = Number.isFinite(body.customer_id) ? parseInt(body.customer_id, 10) : customer_id;
    if (!cid) return badRequest("Missing customer_id", cors);

    const cres = await q(`select id from customers where id=$1 limit 1`, [cid]);
    if (!cres.rowCount) return json(404, { error: "Customer not found", customer_id: cid }, cors);

    const label = (body.label || "subkey").toString().slice(0, 60);
    const role = (body.role || "deployer").toString().toLowerCase();
    const allowedRoles = new Set(["viewer","deployer","admin","owner"]);
    if (!allowedRoles.has(role)) return badRequest("Invalid role (viewer|deployer|admin|owner)", cors);
    const monthly_cap_cents = body.monthly_cap_cents === null || body.monthly_cap_cents === undefined ? null : parseInt(body.monthly_cap_cents, 10);
    const rpm_limit = body.rpm_limit === null || body.rpm_limit === undefined ? null : parseInt(body.rpm_limit, 10);
    const rpd_limit = body.rpd_limit === null || body.rpd_limit === undefined ? null : parseInt(body.rpd_limit, 10);

    const max_devices = body.max_devices === null || body.max_devices === undefined ? null : parseInt(body.max_devices, 10);
    const require_install_id = Object.prototype.hasOwnProperty.call(body, "require_install_id") ? !!body.require_install_id : null;
    const allowed_providers = parseProviders(body.allowed_providers);
    const allowed_models = parseModels(body.allowed_models);

    const key = randomKey("kx_live_");
    const key_hash = keyHashHex(key);
    const key_last4 = key.slice(-4);
    const encrypted_key = encryptSecret(key);

    const ins = await q(
      `insert into api_keys(customer_id, key_hash, key_last4, label, role, monthly_cap_cents, rpm_limit, rpd_limit,
                           max_devices, require_install_id, allowed_providers, allowed_models, encrypted_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning id, created_at`,
      [cid, key_hash, key_last4, label, role, monthly_cap_cents, rpm_limit, rpd_limit,
       Number.isFinite(max_devices) ? max_devices : null,
       require_install_id,
       allowed_providers,
       allowed_models,
       encrypted_key]
    );

    await audit("admin", "KEY_CREATE", `key:${ins.rows[0].id}`,
      { customer_id: cid, label, role, monthly_cap_cents, rpm_limit, rpd_limit, max_devices, require_install_id, allowed_providers, allowed_models });

    return json(200, { api_key: { id: ins.rows[0].id, key_last4, label, created_at: ins.rows[0].created_at, key } }, cors);
  }

  if (req.method === "DELETE") {
    const key_id = url.searchParams.get("key_id") ? parseInt(url.searchParams.get("key_id"), 10) : null;
    if (!key_id) return badRequest("Missing key_id", cors);
    await q(`update api_keys set revoked_at=now() where id=$1 and revoked_at is null`, [key_id]);
    await audit("admin", "KEY_REVOKE", `key:${key_id}`);
    return json(200, { ok: true }, cors);
  }

  if (req.method === "PATCH") {
    const key_id = url.searchParams.get("key_id") ? parseInt(url.searchParams.get("key_id"), 10) : null;
    if (!key_id) return badRequest("Missing key_id", cors);

    let body;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

    // Revocation toggle
    if (Object.prototype.hasOwnProperty.call(body, "revoked")) {
      if (typeof body.revoked !== "boolean") return badRequest("'revoked' must be boolean", cors);
      if (body.revoked) {
        await q(`update api_keys set revoked_at=now() where id=$1 and revoked_at is null`, [key_id]);
        await audit("admin", "KEY_REVOKE", `key:${key_id}`);
      } else {
        await q(`update api_keys set revoked_at=null where id=$1 and revoked_at is not null`, [key_id]);
        await audit("admin", "KEY_UNREVOKE", `key:${key_id}`);
      }
    }

    const updates = [];
    const params = [];
    let p = 1;

    if (Object.prototype.hasOwnProperty.call(body, "label")) {
      updates.push(`label=$${p++}`);
      params.push((body.label || "").toString().slice(0, 60) || null);
    }
    if (Object.prototype.hasOwnProperty.call(body, "monthly_cap_cents")) {
      updates.push(`monthly_cap_cents=$${p++}`);
      params.push(body.monthly_cap_cents === null ? null : parseInt(body.monthly_cap_cents, 10));
    }
    if (Object.prototype.hasOwnProperty.call(body, "rpm_limit")) {
      updates.push(`rpm_limit=$${p++}`);
      params.push(body.rpm_limit === null ? null : parseInt(body.rpm_limit, 10));
    }
    if (Object.prototype.hasOwnProperty.call(body, "rpd_limit")) {
      updates.push(`rpd_limit=$${p++}`);
      params.push(body.rpd_limit === null ? null : parseInt(body.rpd_limit, 10));
    }

    if (Object.prototype.hasOwnProperty.call(body, "max_devices")) {
      updates.push(`max_devices=$${p++}`);
      params.push(body.max_devices === null ? null : parseInt(body.max_devices, 10));
    }
    if (Object.prototype.hasOwnProperty.call(body, "require_install_id")) {
      updates.push(`require_install_id=$${p++}`);
      params.push(body.require_install_id === null ? null : !!body.require_install_id);
    }
    if (Object.prototype.hasOwnProperty.call(body, "allowed_providers")) {
      updates.push(`allowed_providers=$${p++}`);
      params.push(parseProviders(body.allowed_providers));
    }
    if (Object.prototype.hasOwnProperty.call(body, "allowed_models")) {
      updates.push(`allowed_models=$${p++}`);
      params.push(parseModels(body.allowed_models));
    }

    if (updates.length) {
      params.push(key_id);
      await q(`update api_keys set ${updates.join(", ")} where id=$${p}`, params);
      await audit("admin", "KEY_UPDATE", `key:${key_id}`, { fields: Object.keys(body || {}) });
    }

    const out = await q(
      `select id, key_last4, label, role, monthly_cap_cents, rpm_limit, rpd_limit,
              max_devices, require_install_id, allowed_providers, allowed_models,
              created_at, revoked_at
       from api_keys where id=$1`,
      [key_id]
    );

    return json(200, { ok: true, key: out.rowCount ? out.rows[0] : null }, cors);
  }

  if (req.method === "PUT") {
    const rotate_key_id = url.searchParams.get("rotate_key_id") ? parseInt(url.searchParams.get("rotate_key_id"), 10) : null;
    if (!rotate_key_id) return badRequest("Missing rotate_key_id", cors);

    const old = await q(
      `select customer_id, label, role, monthly_cap_cents, rpm_limit, rpd_limit,
              max_devices, require_install_id, allowed_providers, allowed_models
       from api_keys where id=$1`,
      [rotate_key_id]
    );
    if (old.rowCount === 0) return json(404, { error: "Key not found" }, cors);

    const o = old.rows[0];
    const key = randomKey("kx_live_");
    const key_hash = keyHashHex(key);
    const key_last4 = key.slice(-4);
    const encrypted_key = encryptSecret(key);

    const ins = await q(
      `insert into api_keys(customer_id, key_hash, key_last4, label, role, monthly_cap_cents, rpm_limit, rpd_limit,
                           max_devices, require_install_id, allowed_providers, allowed_models, encrypted_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning id, created_at`,
      [o.customer_id, key_hash, key_last4, o.label, (o.role || 'deployer'), o.monthly_cap_cents, o.rpm_limit, o.rpd_limit,
       o.max_devices, o.require_install_id, o.allowed_providers, o.allowed_models, encrypted_key]
    );

    await q(`update api_keys set revoked_at=now() where id=$1 and revoked_at is null`, [rotate_key_id]);
    await audit("admin", "KEY_ROTATE", `key:${rotate_key_id}`, { new_key_id: ins.rows[0].id });

    return json(200, {
      rotated: true,
      old_key_id: rotate_key_id,
      new_key: { id: ins.rows[0].id, key_last4, label: o.label, created_at: ins.rows[0].created_at, key }
    }, cors);
  }

  return json(405, { error: "Method not allowed" }, cors);
});