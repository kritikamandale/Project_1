/**
 * Arlo Cover Letter Generator
 *
 * Calls the backend AI proxy and handles the full UX lifecycle:
 *   load → preview → tone selector → approve → inject into page
 *
 * This is an ES module — imported by popup.js.
 */

const BACKEND_URL = (typeof process !== 'undefined' && process.env?.BACKEND_URL)
  || 'https://your-backend.railway.app'; // replaced at deploy time

export const TONES = [
  { id: 'professional', label: '🎯 Professional', desc: 'Confident and balanced' },
  { id: 'enthusiastic', label: '⚡ Enthusiastic',  desc: 'Energetic and passionate' },
  { id: 'formal',       label: '📋 Formal',        desc: 'Polished, respectful' },
  { id: 'concise',      label: '✂️ Concise',        desc: 'Under 120 words' },
];

/**
 * Calls the backend to generate a cover letter.
 *
 * @param {object} jobContext  — from extractJobDetails()
 * @param {object} profile     — decrypted profile from profile-store
 * @param {string} [tone]      — 'professional' | 'enthusiastic' | 'formal' | 'concise'
 * @param {string} authToken   — Firebase ID token
 * @returns {Promise<{ coverLetter: string, tone: string, wordCount: number }>}
 */
export async function generateCoverLetter(jobContext, profile, tone = 'professional', authToken) {
  if (!authToken) throw new Error('Auth token required for AI features');
  if (!jobContext?.description && !jobContext?.jobTitle) {
    throw new Error('No job description found on this page');
  }

  const body = {
    jobDescription: buildJobDescriptionText(jobContext),
    userProfile:    buildProfilePayload(profile),
    tone,
  };

  const res = await fetchAI('/api/ai/cover-letter', body, authToken);
  return res; // { coverLetter, tone, wordCount }
}

/**
 * Injects an approved cover letter into the active page's cover letter field.
 * Sends a message to the content script to do the actual DOM fill.
 *
 * @param {string} coverLetterText
 * @returns {Promise<boolean>}
 */
export async function injectCoverLetter(coverLetterText) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');

  const response = await chrome.tabs.sendMessage(tab.id, {
    action: 'INJECT_COVER_LETTER',
    text:   coverLetterText,
  });

  return response?.success === true;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildJobDescriptionText(jd) {
  const parts = [];
  if (jd.jobTitle)           parts.push(`Job Title: ${jd.jobTitle}`);
  if (jd.company)            parts.push(`Company: ${jd.company}`);
  if (jd.location)           parts.push(`Location: ${jd.location}`);
  if (jd.jobType)            parts.push(`Type: ${jd.jobType}`);
  if (jd.experienceRequired) parts.push(`Experience Required: ${jd.experienceRequired}`);
  if (jd.requiredSkills?.length) parts.push(`Skills: ${jd.requiredSkills.join(', ')}`);
  if (jd.description)        parts.push(`\nDescription:\n${jd.description.slice(0, 2500)}`);
  return parts.join('\n');
}

/**
 * Strips sensitive encrypted fields before sending to backend.
 * Only sends what's needed for personalisation.
 */
function buildProfilePayload(profile) {
  return {
    personal: {
      firstName:    profile.personal?.firstName,
      lastName:     profile.personal?.lastName,
      fullName:     profile.personal?.fullName,
      headline:     profile.personal?.headline,
      location:     profile.personal?.location,
      summary:      profile.personal?.summary,
      linkedinUrl:  profile.personal?.linkedinUrl,
      portfolioUrl: profile.personal?.portfolioUrl,
    },
    education:   profile.education?.slice(0, 2).map(e => ({
      institution: e.institution,
      degree:      e.degree,
      field:       e.field,
      endYear:     e.endYear,
      grade:       e.grade,
    })),
    experience:  profile.experience?.slice(0, 3).map(e => ({
      company:     e.company,
      title:       e.title,
      type:        e.type,
      isCurrent:   e.isCurrent,
      startDate:   e.startDate,
      endDate:     e.endDate,
      description: e.description?.slice(0, 200),
    })),
    skills:      {
      technical: profile.skills?.technical?.map(s => typeof s === 'object' ? s.name : s) || [],
      soft:      profile.skills?.soft?.map(s => typeof s === 'object' ? s.name : s) || [],
    },
    preferences: {
      totalExperience: profile.preferences?.totalExperience,
      expectedCTC:     profile.preferences?.expectedCTC,
      noticePeriod:    profile.preferences?.noticePeriod,
    },
  };
}

async function fetchAI(path, body, token) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    const err = new Error(data.error || `AI request failed (${res.status})`);
    err.status = res.status;
    if (data.upgradeUrl) err.upgradeUrl = data.upgradeUrl;
    throw err;
  }

  return data;
}

