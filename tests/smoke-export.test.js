const { handler } = require('../netlify/functions/smoke-export');
const db = require('../netlify/functions/_lib/db');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-prod';

function makeToken(userId = 'user-123') {
  return jwt.sign({ sub: userId, email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
}

function event(method, { qs = {}, userId = 'user-123' } = {}) {
  return {
    httpMethod: method,
    headers: { authorization: `Bearer ${makeToken(userId)}` },
    queryStringParameters: qs,
    body: null,
  };
}

describe('smoke-export function', () => {
  beforeEach(() => jest.clearAllMocks());

  test('requires auth', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} });
    expect(res.statusCode).toBe(401);
  });

  test('exports all user smoke runs', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'log-1',
        created_at: '2026-03-02T00:00:00.000Z',
        details: {
          runId: 'run-1',
          verifyHash: 'a'.repeat(64),
          summary: { status: 'pass', total: 4, failed: 0 },
          checks: []
        }
      }]
    });

    const res = await handler(event('GET'));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.totalRuns).toBe(1);
    expect(body.runs[0].runId).toBe('run-1');
    expect(body.runs[0].chainHash).toHaveLength(64);
    expect(body.runs[0].verification.evidence.backfilled).toBe(true);
  });

  test('exports workspace-scoped smoke runs with access check', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'ws-1', org_id: null, user_id: 'user-123' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await handler(event('GET', { qs: { workspaceId: 'ws-1' } }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.scope).toBe('workspace');
  });
});
