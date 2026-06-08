/**
 * Arlo AI Routes
 * POST /api/ai/cover-letter
 * POST /api/ai/answer-question
 * POST /api/ai/match-score
 *
 * Security:
 *  - authGuard:  every request must carry a valid Firebase JWT
 *  - aiLimiter:  20 AI requests / hour per uid (express-rate-limit)
 *  - Input validation before any Claude call
 *  - Logging: timestamp + uid only — zero PII in logs
 */

'use strict';

const router    = require('express').Router();
const authGuard = require('../middleware/auth-guard');
const { aiLimiter } = require('../middleware/rate-limiter');
const { callClaude }= require('../lib/ai-client');
const admin     = require('../lib/firebase-admin');

// Apply auth + rate limiting to every AI route
router.use(authGuard);
router.use(aiLimiter);

// ── Request logger (uid only, no personal data) ────────────────────────────
function logAIRequest(uid, endpoint) {
  console.log(JSON.stringify({
    ts:       new Date().toISOString(),
    uid,
    endpoint,
    level:    'info',
  }));
}

// ── Input helpers ──────────────────────────────────────────────────────────
function requireFields(body, fields) {
  const missing = fields.filter(f => !body[f]);
  return missing.length ? `Missing fields: ${missing.join(', ')}` : null;
}

function truncate(str, max) {
  if (!str) return '';
  return String(str).slice(0, max);
}

