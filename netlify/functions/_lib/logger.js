/*
  _lib/logger.js — Structured JSON logger + Sentry error reporting
  Usage:
    const logger = require('./_lib/logger');
    const log = logger('auth-login');
    log.info('user_login', { email, ip });
    log.warn('rate_limited', { email, ip });
    log.error('db_error', { message: e.message });    // also sends to Sentry
    log.exception(err, { context: 'extra data' });    // sends Error object to Sentry

  Env vars:
    SENTRY_DSN   — Sentry DSN (optional; logs still work without it)
    LOG_DEBUG    — 'true' to enable debug level
*/

let _sentry = null;

function getSentry() {
  if (_sentry) return _sentry;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NETLIFY_DEV === 'true' ? 'development' : 'production',
      tracesSampleRate: 0.1,
    });
    _sentry = Sentry;
    return _sentry;
  } catch {
    // @sentry/node not installed — degrade gracefully
    return null;
  }
}

function logger(functionName) {
  function write(level, event, data = {}) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      fn: functionName,
      event,
      ...data,
    };
    if (level === 'error') {
      console.error(JSON.stringify(entry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  }

  return {
    info:  (event, data) => write('info',  event, data),
    warn:  (event, data) => write('warn',  event, data),

    error: (event, data) => {
      write('error', event, data);
      // Report to Sentry as a non-exception breadcrumb
      const sentry = getSentry();
      if (sentry) {
        sentry.withScope(scope => {
          scope.setTag('fn', functionName);
          scope.setTag('event', event);
          scope.setExtras(data || {});
          sentry.captureMessage(`[${functionName}] ${event}`, 'error');
        });
      }
    },

    // Use this when you have an actual Error object
    exception: (err, data = {}) => {
      write('error', 'exception', { message: err?.message, stack: err?.stack, ...data });
      const sentry = getSentry();
      if (sentry) {
        sentry.withScope(scope => {
          scope.setTag('fn', functionName);
          scope.setExtras(data);
          sentry.captureException(err);
        });
      }
    },

    debug: (event, data) => {
      if (process.env.LOG_DEBUG === 'true') write('debug', event, data);
    },
  };
}

module.exports = logger;
module.exports.logger = logger;
