const { json } = require('./auth');

async function readJson(event) {
  try {
    const raw = event.body || '';
    if (!raw) return { ok: true, data: {} };
    const data = JSON.parse(raw);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, response: json(400, { ok: false, error: 'Invalid JSON body' }) };
  }
}

module.exports = { readJson };
