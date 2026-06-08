/**
 * Arlo Onboarding Wizard
 * 5-step profile setup with encryption, PDF parsing, and LinkedIn import
 */

import { save, load, update } from '../storage/profile-store.js';
import { sanitizeProfile, isValidEmail, isValidPhone } from '../security/sanitizer.js';

// ── State ────────────────────────────────────────────────────
let currentStep = 1;
const TOTAL_STEPS = 5;

const profileData = {
  personal: {},
  education: [],
  experience: [],
  skills: { technical: [], soft: [], languages: [] },
  preferences: {},
  resumeText: '',
  resumeFileName: '',
  setupComplete: false,
  createdAt: null,
};

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  updateProgress();
  bindNavButtons();
  bindEducationForm();
  bindExperienceForm();
  bindSkillsForm();
  bindResumeUpload();
  bindSmartImport();

  // Load existing partial data
  try {
    const existing = await load();
    if (existing) {
      mergeExistingData(existing);
    }
  } catch (e) {
    console.warn('[Arlo] Could not load existing profile:', e.message);
  }
});

// ── Progress ─────────────────────────────────────────────────
function updateProgress() {
  const percent = Math.round(((currentStep - 1) / TOTAL_STEPS) * 100);
  document.getElementById('progressBarFill').style.width = percent + '%';
  document.getElementById('progressPercent').textContent = percent + '%';

  // Update step dots
  document.querySelectorAll('.step-dot').forEach(dot => {
    const step = parseInt(dot.dataset.step);
    dot.classList.remove('active', 'completed');
    if (step === currentStep) dot.classList.add('active');
    if (step < currentStep) dot.classList.add('completed');
  });

  // Animate progress line
  const lineWidth = ((currentStep - 1) / (TOTAL_STEPS - 1)) * 100;
  document.getElementById('progressLine').style.width = lineWidth + '%';
}

