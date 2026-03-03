const { handler } = require('../netlify/functions/smoke-scheduled');
const db = require('../netlify/functions/_lib/db');

describe('smoke-scheduled function', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SMOKE_SCHEDULE_KEY = 'secret-key';
    process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod-min-32chars!';
    process.env.APP_URL = 'https://example.test';
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ totalRuns: 2 }) }));
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('rejects manual trigger without schedule key', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} });
    expect(res.statusCode).toBe(401);
  });

  test('runs checks and persists scheduler smoke run', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] })
      .mockResolvedValueOnce({ rows: [{ details: { evidence: { chainHash: 'a'.repeat(64) } } }] })
      .mockResolvedValueOnce({ rows: [{ id: 'log-1', created_at: '2026-03-02T00:00:00.000Z' }] });

    const res = await handler({
      httpMethod: 'GET',
      headers: { 'x-smoke-schedule-key': 'secret-key' },
      queryStringParameters: {}
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.run.runId).toBeTruthy();
    expect(body.run.verifyHash).toHaveLength(64);
    expect(body.run.chainHash).toHaveLength(64);
  });
});