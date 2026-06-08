/**
 * Arlo Form Detector
 *
 * Responsibilities:
 *  1. detectPortal()     — identify which job site + confirm apply form is open
 *  2. findFormFields()   — return structured map of { fieldKey → DOMElement }
 *  3. Pierce iframes and attempt shadow DOM traversal where needed
 *  4. Notify background service worker when a portal form is detected
 *
 * This file is injected as a plain content script (not ES module).
 * portal-configs.js is injected BEFORE this file so PORTAL_CONFIGS,
 * detectCurrentPortal, and getAllSelectorsForField are globals.
 */

// ── Generic heuristic patterns (fallback when portal config doesn't match) ──
const HEURISTIC_PATTERNS = {
  firstName:       [/first.?name/i, /fname/i, /given.?name/i],
  lastName:        [/last.?name/i,  /lname/i, /family.?name/i, /surname/i],
  fullName:        [/^name$/i, /full.?name/i, /your.?name/i, /applicant.?name/i],
  email:           [/e.?mail/i, /email.?address/i],
  phone:           [/phone/i, /mobile/i, /contact.?no/i, /cell/i, /whatsapp/i],
  location:        [/location/i, /^city$/i, /current.?location/i, /address/i],
  headline:        [/headline/i, /current.?title/i, /designation/i],
  linkedinUrl:     [/linkedin/i, /li.?url/i, /li.?profile/i],
  portfolioUrl:    [/portfolio/i, /website/i, /github/i, /personal.?url/i],
  coverLetter:     [/cover.?letter/i, /why.?apply/i, /motivation/i, /self.?intro/i],
  whyInterested:   [/why.?interest/i, /why.?this/i, /reason.?apply/i],
  summary:         [/^summary$/i, /^about$/i, /^bio$/i, /objective/i],
  currentCTC:      [/current.?ctc/i, /current.?sal/i, /current.?package/i],
  expectedCTC:     [/expected.?ctc/i, /expected.?sal/i, /desired.?sal/i],
  noticePeriod:    [/notice.?period/i, /joining.?date/i, /availability/i],
  totalExperience: [/experience/i, /years.?of.?exp/i, /total.?exp/i, /work.?exp/i],
  institution:     [/college/i, /university/i, /institute/i, /school/i],
  whyInterested:   [/why.?interest/i, /why.?you/i, /reason/i],
};

// ── State ────────────────────────────────────────────────────────────────────
let _detectedPortal = null;        // { key, config } or null
let _lastDetectedFields = null;    // cached result of findFormFields()
let _detectionObserver = null;     // MutationObserver watching for form open

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identifies the current portal and whether an apply form is visible.
 *
 * @returns {{
 *   detected: boolean,
 *   portal: string|null,
 *   portalName: string|null,
 *   portalColor: string|null,
 *   formOpen: boolean,
 *   config: object|null
 * }}
 */
function detectPortal() {
  const match = detectCurrentPortal();

  if (!match) {
    return { detected: false, portal: null, portalName: null, portalColor: null, formOpen: false, config: null };
  }

  const { key, config } = match;
  _detectedPortal = match;

  // Check if an apply form is actually visible right now
  const formOpen = isFormOpen(config);

  return {
    detected: true,
    portal: key,
    portalName: config.name,
    portalColor: config.color,
    portalIcon: config.icon,
    formOpen,
    config,
  };
}

/**
 * Scans the DOM for fillable form fields using portal-specific selectors
 * with a heuristic fallback.
 *
 * @param {object} [portalConfig]  — pass detectPortal().config, or leave blank
 *                                   to auto-detect
 * @returns {{
 *   detected: boolean,
 *   portal: string|null,
 *   fields: Object.<string, { element: Element, selector: string, confidence: number }>,
 *   totalFound: number,
 *   radioGroups: Object,
 *   selectFields: Object
 * }}
 */
