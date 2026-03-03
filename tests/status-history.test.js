const { handler } = require('../netlify/functions/status-history');
const db = require('../netlify/functions/_lib/db');

describe('status-history function', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns uptime windows and daily history', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        {
          created_at: '2026-03-02T00:00:00.000Z',
          details: { summary: { status: 'pass', total: 3, failed: 0 }, source: 'scheduler', checks: [] }
        },
        {
          created_at: '2026-03-03T00:00:00.000Z',
          details: { summary: { status: 'fail', total: 3, failed: 1 }, source: 'manual', checks: [] }
        }
      ]
    });

    const res = await handler({ httpMethod: 'GET', queryStringParameters: {}, headers: {} });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.uptime).toHaveProperty('24h');
    expect(body.uptime).toHaveProperty('7d');
    expect(body.uptime).toHaveProperty('30d');
    expect(Array.isArray(body.daily)).toBe(true);
    expect(Array.isArray(body.incidents)).toBe(true);
  });
});
