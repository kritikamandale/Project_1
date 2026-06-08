/**
 * Arlo Firebase Authentication
 *
 * MV3 approach: chrome.identity.getAuthToken → exchange for Firebase ID token
 * via the Firebase Auth REST API. No Firebase SDK needed in the extension.
 *
 * Flow:
 *  1. chrome.identity.getAuthToken  → Google OAuth access token
 *  2. POST /identitytoolkit signInWithIdp → Firebase ID token + refresh token
 *  3. storeToken() in session storage
 */

import { storeToken, clearTokens, getUserMeta, logout as sessionLogout } from './session.js';
import { clearProfile } from '../storage/profile-store.js';

const FIREBASE_AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts';
// Firebase Web API key — public, not a secret. Set in manifest oauth2 or here.
const FIREBASE_API_KEY  = 'YOUR_FIREBASE_WEB_API_KEY'; // replaced at build time

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Signs in with Google via chrome.identity + Firebase Auth REST.
 * @returns {Promise<{ uid: string, email: string, displayName: string }>}
 */
export async function signInWithGoogle() {
  // 1. Get Google OAuth token from Chrome
  const googleToken = await _getGoogleToken();

  // 2. Exchange for Firebase ID token
  const firebaseData = await _exchangeGoogleToken(googleToken);

  // 3. Persist session
  await storeToken(
    firebaseData.idToken,
    parseInt(firebaseData.expiresIn, 10) || 3600,
    { uid: firebaseData.localId, plan: 'free' }
  );

  // 4. Store refresh token in local storage (survives session)
  await _storeRefreshToken(firebaseData.refreshToken);

  return {
    uid:         firebaseData.localId,
    email:       firebaseData.email,
    displayName: firebaseData.displayName || '',
  };
}

/**
 * Returns the currently authenticated user's metadata (no PII).
 * @returns {Promise<{ uid: string, plan: string }|null>}
 */
export async function getCurrentUser() {
  return getUserMeta();
}

/**
 * Signs out: clears tokens, keeps encrypted profile data.
 * @returns {Promise<void>}
 */
export async function signOut() {
  await sessionLogout();
  await _clearRefreshToken();

  // Revoke Google token so it can't be reused
  try {
    const result = await new Promise(resolve =>
      chrome.storage.local.get(['sa_google_token'], resolve)
    );
    if (result.sa_google_token) {
      chrome.identity.removeCachedAuthToken({ token: result.sa_google_token });
    }
  } catch { /* best effort */ }

  await chrome.storage.local.remove(['sa_google_token']);
}

/**
 * Full data deletion: signs out AND wipes all local + Firestore data.
 * Called from the "Delete all my data" button in profile settings.
 * @param {string} uid
 * @returns {Promise<void>}
 */
export async function deleteAllData(uid) {
  // 1. Clear local encrypted profile
  await clearProfile();

  // 2. Clear job tracker (handled by caller via job-tracker.clearAll())

  // 3. Sign out
  await signOut();

  // 4. Queue Firestore deletion (done via backend to avoid client-side admin SDK)
  if (uid) {
    try {
      await fetch(`${_getBackendUrl()}/api/user/delete`, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ uid }),
      });
    } catch { /* best-effort — data will be cleaned server-side on next login attempt */ }
  }
}

/**
 * Exports all user data as a JSON blob for GDPR compliance.
 * @param {object} profile   — decrypted profile
 * @param {Array}  jobs      — all applications
 * @returns {string}         — JSON string
 */
export function exportDataAsJSON(profile, jobs) {
  const exportData = {
    exportedAt:   new Date().toISOString(),
    version:      '1.0',
    profile:      profile  || {},
    applications: jobs     || [],
  };
  return JSON.stringify(exportData, null, 2);
}

// ── Private helpers ────────────────────────────────────────────────────────

async function _getGoogleToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, token => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!token) {
        reject(new Error('No Google auth token returned'));
      } else {
        chrome.storage.local.set({ sa_google_token: token });
        resolve(token);
      }
    });
  });
}

async function _exchangeGoogleToken(googleToken) {
  const res = await fetch(
    `${FIREBASE_AUTH_URL}:signInWithIdp?key=${FIREBASE_API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        postBody:          `access_token=${googleToken}&providerId=google.com`,
        requestUri:        chrome.runtime.getURL(''),
        returnIdpCredential: true,
        returnSecureToken: true,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Firebase auth failed (${res.status})`);
  }

  return res.json();
}

async function _storeRefreshToken(refreshToken) {
  if (!refreshToken) return;
  await chrome.storage.local.set({ sa_refresh_token: refreshToken });
}

async function _clearRefreshToken() {
  await chrome.storage.local.remove(['sa_refresh_token']);
}

function _getBackendUrl() {
  return chrome.runtime.getManifest()?.homepage_url || 'https://your-backend.railway.app';
}

