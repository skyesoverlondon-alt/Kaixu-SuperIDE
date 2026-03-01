import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { audit } from "./_lib/audit.js";
import { normalizePath } from "./_lib/pushPathNormalize.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  requireKeyRole(krow, "deployer");

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  const pushId = (body.pushId || "").toString();
  const sha1 = (body.sha1 || "").toString().toLowerCase();
  const path = (body.path || "").toString();
  const parts = Number.isFinite(body.parts) ? parseInt(body.parts, 10) : null;

  if (!pushId) return badRequest("Missing pushId", cors);
  if (!/^[a-f0-9]{40}$/.test(sha1)) return badRequest("Missing/invalid sha1", cors);
  if (!path) return badRequest("Missing path", cors);
  if (!parts || parts < 1) return badRequest("Missing/invalid parts", cors);

  const deploy_path = normalizePath(path);

  const pres = await q(`select id, customer_id, required_digests, uploaded_digests, file_manifest from push_pushes where push_id=$1 limit 1`, [pushId]);
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
  if (!required.includes(sha1)) return json(409, { error: "File not required by deploy", code: "NOT_REQUIRED", sha1, path: deploy_path }, cors);
  if (Array.isArray(push.uploaded_digests) && push.uploaded_digests.includes(sha1)) {
    return json(200, { ok: true, skipped: true, reason: "already_uploaded", pushId, sha1, path: deploy_path }, cors);
  }

  const jres = await q(`select id, received_parts from push_jobs where push_row_id=$1 and sha1=$2 limit 1`, [push.id, sha1]);
  if (!jres.rowCount) return json(404, { error: "Chunk job not found; upload chunks first", code: "JOB_NOT_FOUND" }, cors);
  const received = jres.rows[0].received_parts || [];
  if (!Array.isArray(received) || received.length < parts) {
    return json(409, { error: "Not all parts uploaded yet", code: "PARTS_INCOMPLETE", expected_parts: parts, received_parts: Array.isArray(received) ? received.length : 0 }, cors);
  }

  await q(
    `update push_jobs set status='queued', parts=$4, deploy_path=$3, error=null, updated_at=now()
     where push_row_id=$1 and sha1=$2`,
    [push.id, sha1, deploy_path, parts]
  );

  const origin = process.env.URL || new URL(req.url).origin;
  const workerSecret = process.env.JOB_WORKER_SECRET;
  if (!workerSecret) return json(500, { error: "Missing JOB_WORKER_SECRET", code: "CONFIG", hint: "Set JOB_WORKER_SECRET in your Netlify environment variables." }, cors);

  await fetch(`${origin}/.netlify/functions/push-uploadfile-background`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "x-kaixu-job-secret": workerSecret
    },
    body: JSON.stringify({ pushId, sha1 })
  });

  await audit(`key:${krow.key_last4}`, "PUSH_FILE_QUEUE", `push:${pushId}`, { sha1, path: deploy_path, parts, mode: "chunked" });

  return json(202, { queued: true, pushId, sha1 }, cors);
});
