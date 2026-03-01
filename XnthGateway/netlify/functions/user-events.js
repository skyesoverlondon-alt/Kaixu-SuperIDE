import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer, monthKeyUTC } from "./_lib/http.js";
import { resolveAuth } from "./_lib/authz.js";
import { q } from "./_lib/db.js";

/**
 * User-facing logs endpoint (scoped to the current key).
 * GET /.netlify/functions/user-events?month=YYYY-MM&limit=200
 * Header: Authorization: Bearer <virtual_key>
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization: Bearer <virtual_key>" }, cors);

  const keyRow = await resolveAuth(key);
  if (!keyRow) return json(401, { error: "Invalid or revoked key" }, cors);
  if (!keyRow.is_active) return json(403, { error: "Customer disabled" }, cors);

  const url = new URL(req.url);
  const month = (url.searchParams.get("month") || monthKeyUTC()).toString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest("Invalid month format. Use YYYY-MM.", cors);

  const limitRaw = url.searchParams.get("limit") || "200";
  const limit = Math.max(1, Math.min(500, parseInt(limitRaw, 10) || 200));

  const events = await q(
    `select id, provider, model, input_tokens, output_tokens, cost_cents, install_id, created_at
     from usage_events
     where api_key_id=$1 and to_char(created_at at time zone 'UTC','YYYY-MM')=$2
     order by created_at desc
     limit ${limit}`,
    [keyRow.api_key_id, month]
  );

  const agg = await q(
    `select provider,
            count(*)::int as calls,
            coalesce(sum(cost_cents),0)::int as cost_cents,
            coalesce(sum(input_tokens),0)::int as input_tokens,
            coalesce(sum(output_tokens),0)::int as output_tokens
     from usage_events
     where api_key_id=$1 and to_char(created_at at time zone 'UTC','YYYY-MM')=$2
     group by provider
     order by cost_cents desc`,
    [keyRow.api_key_id, month]
  );

  return json(200, {
    month,
    key: { id: keyRow.api_key_id, label: keyRow.label || null, key_last4: keyRow.key_last4 || null },
    summary_by_provider: agg.rows,
    events: events.rows
  }, cors);
});
