/**
 * Content Security Policy helpers
 * Utilities for working safely within CSP constraints in MV3
 */

/**
 * Safely creates a DOM element with text content (never innerHTML)
 * @param {string} tag
 * @param {string} text
 * @param {object} attrs
 * @returns {HTMLElement}
 */
export function createSafeElement(tag, text = '', attrs = {}) {
  const el = document.createElement(tag);
  if (text) el.textContent = text; // textContent is safe, no XSS
  for (const [key, val] of Object.entries(attrs)) {
    el.setAttribute(key, val);
  }
  return el;
}

/**
 * Checks if the current page origin is an allowed job portal
 * @param {string} origin
 * @returns {boolean}
 */
export function isAllowedOrigin(origin) {
  const allowed = [
    'linkedin.com',
    'naukri.com',
    'internshala.com',
    'wellfound.com',
    'unstop.com',
  ];
  return allowed.some(domain => origin.includes(domain));
}

/**
 * Validates that a message sender is the extension itself
 * @param {object} sender - chrome.runtime sender object
 * @returns {boolean}
 */
export function isExtensionSender(sender) {
  return sender.id === chrome.runtime.id;
}

