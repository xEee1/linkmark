'use strict';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { httpError, wrap };
