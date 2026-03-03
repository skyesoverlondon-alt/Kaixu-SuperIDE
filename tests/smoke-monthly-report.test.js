const { handler } = require('../netlify/functions/smoke-monthly-report');
const db = require('../netlify/functions/_lib/db');

describe('smoke-monthly-report function', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns monthly report json', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        {
          created_at: '2026-03-02T00:00:00.000Z',
          details: {
            summary: { status: 'pass', total: 3, failed: 0 },
            source: 'scheduler',
            checks: []
          }
        },
        {
          created_at: '2026-03-05T00:00:00.000Z',
          details: {
            summary: { status: 'fail', total: 2, failed: 1 },
            source: 'manual',
            checks: []
          }
        }
      ]
    });

    const res = await handler({ httpMethod: 'GET', queryStringParameters: { months: '12' }, headers: {} });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.reports)).toBe(true);
    expect(body.reports[0].month).toBe('2026-03');
    expect(body.reports[0].totalRuns).toBe(2);
  });

  test('returns csv export when format=csv', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { format: 'csv' }, headers: {} });

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/csv');
    expect(res.body).toContain('month,totalRuns,passRuns');
  });
});
