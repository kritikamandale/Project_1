/**
 * Paywall / feature gating logic
 */

import { loadMeta } from '../storage/profile-store.js';
import { getPlan } from './plans.js';

export async function isProUser(uid = null) {
  const meta = await loadMeta();
  const planId = meta.plan?.toLowerCase() || 'free';
  return planId === 'pro' || planId === 'premium';
}

/**
 * Checks if a feature is available for the user's current plan
 * @param {string} feature - 'aiCoverLetters' | 'aiAnswers' | 'autofill' | 'portal:name'
 * @param {string} uid - Optional user ID
 * @returns {Promise<{allowed: boolean, remaining?: number, reason?: string}>}
 */
export async function checkLimit(feature, uid = null) {
  const meta = await loadMeta();
  const plan = getPlan(meta.plan?.toLowerCase() || 'free');
  
  if (feature === 'autofill') {
    const remaining = plan.fillsPerMonth - (meta.creditsUsed || 0);
    if (remaining <= 0 && plan.fillsPerMonth !== Infinity) {
      return { allowed: false, remaining: 0, reason: 'Monthly auto-fill limit reached. Upgrade to Pro for unlimited fills.' };
    }
    return { allowed: true, remaining: remaining === Infinity ? 'Unlimited' : remaining };
  }

  if (feature === 'aiCoverLetters') {
    const used = meta.aiUsage?.coverLetter || 0;
    const remaining = plan.limits.aiCoverLetters - used;
    if (remaining <= 0 && plan.limits.aiCoverLetters !== Infinity) {
      return { allowed: false, remaining: 0, reason: 'Monthly AI cover letter limit reached. Upgrade to Pro for more.' };
    }
    return { allowed: true, remaining: remaining === Infinity ? 'Unlimited' : remaining };
  }

  if (feature.startsWith('portal:')) {
    const portalName = feature.split(':')[1].toLowerCase();
    if (plan.limits.portals[0] !== 'all' && !plan.limits.portals.includes(portalName)) {
      return { allowed: false, reason: `The ${portalName} portal is only available on Pro and Premium plans.` };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

export function showUpgradeModal(reason) {
  // Graceful degradation: we show a toast or redirect to dashboard upgrade tab
  const dashboardUrl = chrome.runtime.getURL('src/dashboard/dashboard.html?view=upgrade');
  
  // If we are in content script, we can inject a modal or send a message
  if (typeof document !== 'undefined' && document.querySelector('body')) {
    const existing = document.getElementById('Arlo-upgrade-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'Arlo-upgrade-modal';
    modal.innerHTML = `
      <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:'Inter',sans-serif;">
        <div style="background:#1e293b;padding:32px;border-radius:12px;max-width:400px;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.5);border:1px solid #334155;color:#f8fafc;">
          <div style="font-size:32px;margin-bottom:16px;">⚡</div>
          <h2 style="margin:0 0 12px;font-size:20px;font-weight:600;">Upgrade to Pro</h2>
          <p style="margin:0 0 24px;color:#94a3b8;font-size:14px;line-height:1.5;">${reason}</p>
          <div style="display:flex;gap:12px;justify-content:center;">
            <button id="sa-upgrade-close" style="background:transparent;border:1px solid #475569;color:#cbd5e1;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:500;">Maybe Later</button>
            <button id="sa-upgrade-btn" style="background:#3b82f6;border:none;color:white;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:500;box-shadow:0 4px 12px rgba(59,130,246,0.3);">View Plans</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('sa-upgrade-close').onclick = () => modal.remove();
    document.getElementById('sa-upgrade-btn').onclick = () => {
      window.open(dashboardUrl, '_blank');
      modal.remove();
    };
  } else {
    // Fallback if not in DOM (e.g. background script)
    chrome.tabs.create({ url: dashboardUrl });
  }
}


