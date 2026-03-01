// github-pull.js — pull files from GitHub into workspace
// POST { workspaceId }
//
// Algorithm (differential — fast on subsequent pulls):
//  1. Verify JWT + workspace access
//  2. Load GitHub config + stored tree map (last push/pull SHAs)
//  3. GET branch HEAD + full recursive tree from GitHub
//  4. Compare remote tree SHAs with stored map → only fetch changed/new blobs
//  5. Merge into Neon workspace files (update/add GitHub files, remove deleted tracked files)
//  6. Save updated tree map + last SHA to DB
//  7. Return full merged files to client → client writes to IndexedDB + refreshes tree

const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

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
  if (!res.ok) throw Object.assign(new Error(data.message || `GitHub ${res.status}`), { status: res.status });
  return data;
}

async function verifyWorkspaceAccess(userId, workspaceId) {
  const wsRes = await query('select org_id, user_id, files from workspaces where id=$1', [workspaceId]);
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
  return ws;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const { workspaceId } = parsed.data || {};
  if (!workspaceId) return json(400, { ok: false, error: 'Missing workspaceId' });

  try {
    const claims = verifyToken(token);
    const ws = await verifyWorkspaceAccess(claims.sub, workspaceId);

    // Load GitHub config
    const ghRes = await query(
      'select github_pat, github_owner, github_repo, github_branch, github_tree_map from workspace_github where workspace_id=$1',
      [workspaceId]
    );
    const gh = ghRes.rows[0];
    if (!gh) return json(400, { ok: false, error: 'GitHub not connected.' });

    const { github_pat: pat, github_owner: owner, github_repo: repo, github_branch: branch } = gh;
    const storedMap = gh.github_tree_map || {}; // { path: gitBlobSha } from last sync

    // 1. Get branch HEAD
    const refData = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    const headSha = refData.object.sha;

    // 2. Get full recursive tree
    const treeData = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}/git/trees/${headSha}?recursive=1`);
    const remoteTree = {}; // path → {sha, url}
    for (const item of (treeData.tree || [])) {
      if (item.type === 'blob') remoteTree[item.path] = { sha: item.sha, url: item.url };
    }

    // 3. Determine which files to fetch (only changed vs stored map)
    const toFetch = []; // paths whose SHA differs from stored
    for (const [path, { sha }] of Object.entries(remoteTree)) {
      if (storedMap[path] !== sha) {
        toFetch.push({ path, sha, url: remoteTree[path].url });
      }
    }

    // 4. Files tracked previously but now gone from remote → deleted
    const deletedPaths = Object.keys(storedMap).filter(p => !(p in remoteTree));

    // 5. Fetch changed/new blobs in parallel batches of 20
    const BATCH = 20;
    const fetchedFiles = {}; // path → content string
    for (let i = 0; i < toFetch.length; i += BATCH) {
      const batch = toFetch.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async ({ path, url }) => {
        const blobData = await ghFetch(pat, 'GET', url.replace('https://api.github.com', ''));
        const content = Buffer.from(blobData.content.replace(/\n/g, ''), 'base64').toString('utf8');
        return { path, content };
      }));
      for (const { path, content } of results) fetchedFiles[path] = content;
    }

    // 6. Merge into Neon workspace files
    //    - Update/add files fetched from GitHub
    //    - Remove files deleted from GitHub (only if we were previously tracking them)
    //    - Keep local-only files intact (untracked, not yet pushed)
    const currentFiles = ws.files || {};
    const mergedFiles = { ...currentFiles };

    for (const [path, content] of Object.entries(fetchedFiles)) {
      mergedFiles[path] = content;
    }
    for (const path of deletedPaths) {
      delete mergedFiles[path];
    }

    // 7. Save merged files to Neon workspace
    await query(
      'update workspaces set files=$1, updated_at=now() where id=$2',
      [mergedFiles, workspaceId]
    );

    // 8. Update stored tree map with new remote SHAs
    const newTreeMap = {};
    for (const [path, { sha }] of Object.entries(remoteTree)) {
      newTreeMap[path] = sha;
    }
    await query(
      'update workspace_github set github_last_sha=$1, github_tree_map=$2, updated_at=now() where workspace_id=$3',
      [headSha, newTreeMap, workspaceId]
    );

    return json(200, {
      ok: true,
      commitSha: headSha,
      filesUpdated: toFetch.length,
      filesDeleted: deletedPaths.length,
      totalFiles: Object.keys(remoteTree).length,
      files: mergedFiles // client writes these to IndexedDB
    });

  } catch (err) {
    const status = err.status || 500;
    return json(status, { ok: false, error: String(err?.message || err) });
  }
};
