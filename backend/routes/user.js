const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const crypto = require('crypto');

// Generate unique referral code
router.post('/referral/generate', express.json(), async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: 'UID required' });
    
    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (userDoc.exists && userDoc.data().referralCode) {
      return res.json({ code: userDoc.data().referralCode });
    }
    
    // Create new code
    const code = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 chars
    
    await userRef.set({ referralCode: code, referralCount: 0 }, { merge: true });
    
    // Save to global referrals collection mapping code to uid
    await db.collection('referrals').doc(code).set({ ownerUid: uid, count: 0, conversions: [] });
    
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Apply referral code
router.post('/referral/apply', express.json(), async (req, res) => {
  try {
    const { newUserId, code } = req.body;
    if (!newUserId || !code) return res.status(400).json({ error: 'Missing parameters' });
    
    const db = admin.firestore();
    const refDoc = await db.collection('referrals').doc(code).get();
    
    if (!refDoc.exists) return res.status(404).json({ error: 'Invalid referral code' });
    
    const refData = refDoc.data();
    if (refData.conversions.includes(newUserId)) {
      return res.status(400).json({ error: 'Referral already applied' });
    }
    
    // Update count
    const newCount = (refData.count || 0) + 1;
    await refDoc.ref.update({
      count: newCount,
      conversions: admin.firestore.FieldValue.arrayUnion(newUserId)
    });
    
    // Also update owner's profile stats
    await db.collection('users').doc(refData.ownerUid).update({
      referralCount: newCount
    });
    
    // Auto upgrade logic: every 3 referrals = 1 month free pro
    if (newCount > 0 && newCount % 3 === 0) {
      await db.collection('users').doc(refData.ownerUid).update({
        plan: 'pro',
        planExpiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    res.json({ success: true, count: newCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

