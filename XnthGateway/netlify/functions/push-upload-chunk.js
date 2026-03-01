import crypto from "crypto";
import { getStore } from "@netlify/blobs";
import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer, monthKeyUTC } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { normalizePath } from "./_lib/pushPathNormalize.js";
import { enforcePushCap } from "./_lib/pushCaps.js";

function sha1Hex(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

function chunkStore() {
  return getStore({ name: "kaixu_push_chunks", consistency: "strong" });
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

  const url = new URL(req.url);
  const pushId = (url.searchParams.get("pushId") || "").toString();
  const path = (url.searchParams.get("path") || "").toString();
  const sha1 = (url.searchParams.get("sha1") || "").toLowerCase();
  const part = parseInt(url.searchParams.get("part") || "", 10);
  const parts = parseInt(url.searchParams.get("parts") || "", 10);

  if (!pushId) return badRequest("Missing pushId", cors);
  if (!path) return badRequest("Missing path", cors);
  if (!/^[a-f0-9]{40}$/.test(sha1)) return badRequest("Missing/invalid sha1", cors);
  if (!Number.isFinite(part) || part < 0) return badRequest("Invalid part", cors);
  if (!Number.isFinite(parts) || parts < 1) return badRequest("Invalid parts", cors);
  if (part >= parts) return badRequest("part must be < parts", cors);

  const deploy_path = normalizePath(path);

  const pres = await q(
    `select id, customer_id, required_digests, uploaded_digests, file_manifest
     from push_pushes where push_id=$1 limit 1`,
    [pushId]
  );
  if (!pres.rowCount) return json(404, { error: "Push not found" }, cors);
  const push = pres.rows[0];
  if (push.customer_id !== krow.customer_id) return json(403, { error: "Forbidden" }, cors);

  let manifest = push.file_manifest;
  if (typeof manifest === "string") {
    try { manifest = JSON.parse(manifest); } catch { manifest = {}; }
  }
  if (!manifest || typeof manifest !== "object") manifest = {};
  const expected = manifest[deploy_path] || null;
  if (!expected) return json(409, { error: "Path not in manifest for this push", code: "PATH_NOT_IN_MANIFEST", path: deploy_path }, cors);
  if (expected !== sha1) return json(409, { error: "SHA1 does not match manifest for path", code: "SHA1_NOT_MATCHING_MANIFEST", path: deploy_path, expected, got: sha1 }, cors);

  const required = Array.isArray(push.required_digests) ? push.required_digests : [];
  if (!required.includes(sha1)) {
    return json(409, { error: "File not required by deploy (digest not in required list)", code: "NOT_REQUIRED", sha1, path: deploy_path }, cors);
  }
  if (Array.isArray(push.uploaded_digests) && push.uploaded_digests.includes(sha1)) {
    return json(200, { ok: true, skipped: true, reason: "already_uploaded", pushId, sha1, path: deploy_path }, cors);
  }

  const ab = await req.arrayBuffer();
  const buf = Buffer.from(ab);
  const chunk_sha1 = sha1Hex(buf);

  // Determine delta bytes (idempotent cap enforcement on retries)
  const existing = await q(
    `select id, received_parts, part_bytes
     from push_jobs where push_row_id=$1 and sha1=$2 limit 1`,
    [push.id, sha1]
  );
  const keyPart = String(part);
  let oldSize = 0;
  if (existing.rowCount) {
    const pb = (existing.rows[0].part_bytes && typeof existing.rows[0].part_bytes === "object") ? existing.rows[0].part_bytes : {};
    oldSize = Number(pb[keyPart] || 0);
  }
  const delta = Math.max(0, buf.length - oldSize);

  const month = monthKeyUTC();
  try {
    await enforcePushCap({ customer_id: krow.customer_id, month, extra_deploys: 0, extra_bytes: delta });
  } catch (e) {
    if (e?.code === "PUSH_CAP_REACHED") return json(402, e.payload || { error: e.message, code: e.code }, cors);
    throw e;
  }

  // Persist chunk in Netlify Blobs
  await chunkStore().set(`chunks/${pushId}/${sha1}/${part}`, buf, {
    metadata: { pushId, sha1, part, parts, deploy_path, bytes: buf.length, chunk_sha1 }
  });

  // Upsert push_jobs row with idempotent staged bytes
  if (!existing.rowCount) {
    await q(
      `insert into push_jobs(push_row_id, sha1, deploy_path, parts, received_parts, part_bytes, bytes_staged, status)
       values ($1,$2,$3,$4,$5,$6,$7,'uploading')`,
      [push.id, sha1, deploy_path, parts, [part], JSON.stringify({ [keyPart]: buf.length }), buf.length]
    );
  } else {
    const cur = existing.rows[0].received_parts || [];
    const set = new Set(cur);
    set.add(part);
    const arr = Array.from(set).sort((a, b) => a - b);

    const pb = (existing.rows[0].part_bytes && typeof existing.rows[0].part_bytes === "object") ? existing.rows[0].part_bytes : {};
    pb[keyPart] = buf.length;

    let staged = 0;
    for (const k of Object.keys(pb)) staged += Number(pb[k] || 0);

    await q(
      `update push_jobs
       set deploy_path=$2, parts=$3, received_parts=$4, part_bytes=$5::jsonb, bytes_staged=$6, updated_at=now()
       where id=$1`,
      [existing.rows[0].id, deploy_path, parts, arr, JSON.stringify(pb), staged]
    );
  }

  return json(200, { ok: true, pushId, sha1, part, parts, bytes: buf.length }, cors);
});
