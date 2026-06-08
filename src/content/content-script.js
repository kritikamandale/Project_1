/**
 * Arlo Content Script
 *
 * Injection order (from manifest.json):
 *   1. portal-configs.js   → PORTAL_CONFIGS, detectCurrentPortal()
 *   2. form-detector.js    → detectPortal(), findFormFields(), watchForFormOpen()
 *   3. auto-filler.js      → fillAll(), fillField(), skipField()
 *   4. jd-extractor.js     → extractJobDetails()
 *   5. content-script.js   ← this file
 *
 * Responsibilities:
 *   - Inject the floating SA badge on job portals
 *   - Auto-detect portal + watch for apply form to open
 *   - Listen for FILL_FORM message from popup/service worker
 *   - Show animated toast during and after fill
 *   - Report detection status back to service worker
 */

// ── Constants ──────────────────────────────────────────────────────────────
const SA_BADGE_ID   = 'sa-floating-badge';
const SA_TOAST_ID   = 'sa-fill-toast';
const SA_PROGRESS_ID= 'sa-fill-progress';

// ── State ──────────────────────────────────────────────────────────────────
let _lastDetection   = null;   // result of detectPortal()
let _fillInProgress  = false;

// ─────────────────────────────────────────────────────────────────────────────
// INIT — runs on document_idle
// ─────────────────────────────────────────────────────────────────────────────
(function init() {
  _lastDetection = detectPortal();

  if (!_lastDetection.detected) return; // Not a job portal page, do nothing

  // Inject the floating badge
  injectBadge(_lastDetection);

  // Notify background that we're on a portal
  notifyBackground('CONTENT_READY', {
    portal:     _lastDetection.portal,
    portalName: _lastDetection.portalName,
    formOpen:   _lastDetection.formOpen,
    url:        window.location.href,
    title:      document.title,
  });

  // If a form is already open, scan fields immediately
  if (_lastDetection.formOpen) {
    const fields = findFormFields(_lastDetection.config);
    notifyBackground('PORTAL_FORM_DETECTED', {
      portal:     _lastDetection.portal,
      fieldCount: fields.totalFound,
    });
    updateBadgeState('ready', fields.totalFound);
  }

  // Watch for the form to appear (user hasn't clicked Apply yet)
  watchForFormOpen((fields) => {
    notifyBackground('PORTAL_FORM_DETECTED', {
      portal:     _lastDetection.portal,
      fieldCount: fields.totalFound,
    });
    updateBadgeState('ready', fields.totalFound);
    showToast(`Arlo ready — ${fields.totalFound} fields detected`, 'info', 2500);
  });

  // Re-run detection on URL changes (SPAs like LinkedIn navigate without reload)
  watchUrlChanges(() => {
    _lastDetection = detectPortal();
    if (_lastDetection.formOpen) {
      const fields = findFormFields(_lastDetection.config);
      updateBadgeState('ready', fields.totalFound);
    } else {
      updateBadgeState('idle', 0);
      watchForFormOpen((fields) => {
        updateBadgeState('ready', fields.totalFound);
        showToast(`Arlo ready — ${fields.totalFound} fields detected`, 'info', 2500);
      });
    }
  });
})();

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE LISTENER
// ─────────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'FILL_FORM':
      handleFillForm(message, sendResponse);
      return true; // keep channel open for async

    case 'GET_DETECTION':
      sendResponse({ success: true, detection: _lastDetection });
      break;

    case 'GET_JOB_DETAILS':
      sendResponse({ success: true, details: extractJobDetails() });
      break;

    case 'GET_SCREENING_QUESTIONS':
      handleGetScreeningQuestions(sendResponse);
      return true;

    case 'INJECT_COVER_LETTER':
      handleInjectCoverLetter(message.text, sendResponse);
      return true;

    case 'INJECT_FIELD_VALUE':
      handleInjectFieldValue(message.selector, message.value, sendResponse);
      return true;

    case 'SKIP_FIELD':
      skipField(message.fieldKey);
      sendResponse({ success: true });
      break;

    case 'PING':
      sendResponse({ alive: true, portal: _lastDetection?.portal || null });
      break;

    default:
      sendResponse({ error: `Unknown action: ${message.action}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FILL HANDLER
// ─────────────────────────────────────────────────────────────────────────────
async function handleFillForm(message, sendResponse) {
  if (_fillInProgress) {
    sendResponse({ success: false, error: 'Fill already in progress' });
    return;
  }

  _fillInProgress = true;
  updateBadgeState('filling', 0);

  try {
    // 1. Get profile from service worker
    const profileResp = await sendToBackground({ action: 'GET_PROFILE' });
    if (!profileResp?.success || !profileResp.profile) {
      showToast('No profile found. Please complete setup first.', 'error');
      sendResponse({ success: false, error: 'No profile found' });
      _fillInProgress = false;
      updateBadgeState('idle', 0);
      return;
    }

    const profile = profileResp.profile;

    // 2. Detect + scan fields
    const detection = findFormFields();

    if (!detection.detected || detection.totalFound === 0) {
      showToast('No fillable fields found on this page.', 'error');
      sendResponse({ success: false, error: 'No fillable fields detected' });
      _fillInProgress = false;
      updateBadgeState('idle', 0);
      return;
    }

    // 3. Show "Filling…" toast with progress bar
    showProgressToast(detection.totalFound);

    // 4. Fill all fields with progress callback
    let progressCount = 0;
    const result = await fillAll(detection, profile, {
      onProgress: (filled, total) => {
        progressCount = filled;
        updateProgressToast(filled, total);
        updateBadgeState('filling', filled);
      },
    });

    // 5. Extract JD and watch for submission to log application
    const jobDetails = extractJobDetails();
    if (jobDetails.title || jobDetails.company) {
      watchForSubmission({
        title:    jobDetails.title,
        company:  jobDetails.company,
        portal:   jobDetails.portal,
        url:      jobDetails.url,
        location: jobDetails.location,
      });
    }

    // 6. Update badge + show completion toast
    updateBadgeState('done', result.filled);
    showCompletionToast(result);

    // Notify background to update badge counter
    notifyBackground('FILL_COMPLETE', {
      filled: result.filled,
      portal: _lastDetection?.portal,
    });

    sendResponse({
      success:    true,
      fieldsCount: result.filled,
      skipped:    result.skipped,
      errors:     result.errors,
      jobDetails,
    });

  } catch (err) {
    console.error('[Arlo] Fill error:', err);
    showToast(`Fill failed: ${err.message}`, 'error');
    sendResponse({ success: false, error: err.message });
    updateBadgeState('error', 0);
  } finally {
    _fillInProgress = false;
    // Reset badge to ready after a few seconds
    setTimeout(() => {
      updateBadgeState('ready', 0);
    }, 5000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOATING BADGE
// ─────────────────────────────────────────────────────────────────────────────

function injectBadge(detection) {
  if (document.getElementById(SA_BADGE_ID)) return;

  const badge = document.createElement('div');
  badge.id = SA_BADGE_ID;
  badge.setAttribute('role', 'button');
  badge.setAttribute('aria-label', 'Arlo — click to fill form');
  badge.setAttribute('tabindex', '0');
  badge.title = `Arlo active on ${detection.portalName}`;

  Object.assign(badge.style, {
    position:      'fixed',
    bottom:        '88px',
    right:         '20px',
    width:         '44px',
    height:        '44px',
    borderRadius:  '50%',
    background:    'linear-gradient(135deg, #22c55e, #16a34a)',
    color:         '#0f172a',
    fontFamily:    "'Inter', -apple-system, sans-serif",
    fontSize:      '14px',
    fontWeight:    '800',
    display:       'flex',
    alignItems:    'center',
    justifyContent:'center',
    cursor:        'pointer',
    zIndex:        '2147483646',
    boxShadow:     '0 4px 16px rgba(34,197,94,0.45)',
    transition:    'transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease',
    userSelect:    'none',
    letterSpacing: '-0.5px',
  });

  badge.textContent = 'SA';

  // Hover effect
  badge.addEventListener('mouseenter', () => {
    badge.style.transform   = 'scale(1.12)';
    badge.style.boxShadow   = '0 6px 24px rgba(34,197,94,0.6)';
  });
  badge.addEventListener('mouseleave', () => {
    badge.style.transform   = '';
    badge.style.boxShadow   = '0 4px 16px rgba(34,197,94,0.45)';
  });

  // Click triggers fill (same as popup button)
  badge.addEventListener('click', () => {
    if (_fillInProgress) return;
    chrome.runtime.sendMessage({ action: 'FILL_FORM', source: 'badge' }, () => {});
  });

  badge.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      badge.click();
    }
  });

  // Slide-in animation
  badge.style.transform = 'scale(0)';
  document.body.appendChild(badge);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      badge.style.transform = 'scale(1)';
    });
  });
}

const BADGE_STATES = {
  idle:    { bg: 'linear-gradient(135deg, #475569, #334155)', label: 'SA', pulse: false },
  ready:   { bg: 'linear-gradient(135deg, #22c55e, #16a34a)', label: 'SA', pulse: true  },
  filling: { bg: 'linear-gradient(135deg, #f59e0b, #d97706)', label: '…',  pulse: false },
  done:    { bg: 'linear-gradient(135deg, #22c55e, #15803d)', label: '✓',  pulse: false },
  error:   { bg: 'linear-gradient(135deg, #ef4444, #dc2626)', label: '!',  pulse: false },
};

function updateBadgeState(state, count) {
  const badge = document.getElementById(SA_BADGE_ID);
  if (!badge) return;

  const cfg = BADGE_STATES[state] || BADGE_STATES.idle;
  badge.style.background = cfg.bg;
  badge.textContent = count && state === 'done' ? `✓${count}` : cfg.label;
  badge.title = state === 'ready'   ? `Arlo ready — ${count} fields detected`
               : state === 'filling'? `Filling form… (${count} filled)`
               : state === 'done'   ? `Filled ${count} fields`
               : state === 'error'  ? 'Arlo: error during fill'
               : 'Arlo active';

  // Pulse animation for ready state
  if (cfg.pulse) {
    badge.style.animation = 'sa-badge-pulse 2s ease-in-out infinite';
    if (!document.getElementById('sa-badge-style')) {
      const style = document.createElement('style');
      style.id = 'sa-badge-style';
      style.textContent = `
        @keyframes sa-badge-pulse {
          0%, 100% { box-shadow: 0 4px 16px rgba(34,197,94,0.45); }
          50%       { box-shadow: 0 4px 24px rgba(34,197,94,0.8); }
        }
      `;
      document.head.appendChild(style);
    }
  } else {
    badge.style.animation = '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TOAST NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

function showProgressToast(total) {
  removeExistingUI();

  const toast = document.createElement('div');
  toast.id = SA_PROGRESS_ID;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  Object.assign(toast.style, getToastBaseStyles());
  Object.assign(toast.style, {
    minWidth: '260px',
    flexDirection: 'column',
    gap: '10px',
  });

  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <div id="sa-spinner" style="
        width:16px;height:16px;border-radius:50%;
        border:2px solid rgba(34,197,94,0.3);
        border-top-color:#22c55e;
        animation:sa-spin 0.7s linear infinite;flex-shrink:0;
      "></div>
      <div>
        <div style="font-weight:600;color:#22c55e;font-size:13px;">Arlo</div>
        <div id="sa-progress-text" style="color:#94a3b8;font-size:12px;">Filling form…</div>
      </div>
    </div>
    <div style="height:3px;background:rgba(255,255,255,0.1);border-radius:99px;overflow:hidden;">
      <div id="sa-progress-bar" style="
        height:100%;width:0%;
        background:linear-gradient(90deg,#22c55e,#4ade80);
        border-radius:99px;
        transition:width 0.3s ease;
      "></div>
    </div>
  `;

  // Add spinner keyframe
  ensureStyleTag(`
    @keyframes sa-spin { to { transform: rotate(360deg); } }
  `, 'sa-spin-style');

  document.body.appendChild(toast);
  animateIn(toast);
}

function updateProgressToast(filled, total) {
  const text = document.getElementById('sa-progress-text');
  const bar  = document.getElementById('sa-progress-bar');
  if (text) text.textContent = `Filled ${filled} of ${total} fields…`;
  if (bar)  bar.style.width = `${Math.round((filled / total) * 100)}%`;
}

function showCompletionToast(result) {
  removeExistingUI();

  const { filled, skipped, errors } = result;
  const toast = document.createElement('div');
  toast.id = SA_TOAST_ID;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  Object.assign(toast.style, getToastBaseStyles());

  const parts = [`<strong style="color:#22c55e">✦ Arlo</strong>`];
  if (filled)  parts.push(`<span style="color:#f1f5f9">Filled <strong>${filled}</strong> field${filled !== 1 ? 's' : ''}</span>`);
  if (skipped) parts.push(`<span style="color:#64748b">${skipped} skipped</span>`);
  if (errors)  parts.push(`<span style="color:#ef4444">${errors} error${errors !== 1 ? 's' : ''}</span>`);

  toast.innerHTML = `
    <div style="font-family:'Inter',-apple-system,sans-serif;font-size:13px;line-height:1.6;">
      ${parts.join(' · ')}
    </div>
  `;

  document.body.appendChild(toast);
  animateIn(toast);

  setTimeout(() => animateOut(toast), 4000);
}

function showToast(message, type = 'info', duration = 3500) {
  const existing = document.getElementById(SA_TOAST_ID);
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = SA_TOAST_ID;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');

  const colors = {
    info:    { border: 'rgba(34,197,94,0.4)',  text: '#22c55e' },
    error:   { border: 'rgba(239,68,68,0.4)',  text: '#ef4444' },
    warning: { border: 'rgba(245,158,11,0.4)', text: '#f59e0b' },
  };
  const c = colors[type] || colors.info;

  Object.assign(toast.style, getToastBaseStyles());
  toast.style.borderColor = c.border;

  const icon = type === 'error' ? '⚠' : type === 'warning' ? '⚡' : '✦';
  toast.innerHTML = `
    <span style="font-size:16px;color:${c.text}">${icon}</span>
    <span style="font-family:'Inter',-apple-system,sans-serif;font-size:13px;color:#f1f5f9;">${escapeHtml(message)}</span>
  `;

  document.body.appendChild(toast);
  animateIn(toast);
  setTimeout(() => animateOut(toast), duration);
}

// ─────────────────────────────────────────────────────────────────────────────
// URL CHANGE WATCHER (for SPAs)
// ─────────────────────────────────────────────────────────────────────────────

function watchUrlChanges(callback) {
  let lastUrl = window.location.href;

  // history.pushState / replaceState interception
  const originalPush    = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);

  history.pushState = function (...args) {
    originalPush(...args);
    onUrlChange();
  };
  history.replaceState = function (...args) {
    originalReplace(...args);
    onUrlChange();
  };

  window.addEventListener('popstate', onUrlChange);

  function onUrlChange() {
    const newUrl = window.location.href;
    if (newUrl !== lastUrl) {
      lastUrl = newUrl;
      // Debounce: wait for new page DOM to settle
      setTimeout(callback, 800);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND COMMUNICATION
// ─────────────────────────────────────────────────────────────────────────────

function notifyBackground(action, data) {
  try {
    chrome.runtime.sendMessage({ action, data });
  } catch (_) { /* SW may be asleep — non-critical */ }
}

function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          // Service worker woke up — retry once
          setTimeout(() => {
            chrome.runtime.sendMessage(message, (r2) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else resolve(r2);
            });
          }, 300);
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function getToastBaseStyles() {
  return {
    position:      'fixed',
    bottom:        '24px',
    right:         '24px',
    zIndex:        '2147483647',
    background:    '#1e293b',
    border:        '1px solid rgba(34,197,94,0.35)',
    borderRadius:  '10px',
    padding:       '12px 16px',
    display:       'flex',
    alignItems:    'center',
    gap:           '10px',
    boxShadow:     '0 8px 32px rgba(0,0,0,0.5)',
    transform:     'translateY(80px)',
    opacity:       '0',
    transition:    'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease',
    pointerEvents: 'none',
    maxWidth:      '320px',
  };
}

function animateIn(el) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transform = 'translateY(0)';
    el.style.opacity   = '1';
  }));
}

