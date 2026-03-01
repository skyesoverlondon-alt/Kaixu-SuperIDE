import zlib from "zlib";
import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer, monthKeyUTC } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { audit } from "./_lib/audit.js";
import { getNetlifyTokenForCustomer } from "./_lib/netlifyTokens.js";
import { createDigestDeploy, pollDeployUntil } from "./_lib/pushNetlify.js";
import { enforcePushCap } from "./_lib/pushCaps.js";
import { normalizePath } from "./_lib/pushPathNormalize.js";

function intEnv(name, dflt) {
  const n = parseInt(String(process.env[name] ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

async function enforceNetlifyDeployRate({ customer_id }) {
  const perMin = intEnv("PUSH_NETLIFY_MAX_DEPLOYS_PER_MIN", 3);
  const perDay = intEnv("PUSH_NETLIFY_MAX_DEPLOYS_PER_DAY", 100);

  // Minute bucket
  const minRes = await q(
    `insert into push_rate_windows(customer_id, bucket_type, bucket_start, count)
     values ($1,'min', date_trunc('minute', now()), 1)
     on conflict (customer_id, bucket_type, bucket_start)
     do update set count = push_rate_windows.count + 1
     returning count, bucket_start`,
    [customer_id]
  );
  const minCount = minRes.rows[0]?.count ?? 1;
  if (minCount > perMin) {
    const err = new Error("Netlify deploy rate limit (per minute) exceeded");
    err.code = "PUSH_NETLIFY_RATE_LIMIT";
    err.status = 429;
    err.retry_after = 60;
    err.payload = { code: err.code, scope: "minute", limit: perMin, count: minCount };
    throw err;
  }

  // Day bucket
  const dayRes = await q(
    `insert into push_rate_windows(customer_id, bucket_type, bucket_start, count)
     values ($1,'day', date_trunc('day', now()), 1)
     on conflict (customer_id, bucket_type, bucket_start)
     do update set count = push_rate_windows.count + 1
     returning count, bucket_start`,
    [customer_id]
  );
  const dayCount = dayRes.rows[0]?.count ?? 1;
  if (dayCount > perDay) {
    const err = new Error("Netlify deploy rate limit (per day) exceeded");
    err.code = "PUSH_NETLIFY_RATE_LIMIT";
    err.status = 429;
    err.retry_after = 3600;
    err.payload = { code: err.code, scope: "day", limit: perDay, count: dayCount };
    throw err;
  }
}

function makePushId() {
  return `push_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

async function readJsonMaybeGzip(req) {
  const enc = (req.headers.get("content-encoding") || "").toLowerCase();
  if (enc.includes("gzip")) {
    const ab = await req.arrayBuffer();
    const buf = Buffer.from(ab);
    const raw = zlib.gunzipSync(buf).toString("utf8");
    return JSON.parse(raw);
  }
  return await req.json();
}

function sanitizeManifest(filesObj) {
  const out = {};
  const entries = Object.entries(filesObj || {});
  if (entries.length < 1) {
    const err = new Error("files mapping is empty");
    err.code = "BAD_MANIFEST";
    err.status = 400;
    throw err;
  }
  if (entries.length > 20000) {
    const err = new Error("files mapping too large");
    err.code = "BAD_MANIFEST";
    err.status = 413;
    throw err;
  }

  for (const [pRaw, shaRaw] of entries) {
    const p = normalizePath(pRaw);
    const sha1 = String(shaRaw || "").trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(sha1)) {
      const err = new Error(`Invalid sha1 for ${p}`);
      err.code = "BAD_MANIFEST";
      err.status = 400;
      throw err;
    }
    if (out[p] && out[p] !== sha1) {
      const err = new Error(`Conflicting sha1 for ${p}`);
      err.code = "BAD_MANIFEST";
      err.status = 400;
      throw err;
    }
    out[p] = sha1;
  }
  return out;
}

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
  try {
    body = await readJsonMaybeGzip(req);
  } catch {
    return badRequest("Invalid JSON", cors);
  }

  const project_id = (body.projectId || body.project_id || "").toString().trim();
  const branch = (body.branch || "main").toString().trim().slice(0, 80);
  const title = (body.title || body.message || "KaixuPush deploy").toString().slice(0, 160);
  const rawFiles = body.files || null;

  if (!project_id) return badRequest("Missing projectId", cors);
  if (!rawFiles || typeof rawFiles !== "object") return badRequest("Missing files mapping", cors);

  let files;
  try {
    files = sanitizeManifest(rawFiles);
  } catch (e) {
    return json(e?.status || 400, { error: e?.message || "Bad manifest", code: e?.code || "BAD_MANIFEST" }, cors);
  }

  const proj = await q(
    `select id, project_id, name, netlify_site_id
     from push_projects
     where customer_id=$1 and project_id=$2
     limit 1`,
    [krow.customer_id, project_id]
  );
  if (!proj.rowCount) return json(404, { error: "Project not found for this customer" }, cors);

  // Push spend cap enforcement (indisputable billing)
  const month = monthKeyUTC();
  let capInfo = null;
  try {
    capInfo = await enforcePushCap({ customer_id: krow.customer_id, month, extra_deploys: 1, extra_bytes: 0 });
  } catch (e) {
    if (e?.code === "PUSH_CAP_REACHED") return json(402, e.payload || { error: e.message, code: e.code }, cors);
    throw e;
  }

  const netlify_token = await getNetlifyTokenForCustomer(krow.customer_id);

  // Proactive Netlify API rate limiting to avoid 429s and plan-limit pain.
  try {
    await enforceNetlifyDeployRate({ customer_id: krow.customer_id });
  } catch (e) {
    if (e?.status === 429) {
      return json(
        429,
        e.payload || { error: e.message, code: e.code },
        { ...cors, "retry-after": String(e.retry_after || 60) }
      );
    }
    throw e;
  }

  const push_id = makePushId();

  const deploy = await createDigestDeploy({
    site_id: proj.rows[0].netlify_site_id,
    branch,
    title: `${title} (${push_id})`,
    files,
    netlify_token
  });

  const deploy_id = deploy?.id;
  if (!deploy_id) return json(502, { error: "Netlify deploy creation failed" }, cors);

  const finalDeploy = await pollDeployUntil({
    site_id: proj.rows[0].netlify_site_id,
    deploy_id,
    timeout_ms: 60000,
    netlify_token
  });

  const required = Array.isArray(finalDeploy?.required) ? finalDeploy.required : [];
  const state = finalDeploy?.state || deploy?.state || "unknown";
  const url = finalDeploy?.ssl_url || finalDeploy?.url || null;

  const ins = await q(
    `insert into push_pushes(customer_id, api_key_id, project_row_id, push_id, branch, title, deploy_id, state, required_digests, uploaded_digests, file_manifest, url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
     returning id`,
    [
      krow.customer_id,
      krow.api_key_id,
      proj.rows[0].id,
      push_id,
      branch,
      title,
      deploy_id,
      state,
      required,
      [],
      JSON.stringify(files),
      url
    ]
  );

  await q(
    `insert into push_usage_events(customer_id, api_key_id, push_row_id, event_type, bytes, pricing_version, cost_cents, meta)
     values ($1,$2,$3,'deploy_init',0,$5,0,$4::jsonb)`,
    [
      krow.customer_id,
      krow.api_key_id,
      ins.rows[0].id,
      JSON.stringify({ project_id, branch, required_count: required.length, file_count: Object.keys(files).length }),
      (capInfo?.cfg?.pricing_version ?? 1)
    ]
  );

  await audit(`key:${krow.key_last4}`, "PUSH_INIT", `push:${push_id}`, {
    customer_id: krow.customer_id,
    api_key_id: krow.api_key_id,
    project_id,
    branch,
    deploy_id,
    required_count: required.length
  });

  return json(200, { pushId: push_id, deployId: deploy_id, state, required, url }, cors);
});
