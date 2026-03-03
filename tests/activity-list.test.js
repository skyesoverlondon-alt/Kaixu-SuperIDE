const jwt = require('jsonwebtoken');

jest.mock('../netlify/functions/_lib/db', () => ({
  readQuery: jest.fn()
}));

const db = require('../netlify/functions/_lib/db');
const { handler } = require('../netlify/functions/activity-list');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-prod';

function token(userId = 'user-123') {
  return jwt.sign({ sub: userId, email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
}

describe('activity-list function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 401 when token is missing', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(401);
    expect(body.ok).toBe(false);
  });

  test('returns events for authenticated user with safe limit fallback', async () => {
    db.readQuery.mockResolvedValueOnce({
      rows: [{ id: 'log-1', action: 'ws.save', details: {}, created_at: '2026-03-03T00:00:00.000Z', user_email: 'test@example.com' }]
    });

    const res = await handler({
      httpMethod: 'GET',
      headers: { authorization: `Bearer ${token('user-123')}` },
      queryStringParameters: { limit: 'oops' }
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
    expect(db.readQuery).toHaveBeenCalledTimes(1);
    expect(db.readQuery.mock.calls[0][1][1]).toBe(50);
  });
});
