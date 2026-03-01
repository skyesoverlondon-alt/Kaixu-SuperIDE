/**
 * error-report.js
 * POST { message, stack, type, url, context } — log client-side errors to audit_logs.
 * No auth required (anonymous errors are still useful). Rate-limited by IP.
 */

const { query } = require('./_lib/db');
const { json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';

  // Lightweight rate limit: max 20 error reports per IP per minute (non-DB)
  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const { message, stack, type, url: pageUrl, context } = parsed.data || {};
  const safeMsg = String(message || '').slice(0, 1000);
  const safeStack = String(stack || '').slice(0, 5000);
  const safeType = String(type || 'unknown').slice(0, 50);
  const safeUrl = String(pageUrl || '').slice(0, 500);

  try {
    await query(
      `INSERT INTO audit_logs (action, details)
       VALUES ('client_error', $1::jsonb)`,
      [JSON.stringify({
        message: safeMsg,
        stack: safeStack,
        type: safeType,
        url: safeUrl,
        context: context || {},
        ip,
        ts: new Date().toISOString()
      })]
    );
    return json(200, { ok: true });
  } catch (err) {
    // Silently fail — never let error reporting break the app
    return json(200, { ok: true, warn: 'db_write_failed' });
  }
};
