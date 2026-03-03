// github-push.js — push workspace files to GitHub via Git Trees API
// POST { workspaceId, files: { "path": "content", ... }, message: "commit msg" }
//
// Algorithm:
//  1. Verify JWT + workspace access
//  2. Load GitHub config + stored blob SHA map from DB
//  3. GET branch HEAD SHA from GitHub
//  4. GET recursive tree for HEAD
//  5. Compute git blob SHA (sha1("blob N\0content")) for each local file
//  6. Upload ONLY changed/new files as blobs — in parallel batches of 20
//  7. Build minimal diff tree (changed + deleted entries only; base_tree inherits rest)
//  8. Create new tree object, commit, update branch ref
//  9. Save new commit SHA + local SHA map to DB

const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');
const crypto = require('crypto');

// Compute git blob SHA locally — avoids fetching unchanged file contents from GitHub
function gitBlobShaFromBuffer(buf) {
  const header = Buffer.from(`blob ${buf.length}\0`);
  return crypto.createHash('sha1').update(header).update(buf).digest('hex');
}

function normalizeWorkspaceFileContent(rawContent) {
  const raw = String(rawContent ?? '');
  if (raw.startsWith('__b64__:')) {
    const b64 = raw.slice('__b64__:'.length).replace(/\s+/g, '');
    const bytes = Buffer.from(b64, 'base64');
    return {
      sha: gitBlobShaFromBuffer(bytes),
      githubBase64: bytes.toString('base64')
    };
  }
  const bytes = Buffer.from(raw, 'utf8');
  return {
    sha: gitBlobShaFromBuffer(bytes),
    githubBase64: bytes.toString('base64')
  };
}

async function ghFetch(pat, method, path, body = null) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'kAIxU-SuperIDE/1.0'
    },
    body: body ? JSON.stringify(body) : null
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `GitHub ${res.status}`), { ghStatus: res.status, ghDoc: data.documentation_url });
  return data;
}

async function verifyWorkspaceAccess(userId, workspaceId) {
  const wsRes = await query('select org_id, user_id from workspaces where id=$1', [workspaceId]);
  const ws = wsRes.rows[0];
  if (!ws) throw Object.assign(new Error('Workspace not found'), { status: 404 });
  if (ws.org_id) {
    const mem = await query(
      'select role from org_memberships where org_id=$1 and user_id=$2',
      [ws.org_id, userId]
    );
    if (!mem.rows[0]) throw Object.assign(new Error('Not allowed'), { status: 403 });
  } else {
    if (ws.user_id !== userId) throw Object.assign(new Error('Not allowed'), { status: 403 });
  }
}

