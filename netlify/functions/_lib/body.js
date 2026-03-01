const { json } = require('./auth');

async function readJson(event) {
  try {
    let raw = event.body || '';
    if (!raw) return { ok: true, data: {} };
    // Netlify Functions may base64-encode the body
    if (event.isBase64Encoded) {
      raw = Buffer.from(raw, 'base64').toString('utf8');
    }
    const data = JSON.parse(raw);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, response: json(400, { ok: false, error: 'Invalid JSON body' }) };
  }
}

// Synchronous variant — throws on error, returns parsed object
function parseBody(event) {
  let raw = event.body || '{}';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(raw);
}

module.exports = { readJson, parseBody };
