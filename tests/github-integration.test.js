const { handler: githubPush } = require('../netlify/functions/github-push');
const { handler: githubPull } = require('../netlify/functions/github-pull');
const db = require('../netlify/functions/_lib/db');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-prod';

function makeToken(userId = 'user-123') {
  return jwt.sign({ sub: userId, email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
}

function makeEvent(method, body = {}, userId = 'user-123', qs = {}) {
  return {
    httpMethod: method,
    headers: { authorization: `Bearer ${makeToken(userId)}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    queryStringParameters: qs,
  };
}

function jsonBody(res) {
  return JSON.parse(res.body || '{}');
}

describe('GitHub integration handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  test('github-push creates missing branch and uploads binary placeholders safely', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ org_id: null, user_id: 'user-123' }] })
      .mockResolvedValueOnce({ rows: [{ github_pat: 'pat', github_owner: 'acme', github_repo: 'repo', github_branch: 'feature/new-ui', github_tree_map: {} }] })
      .mockResolvedValueOnce({ rows: [] });

    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ default_branch: 'main' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ object: { sha: 'base-main-sha' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sha: 'base-tree-sha', tree: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ sha: 'blob-sha-1' }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ sha: 'new-tree-sha' }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ sha: 'new-commit-sha' }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ref: 'refs/heads/feature/new-ui' }) });

    const res = await githubPush(makeEvent('POST', {
      workspaceId: 'ws-1',
      files: { 'assets/logo.png': '__b64__:AAE=' },
      message: 'test push'
    }));

    const body = jsonBody(res);
    if (res.statusCode !== 200) {
      throw new Error(`Unexpected status ${res.statusCode}: ${JSON.stringify(body)}`);
    }
    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.branch).toBe('feature/new-ui');

    const firstRefPath = global.fetch.mock.calls[0][0];
    expect(firstRefPath).toContain('/git/ref/heads/feature%2Fnew-ui');

    const blobRequest = global.fetch.mock.calls.find(([url]) => String(url).includes('/git/blobs'));
    expect(blobRequest).toBeTruthy();
    const blobBody = JSON.parse(blobRequest[1].body);
    expect(blobBody.encoding).toBe('base64');

    const createRefRequest = global.fetch.mock.calls.find(([url, opts]) =>
      String(url).includes('/git/refs') && opts?.method === 'POST'
    );
    expect(createRefRequest).toBeTruthy();
    expect(JSON.parse(createRefRequest[1].body).ref).toBe('refs/heads/feature/new-ui');
  });

  test('github-pull falls back to default branch and keeps binary blobs as __b64__', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ org_id: null, user_id: 'user-123', files: { 'keep.txt': 'stay' } }] })
      .mockResolvedValueOnce({ rows: [{ github_pat: 'pat', github_owner: 'acme', github_repo: 'repo', github_branch: 'feature/missing', github_tree_map: {} }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ default_branch: 'main' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ object: { sha: 'head-main-sha' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({
        tree: [{ type: 'blob', path: 'assets/logo.png', sha: 'blob1', url: 'https://api.github.com/repos/acme/repo/git/blobs/blob1' }]
      }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ content: 'AAE=' }) });

    const res = await githubPull(makeEvent('POST', { workspaceId: 'ws-1' }));
    const body = jsonBody(res);
    if (res.statusCode !== 200) {
      throw new Error(`Unexpected status ${res.statusCode}: ${JSON.stringify(body)}`);
    }

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.branch).toBe('main');
    expect(body.fallbackFromBranch).toBe('feature/missing');
    expect(body.files['assets/logo.png']).toBe('__b64__:AAE=');
  });
});
