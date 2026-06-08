/**
 * Arlo JD Extractor — Phase 3
 *
 * Extracts structured job data from job portal pages:
 *   jobTitle, company, location, description,
 *   requiredSkills[], experienceRequired, jobType, salaryRange
 *
 * Also exposes detectScreeningQuestions() used by the QA answerer.
 *
 * Injected as a plain content script — no ES module exports.
 */

// ── Portal-specific DOM selectors ────────────────────────────────────────────
const JD_PORTAL_SELECTORS = {
  'linkedin.com': {
    title:       ['.job-details-jobs-unified-top-card__job-title h1',
                  '.jobs-unified-top-card__job-title h1',
                  '.t-24.t-bold'],
    company:     ['.job-details-jobs-unified-top-card__company-name a',
                  '.jobs-unified-top-card__company-name',
                  '.topcard__org-name-link'],
    description: ['.jobs-description__content .jobs-box__html-content',
                  '.jobs-description-content__text',
                  '.description__text'],
    location:    ['.job-details-jobs-unified-top-card__bullet',
                  '.jobs-unified-top-card__bullet',
                  '.topcard__flavor--bullet'],
    salary:      ['.compensation__salary',
                  '.jobs-details__salary-main-rail-card'],
    jobType:     ['.job-details-jobs-unified-top-card__job-insight span',
                  '.jobs-unified-top-card__workplace-type'],
  },
  'naukri.com': {
    title:       ['h1.jd-header-title', 'h1.job-titl',
                  '.jd-header-title'],
    company:     ['.jd-header-comp-name a', '.comp-name',
                  '.company-info a'],
    description: ['.job-desc .dang-inner-html', '.job-desc',
                  '.jd-desc'],
    location:    ['.loc-wrap .loc', '.locWdth'],
    salary:      ['.salary-detail', '.ctc-detail'],
    jobType:     ['.job-type-label', '.employment-type'],
  },
  'internshala.com': {
    title:       ['.profile-container h3', '.internship_heading .heading_3_5',
                  'h1.heading_4_5'],
    company:     ['.company-name a', '.company_name',
                  '.link_display_like_text'],
    description: ['.internship-detail-heading ~ div', '.about-section p',
                  '.text-container'],
    location:    ['.location_link', '.other_detail_item .item_body'],
    salary:      ['.stipend', '.salary'],
    jobType:     ['.internship-meta .item_body', '.work-from-home-tag'],
  },
  'wellfound.com': {
    title:       ['h1[data-test="JobListingTitle"]', 'h1.mb-6',
                  '[class*="JobTitle"]'],
    company:     ['[data-test="StartupLink"]', '.startup-link',
                  'a[class*="company"]'],
    description: ['[data-test="JobDescription"]', '.job-description',
                  '[class*="jobDescription"]'],
    location:    ['[data-test="JobListingLocation"]', '.location'],
    salary:      ['[data-test="Compensation"]', '.compensation'],
    jobType:     ['[data-test="JobType"]', '.job-type'],
  },
  'unstop.com': {
    title:       ['.opportunity-title h1', '.title-section h1'],
    company:     ['.company-name a', '.organizer-name'],
    description: ['.about-section .desc-section', '.problem-statement'],
    location:    ['.location-text', '.event-location'],
    salary:      ['.prize-money', '.stipend-amount'],
    jobType:     ['.opportunity-type', '.category-tags'],
  },
};

// ── Tech skills master list for extraction ────────────────────────────────────
// Ordered: longer / more specific phrases first to avoid substring false-positives
const SKILL_KEYWORDS = [
  // Languages
  'TypeScript','JavaScript','Python','Java','Kotlin','Swift','Go','Rust','C\\+\\+','C#',
  'Ruby','PHP','Scala','R','MATLAB','Dart','Perl','Bash','Shell',
  // Frontend
  'React\\.js','React Native','Next\\.js','Vue\\.js','Angular','Svelte','Redux',
  'Tailwind CSS','SCSS','CSS','HTML5',
  // Backend
  'Node\\.js','Express\\.js','FastAPI','Django','Flask','Spring Boot','Laravel',
  'NestJS','GraphQL','REST API','gRPC',
  // Databases
  'PostgreSQL','MySQL','MongoDB','Redis','Elasticsearch','Cassandra','DynamoDB',
  'Firebase','Supabase','SQLite',
  // Cloud / DevOps
  'AWS','GCP','Azure','Docker','Kubernetes','Terraform','Jenkins','GitHub Actions',
  'CI/CD','Linux','Nginx','Apache',
  // Data / ML
  'TensorFlow','PyTorch','scikit-learn','Pandas','NumPy','Spark','Hadoop',
  'Machine Learning','Deep Learning','NLP','Computer Vision','LLM',
  // Tools / Practices
  'Git','GitHub','Jira','Figma','Postman','Swagger',
  'Microservices','Agile','Scrum','TDD','OOP',
];

