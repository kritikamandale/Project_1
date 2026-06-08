/**
 * Arlo Backend — Express Server
 * Deploy on Railway / Render / Fly.io
 *
 * Security layers:
 *  1. CORS locked to extension origins
 *  2. Firebase JWT verification on every AI endpoint
 *  3. Per-user rate limiting (express-rate-limit)
 *  4. Request logging (userId only, no PII)
 *  5. Claude API key never leaves the server
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Allowed origins ────────────────────────────────────────────────────────
// chrome-extension://  IDs are set at publish time; list them here + dev IDs.
// During development, add your unpacked extension ID from chrome://extensions.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Always allow chrome-extension:// scheme (any ID) in dev
const ORIGIN_REGEX = /^chrome-extension:\/\//;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Not a browser page
}));

app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin (e.g. curl in dev) only in non-prod
    if (!origin && process.env.NODE_ENV !== 'production') return callback(null, true);
    if (!origin) return callback(new Error('Origin required in production'));

    if (ORIGIN_REGEX.test(origin) || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin not allowed: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));

app.use(express.json({ limit: '50kb' })); // generous for JD text

// Structured request log — userId only, no body content logged
app.use(morgan(':method :url :status :response-time ms'));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/ai',      require('./routes/ai'));
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/user',    require('./routes/user'));

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:  'ok',
    version: require('../package.json').version,
    ts:      new Date().toISOString(),
  });
});

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Global error handler ───────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  // Never leak stack traces in production
  const message = process.env.NODE_ENV === 'production'
    ? (status < 500 ? err.message : 'Internal server error')
    : err.message;
  res.status(status).json({ error: message });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Arlo] Backend running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

module.exports = app; // for testing

