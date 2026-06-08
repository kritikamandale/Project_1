/**
 * Arlo Match Scorer
 *
 * Calls the backend to score how well a candidate's profile matches
 * a job description, then returns structured results for the popup
 * to render the match card.
 *
 * This is an ES module — imported by popup.js.
 */

const BACKEND_URL = (typeof process !== 'undefined' && process.env?.BACKEND_URL)
  || 'https://your-backend.railway.app';

/**
 * Scores the profile against the current job description.
 *
 * @param {object} jobContext   — from extractJobDetails()
 * @param {object} profile      — decrypted profile from profile-store
 * @param {string} authToken    — Firebase ID token
 * @returns {Promise<{
 *   score: number,
 *   matchedSkills: string[],
 *   missingSkills: string[],
 *   experienceMatch: boolean,
 *   tip: string,
 *   label: string,
 *   color: string
 * }>}
 */
export async function scoreMatch(jobContext, profile, authToken) {
  if (!authToken) throw new Error('Auth token required for AI features');
  if (!jobContext?.description && !jobContext?.requiredSkills?.length) {
    throw new Error('No job description to score against');
  }

  const body = {
    jobDescription: buildJobText(jobContext),
    userProfile:    buildProfilePayload(profile),
  };

  const res = await fetch(`${BACKEND_URL}/api/ai/match-score`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || `Match score failed (${res.status})`);
    err.status = res.status;
    throw err;
  }

  // Augment with display metadata
  return {
    ...data,
    label: getScoreLabel(data.score),
    color: getScoreColor(data.score),
  };
}

// ── Score display helpers ─────────────────────────────────────────────────

function getScoreLabel(score) {
  if (score >= 85) return 'Excellent Match';
  if (score >= 70) return 'Good Match';
  if (score >= 50) return 'Partial Match';
  return 'Weak Match';
}

function getScoreColor(score) {
  if (score >= 85) return '#22c55e';
  if (score >= 70) return '#4ade80';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

// ── Payload builders ──────────────────────────────────────────────────────

function buildJobText(jd) {
  const parts = [];
  if (jd.jobTitle)           parts.push(`Job Title: ${jd.jobTitle}`);
  if (jd.company)            parts.push(`Company: ${jd.company}`);
  if (jd.experienceRequired) parts.push(`Experience Required: ${jd.experienceRequired}`);
  if (jd.requiredSkills?.length) parts.push(`Required Skills: ${jd.requiredSkills.join(', ')}`);
  if (jd.description)        parts.push(`\n${jd.description.slice(0, 2500)}`);
  return parts.join('\n');
}

function buildProfilePayload(profile) {
  return {
    personal: {
      headline: profile.personal?.headline,
      summary:  profile.personal?.summary,
    },
    education: profile.education?.slice(0, 2).map(e => ({
      degree:      e.degree,
      institution: e.institution,
      endYear:     e.endYear,
    })),
    experience: profile.experience?.slice(0, 4).map(e => ({
      title:       e.title,
      company:     e.company,
      description: e.description?.slice(0, 150),
    })),
    skills: {
      technical: profile.skills?.technical?.map(s => typeof s === 'object' ? s.name : s) || [],
      soft:      profile.skills?.soft?.map(s => typeof s === 'object' ? s.name : s) || [],
    },
    preferences: {
      totalExperience: profile.preferences?.totalExperience,
    },
  };
}

