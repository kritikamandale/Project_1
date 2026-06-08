/**
 * Arlo Session Manager
 *
 * Security model:
 *  - Firebase JWT stored in chrome.storage.session → cleared when browser closes
 *  - Token refreshed every 55 minutes via chrome.alarms
 *  - Auto-logout after 7 days of inactivity (no form fill / popup open)
 *  - Re-auth required before changing profile data
 *
 * chrome.storage.session requires MV3 + Chrome 102+.
 * Falls back to chrome.storage.local with short TTL on older versions.
 */

const TOKEN_KEY      = 'sa_auth_token';
const EXPIRY_KEY     = 'sa_token_exp';
const USER_KEY       = 'sa_user_meta';      // { uid, plan } — no PII
const LAST_ACTIVE_KEY= 'sa_last_active';
const INACTIVITY_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_BUFFER = 5 * 60 * 1000;            // refresh 5 min before expiry

// Prefer session storage (auto-cleared on browser close), fall back to local
const _storage = () =>
  typeof chrome.storage.session !== 'undefined'
    ? chrome.storage.session
    : chrome.storage.local;

// ── Token Management ──────────────────────────────────────────────────────

/**
 * Stores a Firebase ID token with its expiry.
 * @param {string} token      — Firebase ID token
 * @param {number} expiresIn  — seconds until expiry (Firebase default: 3600)
 * @param {{ uid: string, plan?: string }} userMeta
 */
export async function storeToken(token, expiresIn, userMeta = {}) {
  const expiresAt = Date.now() + expiresIn * 1000;
  const store     = _storage();

  await _promisify(store, 'set', {
    [TOKEN_KEY]:       token,
    [EXPIRY_KEY]:      expiresAt,
    [LAST_ACTIVE_KEY]: Date.now(),
  });

  // Persist non-PII user meta to local storage (survives session)
  if (userMeta.uid) {
    await _promisify(chrome.storage.local, 'set', {
      [USER_KEY]: {
        uid:  userMeta.uid,
        plan: userMeta.plan || 'free',
      },
    });
  }
}

/**
 * Returns the stored token if valid, null otherwise.
 * Side effect: bumps last-active timestamp.
 * @returns {Promise<string|null>}
 */
export async function getValidToken() {
  const result = await _promisifyGet(_storage(), [TOKEN_KEY, EXPIRY_KEY, LAST_ACTIVE_KEY]);

  const token    = result[TOKEN_KEY];
  const expiry   = result[EXPIRY_KEY];
  const lastActive = result[LAST_ACTIVE_KEY];

  if (!token) return null;

  // Check expiry
  if (expiry && Date.now() > expiry) {
    await clearTokens();
    return null;
  }

  // Check inactivity
  if (lastActive && Date.now() - lastActive > INACTIVITY_MS) {
    await clearTokens();
    return null;
  }

  // Bump last-active
  await _promisify(_storage(), 'set', { [LAST_ACTIVE_KEY]: Date.now() });

  return token;
}

/**
 * Returns stored non-PII user metadata (uid, plan).
 * @returns {Promise<{ uid: string, plan: string }|null>}
 */
export async function getUserMeta() {
  const result = await _promisifyGet(chrome.storage.local, [USER_KEY]);
  return result[USER_KEY] || null;
}

/**
 * Returns true if a valid, non-expired token exists.
 * @returns {Promise<boolean>}
 */
export async function isAuthenticated() {
  const token = await getValidToken();
  return token !== null;
}

/**
 * Clears all session tokens. Called on logout or inactivity timeout.
 * Does NOT clear encrypted profile data (user can log back in).
 */
export async function clearTokens() {
  const store = _storage();
  await _promisify(store, 'remove', [TOKEN_KEY, EXPIRY_KEY, LAST_ACTIVE_KEY]);
}

/**
 * Full logout: clears tokens + user meta.
 * Profile data in chrome.storage.local is preserved (encrypted).
 */
export async function logout() {
  await clearTokens();
  await _promisify(chrome.storage.local, 'remove', [USER_KEY]);
}

// ── Token Refresh ─────────────────────────────────────────────────────────

/**
 * Checks if the token needs refreshing and calls the Firebase REST endpoint.
 * Called by the chrome.alarms handler in service-worker.js every 55 min.
 *
 * @param {string} refreshToken  — Firebase refresh token
 * @returns {Promise<boolean>}   true if refreshed successfully
 */
export async function refreshTokenIfNeeded(refreshToken) {
  if (!refreshToken) return false;

  const result = await _promisifyGet(_storage(), [EXPIRY_KEY]);
  const expiry  = result[EXPIRY_KEY];

  // Only refresh if within the buffer window
  if (expiry && expiry - Date.now() > REFRESH_BUFFER) return false;

  try {
    const apiKey  = _getFirebaseApiKey();
    if (!apiKey) {
      console.warn('[Arlo] Firebase API key not configured');
      return false;
    }

    const res = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      }
    );

    if (!res.ok) {
      await clearTokens(); // Force re-login on invalid refresh token
      return false;
    }

    const data      = await res.json();
    const newToken  = data.id_token;
    const expiresIn = parseInt(data.expires_in, 10) || 3600;

    await storeToken(newToken, expiresIn);
    return true;
  } catch (err) {
    // Network error — don't log out, just wait for next check
    console.warn('[Arlo] Token refresh failed:', err.message);
    return false;
  }
}

// ── Re-auth Guard ─────────────────────────────────────────────────────────

const RE_AUTH_ACTIONS = new Set(['CHANGE_PROFILE', 'DELETE_DATA', 'EXPORT_DATA']);

/**
 * Returns true if the given action requires re-authentication.
 * @param {string} action
 * @returns {boolean}
 */
export function requiresReAuth(action) {
  return RE_AUTH_ACTIONS.has(action);
}

// ── Private helpers ───────────────────────────────────────────────────────

function _promisify(storageArea, method, args) {
  return new Promise((resolve, reject) => {
    storageArea[method](args, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function _promisifyGet(storageArea, keys) {
  return new Promise((resolve, reject) => {
    storageArea.get(keys, result => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

function _getFirebaseApiKey() {
  // API key is baked into the manifest or a build-time config, not secret
  return chrome.runtime.getManifest()?.oauth2?.client_id?.split('@')[0] || null;
}

