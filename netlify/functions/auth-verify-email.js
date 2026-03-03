const crypto = require('crypto');
const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json } = require('./_lib/body');
const { sendVerificationEmail } = require('./_lib/email');
const logger = require('./_lib/logger')('auth-verify-email');

// GET ?token=xxx  — verify the email token
// POST { resend: true } — resend verification email
exports.handler = async (event) => {
  try {
    // Verify via token link (GET)
    if (event.httpMethod === 'GET') {
      const token = event.queryStringParameters?.token;
      if (!token) return json(400, { ok: false, error: 'token required' });

      const row = await query(
        `select ev.user_id, ev.expires_at, u.email
         from email_verifications ev join users u on u.id=ev.user_id
         where ev.token=$1`,
        [token]
      );
      if (!row.rows[0]) return json(404, { ok: false, error: 'Invalid or expired token' });
      if (new Date(row.rows[0].expires_at) < new Date()) return json(410, { ok: false, error: 'Token expired' });

      await query(`update users set email_verified=true where id=$1`, [row.rows[0].user_id]);
      await query(`delete from email_verifications where user_id=$1`, [row.rows[0].user_id]);

      logger.info('email_verified', { userId: row.rows[0].user_id, email: row.rows[0].email });
      return json(200, { ok: true, message: 'Email verified. You can now sign in.' });
    }

    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

    // Resend — requires auth
    const auth = requireAuth(event);
    if (!auth.ok) return auth.response;
    const userId = auth.decoded?.sub;

    const user = await query(`select email_verified, email from users where id=$1`, [userId]);
    if (!user.rows[0]) return json(404, { ok: false, error: 'User not found' });
    if (user.rows[0].email_verified) return json(409, { ok: false, error: 'Email already verified' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await query(
      `insert into email_verifications(user_id, token, expires_at) values($1,$2,$3)
       on conflict(user_id) do update set token=excluded.token, expires_at=excluded.expires_at`,
      [userId, token, expiresAt]
    );

    const appUrl = (process.env.APP_URL || process.env.URL || 'https://localhost').replace(/\/+$/, '');
    const verifyUrl = `${appUrl}/.netlify/functions/auth-verify-email?token=${token}`;
    const emailResult = await sendVerificationEmail({ to: user.rows[0].email, verifyUrl });

    if (!emailResult.ok) {
      logger.warn('verify_email_send_failed', { userId, email: user.rows[0].email, error: emailResult.error });
      return json(502, { ok: false, error: `Failed to send verification email: ${emailResult.error || 'email provider error'}` });
    }

    logger.info('verify_email_sent', { userId, email: user.rows[0].email });

    // Dev mode: return token directly
    return json(200, {
      ok: true,
      dev_token: token,
      verifyUrl,
      message: 'Verification email sent. Check your inbox.'
    });
  } catch (err) {
    logger.error('auth_verify_email_error', { message: err?.message || String(err) });
    return json(500, { ok: false, error: err?.message || 'Internal server error' });
  }
};
