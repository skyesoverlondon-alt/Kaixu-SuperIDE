/*
  health.js — Public health check endpoint
  GET /.netlify/functions/health
  No auth required — used for uptime monitors, CI, and the IDE status bar.
  Returns: { ok, db, gate, ts }
*/

const { Pool } = require('pg');

let _pool;
function pool() {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  return _pool;
}

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
    await pool().query('SELECT 1');
    result.db = 'ok';
  } catch (e) {
    result.db = 'error: ' + e.message.slice(0, 80);
  }

  // Check Kaixu Gate — /v1/health requires auth
  const gateBase = (process.env.KAIXU_GATE_BASE || 'https://kaixu67.skyesoverlondon.workers.dev').replace(/\/+$/, '');
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${gateBase}/v1/health`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.KAIXU_GATE_TOKEN || ''}` },
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
