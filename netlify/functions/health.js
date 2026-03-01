/*
  health.js — Public health check endpoint
  GET /.netlify/functions/health
  No auth required — used for uptime monitors, CI, and the IDE status bar.
  Returns: { ok, db, gate, ts }
*/

const { query } = require('./_lib/db');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const result = { ok: false, db: 'unknown', gate: 'unknown', ts: new Date().toISOString() };

  // Check DB
  try {
    await query('SELECT 1');
    result.db = 'ok';
  } catch (e) {
    result.db = 'error: ' + e.message.slice(0, 80);
  }

  // Check KaixuSI Worker — /health is public (no auth required)
  const gateHealthUrl = `${(process.env.KAIXUSI_WORKER_URL || '').replace(/\/+$/, '')}/health`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(gateHealthUrl, {
      method: 'GET',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    result.gate = r.ok ? 'ok' : `http-${r.status}`;
  } catch (e) {
    result.gate = e.name === 'AbortError' ? 'timeout' : 'error';
  }

  result.ok = result.db === 'ok'; // DB is required; gate is informational
  return {
    statusCode: result.ok ? 200 : 503,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
};
