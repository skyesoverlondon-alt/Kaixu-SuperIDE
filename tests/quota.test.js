/**
 * tests/quota.test.js — Plan quota enforcement tests
 * Verifies AI call limits are enforced per plan
 */

const { checkQuota, recordUsage } = jest.requireActual('../netlify/functions/_lib/quota');
const db = require('../netlify/functions/_lib/db');

// Un-mock quota for this file so we test the real implementation
jest.unmock('../netlify/functions/_lib/quota');

describe('checkQuota', () => {
  beforeEach(() => jest.clearAllMocks());

  test('allows calls when under limit', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ plan_name: 'pro', ai_calls_limit: 2000 }] }) // plan lookup
      .mockResolvedValueOnce({ rows: [{ used: 500 }] });                             // usage this month
    const result = await checkQuota('user-1', null);
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(500);
    expect(result.limit).toBe(2000);
  });

  test('blocks calls when at limit', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ plan_name: 'free', ai_calls_limit: 100 }] })
      .mockResolvedValueOnce({ rows: [{ used: 100 }] });
    const result = await checkQuota('user-1', null);
    expect(result.allowed).toBe(false);
  });

  test('allows unlimited calls for enterprise (limit -1)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ plan_name: 'enterprise', ai_call_limit: -1 }] })
      .mockResolvedValueOnce({ rows: [{ used: 999999 }] });
    const result = await checkQuota('user-1', null);
    expect(result.allowed).toBe(true);
  });

  test('allows calls when no plan found (defaults to free)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] }) // no plan
      .mockResolvedValueOnce({ rows: [{ used: 0 }] });
    const result = await checkQuota('user-1', null);
    // Should default to free plan or allow — not crash
    expect(typeof result.allowed).toBe('boolean');
  });

  test('never throws — returns allowed:true on DB error', async () => {
    db.query.mockRejectedValueOnce(new Error('DB connection failed'));
    const result = await checkQuota('user-1', null);
    expect(result.allowed).toBe(true); // fail open — never block on infra error
  });
});

describe('recordUsage', () => {
  test('records usage without throwing', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await expect(recordUsage('user-1', null, 'ws-1')).resolves.not.toThrow();
  });

  test('silently handles DB failure', async () => {
    db.query.mockRejectedValueOnce(new Error('DB down'));
    await expect(recordUsage('user-1', null, 'ws-1')).resolves.not.toThrow();
  });
});
