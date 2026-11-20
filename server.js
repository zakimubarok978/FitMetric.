'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');

const ROOT = __dirname;
const DATABASE = process.env.FITMETRIC_DB || path.join(ROOT, 'fitmetric.sqlite3');
const RAILWAY = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME);
const HOST = process.env.FITMETRIC_HOST || (RAILWAY ? '0.0.0.0' : '127.0.0.1');
const PORT = Number.parseInt(process.env.PORT || process.env.FITMETRIC_PORT || '8000', 10);
const SESSION_DAYS = 30;
const PASSWORD_ITERATIONS = 310000;
const MAX_REQUEST_SIZE = 1000000;
const MAX_ADMIN_REQUEST_SIZE = 4500000;
const MAX_IMAGE_SIZE = 3000000;
const EMAIL_PATTERN = /^[^@\s]{1,128}@[^@\s]{1,190}\.[^@\s]{2,}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('member', 'trainer')),
    photo TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', height REAL,
    specialty TEXT NOT NULL DEFAULT '', experience TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trainer_members (
    id TEXT PRIMARY KEY, trainer_id TEXT NOT NULL REFERENCES users(id),
    member_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL, ended_at TEXT, UNIQUE (trainer_id, member_id)
);
CREATE INDEX IF NOT EXISTS trainer_members_member_idx ON trainer_members(member_id, status);
CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY, trainer_id TEXT NOT NULL REFERENCES users(id), member_id TEXT REFERENCES users(id),
    email TEXT, code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
    created_at TEXT NOT NULL, responded_at TEXT
);
CREATE INDEX IF NOT EXISTS invitations_email_status_idx ON invitations(email, status);
CREATE INDEX IF NOT EXISTS invitations_member_status_idx ON invitations(member_id, status);
CREATE TABLE IF NOT EXISTS trainer_notes (
    id TEXT PRIMARY KEY, trainer_id TEXT NOT NULL REFERENCES users(id), member_id TEXT NOT NULL REFERENCES users(id),
    relationship_id TEXT NOT NULL REFERENCES trainer_members(id), title TEXT NOT NULL, evaluation TEXT NOT NULL,
    recommendation TEXT NOT NULL DEFAULT '', target TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, read_at TEXT
);
CREATE INDEX IF NOT EXISTS trainer_notes_member_idx ON trainer_notes(member_id, created_at);
CREATE TABLE IF NOT EXISTS body_measurements (
    id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES users(id), date TEXT NOT NULL, weight REAL NOT NULL,
    height REAL, waist REAL, chest REAL, arm REAL, thigh REAL, body_fat REAL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS body_measurements_member_date_idx ON body_measurements(member_id, date);
CREATE TABLE IF NOT EXISTS workout_progress (
    id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES users(id), created_by_id TEXT NOT NULL REFERENCES users(id),
    created_by_role TEXT NOT NULL CHECK (created_by_role IN ('member', 'trainer')), name TEXT NOT NULL,
    exercise_type TEXT NOT NULL DEFAULT '', sets INTEGER NOT NULL DEFAULT 0, reps INTEGER NOT NULL DEFAULT 0,
    weight REAL NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0, date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workout_progress_member_date_idx ON workout_progress(member_id, date);
CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES users(id), trainer_id TEXT NOT NULL REFERENCES users(id),
    relationship_id TEXT NOT NULL REFERENCES trainer_members(id), day TEXT NOT NULL, date TEXT NOT NULL,
    time TEXT NOT NULL, program TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('upcoming', 'done', 'missed')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS schedules_member_date_idx ON schedules(member_id, date);
CREATE TABLE IF NOT EXISTS fitness_goals (
    id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES users(id), created_by_id TEXT NOT NULL REFERENCES users(id),
    created_by_role TEXT NOT NULL CHECK (created_by_role IN ('member', 'trainer')), name TEXT NOT NULL,
    type TEXT NOT NULL, target TEXT NOT NULL, deadline TEXT NOT NULL DEFAULT '',
    progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fitness_goals_member_idx ON fitness_goals(member_id, created_at);
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, message TEXT NOT NULL, related_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, read_at TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at);
CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS website_content (
    id INTEGER PRIMARY KEY CHECK (id = 1), content_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS content_drafts (
    id INTEGER PRIMARY KEY CHECK (id = 1), content_json TEXT NOT NULL, updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL REFERENCES admin_users(id)
);
CREATE TABLE IF NOT EXISTS website_images (
    id TEXT PRIMARY KEY, filename TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
    size INTEGER NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES admin_users(id)
);
CREATE TABLE IF NOT EXISTS admin_activity_logs (
    id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admin_users(id), action TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_activity_created_idx ON admin_activity_logs(created_at);
`;

const DEFAULT_SITE_CONTENT = {
  text: {
    heroTitle: 'BANGUN KEKUATAN. PANTAU PROGRES. JADI LEBIH BAIK.',
    heroDescription: 'Teman kebugaran pribadi untuk mencatat latihan, memantau progres, dan mencapai tujuan fitness Anda.',
    heroButton: 'Mulai Sekarang', heroSecondaryButton: 'Jelajahi Fitur',
    navHome: 'Beranda', navFeatures: 'Fitur', navPrograms: 'Program', navTrainers: 'Pelatih',
    navAbout: 'Tentang', navLogin: 'Masuk', navRegister: 'Mulai Sekarang',
    featuresEyebrow: 'Fitur', featuresTitle: 'Semua yang Anda butuhkan untuk konsisten',
    featuresDescription: 'Dari mencatat latihan harian hingga merencanakan progres, FitMetric menjaga rutinitas fitness Anda tetap terukur.',
    programsEyebrow: 'Program', programsTitle: 'Program latihan yang dirancang untuk hasil',
    trainersEyebrow: 'Pelatih', trainersTitle: 'Kenali pelatih ahli kami',
    aboutEyebrow: 'Tentang', aboutTitle: 'Dirancang untuk pertumbuhan fitness berkelanjutan',
    aboutDescription: 'FitMetric menggabungkan pencatatan harian, program latihan terstruktur, dan akuntabilitas terukur untuk membantu Anda berkembang.',
    aboutBullet1: 'Pelacakan cerdas untuk konsistensi latihan',
    aboutBullet2: 'Analitik progres berbasis target', aboutBullet3: 'Program personal dengan dukungan ahli',
    statMembers: '12.4K', statProgress: '+27%', statRating: '4.9/5',
    footerTagline: 'Pantau Progres, Transformasikan Tubuh Anda.', footerHome: 'Beranda',
    footerFeatures: 'Fitur', footerPrograms: 'Program', footerTrainers: 'Pelatih', footerLogin: 'Masuk',
    siteTitle: 'FitMetric | Track Your Progress, Transform Your Body',
    siteDescription: 'FitMetric membantu Anda mencatat latihan, memantau progres, dan mencapai tujuan fitness.'
  },
  theme: {},
  visibility: { home: true, features: true, programs: true, trainers: true, about: true },
  order: ['home', 'features', 'programs', 'trainers', 'about'],
  images: {},
  imageVisibility: { hero: true, heroBackground: true, about: true },
  programs: [
    { id: 'strength-builder', name: 'Strength Builder', category: 'Strength', description: 'Program progres 8 minggu dengan latihan compound dan evaluasi performa.', duration: '8 minggu', image: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=900&q=80', active: true },
    { id: 'fat-burn', name: 'Fat Burn', category: 'Cardio', description: 'Program seimbang dengan interval kardio dan siklus pemulihan berkelanjutan.', duration: '6 minggu', image: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&w=900&q=80', active: true },
    { id: 'athletic-performance', name: 'Athletic Performance', category: 'Performance', description: 'Rutinitas berfokus pada kelincahan, kekuatan, dan kondisi fisik yang terukur.', duration: '10 minggu', image: 'https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?auto=format&fit=crop&w=900&q=80', active: true }
  ],
  trainers: [
    { id: 'sarah-williams', name: 'Sarah Williams', specialty: 'Strength Coach', description: 'Membantu anggota meningkatkan kekuatan, komposisi tubuh, dan kepercayaan diri.', experience: '8 tahun', image: 'https://images.unsplash.com/photo-1541534401786-2077eed87a74?auto=format&fit=crop&w=800&q=80', active: true },
    { id: 'daniel-brooks', name: 'Daniel Brooks', specialty: 'Conditioning Coach', description: 'Membangun daya tahan fungsional dan membantu klien mencapai target performa.', experience: '6 tahun', image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80', active: true },
    { id: 'emma-davis', name: 'Emma Davis', specialty: 'Rehab Specialist', description: 'Membuat program aman dan berkelanjutan untuk mobilitas dan pola gerak yang lebih baik.', experience: '7 tahun', image: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80', active: true }
  ],
  features: [
    { id: 'workout-tracker', name: 'Workout Tracker', category: 'activity', description: 'Catat set, repetisi, beban, dan durasi latihan hanya dalam beberapa ketukan.', duration: '', image: '', active: true },
    { id: 'progress-analytics', name: 'Progress Analytics', category: 'bar-chart-3', description: 'Analisis tren berat badan, volume, frekuensi, dan durasi latihan.', duration: '', image: '', active: true },
    { id: 'personal-trainer', name: 'Personal Trainer', category: 'users', description: 'Ikuti program khusus dan tetap selaras dengan pelatih Anda.', duration: '', image: '', active: true },
    { id: 'workout-schedule', name: 'Workout Schedule', category: 'calendar-days', description: 'Rencanakan sesi mingguan dan jangan lewatkan jadwal penting.', duration: '', image: '', active: true },
    { id: 'body-measurements', name: 'Body Measurement Tracker', category: 'ruler', description: 'Pantau progres dengan pengukuran tubuh dan target yang terukur.', duration: '', image: '', active: true },
    { id: 'fitness-goals', name: 'Fitness Goals', category: 'target', description: 'Tetapkan target terukur dan tetap termotivasi melihat progres.', duration: '', image: '', active: true }
  ]
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function now() { return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'); }
function newId() { return crypto.randomUUID(); }
function tokenHash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function openDatabase(databasePath = DATABASE) {
  fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const db = new Database(databasePath, { timeout: 15000 });
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 15000');
  return db;
}

function initializeDatabase(db) {
  db.exec(SCHEMA);
  db.prepare('INSERT OR IGNORE INTO website_content (id, content_json, updated_at) VALUES (1, ?, ?)')
    .run(JSON.stringify(DEFAULT_SITE_CONTENT), now());
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  return `${PASSWORD_ITERATIONS}$${salt.toString('hex')}$${crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, 'sha256').toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const [iterationsText, saltText, expectedText] = parts;
    const iterations = Number.parseInt(iterationsText, 10);
    if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 2000000 ||
        !/^(?:[0-9a-f]{32,128})$/i.test(saltText) || !/^[0-9a-f]{64}$/i.test(expectedText)) return false;
    const expected = Buffer.from(expectedText, 'hex');
    const actual = crypto.pbkdf2Sync(password, Buffer.from(saltText, 'hex'), iterations, expected.length, 'sha256');
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function textValue(data, name, { required = false, limit = 2000 } = {}) {
  const value = data[name] === undefined ? '' : data[name];
  if (typeof value !== 'string') throw new ApiError(400, `${name} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ApiError(400, `${name} is required.`);
  if (trimmed.length > limit) throw new ApiError(400, `${name} is too long.`);
  return trimmed;
}

function parseNumber(value, name, { minimum, maximum, optional = false, integer = false } = {}) {
  if ((value === null || value === undefined || value === '') && optional) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ApiError(400, `${name} must be a finite number.`);
  if (minimum !== undefined && number < minimum) throw new ApiError(400, `${name} is below the allowed minimum.`);
  if (maximum !== undefined && number > maximum) throw new ApiError(400, `${name} is above the allowed maximum.`);
  return integer ? Math.trunc(number) : number;
}

function publicUser(row) {
  return Object.fromEntries(['id', 'name', 'email', 'role', 'photo', 'phone', 'height', 'specialty', 'experience']
    .map((key) => [key, row[key]]));
}

function emailIsRegistered(db, email) {
  return Boolean(db.prepare('SELECT 1 FROM users WHERE email = ? UNION ALL SELECT 1 FROM admin_users WHERE email = ? LIMIT 1')
    .get(email, email));
}

function relationshipFor(db, trainerId, memberId) {
  return db.prepare("SELECT * FROM trainer_members WHERE trainer_id = ? AND member_id = ? AND status = 'active'")
    .get(trainerId, memberId);
}

function requireRelationship(db, trainerId, relationshipId) {
  const relation = db.prepare("SELECT * FROM trainer_members WHERE id = ? AND trainer_id = ? AND status = 'active'")
    .get(relationshipId, trainerId);
  if (!relation) throw new ApiError(404, 'Active member relationship not found.');
  return relation;
}

function addNotification(db, userId, type, message, relatedId = '') {
  db.prepare('INSERT INTO notifications (id, user_id, type, message, related_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId(), userId, type, message, relatedId, now());
}

function notifyMemberTrainers(db, memberId, type, message, relatedId = '') {
  for (const trainer of db.prepare("SELECT trainer_id FROM trainer_members WHERE member_id = ? AND status = 'active'").all(memberId)) {
    addNotification(db, trainer.trainer_id, type, message, relatedId);
  }
}

function cookieValue(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return ''; }
  }
  return '';
}

function secureCookie(req) {
  return req.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase() === 'https' ? '; Secure' : '';
}

function sessionUser(db, req) {
  const token = cookieValue(req, 'fitmetric_session');
  if (!token) return null;
  return db.prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?')
    .get(tokenHash(token), now()) || null;
}

function adminSession(db, req) {
  const token = cookieValue(req, 'fitmetric_admin_session');
  if (!token) return null;
  return db.prepare('SELECT admin_users.* FROM admin_sessions JOIN admin_users ON admin_users.id = admin_sessions.admin_id WHERE admin_sessions.token_hash = ? AND admin_sessions.expires_at > ?')
    .get(tokenHash(token), now()) || null;
}

function currentUser(db, req) {
  const user = sessionUser(db, req);
  if (!user) throw new ApiError(401, 'Your session has expired. Please sign in again.');
  return user;
}

function requireAdmin(db, req) {
  const admin = adminSession(db, req);
  if (!admin) throw new ApiError(401, 'Admin sign-in is required.');
  return admin;
}

function logAdminActivity(db, admin, action, details = '') {
  db.prepare('INSERT INTO admin_activity_logs (id, admin_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(newId(), admin.id, action, details.slice(0, 500), now());
}

function completeSiteContent(stored) {
  const complete = structuredClone(DEFAULT_SITE_CONTENT);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return complete;
  for (const section of ['text', 'theme', 'visibility', 'images', 'imageVisibility']) {
    if (stored[section] && typeof stored[section] === 'object' && !Array.isArray(stored[section])) {
      Object.assign(complete[section], stored[section]);
    }
  }
  for (const section of ['order', 'programs', 'trainers', 'features']) {
    if (Array.isArray(stored[section])) complete[section] = stored[section];
  }
  return complete;
}

function publishedSite(db) {
  const row = db.prepare('SELECT content_json FROM website_content WHERE id = 1').get();
  return completeSiteContent(row ? JSON.parse(row.content_json) : {});
}

function draftSite(db) {
  const row = db.prepare('SELECT content_json FROM content_drafts WHERE id = 1').get();
  return completeSiteContent(row ? JSON.parse(row.content_json) : publishedSite(db));
}

function validImageReference(value) {
  if (!value) return true;
  if (value.startsWith('/uploads/')) return /^\/uploads\/[A-Za-z0-9-]{36}\.(?:jpg|png|webp)$/.test(value);
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.host) && !/["'()\\ ]/.test(value);
  } catch {
    return false;
  }
}

function validateSiteContent(value) {
  const keys = ['text', 'theme', 'visibility', 'order', 'images', 'programs', 'trainers', 'features'];
  const expected = new Set([...keys, 'imageVisibility']);
  const legacy = new Set(keys);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !(Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key)) ||
        Object.keys(value).length === legacy.size && Object.keys(value).every((key) => legacy.has(key)))) {
    throw new ApiError(400, 'Website content has an invalid structure.');
  }
  if (!value.imageVisibility) value.imageVisibility = {};
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_ADMIN_REQUEST_SIZE) throw new ApiError(413, 'Website content is too large.');
  if (!value.text || typeof value.text !== 'object' || Array.isArray(value.text) ||
      !value.theme || typeof value.theme !== 'object' || Array.isArray(value.theme)) {
    throw new ApiError(400, 'Website text and theme must be objects.');
  }
  for (const [key, text] of Object.entries(value.text)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(key) || typeof text !== 'string' || text.length > 1000) {
      throw new ApiError(400, 'Website text must use valid keys and text with at most 1,000 characters.');
    }
  }
  const allowedTheme = new Set(['background', 'card', 'text', 'muted', 'primary', 'secondary', 'border', 'accent', 'navBackground', 'font', 'fontWeight', 'headingSize', 'bodySize', 'cardRadius', 'cardShadow', 'featureImageHeight', 'programImageHeight', 'trainerImageHeight', 'sectionSpacing']);
  const colorKeys = new Set(['background', 'card', 'text', 'muted', 'primary', 'secondary', 'border', 'accent', 'navBackground']);
  const numberLimits = { headingSize: [24, 72], bodySize: [12, 24], cardRadius: [0, 40], featureImageHeight: [80, 360], programImageHeight: [80, 360], trainerImageHeight: [120, 480], sectionSpacing: [24, 160] };
  for (const [key, setting] of Object.entries(value.theme)) {
    if (!allowedTheme.has(key)) throw new ApiError(400, 'Theme contains an unsupported setting.');
    if (colorKeys.has(key) && (typeof setting !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(setting))) throw new ApiError(400, `Invalid color for ${key}.`);
    if (key === 'font' && !['Poppins', 'Inter', 'Arial', 'system-ui'].includes(setting)) throw new ApiError(400, 'Choose a supported font.');
    if (key === 'fontWeight' && ![400, 500, 600, 700, 800].includes(setting)) throw new ApiError(400, 'Choose a supported font weight.');
    if (key === 'cardShadow' && !['none', 'soft', 'strong'].includes(setting)) throw new ApiError(400, 'Choose a supported card shadow.');
    if (numberLimits[key]) parseNumber(setting, key, { minimum: numberLimits[key][0], maximum: numberLimits[key][1], integer: true });
  }
  const sections = ['home', 'features', 'programs', 'trainers', 'about'];
  if (!value.visibility || typeof value.visibility !== 'object' || Array.isArray(value.visibility) ||
      sections.some((key) => typeof value.visibility[key] !== 'boolean') || Object.keys(value.visibility).length !== sections.length) {
    throw new ApiError(400, 'Section visibility settings are invalid.');
  }
  if (!Array.isArray(value.order) || value.order.length !== sections.length || new Set(value.order).size !== sections.length ||
      sections.some((section) => !value.order.includes(section))) throw new ApiError(400, 'Section order is invalid.');
  if (!value.images || typeof value.images !== 'object' || Array.isArray(value.images) ||
      Object.entries(value.images).some(([key, image]) => !['hero', 'heroBackground', 'about'].includes(key) || typeof image !== 'string' || image.length > 500 || !validImageReference(image))) {
    throw new ApiError(400, 'Website images must use valid stored image paths.');
  }
  if (!value.imageVisibility || typeof value.imageVisibility !== 'object' || Array.isArray(value.imageVisibility) ||
      Object.entries(value.imageVisibility).some(([key, visible]) => !['hero', 'heroBackground', 'about'].includes(key) || typeof visible !== 'boolean')) {
    throw new ApiError(400, 'Website image visibility settings are invalid.');
  }
  for (const collection of ['programs', 'trainers', 'features']) {
    if (!Array.isArray(value[collection]) || value[collection].length > 100) throw new ApiError(400, `${collection[0].toUpperCase()}${collection.slice(1)} must be a list of at most 100 records.`);
    for (const record of value[collection]) {
      if (!record || typeof record !== 'object' || !/^[A-Za-z0-9_-]{1,80}$/.test(String(record.id || ''))) throw new ApiError(400, `${collection[0].toUpperCase()}${collection.slice(1)} contains an invalid record.`);
      const required = collection === 'trainers' ? ['name', 'specialty', 'description', 'experience', 'image'] : ['name', 'category', 'description', 'duration', 'image'];
      if (required.some((key) => typeof record[key] !== 'string' || record[key].length > 1000)) throw new ApiError(400, `${collection[0].toUpperCase()}${collection.slice(1)} contains invalid text.`);
      if (!validImageReference(record.image)) throw new ApiError(400, `${collection[0].toUpperCase()}${collection.slice(1)} contains an invalid image path.`);
      if (record.imageVisible !== undefined && typeof record.imageVisible !== 'boolean') throw new ApiError(400, `${collection[0].toUpperCase()}${collection.slice(1)} image visibility must be boolean.`);
      if (typeof record.active !== 'boolean') throw new ApiError(400, `${collection[0].toUpperCase()}${collection.slice(1)} active status must be boolean.`);
    }
  }
  return value;
}

function acceptInvitation(db, invitation, member) {
  if (member.role !== 'member') throw new ApiError(403, 'Only a member account can accept a trainer invitation.');
  if (invitation.member_id && invitation.member_id !== member.id) throw new ApiError(403, 'This invitation belongs to another member.');
  if (invitation.email && invitation.email.toLowerCase() !== member.email.toLowerCase()) {
    throw new ApiError(403, 'Sign in with the invited member email to accept this invitation.');
  }
  const relation = db.prepare('SELECT * FROM trainer_members WHERE trainer_id = ? AND member_id = ?').get(invitation.trainer_id, member.id);
  const timestamp = now();
  let relationshipId;
  if (relation) {
    if (relation.status === 'active') throw new ApiError(409, 'This account is already connected to the trainer.');
    relationshipId = relation.id;
    db.prepare("UPDATE trainer_members SET status = 'active', created_at = ?, ended_at = NULL WHERE id = ?").run(timestamp, relation.id);
  } else {
    relationshipId = newId();
    db.prepare("INSERT INTO trainer_members (id, trainer_id, member_id, status, created_at) VALUES (?, ?, ?, 'active', ?)")
      .run(relationshipId, invitation.trainer_id, member.id, timestamp);
  }
  db.prepare("UPDATE invitations SET status = 'accepted', member_id = ?, responded_at = ? WHERE id = ?")
    .run(member.id, timestamp, invitation.id);
  addNotification(db, invitation.trainer_id, 'invitation_accepted', `${member.name} accepted your invitation.`, invitation.id);
  addNotification(db, member.id, 'invitation_accepted', 'Your trainer invitation was accepted.', relationshipId);
  return relationshipId;
}

function relationData(relationByMember, memberId) {
  const relation = relationByMember.get(memberId);
  return [relation ? relation.trainer_id : '', relation ? relation.id : ''];
}

function serializeWorkout(row, relationByMember) {
  const [trainerId, clientId] = relationData(relationByMember, row.member_id);
  return { id: row.id, userId: row.member_id, trainerId, clientId, createdBy: row.created_by_role, name: row.name,
    exerciseType: row.exercise_type, sets: row.sets, reps: row.reps, weight: row.weight, duration: row.duration,
    notes: row.notes, completed: Boolean(row.completed), date: row.date };
}
function serializeSchedule(row) {
  return { id: row.id, userId: row.member_id, trainerId: row.trainer_id, clientId: row.relationship_id,
    createdBy: 'trainer', day: row.day, date: row.date, time: row.time, program: row.program, status: row.status };
}
function serializeMeasurement(row, relationByMember) {
  const [trainerId, clientId] = relationData(relationByMember, row.member_id);
  return { id: row.id, userId: row.member_id, trainerId, clientId, createdBy: 'member', date: row.date,
    weight: row.weight, height: row.height, waist: row.waist, chest: row.chest, arm: row.arm,
    thigh: row.thigh, fat: row.body_fat };
}
function serializeGoal(row, relationByMember) {
  const [trainerId, clientId] = relationData(relationByMember, row.member_id);
  return { id: row.id, userId: row.member_id, trainerId, clientId, createdBy: row.created_by_role, name: row.name,
    type: row.type, target: row.target, deadline: row.deadline, progress: row.progress, completed: Boolean(row.completed) };
}
function serializeNote(row) {
  return { id: row.id, trainerId: row.trainer_id, userId: row.member_id, clientId: row.relationship_id,
    trainerName: row.trainer_name, title: row.title, text: row.evaluation, evaluation: row.evaluation,
    recommendation: row.recommendation, target: row.target, date: row.created_at, readAt: row.read_at,
    status: row.read_at ? 'read' : 'new' };
}

function scopedRows(db, table, user, linkedMemberIds) {
  const dateTables = ['workout_progress', 'schedules', 'body_measurements'];
  const order = dateTables.includes(table) ? 'date DESC, created_at DESC' : 'created_at DESC';
  if (user.role === 'member') {
    if (table === 'trainer_notes') {
      return db.prepare('SELECT trainer_notes.*, users.name AS trainer_name FROM trainer_notes JOIN users ON users.id = trainer_notes.trainer_id WHERE trainer_notes.member_id = ? ORDER BY trainer_notes.created_at DESC').all(user.id);
    }
    return db.prepare(`SELECT * FROM ${table} WHERE member_id = ? ORDER BY ${order}`).all(user.id);
  }
  const ids = [...linkedMemberIds].sort();
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  if (table === 'trainer_notes') {
    return db.prepare(`SELECT trainer_notes.*, users.name AS trainer_name FROM trainer_notes JOIN users ON users.id = trainer_notes.trainer_id WHERE trainer_notes.member_id IN (${placeholders}) ORDER BY trainer_notes.created_at DESC`).all(...ids);
  }
  return db.prepare(`SELECT * FROM ${table} WHERE member_id IN (${placeholders}) ORDER BY ${order}`).all(...ids);
}

function getState(db, user) {
  const users = new Map([[user.id, publicUser(user)]]);
  const relations = db.prepare(
    'SELECT trainer_members.*, trainers.name AS trainer_name, trainers.email AS trainer_email, ' +
    'members.name AS member_name, members.email AS member_email, members.photo AS member_photo, ' +
    'members.phone AS member_phone, members.height AS member_height, trainers.photo AS trainer_photo, ' +
    'trainers.phone AS trainer_phone, trainers.specialty AS trainer_specialty, trainers.experience AS trainer_experience ' +
    'FROM trainer_members JOIN users AS trainers ON trainers.id = trainer_members.trainer_id ' +
    'JOIN users AS members ON members.id = trainer_members.member_id ' +
    "WHERE trainer_members.status = 'active' AND (trainer_id = ? OR member_id = ?) ORDER BY created_at DESC"
  ).all(user.id, user.id);
  const relationByMember = new Map();
  const clients = [];
  const linkedMemberIds = new Set();
  let trainer = null;
  for (const relation of relations) {
    relationByMember.set(relation.member_id, relation);
    linkedMemberIds.add(relation.member_id);
    if (relation.trainer_id === user.id) {
      users.set(relation.member_id, publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(relation.member_id)));
      clients.push({ id: relation.id, trainerId: relation.trainer_id, userId: relation.member_id,
        name: relation.member_name, email: relation.member_email, photo: relation.member_photo,
        phone: relation.member_phone, height: relation.member_height, joinedAt: relation.created_at.slice(0, 10), status: 'active' });
    } else {
      users.set(relation.trainer_id, publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(relation.trainer_id)));
      trainer = { id: relation.trainer_id, name: relation.trainer_name, email: relation.trainer_email,
        photo: relation.trainer_photo, phone: relation.trainer_phone, specialty: relation.trainer_specialty,
        experience: relation.trainer_experience, relationshipId: relation.id };
    }
  }
  let invitations;
  if (user.role === 'trainer') {
    invitations = db.prepare('SELECT invitations.*, users.name AS member_name FROM invitations LEFT JOIN users ON users.id = invitations.member_id WHERE trainer_id = ? ORDER BY created_at DESC')
      .all(user.id).filter((row) => row.status !== 'accepted').map((row) => ({
        id: row.id, trainerId: row.trainer_id, email: row.email || '',
        name: row.member_name || row.email || 'Member', code: row.code, status: row.status, createdAt: row.created_at
      }));
  } else {
    invitations = db.prepare(
      'SELECT invitations.*, users.name AS trainer_name, users.photo AS trainer_photo, users.email AS trainer_email ' +
      'FROM invitations JOIN users ON users.id = invitations.trainer_id ' +
      "WHERE invitations.status = 'pending' AND (invitations.member_id = ? OR lower(invitations.email) = lower(?)) ORDER BY invitations.created_at DESC"
    ).all(user.id, user.email).map((row) => ({
      id: row.id, trainerId: row.trainer_id, trainerName: row.trainer_name, trainerEmail: row.trainer_email,
      trainerPhoto: row.trainer_photo, email: row.email || '', code: '', status: row.status, createdAt: row.created_at
    }));
    if (trainer) clients.push({ id: trainer.relationshipId, trainerId: trainer.id, userId: user.id,
      name: trainer.name, email: trainer.email, photo: trainer.photo, status: 'active' });
  }
  const workouts = scopedRows(db, 'workout_progress', user, linkedMemberIds).map((row) => serializeWorkout(row, relationByMember));
  const schedules = scopedRows(db, 'schedules', user, linkedMemberIds).map(serializeSchedule);
  const measurements = scopedRows(db, 'body_measurements', user, linkedMemberIds).map((row) => serializeMeasurement(row, relationByMember));
  const goals = scopedRows(db, 'fitness_goals', user, linkedMemberIds).map((row) => serializeGoal(row, relationByMember));
  const notes = scopedRows(db, 'trainer_notes', user, linkedMemberIds).map(serializeNote);
  const notifications = db.prepare('SELECT id, type, message, related_id AS relatedId, created_at AS createdAt, read_at AS readAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(user.id);
  return { user: publicUser(user), users: [...users.values()], clients, invitations,
    trainer: user.role === 'member' ? trainer : null, workouts, schedules, measurements, goals, notes, notifications };
}

function apiResult(status, body, headers = {}) { return { status, body, headers }; }
function cookieToken() { return crypto.randomBytes(32).toString('base64url'); }
function createSession(db, userId, req) {
  const token = cookieToken();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), userId, new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(), now());
  return `fitmetric_session=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secureCookie(req)}`;
}

function register(db, req) {
  if (sessionUser(db, req)) throw new ApiError(409, 'You are already signed in. Log out before creating another account.');
  const name = textValue(req.body, 'name', { required: true, limit: 100 });
  const email = textValue(req.body, 'email', { required: true, limit: 320 }).toLowerCase();
  const { password, confirmPassword, role } = req.body;
  if (!EMAIL_PATTERN.test(email)) throw new ApiError(400, 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw new ApiError(400, 'Password must be between 8 and 256 characters.');
  if (typeof confirmPassword !== 'string' || password !== confirmPassword) throw new ApiError(400, 'Passwords do not match.');
  if (!['member', 'trainer'].includes(role)) throw new ApiError(400, 'Choose a valid account role.');
  if (emailIsRegistered(db, email)) throw new ApiError(409, 'An account with this email already exists.');
  const userId = newId();
  db.prepare('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, name, email, hashPassword(password), role, now());
  if (role === 'member') {
    const pending = db.prepare("SELECT id FROM invitations WHERE email = ? AND status = 'pending'").all(email);
    for (const invitation of pending) {
      db.prepare('UPDATE invitations SET member_id = ? WHERE id = ?').run(userId, invitation.id);
      addNotification(db, userId, 'invitation', 'You have a new trainer invitation.', invitation.id);
    }
  }
  return apiResult(201, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) });
}

function login(db, req) {
  const email = textValue(req.body, 'email', { required: true, limit: 320 }).toLowerCase();
  const password = req.body.password;
  if (typeof password !== 'string' || password.length > 256) throw new ApiError(401, 'Invalid email or password.');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) throw new ApiError(401, 'No account is registered with this email.');
  if (!verifyPassword(password, user.password_hash)) throw new ApiError(401, 'Incorrect password.');
  return apiResult(200, { user: publicUser(user) }, { 'Set-Cookie': createSession(db, user.id, req) });
}

function adminLogin(db, req) {
  const email = textValue(req.body, 'email', { required: true, limit: 320 }).toLowerCase();
  const password = req.body.password;
  if (!EMAIL_PATTERN.test(email) || typeof password !== 'string' || password.length > 256) throw new ApiError(401, 'Invalid admin email or password.');
  const admin = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
  if (!admin || !verifyPassword(password, admin.password_hash)) throw new ApiError(401, 'Invalid admin email or password.');
  const token = cookieToken();
  db.prepare('INSERT INTO admin_sessions (token_hash, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), admin.id, new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(), now());
  logAdminActivity(db, admin, 'admin_login');
  const cookie = `fitmetric_admin_session=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Strict${secureCookie(req)}`;
  return apiResult(200, { admin: { name: admin.name, email: admin.email } }, { 'Set-Cookie': cookie });
}

function adminLogout(db, req) {
  const token = cookieValue(req, 'fitmetric_admin_session');
  if (token) {
    const admin = db.prepare('SELECT admin_users.* FROM admin_sessions JOIN admin_users ON admin_users.id = admin_sessions.admin_id WHERE admin_sessions.token_hash = ?')
      .get(tokenHash(token));
    if (admin) logAdminActivity(db, admin, 'admin_logout');
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash(token));
  }
  return apiResult(200, { ok: true }, { 'Set-Cookie': `fitmetric_admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secureCookie(req)}` });
}

function logout(db, req) {
  const token = cookieValue(req, 'fitmetric_session');
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  return apiResult(200, { ok: true }, { 'Set-Cookie': `fitmetric_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureCookie(req)}` });
}

function updateProfile(db, user, body) {
  const name = textValue(body, 'name', { required: true, limit: 100 });
  const email = textValue(body, 'email', { required: true, limit: 320 }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new ApiError(400, 'Enter a valid email address.');
  const values = [name, email, textValue(body, 'photo', { limit: 500 }), textValue(body, 'phone', { limit: 40 }),
    parseNumber(body.height, 'Height', { minimum: 1, maximum: 300, optional: true }),
    textValue(body, 'specialty', { limit: 120 }), textValue(body, 'experience', { limit: 120 }), user.id];
  try {
    db.prepare('UPDATE users SET name = ?, email = ?, photo = ?, phone = ?, height = ?, specialty = ?, experience = ? WHERE id = ?').run(...values);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new ApiError(409, 'An account with this email already exists.');
    throw error;
  }
  if (body.password) {
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 256) throw new ApiError(400, 'Password must be between 8 and 256 characters.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.password), user.id);
  }
  return apiResult(200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
}

function createInvitation(db, user, body) {
  if (user.role !== 'trainer') throw new ApiError(403, 'Only trainers can invite members.');
  const email = textValue(body, 'email', { limit: 320 }).toLowerCase();
  if (email && !EMAIL_PATTERN.test(email)) throw new ApiError(400, 'Enter a valid email address.');
  let member = null;
  if (email) {
    member = db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
    if (member && member.role !== 'member') throw new ApiError(400, 'Invitations can only be sent to member accounts.');
    if (member && relationshipFor(db, user.id, member.id)) throw new ApiError(409, 'This member is already connected to your account.');
    if (db.prepare("SELECT id FROM invitations WHERE trainer_id = ? AND email = ? AND status = 'pending'").get(user.id, email)) {
      throw new ApiError(409, 'A pending invitation already exists for this email.');
    }
  }
  const invitationId = newId();
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  const timestamp = now();
  db.prepare("INSERT INTO invitations (id, trainer_id, member_id, email, code, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)")
    .run(invitationId, user.id, member ? member.id : null, email || null, code, timestamp);
  if (member) addNotification(db, member.id, 'invitation', `${user.name} invited you to connect on FitMetric.`, invitationId);
  return apiResult(201, { invitation: { id: invitationId, trainerId: user.id, trainerName: user.name,
    email, code, status: 'pending', createdAt: timestamp } });
}

function redeemInvitation(db, user, body) {
  if (user.role !== 'member') throw new ApiError(403, 'Only member accounts can redeem trainer invitation codes.');
  const code = textValue(body, 'code', { required: true, limit: 20 }).toUpperCase();
  const invitation = db.prepare("SELECT * FROM invitations WHERE code = ? AND status = 'pending'").get(code);
  if (!invitation) throw new ApiError(404, 'Invitation code is invalid or has already been used.');
  if (invitation.email && invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new ApiError(403, 'This invitation code was issued for a different email address.');
  }
  return apiResult(200, { ok: true, relationshipId: acceptInvitation(db, invitation, user) });
}

function respondInvitation(db, user, invitationId, body) {
  if (user.role !== 'member') throw new ApiError(403, 'Only member accounts can respond to trainer invitations.');
  const invitation = db.prepare('SELECT * FROM invitations WHERE id = ?').get(invitationId);
  if (!invitation || (invitation.member_id !== user.id &&
      (!invitation.email || invitation.email.toLowerCase() !== user.email.toLowerCase()))) {
    throw new ApiError(404, 'Invitation not found.');
  }
  if (invitation.status !== 'pending') throw new ApiError(409, 'This invitation has already been answered.');
  if (body.accept === true) return apiResult(200, { ok: true, relationshipId: acceptInvitation(db, invitation, user) });
  if (body.accept !== false) throw new ApiError(400, 'Choose whether to accept or reject the invitation.');
  db.prepare("UPDATE invitations SET status = 'rejected', member_id = ?, responded_at = ? WHERE id = ?")
    .run(user.id, now(), invitationId);
  addNotification(db, invitation.trainer_id, 'invitation_rejected', `${user.name} declined your invitation.`, invitationId);
  return apiResult(200, { ok: true });
}

function disconnect(db, user, relationshipId) {
  const relation = db.prepare("SELECT * FROM trainer_members WHERE id = ? AND status = 'active'").get(relationshipId);
  if (!relation || ![relation.trainer_id, relation.member_id].includes(user.id)) throw new ApiError(404, 'Active relationship not found.');
  db.prepare("UPDATE trainer_members SET status = 'inactive', ended_at = ? WHERE id = ?").run(now(), relationshipId);
  const otherId = user.id === relation.trainer_id ? relation.member_id : relation.trainer_id;
  addNotification(db, otherId, 'relationship_ended', 'A trainer-member connection was ended.', relationshipId);
  return apiResult(200, { ok: true });
}

function createNote(db, user, body) {
  if (user.role !== 'trainer') throw new ApiError(403, 'Only trainers can create trainer notes.');
  const relationshipId = textValue(body, 'clientId', { required: true, limit: 80 });
  const relation = requireRelationship(db, user.id, relationshipId);
  const noteId = newId();
  const timestamp = now();
  db.prepare('INSERT INTO trainer_notes (id, trainer_id, member_id, relationship_id, title, evaluation, recommendation, target, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(noteId, user.id, relation.member_id, relationshipId,
      textValue(body, 'title', { required: true, limit: 160 }),
      textValue(body, 'evaluation', { required: true }),
      textValue(body, 'recommendation', { limit: 4000 }), textValue(body, 'target', { limit: 1000 }), timestamp);
  addNotification(db, relation.member_id, 'trainer_note', `${user.name} added a new training note.`, noteId);
  return apiResult(201, { id: noteId });
}

function changeNote(db, user, noteId, body, method) {
  const note = db.prepare('SELECT * FROM trainer_notes WHERE id = ?').get(noteId);
  if (!note) throw new ApiError(404, 'Trainer note not found.');
  if (user.role !== 'trainer' || note.trainer_id !== user.id) {
    throw new ApiError(403, method === 'DELETE' ? 'Only the authoring trainer can delete this note.' : 'Only the authoring trainer can edit this note.');
  }
  if (!relationshipFor(db, note.trainer_id, note.member_id)) throw new ApiError(403, 'This trainer-member relationship is no longer active.');
  if (method === 'DELETE') {
    db.prepare('DELETE FROM trainer_notes WHERE id = ?').run(noteId);
    return apiResult(200, { ok: true });
  }
  db.prepare('UPDATE trainer_notes SET title = ?, evaluation = ?, recommendation = ?, target = ? WHERE id = ?')
    .run(textValue(body, 'title', { required: true, limit: 160 }),
      textValue(body, 'evaluation', { required: true }), textValue(body, 'recommendation', { limit: 4000 }),
      textValue(body, 'target', { limit: 1000 }), noteId);
  addNotification(db, note.member_id, 'trainer_note', 'Your trainer updated a training note.', noteId);
  return apiResult(200, { ok: true });
}

function readNote(db, user, noteId) {
  if (user.role !== 'member') throw new ApiError(403, 'Only the intended member can mark a note as read.');
  const result = db.prepare('UPDATE trainer_notes SET read_at = COALESCE(read_at, ?) WHERE id = ? AND member_id = ?')
    .run(now(), noteId, user.id);
  if (!result.changes) throw new ApiError(404, 'Trainer note not found.');
  return apiResult(200, { ok: true });
}

function readNotification(db, user, notificationId) {
  const result = db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?')
    .run(now(), notificationId, user.id);
  if (!result.changes) throw new ApiError(404, 'Notification not found.');
  return apiResult(200, { ok: true });
}

function recordOwner(db, table, recordId, user) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(recordId);
  if (!row) throw new ApiError(404, 'Record not found.');
  if (user.role === 'member') {
    if (row.member_id !== user.id || row.created_by_role === 'trainer') throw new ApiError(403, 'You cannot change this record.');
  } else if (!relationshipFor(db, user.id, row.member_id) ||
      (table === 'fitness_goals' && row.created_by_id !== user.id) ||
      (table === 'workout_progress' && row.created_by_role !== 'trainer')) {
    throw new ApiError(403, "You cannot change this member's record.");
  }
  return row;
}

function saveWorkout(db, user, recordId, body, method) {
  if (method === 'DELETE') {
    recordOwner(db, 'workout_progress', recordId, user);
    db.prepare('DELETE FROM workout_progress WHERE id = ?').run(recordId);
    return apiResult(200, { ok: true });
  }
  const row = recordId ? recordOwner(db, 'workout_progress', recordId, user) : null;
  const memberId = user.role === 'trainer'
    ? requireRelationship(db, user.id, textValue(body, 'clientId', { required: true, limit: 80 })).member_id
    : user.id;
  const values = {
    name: textValue(body, 'name', { required: true, limit: 160 }),
    exerciseType: textValue(body, 'exerciseType', { limit: 100 }),
    sets: parseNumber(body.sets === undefined ? 0 : body.sets, 'Sets', { minimum: 0, maximum: 1000, integer: true }),
    reps: parseNumber(body.reps === undefined ? 0 : body.reps, 'Reps', { minimum: 0, maximum: 10000, integer: true }),
    weight: parseNumber(body.weight === undefined ? 0 : body.weight, 'Weight', { minimum: 0, maximum: 10000 }),
    duration: parseNumber(body.duration === undefined ? 0 : body.duration, 'Duration', { minimum: 0, maximum: 10000 }),
    notes: textValue(body, 'notes', { limit: 2000 }),
    completed: body.completed ? 1 : 0,
    date: textValue(body, 'date', { limit: 40 }) || now()
  };
  if (row) {
    if (user.role === 'trainer' && row.member_id !== memberId) throw new ApiError(403, 'Workout belongs to a different member.');
    db.prepare('UPDATE workout_progress SET name=?, exercise_type=?, sets=?, reps=?, weight=?, duration=?, notes=?, completed=?, date=?, updated_at=? WHERE id=?')
      .run(values.name, values.exerciseType, values.sets, values.reps, values.weight, values.duration, values.notes, values.completed, values.date, now(), recordId);
    return apiResult(200, { id: recordId });
  }
  const id = newId();
  db.prepare('INSERT INTO workout_progress (id, member_id, created_by_id, created_by_role, name, exercise_type, sets, reps, weight, duration, notes, completed, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, memberId, user.id, user.role, values.name, values.exerciseType, values.sets, values.reps, values.weight,
      values.duration, values.notes, values.completed, values.date, now(), now());
  if (user.role === 'member') notifyMemberTrainers(db, memberId, 'workout_progress', 'A member logged a workout.', id);
  return apiResult(201, { id });
}

function saveMeasurement(db, user, recordId, body, method) {
  if (method === 'DELETE') {
    const row = db.prepare('SELECT id FROM body_measurements WHERE id = ? AND member_id = ?').get(recordId, user.id);
    if (!row) throw new ApiError(404, 'Measurement not found.');
    db.prepare('DELETE FROM body_measurements WHERE id = ?').run(recordId);
    notifyMemberTrainers(db, user.id, 'body_measurement', 'A member removed a body measurement.', recordId);
    return apiResult(200, { ok: true });
  }
  if (recordId && !db.prepare('SELECT id FROM body_measurements WHERE id = ? AND member_id = ?').get(recordId, user.id)) {
    throw new ApiError(404, 'Measurement not found.');
  }
  const values = [
    textValue(body, 'date', { required: true, limit: 40 }),
    parseNumber(body.weight, 'Weight', { minimum: 0.1, maximum: 1000 }),
    parseNumber(body.height, 'Height', { minimum: 1, maximum: 300, optional: true }),
    parseNumber(body.waist, 'Waist', { minimum: 0, maximum: 500, optional: true }),
    parseNumber(body.chest, 'Chest', { minimum: 0, maximum: 500, optional: true }),
    parseNumber(body.arm, 'Arm', { minimum: 0, maximum: 300, optional: true }),
    parseNumber(body.thigh, 'Thigh', { minimum: 0, maximum: 300, optional: true }),
    parseNumber(body.fat === undefined ? body.bodyFat : body.fat, 'Body fat', { minimum: 0, maximum: 100, optional: true })
  ];
  let id = recordId;
  if (recordId) {
    db.prepare('UPDATE body_measurements SET date=?, weight=?, height=?, waist=?, chest=?, arm=?, thigh=?, body_fat=?, updated_at=? WHERE id=?')
      .run(...values, now(), recordId);
  } else {
    id = newId();
    db.prepare('INSERT INTO body_measurements (id, member_id, date, weight, height, waist, chest, arm, thigh, body_fat, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, user.id, ...values, now(), now());
  }
  notifyMemberTrainers(db, user.id, 'body_measurement', 'A member updated body measurements.', id);
  return apiResult(recordId ? 200 : 201, { id });
}

function saveGoal(db, user, recordId, body, method) {
  if (method === 'DELETE') {
    const goal = db.prepare('SELECT * FROM fitness_goals WHERE id = ?').get(recordId);
    if (!goal) throw new ApiError(404, 'Goal not found.');
    if (user.role === 'member') {
      if (goal.member_id !== user.id || goal.created_by_role === 'trainer') throw new ApiError(403, 'You cannot delete this goal.');
    } else if (goal.member_id !== user.id &&
        (goal.created_by_id !== user.id || !relationshipFor(db, user.id, goal.member_id))) {
      throw new ApiError(403, "You cannot delete this member's goal.");
    }
    db.prepare('DELETE FROM fitness_goals WHERE id = ?').run(recordId);
    return apiResult(200, { ok: true });
  }
  const goal = recordId ? db.prepare('SELECT * FROM fitness_goals WHERE id = ?').get(recordId) : null;
  if (recordId && !goal) throw new ApiError(404, 'Goal not found.');
  if (goal && user.role === 'member' && goal.member_id !== user.id) throw new ApiError(403, 'You cannot change this goal.');
  if (goal && user.role === 'trainer' &&
      (goal.created_by_id !== user.id || !relationshipFor(db, user.id, goal.member_id))) {
    throw new ApiError(403, "You cannot change this member's goal.");
  }
  const memberId = user.role === 'trainer'
    ? requireRelationship(db, user.id, textValue(body, 'clientId', { required: true, limit: 80 })).member_id
    : user.id;
  const name = textValue(body, 'name', { required: true, limit: 160 });
  const type = textValue(body, 'type', { required: true, limit: 100 });
  const target = textValue(body, 'target', { required: true, limit: 300 });
  const deadline = textValue(body, 'deadline', { limit: 40 });
  const progress = parseNumber(body.progress === undefined ? (goal ? goal.progress : 0) : body.progress, 'Progress', { minimum: 0, maximum: 100 });
  const completed = body.completed || progress >= 100 ? 1 : 0;
  if (goal && user.role === 'member' && goal.created_by_role === 'trainer') {
    if (body.name !== goal.name || body.type !== goal.type || body.target !== goal.target || body.deadline !== goal.deadline) {
      throw new ApiError(403, 'Members can only update progress on trainer-created goals.');
    }
    db.prepare('UPDATE fitness_goals SET progress=?, completed=?, updated_at=? WHERE id=?').run(progress, completed, now(), recordId);
    notifyMemberTrainers(db, memberId, 'goal_progress', 'A member updated a fitness goal.', recordId);
    if (completed) notifyMemberTrainers(db, memberId, 'goal_reached', 'A member reached a fitness goal.', recordId);
    return apiResult(200, { id: recordId });
  }
  if (goal) {
    db.prepare('UPDATE fitness_goals SET name=?, type=?, target=?, deadline=?, progress=?, completed=?, updated_at=? WHERE id=?')
      .run(name, type, target, deadline, progress, completed, now(), recordId);
    if (user.role === 'trainer') addNotification(db, memberId, 'fitness_goal', 'Your trainer changed a fitness goal.', recordId);
  } else {
    recordId = newId();
    db.prepare('INSERT INTO fitness_goals (id, member_id, created_by_id, created_by_role, name, type, target, deadline, progress, completed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(recordId, memberId, user.id, user.role, name, type, target, deadline, progress, completed, now(), now());
    if (user.role === 'trainer') addNotification(db, memberId, 'fitness_goal', 'Your trainer assigned or changed a fitness goal.', recordId);
  }
  if (user.role === 'member' && completed) notifyMemberTrainers(db, memberId, 'goal_reached', 'A member reached a fitness goal.', recordId);
  return apiResult(goal ? 200 : 201, { id: recordId });
}

function saveSchedule(db, user, recordId, body, method) {
  if (method === 'DELETE') {
    const row = db.prepare('SELECT * FROM schedules WHERE id = ? AND trainer_id = ?').get(recordId, user.id);
    if (!row || !relationshipFor(db, user.id, row.member_id)) throw new ApiError(404, 'Schedule not found.');
    db.prepare('DELETE FROM schedules WHERE id = ?').run(recordId);
    return apiResult(200, { ok: true });
  }
  const isUpdate = Boolean(recordId);
  let relation;
  if (recordId) {
    const row = db.prepare('SELECT * FROM schedules WHERE id = ? AND trainer_id = ?').get(recordId, user.id);
    if (!row || !relationshipFor(db, user.id, row.member_id)) throw new ApiError(404, 'Schedule not found.');
    relation = requireRelationship(db, user.id, textValue(body, 'clientId', { required: true, limit: 80 }));
    if (relation.member_id !== row.member_id) throw new ApiError(403, 'Schedule belongs to a different member.');
  } else {
    relation = requireRelationship(db, user.id, textValue(body, 'clientId', { required: true, limit: 80 }));
  }
  const day = textValue(body, 'day', { required: true, limit: 20 });
  const date = textValue(body, 'date', { required: true, limit: 40 });
  const time = textValue(body, 'time', { required: true, limit: 10 });
  const program = textValue(body, 'program', { required: true, limit: 160 });
  const status = body.status === undefined ? 'upcoming' : body.status;
  if (!['upcoming', 'done', 'missed'].includes(status)) throw new ApiError(400, 'Choose a valid schedule status.');
  if (recordId) {
    db.prepare('UPDATE schedules SET day=?, date=?, time=?, program=?, status=?, updated_at=? WHERE id=?')
      .run(day, date, time, program, status, now(), recordId);
  } else {
    recordId = newId();
    db.prepare('INSERT INTO schedules (id, member_id, trainer_id, relationship_id, day, date, time, program, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(recordId, relation.member_id, user.id, relation.id, day, date, time, program, status, now(), now());
    addNotification(db, relation.member_id, 'workout_schedule', 'Your trainer updated your workout schedule.', recordId);
  }
  return apiResult(isUpdate ? 200 : 201, { id: recordId });
}

function changeCollection(db, user, collection, recordId, body, method) {
  if (method === 'POST' && recordId) throw new ApiError(405, 'Use PATCH to update an existing record.');
  if (['PATCH', 'DELETE'].includes(method) && !recordId) throw new ApiError(405, 'A record ID is required.');
  if (collection === 'measurements' && user.role !== 'member') throw new ApiError(403, 'Members enter and manage their own measurements.');
  if (collection === 'schedules' && user.role !== 'trainer') throw new ApiError(403, 'Only trainers can manage workout schedules.');
  const save = { workouts: saveWorkout, measurements: saveMeasurement, goals: saveGoal, schedules: saveSchedule }[collection];
  if (!save) throw new ApiError(404, 'Collection not found.');
  return save(db, user, recordId, body, method);
}

function uploadAdminImage(db, uploadDir, admin, body) {
  const originalName = textValue(body, 'filename', { required: true, limit: 180 });
  const encoded = body.data;
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_IMAGE_SIZE / 3) * 4 + 8) throw new ApiError(413, 'Image must be 3 MB or smaller.');
  const extension = path.extname(originalName).toLowerCase();
  const formats = { '.jpg': ['image/jpeg', '.jpg'], '.jpeg': ['image/jpeg', '.jpg'], '.png': ['image/png', '.png'], '.webp': ['image/webp', '.webp'] };
  if (!formats[extension]) throw new ApiError(400, 'Upload a JPG, PNG, or WebP image.');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new ApiError(400, 'Image data is invalid.');
  const image = Buffer.from(encoded, 'base64');
  if (!image.length || image.length > MAX_IMAGE_SIZE) throw new ApiError(413, 'Image must be between 1 byte and 3 MB.');
  const [mimeType, savedExtension] = formats[extension];
  const validSignature = mimeType === 'image/jpeg' ? image.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : mimeType === 'image/png' ? image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : image.length >= 12 && image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP';
  if (!validSignature) throw new ApiError(400, 'The file content does not match its image format.');
  const id = newId();
  const filename = id + savedExtension;
  fs.mkdirSync(uploadDir, { recursive: true });
  const filePath = path.resolve(uploadDir, filename);
  if (!filePath.startsWith(uploadDir + path.sep)) throw new ApiError(400, 'Invalid image path.');
  fs.writeFileSync(filePath, image, { flag: 'wx' });
  try {
    db.prepare('INSERT INTO website_images (id, filename, original_name, mime_type, size, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, filename, originalName, mimeType, image.length, now(), admin.id);
    logAdminActivity(db, admin, 'image_uploaded', originalName);
  } catch (error) {
    fs.unlinkSync(filePath);
    throw error;
  }
  return apiResult(201, { image: { id, url: `/uploads/${filename}`, name: originalName } });
}

function deleteAdminImage(db, uploadDir, legacyUploadDir, admin, imageId) {
  const image = db.prepare('SELECT * FROM website_images WHERE id = ?').get(imageId);
  if (!image) throw new ApiError(404, 'Image not found.');
  const url = `/uploads/${image.filename}`;
  if (JSON.stringify(publishedSite(db)).includes(url) || JSON.stringify(draftSite(db)).includes(url)) {
    throw new ApiError(409, 'This image is in use. Replace it in the website draft before deleting it.');
  }
  const filePath = path.resolve(uploadDir, image.filename);
  if (!filePath.startsWith(uploadDir + path.sep)) throw new ApiError(400, 'Invalid image path.');
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const legacyFilePath = path.resolve(legacyUploadDir, image.filename);
  if (legacyUploadDir !== uploadDir && legacyFilePath.startsWith(legacyUploadDir + path.sep) && fs.existsSync(legacyFilePath)) {
    fs.unlinkSync(legacyFilePath);
  }
  db.prepare('DELETE FROM website_images WHERE id = ?').run(imageId);
  logAdminActivity(db, admin, 'image_deleted', image.original_name);
  return apiResult(200, { ok: true });
}

function createApp(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const database = options.databasePath || DATABASE;
  const uploadDir = path.resolve(options.uploadDir || process.env.FITMETRIC_UPLOADS || path.join(path.dirname(path.resolve(database)), 'uploads'));
  const legacyUploadDir = path.resolve(root, 'uploads');
  if (!options.databasePath && process.env.FITMETRIC_DB && !fs.existsSync(database)) {
    throw new Error(`FITMETRIC_DB does not exist: ${database}. Attach the volume containing the existing FitMetric database.`);
  }
  const db = options.db || openDatabase(database);
  initializeDatabase(db);
  const app = express();

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self';"
    });
    next();
  });
  app.use(express.json({ limit: MAX_ADMIN_REQUEST_SIZE, strict: true }));

  function sendResult(res, result) {
    for (const [name, value] of Object.entries(result.headers || {})) res.set(name, value);
    return res.status(result.status).json(result.body);
  }

  function write(handler) {
    return (req, res, next) => {
      try {
        const origin = req.get('origin');
        if (origin) {
          let parsedOrigin;
          try { parsedOrigin = new URL(origin); } catch { throw new ApiError(403, 'Cross-origin requests are not allowed.'); }
          if (parsedOrigin.host.toLowerCase() !== (req.get('host') || '').toLowerCase() ||
              !['http:', 'https:'].includes(parsedOrigin.protocol)) {
            throw new ApiError(403, 'Cross-origin requests are not allowed.');
          }
        }
        if (req.method !== 'DELETE') {
          if (!req.is('application/json')) throw new ApiError(415, 'Content-Type must be application/json.');
          if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            throw new ApiError(400, 'Request body must be a JSON object.');
          }
          const limit = req.path.startsWith('/api/admin/') ? MAX_ADMIN_REQUEST_SIZE : MAX_REQUEST_SIZE;
          if (Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8') > limit) throw new ApiError(413, 'Request body is too large.');
        }
        const result = db.transaction(() => handler(req)).immediate();
        return sendResult(res, result);
      } catch (error) {
        return next(error);
      }
    };
  }

  app.get('/api/health', (req, res, next) => {
    try { db.prepare('SELECT 1').get(); res.json({ status: 'ok' }); } catch (error) { next(error); }
  });
  app.get('/api/me', (req, res, next) => {
    try { res.json({ user: publicUser(currentUser(db, req)) }); } catch (error) { next(error); }
  });
  app.get('/api/state', (req, res, next) => {
    try { res.json(getState(db, currentUser(db, req))); } catch (error) { next(error); }
  });
  app.get('/api/site', (req, res, next) => {
    try {
      if (req.query.preview === '1') {
        requireAdmin(db, req);
        return res.json({ content: draftSite(db), preview: true });
      }
      return res.json({ content: publishedSite(db), preview: false });
    } catch (error) { return next(error); }
  });

  app.get('/api/admin/content', (req, res, next) => {
    try { requireAdmin(db, req); res.json({ content: draftSite(db), published: publishedSite(db) }); } catch (error) { next(error); }
  });
  app.get('/api/admin/summary', (req, res, next) => {
    try {
      const admin = requireAdmin(db, req);
      const content = draftSite(db);
      const counts = {
        members: db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'member'").get().count,
        trainers: db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'trainer'").get().count,
        programs: content.programs.filter((item) => item.active).length,
        images: db.prepare('SELECT COUNT(*) AS count FROM website_images').get().count
      };
      res.json({ admin: { name: admin.name, email: admin.email }, counts });
    } catch (error) { next(error); }
  });
  app.get('/api/admin/accounts', (req, res, next) => {
    try {
      requireAdmin(db, req);
      res.json({ accounts: db.prepare('SELECT id, name, email, role, photo, created_at FROM users ORDER BY created_at DESC').all() });
    } catch (error) { next(error); }
  });
  app.get('/api/admin/activity', (req, res, next) => {
    try {
      requireAdmin(db, req);
      res.json({ activity: db.prepare('SELECT l.action, l.details, l.created_at, a.email AS admin_email FROM admin_activity_logs l JOIN admin_users a ON a.id = l.admin_id ORDER BY l.created_at DESC LIMIT 100').all() });
    } catch (error) { next(error); }
  });
  app.get('/api/admin/images', (req, res, next) => {
    try {
      requireAdmin(db, req);
      res.json({ images: db.prepare('SELECT id, filename, original_name, mime_type, size, created_at FROM website_images ORDER BY created_at DESC').all() });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/login', write((req) => adminLogin(db, req)));
  app.post('/api/admin/logout', write((req) => adminLogout(db, req)));
  app.post('/api/auth/register', write((req) => register(db, req)));
  app.post('/api/auth/login', write((req) => login(db, req)));
  app.post('/api/auth/logout', write((req) => logout(db, req)));

  app.put('/api/admin/draft', write((req) => {
    const admin = requireAdmin(db, req);
    const content = validateSiteContent(req.body.content);
    db.prepare('INSERT INTO content_drafts (id, content_json, updated_at, updated_by) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET content_json = excluded.content_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .run(JSON.stringify(content), now(), admin.id);
    logAdminActivity(db, admin, 'draft_saved');
    return apiResult(200, { ok: true });
  }));
  app.post('/api/admin/publish', write((req) => publishAdminContent(db, req, false)));
  app.put('/api/admin/publish', write((req) => publishAdminContent(db, req, true)));
  app.post('/api/admin/discard', write((req) => {
    const admin = requireAdmin(db, req);
    db.prepare('DELETE FROM content_drafts WHERE id = 1').run();
    logAdminActivity(db, admin, 'draft_discarded');
    return apiResult(200, { ok: true });
  }));
  app.post('/api/admin/images', write((req) => uploadAdminImage(db, uploadDir, requireAdmin(db, req), req.body)));
  app.delete('/api/admin/images/:imageId', write((req) => deleteAdminImage(db, uploadDir, legacyUploadDir, requireAdmin(db, req), req.params.imageId)));

  app.patch('/api/profile', write((req) => updateProfile(db, currentUser(db, req), req.body)));
  app.post('/api/invitations', write((req) => createInvitation(db, currentUser(db, req), req.body)));
  app.post('/api/invitations/redeem', write((req) => redeemInvitation(db, currentUser(db, req), req.body)));
  app.post('/api/invitations/:invitationId/respond', write((req) => respondInvitation(db, currentUser(db, req), req.params.invitationId, req.body)));
  app.delete('/api/relationships/:relationshipId', write((req) => disconnect(db, currentUser(db, req), req.params.relationshipId)));
  app.post('/api/notes', write((req) => createNote(db, currentUser(db, req), req.body)));
  app.post('/api/notes/:noteId/read', write((req) => readNote(db, currentUser(db, req), req.params.noteId)));
  app.patch('/api/notes/:noteId', write((req) => changeNote(db, currentUser(db, req), req.params.noteId, req.body, 'PATCH')));
  app.delete('/api/notes/:noteId', write((req) => changeNote(db, currentUser(db, req), req.params.noteId, req.body || {}, 'DELETE')));
  app.post('/api/notifications/:notificationId/read', write((req) => readNotification(db, currentUser(db, req), req.params.notificationId)));

  const collections = new Set(['workouts', 'schedules', 'measurements', 'goals']);
  function collectionHandler(req) {
    if (!collections.has(req.params.collection)) throw new ApiError(404, 'Collection not found.');
    return changeCollection(db, currentUser(db, req), req.params.collection, req.params.recordId, req.body || {}, req.method);
  }
  app.post('/api/:collection', write(collectionHandler));
  app.put('/api/:collection', write(collectionHandler));
  app.patch('/api/:collection', write(collectionHandler));
  app.delete('/api/:collection', write(collectionHandler));
  app.post('/api/:collection/:recordId', write(collectionHandler));
  app.patch('/api/:collection/:recordId', write(collectionHandler));
  app.put('/api/:collection/:recordId', write(collectionHandler));
  app.delete('/api/:collection/:recordId', write(collectionHandler));

  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use((req, res, next) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed.' });
      if (req.path === '/admin' || req.path === '/admin/') {
        const queryStart = req.url.indexOf('?');
        req.url = `/admin.html${queryStart >= 0 ? req.url.slice(queryStart) : ''}`;
      }
      const preview = req.query.preview === '1';
      if (preview) {
        requireAdmin(db, req);
        res.set('X-Frame-Options', 'SAMEORIGIN');
        res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self';");
      }
      const requestedPath = req.path === '/' ? 'index.html' : decodeURIComponent(req.path).replace(/^\/+/, '');
      const relativePath = requestedPath.replace(/\//g, path.sep);
      const firstPart = relativePath.split(path.sep)[0].toLowerCase();
      let target;
      if (firstPart === 'uploads') {
        const uploadPath = path.resolve(uploadDir, relativePath.slice('uploads'.length + 1));
        if (!uploadPath.startsWith(uploadDir + path.sep)) throw new ApiError(404, 'File not found.');
        try {
          target = fs.realpathSync(uploadPath);
        } catch (error) {
          if (error.code !== 'ENOENT' || legacyUploadDir === uploadDir) throw error;
          target = fs.realpathSync(path.resolve(legacyUploadDir, relativePath.slice('uploads'.length + 1)));
        }
        if (!target.startsWith(uploadDir + path.sep) &&
            !(legacyUploadDir !== uploadDir && target.startsWith(legacyUploadDir + path.sep))) {
          throw new ApiError(404, 'File not found.');
        }
      } else {
        target = path.resolve(root, requestedPath);
        if (target !== root && !target.startsWith(root + path.sep)) throw new ApiError(404, 'File not found.');
        target = fs.realpathSync(target);
        if (target !== root && !target.startsWith(root + path.sep)) throw new ApiError(404, 'File not found.');
      }
      const allowedRootFiles = new Set(['index.html', 'auth.html', 'admin.html', 'dashboard.html', 'admin.js', 'cms.js', 'script.js', 'styles.css', 'admin.css']);
      if (firstPart === 'js') {
        if (!relativePath.startsWith(`js${path.sep}`)) throw new ApiError(404, 'File not found.');
      } else if (firstPart === 'uploads') {
        if (!relativePath.startsWith(`uploads${path.sep}`)) throw new ApiError(404, 'File not found.');
      } else if (!allowedRootFiles.has(relativePath.toLowerCase())) {
        throw new ApiError(404, 'File not found.');
      }
      if (!fs.statSync(target).isFile()) throw new ApiError(404, 'File not found.');
      const types = {
        '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon'
      };
      res.type(types[path.extname(target).toLowerCase()] || 'application/octet-stream');
      return res.sendFile(target);
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof URIError) return next(new ApiError(404, 'File not found.'));
      return next(error);
    }
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON.' });
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'Request body must be valid JSON.' });
    if (error.code && error.code.startsWith('SQLITE_CONSTRAINT')) {
      console.error('Database constraint rejected a request:', error.message);
      return res.status(409).json({ error: 'The requested change conflicts with existing data.' });
    }
    console.error('Request failed:', error);
    return res.status(500).json({ error: 'The request could not be completed. Please try again.' });
  });
  app.locals.fitmetricDb = db;
  return app;
}

function publishAdminContent(db, req, useRequestContent) {
  const admin = requireAdmin(db, req);
  const content = useRequestContent ? validateSiteContent(req.body.content) : draftSite(db);
  validateSiteContent(content);
  const result = db.prepare('UPDATE website_content SET content_json = ?, updated_at = ? WHERE id = 1').run(JSON.stringify(content), now());
  if (result.changes !== 1) throw new ApiError(500, 'Published website content could not be saved.');
  db.prepare('DELETE FROM content_drafts WHERE id = 1').run();
  logAdminActivity(db, admin, useRequestContent ? 'content_saved_and_published' : 'content_published');
  return apiResult(200, { ok: true });
}

function startServer(options = {}) {
  const app = createApp(options);
  const port = options.port === undefined ? PORT : options.port;
  const host = options.host || HOST;
  const server = app.listen(port, host, () => {
    const address = server.address();
    console.log(`FitMetric is running at http://${host}:${address.port}`);
    console.log(`SQLite database: ${options.databasePath || DATABASE}`);
  });
  server.on('close', () => {
    if (!options.db) app.locals.fitmetricDb.close();
  });
  return server;
}

if (require.main === module) startServer();

module.exports = {
  ApiError, DEFAULT_SITE_CONTENT, EMAIL_PATTERN, PASSWORD_ITERATIONS,
  createApp, emailIsRegistered, hashPassword, initializeDatabase, now, openDatabase,
  startServer, verifyPassword
};
