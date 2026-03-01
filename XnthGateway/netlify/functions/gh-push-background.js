import fs from "fs";
import * as yauzl from "yauzl";
import { getStore } from "@netlify/blobs";
import { wrap } from "./_lib/wrap.js";
import { q } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { getGitHubTokenForCustomer } from "./_lib/githubTokens.js";
import { ghGet, ghPost, ghPatch, GitHubApiError } from "./_lib/github.js";

function chunkStore() {
  return getStore({ name: "kaixu_github_push_chunks", consistency: "strong" });
}

function intEnv(name, dflt) {
  const n = parseInt((process.env[name] || "").toString(), 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function sanitizeRepoPath(p) {
  let s = String(p || "").replace(/\\/g, "/");
  s = s.replace(/^\./, ""); // strip leading dot
  s = s.replace(/^\//, "");
  if (!s) return null;
  if (s.split("/").some(seg => seg === ".." || seg === "." || seg === "")) return null;
  const lower = s.toLowerCase();
  if (lower.startsWith(".git/") || lower === ".git") return null;
  if (lower.startsWith("node_modules/")) return null;
  if (lower.endsWith(".ds_store")) return null;
  return s;
}

async function writeZipToTmp(jobId, parts, store) {
  const tmp = `/tmp/${jobId}.zip`;
  const out = fs.createWriteStream(tmp);
  for (let i = 0; i < parts; i++) {
    const ab = await store.get(`ghzip/${jobId}/${i}`, { type: "arrayBuffer" });
    if (!ab) throw new Error(`Missing chunk blob ${i}`);
    out.write(Buffer.from(ab));
  }
  await new Promise((resolve, reject) => {
    out.end();
    out.on("finish", resolve);
    out.on("error", reject);
  });
  return tmp;
}

function openZip(tmpPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(tmpPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      resolve(zipfile);
    });
  });
}

function readEntry(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const chunks = [];
      let total = 0;
      stream.on("data", (c) => { chunks.push(c); total += c.length; });
      stream.on("end", () => resolve({ buf: Buffer.concat(chunks), bytes: total }));
      stream.on("error", reject);
    });
  });
}

async function getHead({ token, owner, repo, branch }) {
  try {
    const r = await ghGet({ token, path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}` });
    return r.data?.object?.sha || null;
  } catch (e) {
    if (e instanceof GitHubApiError && e.status === 404) return null;
    throw e;
  }
}

async function getCommitTree({ token, owner, repo, commitSha }) {
  const r = await ghGet({ token, path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${commitSha}` });
  return r.data?.tree?.sha || null;
}

async function createRef({ token, owner, repo, branch, sha }) {
  return ghPost({
    token,
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
    body: { ref: `refs/heads/${branch}`, sha }
  });
}

async function updateRef({ token, owner, repo, branch, sha }) {
  return ghPatch({
    token,
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,
    body: { sha, force: false }
  });
}

function computeBackoffMs(attempt) {
  const base = intEnv("GITHUB_JOB_RETRY_BASE_MS", 1000);
  const max = intEnv("GITHUB_JOB_RETRY_MAX_MS", 60000);
  const exp = Math.min(max, base * (2 ** Math.max(0, attempt - 1)));
  return exp + Math.floor(Math.random() * 400);
}

async function markRetry(jobRowId, attempt, msg, resetSeconds = null) {
  const delayMs = resetSeconds !== null ? (resetSeconds * 1000) : computeBackoffMs(attempt);
  const next = new Date(Date.now() + delayMs).toISOString();
  await q(
    `update gh_push_jobs
     set status='retry_wait', next_attempt_at=$2::timestamptz, last_error=$3, last_error_at=now(), updated_at=now()
     where id=$1`,
    [jobRowId, next, msg]
  );
}

async function markFail(jobRowId, msg) {
  await q(
    `update gh_push_jobs
     set status='error', last_error=$2, last_error_at=now(), updated_at=now()
     where id=$1`,
    [jobRowId, msg]
  );
}

