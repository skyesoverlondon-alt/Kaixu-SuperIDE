import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);

  if (req.method === "GET") {
    const r = await q(`select * from voice_numbers order by id desc limit 500`);
    return json(200, { voice_numbers: r.rows }, cors);
  }

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  if (req.method === "POST") {
    const customer_id = parseInt(body.customer_id, 10);
    const phone_number = (body.phone_number || "").toString().trim();
    if (!Number.isFinite(customer_id) || customer_id <= 0) return badRequest("Missing customer_id", cors);
    if (!phone_number) return badRequest("Missing phone_number (E.164)", cors);

    const playbook = body.playbook || {};
    const r = await q(
      `insert into voice_numbers (customer_id, phone_number, provider, twilio_sid, is_active,
        default_llm_provider, default_llm_model, voice_name, locale, timezone, playbook)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       returning *`,
      [
        customer_id,
        phone_number,
        (body.provider || "twilio").toString(),
        body.twilio_sid || null,
        body.is_active !== false,
        (body.default_llm_provider || "openai").toString(),
        (body.default_llm_model || "gpt-4.1-mini").toString(),
        (body.voice_name || "alloy").toString(),
        (body.locale || "en-US").toString(),
        (body.timezone || "America/Phoenix").toString(),
        JSON.stringify(playbook)
      ]
    );
    return json(201, { voice_number: r.rows[0] }, cors);
  }

  if (req.method === "PATCH") {
    const id = parseInt(body.id, 10);
    if (!Number.isFinite(id) || id <= 0) return badRequest("Missing id", cors);

    const fields = [];
    const params = [];
    let p = 1;

    function set(k, v, cast = "") {
      fields.push(`${k} = $${p++}${cast}`);
      params.push(v);
    }

    if (body.customer_id != null) set("customer_id", parseInt(body.customer_id, 10));
    if (body.phone_number != null) set("phone_number", (body.phone_number || "").toString().trim());
    if (body.provider != null) set("provider", (body.provider || "twilio").toString());
    if (body.twilio_sid !== undefined) set("twilio_sid", body.twilio_sid || null);
    if (body.is_active != null) set("is_active", !!body.is_active);
    if (body.default_llm_provider != null) set("default_llm_provider", (body.default_llm_provider || "openai").toString());
    if (body.default_llm_model != null) set("default_llm_model", (body.default_llm_model || "gpt-4.1-mini").toString());
    if (body.voice_name != null) set("voice_name", (body.voice_name || "alloy").toString());
    if (body.locale != null) set("locale", (body.locale || "en-US").toString());
    if (body.timezone != null) set("timezone", (body.timezone || "America/Phoenix").toString());
    if (body.playbook != null) set("playbook", JSON.stringify(body.playbook || {}), "::jsonb");

    if (!fields.length) return badRequest("No fields to update", cors);

    params.push(id);
    const r = await q(`update voice_numbers set ${fields.join(", ")} where id = $${p} returning *`, params);
    return json(200, { voice_number: r.rows[0] }, cors);
  }

  if (req.method === "DELETE") {
    const id = parseInt(body.id, 10);
    if (!Number.isFinite(id) || id <= 0) return badRequest("Missing id", cors);
    await q(`delete from voice_numbers where id=$1`, [id]);
    return json(200, { ok: true }, cors);
  }

  return json(405, { error: "Method not allowed" }, cors);
});
