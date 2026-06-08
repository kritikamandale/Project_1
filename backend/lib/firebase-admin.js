/**
 * Firebase Admin SDK singleton
 * Initialized once and reused across all modules.
 *
 * Credentials come from the GOOGLE_APPLICATION_CREDENTIALS env var
 * (path to service account JSON) or FIREBASE_SERVICE_ACCOUNT_JSON
 * (raw JSON string, preferred for Railway/Render secrets).
 */

'use strict';

const admin = require('firebase-admin');

if (!admin.apps.length) {
  let credential;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Render/Railway: store the service account JSON as an env var
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      credential = admin.credential.cert(serviceAccount);
    } catch (e) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Local dev: path to service account file
    credential = admin.credential.applicationDefault();
  } else {
    throw new Error(
      'Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.'
    );
  }

  admin.initializeApp({
    credential,
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

module.exports = admin;

