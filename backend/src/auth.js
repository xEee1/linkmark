'use strict';

const jwt = require('jsonwebtoken');
const { ApiError } = require('./errors');

// HS256, payload { sub: user.id }, Bearer token, default 7d.
function signToken(userId, secret, expiresIn) {
  return jwt.sign({ sub: userId }, secret, { algorithm: 'HS256', expiresIn });
}

function authRequired(secret) {
  return (req, _res, next) => {
    const header = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) return next(new ApiError('UNAUTHORIZED', 'Missing or invalid Bearer token'));
    try {
      const payload = jwt.verify(match[1], secret, { algorithms: ['HS256'] });
      if (!payload || typeof payload.sub !== 'string' || !payload.sub) {
        return next(new ApiError('UNAUTHORIZED', 'Invalid token'));
      }
      req.userId = payload.sub;
      next();
    } catch {
      return next(new ApiError('UNAUTHORIZED', 'Invalid or expired token'));
    }
  };
}

module.exports = { signToken, authRequired };
