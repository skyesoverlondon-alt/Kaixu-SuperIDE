import { wrap } from "./_lib/wrap.js";
import { buildCors, json } from "./_lib/http.js";
import { getBearer } from "./_lib/http.js";
import { resolveAuth } from "./_lib/authz.js";
import { q } from "./_lib/db.js";
import { voiceMarkupPct, voiceRateDollarsPerMinute } from "./_lib/voice_pricing.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const token = getBearer(req);
  if (!token) return json(401, { error: "Missing Authorization: Bearer <virtual_key>" }, cors);

  const keyRow = await resolveAuth(token);
  if (!keyRow) return json(401, { error: "Invalid or revoked key" }, cors);

  const nums = await q(`select id, phone_number, provider, is_active, default_llm_provider, default_llm_model, locale, timezone, playbook
                         from voice_numbers where customer_id=$1 order by id desc`, [keyRow.customer_id]);

  return json(200, {
    voice: {
      numbers: nums.rows,
      pricing: {
        markup_pct: voiceMarkupPct(),
        usd_per_minute_est: voiceRateDollarsPerMinute()
      }
    }
  }, cors);
});
