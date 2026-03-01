// github-connect.js — save / retrieve / delete GitHub connection for a workspace
// POST  { workspaceId, pat, owner, repo, branch }  → saves settings, verifies repo access
// GET   ?workspaceId=…                              → returns masked connection info
// DELETE { workspaceId }                            → removes connection

const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

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
  if (!res.ok) throw new Error(data.message || `GitHub ${res.status}`);
  return data;
}

exports.handler = async (event) => {
  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  let claims;
  try { claims = verifyToken(token); } catch { return json(401, { ok: false, error: 'Invalid token' }); }
  const userId = claims.sub;

  // ── GET ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const workspaceId = (event.queryStringParameters?.workspaceId || '').trim();
    if (!workspaceId) return json(400, { ok: false, error: 'Missing workspaceId' });
    try {
      await verifyWorkspaceAccess(userId, workspaceId);
      const res = await query(
        'select github_owner, github_repo, github_branch, github_last_sha, updated_at from workspace_github where workspace_id=$1',
        [workspaceId]
      );
      const gh = res.rows[0];
      if (!gh) return json(200, { ok: true, connected: false });
      return json(200, {
        ok: true,
        connected: true,
        owner: gh.github_owner,
        repo: gh.github_repo,
        branch: gh.github_branch,
        lastSha: gh.github_last_sha,
        updatedAt: gh.updated_at
      });
    } catch (err) {
      return json(err.status || 500, { ok: false, error: err.message });
    }
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const parsed = await readJson(event);
    if (!parsed.ok) return parsed.response;
    const workspaceId = String(parsed.data?.workspaceId || '').trim();
    if (!workspaceId) return json(400, { ok: false, error: 'Missing workspaceId' });
    try {
      await verifyWorkspaceAccess(userId, workspaceId);
      await query('delete from workspace_github where workspace_id=$1', [workspaceId]);
      return json(200, { ok: true });
    } catch (err) {
      return json(err.status || 500, { ok: false, error: err.message });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const { workspaceId, pat, owner, repo, branch = 'main' } = parsed.data || {};
  if (!workspaceId || !pat || !owner || !repo) {
    return json(400, { ok: false, error: 'Missing workspaceId, pat, owner, or repo' });
  }

  try {
    await verifyWorkspaceAccess(userId, workspaceId);

    // Verify the PAT works and the repo is accessible before saving
    const repoData = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}`);
    const defaultBranch = repoData.default_branch || 'main';
    const useBranch = String(branch || defaultBranch).trim();

    await query(
      `insert into workspace_github(workspace_id, github_pat, github_owner, github_repo, github_branch)
       values($1,$2,$3,$4,$5)
       on conflict(workspace_id) do update
         set github_pat=$2, github_owner=$3, github_repo=$4, github_branch=$5,
             github_last_sha=null, github_tree_map='{}'::jsonb, updated_at=now()`,
      [workspaceId, pat, owner, repo, useBranch]
    );

    return json(200, {
      ok: true,
      owner,
      repo,
      branch: useBranch,
      private: repoData.private,
      defaultBranch
    });
  } catch (err) {
    return json(err.status || 500, { ok: false, error: String(err?.message || err) });
  }
};
