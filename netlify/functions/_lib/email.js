/*
  _lib/email.js — transactional email utility (Resend + SendGrid)
  ---------------------------------------
  Usage:
    const { sendEmail } = require('./_lib/email');

    const result = await sendEmail({
      to:      'user@example.com',
      subject: 'Welcome to kAIxU',
      html:    '<p>Hello!</p>',
      text:    'Hello!',
    });
    if (!result.ok) console.error('Email failed:', result.error);

  Env vars:
    RESEND_API_KEY    — Resend API key (preferred)
    RESEND_FROM_EMAIL — Optional sender address override for Resend
    SENDGRID_API_KEY  — SendGrid API key (fallback)
    SMTP_FROM_EMAIL   — Sender address (default for all providers)

  Graceful degradation:
    - If no provider key is configured, logs a warning and returns ok:false.
    - Never throws — always returns { ok, error? }.
*/

const RESEND_API = 'https://api.resend.com/emails';
const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send';

/**
 * Send a transactional email via Resend (preferred) or SendGrid (fallback).
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string, statusCode?: number }>}
 */
async function sendEmail({ to, subject, html, text }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const sendgridApiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM_EMAIL || 'hello@kaixu.app';

  if (resendApiKey) {
    const payload = {
      from,
      to: [to],
      subject,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
    };

    try {
      const res = await fetch(RESEND_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) return { ok: true, statusCode: res.status };

      const body = await res.json().catch(() => ({}));
      const errMsg = body?.message || body?.error?.message || `Resend HTTP ${res.status}`;
      console.error('[email] Resend error:', errMsg, { to, subject });
      return { ok: false, error: errMsg, statusCode: res.status };
    } catch (err) {
      console.error('[email] Resend fetch error:', err.message);
      return { ok: false, error: err.message };
    }
  }

  if (!sendgridApiKey) {
    console.warn('[email] No email provider configured — set RESEND_API_KEY or SENDGRID_API_KEY');
    return { ok: false, error: 'No email provider configured (set RESEND_API_KEY or SENDGRID_API_KEY)' };
  }

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from, name: 'kAIxU' },
    subject,
    content: [
      ...(html ? [{ type: 'text/html', value: html }] : []),
      ...(text ? [{ type: 'text/plain', value: text }] : []),
    ],
  };

  try {
    const res = await fetch(SENDGRID_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 202) return { ok: true };

    // SendGrid returns 4xx errors as JSON array of { message, field }
    const body = await res.json().catch(() => ({}));
    const errMsg = body?.errors?.[0]?.message || `SendGrid HTTP ${res.status}`;
    console.error('[email] SendGrid error:', errMsg, { to, subject });
    return { ok: false, error: errMsg, statusCode: res.status };
  } catch (err) {
    console.error('[email] fetch error:', err.message);
    return { ok: false, error: err.message };
  }
}

// ── Email templates ─────────────────────────────────────────────────────────

/**
 * Send a welcome / email verification email after signup.
 * @param {{ to: string, verifyUrl: string }} opts
 */
async function sendVerificationEmail({ to, verifyUrl }) {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Inter,sans-serif;background:#040008;color:#e0d6ff;padding:40px;max-width:560px;margin:auto">
  <h1 style="color:#a243ff;font-size:28px;margin-bottom:8px">Welcome to kAIxU</h1>
  <p style="color:#b0a0d0;margin-bottom:24px">Verify your email to activate your account and start using the IDE.</p>
  <a href="${verifyUrl}"
     style="display:inline-block;background:#a243ff;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:16px">
    Verify Email
  </a>
  <p style="color:#6b5b8a;font-size:13px;margin-top:32px">
    This link expires in 24 hours. If you didn't sign up for kAIxU, ignore this email.
  </p>
  <hr style="border:none;border-top:1px solid #2a1a4a;margin:32px 0">
  <p style="color:#6b5b8a;font-size:12px">kAIxU · Built by Skyes Over London LC</p>
</body>
</html>`;

  const text = `Welcome to kAIxU!\n\nVerify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`;

  return sendEmail({ to, subject: 'Verify your kAIxU email', html, text });
}

/**
 * Send a password reset email.
 * @param {{ to: string, resetUrl: string }} opts
 */
async function sendPasswordResetEmail({ to, resetUrl }) {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Inter,sans-serif;background:#040008;color:#e0d6ff;padding:40px;max-width:560px;margin:auto">
  <h1 style="color:#a243ff;font-size:28px;margin-bottom:8px">Reset your password</h1>
  <p style="color:#b0a0d0;margin-bottom:24px">Click the button below to set a new password for your kAIxU account.</p>
  <a href="${resetUrl}"
     style="display:inline-block;background:#a243ff;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:16px">
    Reset Password
  </a>
  <p style="color:#6b5b8a;font-size:13px;margin-top:32px">
    This link expires in 1 hour. If you didn't request a password reset, ignore this email — your account is safe.
  </p>
  <hr style="border:none;border-top:1px solid #2a1a4a;margin:32px 0">
  <p style="color:#6b5b8a;font-size:12px">kAIxU · Built by Skyes Over London LC</p>
</body>
</html>`;

  const text = `Reset your kAIxU password\n\nClick here: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`;

  return sendEmail({ to, subject: 'Reset your kAIxU password', html, text });
}

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail };
