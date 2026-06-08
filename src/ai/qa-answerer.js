/**
 * Arlo QA Answerer
 *
 * Finds non-standard screening questions on the page, calls the backend
 * to generate personalised AI answers, and returns answer cards for the
 * popup to display. The user approves each answer before it is injected.
 *
 * Flow:
 *  1. detectScreeningQuestions()  ← content script (jd-extractor.js)
 *  2. answerAllQuestions()        ← calls backend for each question
 *  3. Popup shows answer cards    ← user clicks Fill / Edit / Skip
 *  4. injectAnswer()              ← sends INJECT_FIELD_VALUE to content script
 *
 * This is an ES module — imported by popup.js.
 */

const BACKEND_URL = (typeof process !== 'undefined' && process.env?.BACKEND_URL)
  || 'https://your-backend.railway.app';

/**
 * Asks the content script to detect screening questions on the active tab.
 *
 * @returns {Promise<Array<{ question: string, selector: string, type: string }>>}
 */
export async function getScreeningQuestions() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return [];

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'GET_SCREENING_QUESTIONS',
    });
    return response?.questions || [];
  } catch {
    return [];
  }
}

/**
 * Generates AI answers for an array of screening questions.
 * Returns one answer card per question.
 *
 * @param {Array<{ question: string, selector: string }>} questions
 * @param {object} profile      — decrypted profile from profile-store
 * @param {object} jobContext   — from extractJobDetails()
 * @param {string} authToken    — Firebase ID token
 * @param {function} [onProgress] — called with (index, total) after each answer
 * @returns {Promise<Array<{
 *   question: string,
 *   answer: string,
 *   selector: string,
 *   status: 'pending' | 'approved' | 'edited' | 'skipped'
 * }>>}
 */
export async function answerAllQuestions(questions, profile, jobContext, authToken, onProgress) {
  if (!questions.length) return [];
  if (!authToken) throw new Error('Auth token required for AI features');

  const cards = [];

  for (let i = 0; i < questions.length; i++) {
    const { question, selector, type } = questions[i];
    try {
      const result = await answerQuestion(question, profile, jobContext, authToken);
      cards.push({
        question,
        answer:   result.answer,
        selector,
        type,
        status:   'pending',
        error:    null,
      });
    } catch (err) {
      cards.push({
        question,
        answer:   '',
        selector,
        type,
        status:   'error',
        error:    err.message,
      });
    }
    onProgress?.(i + 1, questions.length);
  }

  return cards;
}

/**
 * Calls the backend to answer a single screening question.
 *
 * @param {string} question
 * @param {object} profile
 * @param {object} jobContext
 * @param {string} authToken
 * @returns {Promise<{ answer: string, question: string }>}
 */
export async function answerQuestion(question, profile, jobContext, authToken) {
  if (!authToken) throw new Error('Auth token required');

  const body = {
    question,
    userProfile: buildProfilePayload(profile),
    jobContext: {
      jobTitle:       jobContext?.jobTitle       || '',
      company:        jobContext?.company        || '',
      requiredSkills: jobContext?.requiredSkills || [],
      jobType:        jobContext?.jobType        || '',
    },
  };

  const res = await fetch(`${BACKEND_URL}/api/ai/answer-question`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || `AI request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data; // { answer, question }
}

/**
 * Injects an approved answer into the field on the active tab.
 *
 * @param {string} selector  — CSS selector of the target field
 * @param {string} answer    — approved answer text
 * @returns {Promise<boolean>}
 */
export async function injectAnswer(selector, answer) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');

  const response = await chrome.tabs.sendMessage(tab.id, {
    action:   'INJECT_FIELD_VALUE',
    selector,
    value:    answer,
  });

  return response?.success === true;
}

// ── Profile payload builder (same as cover-letter.js) ─────────────────────
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
    education: profile.education?.slice(0, 2).map(e => ({
      institution: e.institution,
      degree:      e.degree,
      field:       e.field,
      endYear:     e.endYear,
      grade:       e.grade,
    })),
    experience: profile.experience?.slice(0, 3).map(e => ({
      company:     e.company,
      title:       e.title,
      type:        e.type,
      isCurrent:   e.isCurrent,
      description: e.description?.slice(0, 150),
    })),
    skills: {
      technical: profile.skills?.technical?.map(s => typeof s === 'object' ? s.name : s) || [],
      soft:      profile.skills?.soft?.map(s => typeof s === 'object' ? s.name : s) || [],
    },
    preferences: {
      totalExperience: profile.preferences?.totalExperience,
      expectedCTC:     profile.preferences?.expectedCTC,
      noticePeriod:    profile.preferences?.noticePeriod,
      currentCTC:      profile.preferences?.currentCTC,
    },
  };
}