async function resolveHeadRef({ pat, owner, repo, branch }) {
  const encodedBranch = encodeURIComponent(branch);
  try {
    const targetRef = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${encodedBranch}`);
    return { branchUsed: branch, branchExists: true, baseCommitSha: targetRef.object.sha };
  } catch (err) {
    if (err?.ghStatus !== 404 && err?.ghStatus !== 409) throw err;
  }

  const repoData = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}`);
  const defaultBranch = String(repoData.default_branch || 'main');
  const encodedDefault = encodeURIComponent(defaultBranch);

  try {
    const fallbackRef = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${encodedDefault}`);
    return {
      branchUsed: branch,
      branchExists: false,
      baseCommitSha: fallbackRef.object.sha,
      fallbackFromBranch: defaultBranch
    };
  } catch (err) {
    if (err?.ghStatus !== 404 && err?.ghStatus !== 409) throw err;
  }

  return {
    branchUsed: branch,
    branchExists: false,
    baseCommitSha: null,
    fallbackFromBranch: defaultBranch
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const { workspaceId, files, message } = parsed.data || {};
  if (!workspaceId || !files || typeof files !== 'object') {
    return json(400, { ok: false, error: 'Missing workspaceId or files' });
  }

  try {
    const claims = verifyToken(token);
    await verifyWorkspaceAccess(claims.sub, workspaceId);

    // Load GitHub config
    const ghRes = await query(
      'select github_pat, github_owner, github_repo, github_branch, github_tree_map from workspace_github where workspace_id=$1',
      [workspaceId]
    );
    const gh = ghRes.rows[0];
    if (!gh) return json(400, { ok: false, error: 'GitHub not connected. Connect a repo first.' });

    const { github_pat: pat, github_owner: owner, github_repo: repo, github_branch: branch } = gh;

    // 1. Resolve branch HEAD (supports missing branch and empty repos)
    const { branchExists, baseCommitSha, fallbackFromBranch } = await resolveHeadRef({ pat, owner, repo, branch });

    // 2. Get full recursive tree for base commit (if any)
    const remoteTree = {}; // path → git blob SHA
    let baseTreeSha = null;
    if (baseCommitSha) {
      const treeData = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}/git/trees/${baseCommitSha}?recursive=1`);
      baseTreeSha = treeData.sha;
      for (const item of treeData.tree || []) {
        if (item.type === 'blob') remoteTree[item.path] = item.sha;
      }
    }

    // 3. Compute local git blob SHAs — detect what actually changed
    const localShas = {};
    const toUpload = []; // files that differ from remote
    for (const [path, content] of Object.entries(files)) {
      const normalized = normalizeWorkspaceFileContent(content);
      const sha = normalized.sha;
      localShas[path] = sha;
      if (remoteTree[path] !== sha) toUpload.push({ path, githubBase64: normalized.githubBase64 });
    }

    // 4. Find deleted files (in remote but not in local)
    const deleted = Object.keys(remoteTree).filter(p => !(p in localShas));

    // Nothing changed
    if (toUpload.length === 0 && deleted.length === 0) {
      return json(200, {
        ok: true,
        status: 'up-to-date',
        commitSha: baseCommitSha,
        filesChanged: 0,
        totalFiles: Object.keys(localShas).length
      });
    }

    // 5. Upload changed blobs in parallel — batches of 20 for rate-limit safety
    const BATCH_SIZE = 20;
    const uploadedBlobs = {}; // path → github blob sha
    for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
      const batch = toUpload.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(async ({ path, githubBase64 }) => {
        const blob = await ghFetch(pat, 'POST', `/repos/${owner}/${repo}/git/blobs`, {
          content: githubBase64,
          encoding: 'base64'
        });
        return { path, sha: blob.sha };
      }));
      for (const { path, sha } of results) uploadedBlobs[path] = sha;
    }

    // 6. Build minimal diff tree (base_tree inherits unchanged files automatically)
    const treeEntries = [];
    for (const [path, sha] of Object.entries(uploadedBlobs)) {
      treeEntries.push({ path, mode: '100644', type: 'blob', sha });
    }
    // Deletions — GitHub accepts sha: null to remove a file from the tree
    for (const path of deleted) {
      treeEntries.push({ path, mode: '100644', type: 'blob', sha: null });
    }

    // 7. Create new tree inheriting from base
    const newTreeBody = { tree: treeEntries };
    if (baseTreeSha) newTreeBody.base_tree = baseTreeSha;
    const newTreeData = await ghFetch(pat, 'POST', `/repos/${owner}/${repo}/git/trees`, newTreeBody);

    // 8. Create commit
    const commitMsg = String(message || '').trim() || `kAIxU push — ${new Date().toUTCString()}`;
    const commitBody = {
      message: commitMsg,
      tree: newTreeData.sha
    };
    if (baseCommitSha) commitBody.parents = [baseCommitSha];
    const newCommit = await ghFetch(pat, 'POST', `/repos/${owner}/${repo}/git/commits`, commitBody);

    // 9. Update branch ref
    if (branchExists) {
      const encodedBranch = encodeURIComponent(branch);
      await ghFetch(pat, 'PATCH', `/repos/${owner}/${repo}/git/refs/heads/${encodedBranch}`, {
        sha: newCommit.sha,
        force: false
      });
    } else {
      await ghFetch(pat, 'POST', `/repos/${owner}/${repo}/git/refs`, {
        ref: `refs/heads/${branch}`,
        sha: newCommit.sha
      });
    }

    // 10. Persist new SHA + local blob map for next push diff
    await query(
      'update workspace_github set github_last_sha=$1, github_tree_map=$2, updated_at=now() where workspace_id=$3',
      [newCommit.sha, localShas, workspaceId]
    );

    return json(200, {
      ok: true,
      commitSha: newCommit.sha,
      filesChanged: toUpload.length + deleted.length,
      filesUploaded: toUpload.length,
      filesDeleted: deleted.length,
      totalFiles: Object.keys(localShas).length,
      repo: `${owner}/${repo}`,
      branch,
      baseBranch: fallbackFromBranch || branch
    });

  } catch (err) {
    const status = err.status || 500;
    return json(status, { ok: false, error: String(err?.message || err) });
  }
};
