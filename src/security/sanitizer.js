/**
 * Arlo Security — Input Sanitizer
 *
 * Privacy principle:
 *   PII (name, email, phone) = local only, never sent to AI
 *   sanitizeForAI() strips PII before any backend call
 *   All profile data sanitized on save AND before DOM injection
 */

// ── PII field registry — never sent to Claude ─────────────────────────────
const PII_FIELDS = new Set([
  'firstName', 'lastName', 'fullName', 'email', 'phone',
  'dob', 'dateOfBirth', 'address', 'pan', 'aadhar', 'passport',
]);

// ── String sanitizers ──────────────────────────────────────────────────────

/**
 * Strips HTML tags, event handlers, and JS protocol from a string.
 * Safe to assign to .value — never use output in innerHTML.
 * @param {string} value
 * @returns {string}
 */
export function sanitizeString(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim()
    .slice(0, 5000);
}

/**
 * Strips all HTML tags entirely (stricter than sanitizeString).
 * Use for display text and log messages.
 * @param {string} str
 * @returns {string}
 */
export function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '')           // strip all tags
    .replace(/&[a-z]+;/gi, ' ')        // strip HTML entities
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim()
    .slice(0, 5000);
}

/**
 * Escapes a string for safe innerHTML insertion.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Profile sanitizers ────────────────────────────────────────────────────

/**
 * Deeply sanitizes an entire profile object before encrypting to storage.
 * @param {object} profile
 * @returns {object}
 */