function animateOut(el) {
  if (!el || !el.parentNode) return;
  el.style.transform = 'translateY(80px)';
  el.style.opacity   = '0';
  setTimeout(() => el?.remove(), 400);
}

function removeExistingUI() {
  document.getElementById(SA_PROGRESS_ID)?.remove();
  document.getElementById(SA_TOAST_ID)?.remove();
}

function ensureStyleTag(css, id) {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────────────────────────────────────
// AI MESSAGE HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns all screening questions detected on the current page.
 * Uses detectScreeningQuestions() from jd-extractor.js (injected before this).
 */
function handleGetScreeningQuestions(sendResponse) {
  try {
    const questions = detectScreeningQuestions();
    sendResponse({ success: true, questions });
  } catch (err) {
    sendResponse({ success: false, questions: [], error: err.message });
  }
}

/**
 * Finds the first visible cover letter textarea and fills it with
 * the AI-generated text using the human-like fill strategy from auto-filler.js.
 */
async function handleInjectCoverLetter(text, sendResponse) {
  if (!text) {
    sendResponse({ success: false, error: 'No text provided' });
    return;
  }

  // Try portal-specific cover letter selectors first
  const CL_SELECTORS = [
    'textarea[id*="coverLetter"]',
    'textarea[id*="cover-letter"]',
    'textarea[name="coverLetter"]',
    'textarea[name="cover_letter"]',
    'textarea[placeholder*="cover letter" i]',
    'textarea[placeholder*="Cover Letter" i]',
    'textarea[placeholder*="introduction" i]',
    'textarea[placeholder*="Tell us" i]',
    'textarea[aria-label*="cover" i]',
    // Generic large textarea fallback
    'textarea',
  ];

  let target = null;
  for (const sel of CL_SELECTORS) {
    const candidates = document.querySelectorAll(sel);
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      // Prefer larger textareas (cover letter boxes are usually tall)
      if (rect.width > 200 && !el.disabled && !el.readOnly) {
        target = el;
        break;
      }
    }
    if (target) break;
  }

  if (!target) {
    sendResponse({ success: false, error: 'No cover letter field found on this page' });
    return;
  }

  try {
    // Use the existing fillField function from auto-filler.js
    const portalMatch = _detectedPortal || detectCurrentPortal();
    const framework   = portalMatch?.config?.frameworkHint || 'react';
    await fillField(target, text, framework);
    showToast('Cover letter filled ✓', 'info', 2500);
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Fills a specific field identified by a CSS selector with the given value.
 * Used by the QA answerer to inject AI-generated answers.
 */
async function handleInjectFieldValue(selector, value, sendResponse) {
  if (!selector || !value) {
    sendResponse({ success: false, error: 'Missing selector or value' });
    return;
  }

  const el = document.querySelector(selector);
  if (!el) {
    sendResponse({ success: false, error: `Element not found: ${selector}` });
    return;
  }

  if (el.disabled || el.readOnly) {
    sendResponse({ success: false, error: 'Field is read-only' });
    return;
  }

  try {
    const portalMatch = _detectedPortal || detectCurrentPortal();
    const framework   = portalMatch?.config?.frameworkHint || 'react';
    await fillField(el, value, framework);
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-LOGGING OBSERVER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Watches the DOM for success messages indicating the application was submitted,
 * then logs the application to the tracker.
 */
function watchForSubmission(jobData) {
  const SUCCESS_PATTERNS = [
    /application submitted/i,
    /successfully applied/i,
    /application was sent/i,
    /application has been sent/i,
    /applied successfully/i,
    /your application was successful/i
  ];

  const observer = new MutationObserver((mutations) => {
    let found = false;
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        const text = mutation.target.innerText || mutation.target.textContent || '';
        if (SUCCESS_PATTERNS.some(p => p.test(text))) {
          found = true;
          break;
        }
      }
    }

    if (found) {
      observer.disconnect();
      sendToBackground({ action: 'LOG_APPLICATION', data: jobData }).catch(() => {});
      showToast('✅ Application logged to Arlo', 'info', 4000);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Disconnect after 15 minutes to avoid memory leaks
  setTimeout(() => observer.disconnect(), 15 * 60 * 1000);
}

