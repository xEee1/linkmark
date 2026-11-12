'use strict';

// Unified error body: { "error": { "code": "STRING", "message": "..." } }
const STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  USERNAME_TAKEN: 409,
  INTERNAL: 500,
};

class ApiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code] || 500;
  }
}

function fail(code, message) {
  throw new ApiError(code, message);
}

// Ids are UUID strings. A malformed id is treated as "not found" (404), which also
// keeps ownership leaks at 404 instead of surfacing a pg cast error as a 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(id) {
  if (!UUID_RE.test(String(id || ''))) {
    fail('NOT_FOUND', 'Bookmark not found');
  }
  return id;
}

function errorMiddleware(err, _req, res, next) {
  if (res.headersSent) return next(err);

  let status = 500;
  let code = 'INTERNAL';
  let message = 'Internal server error';

  if (err instanceof ApiError) {
    status = err.status;
    code = err.code;
    message = err.message;
  } else if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Invalid JSON body';
  } else if (err && typeof err.code === 'string' && /^\d{5}$/.test(err.code)) {
    // native pg error (e.g. a unique violation that raced the explicit pre-check)
    if (err.code === '23505') {
      status = 409;
      const hint = `${err.constraint || ''} ${err.message || ''}`.toLowerCase();
      if (hint.includes('email')) {
        code = 'EMAIL_TAKEN';
        message = 'Email is already registered';
      } else if (hint.includes('username')) {
        code = 'USERNAME_TAKEN';
        message = 'Username is already taken';
      } else {
        code = 'VALIDATION_ERROR';
        message = 'Conflict';
      }
    } else if (err.code === '23503') {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Related resource does not exist';
    }
  }

  if (status === 500) console.error('[error]', err);
  res.status(status).json({ error: { code, message } });
}

module.exports = { ApiError, fail, requireUuid, errorMiddleware };
