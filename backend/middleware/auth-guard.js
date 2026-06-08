/**
 * Firebase JWT Auth Guard
 *
 * Verifies the Firebase ID token sent in Authorization: Bearer <token>
 * Attaches decoded { uid, email } to req.user on success.
 *
 * Uses the Firebase Admin SDK — NEVER the client SDK.
 */

'use strict';

const admin = require('../lib/firebase-admin');

/**
 * Express middleware. Rejects with 401 if token is missing or invalid.
 */
async function authGuard(req, res, next) {
  const authHeader = req.headers['authorization'] || '';

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  const token = authHeader.slice(7).trim();

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = {
      uid:   decoded.uid,
      email: decoded.email || null,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authGuard;

