/**
 * Arlo Job Application Tracker
 *
 * Local-first: all data lives in chrome.storage.local.
 * Firebase sync is additive — works fully offline.
 *
 * Data shape per application:
 * {
 *   id:         string   (UUID)
 *   title:      string   job title / role
 *   company:    string
 *   portal:     string   'linkedin.com' | 'naukri.com' | ...
 *   url:        string   application URL
 *   location:   string
 *   matchScore: number   0-100, optional
 *   status:     string   'Applied' | 'Interview' | 'Offer' | 'Rejected' | 'No Response'
 *   date:       string   ISO timestamp logged at fill time
 *   updatedAt:  string   ISO timestamp of last status change
 *   synced:     boolean  true once pushed to Firestore
 * }
 */

const JOBS_KEY    = 'sa_jobs_log';
const MAX_STORED  = 500;

export const STATUS_OPTIONS = [
  'Applied',
  'Interview',
  'Offer',
  'Rejected',
  'No Response',
];

// ── Write ──────────────────────────────────────────────────────────────────

/**
 * Logs a new job application.
 * @param {object} job - { title, company, portal, url, location, matchScore }
 * @returns {Promise<string>} The new application's ID
 */
export async function logApplication(job) {
  const jobs = await getAll();

  const entry = {
    id:         crypto.randomUUID(),
    title:      _clean(job.title    || job.role || ''),
    company:    _clean(job.company  || ''),
    portal:     _clean(job.portal   || ''),
    url:        _cleanUrl(job.url   || ''),
    location:   _clean(job.location || ''),
    matchScore: typeof job.matchScore === 'number' ? Math.round(job.matchScore) : null,
    status:     'Applied',
    date:       new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
    synced:     false,
  };

  jobs.unshift(entry);
  const trimmed = jobs.slice(0, MAX_STORED);

  await _set(trimmed);
  return entry.id;
}

/**
 * Updates the status of an application.
 * @param {string} id
 * @param {string} status — must be one of STATUS_OPTIONS
 * @returns {Promise<void>}
 */
export async function updateStatus(id, status) {
  if (!STATUS_OPTIONS.includes(status)) {
    throw new Error(`Invalid status: ${status}. Must be one of ${STATUS_OPTIONS.join(', ')}`);
  }

  const jobs = await getAll();
  const idx  = jobs.findIndex(j => j.id === id);
  if (idx === -1) throw new Error(`Application ${id} not found`);

  jobs[idx] = { ...jobs[idx], status, updatedAt: new Date().toISOString(), synced: false };
  await _set(jobs);
}

/**
 * Deletes a single application by ID.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteApplication(id) {
  const jobs    = await getAll();
  const updated = jobs.filter(j => j.id !== id);
  await _set(updated);
}

/**
 * Wipes all stored applications.
 * @returns {Promise<void>}
 */
export async function clearAll() {
  await _set([]);
}

// ── Read ───────────────────────────────────────────────────────────────────

/**
 * Returns all applications sorted newest-first.
 * @returns {Promise<Array>}
 */
export async function getAll() {
  return new Promise(resolve => {
    chrome.storage.local.get([JOBS_KEY], result => {
      const raw = result[JOBS_KEY];
      resolve(Array.isArray(raw) ? raw : []);
    });
  });
}

/**
 * Alias kept for backward compat with Phase 1/2 callers.
 */
export const getApplications = getAll;

/**
 * Returns applications filtered by field + value.
 * @param {object} filters - { portal?, status?, dateFrom?, dateTo? }
 * @returns {Promise<Array>}
 */
export async function getFiltered(filters = {}) {
  let jobs = await getAll();

  if (filters.portal && filters.portal !== 'all') {
    jobs = jobs.filter(j => j.portal.includes(filters.portal));
  }

  if (filters.status && filters.status !== 'all') {
    jobs = jobs.filter(j => j.status === filters.status);
  }

  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime();
    jobs = jobs.filter(j => new Date(j.date).getTime() >= from);
  }

  if (filters.dateTo) {
    const to = new Date(filters.dateTo).getTime() + 86_400_000; // inclusive
    jobs = jobs.filter(j => new Date(j.date).getTime() <= to);
  }

  return jobs;
}

/**
 * Returns aggregated stats used by popup + dashboard.
 * @returns {Promise<object>}
 */
