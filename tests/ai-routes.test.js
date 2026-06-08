/**
 * AI Routes — integration tests
 * Run with: npm test (from root)
 *
 * These tests mock Firebase auth and the Claude client so no real
 * API calls are made. All assertions are against route logic only.
 */

'use strict';

// ── Mocks must be set up before requiring the app ─────────────────────────

// Mock Firebase Admin
jest.mock('../backend/lib/firebase-admin', () => ({
  auth: () => ({
    verifyIdToken: jest.fn(async (token) => {
      if (token === 'valid-token') return { uid: 'test-uid-123', email: 'test@example.com' };
      throw new Error('Invalid token');
    }),
  }),
  firestore: () => ({
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({}),
        }),
        get: jest.fn(async () => ({ data: () => ({ plan: 'free' }) })),
      }),
    }),
    runTransaction: jest.fn(async (fn) => {
      const tx = {
        get: jest.fn(async () => ({ data: () => ({}) })),
        set: jest.fn(),
      };
      return fn(tx);
    }),
    FieldValue: { increment: (n) => n, serverTimestamp: () => new Date() },
  }),
  apps: ['initialized'],
}));

// Mock Claude client
jest.mock('../backend/lib/ai-client', () => ({
  callClaude: jest.fn(async (system, user) => {
    // Return deterministic fake responses based on the system prompt content
    if (system.includes('cover letter')) {
      return 'Dear Hiring Manager,\n\nI am excited to apply for this role. My experience in React and Node.js aligns perfectly with your requirements. I graduated from IIT Bombay with a B.Tech in Computer Science.\n\nBest regards,\nJohn Doe';
    }
    if (system.includes('match')) {
      return JSON.stringify({
        score: 78,
        matchedSkills: ['React', 'Node.js'],
        missingSkills: ['Docker'],
        experienceMatch: true,
        tip: 'Add Docker to your skill set to improve your match score.',
      });
    }
    return 'I am passionate about technology and eager to contribute to your team.';
  }),
  MODEL: 'claude-sonnet-4-20250514',
}));

const request = require('supertest');
const app     = require('../backend/server');

const AUTH_HEADER = { Authorization: 'Bearer valid-token' };
const SAMPLE_PROFILE = {
  personal: { firstName: 'John', lastName: 'Doe', headline: 'Full Stack Developer' },
  education: [{ institution: 'IIT Bombay', degree: 'B.Tech CS', endYear: '2024' }],
  experience: [],
  skills: { technical: ['React', 'Node.js'], soft: ['Communication'] },
  preferences: { totalExperience: '0-1', expectedCTC: '8 LPA' },
};
const SAMPLE_JD = 'We are looking for a React developer with 1-2 years of experience. Skills: React, Node.js, Docker.';

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/ai/cover-letter', () => {

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/ai/cover-letter')
      .send({ jobDescription: SAMPLE_JD, userProfile: SAMPLE_PROFILE });
    expect(res.status).toBe(401);
  });

  test('returns 400 when jobDescription is missing', async () => {
    const res = await request(app)
      .post('/api/ai/cover-letter')
      .set(AUTH_HEADER)
      .send({ userProfile: SAMPLE_PROFILE });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing fields/i);
  });

  test('returns 400 when userProfile is missing', async () => {
    const res = await request(app)
      .post('/api/ai/cover-letter')
      .set(AUTH_HEADER)
      .send({ jobDescription: SAMPLE_JD });
    expect(res.status).toBe(400);
  });

  test('returns cover letter with valid request', async () => {
    const res = await request(app)
      .post('/api/ai/cover-letter')
      .set(AUTH_HEADER)
      .send({ jobDescription: SAMPLE_JD, userProfile: SAMPLE_PROFILE, tone: 'professional' });

    expect(res.status).toBe(200);
    expect(res.body.coverLetter).toBeTruthy();
    expect(typeof res.body.coverLetter).toBe('string');
    expect(res.body.wordCount).toBeGreaterThan(0);
  });

  test('includes tone in response', async () => {
    const res = await request(app)
      .post('/api/ai/cover-letter')
      .set(AUTH_HEADER)
      .send({ jobDescription: SAMPLE_JD, userProfile: SAMPLE_PROFILE, tone: 'concise' });
    expect(res.body.tone).toBe('concise');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/ai/answer-question', () => {

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/ai/answer-question')
      .send({ question: 'Why do you want this role?', userProfile: SAMPLE_PROFILE });
    expect(res.status).toBe(401);
  });

  test('returns 400 when question is missing', async () => {
    const res = await request(app)
      .post('/api/ai/answer-question')
      .set(AUTH_HEADER)
      .send({ userProfile: SAMPLE_PROFILE });
    expect(res.status).toBe(400);
  });

  test('returns an answer for a screening question', async () => {
    const res = await request(app)
      .post('/api/ai/answer-question')
      .set(AUTH_HEADER)
      .send({
        question:    'Why do you want this role?',
        userProfile: SAMPLE_PROFILE,
        jobContext:  { jobTitle: 'Frontend Engineer', company: 'Acme Corp' },
      });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBeTruthy();
    expect(res.body.question).toBe('Why do you want this role?');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/ai/match-score', () => {

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/ai/match-score')
      .send({ jobDescription: SAMPLE_JD, userProfile: SAMPLE_PROFILE });
    expect(res.status).toBe(401);
  });

  test('returns structured score with valid request', async () => {
    const res = await request(app)
      .post('/api/ai/match-score')
      .set(AUTH_HEADER)
      .send({ jobDescription: SAMPLE_JD, userProfile: SAMPLE_PROFILE });

    expect(res.status).toBe(200);
    expect(res.body.score).toBeGreaterThanOrEqual(0);
    expect(res.body.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(res.body.matchedSkills)).toBe(true);
    expect(Array.isArray(res.body.missingSkills)).toBe(true);
    expect(typeof res.body.tip).toBe('string');
  });

  test('score is clamped to 0-100', async () => {
    const res = await request(app)
      .post('/api/ai/match-score')
      .set(AUTH_HEADER)
      .send({ jobDescription: SAMPLE_JD, userProfile: SAMPLE_PROFILE });

    expect(res.body.score).toBeGreaterThanOrEqual(0);
    expect(res.body.score).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Health endpoint', () => {
  test('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