// ── Profile → readable summary for prompts ─────────────────────────────────
function buildProfileSummary(profile) {
  if (!profile) return 'Profile not provided.';

  const p    = profile.personal    || {};
  const prefs= profile.preferences || {};
  const edu  = (profile.education  || []).slice(0, 2);
  const exp  = (profile.experience || []).slice(0, 3);
  const skills = [
    ...(profile.skills?.technical || []),
    ...(profile.skills?.soft      || []),
  ].map(s => (typeof s === 'object' ? s.name : s)).slice(0, 20);

  const lines = [];

  // Personal
  if (p.fullName || p.firstName) {
    lines.push(`Name: ${p.fullName || `${p.firstName} ${p.lastName}`}`);
  }
  if (p.headline)  lines.push(`Role: ${p.headline}`);
  if (p.location)  lines.push(`Location: ${p.location}`);
  if (p.summary)   lines.push(`Summary: ${truncate(p.summary, 300)}`);

  // Education
  if (edu.length) {
    lines.push('\nEducation:');
    edu.forEach(e => {
      lines.push(`  • ${e.degree || ''} — ${e.institution || ''} (${e.endYear || 'ongoing'})`);
      if (e.grade) lines.push(`    Grade: ${e.grade}`);
    });
  }

  // Experience
  if (exp.length) {
    lines.push('\nExperience:');
    exp.forEach(e => {
      const period = e.isCurrent
        ? `${e.startDate || ''} – Present`
        : `${e.startDate || ''} – ${e.endDate || ''}`;
      lines.push(`  • ${e.title || ''} at ${e.company || ''} (${period})`);
      if (e.description) lines.push(`    ${truncate(e.description, 150)}`);
    });
  }

  // Skills
  if (skills.length) {
    lines.push(`\nSkills: ${skills.join(', ')}`);
  }

  // Preferences
  if (prefs.totalExperience)  lines.push(`Total Experience: ${prefs.totalExperience}`);
  if (prefs.noticePeriod)     lines.push(`Notice Period: ${prefs.noticePeriod}`);
  if (prefs.expectedCTC)      lines.push(`Expected CTC: ${prefs.expectedCTC}`);
  if (p.linkedinUrl)          lines.push(`LinkedIn: ${p.linkedinUrl}`);
  if (p.portfolioUrl)         lines.push(`Portfolio/GitHub: ${p.portfolioUrl}`);

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/cover-letter
// ─────────────────────────────────────────────────────────────────────────────
router.post('/cover-letter', async (req, res, next) => {
  const { uid } = req.user;

  const validErr = requireFields(req.body, ['jobDescription', 'userProfile']);
  if (validErr) return res.status(400).json({ error: validErr });

  // Check AI credit quota in Firestore
  const allowed = await checkAndDeductCredit(uid, 'coverLetter');
  if (!allowed) {
    return res.status(429).json({
      error: 'Monthly cover letter limit reached.',
      upgradeUrl: 'https://Arlo.app/pricing',
    });
  }

  const { jobDescription, userProfile, tone = 'professional' } = req.body;

  const TONES = {
    professional: 'professional, confident and concise',
    enthusiastic: 'enthusiastic, energetic and passionate',
    formal:       'formal, polished and respectful',
    concise:      'very brief (under 120 words), punchy and direct',
  };
  const toneDesc = TONES[tone] || TONES.professional;

  const systemPrompt = `You are an expert career coach writing cover letters for Indian students, freshers, and early-career professionals applying to tech companies.

RULES:
- Keep the cover letter under 200 words (aim for 150-180 words)
- Write in ${toneDesc} tone
- Start with a strong opening hook, NOT "I am writing to apply for..."
- Highlight 2-3 specific matching skills from the candidate's profile that match the job
- Mention the candidate's college/university name if provided
- If candidate is a fresher, emphasize projects, internships, and learning agility
- End with a clear, confident call to action
- Sound personal and specific — never generic
- Do NOT include placeholders like [Company Name] — use the actual company if provided
- Output ONLY the cover letter text, no headings or meta-commentary`;

  const userMessage = `JOB DESCRIPTION:
${truncate(jobDescription, 3000)}

CANDIDATE PROFILE:
${buildProfileSummary(userProfile)}

Write a cover letter for this candidate applying to this role.`;

  logAIRequest(uid, 'cover-letter');

  try {
    const coverLetter = await callClaude(systemPrompt, userMessage, {
      maxTokens:   400,
      temperature: 0.72,
    });

    res.json({ coverLetter, tone, wordCount: coverLetter.split(/\s+/).length });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/answer-question
// ─────────────────────────────────────────────────────────────────────────────
router.post('/answer-question', async (req, res, next) => {
  const { uid } = req.user;

  const validErr = requireFields(req.body, ['question', 'userProfile']);
  if (validErr) return res.status(400).json({ error: validErr });

  const allowed = await checkAndDeductCredit(uid, 'qaAnswer');
  if (!allowed) {
    return res.status(429).json({ error: 'Monthly AI limit reached. Upgrade to Pro.' });
  }

  const { question, userProfile, jobContext = {} } = req.body;

  const systemPrompt = `You are helping an Indian student or early-career professional answer job application screening questions.

RULES:
- Answer in first person as the candidate
- Keep answers under 80 words unless the question clearly requires more detail
- For "Why do you want this role?" — mention a specific aspect of the company/role
- For "Describe yourself" — use exactly 3 words then a brief explanation
- For salary questions — give the expected CTC from the profile
- For notice period — state it directly
- Pull SPECIFIC details from the candidate profile (college, skills, projects, experience)
- Sound human, not like a template. No phrases like "I am a highly motivated individual"
- Output ONLY the answer text, nothing else`;

  const userMessage = `QUESTION: ${truncate(question, 300)}

CANDIDATE PROFILE:
${buildProfileSummary(userProfile)}

JOB CONTEXT:
Role: ${jobContext.jobTitle || 'Not specified'}
Company: ${jobContext.company || 'Not specified'}
Required Skills: ${(jobContext.requiredSkills || []).slice(0, 10).join(', ') || 'Not specified'}

Answer this question as the candidate.`;

  logAIRequest(uid, 'answer-question');

  try {
    const answer = await callClaude(systemPrompt, userMessage, {
      maxTokens:   200,
      temperature: 0.65,
    });

    res.json({ answer, question });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/match-score
// ─────────────────────────────────────────────────────────────────────────────
router.post('/match-score', async (req, res, next) => {
  const { uid } = req.user;

  const validErr = requireFields(req.body, ['jobDescription', 'userProfile']);
  if (validErr) return res.status(400).json({ error: validErr });

  const allowed = await checkAndDeductCredit(uid, 'matchScore');
  if (!allowed) {
    return res.status(429).json({ error: 'Monthly AI limit reached. Upgrade to Pro.' });
  }

  const { jobDescription, userProfile } = req.body;

  const systemPrompt = `You are a job-fit analyser for an Indian job application tool.
Analyse how well a candidate's profile matches a job description.

Respond in this EXACT JSON format (no markdown, no extra text):
{
  "score": <0-100 integer>,
  "matchedSkills": ["skill1", "skill2"],
  "missingSkills": ["skill1", "skill2"],
  "experienceMatch": true or false,
  "tip": "<one actionable sentence to improve the application>"
}

Scoring guide:
- 85-100: Excellent match — candidate exceeds most requirements
- 70-84:  Good match — candidate meets core requirements
- 50-69:  Partial match — some key skills missing
- Below 50: Weak match — significant gaps

Keep matchedSkills and missingSkills to max 6 items each.
The tip should be specific and actionable, not generic.`;

  const userMessage = `JOB DESCRIPTION:
${truncate(jobDescription, 3000)}

CANDIDATE PROFILE:
${buildProfileSummary(userProfile)}`;

  logAIRequest(uid, 'match-score');

  try {
    const raw = await callClaude(systemPrompt, userMessage, {
      maxTokens:   300,
      temperature: 0.3, // low temp for structured output consistency
    });

    // Parse and validate JSON response
    let parsed;
    try {
      // Claude sometimes wraps in ```json ... ``` — strip it
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
      parsed = JSON.parse(cleaned);
    } catch (_) {
      throw new Error('AI returned invalid JSON — please retry');
    }

    // Sanitise / clamp values
    const result = {
      score:           Math.min(100, Math.max(0, parseInt(parsed.score, 10) || 0)),
      matchedSkills:   (parsed.matchedSkills  || []).slice(0, 6).map(String),
      missingSkills:   (parsed.missingSkills  || []).slice(0, 6).map(String),
      experienceMatch: Boolean(parsed.experienceMatch),
      tip:             String(parsed.tip || '').slice(0, 200),
    };

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Credit tracking helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks if the user has remaining credits for a given AI feature.
 * Deducts one credit if allowed.
 *
 * Free plan limits (per month):
 *   coverLetter:  10
 *   qaAnswer:     20
 *   matchScore:   30
 *
 * Pro / Premium: unlimited (returns true without decrementing)
 *
 * @param {string} uid
 * @param {'coverLetter'|'qaAnswer'|'matchScore'} feature
 * @returns {Promise<boolean>} true if allowed, false if limit reached
 */
async function checkAndDeductCredit(uid, feature) {
  try {
    const db    = admin.firestore();
    const now   = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const userRef  = db.collection('users').doc(uid);
    const usageRef = userRef.collection('aiUsage').doc(month);

    const FREE_LIMITS = {
      coverLetter: 10,
      qaAnswer:    20,
      matchScore:  30,
    };

    return await db.runTransaction(async (tx) => {
      const userSnap  = await tx.get(userRef);
      const usageSnap = await tx.get(usageRef);

      const plan  = userSnap.data()?.plan || 'free';

      // Pro / Premium: unlimited
      if (plan === 'pro' || plan === 'premium') {
        tx.set(usageRef, { [feature]: admin.firestore.FieldValue.increment(1) }, { merge: true });
        return true;
      }

      // Free plan: check limit
      const currentUsage = usageSnap.data()?.[feature] || 0;
      const limit        = FREE_LIMITS[feature] || 10;

      if (currentUsage >= limit) return false;

      tx.set(usageRef, {
        [feature]: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return true;
    });
  } catch (err) {
    // If Firestore is unavailable, fail open in dev, fail closed in prod
    console.error('[Arlo] Credit check failed:', err.message);
    return process.env.NODE_ENV !== 'production';
  }
}

module.exports = router;

