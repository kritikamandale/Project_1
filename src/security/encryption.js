/**
 * Arlo Encryption Module
 * AES-GCM 256-bit encryption using WebCrypto API
 * Never stores raw personal data — always encrypted at rest
 */

const ENCRYPTION_SALT = 'Arlo-v1-salt-2024';
const KEY_ITERATIONS = 100000;
const KEY_LENGTH = 256;

/**
 * Derives a CryptoKey from a user ID using PBKDF2
 * @param {string} uid - Firebase user ID or fallback device ID
 * @returns {Promise<CryptoKey>}
 */
export async function generateKey(uid) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(uid),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(ENCRYPTION_SALT),
      iterations: KEY_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a JavaScript object with AES-GCM
 * @param {object} data - Plain object to encrypt
 * @param {CryptoKey} key - Derived AES-GCM key
 * @returns {Promise<string>} Base64-encoded "iv:ciphertext"
 */
export async function encrypt(data, key) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM

  const plaintext = encoder.encode(JSON.stringify(data));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  // Combine IV + ciphertext and base64-encode
  const combined = new Uint8Array(iv.byteLength + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), iv.byteLength);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts a base64 AES-GCM ciphertext back to an object
 * @param {string} ciphertext - Base64-encoded "iv+ciphertext"
 * @param {CryptoKey} key - Derived AES-GCM key
 * @returns {Promise<object>} Decrypted plain object
 */
export async function decrypt(ciphertext, key) {
  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));

  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decryptedBuffer));
}

/**
 * Generates a stable device-based fallback UID when user is not authenticated
 * Stored in chrome.storage.local (non-sensitive)
 * @returns {Promise<string>}
 */
export async function getOrCreateDeviceUID() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['_deviceUID'], (result) => {
      if (result._deviceUID) {
        resolve(result._deviceUID);
      } else {
        const uid = 'device-' + crypto.randomUUID();
        chrome.storage.local.set({ _deviceUID: uid }, () => resolve(uid));
      }
    });
  });
}

