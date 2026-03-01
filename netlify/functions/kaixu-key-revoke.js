// kaixu-key-revoke.js
// POST { keyId } — revoke a specific KaixuSI API key
//
// Users can only revoke their own keys.
// Admins can revoke any key.

const { requireAuth } = require('./_lib/auth');
const { query }       = require('./_lib/db');
const { json }        = require('./_lib/body');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  const auth = requireAuth(event);
  if (!auth.ok) return { ...auth.response, headers: { ...auth.response.headers, ...CORS } };

  const callerId = auth.decoded.userId || auth.decoded.sub;
  const isAdmin  = auth.decoded.role === 'admin' || auth.decoded.admin === true;

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  const { keyId } = body;
  if (!keyId) return json(400, { ok: false, error: 'keyId required' }, CORS);

  // Fetch key and check ownership
  const keyQ = await query('SELECT id, user_id, status FROM kaixu_keys WHERE id=$1', [keyId]);
  if (!keyQ.rows.length) return json(404, { ok: false, error: 'Key not found' }, CORS);

  const keyRow = keyQ.rows[0];
  if (!isAdmin && keyRow.user_id !== callerId) {
    return json(403, { ok: false, error: 'Not authorised to revoke this key' }, CORS);
  }
  if (keyRow.status === 'revoked') {
    return json(409, { ok: false, error: 'Key already revoked' }, CORS);
  }

  await query(
    `UPDATE kaixu_keys SET status='revoked', revoked_at=now() WHERE id=$1`,
    [keyId]
  );

  return json(200, { ok: true, keyId, revoked: true }, CORS);
};