export function sanitizeProfile(profile) {
  if (typeof profile !== 'object' || profile === null) return {};

  const sanitized = {};
  for (const [key, value] of Object.entries(profile)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item =>
        typeof item === 'string' ? sanitizeString(item) : sanitizeProfile(item)
      );
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeProfile(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Sanitizes a single named profile field with field-aware rules.
 * Called on every form submission in the onboarding wizard.
 *
 * @param {string} field   — e.g. 'email', 'phone', 'firstName'
 * @param {*}      value
 * @returns {{ value: string, valid: boolean, error?: string }}
 */
export function sanitizeProfileField(field, value) {
  const str = sanitizeString(String(value ?? ''));

  switch (field) {
    case 'email': {
      if (!str) return { value: str, valid: false, error: 'Email is required' };
      if (!isValidEmail(str)) return { value: str, valid: false, error: 'Invalid email address' };
      return { value: str.toLowerCase(), valid: true };
    }
    case 'phone': {
      if (!str) return { value: str, valid: false, error: 'Phone is required' };
      if (!isValidPhone(str)) return { value: str, valid: false, error: 'Invalid phone number' };
      return { value: str, valid: true };
    }
    case 'firstName':
    case 'lastName': {
      if (!str) return { value: str, valid: false, error: 'Name is required' };
      if (str.length > 50) return { value: str.slice(0, 50), valid: false, error: 'Name too long' };
      if (/[<>{}[\]\\]/.test(str)) return { value: str, valid: false, error: 'Name contains invalid characters' };
      return { value: str, valid: true };
    }
    case 'linkedinUrl': {
      if (str && !str.includes('linkedin.com')) return { value: str, valid: false, error: 'Must be a LinkedIn URL' };
      if (str && !isValidURL(str)) return { value: str, valid: false, error: 'Invalid URL' };
      return { value: str, valid: true };
    }
    case 'portfolioUrl': {
      if (str && !isValidURL(str)) return { value: str, valid: false, error: 'Invalid URL' };
      return { value: str, valid: true };
    }
    case 'summary':
    case 'coverLetter': {
      if (str.length > 3000) return { value: str.slice(0, 3000), valid: true };
      return { value: str, valid: true };
    }
    default:
      return { value: str, valid: true };
  }
}

/**
 * Strips PII fields from a profile before sending to the AI backend.
 * Retains only skills, experience descriptions, education institution/degree,
 * preferences, and headline/summary.
 *
 * PRIVACY: name, email, phone NEVER leave the extension.
 *
 * @param {object} profile
 * @returns {object} PII-stripped profile safe for backend transmission
 */
export function sanitizeForAI(profile) {
  if (!profile) return {};

  const p    = profile.personal    || {};
  const prefs= profile.preferences || {};

  return {
    // Non-PII personal fields only
    personal: {
      headline:    sanitizeString(p.headline   || ''),
      location:    sanitizeString(p.location   || ''),
      summary:     sanitizeString(p.summary    || ''),
      linkedinUrl: sanitizeString(p.linkedinUrl || ''),
      portfolioUrl:sanitizeString(p.portfolioUrl|| ''),
    },
    education: (profile.education || []).slice(0, 3).map(e => ({
      institution: sanitizeString(e.institution || ''),
      degree:      sanitizeString(e.degree      || ''),
      field:       sanitizeString(e.field       || ''),
      endYear:     e.endYear,
      grade:       sanitizeString(e.grade       || ''),
    })),
    experience: (profile.experience || []).slice(0, 3).map(e => ({
      // company name is non-PII (public info)
      company:     sanitizeString(e.company     || ''),
      title:       sanitizeString(e.title       || ''),
      type:        sanitizeString(e.type        || ''),
      isCurrent:   Boolean(e.isCurrent),
      startDate:   e.startDate,
      endDate:     e.endDate,
      description: sanitizeString((e.description || '').slice(0, 200)),
    })),
    skills: {
      technical: _sanitizeSkillList(profile.skills?.technical),
      soft:      _sanitizeSkillList(profile.skills?.soft),
    },
    preferences: {
      totalExperience: sanitizeString(prefs.totalExperience || ''),
      noticePeriod:    sanitizeString(prefs.noticePeriod    || ''),
      expectedCTC:     sanitizeString(prefs.expectedCTC     || ''),
    },
  };
}

// ── Validators ────────────────────────────────────────────────────────────

/**
 * Full field validation — used before DOM injection.
 * @param {string} fieldKey
 * @param {string} value
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateFieldValue(fieldKey, value) {
  if (!value || String(value).trim() === '') {
    return { valid: false, reason: 'Empty value' };
  }
  const str = String(value);

  switch (fieldKey) {
    case 'email':
      return isValidEmail(str)
        ? { valid: true }
        : { valid: false, reason: 'Invalid email format' };

    case 'phone':
      return isValidPhone(str)
        ? { valid: true }
        : { valid: false, reason: 'Invalid phone number' };

    case 'linkedinUrl':
      if (!str.includes('linkedin.com')) return { valid: false, reason: 'Not a LinkedIn URL' };
      return isValidURL(str) ? { valid: true } : { valid: false, reason: 'Invalid URL' };

    case 'portfolioUrl':
      return isValidURL(str) ? { valid: true } : { valid: false, reason: 'Invalid URL' };

    case 'firstName':
    case 'lastName':
      if (str.length < 1 || str.length > 50) return { valid: false, reason: 'Name length invalid' };
      if (/[<>{}[\]\\\/]/.test(str)) return { valid: false, reason: 'Name contains invalid characters' };
      return { valid: true };

    case 'fullName':
      if (str.length < 2 || str.length > 100) return { valid: false, reason: 'Full name length invalid' };
      return { valid: true };

    case 'currentCTC':
    case 'expectedCTC':
      if (str.length > 30) return { valid: false, reason: 'CTC value too long' };
      return { valid: true };

    case 'coverLetter':
    case 'summary':
      if (str.length < 10) return { valid: false, reason: 'Text too short' };
      return { valid: true };

    default:
      return { valid: true };
  }
}

export function isValidEmail(email) {
  return /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/.test(String(email));
}

export function isValidPhone(phone) {
  const digits = String(phone).replace(/[\s\-().+]/g, '');
  return /^\d{7,15}$/.test(digits);
}

export function isValidURL(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch { return false; }
}

// ── Private ───────────────────────────────────────────────────────────────

function _sanitizeSkillList(skills) {
  if (!Array.isArray(skills)) return [];
  return skills
    .map(s => typeof s === 'object' ? sanitizeString(s.name || '') : sanitizeString(s))
    .filter(Boolean)
    .slice(0, 30);
}

