/**
 * Arlo Auto Filler
 *
 * Human-like form filling strategy:
 *  - Focus the field, simulate character-by-character typing with micro-delays
 *  - Fire proper synthetic events so React/Vue/Angular watchers trigger
 *  - Random 100–400ms delay between fields to avoid bot detection
 *  - Dedicated handlers for <select>, radio buttons, textareas, file inputs
 *  - Skipped-field registry so the user can override
 *
 * This file is injected as a plain content script (not ES module).
 */

// ── Inline sanitizer (duplicated from security/sanitizer.js for content script) ──
function _sanitize(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[<>]/g, '')          // no HTML tags
    .replace(/javascript:/gi, '')  // no JS protocol
    .replace(/on\w+\s*=/gi, '')    // no event handler attributes
    .trim()
    .slice(0, 5000);               // generous cap for cover letters
}

// ── Inline validators ────────────────────────────────────────────────────────
const FIELD_VALIDATORS = {
  email:       v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  phone:       v => /^\+?[\d\s\-().]{7,20}$/.test(v),
  linkedinUrl: v => v.includes('linkedin.com'),
  portfolioUrl:v => { try { new URL(v); return true; } catch { return false; } },
  firstName:   v => v.length >= 1 && v.length <= 50,
  lastName:    v => v.length >= 1 && v.length <= 50,
  fullName:    v => v.length >= 2 && v.length <= 100,
  coverLetter: v => v.length >= 10,
};

// ── Skipped fields registry ──────────────────────────────────────────────────
const _skippedFields = new Set();

/**
 * Marks a fieldKey to be skipped on the next fillAll() call.
 * @param {string} fieldKey
 */
function skipField(fieldKey) {
  _skippedFields.add(fieldKey);
}

/**
 * Removes a field from the skip list.
 * @param {string} fieldKey
 */
function unskipField(fieldKey) {
  _skippedFields.delete(fieldKey);
}

/**
 * Clears the skip list.
 */
