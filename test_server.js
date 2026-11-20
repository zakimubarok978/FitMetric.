'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApp, hashPassword, verifyPassword } = require('./server');
const { createFirstAdmin } = require('./setup_admin');

function legacyHash(password, iterations = 310000) {
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const digest = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return `${iterations}$${salt.toString('hex')}$${digest.toString('hex')}`;
}

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fitmetric-test-'));
  const siteRoot = path.join(directory, 'site');
  fs.mkdirSync(siteRoot);
  for (const file of ['index.html', 'auth.html', 'admin.html', 'dashboard.html', 'admin.js', 'cms.js', 'script.js', 'styles.css', 'admin.css']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(siteRoot, file));
  }
  fs.cpSync(path.join(__dirname, 'js'), path.join(siteRoot, 'js'), { recursive: true });
  const app = createApp({ root: siteRoot, databasePath: path.join(directory, 'test.sqlite3') });
  const http = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => http.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${http.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
    app.locals.fitmetricDb.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { app, baseUrl };
}

function client() {
  const cookies = new Map();
  return {
    async request(baseUrl, route, { method = 'GET', body, expected = 200 } = {}) {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (cookies.size) headers.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
      const response = await fetch(baseUrl + route, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body)
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const [pair] = setCookie.split(';');
        const separator = pair.indexOf('=');
        if (separator > 0) {
          const name = pair.slice(0, separator);
          const value = pair.slice(separator + 1);
          if (value) cookies.set(name, value);
          else cookies.delete(name);
        }
      }
      const data = await response.json();
      assert.equal(response.status, expected, JSON.stringify(data));
      return data;
    }
  };
}

async function registerAndLogin(requester, baseUrl, email, role) {
  const password = 'secure-pass-123';
  const created = await requester.request(baseUrl, '/api/auth/register', {
    method: 'POST', expected: 201,
    body: { name: role, email, password, confirmPassword: password, role }
  });
  assert.equal(created.user.role, role);
  assert.equal(Object.hasOwn(created.user, 'password_hash'), false);
  await requester.request(baseUrl, '/api/auth/login', { method: 'POST', body: { email, password } });
  return created.user;
}