// ── Step Navigation ───────────────────────────────────────────
function goToStep(next, direction = 'forward') {
  const current = document.getElementById('step' + currentStep);
  const target = document.getElementById('step' + next);
  if (!target) return;

  const outClass = direction === 'forward' ? 'slide-out-left' : 'slide-out-right';
  const inClass = direction === 'forward' ? 'slide-in-right' : 'slide-in-left';

  current.classList.remove('active');
  current.classList.add(outClass);

  setTimeout(() => {
    current.classList.remove(outClass);
    target.classList.add('active');
    target.classList.add(inClass);
    setTimeout(() => target.classList.remove(inClass), 350);
  }, 300);

  currentStep = next;
  updateProgress();

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Nav Button Bindings ───────────────────────────────────────
function bindNavButtons() {
  // Step 1
  document.getElementById('btnNextStep1').addEventListener('click', () => {
    if (validateStep1()) {
      collectStep1();
      goToStep(2);
    }
  });
  document.getElementById('btnSkipStep1').addEventListener('click', () => {
    collectStep1();
    goToStep(2);
  });

  // Step 2
  document.getElementById('btnBackStep2').addEventListener('click', () => goToStep(1, 'back'));
  document.getElementById('btnNextStep2').addEventListener('click', () => {
    collectStep2();
    goToStep(3);
  });

  // Step 3
  document.getElementById('btnBackStep3').addEventListener('click', () => goToStep(2, 'back'));
  document.getElementById('btnNextStep3').addEventListener('click', () => {
    collectStep3();
    goToStep(4);
  });

  // Step 4
  document.getElementById('btnBackStep4').addEventListener('click', () => goToStep(3, 'back'));
  document.getElementById('btnNextStep4').addEventListener('click', () => {
    collectStep4();
    goToStep(5);
  });

  // Step 5
  document.getElementById('btnBackStep5').addEventListener('click', () => goToStep(4, 'back'));
  document.getElementById('btnFinish').addEventListener('click', finishSetup);

  // Completion
  document.getElementById('btnGoToExtension').addEventListener('click', () => window.close());
  document.getElementById('btnEditProfile').addEventListener('click', () => goToStep(1, 'back'));
}

// ── Step 1: Personal Info ─────────────────────────────────────
function validateStep1() {
  let valid = true;

  const firstName = document.getElementById('firstName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();

  if (!firstName) {
    showFieldError('firstName', 'errorFirstName', true);
    valid = false;
  } else {
    showFieldError('firstName', 'errorFirstName', false);
  }

  if (!lastName) {
    showFieldError('lastName', 'errorLastName', true);
    valid = false;
  } else {
    showFieldError('lastName', 'errorLastName', false);
  }

  if (!email || !isValidEmail(email)) {
    showFieldError('email', 'errorEmail', true);
    valid = false;
  } else {
    showFieldError('email', 'errorEmail', false);
  }

  if (!phone || !isValidPhone(phone)) {
    showFieldError('phone', 'errorPhone', true);
    valid = false;
  } else {
    showFieldError('phone', 'errorPhone', false);
  }

  return valid;
}

function collectStep1() {
  profileData.personal = sanitizeProfile({
    firstName: document.getElementById('firstName').value.trim(),
    lastName: document.getElementById('lastName').value.trim(),
    fullName: `${document.getElementById('firstName').value.trim()} ${document.getElementById('lastName').value.trim()}`,
    email: document.getElementById('email').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    location: document.getElementById('location').value.trim(),
    headline: document.getElementById('headline').value.trim(),
    linkedinUrl: document.getElementById('linkedinProfile').value.trim(),
    portfolioUrl: document.getElementById('portfolioUrl').value.trim(),
    summary: document.getElementById('summary').value.trim(),
  });
}

// ── Step 2: Education ─────────────────────────────────────────
function bindEducationForm() {
  document.getElementById('btnAddEducation').addEventListener('click', () => {
    toggleForm('educationForm', true);
    document.getElementById('btnAddEducation').style.display = 'none';
  });

  document.getElementById('btnCancelEducation').addEventListener('click', () => {
    toggleForm('educationForm', false);
    document.getElementById('btnAddEducation').style.display = '';
    clearEducationForm();
  });

  document.getElementById('btnSaveEducation').addEventListener('click', saveEducationItem);
}

function saveEducationItem() {
  const institution = document.getElementById('eduInstitution').value.trim();
  const degree = document.getElementById('eduDegree').value.trim();

  if (!institution || !degree) {
    showToast('Institution and degree are required', 'error');
    return;
  }

  const item = sanitizeProfile({
    id: crypto.randomUUID(),
    institution,
    degree,
    startYear: document.getElementById('eduStartYear').value.trim(),
    endYear: document.getElementById('eduEndYear').value.trim(),
    grade: document.getElementById('eduGrade').value.trim(),
    field: document.getElementById('eduField').value.trim(),
  });

  profileData.education.push(item);
  renderEducationList();
  clearEducationForm();
  toggleForm('educationForm', false);
  document.getElementById('btnAddEducation').style.display = '';
  showToast('Education added ✓', 'success');
}

function renderEducationList() {
  const list = document.getElementById('educationList');
  list.innerHTML = '';
  profileData.education.forEach(item => {
    const div = document.createElement('div');
    div.className = 'item-card';
    div.innerHTML = `
      <div class="item-header">
        <div>
          <div class="item-title">${escapeHtml(item.degree)}</div>
          <div class="item-subtitle">${escapeHtml(item.institution)} ${item.startYear ? '· ' + item.startYear : ''} ${item.endYear ? '– ' + item.endYear : ''}</div>
        </div>
        <button class="btn-remove-item" data-id="${item.id}">Remove</button>
      </div>
      ${item.grade ? `<div class="text-muted">Grade: ${escapeHtml(item.grade)}</div>` : ''}
    `;
    div.querySelector('.btn-remove-item').addEventListener('click', () => {
      profileData.education = profileData.education.filter(e => e.id !== item.id);
      renderEducationList();
    });
    list.appendChild(div);
  });
}

function clearEducationForm() {
  ['eduInstitution', 'eduDegree', 'eduStartYear', 'eduEndYear', 'eduGrade', 'eduField']
    .forEach(id => { document.getElementById(id).value = ''; });
}

function collectStep2() {
  // Already collected on save
}

// ── Step 3: Experience ────────────────────────────────────────
function bindExperienceForm() {
  document.getElementById('btnAddExperience').addEventListener('click', () => {
    toggleForm('experienceForm', true);
    document.getElementById('btnAddExperience').style.display = 'none';
  });

  document.getElementById('btnCancelExperience').addEventListener('click', () => {
    toggleForm('experienceForm', false);
    document.getElementById('btnAddExperience').style.display = '';
    clearExperienceForm();
  });

  document.getElementById('btnSaveExperience').addEventListener('click', saveExperienceItem);

  document.getElementById('expCurrentRole').addEventListener('change', (e) => {
    const endDate = document.getElementById('expEndDate');
    endDate.disabled = e.target.checked;
    if (e.target.checked) endDate.value = '';
  });
}

function saveExperienceItem() {
  const company = document.getElementById('expCompany').value.trim();
  const title = document.getElementById('expTitle').value.trim();

  if (!company || !title) {
    showToast('Company and job title are required', 'error');
    return;
  }

  const isCurrent = document.getElementById('expCurrentRole').checked;

  const item = sanitizeProfile({
    id: crypto.randomUUID(),
    company,
    title,
    type: document.getElementById('expType').value,
    location: document.getElementById('expLocation').value.trim(),
    startDate: document.getElementById('expStartDate').value,
    endDate: isCurrent ? 'Present' : document.getElementById('expEndDate').value,
    isCurrent,
    description: document.getElementById('expDescription').value.trim(),
  });

  profileData.experience.push(item);
  renderExperienceList();
  clearExperienceForm();
  toggleForm('experienceForm', false);
  document.getElementById('btnAddExperience').style.display = '';
  showToast('Experience added ✓', 'success');
}

function renderExperienceList() {
  const list = document.getElementById('experienceList');
  list.innerHTML = '';
  profileData.experience.forEach(item => {
    const div = document.createElement('div');
    div.className = 'item-card';
    const dateRange = item.startDate
      ? formatDate(item.startDate) + ' – ' + (item.isCurrent ? 'Present' : formatDate(item.endDate))
      : '';
    div.innerHTML = `
      <div class="item-header">
        <div>
          <div class="item-title">${escapeHtml(item.title)} ${item.type ? '<span style="color:var(--text-muted);font-weight:400">· ' + escapeHtml(item.type) + '</span>' : ''}</div>
          <div class="item-subtitle">${escapeHtml(item.company)}${dateRange ? ' · ' + dateRange : ''}</div>
        </div>
        <button class="btn-remove-item" data-id="${item.id}">Remove</button>
      </div>
      ${item.description ? `<div class="text-muted" style="margin-top:4px;font-size:12px;">${escapeHtml(item.description.slice(0, 120))}${item.description.length > 120 ? '…' : ''}</div>` : ''}
    `;
    div.querySelector('.btn-remove-item').addEventListener('click', () => {
      profileData.experience = profileData.experience.filter(e => e.id !== item.id);
      renderExperienceList();
    });
    list.appendChild(div);
  });
}

function clearExperienceForm() {
  ['expCompany', 'expTitle', 'expLocation', 'expStartDate', 'expEndDate', 'expDescription']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('expType').value = '';
  document.getElementById('expCurrentRole').checked = false;
  document.getElementById('expEndDate').disabled = false;
}

function collectStep3() {
  // Already collected on save
}

// ── Step 4: Skills ────────────────────────────────────────────
function bindSkillsForm() {
  const skillInput = document.getElementById('skillInput');
  const skillLevel = document.getElementById('skillLevel');

  document.getElementById('btnAddSkill').addEventListener('click', () => {
    addSkill(skillInput.value.trim(), skillLevel.value);
    skillInput.value = '';
    skillInput.focus();
  });

  skillInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addSkill(skillInput.value.trim(), skillLevel.value);
      skillInput.value = '';
    }
  });

  // Seed popular skills for quick add
  const suggestions = ['JavaScript', 'Python', 'React', 'Node.js', 'SQL', 'Git', 'Communication', 'Teamwork'];
  suggestions.forEach(s => {
    const el = document.createElement('button');
    el.className = 'btn-add-item';
    el.style.cssText = 'padding:4px 10px;font-size:11px;width:auto;border-radius:99px;margin-bottom:4px;';
    el.textContent = '+ ' + s;
    el.addEventListener('click', () => {
      addSkill(s, 'Intermediate');
      el.remove();
    });
  });
}

