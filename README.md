# Arlo — AI-Powered Job Application Assistant

**Arlo** is a premium Chrome Extension designed to automate and enhance the job application process. It autofills complex job portals, generates tailored cover letters via Claude AI, scores your resume against job descriptions, and tracks all applications seamlessly in a stunning Kanban dashboard.

---

## 🌟 Key Features

### 1. 1-Click Auto Fill
Automatically fill out tedious job application forms on supported platforms:
- LinkedIn Easy Apply
- Naukri.com
- Internshala
- Wellfound
- Unstop

### 2. AI-Powered Assistant (Claude AI)
- **Cover Letter Generation**: Automatically reads the job description and your profile to craft ATS-friendly cover letters. Supports multiple tones (Professional, Enthusiastic, Formal, Concise).
- **Match Scorer**: Compares your resume to the job description, giving you a match percentage, skill-gap analysis (Matched vs. Missing skills), and actionable tips.
- **Smart Q&A Answerer**: Detects screening questions (e.g., "Why do you want to work here?") and generates high-quality, personalized answers that you can 1-click inject into the page.

### 3. Application Tracker Dashboard
- Automatically logs every job you apply to.
- Interactive Kanban/table view to track statuses (Applied, Interviewing, Rejected, Offer).
- Analytics: Track applications per week, response rates, and top portals used.
- Export your application history to CSV.

### 4. Monetization & Subscriptions
- **Tiers**: Free, Pro (₹199/mo), Premium (₹499/mo).
- **Graceful Paywall**: Hard limits on auto-fills and AI cover letters for free users. 
- **Razorpay/Stripe Integration**: Secure checkout sessions directly from the dashboard.
- **Referral System**: Users get unique referral links. Every 3 successful referrals automatically upgrades the user to 1 Month of Pro for FREE.

---

## 🛠 Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (Manifest V3, Service Workers, Content Scripts)
- **UI Design**: Custom Glassmorphism Light Theme (No heavy UI frameworks)
- **Backend**: Node.js, Express.js
- **Database / Auth**: Firebase Auth (Google OAuth) & Firestore
- **AI Models**: Anthropic Claude API (`claude-3-sonnet-20240229` / `claude-3-5-sonnet-20240620`)
- **Payments**: Razorpay & Stripe
- **Security**: WebCrypto API (AES-GCM 256-bit), PBKDF2 Key Derivation, DOM Sanitization

---

## 📁 Project Structure

```text
arlo-extension/
├── manifest.json              # Extension manifest (MV3)
├── index.html                 # Public Landing Page
├── .env.example               # Backend environment variables template
│
├── src/                       # Frontend Chrome Extension
│   ├── background/            # Service workers (Alarms, Event listeners)
│   ├── content/               # DOM interaction (Form detector, Auto-filler, JD extractor)
│   ├── popup/                 # Glassmorphism Popup UI (HTML/CSS/JS)
│   ├── dashboard/             # App Tracker, Analytics, Profile Editor, Upgrade UI
│   ├── onboarding/            # 5-step interactive setup wizard & PDF resume parsing
│   ├── ai/                    # API wrappers for Cover Letters, Match Scores, QA
│   ├── auth/                  # Firebase Auth integration
│   ├── monetization/          # Paywall logic, limits, Razorpay hooks
│   ├── storage/               # Encrypted profile storage and Job Tracker IndexedDB/Firestore
│   ├── security/              # DOM sanitizer, AES-GCM encryption logic
│   └── utils/                 # Portal configurations and helpers
│
├── assets/                    # Extension icons and images
│
└── backend/                   # Node.js API Server
    ├── package.json
    ├── server.js              # Express app entry point
    └── routes/
        ├── ai.js              # Proxies requests to Claude API safely
        ├── payment.js         # Razorpay/Stripe checkout and Webhooks
        └── user.js            # Referral code generation and tracking
```

---

## 🚀 Installation & Setup

### 1. Backend Setup
The extension requires a backend server to securely proxy AI requests and handle payment webhooks.
```bash
cd backend
npm install
```
Create a `.env` file in the `backend/` directory (see `.env.example` in root for reference):
```env
# Firebase Admin SDK credentials
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=your_client_email
FIREBASE_PRIVATE_KEY="your_private_key"

# AI & Payments
ANTHROPIC_API_KEY=sk-ant-your_key
RAZORPAY_KEY_ID=rzp_live_your_key
RAZORPAY_KEY_SECRET=rzp_secret
```
Run the server:
```bash
npm run dev
```

### 2. Extension Setup
1. Open Chrome and navigate to `chrome://extensions`.
2. Toggle **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the root folder of this repository (`arlo-extension/`).
5. Open the Extension Options to begin the Onboarding flow.

---

## 🔒 Security Architecture
Arlo is built with a privacy-first mindset:
- **Local Encryption**: All Personally Identifiable Information (PII) is encrypted locally in the browser using `AES-GCM 256-bit` before being stored in `chrome.storage.local` or synced.
- **Key Derivation**: Encryption keys are derived using `PBKDF2` (100,000 iterations of SHA-256) combined with a secure salt.
- **No Direct API Keys**: Extension clients never hold Claude or Razorpay API keys. All sensitive requests are routed securely through the authenticated Node.js backend proxy.
- **XSS Prevention**: Strict DOM sanitization prevents malicious code execution when parsing job descriptions or applying AI-generated text.

---

## 📝 License
Copyright © 2024 Arlo. All rights reserved.
