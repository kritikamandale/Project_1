/**
 * Rate Limiters
 *
 * Two tiers:
 *  - aiLimiter:      20 AI requests / hour per user (keyed by uid)
 *  - globalLimiter:  200 requests / 15 min per IP  (general abuse guard)
 *
 * Uses express-rate-limit with in-memory store (swap to Redis for multi-instance).
 */

'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Global IP-based limiter — applied to all routes in server.js.
 */
const globalLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              200,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests, please try again later.' },
  skip:             (req) => process.env.NODE_ENV === 'test',
});

/**
 * Strict per-user AI limiter — applied to /api/ai/* routes.
 * Keyed by Firebase UID so it can't be bypassed by changing IP.
 *
 * Free plan:  20 AI requests / hour
 * Pro plan:   200 AI requests / hour  (checked inside the route handler)
 */
const aiLimiter = rateLimit({
  windowMs:         60 * 60 * 1000, // 1 hour
  max:              20,
  standardHeaders:  true,
  legacyHeaders:    false,
  keyGenerator:     (req) => req.user?.uid || req.ip,
  message:          { error: 'AI request limit reached. Upgrade to Pro for more.' },
  skip:             (req) => process.env.NODE_ENV === 'test',
});

module.exports = { globalLimiter, aiLimiter };

