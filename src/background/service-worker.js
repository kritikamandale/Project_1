/**
 * Arlo Service Worker (Manifest V3)
 *
 * Responsibilities:
 *  - Message routing between popup ↔ content scripts
 *  - Tab registry: tracks which tabs are on job portals
 *  - Extension badge: updates icon badge with active-portal count
 *  - Auth token refresh scheduling (Phase 2 stub)
 *  - Install / update lifecycle
 *
 * This script runs as an ES module (manifest: "type": "module").
 */

import { load, saveMeta, loadMeta } from '../storage/profile-store.js';
import { logApplication, getApplicationStats } from '../storage/job-tracker.js';

// ── Portal Tab Registry ────────────────────────────────────────────────────
// Maps tabId → { portal, portalName, url, formOpen, fieldCount, lastSeen }
const portalTabs = new Map();

// Known portal hostnames (must match manifest host_permissions)
const PORTAL_HOSTNAMES = [
  'linkedin.com',
  'naukri.com',
  'internshala.com',
  'wellfound.com',
  'unstop.com',
];

// ── Install / Update ───────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[Arlo] Extension installed — opening onboarding');
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/onboarding/onboarding.html'),
    });
    // Set initial badge
    setBadgeText('');
  }

  if (details.reason === 'update') {
    const version = chrome.runtime.getManifest().version;
    console.log(`[Arlo] Extension updated to v${version}`);
  }
});

// ── Tab Tracking ───────────────────────────────────────────────────────────

// Track when a tab navigates — check if it's a portal
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  const isPortal = PORTAL_HOSTNAMES.some(h => tab.url.includes(h));

  if (isPortal) {
    const portal = PORTAL_HOSTNAMES.find(h => tab.url.includes(h)) || 'unknown';
    portalTabs.set(tabId, {
      portal,
      portalName: getPortalDisplayName(portal),
      url:        tab.url,
      formOpen:   false,
      fieldCount: 0,
      lastSeen:   Date.now(),
    });
    updateBadge();
  } else {
    // Tab navigated away from a portal
    if (portalTabs.has(tabId)) {
      portalTabs.delete(tabId);
      updateBadge();
    }
  }
});

// Clean up registry when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (portalTabs.has(tabId)) {
    portalTabs.delete(tabId);
    updateBadge();
  }
});

// ── Message Router ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, data } = message;
  const tabId = sender.tab?.id;

  switch (action) {

    // ── Profile ───────────────────────────────────────────────────────────
    case 'GET_PROFILE':
      handleGetProfile(sendResponse);
      return true;

    // ── Application logging ───────────────────────────────────────────────
    case 'LOG_APPLICATION':
      handleLogApplication(data, sendResponse);
      return true;

    case 'GET_STATS':
      handleGetStats(sendResponse);
      return true;

    // ── Portal / form detection updates from content script ───────────────
    case 'CONTENT_READY':
      if (tabId && data) {
        const entry = portalTabs.get(tabId) || {};
        portalTabs.set(tabId, {
          ...entry,
          portal:     data.portal,
          portalName: data.portalName,
          url:        data.url,
          formOpen:   data.formOpen,
          lastSeen:   Date.now(),
        });
        updateBadge();
      }
      sendResponse({ success: true });
      break;

    case 'PORTAL_FORM_DETECTED':
      if (tabId && data) {
        const entry = portalTabs.get(tabId) || {};
        portalTabs.set(tabId, {
          ...entry,
          formOpen:   true,
          fieldCount: data.fieldCount || 0,
          lastSeen:   Date.now(),
        });
        // Badge: green dot (form open)
        setTabBadge(tabId, '✦');
        updateBadge();
      }
      sendResponse({ success: true });
      break;

    case 'FILL_COMPLETE':
      if (tabId && data) {
        handleFillComplete(tabId, data, sendResponse);
        return true;
      }
      sendResponse({ success: true });
      break;

    // ── Navigation ────────────────────────────────────────────────────────
    case 'OPEN_ONBOARDING':
      chrome.tabs.create({
        url: chrome.runtime.getURL('src/onboarding/onboarding.html'),
      });
      sendResponse({ success: true });
      break;

    case 'OPEN_DASHBOARD':
      chrome.tabs.create({
        url: chrome.runtime.getURL('src/dashboard/dashboard.html'),
      });
      sendResponse({ success: true });
      break;

    // ── Tab registry query (used by popup) ────────────────────────────────
    case 'GET_TAB_INFO':
      handleGetTabInfo(tabId, sendResponse);
      return true;

    // ── AI token storage (set by auth module, read by popup) ──────────────
    case 'SET_AUTH_TOKEN':
      handleSetAuthToken(data?.token, sendResponse);
      return true;

    case 'GET_AUTH_TOKEN':
      handleGetAuthToken(sendResponse);
      return true;

    case 'CLEAR_AUTH_TOKEN':
      handleClearAuthToken(sendResponse);
      return true;

    default:
      sendResponse({ error: `Unknown action: ${action}` });
  }
});

