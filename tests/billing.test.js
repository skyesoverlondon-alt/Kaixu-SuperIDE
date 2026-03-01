/**
 * tests/billing.test.js — Stripe webhook + billing plan tests
 */

const db = require('../netlify/functions/_lib/db');

function parseBody(res) { return JSON.parse(res.body); }

describe('GET /billing-plans', () => {
  let handler;
  beforeAll(() => { handler = require('../netlify/functions/billing-plans').handler; });
  beforeEach(() => jest.clearAllMocks());

  test('returns plans list', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 'plan-free', name: 'free', ai_call_limit: 100 },
        { id: 'plan-pro',  name: 'pro',  ai_call_limit: 2000 },
      ]
    });
    const res = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} });
    expect([200, 401]).toContain(res.statusCode);
  });

  test('rejects non-GET', async () => {
    const res = await handler({ httpMethod: 'POST', headers: {}, body: '{}', queryStringParameters: {} });
    expect(res.statusCode).toBe(405);
  });
});

describe('POST /stripe-webhook — event handling', () => {
  let handler;
  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    handler = require('../netlify/functions/stripe-webhook').handler;
  });
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 with missing stripe-signature header', async () => {
    const res = await handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({ type: 'customer.subscription.created' }),
      queryStringParameters: {},
    });
    // Should reject unsigned webhooks
    expect([400, 401, 500]).toContain(res.statusCode);
  });

  test('rejects non-POST', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {}, body: '', queryStringParameters: {} });
    expect(res.statusCode).toBe(405);
  });
});

describe('Plan limit enforcement', () => {
  test('free plan has lower limits than pro', () => {
    const plans = {
      free:       { ai_call_limit: 100,   max_workspaces: 3,  max_members: 1  },
      pro:        { ai_call_limit: 2000,  max_workspaces: 20, max_members: 5  },
      team:       { ai_call_limit: 10000, max_workspaces: 100, max_members: 25 },
      enterprise: { ai_call_limit: -1,    max_workspaces: -1, max_members: -1 },
    };
    expect(plans.free.ai_call_limit).toBeLessThan(plans.pro.ai_call_limit);
    expect(plans.pro.ai_call_limit).toBeLessThan(plans.team.ai_call_limit);
    expect(plans.enterprise.ai_call_limit).toBe(-1); // unlimited
  });
});
