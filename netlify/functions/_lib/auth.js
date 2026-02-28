const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('Missing/weak JWT_SECRET');
  return s;
}

function issueToken(payload, { expiresIn = '14d' } = {}) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

function getBearerToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  return null;
}

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

module.exports = {
  issueToken,
  verifyToken,
  getBearerToken,
  json
};