function addSkill(name, level = 'Intermediate') {
  if (!name || name.length < 2) return;

  // Determine category
  const softKeywords = ['communication', 'leadership', 'teamwork', 'problem solving', 'analytical', 'management', 'creative', 'adaptable'];
  const langKeywords = ['english', 'hindi', 'spanish', 'french', 'german', 'chinese', 'japanese', 'arabic', 'tamil', 'telugu', 'kannada'];

  const lower = name.toLowerCase();
  let category = 'technical';
  if (softKeywords.some(k => lower.includes(k))) category = 'soft';
  if (langKeywords.some(k => lower.includes(k))) category = 'languages';

  // Avoid duplicates
  const existing = [
    ...profileData.skills.technical,
    ...profileData.skills.soft,
    ...profileData.skills.languages,
  ];
  if (existing.some(s => s.name.toLowerCase() === lower)) {
    showToast('Skill already added', 'error');
    return;
  }

  const skill = { name, level, category };
  profileData.skills[category].push(skill);

  const containerId = category === 'technical' ? 'technicalSkillsTags'
    : category === 'soft' ? 'softSkillsTags' : 'languagesTags';

  renderSkillTag(skill, containerId);
}

function renderSkillTag(skill, containerId) {
  const container = document.getElementById(containerId);
  const tag = document.createElement('div');
  tag.className = 'skill-tag';
  tag.dataset.skillName = skill.name;
  tag.innerHTML = `
    ${escapeHtml(skill.name)}
    <span style="font-size:10px;opacity:0.6;margin-left:2px;">${skill.level.charAt(0)}</span>
    <button class="remove-tag" aria-label="Remove ${escapeHtml(skill.name)}">×</button>
  `;
  tag.querySelector('.remove-tag').addEventListener('click', () => {
    const cat = skill.category;
    profileData.skills[cat] = profileData.skills[cat].filter(s => s.name !== skill.name);
    tag.remove();
  });
  container.appendChild(tag);
}

