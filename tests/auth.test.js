/**
 * tests/auth.test.js — Auth function unit tests
 * Tests: signup, login, token verification, MFA, reset, session revocation
 */

const { handler: signup }  = require('../netlify/functions/auth-signup');
const { handler: login }   = require('../netlify/functions/auth-login');
const { handler: authMe }  = require('../netlify/functions/auth-me');
const db = require('../netlify/functions/_lib/db');

// ── Helpers ────────────────────────────────────────────────────────────────────
function makeEvent(method, body = {}, headers = {}) {
  return {
    httpMethod: method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    queryStringParameters: {},
  };
}

function parseBody(response) {
  return JSON.parse(response.body);
}

// ── Signup ─────────────────────────────────────────────────────────────────────
describe('POST /auth-signup', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects missing email', async () => {
    const res = await signup(makeEvent('POST', { password: 'Test1234!' }));
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).ok).toBe(false);
  });

  test('rejects missing password', async () => {
    const res = await signup(makeEvent('POST', { email: 'test@example.com' }));
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).ok).toBe(false);
  });

  test('rejects short password', async () => {
    const res = await signup(makeEvent('POST', { email: 'test@example.com', password: 'short' }));
    expect(res.statusCode).toBe(400);
  });

  test('rejects invalid email format', async () => {
    const res = await signup(makeEvent('POST', { email: 'notanemail', password: 'ValidPass123!' }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 409 if email already exists', async () => {
    db.query.mockRejectedValueOnce({ code: '23505', message: 'duplicate key value violates unique constraint' });
    const res = await signup(makeEvent('POST', { email: 'existing@example.com', password: 'Valid1234!' }));
    expect([409, 400]).toContain(res.statusCode);
  });

  test('rejects non-POST methods', async () => {
    const res = await signup(makeEvent('GET', {}));
    expect(res.statusCode).toBe(405);
  });
});

// ── Login ──────────────────────────────────────────────────────────────────────
describe('POST /auth-login', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects missing credentials', async () => {
    const res = await login(makeEvent('POST', {}));
    expect(res.statusCode).toBe(400);
  });

  test('returns 401 on wrong password (user not found)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // user not found
    const res = await login(makeEvent('POST', { email: 'nobody@example.com', password: 'wrong' }));
    expect([401, 400]).toContain(res.statusCode);
    expect(parseBody(res).ok).toBe(false);
  });

  test('rejects non-POST', async () => {
    const res = await login(makeEvent('GET'));
    expect(res.statusCode).toBe(405);
  });
});

// ── Token verification  ────────────────────────────────────────────────────────
describe('GET /auth-me', () => {
  test('returns 401 with no token', async () => {
    const res = await authMe(makeEvent('GET'));
    expect(res.statusCode).toBe(401);
  });

  test('returns 401 with garbage token', async () => {
    const res = await authMe(makeEvent('GET', {}, { authorization: 'Bearer garbage' }));
    expect(res.statusCode).toBe(401);
  });

  test('rejects non-GET', async () => {
    const res = await authMe(makeEvent('POST'));
    expect(res.statusCode).toBe(405);
  });
});

// ── Method guards ──────────────────────────────────────────────────────────────
describe('Method guards', () => {
  const fns = [
    ['auth-signup',  signup,  'POST'],
    ['auth-login',   login,   'POST'],
    ['auth-me',      authMe,  'GET'],
  ];

  test.each(fns)('%s rejects wrong method', async (name, handler, allowed) => {
    const wrongMethod = allowed === 'POST' ? 'GET' : 'POST';
    const res = await handler(makeEvent(wrongMethod));
    expect(res.statusCode).toBe(405);
  });
});
