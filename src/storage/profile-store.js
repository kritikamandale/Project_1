/**
 * Arlo Profile Store
 * Encrypted profile persistence using chrome.storage.local + WebCrypto AES-GCM
 */

import { generateKey, encrypt, decrypt, getOrCreateDeviceUID } from '../security/encryption.js';

const PROFILE_KEY = 'sa_profile_enc';
const META_KEY = 'sa_profile_meta'; // Non-sensitive metadata (plan, credits)

let _cachedKey = null;

/**
 * Gets or creates the encryption key for this session
 * @param {string} [uid] - Firebase UID (optional, falls back to device UID)
 * @returns {Promise<CryptoKey>}
 */
async function getKey(uid) {
  if (_cachedKey) return _cachedKey;
  const effectiveUID = uid || await getOrCreateDeviceUID();
  _cachedKey = await generateKey(effectiveUID);
  return _cachedKey;
}

/**
 * Invalidates the cached key (call on logout)
 */
export function invalidateKeyCache() {
  _cachedKey = null;
}

/**
 * Saves the full profile, encrypted, to chrome.storage.local
 * @param {object} profileData - Full profile object
 * @param {string} [uid] - Firebase UID
 * @returns {Promise<void>}
 */
export async function save(profileData, uid) {
  const key = await getKey(uid);
  const ciphertext = await encrypt(profileData, key);

  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [PROFILE_KEY]: ciphertext }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Loads and decrypts the profile from chrome.storage.local
 * @param {string} [uid] - Firebase UID
 * @returns {Promise<object|null>} Decrypted profile or null if not found
 */
export async function load(uid) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([PROFILE_KEY], async (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const ciphertext = result[PROFILE_KEY];
      if (!ciphertext) {
        resolve(null);
        return;
      }

      try {
        const key = await getKey(uid);
        const profile = await decrypt(ciphertext, key);
        resolve(profile);
      } catch (err) {
        console.error('[Arlo] Failed to decrypt profile:', err.message);
        resolve(null);
      }
    });
  });
}

/**
 * Partially updates a single field in the stored profile
 * @param {string} field - Top-level or dot-notation field (e.g. "personal.name")
 * @param {*} value - New value
 * @param {string} [uid] - Firebase UID
 * @returns {Promise<void>}
 */
export async function update(field, value, uid) {
  const profile = (await load(uid)) || {};

  // Support dot-notation for nested fields like "personal.email"
  const keys = field.split('.');
  let ref = profile;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!ref[keys[i]] || typeof ref[keys[i]] !== 'object') {
      ref[keys[i]] = {};
    }
    ref = ref[keys[i]];
  }
  ref[keys[keys.length - 1]] = value;

  await save(profile, uid);
}

/**
 * Saves non-sensitive metadata (plan, credits) unencrypted for quick access
 * @param {object} meta - { plan, creditsUsed, creditsTotal, appliedToday, appliedMonth }
 * @returns {Promise<void>}
 */
export async function saveMeta(meta) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [META_KEY]: meta }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

/**
 * Loads non-sensitive metadata
 * @returns {Promise<object>}
 */
export async function loadMeta() {
  return new Promise((resolve) => {
    chrome.storage.local.get([META_KEY], (result) => {
      resolve(result[META_KEY] || {
        plan: 'Free',
        creditsUsed: 0,
        creditsTotal: 10,
        appliedToday: 0,
        appliedMonth: 0,
      });
    });
  });
}

/**
 * Clears all stored profile data (on logout)
 * @returns {Promise<void>}
 */
export async function clearProfile() {
  invalidateKeyCache();
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove([PROFILE_KEY, META_KEY], () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

