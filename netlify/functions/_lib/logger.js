/*
  _lib/logger.js — Structured JSON logger for all Netlify functions
  Usage:
    const { logger } = require('./_lib/logger');
    const log = logger('auth-login');
    log.info('user_login', { email, ip });
    log.warn('rate_limited', { email, ip });
    log.error('db_error', { message: e.message });
*/

function logger(functionName) {
  function write(level, event, data = {}) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      fn: functionName,
      event,
      ...data,
    };
    // Netlify captures console output as structured logs
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
    error: (event, data) => write('error', event, data),
    debug: (event, data) => {
      if (process.env.LOG_DEBUG === 'true') write('debug', event, data);
    },
  };
}

module.exports = logger;
module.exports.logger = logger;
