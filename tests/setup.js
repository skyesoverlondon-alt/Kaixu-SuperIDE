/**
 * tests/setup.js — Jest global test setup
 * Mocks DB, auth, and external services so tests run without real infrastructure.
 */

// ── Mock DB ────────────────────────────────────────────────────────────────────
jest.mock('../netlify/functions/_lib/db', () => {
  const rows = {};
  return {
    query: jest.fn(async (sql, params) => ({ rows: rows.__next || [], rowCount: 0 })),
    getDb: jest.fn(() => ({
      query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
    })),
    __setRows: (data) => { rows.__next = data; },
  };
});

// ── Mock logger (silence output during tests) ──────────────────────────────────
jest.mock('../netlify/functions/_lib/logger', () => {
  const noop = () => {};
  const logger = () => ({ info: noop, warn: noop, error: noop, exception: noop, debug: noop });
  logger.logger = logger;
  return logger;
});

// ── Mock ratelimit (always allow during tests) ─────────────────────────────────
jest.mock('../netlify/functions/_lib/ratelimit', () => ({
  checkRateLimit: jest.fn(async () => false), // false = not limited
}));

// ── Mock quota (always allow during tests) ─────────────────────────────────────
jest.mock('../netlify/functions/_lib/quota', () => ({
  checkQuota:  jest.fn(async () => ({ allowed: true, used: 0, limit: 1000 })),
  recordUsage: jest.fn(async () => {}),
}));

// ── Suppress unhandled promise rejections from fire-and-forget DB calls ─────────
process.on('unhandledRejection', () => {});

// ── Required env vars for functions that verify JWTs ─────────────────────────
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-prod-min-32chars!';
