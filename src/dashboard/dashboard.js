/**
 * Arlo Dashboard — Phase 4
 *
 * Views: Overview (stats + charts) | Applications (table + filters) |
 *        Profile Editor | Upgrade
 */

import {
  getAll, getStats, getFiltered, updateStatus,
  deleteApplication, clearAll, exportCSV, STATUS_OPTIONS,
} from '../storage/job-tracker.js';
import { load as loadProfile, save as saveProfile, loadMeta, clearProfile } from '../storage/profile-store.js';
import { sanitizeProfileField, sanitizeText, escapeHtml } from '../security/sanitizer.js';
import { getCurrentUser, signOut, deleteAllData, exportDataAsJSON } from '../auth/auth.js';
import { logger, friendlyError } from '../utils/logger.js';
import { initiatePayment } from '../monetization/razorpay.js';

// ── State ──────────────────────────────────────────────────────────────────
let _profile   = null;
let _allJobs   = [];
let _filtered  = [];
let _page      = 1;
const PAGE_SIZE = 20;
let _charts    = {};

// ── Chart.js theme ────────────────────────────────────────────────────────
const CHART_DEFAULTS = {
  color:          '#94a3b8',
  borderColor:    '#334155',
  backgroundColor:'rgba(34,197,94,0.15)',
};

const PORTAL_COLORS = {
  LinkedIn:    '#4a9ad4',
  Naukri:      '#e05c3a',
  Internshala: '#00a5ec',
  Wellfound:   '#9b77e3',
  Unstop:      '#64b5f6',
  Other:       '#64748b',
};