// ── Handler implementations ────────────────────────────────────────────────

async function handleGetProfile(sendResponse) {
  try {
    const profile = await load();
    sendResponse({ success: true, profile });
  } catch (err) {
    console.error('[Arlo SW] GET_PROFILE failed:', err.message);
    sendResponse({ success: false, error: err.message });
  }
}

async function handleLogApplication(data, sendResponse) {
  try {
    await logApplication(data);

    // Increment creditsUsed in metadata
    const meta = await loadMeta();
    await saveMeta({
      ...meta,
      creditsUsed: (meta.creditsUsed || 0) + 1,
    });

    sendResponse({ success: true });
  } catch (err) {
    console.error('[Arlo SW] LOG_APPLICATION failed:', err.message);
    sendResponse({ success: false, error: err.message });
  }
}

async function handleGetStats(sendResponse) {
  try {
    const stats = await getApplicationStats();
    sendResponse({ success: true, stats });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleFillComplete(tabId, data, sendResponse) {
  try {
    const entry = portalTabs.get(tabId) || {};
    portalTabs.set(tabId, { ...entry, lastFilled: Date.now(), lastFillCount: data.filled });

    // Update stats badge
    const stats = await getApplicationStats();
    setBadgeText(String(stats.today || ''));

    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleGetTabInfo(tabId, sendResponse) {
  try {
    // Get currently active tab if tabId is missing (called from popup)
    let id = tabId;
    if (!id) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      id = tab?.id;
    }

    const info = id ? portalTabs.get(id) : null;
    sendResponse({ success: true, tabInfo: info || null });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ── Badge Utilities ────────────────────────────────────────────────────────

/**
 * Updates the extension icon badge showing how many portal tabs are open.
 * Green badge when at least one tab has a form open, grey otherwise.
 */
async function updateBadge() {
  const openForms   = [...portalTabs.values()].filter(t => t.formOpen).length;
  const totalPortal = portalTabs.size;

  if (openForms > 0) {
    // A form is detected — show green badge with count
    await chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    setBadgeText(openForms > 1 ? String(openForms) : '✦');
  } else if (totalPortal > 0) {
    // On portal page, no form open yet
    await chrome.action.setBadgeBackgroundColor({ color: '#475569' });
    setBadgeText('');
  } else {
    // Not on any portal
    setBadgeText('');
  }
}

function setBadgeText(text) {
  chrome.action.setBadgeText({ text }).catch(() => {});
}

function setTabBadge(tabId, text) {
  chrome.action.setBadgeText({ text, tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId }).catch(() => {});
}

function getPortalDisplayName(hostname) {
  const names = {
    'linkedin.com':    'LinkedIn',
    'naukri.com':      'Naukri',
    'internshala.com': 'Internshala',
    'wellfound.com':   'Wellfound',
    'unstop.com':      'Unstop',
  };
  return names[hostname] || hostname;
}

// ── Auth Token Handlers ────────────────────────────────────────────────────

const AUTH_TOKEN_KEY = 'sa_auth_token';

async function handleSetAuthToken(token, sendResponse) {
  try {
    await chrome.storage.local.set({ [AUTH_TOKEN_KEY]: token });
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleGetAuthToken(sendResponse) {
  try {
    const result = await chrome.storage.local.get([AUTH_TOKEN_KEY]);
    sendResponse({ success: true, token: result[AUTH_TOKEN_KEY] || null });
  } catch (err) {
    sendResponse({ success: false, token: null });
  }
}

async function handleClearAuthToken(sendResponse) {
  try {
    await chrome.storage.local.remove([AUTH_TOKEN_KEY]);
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ── Auth Token Refresh (Phase 4) ───────────────────────────────────────────
// chrome.alarms.create('tokenRefresh', { periodInMinutes: 55 });
// chrome.alarms.onAlarm.addListener(async (alarm) => {
//   if (alarm.name === 'tokenRefresh') {
//     const { refreshToken } = await import('../auth/session.js');
//     await refreshToken();
//   }
// });

