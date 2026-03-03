const { handler } = require('../netlify/functions/smoke-status');
const db = require('../netlify/functions/_lib/db');
const { checkRateLimit } = require('../netlify/functions/_lib/ratelimit');

describe('smoke-status function', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns json status metrics', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        created_at: '2026-03-02T00:00:00.000Z',
        details: { summary: { status: 'pass', total: 3, failed: 0 }, source: 'manual', checks: [] }
      }]
    });

    const res = await handler({ httpMethod: 'GET', queryStringParameters: {} });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.totalRuns).toBe(1);
    expect(body.passRate).toBe(100);
  });

  test('returns svg badge when format=svg', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { format: 'svg' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('image/svg+xml');
    expect(res.body).toContain('<svg');
  });

  test('returns 429 when rate limited', async () => {
    checkRateLimit.mockResolvedValueOnce(true);
    const res = await handler({ httpMethod: 'GET', queryStringParameters: {}, headers: { 'x-forwarded-for': '2.2.2.2' } });
    expect(res.statusCode).toBe(429);
  });
});