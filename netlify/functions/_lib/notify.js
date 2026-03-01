// _lib/notify.js — shared notification helper for Netlify functions
// Call: await notify(event, data, { orgId, userId })
// This calls the notifications.js handler internally (directly, not via HTTP)
// so it works even in serverless without self-calling

const https = require('https');

/**
 * Trigger a notification event.
 * @param {string} eventName - Event key e.g. 'task.created'
 * @param {object} data      - Event payload
 * @param {object} targets   - { orgId?, userId? }
 * @param {string} authToken - JWT of the triggering user (for identity)
 */
async function notify(eventName, data, targets = {}, authToken) {
  const appUrl = process.env.APP_URL || process.env.URL || 'http://localhost:8888';
  const payload = JSON.stringify({
    action: 'send',
    event: eventName,
    data,
    orgId: targets.orgId || null,
    userId: targets.userId || null,
  });

  return new Promise((resolve) => {
    try {
      const isLocal = appUrl.startsWith('http://localhost') || appUrl.startsWith('http://127');
      const protocol = isLocal ? require('http') : https;
      const urlObj = new (require('url').URL)(`${appUrl}/.netlify/functions/notifications`);

      const opts = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isLocal ? 8888 : 443),
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      };

      const req = protocol.request(opts, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode }));
      });
      req.on('error', (err) => {
        console.warn('[notify] delivery error:', err.message);
        resolve({ ok: false, error: err.message });
      });
      req.setTimeout(3000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.write(payload);
      req.end();
    } catch (err) {
      console.warn('[notify] error:', err.message);
      resolve({ ok: false, error: err.message });
    }
  });
}

module.exports = { notify };
