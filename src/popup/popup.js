/**
 * Arlo Popup — Redesigned Glassmorphism UI
 */

import { load, loadMeta } from '../storage/profile-store.js';
import { getApplicationStats } from '../storage/job-tracker.js';
import { scoreMatch } from '../ai/match-scorer.js';

let _profile    = null;
let _meta       = null;
let _jobContext = null;
let _authToken  = null;
let _isOnPortal = false;

document.addEventListener('DOMContentLoaded', async () => {
  await initPopup();
  bindActions();
});

async function initPopup() {
  try {
    const [profile, meta, stats, currentTab, authToken] = await Promise.all([
      load(),
      loadMeta(),
      getApplicationStats(),
      getCurrentTab(),
      getAuthToken(),
    ]);

    _profile   = profile;
    _meta      = meta;
    _authToken = authToken;

    // Navbar Badge
    const planEl = document.getElementById('planBadge');
    planEl.textContent = meta.plan || 'Free';

    // Stats
    document.getElementById('statApplied').textContent = stats.today || 0;
    document.getElementById('statResponses').textContent = meta.responses || 0;
    
    const used = meta.creditsUsed || 0;
    const total = meta.creditsTotal || 10;
    const isUnlimited = meta.plan?.toLowerCase() === 'pro' || meta.plan?.toLowerCase() === 'premium';
    document.getElementById('statCredits').textContent = isUnlimited ? '∞' : Math.max(0, total - used);

    // Portal Detection
    await handlePortalDetection(currentTab);

  } catch (err) {
    console.error('[Arlo] Popup init error:', err);
  }
}

async function handlePortalDetection(tab) {
  const PORTALS = {
    'linkedin.com':    'LinkedIn',
    'naukri.com':      'Naukri',
    'internshala.com': 'Internshala',
    'wellfound.com':   'Wellfound',
    'unstop.com':      'Unstop',
  };

  const hostname = tryHostname(tab?.url);
  let detectedName = null;

  for (const [domain, name] of Object.entries(PORTALS)) {
    if (hostname.includes(domain)) { detectedName = name; break; }
  }

  _isOnPortal = !!detectedName;

  const dot  = document.getElementById('detectionDot');
  const text = document.getElementById('detectionText');
  const btn  = document.getElementById('btnAutoFill');
  const btnText = document.getElementById('btnAutoFillText');

  if (detectedName) {
    dot.className = 'dot active';
    text.innerHTML = `Detected: <strong>${detectedName}</strong>`;
    btn.disabled = false;
    btnText.textContent = `Auto-fill ${detectedName}`;

    if (tab?.id) {
      try {
        const resp = await chrome.tabs.sendMessage(tab.id, { action: 'GET_JOB_DETAILS' });
        if (resp?.details) {
          _jobContext = resp.details;
          await runMatchScore();
        }
      } catch { /* content script not ready yet */ }
    }
  } else {
    dot.className = 'dot inactive';
    text.textContent = 'Open a job portal to use Arlo';
    btn.disabled = true;
    btnText.textContent = 'Auto-fill Application';
  }
}

async function runMatchScore() {
  if (!_profile || !_jobContext || !_authToken) return;

  try {
    const result = await scoreMatch(_jobContext, _profile, _authToken);
    
    // Update Score Row
    document.getElementById('scoreValue').textContent = `${result.score}%`;
    document.getElementById('scoreRow').style.display = 'flex';

    // Update Skills
    const skillWrap = document.getElementById('skillChips');
    skillWrap.innerHTML = '';
    
    const allSkills = [
      ...(result.matchedSkills || []).map(s => ({ name: s, matched: true })),
      ...(result.missingSkills || []).map(s => ({ name: s, matched: false }))
    ];

    if (allSkills.length > 0) {
      allSkills.forEach(skill => {
        const chip = document.createElement('div');
        chip.className = `skill-chip ${skill.matched ? 'matched' : ''}`;
        chip.textContent = skill.name;
        skillWrap.appendChild(chip);
      });
      document.getElementById('skillTagsCard').style.display = 'block';
    }

  } catch (err) {
    console.error('Match score error:', err);
  }
}

function bindActions() {
  const btnAutoFill = document.getElementById('btnAutoFill');
  const btnText     = document.getElementById('btnAutoFillText');

  btnAutoFill.addEventListener('click', async () => {
    btnAutoFill.disabled = true;
    btnAutoFill.classList.add('typing-anim');
    btnText.textContent = 'Filling form';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const resp  = await chrome.tabs.sendMessage(tab.id, { action: 'FILL_FORM', source: 'popup' });

      btnAutoFill.classList.remove('typing-anim');
      
      if (resp?.success) {
        btnText.textContent = `✓ Filled ${resp.fieldsCount || ''} fields`;
      } else {
        btnText.textContent = 'No fillable form found';
      }
    } catch {
      btnAutoFill.classList.remove('typing-anim');
      btnText.textContent = 'Could not fill form';
    }

    setTimeout(() => {
      btnAutoFill.disabled = false;
      btnText.textContent = 'Auto-fill Application';
    }, 2500);
  });

  const dashboardUrl = chrome.runtime.getURL('src/dashboard/dashboard.html');

  document.getElementById('btnSettings').addEventListener('click', () => {
    chrome.tabs.create({ url: dashboardUrl + '?view=profile' });
  });

  document.getElementById('btnTracker').addEventListener('click', () => {
    chrome.tabs.create({ url: dashboardUrl + '?view=applications' });
  });

  document.getElementById('btnCoverLetter').addEventListener('click', () => {
    // We could open a Cover Letter view in dashboard or implement it natively if needed
    chrome.tabs.create({ url: dashboardUrl });
  });
}

// ── Helpers
async function getAuthToken() {
  return new Promise(resolve => chrome.storage.local.get(['sa_auth_token'], r => resolve(r.sa_auth_token || null)));
}
async function getCurrentTab() {
  try { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; } catch { return null; }
}
function tryHostname(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