function clearSkips() {
  _skippedFields.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fills all detected fields from a findFormFields() result using profile data.
 *
 * @param {object} detectionResult  — return value of findFormFields()
 * @param {object} profile          — decrypted profile from profile-store
 * @param {object} [options]
 * @param {function} [options.onProgress]  — called with (filled, total) after each field
 * @param {function} [options.onComplete]  — called with { filled, skipped, errors } when done
 * @returns {Promise<{ filled: number, skipped: number, errors: number }>}
 */
async function fillAll(detectionResult, profile, options = {}) {
  const { fields = {}, radioGroups = {}, selectFields = {}, portal } = detectionResult;
  const { onProgress, onComplete } = options;

  const portalMatch = _detectedPortal || detectCurrentPortal();
  const portalConfig = portalMatch?.config || null;

  let filled = 0;
  let skipped = 0;
  let errors = 0;

  const fieldEntries = Object.entries(fields);
  const total = fieldEntries.length + Object.keys(radioGroups).length + Object.keys(selectFields).length;

  // ── 1. Fill regular input / textarea fields ──────────────────────────────
  for (const [fieldKey, { element, confidence }] of fieldEntries) {
    if (_skippedFields.has(fieldKey)) { skipped++; continue; }

    // Skip if portal config says to skip already-filled fields
    if (portalConfig?.skipIfFilled?.includes(fieldKey)) {
      const currentVal = element.value?.trim();
      if (currentVal && currentVal.length > 0) { skipped++; continue; }
    }

    const value = resolveProfileValue(fieldKey, profile);
    if (!value) { skipped++; continue; }

    const sanitized = _sanitize(value);
    if (!sanitized) { skipped++; continue; }

    // Validate before filling (skip invalid values silently)
    const validator = FIELD_VALIDATORS[fieldKey];
    if (validator && !validator(sanitized)) { skipped++; continue; }

    // Low-confidence heuristic fields: only fill if confident enough
    if (confidence < 0.4) { skipped++; continue; }

    try {
      const success = await fillField(element, sanitized, portalConfig?.frameworkHint);
      if (success) { filled++; } else { skipped++; }
    } catch (err) {
      console.warn(`[Arlo] Could not fill "${fieldKey}":`, err.message);
      errors++;
    }

    onProgress?.(filled, total);
    await humanDelay();
  }

  // ── 2. Fill <select> fields ──────────────────────────────────────────────
  for (const [fieldKey, { element, valueMap }] of Object.entries(selectFields)) {
    if (_skippedFields.has(fieldKey)) { skipped++; continue; }

    const value = resolveProfileValue(fieldKey, profile);
    if (!value) { skipped++; continue; }

    try {
      const success = handleDropdown(element, value, valueMap);
      if (success) { filled++; } else { skipped++; }
    } catch (err) { errors++; }

    onProgress?.(filled, total);
    await humanDelay();
  }

  // ── 3. Handle radio groups ────────────────────────────────────────────────
  for (const [fieldKey, { trueElement, falseElement }] of Object.entries(radioGroups)) {
    if (_skippedFields.has(fieldKey)) { skipped++; continue; }

    const value = resolveProfileValue(fieldKey, profile);
    if (value === null || value === undefined) { skipped++; continue; }

    try {
      const boolValue = parseBooleanValue(value);
      const target = boolValue ? trueElement : falseElement;
      if (target) {
        await clickRadio(target);
        filled++;
      } else {
        skipped++;
      }
    } catch (err) { errors++; }

    onProgress?.(filled, total);
    await humanDelay();
  }

  const summary = { filled, skipped, errors };
  onComplete?.(summary);
  return summary;
}

/**
 * Fills a single field element with a value.
 * Decides strategy based on element type and framework hint.
 *
 * @param {HTMLElement} element
 * @param {string} value
 * @param {string} [frameworkHint] — 'react' | 'angular' | 'vue' | 'jquery' | 'vanilla'
 * @returns {Promise<boolean>}
 */
async function fillField(element, value, frameworkHint) {
  if (!element || !isElementFillable(element)) return false;

  const tag = element.tagName.toLowerCase();
  const type = (element.type || '').toLowerCase();

  if (tag === 'select') {
    return handleDropdown(element, value, {});
  }

  if (type === 'file') {
    // File inputs can't be filled programmatically for security reasons
    return false;
  }

  if (type === 'checkbox') {
    return handleCheckbox(element, value);
  }

  if (type === 'radio') {
    await clickRadio(element);
    return true;
  }

  // Determine fill strategy by framework
  switch (frameworkHint) {
    case 'react':
      return await fillReact(element, value);
    case 'angular':
      return await fillAngular(element, value);
    case 'vue':
      return await fillVue(element, value);
    default:
      // Try React first (most SPAs use it), fall back to vanilla
      return await fillReact(element, value);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FRAMEWORK-SPECIFIC FILL STRATEGIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * React strategy: use the native value setter to bypass React's synthetic
 * event system, then dispatch a real 'input' event.
 *
 * For short values we also simulate typing character-by-character so
 * onChange fires on each keystroke (some forms validate on every character).
 */
async function fillReact(element, value) {
  await focusElement(element);

  // Clear existing value first
  await clearField(element);

  // For short values (< 80 chars), simulate typing for realism
  if (value.length <= 80 && element.tagName.toLowerCase() !== 'textarea') {
    await typeCharacters(element, value);
  } else {
    // Paste strategy for long text (cover letters, summaries)
    await pasteValue(element, value);
  }

  await blurElement(element);
  return getFieldValue(element) !== '';
}

/**
 * Angular strategy: Angular's [(ngModel)] listens to 'input' events.
 * We need to set the value AND dispatch the event on the native element.
 */
async function fillAngular(element, value) {
  await focusElement(element);
  await clearField(element);

  setNativeValue(element, value);

  // Angular listens to these
  element.dispatchEvent(new Event('input',  { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) }));

  await blurElement(element);
  return getFieldValue(element) !== '';
}

/**
 * Vue strategy: Vue watches the 'input' event on v-model elements.
 */
async function fillVue(element, value) {
  await focusElement(element);
  await clearField(element);

  setNativeValue(element, value);

  element.dispatchEvent(new Event('input',  { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  await blurElement(element);
  return getFieldValue(element) !== '';
}

// ─────────────────────────────────────────────────────────────────────────────
// ATOMIC FILL OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulates typing one character at a time with micro-delays.
 * This is the most bot-resistant strategy — looks like real user input.
 */
async function typeCharacters(element, value) {
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const partial = value.slice(0, i + 1);

    // Dispatch keydown
    element.dispatchEvent(new KeyboardEvent('keydown', {
      key: char, code: `Key${char.toUpperCase()}`,
      bubbles: true, cancelable: true,
    }));

    // Set value using native setter up to this character
    setNativeValue(element, partial);

    // Dispatch keypress + input
    element.dispatchEvent(new KeyboardEvent('keypress', {
      key: char, bubbles: true, cancelable: true,
    }));
    element.dispatchEvent(new InputEvent('input', {
      data: char, inputType: 'insertText',
      bubbles: true, cancelable: true,
    }));

    // Dispatch keyup
    element.dispatchEvent(new KeyboardEvent('keyup', {
      key: char, code: `Key${char.toUpperCase()}`,
      bubbles: true, cancelable: true,
    }));

    // Micro-delay between keystrokes: 30–90ms (realistic typing speed)
    await delay(30 + Math.random() * 60);
  }

  // Final change event
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Paste strategy for long values — sets value in one shot and fires
 * a paste-like event sequence.
 */
async function pasteValue(element, value) {
  setNativeValue(element, value);

  element.dispatchEvent(new Event('input',  { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

  // Some frameworks also need a ClipboardEvent
  try {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', value);
    element.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData,
      bubbles: true,
      cancelable: true,
    }));
    // Re-set after paste event (some handlers clear the field on paste)
    await delay(20);
    setNativeValue(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (_) { /* ClipboardEvent constructor may not be available */ }
}

/**
 * Clears the field (selects all + delete simulation).
 */
async function clearField(element) {
  setNativeValue(element, '');
  element.dispatchEvent(new Event('input', { bubbles: true }));
  await delay(10);
}

async function focusElement(element) {
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await delay(60 + Math.random() * 40); // wait for scroll
  element.focus();
  element.dispatchEvent(new FocusEvent('focus',   { bubbles: true }));
  element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await delay(40 + Math.random() * 30);
}

async function blurElement(element) {
  await delay(50 + Math.random() * 50);
  element.blur();
  element.dispatchEvent(new FocusEvent('blur',    { bubbles: true }));
  element.dispatchEvent(new FocusEvent('focusout',{ bubbles: true }));
}

/**
 * Sets value via the native prototype setter so React's fiber tree
 * sees the change and re-renders (bypasses synthetic event interception).
 */
function setNativeValue(element, value) {
  const tag = element.tagName.toLowerCase();

  const proto = tag === 'textarea'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;

  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function getFieldValue(element) {
  return element.value || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// SPECIALIZED ELEMENT HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fills a <select> element by matching option text or value against
 * the portal's valueMap (or a plain string match as fallback).
 *
 * @param {HTMLSelectElement} element
 * @param {string} profileValue   — raw value from profile (e.g. "2-4" or "1 month")
 * @param {object} valueMap       — { profileValue: [optionTextFragments] }
 * @returns {boolean}
 */
function handleDropdown(element, profileValue, valueMap) {
  if (!element || element.tagName.toLowerCase() !== 'select') return false;

  const lowerProfile = profileValue.toLowerCase().trim();

  // 1. Try valueMap first
  if (valueMap && valueMap[profileValue]) {
    const fragments = valueMap[profileValue];
    for (const option of element.options) {
      const optText  = option.text.toLowerCase().trim();
      const optValue = option.value.toLowerCase().trim();
      if (fragments.some(f => optText.includes(f.toLowerCase()) || optValue.includes(f.toLowerCase()))) {
        return selectOption(element, option.value);
      }
    }
  }

  // 2. Direct value/text match
  for (const option of element.options) {
    const optText  = option.text.toLowerCase().trim();
    const optValue = option.value.toLowerCase().trim();
    if (optValue === lowerProfile || optText === lowerProfile) {
      return selectOption(element, option.value);
    }
  }

  // 3. Substring / partial match
  for (const option of element.options) {
    const optText  = option.text.toLowerCase().trim();
    const optValue = option.value.toLowerCase().trim();
    if (optText.includes(lowerProfile) || lowerProfile.includes(optText) ||
        optValue.includes(lowerProfile)) {
      return selectOption(element, option.value);
    }
  }

  return false;
}

function selectOption(selectEl, value) {
  selectEl.value = value;
  selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  selectEl.dispatchEvent(new Event('input',  { bubbles: true }));
  return selectEl.value === value;
}

/**
 * Handles radio button groups.
 * @param {string} groupName   — input[name] attribute
 * @param {string} value       — the value to select
 * @returns {boolean}
 */
function handleRadioButtons(groupName, value) {
  const radios = document.querySelectorAll(`input[type="radio"][name="${groupName}"]`);
  if (!radios.length) return false;

  const lowerValue = value.toLowerCase().trim();

  for (const radio of radios) {
    if (radio.value.toLowerCase() === lowerValue || radio.getAttribute('data-label')?.toLowerCase() === lowerValue) {
      return clickRadioSync(radio);
    }
  }

  return false;
}

async function clickRadio(element) {
  await focusElement(element);
  element.checked = true;
  element.dispatchEvent(new MouseEvent('click',  { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await blurElement(element);
}

function clickRadioSync(element) {
  element.checked = true;
  element.dispatchEvent(new MouseEvent('click',  { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/**
 * Handles checkboxes. Value can be 'true'/'yes'/'1' for check,
 * 'false'/'no'/'0' for uncheck.
 */
function handleCheckbox(element, value) {
  const shouldCheck = parseBooleanValue(value);
  if (element.checked === shouldCheck) return true; // already correct
  element.checked = shouldCheck;
  element.dispatchEvent(new MouseEvent('click',  { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adds a human-like delay between field fills.
 * Range: 120–420ms with Gaussian-ish distribution via averaging two randoms.
 */
async function humanDelay() {
  const base = 120;
  const range = 300;
  const jitter = (Math.random() + Math.random()) / 2; // roughly bell-curved
  return delay(base + jitter * range);
}

/**
 * Fixed delay helper.
 * @param {number} ms
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE VALUE RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a profile value for a given fieldKey.
 * Handles nested profile structure.
 *
 * @param {string} fieldKey
 * @param {object} profile
 * @returns {string|null}
 */
function resolveProfileValue(fieldKey, profile) {
  const p    = profile.personal    || {};
  const prefs= profile.preferences || {};
  const edu  = profile.education?.[0] || {}; // most recent education

  const valueMap = {
    firstName:       p.firstName,
    lastName:        p.lastName,
    fullName:        p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || null,
    email:           p.email,
    phone:           p.phone,
    location:        p.location,
    headline:        p.headline,
    linkedinUrl:     p.linkedinUrl,
    portfolioUrl:    p.portfolioUrl,
    summary:         p.summary,
    coverLetter:     p.summary,          // use summary as cover letter base
    whyInterested:   p.summary,
    currentCTC:      prefs.currentCTC,
    expectedCTC:     prefs.expectedCTC,
    noticePeriod:    prefs.noticePeriod,
    totalExperience: prefs.totalExperience,
    institution:     edu.institution,
    workAuthorization: 'Yes',            // default: authorized to work
    requireSponsorship: 'No',            // default: no sponsorship needed
  };

  const val = valueMap[fieldKey];
  return val !== undefined && val !== null && val !== '' ? String(val) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function isElementFillable(el) {
  if (!el) return false;
  if (el.disabled || el.readOnly) return false;
  if (el.getAttribute('aria-readonly') === 'true') return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

function parseBooleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['yes', 'true', '1', 'on'].includes(value.toLowerCase().trim());
  }
  return !!value;
}

/**
 * Fires the full React synthetic event chain manually.
 * Useful for components that listen to synthetic events only.
 *
 * @param {HTMLElement} element
 */
function triggerReactEvents(element) {
  const nativeInputProto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');

  // Access React's internal instance
  const reactKey = Object.keys(element).find(
    key => key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')
  );

  if (reactKey) {
    const reactInstance = element[reactKey];
    // Walk up fiber tree to find onChange
    let fiber = reactInstance;
    while (fiber) {
      const onChange = fiber.memoizedProps?.onChange;
      if (onChange) {
        // Create a synthetic-like event
        const syntheticEvent = {
          target: element,
          currentTarget: element,
          type: 'change',
          nativeEvent: new Event('change', { bubbles: true }),
          preventDefault: () => {},
          stopPropagation: () => {},
          isPersistent: () => true,
          persist: () => {},
        };
        try { onChange(syntheticEvent); } catch (_) {}
        break;
      }
      fiber = fiber.return;
    }
  }

  // Always also dispatch native events as fallback
  element.dispatchEvent(new Event('input',  { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