test('preserves the existing PBKDF2 password-hash format', () => {
  const password = 'existing-account-password';
  const stored = legacyHash(password);
  assert.equal(verifyPassword(password, stored), true);
  assert.equal(verifyPassword(`${password}!`, stored), false);
  assert.match(hashPassword(password), /^310000\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
});

test('serves frontend, validates registration, and manages member sessions', async (t) => {
  const { baseUrl } = await fixture(t);
  const guest = client();
  assert.deepEqual(await guest.request(baseUrl, '/api/health'), { status: 'ok' });
  const home = await fetch(baseUrl + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /data-cms-section="home"/);
  const privatePreview = await fetch(baseUrl + '/admin?preview=1');
  assert.equal(privatePreview.status, 401);
  assert.equal((await privatePreview.json()).error, 'Admin sign-in is required.');
  await guest.request(baseUrl, '/api/state', { expected: 401 });
  await guest.request(baseUrl, '/api/auth/register', {
    method: 'POST', expected: 400,
    body: { name: 'Invalid', email: 'bad-email', password: 'secure-pass-123', confirmPassword: 'secure-pass-123', role: 'member' }
  });
  const member = client();
  await registerAndLogin(member, baseUrl, 'member@example.com', 'member');
  assert.equal((await member.request(baseUrl, '/api/state')).user.email, 'member@example.com');
  await member.request(baseUrl, '/api/auth/logout', { method: 'POST', body: {} });
  await member.request(baseUrl, '/api/state', { expected: 401 });
});

test('supports trainer invitations, private member data, notes, goals, and schedules', async (t) => {
  const { baseUrl } = await fixture(t);
  const trainer = client();
  const member = client();
  const trainerUser = await registerAndLogin(trainer, baseUrl, 'trainer@example.com', 'trainer');
  await registerAndLogin(member, baseUrl, 'member@example.com', 'member');
  const invitation = (await trainer.request(baseUrl, '/api/invitations', {
    method: 'POST', expected: 201, body: { email: 'member@example.com' }
  })).invitation;
  await member.request(baseUrl, `/api/invitations/${invitation.id}/respond`, { method: 'POST', body: { accept: true } });
  const clientRecord = (await trainer.request(baseUrl, '/api/state')).clients[0];
  const note = await trainer.request(baseUrl, '/api/notes', {
    method: 'POST', expected: 201, body: { clientId: clientRecord.id, title: 'Week one', evaluation: 'Good progress' }
  });
  assert.equal((await member.request(baseUrl, '/api/state')).notes[0].id, note.id);
  await member.request(baseUrl, `/api/notes/${note.id}`, { method: 'DELETE', expected: 403 });
  await trainer.request(baseUrl, `/api/notes/${note.id}`, {
    method: 'PATCH', body: { clientId: clientRecord.id, title: 'Week one updated', evaluation: 'Excellent progress' }
  });
  await member.request(baseUrl, `/api/notes/${note.id}/read`, { method: 'POST', body: {} });
  assert.equal((await member.request(baseUrl, '/api/state')).notes[0].status, 'read');

  const goal = await trainer.request(baseUrl, '/api/goals', {
    method: 'POST', expected: 201,
    body: { clientId: clientRecord.id, name: 'Run 5 km', type: 'Endurance', target: '5 km' }
  });
  assert.equal((await member.request(baseUrl, '/api/state')).goals[0].id, goal.id);
  const memberGoal = (await member.request(baseUrl, '/api/state')).goals[0];
  await member.request(baseUrl, `/api/goals/${goal.id}`, {
    method: 'PATCH', body: { ...memberGoal, progress: 50 }
  });
  await member.request(baseUrl, `/api/goals/${goal.id}`, {
    method: 'PATCH', expected: 403, body: { ...memberGoal, target: '10 km', progress: 60 }
  });
  const schedule = await trainer.request(baseUrl, '/api/schedules', {
    method: 'POST', expected: 201,
    body: { clientId: clientRecord.id, day: 'Monday', date: '2026-11-16', time: '18:30', program: 'Strength' }
  });
  assert.equal((await member.request(baseUrl, '/api/state')).schedules[0].id, schedule.id);
  await trainer.request(baseUrl, `/api/schedules/${schedule.id}`, {
    method: 'PATCH', body: { clientId: clientRecord.id, day: 'Tuesday', date: '2026-11-17', time: '19:00', program: 'Strength' }
  });
  await trainer.request(baseUrl, `/api/schedules/${schedule.id}`, { method: 'DELETE' });
  await member.request(baseUrl, '/api/schedules', {
    method: 'POST', expected: 403,
    body: { clientId: clientRecord.id, day: 'Tuesday', date: '2026-11-17', time: '18:30', program: 'Cardio' }
  });

  const workout = await member.request(baseUrl, '/api/workouts', {
    method: 'POST', expected: 201,
    body: { name: 'Easy Run', exerciseType: 'Cardio', sets: 1, reps: 1, duration: 30, completed: true }
  });
  await trainer.request(baseUrl, `/api/workouts/${workout.id}`, {
    method: 'PATCH', expected: 403,
    body: { clientId: clientRecord.id, name: 'Changed by trainer' }
  });
  await member.request(baseUrl, `/api/workouts/${workout.id}`, {
    method: 'PATCH', body: { name: 'Updated run', exerciseType: 'Cardio', sets: 1, reps: 1, duration: 35 }
  });
  await member.request(baseUrl, `/api/workouts/${workout.id}`, { method: 'DELETE' });
  const trainerWorkout = await trainer.request(baseUrl, '/api/workouts', {
    method: 'POST', expected: 201,
    body: { clientId: clientRecord.id, name: 'Coach Session', exerciseType: 'Strength' }
  });
  await member.request(baseUrl, `/api/workouts/${trainerWorkout.id}`, { method: 'DELETE', expected: 403 });

  const otherMember = client();
  await registerAndLogin(otherMember, baseUrl, 'other@example.com', 'member');
  const measurement = await member.request(baseUrl, '/api/measurements', {
    method: 'POST', expected: 201, body: { date: '2026-11-10', weight: 72.4 }
  });
  assert.equal((await trainer.request(baseUrl, '/api/state')).measurements[0].id, measurement.id);
  assert.equal((await otherMember.request(baseUrl, '/api/state')).measurements.length, 0);
  await member.request(baseUrl, `/api/measurements/${measurement.id}`, {
    method: 'PATCH', body: { date: '2026-11-11', weight: 71.8 }
  });
  await member.request(baseUrl, `/api/measurements/${measurement.id}`, { method: 'DELETE' });
  assert.equal((await trainer.request(baseUrl, '/api/state')).measurements.length, 0);
  assert.equal(trainerUser.role, 'trainer');
});

test('authenticates an existing admin hash and publishes website drafts', async (t) => {
  const { app, baseUrl } = await fixture(t);
  const db = app.locals.fitmetricDb;
  db.prepare('INSERT INTO admin_users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('existing-admin', 'Site Admin', 'admin@example.com', legacyHash('admin-pass-12345'), new Date().toISOString());
  const admin = client();
  await admin.request(baseUrl, '/api/admin/login', {
    method: 'POST', body: { email: 'admin@example.com', password: 'admin-pass-12345' }
  });
  const content = (await admin.request(baseUrl, '/api/admin/content')).content;
  content.text.heroTitle = 'Migrated Node.js content';
  await admin.request(baseUrl, '/api/admin/draft', { method: 'PUT', body: { content } });
  assert.notEqual((await client().request(baseUrl, '/api/site')).content.text.heroTitle, 'Migrated Node.js content');
  await admin.request(baseUrl, '/api/admin/publish', { method: 'POST', body: {} });
  assert.equal((await client().request(baseUrl, '/api/site')).content.text.heroTitle, 'Migrated Node.js content');
  await admin.request(baseUrl, '/api/admin/logout', { method: 'POST', body: {} });
  await admin.request(baseUrl, '/api/admin/summary', { expected: 401 });
});

test('creates the first administrator only in the existing account database', async (t) => {
  const { app } = await fixture(t);
  const db = app.locals.fitmetricDb;
  db.prepare('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('existing-member', 'Member', 'taken@example.com', hashPassword('member-password'), 'member', new Date().toISOString());
  assert.throws(() => createFirstAdmin(db, 'Admin', 'taken@example.com', 'long-admin-password'), /sudah digunakan/);
  createFirstAdmin(db, 'First Admin', 'ADMIN@example.com', 'long-admin-password');
  const admin = db.prepare('SELECT name, email, password_hash FROM admin_users').get();
  assert.equal(admin.name, 'First Admin');
  assert.equal(admin.email, 'admin@example.com');
  assert.equal(verifyPassword('long-admin-password', admin.password_hash), true);
  assert.throws(() => createFirstAdmin(db, 'Another Admin', 'second@example.com', 'long-admin-password'), /sudah ada/);
});

test('validates library images, serves uploads, and prevents deleting published assets', async (t) => {
  const { app, baseUrl } = await fixture(t);
  const db = app.locals.fitmetricDb;
  db.prepare('INSERT INTO admin_users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('media-admin', 'Media Admin', 'media@example.com', hashPassword('admin-pass-12345'), new Date().toISOString());
  const admin = client();
  await admin.request(baseUrl, '/api/admin/login', {
    method: 'POST', body: { email: 'media@example.com', password: 'admin-pass-12345' }
  });
  await admin.request(baseUrl, '/api/admin/images', {
    method: 'POST', expected: 400, body: { filename: 'invalid.jpg', data: Buffer.from('not image').toString('base64') }
  });
  const image = (await admin.request(baseUrl, '/api/admin/images', {
    method: 'POST', expected: 201,
    body: {
      filename: 'pixel.png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pWQAAAAASUVORK5CYII='
    }
  })).image;
  const imageResponse = await fetch(baseUrl + image.url);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/png');
  const content = (await admin.request(baseUrl, '/api/admin/content')).content;
  content.images.hero = image.url;
  await admin.request(baseUrl, '/api/admin/draft', { method: 'PUT', body: { content } });
  await admin.request(baseUrl, '/api/admin/publish', { method: 'POST', body: {} });
  await admin.request(baseUrl, `/api/admin/images/${image.id}`, { method: 'DELETE', expected: 409 });
  await admin.request(baseUrl, '/api/admin/images', { method: 'GET' });
});
