/**
 * Arlo Logger
 *
 * Dev mode:    full console logs including context
 * Production:  errors only, no PII in output
 *
 * Detection: extension has no `update_url` when loaded unpacked (dev)
 */

const IS_DEV = !('update_url' in (chrome?.runtime?.getManifest?.() || {}));

// PII patterns — stripped before any log output
const PII_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi,  // email
  /\b(\+91|0)?[6-9]\d{9}\b/g,                             // Indian mobile
  /\b\d{10,15}\b/g,                                       // generic phone
];

function _redact(str) {
  if (!IS_DEV && typeof str === 'string') {
    return PII_PATTERNS.reduce((s, p) => s.replace(p, '[REDACTED]'), str);
  }
  return str;
}

function _safeArgs(args) {
  if (IS_DEV) return args;
  return args.map(a => {
    if (typeof a === 'string') return _redact(a);
    if (typeof a === 'object' && a !== null) {
      try {
        const s = JSON.stringify(a);
        return JSON.parse(_redact(s));
      } catch { return '[Object]'; }
    }
    return a;
  });
}

/**
 * User-facing friendly error messages.
 * Maps error codes / message fragments to human-readable strings.
 * @param {Error|string} err
 * @returns {string}
 */
export function friendlyError(err) {
  const msg = String(err?.message || err || '').toLowerCase();

  if (msg.includes('network') || msg.includes('fetch'))
    return 'Network error. Check your connection and try again.';
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('token'))
    return 'Session expired. Please log in again.';
  if (msg.includes('429') || msg.includes('limit reached') || msg.includes('quota'))
    return 'Monthly limit reached. Upgrade to Pro for more.';
  if (msg.includes('no profile') || msg.includes('setup'))
    return 'Profile not set up. Complete onboarding first.';
  if (msg.includes('no fillable') || msg.includes('not found'))
    return 'No form fields detected on this page.';
  if (msg.includes('decrypt') || msg.includes('crypto'))
    return 'Could not load profile. Try reloading the extension.';
  if (msg.includes('timeout'))
    return 'Request timed out. Please try again.';

  return 'Something went wrong. Please try again.';
}

export const logger = {
  /** Debug — dev only */
  debug: (...args) => {
    if (IS_DEV) console.debug('[Arlo]', ..._safeArgs(args));
  },

  /** General info — dev only */
  log: (...args) => {
    if (IS_DEV) console.log('[Arlo]', ..._safeArgs(args));
  },

  /** Info — dev only */
  info: (...args) => {
    if (IS_DEV) console.info('[Arlo]', ..._safeArgs(args));
  },

  /** Warnings — dev only */
  warn: (...args) => {
    if (IS_DEV) console.warn('[Arlo]', ..._safeArgs(args));
  },

  /** Errors — always logged, PII stripped in production */
  error: (...args) => {
    console.error('[Arlo]', ..._safeArgs(args));
  },

  /** Tracks a user action without PII — safe to log in production */
  track: (action, metadata = {}) => {
    if (IS_DEV) {
      console.log('[Arlo:track]', action, metadata);
    }
    // Phase 4+: send anonymous telemetry via backend
  },
};

