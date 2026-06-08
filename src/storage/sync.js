/**
 * Sync module — local ↔ Firebase (stub for Phase 1)
 * Full implementation in Phase 2 with Firebase auth
 */

/**
 * Syncs local profile to Firebase Firestore
 * @param {string} uid
 * @param {object} profileData
 * @returns {Promise<void>}
 */
export async function syncToCloud(uid, profileData) {
  // Phase 2: implement Firebase Firestore sync
  console.log('[Arlo] Cloud sync not yet implemented (Phase 2)');
}

/**
 * Pulls profile from Firebase and merges with local
 * @param {string} uid
 * @returns {Promise<object|null>}
 */
export async function syncFromCloud(uid) {
  // Phase 2: implement Firebase Firestore pull
  console.log('[Arlo] Cloud pull not yet implemented (Phase 2)');
  return null;
}

