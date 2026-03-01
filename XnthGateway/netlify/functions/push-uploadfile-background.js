import { getStore } from "@netlify/blobs";
import { q } from "./_lib/db.js";
import { getBearer, monthKeyUTC, sleep } from "./_lib/http.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { normalizePath } from "./_lib/pushPathNormalize.js";
import { encodeURIComponentSafePath } from "./_lib/pushPath.js";
import { audit } from "./_lib/audit.js";
import { getNetlifyTokenForCustomer } from "./_lib/netlifyTokens.js";
import { enforcePushCap } from "./_lib/pushCaps.js";

const API = "https://api.netlify.com/api/v1";

function intEnv(name, dflt) {
  const n = parseInt(String(process.env[name] ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function retryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function jitter(ms) {
  return ms + Math.floor(Math.random() * 200);
}

function parseRetryAfterMs(res) {
  const ra = res.headers.get("retry-after");
  if (!ra) return 0;
  const sec = parseInt(ra, 10);
  if (Number.isFinite(sec) && sec >= 0) return Math.min(60000, sec * 1000);
  return 0;
}

function chunkStore() {
  return getStore({ name: "kaixu_push_chunks", consistency: "strong" });
}

async function putDeployFileStream({ deploy_id, deploy_path, bodyStream, netlify_token }) {
  const encoded = encodeURIComponentSafePath(deploy_path);
  const url = `${API}/deploys/${encodeURIComponent(deploy_id)}/files/${encoded}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${netlify_token}`,
      "content-type": "application/octet-stream"
    },
    body: bodyStream,
    duplex: "half"
  });

  if (res.ok) return { ok: true, status: res.status };
  const text = await res.text().catch(() => "");
  return { ok: false, status: res.status, retryAfterMs: parseRetryAfterMs(res), detail: text };
}

/**
 * Background worker that assembles staged chunks from Netlify Blobs and uploads to Netlify.
 *
 * V4 Reliability:
 * - Retries streaming PUT by RECONSTRUCTING a fresh ReadableStream each attempt (no stream replay).
 * - Marks transient failures as retry_wait with next_attempt_at so a scheduler can requeue.
 * - Accepts internal secret-only invocation (no Bearer) for scheduled requeue.
 */