export async function getStats() {
  const jobs = await getAll();
  const now  = new Date();

  const todayStr   = now.toDateString();
  const thisMonth  = now.getMonth();
  const thisYear   = now.getFullYear();
  const weekAgo    = Date.now() - 7 * 86_400_000;

  const today     = jobs.filter(j => new Date(j.date).toDateString() === todayStr).length;
  const thisWeek  = jobs.filter(j => new Date(j.date).getTime() >= weekAgo).length;
  const month     = jobs.filter(j => {
    const d = new Date(j.date);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).length;

  // Status breakdown
  const byStatus = {};
  STATUS_OPTIONS.forEach(s => { byStatus[s] = 0; });
  jobs.forEach(j => {
    if (byStatus[j.status] !== undefined) byStatus[j.status]++;
  });

  // Portal breakdown
  const byPortal = {};
  jobs.forEach(j => {
    const p = _portalShortName(j.portal);
    byPortal[p] = (byPortal[p] || 0) + 1;
  });

  // Weekly buckets (last 8 weeks) for bar chart
  const weeklyBuckets = _buildWeeklyBuckets(jobs, 8);

  // Response rate = (Interview + Offer) / total, if any
  const responded  = (byStatus['Interview'] || 0) + (byStatus['Offer'] || 0);
  const responseRate = jobs.length > 0
    ? Math.round((responded / jobs.length) * 100)
    : 0;

  return {
    total:        jobs.length,
    today,
    thisWeek,
    month,
    byStatus,
    byPortal,
    weeklyBuckets,
    responseRate,
  };
}

// Backward-compat alias
export async function getApplicationStats() {
  const s = await getStats();
  return { today: s.today, month: s.month, week: s.thisWeek };
}

/**
 * Exports all applications as a CSV string.
 * @returns {Promise<string>}
 */
export async function exportCSV() {
  const jobs = await getAll();

  const headers = ['Company', 'Role', 'Portal', 'Date Applied', 'Status', 'Match Score', 'Location', 'URL'];
  const rows = jobs.map(j => [
    _csvCell(j.company),
    _csvCell(j.title),
    _csvCell(_portalShortName(j.portal)),
    _csvCell(_formatDate(j.date)),
    _csvCell(j.status),
    j.matchScore != null ? j.matchScore : '',
    _csvCell(j.location),
    _csvCell(j.url),
  ]);

  return [headers, ...rows].map(r => r.join(',')).join('\n');
}

// ── Firestore Sync (online) ────────────────────────────────────────────────

/**
 * Pushes all unsynced applications to Firestore.
 * Stores only anonymised data — no PII.
 * Called by service worker when online.
 *
 * @param {string} uid  Firebase user ID
 * @returns {Promise<number>} count synced
 */
export async function syncToFirestore(uid) {
  if (!uid) return 0;

  const jobs    = await getAll();
  const unsynced = jobs.filter(j => !j.synced);
  if (!unsynced.length) return 0;

  try {
    // Dynamic import so this module works without Firebase in tests
    const { default: admin } = await import('../lib/firestore-client.js').catch(() => null);
    if (!admin) return 0; // Firebase not configured

    const db = admin.firestore();
    const batch = db.batch();

    unsynced.forEach(job => {
      const ref = db
        .collection('users').doc(uid)
        .collection('applications').doc(job.id);

      // Only non-PII fields go to Firestore
      batch.set(ref, {
        portal:     job.portal,
        status:     job.status,
        matchScore: job.matchScore,
        date:       job.date,
        updatedAt:  job.updatedAt,
      }, { merge: true });
    });

    await batch.commit();

    // Mark synced locally
    const updated = jobs.map(j =>
      unsynced.find(u => u.id === j.id) ? { ...j, synced: true } : j
    );
    await _set(updated);

    return unsynced.length;
  } catch (err) {
    console.warn('[Arlo] Firestore sync failed:', err.message);
    return 0;
  }
}

// ── Private helpers ────────────────────────────────────────────────────────

function _set(jobs) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [JOBS_KEY]: jobs }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function _clean(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, 200);
}

function _cleanUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href.slice(0, 500);
  } catch { return ''; }
}

function _csvCell(val) {
  const s = String(val || '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function _portalShortName(portal) {
  const map = {
    'linkedin.com':    'LinkedIn',
    'naukri.com':      'Naukri',
    'internshala.com': 'Internshala',
    'wellfound.com':   'Wellfound',
    'unstop.com':      'Unstop',
  };
  for (const [k, v] of Object.entries(map)) {
    if (portal && portal.includes(k)) return v;
  }
  return portal || 'Other';
}

function _formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return iso || ''; }
}

/**
 * Groups jobs into weekly buckets for the bar chart.
 * Returns array of { label: 'Wk 1', count: N } newest-last.
 */
function _buildWeeklyBuckets(jobs, numWeeks) {
  const now    = Date.now();
  const MS_WEEK = 7 * 86_400_000;
  const buckets = [];

  for (let i = numWeeks - 1; i >= 0; i--) {
    const from  = now - (i + 1) * MS_WEEK;
    const to    = now - i       * MS_WEEK;
    const label = i === 0 ? 'This wk' : `${i}w ago`;
    const count = jobs.filter(j => {
      const t = new Date(j.date).getTime();
      return t >= from && t < to;
    }).length;
    buckets.push({ label, count });
  }
  return buckets;
}