const STATUS_COLORS = {
  'Applied':     '#22c55e',
  'Interview':   '#38bdf8',
  'Offer':       '#a855f7',
  'Rejected':    '#ef4444',
  'No Response': '#64748b',
};

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupChartDefaults();
  bindNavigation();
  bindFilters();
  bindProfileEditor();
  bindDangerZone();
  watchOnlineStatus();

  try {
    const [profile, meta, user] = await Promise.all([
      loadProfile(),
      loadMeta(),
      getCurrentUser(),
    ]);

    _profile = profile;

    // Sidebar user card
    const name = profile?.personal?.fullName ||
      `${profile?.personal?.firstName || ''} ${profile?.personal?.lastName || ''}`.trim() ||
      user?.email || 'You';
    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

    setEl('sidebarAvatar', initials);
    setEl('sidebarName',   truncate(name, 20));
    setEl('sidebarPlan',   `${meta?.plan || 'Free'} Plan`);

    // AI credits (from meta)
    const plan    = (meta?.plan || 'free').toLowerCase();
    const isPro   = plan === 'pro' || plan === 'premium';
    const aiLeft  = isPro ? '∞' : String(Math.max(0, 10 - (meta?.aiUsage?.coverLetter || 0)));
    setEl('statAICredits', aiLeft);

    const params = new URLSearchParams(window.location.search);
    const initialView = params.get('view') || 'overview';
    switchView(initialView);
  } catch (err) {
    logger.error('Dashboard init failed:', err.message);
    showToast(friendlyError(err), 'error');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────
function bindNavigation() {
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog(
      'Log out?',
      'Your profile stays encrypted on this device. You\'ll need to log in again for AI features.'
    );
    if (!confirmed) return;
    await signOut();
    showToast('Logged out', 'success');
    setTimeout(() => window.close(), 800);
  });
}

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const viewEl = document.getElementById(`view${capitalize(name)}`);
  if (viewEl) viewEl.style.display = 'block';

  document.querySelectorAll(`[data-view="${name}"]`).forEach(el => el.classList.add('active'));

  // Lazy-load views
  if (name === 'overview')     loadOverview();
  if (name === 'applications') loadApplicationsView();
  if (name === 'profile')      loadProfileEditor();
  if (name === 'upgrade')      loadUpgradeView();
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────
async function loadOverview() {
  try {
    const [stats, jobs] = await Promise.all([getStats(), getAll()]);
    _allJobs  = jobs;
    _filtered = jobs;

    setEl('statTotal',        stats.total);
    setEl('statWeek',         stats.thisWeek);
    setEl('statResponseRate', stats.responseRate + '%');

    renderCharts(stats);
    renderRecentTable(jobs.slice(0, 10));

    document.getElementById('btnExportCSV')?.addEventListener('click', doExportCSV);
    document.getElementById('btnExportCSV2')?.addEventListener('click', doExportCSV);
  } catch (err) {
    logger.error('loadOverview failed:', err.message);
    showToast(friendlyError(err), 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHARTS
// ─────────────────────────────────────────────────────────────────────────────
function setupChartDefaults() {
  if (!window.Chart) return;
  Chart.defaults.color           = CHART_DEFAULTS.color;
  Chart.defaults.borderColor     = CHART_DEFAULTS.borderColor;
  Chart.defaults.font.family     = "'Inter', -apple-system, sans-serif";
  Chart.defaults.font.size       = 12;
  Chart.defaults.plugins.legend.labels.color = '#94a3b8';
}

function renderCharts(stats) {
  if (!window.Chart) {
    logger.warn('Chart.js not loaded — charts skipped');
    return;
  }

  // Destroy existing before re-render
  Object.values(_charts).forEach(c => c?.destroy?.());
  _charts = {};

  // ── Weekly bar chart ─────────────────────────────────────────
  const weekCtx = document.getElementById('chartWeekly')?.getContext('2d');
  if (weekCtx) {
    _charts.weekly = new Chart(weekCtx, {
      type: 'bar',
      data: {
        labels:   stats.weeklyBuckets.map(b => b.label),
        datasets: [{
          label:           'Applications',
          data:            stats.weeklyBuckets.map(b => b.count),
          backgroundColor: 'rgba(34,197,94,0.5)',
          borderColor:     '#22c55e',
          borderWidth:     1,
          borderRadius:    4,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } },
          x: { grid: { color: 'rgba(51,65,85,0.5)' } },
        },
      },
    });
  }

  // ── Status donut chart ────────────────────────────────────────
  const statusCtx = document.getElementById('chartStatus')?.getContext('2d');
  if (statusCtx) {
    const labels = Object.keys(stats.byStatus).filter(k => stats.byStatus[k] > 0);
    const data   = labels.map(k => stats.byStatus[k]);
    const colors = labels.map(k => STATUS_COLORS[k] || '#64748b');

    _charts.status = new Chart(statusCtx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors.map(c => c + '33'),
          borderColor:     colors,
          borderWidth:     2,
        }],
      },
      options: {
        responsive: true,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, padding: 10, color: '#94a3b8' },
          },
        },
      },
    });
  }

  // ── Portal horizontal bar chart ───────────────────────────────
  const portalCtx = document.getElementById('chartPortals')?.getContext('2d');
  if (portalCtx) {
    const entries  = Object.entries(stats.byPortal).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const labels   = entries.map(([k]) => k);
    const data     = entries.map(([, v]) => v);
    const colors   = labels.map(l => (PORTAL_COLORS[l] || '#64748b') + '99');
    const borders  = labels.map(l => PORTAL_COLORS[l] || '#64748b');

    _charts.portals = new Chart(portalCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label:           'Applications',
          data,
          backgroundColor: colors,
          borderColor:     borders,
          borderWidth:     1,
          borderRadius:    4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { stepSize: 1 } },
          y: { grid: { display: false } },
        },
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RECENT TABLE (overview)
// ─────────────────────────────────────────────────────────────────────────────
function renderRecentTable(jobs) {
  const wrap = document.getElementById('recentTableWrap');
  if (!wrap) return;

  if (!jobs.length) {
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        <h3>No applications yet</h3>
        <p>Start filling forms on job portals and they'll appear here.</p>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Company</th><th>Role</th><th>Portal</th>
            <th>Date</th><th>Status</th><th class="col-score">Score</th>
          </tr>
        </thead>
        <tbody>${jobs.map(buildRecentRow).join('')}</tbody>
      </table>
    </div>`;
}

function buildRecentRow(job) {
  return `
    <tr>
      <td class="col-company">${escapeHtml(job.company || '—')}</td>
      <td class="col-role">${escapeHtml(job.title || '—')}</td>
      <td>${portalBadgeHtml(job.portal)}</td>
      <td>${fmtDate(job.date)}</td>
      <td><span class="status-badge ${statusClass(job.status)}">${escapeHtml(job.status)}</span></td>
      <td class="col-score">${scorePillHtml(job.matchScore)}</td>
    </tr>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATIONS TABLE
// ─────────────────────────────────────────────────────────────────────────────
function bindFilters() {
  ['filterStatus', 'filterPortal', 'filterDateFrom', 'filterDateTo'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', applyFiltersAndRender);
  });
  document.getElementById('btnClearFilters')?.addEventListener('click', () => {
    ['filterStatus', 'filterPortal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = 'all';
    });
    ['filterDateFrom', 'filterDateTo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    applyFiltersAndRender();
  });
}

async function loadApplicationsView() {
  _allJobs  = await getAll();
  _filtered = _allJobs;
  _page     = 1;
  renderApplicationsTable();
}

function applyFiltersAndRender() {
  const status   = document.getElementById('filterStatus')?.value   || 'all';
  const portal   = document.getElementById('filterPortal')?.value   || 'all';
  const dateFrom = document.getElementById('filterDateFrom')?.value || '';
  const dateTo   = document.getElementById('filterDateTo')?.value   || '';

  _filtered = _allJobs.filter(j => {
    if (status !== 'all' && j.status !== status) return false;
    if (portal !== 'all' && !j.portal?.toLowerCase().includes(portal)) return false;
    if (dateFrom && new Date(j.date) < new Date(dateFrom)) return false;
    if (dateTo   && new Date(j.date) > new Date(dateTo + 'T23:59:59')) return false;
    return true;
  });

  _page = 1;
  renderApplicationsTable();
}

function renderApplicationsTable() {
  const tbody     = document.getElementById('appsTableBody');
  const info      = document.getElementById('paginationInfo');
  const btnsWrap  = document.getElementById('paginationBtns');

  if (!tbody) return;

  const total    = _filtered.length;
  const pages    = Math.ceil(total / PAGE_SIZE) || 1;
  const start    = (_page - 1) * PAGE_SIZE;
  const paginated= _filtered.slice(start, start + PAGE_SIZE);

  if (!paginated.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="padding:40px;text-align:center;color:var(--text-muted);">
          No applications match your filters.
        </td>
      </tr>`;
    if (info) info.textContent = '0 applications';
    if (btnsWrap) btnsWrap.innerHTML = '';
    return;
  }

  tbody.innerHTML = paginated.map(job => buildAppRow(job)).join('');

  // Bind status selects
  tbody.querySelectorAll('.status-change-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const id     = e.target.dataset.id;
      const status = e.target.value;
      try {
        await updateStatus(id, status);
        // Re-colour the select
        e.target.className = `status-change-select ${statusClass(status)}`;
        showToast(`Status updated to ${status}`, 'success');
      } catch (err) {
        showToast(friendlyError(err), 'error');
      }
    });
  });

  // Bind delete buttons
  tbody.querySelectorAll('.btn-delete-row').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id      = btn.dataset.id;
      const company = btn.dataset.company;
      const ok      = await confirmDialog(
        'Delete application?',
        `Remove ${escapeHtml(company)} from your tracker. This cannot be undone.`
      );
      if (!ok) return;
      await deleteApplication(id);
      _allJobs   = await getAll();
      _filtered  = _filtered.filter(j => j.id !== id);
      renderApplicationsTable();
      showToast('Application deleted', 'success');
    });
  });

  // Pagination info
  if (info) info.textContent = `${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total}`;

  // Pagination buttons
  if (btnsWrap) {
    btnsWrap.innerHTML = '';
    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.textContent = '←';
    prevBtn.disabled = _page === 1;
    prevBtn.addEventListener('click', () => { _page--; renderApplicationsTable(); });
    btnsWrap.appendChild(prevBtn);

    for (let i = 1; i <= pages; i++) {
      if (pages > 7 && Math.abs(i - _page) > 2 && i !== 1 && i !== pages) continue;
      const btn = document.createElement('button');
      btn.className = `page-btn${i === _page ? ' active' : ''}`;
      btn.textContent = i;
      btn.addEventListener('click', () => { _page = i; renderApplicationsTable(); });
      btnsWrap.appendChild(btn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.textContent = '→';
    nextBtn.disabled = _page === pages;
    nextBtn.addEventListener('click', () => { _page++; renderApplicationsTable(); });
    btnsWrap.appendChild(nextBtn);
  }
}

function buildAppRow(job) {
  const options = STATUS_OPTIONS.map(s =>
    `<option value="${s}"${job.status === s ? ' selected' : ''}>${escapeHtml(s)}</option>`
  ).join('');

  return `
    <tr>
      <td class="col-company">${escapeHtml(job.company || '—')}</td>
      <td class="col-role" title="${escapeHtml(job.title)}">${escapeHtml(truncate(job.title || '—', 35))}</td>
      <td>${portalBadgeHtml(job.portal)}</td>
      <td>${fmtDate(job.date)}</td>
      <td>
        <select class="status-change-select status-select ${statusClass(job.status)}"
                data-id="${escapeHtml(job.id)}"
                aria-label="Change status for ${escapeHtml(job.company)}">
          ${options}
        </select>
      </td>
      <td class="col-score">${scorePillHtml(job.matchScore)}</td>
      <td class="col-actions">
        <button class="btn-icon-only btn-delete-row"
                data-id="${escapeHtml(job.id)}"
                data-company="${escapeHtml(job.company)}"
                title="Delete" aria-label="Delete application">🗑</button>
      </td>
    </tr>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE EDITOR
// ─────────────────────────────────────────────────────────────────────────────
function loadProfileEditor() {
  if (!_profile) return;

  const p    = _profile.personal    || {};
  const prefs= _profile.preferences || {};

  setVal('pe_firstName',   p.firstName);
  setVal('pe_lastName',    p.lastName);
  setVal('pe_email',       p.email);
  setVal('pe_phone',       p.phone);
  setVal('pe_location',    p.location);
  setVal('pe_headline',    p.headline);
  setVal('pe_summary',     p.summary);
  setVal('pe_linkedin',    p.linkedinUrl);
  setVal('pe_portfolio',   p.portfolioUrl);

  setVal('pe_totalExp',    prefs.totalExperience);
  setVal('pe_noticePeriod',prefs.noticePeriod);
  setVal('pe_currentCTC',  prefs.currentCTC);
  setVal('pe_expectedCTC', prefs.expectedCTC);

  const resumeInfo = document.getElementById('currentResumeInfo');
  if (resumeInfo && _profile.resumeFileName) {
    resumeInfo.textContent = `📄 ${escapeHtml(_profile.resumeFileName)}`;
  }
}

function bindProfileEditor() {
  document.getElementById('btnSaveProfile')?.addEventListener('click', saveProfileEdits);

  // Resume re-upload
  document.getElementById('resumeReupload')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/pdf') {
      showToast('Please select a PDF file', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('File must be under 5MB', 'error');
      return;
    }

    const status = document.getElementById('resumeUploadStatus');
    if (status) { status.style.color = 'var(--warning)'; status.textContent = '⏳ Uploading…'; }

    try {
      // Parse PDF text via pdf.js (same as onboarding)
      const text = await parsePDF(file);
      if (_profile) {
        _profile.resumeFileName = file.name;
        _profile.resumeText     = text;
        await saveProfile(_profile);
        document.getElementById('currentResumeInfo').textContent = `📄 ${escapeHtml(file.name)}`;
        if (status) { status.style.color = 'var(--accent)'; status.textContent = '✓ Resume updated'; }
        showToast('Resume updated', 'success');
      }
    } catch (err) {
      if (status) { status.style.color = 'var(--error)'; status.textContent = '⚠ Upload failed'; }
      showToast(friendlyError(err), 'error');
    }
  });
}

async function saveProfileEdits() {
  // Collect + validate
  const fields = [
    ['firstName',   document.getElementById('pe_firstName')?.value],
    ['lastName',    document.getElementById('pe_lastName')?.value],
    ['email',       document.getElementById('pe_email')?.value],
    ['phone',       document.getElementById('pe_phone')?.value],
    ['linkedinUrl', document.getElementById('pe_linkedin')?.value],
    ['portfolioUrl',document.getElementById('pe_portfolio')?.value],
  ];

  let hasError = false;
  const sanitized = {};
  for (const [field, value] of fields) {
    const result = sanitizeProfileField(field, value || '');
    if (!result.valid && value) {  // empty optional fields are fine
      const errEl = document.getElementById(`err_${field}`);
      if (errEl) errEl.textContent = result.error || 'Invalid';
      hasError = true;
    } else {
      const errEl = document.getElementById(`err_${field}`);
      if (errEl) errEl.textContent = '';
    }
    sanitized[field] = result.value;
  }

  if (hasError) {
    showToast('Please fix the errors above', 'error');
    return;
  }

  // Update profile
  if (!_profile) _profile = {};
  if (!_profile.personal) _profile.personal = {};
  Object.assign(_profile.personal, {
    firstName:    sanitized.firstName,
    lastName:     sanitized.lastName,
    fullName:     `${sanitized.firstName} ${sanitized.lastName}`.trim(),
    email:        sanitized.email,
    phone:        sanitized.phone,
    location:     sanitizeText(document.getElementById('pe_location')?.value || ''),
    headline:     sanitizeText(document.getElementById('pe_headline')?.value || ''),
    summary:      sanitizeText(document.getElementById('pe_summary')?.value  || ''),
    linkedinUrl:  sanitized.linkedinUrl,
    portfolioUrl: sanitized.portfolioUrl,
  });

  if (!_profile.preferences) _profile.preferences = {};
  Object.assign(_profile.preferences, {
    totalExperience: document.getElementById('pe_totalExp')?.value       || '',
    noticePeriod:    document.getElementById('pe_noticePeriod')?.value   || '',
    currentCTC:      sanitizeText(document.getElementById('pe_currentCTC')?.value  || ''),
    expectedCTC:     sanitizeText(document.getElementById('pe_expectedCTC')?.value || ''),
  });

  try {
    await saveProfile(_profile);
    showToast('Profile saved ✓', 'success');
    // Update sidebar
    const name = _profile.personal.fullName || 'You';
    setEl('sidebarAvatar', name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase());
    setEl('sidebarName', truncate(name, 20));
  } catch (err) {
    showToast(friendlyError(err), 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DANGER ZONE
// ─────────────────────────────────────────────────────────────────────────────
function bindDangerZone() {
  document.getElementById('btnExportData')?.addEventListener('click', async () => {
    try {
      const profile = await loadProfile();
      const jobs    = await getAll();
      const json    = exportDataAsJSON(profile, jobs);
      downloadBlob(json, 'Arlo-data.json', 'application/json');
      showToast('Data exported', 'success');
    } catch (err) {
      showToast(friendlyError(err), 'error');
    }
  });

  document.getElementById('btnDeleteAllData')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog(
      'Delete ALL your data?',
      'This permanently removes your encrypted profile and all application history from this device and our servers. This cannot be undone.'
    );
    if (!confirmed) return;

    try {
      const user = await getCurrentUser();
      await clearAll();
      await deleteAllData(user?.uid);
      showToast('All data deleted', 'success');
      setTimeout(() => window.close(), 1500);
    } catch (err) {
      showToast(friendlyError(err), 'error');
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV EXPORT
// ─────────────────────────────────────────────────────────────────────────────
async function doExportCSV() {
  try {
    const csv  = await exportCSV();
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(csv, `Arlo-applications-${date}.csv`, 'text/csv');
    showToast('CSV exported', 'success');
  } catch (err) {
    showToast(friendlyError(err), 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ONLINE / OFFLINE BANNER
// ─────────────────────────────────────────────────────────────────────────────
function watchOnlineStatus() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;

  const update = () => {
    banner.classList.toggle('visible', !navigator.onLine);
  };

  update();
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
}

// ─────────────────────────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '⚠' : '⚡';
  toast.textContent = `${icon} ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateX(60px)';
    toast.style.transition= 'opacity .3s, transform .3s';
    setTimeout(() => toast.remove(), 320);
  }, 3200);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIRM DIALOG
// ─────────────────────────────────────────────────────────────────────────────
function confirmDialog(title, body) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmDialog');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmBody').textContent  = body;
    overlay.style.display = 'flex';

    const cleanup = (result) => {
      overlay.style.display = 'none';
      okBtn.removeEventListener('click', onOK);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };

    const okBtn     = document.getElementById('confirmOK');
    const cancelBtn = document.getElementById('confirmCancel');
    const onOK      = () => cleanup(true);
    const onCancel  = () => cleanup(false);

    okBtn.addEventListener('click',     onOK);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    }, { once: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF PARSER (pdf.js must be loaded)
// ─────────────────────────────────────────────────────────────────────────────
async function parsePDF(file) {
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  if (!pdfjsLib) throw new Error('pdf.js not loaded — resume parsing unavailable');

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const buffer = await file.arrayBuffer();
  const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;
  let text     = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function portalBadgeHtml(portal) {
  const map = {
    linkedin:    ['LinkedIn',    'portal-linkedin'],
    naukri:      ['Naukri',      'portal-naukri'],
    internshala: ['Internshala', 'portal-internshala'],
    wellfound:   ['Wellfound',   'portal-wellfound'],
    unstop:      ['Unstop',      'portal-unstop'],
  };
  const key   = Object.keys(map).find(k => (portal || '').toLowerCase().includes(k));
  const [name, cls] = key ? map[key] : [escapeHtml(portal || 'Other'), 'portal-other'];
  return `<span class="portal-badge ${cls}">${name}</span>`;
}

function scorePillHtml(score) {
  if (score == null || score === undefined) return `<span class="score-pill score-none">—</span>`;
  const cls = score >= 75 ? 'score-high' : score >= 50 ? 'score-mid' : 'score-low';
  return `<span class="score-pill ${cls}">${score}</span>`;
}

function statusClass(status) {
  return 'status-' + (status || 'Applied').replace(/\s+/g, '_');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val ?? '');
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el && val !== undefined && val !== null) el.value = val;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); }, 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// UPGRADE & REFERRAL VIEW
// ─────────────────────────────────────────────────────────────────────────────
let _paymentInterval = 'monthly';

async function loadUpgradeView() {
  // Toggle buttons
  const btnMonthly = document.getElementById('btnToggleMonthly');
  const btnYearly  = document.getElementById('btnToggleYearly');
  
  if (btnMonthly && btnYearly) {
    btnMonthly.onclick = () => {
      _paymentInterval = 'monthly';
      btnMonthly.className = 'btn active';
      btnMonthly.style.background = '#1e293b';
      btnMonthly.style.color = 'white';
      
      btnYearly.className = 'btn';
      btnYearly.style.background = 'transparent';
      btnYearly.style.color = '#94a3b8';
      
      setEl('pricePro', '₹199');
      setEl('pricePremium', '₹499');
    };

    btnYearly.onclick = () => {
      _paymentInterval = 'yearly';
      btnYearly.className = 'btn active';
      btnYearly.style.background = '#1e293b';
      btnYearly.style.color = 'white';
      
      btnMonthly.className = 'btn';
      btnMonthly.style.background = 'transparent';
      btnMonthly.style.color = '#94a3b8';
      
      setEl('pricePro', '₹1499');
      setEl('pricePremium', '₹3999');
    };
  }

  // Payment Buttons
  document.getElementById('btnBuyPro')?.addEventListener('click', async (e) => {
    e.target.textContent = 'Opening...';
    try {
      await initiatePayment('pro', _paymentInterval, 'razorpay'); // Or pass stripe based on config
    } catch (err) {
      showToast(err.message, 'error');
      e.target.textContent = 'Upgrade to Pro';
    }
  });

  document.getElementById('btnBuyPremium')?.addEventListener('click', async (e) => {
    e.target.textContent = 'Opening...';
    try {
      await initiatePayment('premium', _paymentInterval, 'razorpay');
    } catch (err) {
      showToast(err.message, 'error');
      e.target.textContent = 'Get Premium';
    }
  });

  // Referral UI
  try {
    const user = await getCurrentUser();
    if (!user) return;
    const token = await user.getIdToken();
    
    // Generate/fetch referral code from our backend
    const BACKEND_URL = 'https://your-backend.railway.app'; // use config
    const res = await fetch(`${BACKEND_URL}/api/user/referral/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ uid: user.uid })
    });
    
    if (res.ok) {
      const data = await res.json();
      const refLink = `https://Arlo.app/r/${data.code}`;
      setVal('refLinkInput', refLink);
      
      document.getElementById('btnCopyRef').onclick = () => {
        navigator.clipboard.writeText(refLink);
        showToast('Link copied!', 'success');
      };
      
      // We could also fetch user doc from firestore to get exact referral count
      // Assuming meta already has it loaded or we get it from loadMeta()
      const meta = await loadMeta();
      const count = meta.referralCount || 0;
      setEl('refProgressText', `You've referred ${count}/3 users`);
      setEl('refRemainingText', `— ${Math.max(0, 3 - count)} more for free Pro!`);
    }
  } catch(err) {
    console.error('Failed to load referral info:', err);
  }
}

