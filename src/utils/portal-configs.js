/**
 * Arlo Portal Configurations
 *
 * Each entry defines:
 *   - name, color, icon  — display metadata
 *   - hostname           — used for detection (substring match)
 *   - detectionSelectors — CSS selectors that prove an apply form is open
 *   - applyButtonSelector — the button that opens the apply form
 *   - formSelector        — outermost wrapper of the apply form
 *   - fieldMap            — profileKey → array of CSS selectors (tried in order)
 *   - fieldValidators     — optional per-field value validation before filling
 *   - shadowDOMHosts      — selectors of elements that host shadow roots
 *   - iframeSelector      — selector for iframe that contains the form (if any)
 *   - radioGroups         — profileKey → { name, valueMap }
 *   - selectFields        — profileKey → { selector, valueMap }
 *   - skipIfFilled        — profileKeys to skip when already has a non-empty value
 *
 * CSS selectors are tried in array order; first match wins.
 *
 * NOTE: This file is injected as a plain content script (not an ES module).
 * All exports are attached to the window/global scope as plain variables.
 */

// eslint-disable-next-line no-unused-vars
const PORTAL_CONFIGS = {
  // ── LinkedIn ──────────────────────────────────────────────────────────────
  'linkedin.com': {
    name: 'LinkedIn',
    shortName: 'LinkedIn',
    color: '#0a66c2',
    icon: '💼',

    hostname: 'linkedin.com',

    // Confirms Easy Apply modal/drawer is open
    detectionSelectors: [
      '.jobs-easy-apply-modal',
      '.jobs-easy-apply-content',
      '[data-test-modal-id="easy-apply-modal"]',
      '.jobs-apply-button--top-card',
    ],

    applyButtonSelector: [
      '.jobs-apply-button--top-card',
      '.jobs-s-apply button',
      'button[aria-label*="Easy Apply"]',
    ],

    formSelector: '.jobs-easy-apply-modal',

    // LinkedIn renders form steps — we scan the visible step
    formStepSelector: '.jobs-easy-apply-form-section__grouping',

    // Profile field → CSS selectors (ordered by specificity)
    fieldMap: {
      firstName: [
        'input[id*="firstName"]',
        'input[id*="first-name"]',
        'input[name="firstName"]',
        'input[autocomplete="given-name"]',
      ],
      lastName: [
        'input[id*="lastName"]',
        'input[id*="last-name"]',
        'input[name="lastName"]',
        'input[autocomplete="family-name"]',
      ],
      email: [
        'input[type="email"]',
        'input[id*="email"]',
        'input[name="email"]',
        'input[autocomplete="email"]',
      ],
      phone: [
        'input[id*="phoneNumber"]',
        'input[id*="phone"]',
        'input[name="phoneNumber"]',
        'input[type="tel"]',
        'input[autocomplete="tel"]',
      ],
      location: [
        'input[id*="location"]',
        'input[id*="city"]',
        'input[placeholder*="City"]',
        'input[placeholder*="Location"]',
        'input[aria-label*="City"]',
      ],
      headline: [
        'input[id*="headline"]',
        'input[name="headline"]',
      ],
      summary: [
        'textarea[id*="summary"]',
        'textarea[name="summary"]',
      ],
      coverLetter: [
        'textarea[id*="coverLetter"]',
        'textarea[id*="cover-letter"]',
        'textarea[name="coverLetter"]',
        'textarea[placeholder*="cover letter"]',
        'textarea[placeholder*="Cover Letter"]',
      ],
      linkedinUrl: [
        'input[id*="linkedin"]',
        'input[name="linkedinUrl"]',
        'input[placeholder*="linkedin.com"]',
      ],
      portfolioUrl: [
        'input[id*="website"]',
        'input[id*="portfolio"]',
        'input[name="website"]',
        'input[placeholder*="portfolio"]',
        'input[placeholder*="website"]',
      ],
      resumeUpload: [
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][accept*=".pdf"]',
        'input[type="file"]',
      ],
      noticePeriod: [
        'input[id*="notice"]',
        'input[name*="notice"]',
        'input[placeholder*="notice"]',
      ],
      expectedCTC: [
        'input[id*="salary"]',
        'input[name*="salary"]',
        'input[placeholder*="salary"]',
        'input[placeholder*="Salary"]',
      ],
    },

    // Fields to skip if they already contain a value
    skipIfFilled: ['email', 'phone', 'firstName', 'lastName'],

    // LinkedIn Easy Apply uses React heavily — needs synthetic event strategy
    frameworkHint: 'react',

    // LinkedIn's apply modal is NOT an iframe but does have shadow DOM fragments
    shadowDOMHosts: [],

    // Radio group definitions: profileKey → { name attr, valueMap }
    radioGroups: {
      workAuthorization: {
        name: 'workAuthorization',
        trueSelectors: ['input[value="Yes"]', 'input[value="yes"]', 'input[value="1"]'],
        falseSelectors: ['input[value="No"]', 'input[value="no"]', 'input[value="0"]'],
      },
      requireSponsorship: {
        name: 'requireSponsorship',
        trueSelectors: ['input[value="Yes"]'],
        falseSelectors: ['input[value="No"]'],
      },
    },

    // Select dropdown definitions
    selectFields: {
      totalExperience: {
        selector: 'select[id*="experience"]',
        // Maps profile value to closest option text fragment
        valueMap: {
          '0-1': ['0', 'Less than 1', 'Fresher', '< 1'],
          '1-2': ['1', '1 year', '1-2'],
          '2-4': ['2', '3', '2-4', '2 years', '3 years'],
          '4-6': ['4', '5', '4-6', '4 years', '5 years'],
          '6-10': ['6', '7', '8', '9', '6-10'],
          '10+':  ['10', '10+', 'More than 10'],
        },
      },
    },
  },

  // ── Naukri ────────────────────────────────────────────────────────────────
  'naukri.com': {
    name: 'Naukri',
    shortName: 'Naukri',
    color: '#e05c3a',
    icon: '🟠',

    hostname: 'naukri.com',

    detectionSelectors: [
      '#apply-popup',
      '.apply-popup-wrap',
      '#applyFormModal',
      '.apply-now-modal',
      '[data-ga-track*="apply"]',
    ],

    applyButtonSelector: [
      '#apply-button',
      '.apply-button',
      'button[type="button"].btn-primary',
    ],

    formSelector: '#applyFormModal, .apply-popup-wrap',

    fieldMap: {
      fullName: [
        '#nameField',
        'input[name="name"]',
        'input[placeholder*="name"]',
        'input[placeholder*="Name"]',
        'input[id*="name"]',
      ],
      email: [
        '#emailTxt',
        'input[name="email"]',
        'input[type="email"]',
        'input[id*="email"]',
        'input[placeholder*="email"]',
      ],
      phone: [
        '#phno',
        'input[name="mobile"]',
        'input[name="phone"]',
        'input[type="tel"]',
        'input[id*="phone"]',
        'input[placeholder*="mobile"]',
      ],
      location: [
        'input[placeholder*="location"]',
        'input[placeholder*="Location"]',
        'input[name="location"]',
        'input[id*="location"]',
      ],
      currentCTC: [
        '#currSalary',
        'input[name="currentSalary"]',
        'input[placeholder*="current CTC"]',
        'input[placeholder*="Current CTC"]',
        'input[id*="currSalary"]',
        'input[id*="currentCTC"]',
      ],
      expectedCTC: [
        '#expSalary',
        'input[name="expectedSalary"]',
        'input[placeholder*="expected CTC"]',
        'input[placeholder*="Expected CTC"]',
        'input[id*="expSalary"]',
        'input[id*="expectedCTC"]',
      ],
      coverLetter: [
        'textarea[name="coverLetter"]',
        'textarea[placeholder*="cover letter"]',
        'textarea[placeholder*="Cover Letter"]',
        'textarea[id*="coverLetter"]',
        '#coverLetterTxt',
      ],
    },

    skipIfFilled: ['email', 'phone'],

    frameworkHint: 'vanilla',

    shadowDOMHosts: [],

    selectFields: {
      totalExperience: {
        selector: 'select[name="experience"], select[id*="experience"]',
        valueMap: {
          '0-1': ['0', 'Fresher', 'Less than 1'],
          '1-2': ['1'],
          '2-4': ['2', '3'],
          '4-6': ['4', '5'],
          '6-10': ['6', '7', '8', '9'],
          '10+':  ['10', '10+'],
        },
      },
      noticePeriod: {
        selector: 'select[name="noticePeriod"], select[id*="notice"]',
        valueMap: {
          'Immediate': ['Immediate', '0', 'Right away'],
          '15 days':   ['15'],
          '1 month':   ['30', '1 month', 'One month'],
          '2 months':  ['60', '2 months'],
          '3 months':  ['90', '3 months'],
        },
      },
    },

    radioGroups: {},
  },

  // ── Internshala ───────────────────────────────────────────────────────────
  'internshala.com': {
    name: 'Internshala',
    shortName: 'Internshala',
    color: '#00a5ec',
    icon: '🎓',

    hostname: 'internshala.com',

    detectionSelectors: [
      '#apply_now_popup_parent',
      '.apply_form_wrapper',
      '#cover_letter',
      '.application_form',
      '#application_form',
    ],

    applyButtonSelector: [
      '.apply_now_btn',
      '.internship_apply .btn-primary',
      'a[href*="application"]',
    ],

    formSelector: '#apply_now_popup_parent, .application_form',

    fieldMap: {
      fullName: [
        '#name',
        'input[name="name"]',
        'input[id*="name"]',
        'input[placeholder*="name"]',
      ],
      email: [
        '#email',
        'input[name="email"]',
        'input[type="email"]',
      ],
      phone: [
        '#contact',
        '#phone',
        'input[name="contact"]',
        'input[name="phone"]',
        'input[type="tel"]',
      ],
      coverLetter: [
        '#cover_letter',
        'textarea[name="cover_letter"]',
        'textarea[id*="cover"]',
        'textarea[placeholder*="cover letter"]',
      ],
      whyInterested: [
        'textarea[name="why_interested"]',
        'textarea[id*="why"]',
        'textarea[placeholder*="why"]',
        'textarea[placeholder*="Why are you"]',
      ],
      availability: [
        'input[name="availability"]',
        'input[id*="availability"]',
        'input[placeholder*="availability"]',
      ],
      portfolioUrl: [
        'input[name="portfolio"]',
        'input[id*="portfolio"]',
        'input[placeholder*="portfolio"]',
        'input[placeholder*="Github"]',
      ],
    },

    skipIfFilled: ['email'],

    frameworkHint: 'jquery',

    shadowDOMHosts: [],
    radioGroups: {},
    selectFields: {},
  },

  // ── Wellfound (AngelList) ─────────────────────────────────────────────────
  'wellfound.com': {
    name: 'Wellfound',
    shortName: 'Wellfound',
    color: '#6e3fbd',
    icon: '🚀',

    hostname: 'wellfound.com',

    detectionSelectors: [
      '[data-test="JobApplicationModal"]',
      '.application-modal',
      '.job-application-form',
      '[class*="ApplicationModal"]',
      '[class*="applicationForm"]',
    ],

    applyButtonSelector: [
      '[data-test="JobListing-ApplyButton"]',
      'button[class*="applyButton"]',
      'a[href*="apply"]',
    ],

    formSelector: '[data-test="JobApplicationModal"], .application-modal',

    fieldMap: {
      firstName: [
        'input[placeholder*="First"]',
        'input[placeholder*="first"]',
        'input[name="firstName"]',
        'input[id*="firstName"]',
        'input[autocomplete="given-name"]',
      ],
      lastName: [
        'input[placeholder*="Last"]',
        'input[placeholder*="last"]',
        'input[name="lastName"]',
        'input[id*="lastName"]',
        'input[autocomplete="family-name"]',
      ],
      email: [
        'input[type="email"]',
        'input[name="email"]',
        'input[placeholder*="email"]',
      ],
      phone: [
        'input[type="tel"]',
        'input[name="phone"]',
        'input[placeholder*="phone"]',
        'input[placeholder*="Phone"]',
      ],
      coverLetter: [
        'textarea[placeholder*="introduction"]',
        'textarea[placeholder*="Introduction"]',
        'textarea[name="message"]',
        'textarea[name="intro"]',
        'textarea[placeholder*="Tell us"]',
        'textarea[placeholder*="cover"]',
      ],
      linkedinUrl: [
        'input[placeholder*="LinkedIn"]',
        'input[placeholder*="linkedin"]',
        'input[name="linkedinUrl"]',
        'input[name="linkedin"]',
      ],
      portfolioUrl: [
        'input[placeholder*="Portfolio"]',
        'input[placeholder*="GitHub"]',
        'input[placeholder*="website"]',
        'input[name="website"]',
        'input[name="portfolioUrl"]',
      ],
      location: [
        'input[placeholder*="Location"]',
        'input[placeholder*="City"]',
        'input[name="location"]',
      ],
    },

    skipIfFilled: ['email'],

    frameworkHint: 'react',

    shadowDOMHosts: [],
    radioGroups: {},

    selectFields: {
      workAuthorization: {
        selector: 'select[name*="authorization"], select[name*="visa"]',
        valueMap: {},
      },
    },
  },

  // ── Unstop ────────────────────────────────────────────────────────────────
  'unstop.com': {
    name: 'Unstop',
    shortName: 'Unstop',
    color: '#2196f3',
    icon: '🏆',

    hostname: 'unstop.com',

    detectionSelectors: [
      '.register-form',
      'app-registration-form',
      '.apply-competition-form',
      '[class*="registration"]',
      'form[class*="apply"]',
    ],

    applyButtonSelector: [
      '.register-btn',
      '.apply-btn',
      'button[class*="register"]',
    ],

    formSelector: '.register-form, app-registration-form',

    fieldMap: {
      fullName: [
        'input[formcontrolname="name"]',
        'input[formcontrolname="fullName"]',
        'input[placeholder*="name"]',
        'input[name="name"]',
      ],
      email: [
        'input[formcontrolname="email"]',
        'input[type="email"]',
        'input[name="email"]',
      ],
      phone: [
        'input[formcontrolname="phone"]',
        'input[formcontrolname="mobile"]',
        'input[type="tel"]',
        'input[name="phone"]',
      ],
      institution: [
        'input[formcontrolname="institute"]',
        'input[formcontrolname="college"]',
        'input[placeholder*="Institute"]',
        'input[placeholder*="College"]',
      ],
      location: [
        'input[formcontrolname="city"]',
        'input[formcontrolname="location"]',
        'input[placeholder*="City"]',
      ],
      coverLetter: [
        'textarea[formcontrolname="message"]',
        'textarea[formcontrolname="description"]',
        'textarea[placeholder*="message"]',
      ],
    },

    skipIfFilled: ['email'],

    // Angular forms — needs different event strategy
    frameworkHint: 'angular',

    shadowDOMHosts: [],
    radioGroups: {},
    selectFields: {},
  },
};

/**
 * Detects which portal the current page belongs to
 * @param {string} [hostname] - Defaults to window.location.hostname
 * @returns {{ key: string, config: object } | null}
 */
function detectCurrentPortal(hostname) {
  const host = hostname || window.location.hostname;
  for (const [key, config] of Object.entries(PORTAL_CONFIGS)) {
    if (host.includes(config.hostname)) {
      return { key, config };
    }
  }
  return null;
}

/**
 * Returns all CSS selectors for a given field key across all portals
 * (used by the generic fallback detector)
 * @param {string} fieldKey
 * @returns {string[]}
 */
function getAllSelectorsForField(fieldKey) {
  const selectors = new Set();
  for (const config of Object.values(PORTAL_CONFIGS)) {
    const fieldSelectors = config.fieldMap[fieldKey] || [];
    fieldSelectors.forEach(s => selectors.add(s));
  }
  return [...selectors];
}

