/**
 * Form Detector + Portal Config tests
 * Run with: npm test
 */

// Mock chrome API
global.chrome = {
  runtime: {
    id: 'test-ext-id',
    sendMessage: jest.fn(),
  },
  storage: {
    local: {
      get: jest.fn((keys, cb) => cb({})),
      set: jest.fn((data, cb) => cb?.()),
    },
  },
};

// Mock CSS.escape if not available in jsdom
if (!global.CSS) {
  global.CSS = { escape: (s) => s.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&') };
}

describe('Portal Config — detectCurrentPortal()', () => {
  beforeEach(() => {
    // Load portal-configs.js in the test environment
    // Since it's a plain script (no exports), we evaluate it
    const fs = require('fs');
    const path = require('path');
    const code = fs.readFileSync(
      path.join(__dirname, '../src/utils/portal-configs.js'), 'utf8'
    );
    eval(code); // eslint-disable-line no-eval
  });

  test('detects linkedin.com', () => {
    delete window.location;
    window.location = { hostname: 'www.linkedin.com', href: 'https://www.linkedin.com/jobs' };
    const result = detectCurrentPortal();
    expect(result).not.toBeNull();
    expect(result.key).toBe('linkedin.com');
    expect(result.config.name).toBe('LinkedIn');
  });

  test('detects naukri.com', () => {
    delete window.location;
    window.location = { hostname: 'www.naukri.com', href: 'https://www.naukri.com/jobs' };
    const result = detectCurrentPortal();
    expect(result).not.toBeNull();
    expect(result.key).toBe('naukri.com');
  });

  test('returns null for non-portal site', () => {
    delete window.location;
    window.location = { hostname: 'www.google.com', href: 'https://www.google.com' };
    const result = detectCurrentPortal();
    expect(result).toBeNull();
  });

  test('LinkedIn fieldMap has all required fields', () => {
    const linkedin = PORTAL_CONFIGS['linkedin.com'];
    expect(linkedin.fieldMap.firstName).toBeDefined();
    expect(linkedin.fieldMap.lastName).toBeDefined();
    expect(linkedin.fieldMap.email).toBeDefined();
    expect(linkedin.fieldMap.phone).toBeDefined();
    expect(linkedin.fieldMap.coverLetter).toBeDefined();
    expect(linkedin.fieldMap.resumeUpload).toBeDefined();
  });

  test('Naukri fieldMap has phone, currentCTC, expectedCTC', () => {
    const naukri = PORTAL_CONFIGS['naukri.com'];
    expect(naukri.fieldMap.phone).toContain('#phno');
    expect(naukri.fieldMap.currentCTC).toContain('#currSalary');
    expect(naukri.fieldMap.expectedCTC).toBeDefined();
  });

  test('Internshala fieldMap has coverLetter and whyInterested', () => {
    const internshala = PORTAL_CONFIGS['internshala.com'];
    expect(internshala.fieldMap.coverLetter).toContain('#cover_letter');
    expect(internshala.fieldMap.whyInterested).toBeDefined();
  });

  test('Wellfound fieldMap has firstName, lastName, intro selectors', () => {
    const wf = PORTAL_CONFIGS['wellfound.com'];
    expect(wf.fieldMap.firstName.some(s => s.includes('First'))).toBe(true);
    expect(wf.fieldMap.lastName.some(s => s.includes('Last'))).toBe(true);
    expect(wf.fieldMap.coverLetter.some(s => s.includes('introduction'))).toBe(true);
  });
});

describe('Form Detector — findFormFields()', () => {
  let detectPortalFn;
  let findFormFieldsFn;

  beforeEach(() => {
    document.body.innerHTML = '';

    const fs = require('fs');
    const path = require('path');

    // Load dependencies in order
    const portalCode = fs.readFileSync(
      path.join(__dirname, '../src/utils/portal-configs.js'), 'utf8'
    );
    const detectorCode = fs.readFileSync(
      path.join(__dirname, '../src/content/form-detector.js'), 'utf8'
    );
    eval(portalCode);  // eslint-disable-line no-eval
    eval(detectorCode);// eslint-disable-line no-eval
  });

  test('detects email field by input type', () => {
    document.body.innerHTML = `<form><input type="email" name="email" /></form>`;
    delete window.location;
    window.location = { hostname: 'www.google.com', href: 'https://www.google.com' };
    const result = findFormFields();
    expect(result.fields.email).toBeDefined();
    expect(result.fields.email.element).toBeTruthy();
  });

  test('detects first name by id attribute', () => {
    document.body.innerHTML = `<form><input type="text" id="firstName" /></form>`;
    const result = findFormFields();
    expect(result.fields.firstName).toBeDefined();
  });

  test('detects phone by placeholder', () => {
    document.body.innerHTML = `<form><input type="text" placeholder="Enter mobile number" /></form>`;
    const result = findFormFields();
    expect(result.fields.phone).toBeDefined();
  });

  test('does not include disabled inputs', () => {
    document.body.innerHTML = `<form><input type="text" id="firstName" disabled /></form>`;
    const result = findFormFields();
    expect(result.fields.firstName).toBeUndefined();
  });

  test('detects field via associated label', () => {
    document.body.innerHTML = `
      <form>
        <label for="x">Last Name</label>
        <input type="text" id="x" />
      </form>
    `;
    const result = findFormFields();
    expect(result.fields.lastName).toBeDefined();
  });

  test('confidence score is between 0 and 1', () => {
    document.body.innerHTML = `<form><input type="email" id="email" name="email" /></form>`;
    const result = findFormFields();
    if (result.fields.email) {
      expect(result.fields.email.confidence).toBeGreaterThan(0);
      expect(result.fields.email.confidence).toBeLessThanOrEqual(1);
    }
  });

  test('totalFound matches number of fields object keys', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" id="firstName" />
        <input type="text" id="lastName" />
        <input type="email" id="email" />
      </form>
    `;
    const result = findFormFields();
    expect(result.totalFound).toBe(Object.keys(result.fields).length);
  });

  test('hidden inputs are excluded', () => {
    document.body.innerHTML = `
      <form>
        <input type="hidden" name="csrf" value="abc" />
        <input type="text" id="firstName" />
      </form>
    `;
    const result = findFormFields();
    // Only firstName should be detected, not the hidden field
    Object.values(result.fields).forEach(f => {
      expect(f.element.type).not.toBe('hidden');
    });
  });
});

describe('Sanitizer — validateFieldValue()', () => {
  const fs = require('fs');
  const path = require('path');

  let validateFieldValue;
  let sanitizeString;

  beforeAll(async () => {
    // Use dynamic import with jest transforms disabled for this module
    // We test the exported functions directly
    const mod = await import('../src/security/sanitizer.js');
    validateFieldValue = mod.validateFieldValue;
    sanitizeString     = mod.sanitizeString;
  });

  test('valid email passes', () => {
    const result = validateFieldValue('email', 'user@example.com');
    expect(result.valid).toBe(true);
  });

  test('invalid email fails', () => {
    const result = validateFieldValue('email', 'not-an-email');
    expect(result.valid).toBe(false);
  });

  test('valid phone passes', () => {
    const result = validateFieldValue('phone', '+91 9876543210');
    expect(result.valid).toBe(true);
  });

  test('invalid phone fails', () => {
    const result = validateFieldValue('phone', 'abc');
    expect(result.valid).toBe(false);
  });

  test('linkedin URL validates domain', () => {
    expect(validateFieldValue('linkedinUrl', 'https://linkedin.com/in/johndoe').valid).toBe(true);
    expect(validateFieldValue('linkedinUrl', 'https://example.com').valid).toBe(false);
  });

  test('sanitizeString strips script tags', () => {
    const result = sanitizeString('<script>alert("xss")</script>');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });

  test('sanitizeString strips javascript: protocol', () => {
    const result = sanitizeString('javascript:alert(1)');
    expect(result).not.toContain('javascript:');
  });

  test('sanitizeString strips event handlers', () => {
    const result = sanitizeString('hello onclick=steal()');
    expect(result.toLowerCase()).not.toContain('onclick=');
  });

  test('empty value fails validation', () => {
    const result = validateFieldValue('email', '');
    expect(result.valid).toBe(false);
  });
});