function findFormFields(portalConfig) {
  const portalMatch = _detectedPortal || detectCurrentPortal();

  if (!portalMatch) {
    // Completely unknown site — run pure heuristic scan
    const fields = heuristicScan(document);
    _lastDetectedFields = fields;
    return { detected: !!Object.keys(fields).length, portal: null, fields, totalFound: Object.keys(fields).length, radioGroups: {}, selectFields: {} };
  }

  const { key, config } = portalMatch;
  const searchRoot = getFormRoot(config);

  // 1. Portal-specific selector scan
  const fields = portalSpecificScan(config, searchRoot);

  // 2. Merge with heuristic scan for any unmapped fields
  const heuristic = heuristicScan(searchRoot);
  for (const [fieldKey, info] of Object.entries(heuristic)) {
    if (!fields[fieldKey]) {
      fields[fieldKey] = { ...info, confidence: info.confidence * 0.7 }; // lower weight for heuristic
    }
  }

  // 3. Resolve radio groups and selects defined in portal config
  const resolvedRadios  = resolveRadioGroups(config, searchRoot);
  const resolvedSelects = resolveSelectFields(config, searchRoot);

  _lastDetectedFields = fields;

  const result = {
    detected: Object.keys(fields).length > 0,
    portal: key,
    portalName: config.name,
    fields,
    totalFound: Object.keys(fields).length,
    radioGroups: resolvedRadios,
    selectFields: resolvedSelects,
  };

  // Notify background about detection
  try {
    chrome.runtime.sendMessage({
      action: 'PORTAL_FORM_DETECTED',
      data: {
        portal: key,
        portalName: config.name,
        fieldCount: result.totalFound,
        url: window.location.href,
        title: document.title,
      },
    });
  } catch (_) { /* service worker may be asleep */ }

  return result;
}

/**
 * Returns the cached result of the last findFormFields() call.
 * Used by auto-filler to avoid a redundant DOM scan.
 */
function getLastDetectedFields() {
  return _lastDetectedFields;
}

/**
 * Starts a MutationObserver that watches for the apply form appearing.
 * Calls onFormOpen(result) when a form matching the portal config appears.
 *
 * @param {function} onFormOpen
 */
