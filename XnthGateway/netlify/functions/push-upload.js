import crypto from "crypto";
import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer, monthKeyUTC } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { audit } from "./_lib/audit.js";
import { getNetlifyTokenForCustomer } from "./_lib/netlifyTokens.js";
import { putDeployFile } from "./_lib/pushNetlify.js";
import { normalizePath } from "./_lib/pushPathNormalize.js";
import { enforcePushCap } from "./_lib/pushCaps.js";

function sha1Hex(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "PUT") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  requireKeyRole(krow, "deployer");

  const netlify_token = await getNetlifyTokenForCustomer(krow.customer_id);

  const url = new URL(req.url);
  const pushId = (url.searchParams.get("pushId") || "").toString();
  const path = (url.searchParams.get("path") || "").toString();

  if (!pushId) return badRequest("Missing pushId", cors);
  if (!path) return badRequest("Missing path", cors);

  const deploy_path = normalizePath(path);

  const sha1Header = (req.headers.get("x-content-sha1") || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sha1Header)) return badRequest("Missing/invalid X-Content-Sha1", cors);

  const pres = await q(
    `select id, customer_id, api_key_id, deploy_id, required_digests, uploaded_digests, file_manifest
     from push_pushes where push_id=$1 limit 1`,
    [pushId]
  );
  if (!pres.rowCount) return json(404, { error: "Push not found" }, cors);
  const push = pres.rows[0];
  if (push.customer_id !== krow.customer_id) return json(403, { error: "Forbidden" }, cors);

  const ab = await req.arrayBuffer();
  const buf = Buffer.from(ab);
  const computed = sha1Hex(buf);

  if (computed !== sha1Header) {
    return json(400, { error: "SHA1 mismatch", expected: sha1Header, got: computed }, cors);
  }

  let manifest = push.file_manifest;
  if (typeof manifest === "string") {
    try { manifest = JSON.parse(manifest); } catch { manifest = {}; }
  }
  if (!manifest || typeof manifest !== "object") manifest = {};
  const expected = manifest[deploy_path] || null;
  if (!expected) {
    return json(409, { error: "Path not in manifest for this push", code: "PATH_NOT_IN_MANIFEST", path: deploy_path }, cors);
  }
  if (expected !== sha1Header) {
    return json(409, { error: "SHA1 does not match manifest for path", code: "SHA1_NOT_MATCHING_MANIFEST", path: deploy_path, expected, got: sha1Header }, cors);
  }
  const required = Array.isArray(push.required_digests) ? push.required_digests : [];
  if (!required.includes(sha1Header)) {
    return json(409, { error: "File not required by deploy (digest not in required list)", code: "NOT_REQUIRED", sha1: sha1Header, path: deploy_path }, cors);
  }
  if (Array.isArray(push.uploaded_digests) && push.uploaded_digests.includes(sha1Header)) {
    return json(200, { ok: true, skipped: true, reason: "already_uploaded", pushId, path: deploy_path, sha1: sha1Header }, cors);
  }

  const month = monthKeyUTC();
  let capInfo = null;
  try {
    capInfo = await enforcePushCap({ customer_id: krow.customer_id, month, extra_deploys: 0, extra_bytes: buf.length });
  } catch (e) {
    if (e?.code === "PUSH_CAP_REACHED") return json(402, e.payload || { error: e.message, code: e.code }, cors);
    throw e;
  }

  await putDeployFile({ deploy_id: push.deploy_id, deploy_path, body: buf, netlify_token });

  // record file
  await q(
    `insert into push_files(push_row_id, deploy_path, sha1, bytes, mode) values ($1,$2,$3,$4,'direct')`,
    [push.id, deploy_path, computed, buf.length]
  );

  // usage event
  await q(
    `insert into push_usage_events(customer_id, api_key_id, push_row_id, event_type, bytes, pricing_version, cost_cents, meta)
     values ($1,$2,$3,'file_upload',$4,$6,0,$5::jsonb)`,
    [krow.customer_id, krow.api_key_id, push.id, buf.length, JSON.stringify({ sha1: computed, path: deploy_path, mode: "direct" }), (capInfo?.cfg?.pricing_version ?? 1)]
  );

  // append digest if not present
  await q(
    `update push_pushes
     set uploaded_digests = case when not (uploaded_digests @> array[$2]) then array_append(uploaded_digests, $2) else uploaded_digests end,
         updated_at = now()
     where id=$1`,
    [push.id, computed]
  );

  await audit(`key:${krow.key_last4}`, "PUSH_FILE_UPLOAD", `push:${pushId}`, { sha1: computed, path: deploy_path, bytes: buf.length, mode: "direct" });

  return json(200, { ok: true, pushId, path: deploy_path, sha1: computed, bytes: buf.length }, cors);
});