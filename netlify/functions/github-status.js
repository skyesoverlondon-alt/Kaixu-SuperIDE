// github-status.js — check GitHub connection health + ahead/behind status
// GET ?workspaceId=…

const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');

async function ghFetch(pat, method, path) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kAIxU-SuperIDE/1.0'
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `GitHub ${res.status}`), { status: res.status });
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  const workspaceId = (event.queryStringParameters?.workspaceId || '').trim();
  if (!workspaceId) return json(400, { ok: false, error: 'Missing workspaceId' });

  try {
    const claims = verifyToken(token);
    const userId = claims.sub;

    // Verify workspace access
    const wsRes = await query('select org_id, user_id from workspaces where id=$1', [workspaceId]);
    const ws = wsRes.rows[0];
    if (!ws) return json(404, { ok: false, error: 'Workspace not found' });
    if (ws.org_id) {
      const mem = await query(
        'select role from org_memberships where org_id=$1 and user_id=$2',
        [ws.org_id, userId]
      );
      if (!mem.rows[0]) return json(403, { ok: false, error: 'Not allowed' });
    } else {
      if (ws.user_id !== userId) return json(403, { ok: false, error: 'Not allowed' });
    }

    // Load GitHub config
    const ghRes = await query(
      'select github_owner, github_repo, github_branch, github_last_sha, updated_at from workspace_github where workspace_id=$1',
      [workspaceId]
    );
    const gh = ghRes.rows[0];
    if (!gh) return json(200, { ok: true, connected: false });

    const { github_owner: owner, github_repo: repo, github_branch: branch, github_last_sha: lastSha } = gh;

    // Get PAT separately (don't expose it in response)
    const patRes = await query('select github_pat from workspace_github where workspace_id=$1', [workspaceId]);
    const pat = patRes.rows[0]?.github_pat;

    // Fetch latest commit SHA from GitHub
    let remoteSha = null;
    let repoInfo = null;
    let behindBy = null;

    try {
      const refData = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
      remoteSha = refData.object.sha;

      // If we have a lastSha, compare to see if remote is ahead
      if (lastSha && remoteSha !== lastSha) {
        try {
          const cmp = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}/compare/${lastSha}...${remoteSha}`);
          behindBy = cmp.behind_by ?? null;
        } catch {}
      }

      repoInfo = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}`);
    } catch (ghErr) {
      return json(200, {
        ok: true,
        connected: true,
        owner, repo, branch,
        lastSha,
        updatedAt: gh.updated_at,
        error: `GitHub unreachable: ${ghErr.message}`
      });
    }

    const upToDate = !lastSha || remoteSha === lastSha;

    return json(200, {
      ok: true,
      connected: true,
      owner,
      repo,
      branch,
      lastSha,
      remoteSha,
      upToDate,
      behindBy,
      private: repoInfo?.private ?? null,
      stars: repoInfo?.stargazers_count ?? null,
      updatedAt: gh.updated_at,
      repoUrl: `https://github.com/${owner}/${repo}`
    });

  } catch (err) {
    return json(err.status || 500, { ok: false, error: String(err?.message || err) });
  }
};