export default wrap(async (req) => {
  // Secret-only internal worker (like KaixuPush job workers)
  try {
    const secret = (process.env.JOB_WORKER_SECRET || "").trim();
    if (!secret) return new Response("", { status: 202 });

    const got = (req.headers.get("x-kaixu-job-secret") || "").toString();
    if (got !== secret) return new Response("", { status: 202 });

    if (req.method !== "POST") return new Response("", { status: 202 });

    let body;
    try { body = await req.json(); } catch { return new Response("", { status: 202 }); }
    const jobId = (body.jobId || "").toString();
    if (!jobId) return new Response("", { status: 202 });

    const r = await q(`select * from gh_push_jobs where job_id=$1 limit 1`, [jobId]);
    if (!r.rowCount) return new Response("", { status: 202 });
    const job = r.rows[0];

    const maxAttempts = intEnv("GITHUB_JOB_MAX_ATTEMPTS", 10);
    const attempts = (job.attempts || 0) + 1;
    if (attempts > maxAttempts) {
      await markFail(job.id, `Exceeded max attempts (${maxAttempts})`);
      return new Response("", { status: 202 });
    }

    // respect next_attempt_at
    if (job.next_attempt_at) {
      const t = new Date(job.next_attempt_at).getTime();
      if (Date.now() < t - 500) return new Response("", { status: 202 });
    }

    await q(`update gh_push_jobs set attempts=$2, status='running', updated_at=now() where id=$1`, [job.id, attempts]);

    const token = await getGitHubTokenForCustomer(job.customer_id);
    if (!token) {
      await markFail(job.id, "No GitHub token configured");
      return new Response("", { status: 202 });
    }

    const owner = job.owner;
    const repo = job.repo;
    const branch = job.branch || "main";
    const message = job.commit_message || "Kaixu GitHub Push";
    const parts = parseInt(job.parts || "0", 10);
    if (!parts || parts < 1) {
      await markFail(job.id, "Missing parts (no uploaded zip)");
      return new Response("", { status: 202 });
    }

    const store = chunkStore();

    // Assemble zip to /tmp
    let tmpZip;
    try {
      tmpZip = await writeZipToTmp(jobId, parts, store);
    } catch (e) {
      await markRetry(job.id, attempts, `Zip assemble failed: ${e?.message || "unknown"}`);
      return new Response("", { status: 202 });
    }

    const maxFiles = intEnv("GITHUB_PUSH_MAX_FILES", 3000);
    const maxTotal = intEnv("GITHUB_PUSH_MAX_TOTAL_BYTES", 104857600);
    const maxFile = intEnv("GITHUB_PUSH_MAX_FILE_BYTES", 10485760);

    let zipfile;
    try { zipfile = await openZip(tmpZip); } catch (e) {
      await markFail(job.id, `Invalid zip: ${e?.message || "unknown"}`);
      return new Response("", { status: 202 });
    }

    const treeEntries = [];
    let totalBytes = 0;
    let fileCount = 0;

    const headSha = await (async () => {
      try { return await getHead({ token, owner, repo, branch }); }
      catch (e) {
        if (e instanceof GitHubApiError && e.code === "GITHUB_RATE_LIMIT") {
          await markRetry(job.id, attempts, "GitHub rate limited (head)", e.meta?.reset_seconds ?? 60);
          zipfile.close();
          return null;
        }
        throw e;
      }
    })();

    const baseTreeSha = headSha ? await (async () => {
      try { return await getCommitTree({ token, owner, repo, commitSha: headSha }); }
      catch (e) {
        if (e instanceof GitHubApiError && e.code === "GITHUB_RATE_LIMIT") {
          await markRetry(job.id, attempts, "GitHub rate limited (commit)", e.meta?.reset_seconds ?? 60);
          zipfile.close();
          return null;
        }
        throw e;
      }
    })() : null;

    // Iterate zip entries
    const loopResult = await new Promise((resolve, reject) => {
      zipfile.readEntry();

      zipfile.on("entry", async (entry) => {
        try {
          if (/\/$/.test(entry.fileName)) { zipfile.readEntry(); return; }
          const repoPath = sanitizeRepoPath(entry.fileName);
          if (!repoPath) { zipfile.readEntry(); return; }

          fileCount++;
          if (fileCount > maxFiles) throw new Error(`Too many files (>${maxFiles})`);

          const { buf, bytes } = await readEntry(zipfile, entry);
          if (bytes > maxFile) throw new Error(`File too large: ${repoPath} (${bytes} bytes)`);

          totalBytes += bytes;
          if (totalBytes > maxTotal) throw new Error(`Total size too large (>${maxTotal} bytes)`);

          const contentB64 = buf.toString("base64");

          let blobSha;
          try {
            const b = await ghPost({ token, path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`, body: { content: contentB64, encoding: "base64" } });
            blobSha = b.data?.sha;
          } catch (e) {
            if (e instanceof GitHubApiError && e.code === "GITHUB_RATE_LIMIT") {
              await markRetry(job.id, attempts, "GitHub rate limited (blob)", e.meta?.reset_seconds ?? 60);
              zipfile.close();
              resolve("retry");
              return;
            }
            if (e instanceof GitHubApiError && (e.code === "GITHUB_TRANSIENT" || e.code === "GITHUB_NETWORK")) {
              await markRetry(job.id, attempts, "GitHub transient error (blob)");
              zipfile.close();
              resolve("retry");
              return;
            }
            throw e;
          }

          if (!blobSha) throw new Error("Missing blob sha");

          treeEntries.push({ path: repoPath, mode: "100644", type: "blob", sha: blobSha });
          zipfile.readEntry();
        } catch (e) {
          zipfile.close();
          reject(e);
        }
      });

      zipfile.on("end", () => resolve("done"));
      zipfile.on("error", reject);
    }).catch(async (e) => {
      await markFail(job.id, `Zip processing failed: ${e?.message || "unknown"}`);
      try { zipfile.close(); } catch {}
      return "failed";
    });

    if (loopResult !== "done") return new Response("", { status: 202 });

    // If job went to retry_wait inside loop, stop.
    const statusNow = await q(`select status from gh_push_jobs where id=$1`, [job.id]);
    if (statusNow.rows[0]?.status === "retry_wait") return new Response("", { status: 202 });
    if (statusNow.rows[0]?.status === "error") return new Response("", { status: 202 });

    // Create tree
    let treeSha;
    try {
      const tr = await ghPost({
        token,
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
        body: baseTreeSha ? { base_tree: baseTreeSha, tree: treeEntries } : { tree: treeEntries }
      });
      treeSha = tr.data?.sha;
    } catch (e) {
      if (e instanceof GitHubApiError && e.code === "GITHUB_RATE_LIMIT") {
        await markRetry(job.id, attempts, "GitHub rate limited (tree)", e.meta?.reset_seconds ?? 60);
        return new Response("", { status: 202 });
      }
      if (e instanceof GitHubApiError && (e.code === "GITHUB_TRANSIENT" || e.code === "GITHUB_NETWORK")) {
        await markRetry(job.id, attempts, "GitHub transient error (tree)");
        return new Response("", { status: 202 });
      }
      await markFail(job.id, `Tree create failed: ${e?.message || "unknown"}`);
      return new Response("", { status: 202 });
    }

    if (!treeSha) { await markFail(job.id, "Missing tree sha"); return new Response("", { status: 202 }); }

    // Create commit
    let commitSha;
    try {
      const cr = await ghPost({
        token,
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
        body: headSha ? { message, tree: treeSha, parents: [headSha] } : { message, tree: treeSha, parents: [] }
      });
      commitSha = cr.data?.sha;
    } catch (e) {
      if (e instanceof GitHubApiError && e.code === "GITHUB_RATE_LIMIT") {
        await markRetry(job.id, attempts, "GitHub rate limited (commit)", e.meta?.reset_seconds ?? 60);
        return new Response("", { status: 202 });
      }
      if (e instanceof GitHubApiError && (e.code === "GITHUB_TRANSIENT" || e.code === "GITHUB_NETWORK")) {
        await markRetry(job.id, attempts, "GitHub transient error (commit)");
        return new Response("", { status: 202 });
      }
      await markFail(job.id, `Commit create failed: ${e?.message || "unknown"}`);
      return new Response("", { status: 202 });
    }

    if (!commitSha) { await markFail(job.id, "Missing commit sha"); return new Response("", { status: 202 }); }

    // Update/create ref
    try {
      if (headSha) await updateRef({ token, owner, repo, branch, sha: commitSha });
      else await createRef({ token, owner, repo, branch, sha: commitSha });
    } catch (e) {
      if (e instanceof GitHubApiError && e.code === "GITHUB_RATE_LIMIT") {
        await markRetry(job.id, attempts, "GitHub rate limited (ref)", e.meta?.reset_seconds ?? 60);
        return new Response("", { status: 202 });
      }
      await markFail(job.id, `Ref update failed: ${e?.message || "unknown"}`);
      return new Response("", { status: 202 });
    }

    const resultUrl = `https://github.com/${owner}/${repo}/commit/${commitSha}`;

    await q(
      `update gh_push_jobs
       set status='done', result_commit_sha=$2, result_url=$3, last_error=null, last_error_at=null, next_attempt_at=null, updated_at=now()
       where id=$1`,
      [job.id, commitSha, resultUrl]
    );

    await q(
      `insert into gh_push_events(customer_id, api_key_id, job_row_id, event_type, bytes, meta)
       values ($1,$2,$3,'done',$4,$5::jsonb)`,
      [job.customer_id, job.api_key_id, job.id, totalBytes, JSON.stringify({ files: fileCount, commit: commitSha, url: resultUrl })]
    );

    await audit("system", "GITHUB_PUSH_DONE", `gh:${jobId}`, { owner, repo, branch, commit: commitSha, files: fileCount, bytes: totalBytes });

    // Cleanup zip chunks best-effort
    try { for (let i = 0; i < parts; i++) await store.delete(`ghzip/${jobId}/${i}`); } catch {}

    return new Response("", { status: 202 });
  } catch {
    return new Response("", { status: 202 });
  }
});
