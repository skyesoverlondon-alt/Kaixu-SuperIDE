const { handler } = require('../netlify/functions/smoke-run');
const db = require('../netlify/functions/_lib/db');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-prod';

function makeToken(userId = 'user-123') {
  return jwt.sign({ sub: userId, email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
}

function event(method, { body = null, qs = {}, userId = 'user-123' } = {}) {
  return {
    httpMethod: method,
    headers: { authorization: `Bearer ${makeToken(userId)}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : null,
    queryStringParameters: qs,
  };
}

describe('smoke-run function', () => {
  beforeEach(() => jest.clearAllMocks());

  test('requires auth token', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} });
    expect(res.statusCode).toBe(401);
  });

  test('stores smoke run with verification hash', async () => {
    process.env.SMOKE_SIGNING_KEY = 'test-signing-key';
    process.env.SMOKE_SIGNING_KEY_VERSION = '2026-q1';

    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'ws-1', org_id: null, user_id: 'user-123' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'log-1', created_at: '2026-03-02T00:00:00.000Z' }] });

    const res = await handler(event('POST', {
      body: {
        workspaceId: 'ws-1',
        durationMs: 1234,
        checks: [
          { name: 'Health endpoint', ok: true, latencyMs: 44, message: 'ok' },
          { name: 'Auth profile', ok: true, latencyMs: 30, message: 'ok' }
        ],
        client: { userAgent: 'jest' }
      }
    }));

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.run.runId).toBeTruthy();
    expect(body.run.verifyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.run.chainHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.run.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(body.run.keyVersion).toBe('2026-q1');

    delete process.env.SMOKE_SIGNING_KEY;
    delete process.env.SMOKE_SIGNING_KEY_VERSION;
  });

  test('lists stored smoke runs', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'ws-1', org_id: null, user_id: 'user-123' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'log-1',
          created_at: '2026-03-02T00:00:00.000Z',
          details: {
            runId: 'run-1',
            verifyHash: 'a'.repeat(64),
            workspaceId: 'ws-1',
            summary: { status: 'pass', total: 4, failed: 0 },
            checks: [{ name: 'Health endpoint', ok: true }]
          }
        }]
      });

    const res = await handler(event('GET', { qs: { workspaceId: 'ws-1', limit: '10' } }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs[0].runId).toBe('run-1');
    expect(body.runs[0].verifyHash).toHaveLength(64);
    expect(body.runs[0].chainHash).toHaveLength(64);
    expect(body.runs[0].verification.evidence.backfilled).toBe(true);
  });
});
