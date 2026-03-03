const { handler } = require('../netlify/functions/smoke-public');
const db = require('../netlify/functions/_lib/db');
const { checkRateLimit } = require('../netlify/functions/_lib/ratelimit');

describe('smoke-public function', () => {
  beforeEach(() => jest.clearAllMocks());

  test('allows GET without auth', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await handler({ httpMethod: 'GET', queryStringParameters: {} });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.runs)).toBe(true);
    expect(res.headers['Cache-Control']).toContain('max-age=30');
  });

  test('returns mapped smoke run fields', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'log-1',
        created_at: '2026-03-02T00:00:00.000Z',
        details: {
          runId: 'run-1',
          verifyHash: 'a'.repeat(64),
          workspaceId: 'ws-1',
          summary: { status: 'pass', total: 3, failed: 0 },
          checks: [{ name: 'Health endpoint', ok: true, latencyMs: 10, message: 'ok' }]
        }
      }]
    });

    const res = await handler({ httpMethod: 'GET', queryStringParameters: { limit: '10' } });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.totalRuns).toBe(1);
    expect(body.runs[0].runId).toBe('run-1');
    expect(body.runs[0].status).toBe('pass');
    expect(body.runs[0].checks[0].ok).toBe(true);
    expect(body.runs[0].chainHash).toHaveLength(64);
  });

  test('returns 429 when public rate limit is exceeded', async () => {
    checkRateLimit.mockResolvedValueOnce(true);
    const res = await handler({ httpMethod: 'GET', queryStringParameters: {}, headers: { 'x-forwarded-for': '1.2.3.4' } });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(429);
    expect(body.ok).toBe(false);
  });

  test('rejects non-GET methods', async () => {
    const res = await handler({ httpMethod: 'POST', queryStringParameters: {} });
    expect(res.statusCode).toBe(405);
  });
});