const SKILL_REGEX = new RegExp(
  `\\b(${SKILL_KEYWORDS.join('|')})\\b`,
  'gi'
);

// ── Experience patterns ───────────────────────────────────────────────────────
const EXP_PATTERNS = [
  /(\d+)\s*[-–]\s*(\d+)\s+years?\s+(?:of\s+)?(?:work\s+)?experience/i,
  /(\d+)\+?\s+years?\s+(?:of\s+)?(?:work\s+)?experience/i,
  /experience\s*(?:of|:)?\s*(\d+)\s*[-–+]\s*(\d+)\s*years?/i,
  /minimum\s+(\d+)\s+years?/i,
  /at\s+least\s+(\d+)\s+years?/i,
  /(\d+)\s+to\s+(\d+)\s+years?/i,
];

// ── Job type patterns ─────────────────────────────────────────────────────────
const JOB_TYPE_PATTERNS = {
  'Full-time':  [/full[\s-]?time/i, /permanent/i],
  'Part-time':  [/part[\s-]?time/i],
  'Internship': [/intern(?:ship)?/i, /trainee/i, /apprentice/i],
  'Contract':   [/contract/i, /freelance/i, /consultant/i],
  'Remote':     [/remote/i, /work from home/i, /wfh/i, /distributed/i],
  'Hybrid':     [/hybrid/i, /flexible.*location/i],
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main extraction function — returns fully structured job context.
 *
 * @returns {{
 *   jobTitle: string,
 *   company: string,
 *   location: string,
 *   description: string,
 *   requiredSkills: string[],
 *   experienceRequired: string,
 *   jobType: string,
 *   salaryRange: string,
 *   url: string,
 *   portal: string,
 *   extractedAt: string
 * }}
 */
function extractJobDetails() {
  const hostname  = window.location.hostname;
  const portalKey = Object.keys(JD_PORTAL_SELECTORS).find(k => hostname.includes(k));

  const result = {
    jobTitle:           '',
    company:            '',
    location:           '',
    description:        '',
    requiredSkills:     [],
    experienceRequired: '',
    jobType:            '',
    salaryRange:        '',
    url:                window.location.href,
    portal:             portalKey || hostname,
    extractedAt:        new Date().toISOString(),
  };

  // ── 1. Portal-specific selectors ─────────────────────────────────────────
  if (portalKey) {
    const sel = JD_PORTAL_SELECTORS[portalKey];
    result.jobTitle  = extractTextFirst(sel.title)   || extractTitleHeuristic();
    result.company   = extractTextFirst(sel.company) || '';
    result.location  = extractTextFirst(sel.location)|| '';
    result.salaryRange = extractTextFirst(sel.salary) || '';

    // Description: try selectors, fall back to largest text block
    const descText = extractDescriptionText(sel.description);
    result.description = descText || extractLargestTextBlock();
  } else {
    // Unknown portal — pure heuristics
    result.jobTitle    = extractTitleHeuristic();
    result.description = extractLargestTextBlock();
  }

  // ── 2. Derived fields from description ────────────────────────────────────
  if (result.description) {
    result.requiredSkills     = extractSkills(result.description);
    result.experienceRequired = extractExperience(result.description);
    result.jobType            = result.jobType || extractJobType(result.description);
  }

  // Also extract skills from the title if description is sparse
  if (result.requiredSkills.length === 0 && result.jobTitle) {
    result.requiredSkills = extractSkills(result.jobTitle);
  }

  return result;
}

/**
 * Detects "screening questions" — textarea / text inputs that are NOT
 * standard form fields (name, email, phone, etc.).
 *
 * Used by the QA answerer to find questions needing AI answers.
 *
 * @returns {Array<{ element: HTMLElement, question: string, selector: string }>}
 */
function detectScreeningQuestions() {
  const STANDARD_FIELD_PATTERNS = [
    /^(first|last|full)\s*name$/i,
    /^email/i,
    /^phone|mobile|contact/i,
    /^address|city|location/i,
    /^linkedin/i,
    /^portfolio|website|github/i,
    /^resume|cv/i,
    /^salary|ctc/i,
    /^notice/i,
    /^experience$/i,
  ];

  const questions = [];
  const candidates = document.querySelectorAll('textarea, input[type="text"]');

  candidates.forEach(el => {
    if (!isElementVisible(el) || el.disabled || el.readOnly) return;

    // Get the question label
    const label = getQuestionLabel(el);
    if (!label || label.length < 5) return;

    // Skip if it looks like a standard field
    const isStandard = STANDARD_FIELD_PATTERNS.some(p => p.test(label));
    if (isStandard) return;

    // Skip short inputs (probably not a question field)
    if (el.tagName === 'INPUT' && (el.maxLength > 0 && el.maxLength < 50)) return;

    questions.push({
      element:  el,
      question: label.trim(),
      selector: buildUniqueSelector(el),
      type:     el.tagName.toLowerCase(),
    });
  });

  return questions;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function extractTextFirst(selectors = []) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.innerText?.trim() || el.textContent?.trim();
        if (text && text.length > 1) return text.slice(0, 300);
      }
    } catch (_) {}
  }
  return '';
}