function collectStep4() {
  profileData.preferences = sanitizeProfile({
    totalExperience: document.getElementById('totalExp').value,
    noticePeriod: document.getElementById('noticePeriod').value,
    currentCTC: document.getElementById('currentCTC').value.trim(),
    expectedCTC: document.getElementById('expectedCTC').value.trim(),
  });
}

// ── Step 5: Resume Upload ─────────────────────────────────────
function bindResumeUpload() {
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('resumeFile');

  // Drag and drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleResumeFile(file);
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleResumeFile(file);
  });

  document.getElementById('btnRemoveResume').addEventListener('click', removeResume);
}

async function handleResumeFile(file) {
  if (file.type !== 'application/pdf') {
    showToast('Please upload a PDF file', 'error');
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    showToast('File must be under 5MB', 'error');
    return;
  }

  // Show file info
  document.getElementById('uploadZone').style.display = 'none';
  const fileInfo = document.getElementById('resumeFileInfo');
  fileInfo.classList.add('visible');
  document.getElementById('resumeFileName').textContent = file.name;
  document.getElementById('resumeFileSize').textContent = formatFileSize(file.size);

  const status = document.getElementById('resumeParseStatus');
  status.className = 'resume-parse-status parsing';
  status.textContent = '⏳ Parsing resume…';

  profileData.resumeFileName = file.name;

  try {
    const text = await parsePDF(file);
    profileData.resumeText = text;

    status.className = 'resume-parse-status done';
    status.textContent = '✓ Resume parsed successfully';

    // Show text preview
    const preview = document.getElementById('parsePreview');
    preview.classList.add('visible');
    document.getElementById('parsedTextPreview').textContent = text.slice(0, 500) + (text.length > 500 ? '…' : '');

    showToast('Resume parsed successfully ✓', 'success');
  } catch (err) {
    console.error('[Arlo] PDF parse error:', err);
    status.className = 'resume-parse-status error';
    status.textContent = '⚠ Could not parse PDF text';
    showToast('Could not extract text from PDF', 'error');
  }
}

async function parsePDF(file) {
  // Use pdf.js to extract text
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  if (!pdfjsLib) throw new Error('pdf.js not loaded');

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }

  return fullText.trim();
}

function removeResume() {
  profileData.resumeText = '';
  profileData.resumeFileName = '';
  document.getElementById('resumeFileInfo').classList.remove('visible');
  document.getElementById('parsePreview').classList.remove('visible');
  document.getElementById('uploadZone').style.display = '';
  document.getElementById('resumeFile').value = '';
}

// ── Finish & Save ─────────────────────────────────────────────
async function finishSetup() {
  const btn = document.getElementById('btnFinish');
  const spinner = document.getElementById('finishSpinner');
  const btnText = document.getElementById('finishBtnText');

  btn.disabled = true;
  spinner.classList.add('visible');
  btnText.textContent = 'Saving…';

  try {
    collectStep4();
    profileData.setupComplete = true;
    profileData.createdAt = new Date().toISOString();

    await save(profileData);

    // Show completion step
    currentStep = 6;
    updateProgress();

    // Update completion stats
    const fieldCount = countFilledFields(profileData);
    const skillCount =
      profileData.skills.technical.length +
      profileData.skills.soft.length +
      profileData.skills.languages.length;

    document.getElementById('completionFieldCount').textContent = fieldCount;
    document.getElementById('completionSkillCount').textContent = skillCount;

    goToStep(6);
    showToast('Profile saved securely 🔒', 'success');
  } catch (err) {
    console.error('[Arlo] Save failed:', err);
    showToast('Failed to save profile. Please try again.', 'error');
    btn.disabled = false;
    spinner.classList.remove('visible');
    btnText.textContent = 'Complete Setup';
  }
}