export default async (req) => {
  try {
    const secret = process.env.JOB_WORKER_SECRET;
    if (!secret) {
      try {
        await q(
          `insert into gateway_events(level, function_name, message, meta)
           values ('warn',$1,$2,'{}'::jsonb)`,
          ["push-uploadfile-background", "JOB_WORKER_SECRET not set; background worker refused"]
        );
      } catch {}
      return new Response("", { status: 202 });
    }
    const got = (req.headers.get("x-kaixu-job-secret") || req.headers.get("x-job-worker-secret") || "");
    if (got !== secret) return new Response("", { status: 202 });

    if (req.method !== "POST") return new Response("", { status: 202 });

    const body = await req.json().catch(() => ({}));
    const pushId = (body.pushId || "").toString();
    const sha1 = (body.sha1 || "").toString().toLowerCase();
    if (!pushId || !/^[a-f0-9]{40}$/.test(sha1)) return new Response("", { status: 202 });

    // Optional: if a Bearer key is present, validate it. If absent, allow secret-only system invocation.
    let actor = "system";
    let krow = null;
    const key = getBearer(req);
    if (key) {
      const tmp = await lookupKey(key);
      if (!tmp) return new Response("", { status: 202 });
      requireKeyRole(tmp, "deployer");
      krow = tmp;
      actor = `key:${krow.key_last4}`;
    }

    const pres = await q(
      `select id, customer_id, api_key_id, deploy_id, uploaded_digests, required_digests, file_manifest
       from push_pushes where push_id=$1 limit 1`,
      [pushId]
    );
    if (!pres.rowCount) return new Response("", { status: 202 });
    const push = pres.rows[0];

    // If invoked with a Bearer key, enforce tenant match.
    if (krow && push.customer_id !== krow.customer_id) return new Response("", { status: 202 });

    // Resolve actor key_last4 if system invocation.
    if (!krow) {
      const ak = await q(`select key_last4 from api_keys where id=$1 limit 1`, [push.api_key_id]);
      const last4 = ak.rowCount ? ak.rows[0].key_last4 : "sys";
      actor = `key:${last4}`;
    }

    // Skip if already uploaded
    if (Array.isArray(push.uploaded_digests) && push.uploaded_digests.includes(sha1)) return new Response("", { status: 202 });

    const jres = await q(
      `select id, deploy_path, parts, received_parts, part_bytes, bytes_staged, status, attempts
       from push_jobs where push_row_id=$1 and sha1=$2 limit 1`,
      [push.id, sha1]
    );
    if (!jres.rowCount) return new Response("", { status: 202 });
    const job = jres.rows[0];

    // Manifest enforcement
    let manifest = push.file_manifest;
    if (typeof manifest === "string") {
      try { manifest = JSON.parse(manifest); } catch { manifest = {}; }
    }
    if (!manifest || typeof manifest !== "object") manifest = {};
    const expected = manifest[job.deploy_path] || null;
    if (!expected) {
      await q(`update push_jobs set status='error', error=$2, last_error=$2, last_error_at=now(), updated_at=now() where id=$1`, [job.id, "Path not in manifest"]);
      return new Response("", { status: 202 });
    }
    if (expected !== sha1) {
      await q(`update push_jobs set status='error', error=$2, last_error=$2, last_error_at=now(), updated_at=now() where id=$1`, [job.id, "SHA1 does not match manifest for path"]);
      return new Response("", { status: 202 });
    }
    const required = Array.isArray(push.required_digests) ? push.required_digests : [];
    if (!required.includes(sha1)) {
      await q(`update push_jobs set status='error', error=$2, last_error=$2, last_error_at=now(), updated_at=now() where id=$1`, [job.id, "Digest not required by deploy"]);
      return new Response("", { status: 202 });
    }

    const parts = parseInt(job.parts, 10);
    const received = new Set(job.received_parts || []);
    for (let i = 0; i < parts; i++) {
      if (!received.has(i)) {
        await q(`update push_jobs set status='error', error=$2, last_error=$2, last_error_at=now(), updated_at=now() where id=$1`, [job.id, `Missing chunk part ${i}/${parts}`]);
        return new Response("", { status: 202 });
      }
    }

    // Cap enforcement (bytes staged are already counted in enforcePushCap via push_jobs bytes_staged)
    const month = monthKeyUTC();
    let capInfo = null;
    try {
      capInfo = await enforcePushCap({ customer_id: push.customer_id, month, extra_deploys: 0, extra_bytes: 0 });
    } catch (e) {
      if (e?.code === "PUSH_CAP_REACHED") {
        await q(`update push_jobs set status='blocked_cap', error=$2, last_error=$2, last_error_at=now(), updated_at=now() where id=$1`,
          [job.id, JSON.stringify(e.payload || { error: e.message, code: e.code }).slice(0, 1200)]
        );
        return new Response("", { status: 202 });
      }
      throw e;
    }

    // Mark assembling and increment attempts for this worker run
    const maxAttempts = intEnv("PUSH_JOB_MAX_ATTEMPTS", 10);
    const currentAttempts = parseInt(job.attempts || 0, 10);
    if (currentAttempts >= maxAttempts) {
      await q(`update push_jobs set status='error', error=$2, last_error=$2, last_error_at=now(), updated_at=now() where id=$1`,
        [job.id, `Max attempts reached (${maxAttempts})`]
      );
      return new Response("", { status: 202 });
    }

    await q(`update push_jobs set status='assembling', error=null, attempts=attempts+1, updated_at=now() where id=$1`, [job.id]);

    const store = chunkStore();
    const deploy_path = normalizePath(job.deploy_path);

    const inlineMax = intEnv("PUSH_UPLOAD_INLINE_RETRIES", 3);
    const baseBackoff = intEnv("PUSH_JOB_RETRY_BASE_MS", 750);
    const maxBackoff = intEnv("PUSH_JOB_RETRY_MAX_MS", 30000);

    // We can rebuild a fresh stream each attempt by re-reading chunks. This solves the "stream replay" problem.
    let totalBytes = Number(job.bytes_staged || 0);
    if (!totalBytes && job.part_bytes && typeof job.part_bytes === "object") {
      totalBytes = Object.values(job.part_bytes).reduce((a, b) => a + Number(b || 0), 0);
    }

    let lastErr = null;
    for (let attempt = 1; attempt <= inlineMax; attempt++) {
      let idx = 0;
      const bodyStream = new ReadableStream({
        async pull(controller) {
          if (idx >= parts) {
            controller.close();
            return;
          }
          const key = `chunks/${pushId}/${sha1}/${idx}`;
          const ab = await store.get(key, { type: "arrayBuffer" });
          if (!ab) {
            controller.error(new Error(`Missing chunk blob: ${key}`));
            return;
          }
          controller.enqueue(new Uint8Array(ab));
          idx++;
        }
      });

      const netlify_token = await getNetlifyTokenForCustomer(push.customer_id);

      const r = await putDeployFileStream({
        deploy_id: push.deploy_id,
        deploy_path,
        bodyStream,
        netlify_token
      });

      if (r.ok) {
        // record file + usage
        await q(
          `insert into push_files(push_row_id, deploy_path, sha1, bytes, mode) values ($1,$2,$3,$4,'chunked')`,
          [push.id, deploy_path, sha1, totalBytes]
        );
        await q(
          `insert into push_usage_events(customer_id, api_key_id, push_row_id, event_type, bytes, pricing_version, cost_cents, meta)
           values ($1,$2,$3,'file_upload',$4,$6,0,$5::jsonb)`,
          [push.customer_id, push.api_key_id, push.id, totalBytes, JSON.stringify({ sha1, path: deploy_path, mode: "chunked", parts }), (capInfo?.cfg?.pricing_version ?? 1)]
        );
        await q(
          `update push_pushes
           set uploaded_digests = case when not (uploaded_digests @> array[$2]) then array_append(uploaded_digests, $2) else uploaded_digests end,
               updated_at = now()
           where id=$1`,
          [push.id, sha1]
        );

        // cleanup blobs best-effort
        try {
          for (let i = 0; i < parts; i++) {
            await store.delete(`chunks/${pushId}/${sha1}/${i}`);
          }
        } catch {}

        await q(`update push_jobs set status='done', error=null, last_error=null, next_attempt_at=null, bytes_staged=0, part_bytes='{}'::jsonb, updated_at=now() where id=$1`, [job.id]);

        await audit(actor, "PUSH_FILE_DONE", `push:${pushId}`, { sha1, path: deploy_path, bytes: totalBytes, mode: "chunked" });
        return new Response("", { status: 202 });
      }

      lastErr = `Netlify PUT failed (${r.status}) ${String(r.detail || "").slice(0, 300)}`;
      // Retry only on retryable statuses. Missing chunks etc won't reach here.
      if (!retryableStatus(r.status) || attempt === inlineMax) {
        break;
      }

      // Backoff with Retry-After preference.
      const waitMs = r.retryAfterMs || Math.min(maxBackoff, jitter(baseBackoff * Math.pow(2, attempt - 1)));
      await sleep(waitMs);
    }

    // If we reached here: it failed.
    const retryWait = Math.min(maxBackoff, jitter(baseBackoff * Math.pow(2, inlineMax)));
    const nextAt = new Date(Date.now() + retryWait).toISOString();

    // Mark as retryable if it looks transient; otherwise mark error.
    const status = (lastErr && lastErr.includes("Netlify PUT failed (429")) || (lastErr && lastErr.includes("Netlify PUT failed (50"))
      ? "retry_wait"
      : "error_transient";

    await q(
      `update push_jobs
       set status=$2,
           error=$3,
           last_error=$3,
           last_error_at=now(),
           next_attempt_at=$4,
           updated_at=now()
       where id=$1`,
      [job.id, status, (lastErr || "Upload failed").slice(0, 1200), nextAt]
    );

    await audit(actor, "PUSH_FILE_RETRY_WAIT", `push:${pushId}`, { sha1, path: deploy_path, next_attempt_at: nextAt, status });
    return new Response("", { status: 202 });
  } catch (e) {
    // best-effort: record error state if possible
    try {
      const secret = process.env.JOB_WORKER_SECRET;
      const got = (req.headers.get("x-kaixu-job-secret") || req.headers.get("x-job-worker-secret") || "");
      if (!secret || got !== secret) return new Response("", { status: 202 });

      const body = await req.json().catch(() => ({}));
      const pushId = (body.pushId || "").toString();
      const sha1 = (body.sha1 || "").toString().toLowerCase();
      if (pushId && /^[a-f0-9]{40}$/.test(sha1)) {
        const pres = await q(`select id from push_pushes where push_id=$1 limit 1`, [pushId]);
        if (pres.rowCount) {
          const job = await q(`select id from push_jobs where push_row_id=$1 and sha1=$2 limit 1`, [pres.rows[0].id, sha1]);
          if (job.rowCount) {
            await q(
              `update push_jobs set status='error_transient', error=$2, last_error=$2, last_error_at=now(), next_attempt_at=now() + interval '30 seconds', updated_at=now() where id=$1`,
              [job.rows[0].id, (e?.message || String(e)).slice(0, 1200)]
            );
          }
        }
      }
    } catch {}
    return new Response("", { status: 202 });
  }
};