/**
 * Extracts description text — concatenates all matched elements,
 * prefers the longest single block.
 */
function extractDescriptionText(selectors = []) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.innerText?.trim() || el.textContent?.trim();
        if (text && text.length > 100) return text.slice(0, 6000);
      }
    } catch (_) {}
  }
  return '';
}

/**
 * Heuristic title extraction — looks for h1/h2 near the top of visible content.
 */
function extractTitleHeuristic() {
  const headings = document.querySelectorAll('h1, h2');
  for (const h of headings) {
    const text = h.innerText?.trim();
    if (text && text.length > 3 && text.length < 150) {
      // Avoid navigation headings (very short generic text)
      const lower = text.toLowerCase();
      if (!['home', 'jobs', 'careers', 'search', 'login'].includes(lower)) {
        return text;
      }
    }
  }
  return document.title?.split(/[|\-–]/)[0]?.trim() || '';
}

/**
 * Finds the largest text block on the page — used as JD fallback.
 * Excludes nav, header, footer, scripts.
 */
function extractLargestTextBlock() {
  const candidates = document.querySelectorAll(
    'article, main, [class*="description"], [class*="detail"], [id*="description"], [id*="job"], section, div'
  );

  let best = '';
  let bestLen = 200; // minimum threshold

  for (const el of candidates) {
    // Skip navigation / chrome elements
    const tag = el.tagName.toLowerCase();
    if (['nav', 'header', 'footer', 'script', 'style', 'noscript'].includes(tag)) continue;
    if (el.closest('nav, header, footer')) continue;

    const text = el.innerText?.trim();
    if (text && text.length > bestLen && text.length < 10000) {
      best    = text;
      bestLen = text.length;
    }
  }

  return best.slice(0, 6000);
}

/**
 * Extracts tech skills from text using the keyword list.
 * Deduplicates and returns in original casing from the keyword list.
 */
function extractSkills(text) {
  const found  = new Map(); // normalized → display
  const matches = text.matchAll(SKILL_REGEX);

  for (const match of matches) {
    const normalized = match[1].toLowerCase().replace(/\s+/g, '');
    if (!found.has(normalized)) {
      // Prefer the canonical casing from SKILL_KEYWORDS
      const canonical = SKILL_KEYWORDS.find(
        k => k.toLowerCase().replace(/\\/g, '').replace(/\s+/g, '') === normalized
      );
      found.set(normalized, canonical ? canonical.replace(/\\/g, '') : match[1]);
    }
  }

  return [...found.values()].slice(0, 25); // cap at 25 skills
}

/**
 * Extracts experience requirement from text.
 * Returns human-readable string like "2-4 years" or "3+ years".
 */
function extractExperience(text) {
  for (const pattern of EXP_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      if (match[2]) return `${match[1]}-${match[2]} years`;
      return `${match[1]}+ years`;
    }
  }
  // Check for "fresher" / "entry level"
  if (/fresh(?:er|graduate)|entry[\s-]?level|0\s*years?/i.test(text)) {
    return '0-1 years (Fresher)';
  }
  return '';
}

/**
 * Infers job type from description text.
 */
function extractJobType(text) {
  for (const [type, patterns] of Object.entries(JOB_TYPE_PATTERNS)) {
    if (patterns.some(p => p.test(text))) return type;
  }
  return 'Full-time'; // default
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREENING QUESTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getQuestionLabel(el) {
  // 1. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.length > 4) return ariaLabel;

  // 2. for= label
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label.innerText?.trim();
  }

  // 3. Closest label parent
  const parentLabel = el.closest('label');
  if (parentLabel) return parentLabel.innerText?.trim();

  // 4. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.innerText?.trim();
  }

  // 5. Immediately preceding sibling / parent text node
  const prev = el.previousElementSibling;
  if (prev && prev.textContent?.trim().length > 4 && prev.textContent?.trim().length < 200) {
    return prev.textContent.trim();
  }

  // 6. placeholder as last resort
  return el.placeholder || '';
}

function isElementVisible(el) {
  if (!el) return false;
  const rect  = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 &&
    style.display !== 'none' && style.visibility !== 'hidden';
}

function buildUniqueSelector(el) {
  if (el.id) return `#${el.id}`;
  if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
  if (el.getAttribute('aria-label')) {
    return `${el.tagName.toLowerCase()}[aria-label="${el.getAttribute('aria-label').slice(0, 40)}"]`;
  }
  return el.tagName.toLowerCase();
}