// ── Smart Import ──────────────────────────────────────────────
function bindSmartImport() {
  document.getElementById('btnSmartImport').addEventListener('click', async () => {
    const url = document.getElementById('linkedinUrl').value.trim();

    if (!url || !url.includes('linkedin.com/in/')) {
      showToast('Please enter a valid LinkedIn profile URL', 'error');
      return;
    }

    const btn = document.getElementById('btnSmartImport');
    const spinner = document.getElementById('importSpinner');
    const text = document.getElementById('importBtnText');

    btn.disabled = true;
    spinner.classList.add('visible');
    text.style.display = 'none';

    try {
      // In Phase 1, we extract the name from the URL slug as a best-effort
      // Full scraping requires backend proxy (Phase 2)
      const slug = url.replace(/\/$/, '').split('/').pop();
      const nameParts = slug.replace(/-\d+$/, '').split('-');
      const firstName = nameParts[0] ? capitalize(nameParts[0]) : '';
      const lastName = nameParts.slice(1).map(capitalize).join(' ');

      if (firstName) {
        document.getElementById('firstName').value = firstName;
        document.getElementById('lastName').value = lastName;
        document.getElementById('linkedinProfile').value = url;
      }

      showToast('Basic info imported from URL. Full import available in Pro.', 'success');
    } catch (err) {
      showToast('Could not import data. Please fill manually.', 'error');
    } finally {
      btn.disabled = false;
      spinner.classList.remove('visible');
      text.style.display = '';
    }
  });
}

// ── Merge Existing Data ───────────────────────────────────────
function mergeExistingData(data) {
  if (data.personal) {
    const p = data.personal;
    setValue('firstName', p.firstName);
    setValue('lastName', p.lastName);
    setValue('email', p.email);
    setValue('phone', p.phone);
    setValue('location', p.location);
    setValue('headline', p.headline);
    setValue('linkedinProfile', p.linkedinUrl);
    setValue('portfolioUrl', p.portfolioUrl);
    setValue('summary', p.summary);
  }

  if (data.education?.length) {
    profileData.education = data.education;
    renderEducationList();
  }

  if (data.experience?.length) {
    profileData.experience = data.experience;
    renderExperienceList();
  }

  if (data.skills) {
    Object.assign(profileData.skills, data.skills);
    ['technical', 'soft', 'languages'].forEach(cat => {
      (profileData.skills[cat] || []).forEach(skill => {
        const containerId = cat === 'technical' ? 'technicalSkillsTags'
          : cat === 'soft' ? 'softSkillsTags' : 'languagesTags';
        renderSkillTag(skill, containerId);
      });
    });
  }

  if (data.preferences) {
    setValue('totalExp', data.preferences.totalExperience);
    setValue('noticePeriod', data.preferences.noticePeriod);
    setValue('currentCTC', data.preferences.currentCTC);
    setValue('expectedCTC', data.preferences.expectedCTC);
  }
}

// ── Utility Functions ─────────────────────────────────────────
function showFieldError(inputId, errorId, show) {
  const input = document.getElementById(inputId);
  const error = document.getElementById(errorId);
  if (show) {
    input?.classList.add('error');
    error?.classList.add('visible');
  } else {
    input?.classList.remove('error');
    error?.classList.remove('visible');
  }
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = type === 'success' ? '✓ ' + message : '⚠ ' + message;
  toast.className = 'toast visible ' + type;
  setTimeout(() => toast.classList.remove('visible'), 3500);
}

function toggleForm(formId, open) {
  const form = document.getElementById(formId);
  form.classList.toggle('open', open);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === 'Present') return dateStr;
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el && value !== undefined && value !== null) el.value = value;
}

function countFilledFields(data) {
  let count = 0;
  const p = data.personal;
  if (p) {
    ['firstName', 'lastName', 'email', 'phone', 'location', 'headline', 'summary', 'linkedinUrl', 'portfolioUrl']
      .forEach(f => { if (p[f]) count++; });
  }
  count += data.education.length * 2;
  count += data.experience.length * 3;
  return count;
}

