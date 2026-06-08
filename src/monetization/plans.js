/**
 * Plan definitions for Arlo
 */

export const PLANS = {
  FREE: {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceYearly: 0,
    fillsPerMonth: 10,
    features: ['10 auto-fills per month', '5 AI cover letters per month', '3 portals (LinkedIn, Naukri, Internshala)', 'Basic dashboard (last 10 apps)'],
    limits: { aiCoverLetters: 5, aiAnswers: 0, jobTracking: 10, portals: ['linkedin', 'naukri', 'internshala'] },
  },
  PRO: {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 199, // INR
    priceYearly: 1499, // INR
    fillsPerMonth: Infinity,
    features: ['Unlimited auto-fills', '50 AI cover letters/month', 'All portals (+ Wellfound, Unstop)', 'Full dashboard + export CSV', 'AI match scorer', 'Priority support'],
    limits: { aiCoverLetters: 50, aiAnswers: 0, jobTracking: Infinity, portals: ['all'] },
  },
  PREMIUM: {
    id: 'premium',
    name: 'Premium',
    priceMonthly: 499, // INR
    priceYearly: 3999, // INR
    fillsPerMonth: Infinity,
    features: ['Everything in Pro', 'Unlimited AI features', 'AI screening Q&A answerer', 'Resume tips from AI', 'Application analytics', 'Email alerts for callbacks', 'Early access to new portals'],
    limits: { aiCoverLetters: Infinity, aiAnswers: Infinity, jobTracking: Infinity, portals: ['all'] },
  },
};

export function getPlan(planId) {
  return Object.values(PLANS).find(p => p.id === planId?.toLowerCase()) || PLANS.FREE;
}