function watchForFormOpen(onFormOpen) {
  if (_detectionObserver) _detectionObserver.disconnect();

  const portalMatch = detectCurrentPortal();
  if (!portalMatch) return;

  const { config } = portalMatch;

  _detectionObserver = new MutationObserver(() => {
    if (isFormOpen(config)) {
      _detectionObserver.disconnect();
      const result = findFormFields(config);
      onFormOpen(result);
    }
  });

  _detectionObserver.observe(document.body, { childList: true, subtree: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL — Portal detection helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if any of the portal's detectionSelectors are visible in DOM.
 */
function isFormOpen(config) {
  const selectors = config.detectionSelectors || [];
  return selectors.some(sel => {
    const el = document.querySelector(sel);
    return el && isVisible(el);
  });
}

/**
 * Returns the best search root: the form element itself (if present),
 * an iframe document, or document as fallback.
 */
function getFormRoot(config) {
  // Try main document first
  if (config.formSelector) {
    const selectors = Array.isArray(config.formSelector)
      ? config.formSelector
      : config.formSelector.split(',').map(s => s.trim());

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
  }

  // Try iframes
  if (config.iframeSelector) {
    const iframe = document.querySelector(config.iframeSelector);
    if (iframe) {
      try {
        const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iDoc) return iDoc;
      } catch (_) { /* cross-origin */ }
    }
  }

  // Fallback: all iframes on page
  for (const iframe of document.querySelectorAll('iframe')) {
    try {
      const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iDoc && iDoc.body && iDoc.querySelectorAll('input, textarea').length > 2) {
        return iDoc;
      }
    } catch (_) { /* cross-origin, skip */ }
  }

  return document;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL — Field scanning strategies
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans using the portal-specific fieldMap (exact CSS selectors).
 */
function portalSpecificScan(config, root) {
  const fields = {};
  const fieldMap = config.fieldMap || {};

  for (const [fieldKey, selectors] of Object.entries(fieldMap)) {
    if (fieldKey === 'resumeUpload') continue; // handled separately

    for (const selector of selectors) {
      const el = queryInRoot(root, selector);
      if (el && isVisible(el) && !isReadOnly(el)) {
        fields[fieldKey] = {
          element: el,
          selector,
          confidence: 0.95, // portal-specific selectors are highly reliable
        };
        break;
      }
    }

    // Shadow DOM pierce attempt for unmatched fields
    if (!fields[fieldKey]) {
      const shadowEl = queryShadowDOM(root, selectors);
      if (shadowEl) {
        fields[fieldKey] = { element: shadowEl, selector: selectors[0], confidence: 0.85 };
      }
    }
  }

  return fields;
}

/**
 * Generic heuristic scan — looks at id, name, placeholder, aria-label, label text.
 */
function heuristicScan(root) {
  const fields = {};
  const inputs = queryAllInRoot(root, 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, select');

  for (const el of inputs) {
    if (!isVisible(el) || isReadOnly(el)) continue;

    const fieldKey = classifyByHeuristic(el);
    if (!fieldKey || fields[fieldKey]) continue; // first match wins per field

    fields[fieldKey] = {
      element: el,
      selector: buildSelector(el),
      confidence: heuristicConfidence(el, fieldKey),
    };
  }

  return fields;
}

/**
 * Maps a DOM element to a profile fieldKey using heuristic patterns.
 */
function classifyByHeuristic(el) {
  const signals = buildSignals(el);

  for (const [key, patterns] of Object.entries(HEURISTIC_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(signals)) return key;
    }
  }
  return null;
}

function buildSignals(el) {
  return [
    el.name         || '',
    el.id           || '',
    el.placeholder  || '',
    el.getAttribute('aria-label')       || '',
    el.getAttribute('aria-placeholder') || '',
    el.getAttribute('data-field')       || '',
    el.getAttribute('formcontrolname')  || '',
    getAssociatedLabelText(el),
  ].join(' ');
}

function heuristicConfidence(el, fieldKey) {
  const patterns = HEURISTIC_PATTERNS[fieldKey] || [];
  let score = 0.5;
  if (patterns.some(p => p.test(el.id   || ''))) score += 0.2;
  if (patterns.some(p => p.test(el.name || ''))) score += 0.2;
  if (patterns.some(p => p.test(getAssociatedLabelText(el)))) score += 0.1;
  return Math.min(score, 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL — Radio & Select resolution
// ─────────────────────────────────────────────────────────────────────────────

function resolveRadioGroups(config, root) {
  const result = {};
  const groups = config.radioGroups || {};

  for (const [key, def] of Object.entries(groups)) {
    const trueEl  = def.trueSelectors?.map(s => queryInRoot(root, s)).find(Boolean);
    const falseEl = def.falseSelectors?.map(s => queryInRoot(root, s)).find(Boolean);

    if (trueEl || falseEl) {
      result[key] = { trueElement: trueEl || null, falseElement: falseEl || null };
    }
  }

  return result;
}

function resolveSelectFields(config, root) {
  const result = {};
  const selects = config.selectFields || {};

  for (const [key, def] of Object.entries(selects)) {
    const selectors = def.selector.split(',').map(s => s.trim());
    for (const sel of selectors) {
      const el = queryInRoot(root, sel);
      if (el && isVisible(el)) {
        result[key] = { element: el, valueMap: def.valueMap || {} };
        break;
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL — DOM utilities
// ─────────────────────────────────────────────────────────────────────────────

function queryInRoot(root, selector) {
  try {
    return (root && root.querySelector) ? root.querySelector(selector) : null;
  } catch (_) { return null; }
}

function queryAllInRoot(root, selector) {
  try {
    return root && root.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
  } catch (_) { return []; }
}

/**
 * Walks shadow DOM hosts and tries to find an element matching any selector.
 */
function queryShadowDOM(root, selectors) {
  const hosts = queryAllInRoot(root, '*');
  for (const host of hosts) {
    if (!host.shadowRoot) continue;
    for (const selector of selectors) {
      try {
        const el = host.shadowRoot.querySelector(selector);
        if (el && isVisible(el) && !isReadOnly(el)) return el;
      } catch (_) { /* invalid selector for this shadow */ }
    }
  }
  return null;
}

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
  );
}

function isReadOnly(el) {
  return el.readOnly || el.disabled || el.getAttribute('aria-readonly') === 'true' || el.getAttribute('aria-disabled') === 'true';
}

function getAssociatedLabelText(el) {
  // Explicit for= association
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label.textContent.trim();
  }
  // Implicit: input inside label
  const parentLabel = el.closest('label');
  if (parentLabel) return parentLabel.textContent.trim();
  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent.trim();
  }
  // Preceding sibling label-like element
  const prev = el.previousElementSibling;
  if (prev && ['LABEL', 'SPAN', 'P', 'DIV'].includes(prev.tagName)) {
    const text = prev.textContent.trim();
    if (text.length < 80) return text;
  }
  return '';
}

/**
 * Builds a unique-ish CSS selector for an element (for logging/debugging).
 */
function buildSelector(el) {
  if (el.id) return `#${el.id}`;
  if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
  if (el.placeholder) return `${el.tagName.toLowerCase()}[placeholder="${el.placeholder.slice(0, 30)}"]`;
  return el.tagName.toLowerCase();
}

