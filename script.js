const STORAGE_KEYS = {
  users: 'fitmetric-demo-users',
  currentUser: 'fitmetric-current-user',
  workouts: 'fitmetric-workouts',
  schedules: 'fitmetric-schedules',
  measurements: 'fitmetric-measurements',
  clients: 'fitmetric-clients',
  goals: 'fitmetric-goals',
  notes: 'fitmetric-trainer-notes',
  invitations: 'fitmetric-invitations',
  notifications: 'fitmetric-notifications'
};

const API_COLLECTIONS = {
  [STORAGE_KEYS.workouts]: '/api/workouts',
  [STORAGE_KEYS.schedules]: '/api/schedules',
  [STORAGE_KEYS.measurements]: '/api/measurements',
  [STORAGE_KEYS.goals]: '/api/goals'
};

const stateCache = new Map();
let currentUser = null;
let stateRefreshInProgress = false;

async function apiRequest(path, options = {}) {
  const headers = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(translate('Cannot reach the FitMetric server. Start the backend and open http://127.0.0.1:8000 (not file:// or VS Code Live Server).'));
    }
    throw error;
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error(translate('The FitMetric API returned a non-JSON response. Open http://127.0.0.1:8000 and confirm the Python server is running.'));
  }
  if (!response.ok) {
    const requestError = new Error(result.error || 'The request could not be completed.');
    requestError.status = response.status;
    throw requestError;
  }
  return result;
}

function cacheServerState(state) {
  const collections = {
    [STORAGE_KEYS.users]: state.users || [],
    [STORAGE_KEYS.clients]: state.clients || [],
    [STORAGE_KEYS.invitations]: state.invitations || [],
    [STORAGE_KEYS.workouts]: state.workouts || [],
    [STORAGE_KEYS.schedules]: state.schedules || [],
    [STORAGE_KEYS.measurements]: state.measurements || [],
    [STORAGE_KEYS.goals]: state.goals || [],
    [STORAGE_KEYS.notes]: state.notes || [],
    [STORAGE_KEYS.notifications]: state.notifications || []
  };
  let changed = false;
  Object.entries(collections).forEach(([key, value]) => {
    if (JSON.stringify(stateCache.get(key) || []) !== JSON.stringify(value)) changed = true;
    stateCache.set(key, value);
  });
  if (JSON.stringify(currentUser) !== JSON.stringify(state.user)) changed = true;
  currentUser = state.user;
  stateCache.set('fitmetric-linked-trainer', state.trainer || null);
  return changed;
}

async function refreshServerState() {
  if (stateRefreshInProgress) return;
  stateRefreshInProgress = true;
  try {
    const state = await apiRequest('/api/state');
    if (cacheServerState(state)) refreshDashboardData();
  } finally {
    stateRefreshInProgress = false;
  }
}

function writeCacheStorage(key, value) {
  stateCache.set(key, value);
}

function translate(key) {
  return window.fitmetricI18n ? window.fitmetricI18n.t(key) : key;
}

function formatNumber(value, options) {
  return window.fitmetricI18n
    ? window.fitmetricI18n.formatNumber(value, options)
    : Number(value).toLocaleString();
}

function readStorage(key, fallback) {
  if (key === STORAGE_KEYS.currentUser) return currentUser;
  return stateCache.has(key) ? stateCache.get(key) : fallback;
}

function persistStorage(key, value) {
  const previous = readStorage(key, []);
  writeCacheStorage(key, value);
  const endpoint = API_COLLECTIONS[key];
  if (!endpoint || !currentUser) return;
  const before = new Map(previous.map((record) => [record.id, record]));
  const after = new Map(value.map((record) => [record.id, record]));
  const changes = [];
  before.forEach((record, id) => {
    if (!after.has(id)) changes.push(apiRequest(`${endpoint}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
  });
  after.forEach((record, id) => {
    if (JSON.stringify(before.get(id)) === JSON.stringify(record)) return;
    const isNew = !before.has(id);
    const payload = { ...record };
    delete payload.id;
    changes.push(apiRequest(isNew ? endpoint : `${endpoint}/${encodeURIComponent(id)}`, {
      method: isNew ? 'POST' : 'PATCH',
      body: payload
    }));
  });
  if (!changes.length) return;
  Promise.all(changes)
    .then(() => refreshServerState())
    .catch((error) => {
      console.error('Saving FitMetric data failed:', error);
      showToast(document.getElementById('dashboardToast') ? 'dashboardToast' : 'authToast', error.message);
      refreshServerState().catch((refreshError) => console.error('Refreshing FitMetric data failed:', refreshError));
    });
}

function getCurrentUser() {
  return currentUser;
}

function setCurrentUser(user) {
  currentUser = user;
}

function clearCurrentUser() {
  currentUser = null;
  stateCache.clear();
  localStorage.removeItem(STORAGE_KEYS.currentUser);
}

function showToast(elementId, message) {
  const toast = document.getElementById(elementId);
  if (!toast) return;

  toast.dataset.i18n = message;
  toast.textContent = translate(message);
  toast.classList.add('show');
  clearInterval(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2000);
}

function showLocalizedError(element, message) {
  element.dataset.i18n = message;
  element.textContent = translate(message);
  element.classList.add('show');
}

function navigateToAuth(mode = 'login') {
  const target = new URL('auth.html', window.location.href);
  if (mode === 'register') target.searchParams.set('mode', 'register');
  window.location.href = target.toString();
}

function initLandingPage() {
  const toggleButton = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  const actions = document.querySelector('.nav-actions');

  if (!toggleButton || !navLinks || !actions) return;

  toggleButton.addEventListener('click', () => {
    const isVisible = navLinks.style.display === 'flex';
    navLinks.style.display = isVisible ? 'none' : 'flex';
    navLinks.style.flexDirection = 'column';
    navLinks.style.position = 'absolute';
    navLinks.style.top = '84px';
    navLinks.style.left = '20px';
    navLinks.style.right = '20px';
    navLinks.style.padding = '20px';
    navLinks.style.border = '1px solid rgba(255,255,255,0.08)';
    navLinks.style.borderRadius = '16px';
    navLinks.style.background = 'rgba(11,15,25,0.96)';
    navLinks.style.zIndex = '20';
    actions.style.display = isVisible ? 'flex' : 'none';
  });
}

async function initAuthPage() {
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loginFormWrap = document.getElementById('loginFormWrap');
  const registerFormWrap = document.getElementById('registerFormWrap');
  const params = new URLSearchParams(window.location.search);

  function switchTab(mode) {
    const isRegister = mode === 'register';
    loginTab.classList.toggle('active', !isRegister);
    registerTab.classList.toggle('active', isRegister);
    loginFormWrap.classList.toggle('hidden', isRegister);
    registerFormWrap.classList.toggle('hidden', !isRegister);
  }

  loginTab.addEventListener('click', () => switchTab('login'));
  registerTab.addEventListener('click', () => switchTab('register'));
  document.getElementById('forgotPasswordLink').addEventListener('click', (event) => {
    event.preventDefault();
    showLocalizedError(document.getElementById('loginError'), 'Password reset is not configured in this local app. Contact your FitMetric administrator.');
  });
  document.querySelectorAll('[data-switch-auth]').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.switchAuth));
  });
  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      const showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(showing));
      button.textContent = translate(showing ? 'Hide password' : 'Show password');
      button.setAttribute('aria-label', button.textContent);
    });
  });

  if (params.get('mode') === 'register') {
    switchTab('register');
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const password = String(formData.get('password') || '');
    const errorBox = document.getElementById('loginError');
    errorBox.classList.remove('show');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
      showLocalizedError(errorBox, 'Enter a valid email address and password.');
      return;
    }
    try {
      const result = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email, password }
      });
      setCurrentUser(result.user);
      errorBox.classList.remove('show');
      window.location.href = 'dashboard.html';
    } catch (error) {
      showLocalizedError(errorBox, error.message);
    }
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(registerForm);
    const name = String(formData.get('name') || '').trim();
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const password = String(formData.get('password') || '');
    const confirmPassword = String(formData.get('confirmPassword') || '');
    const role = String(formData.get('role') || 'member');
    const errorBox = document.getElementById('registerError');
    errorBox.classList.remove('show');

    if (!name || !email || !password || !confirmPassword) {
      showLocalizedError(errorBox, 'Please fill in all fields.');
      return;
    }

    if (name.length > 100) {
      showLocalizedError(errorBox, 'Full name must be 100 characters or fewer.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showLocalizedError(errorBox, 'Enter a valid email address.');
      return;
    }

    if (password.length < 8) {
      showLocalizedError(errorBox, 'Password must be at least 8 characters long.');
      return;
    }

    if (password.length > 256) {
      showLocalizedError(errorBox, 'Password must be 256 characters or fewer.');
      return;
    }

    if (password !== confirmPassword) {
      showLocalizedError(errorBox, 'Passwords do not match.');
      return;
    }

    try {
      await apiRequest('/api/auth/register', {
        method: 'POST',
        body: { name, email, password, confirmPassword, role }
      });
      errorBox.classList.remove('show');
      registerForm.reset();
      document.getElementById('loginEmail').value = email;
      document.getElementById('loginPassword').value = '';
      document.getElementById('loginError').classList.remove('show');
      switchTab('login');
      showToast('authToast', 'Account created successfully!');
    } catch (error) {
      showLocalizedError(errorBox, error.message);
    }
  });

  try {
    const result = await apiRequest('/api/me');
    setCurrentUser(result.user);
    window.location.href = 'dashboard.html';
  } catch (error) {
    if (error.status !== 401) {
      showLocalizedError(document.getElementById('loginError'), error.message);
    }
  }
}

function getStoredWorkouts() {
  return getScopedRecords(STORAGE_KEYS.workouts);
}

function getStoredSchedules() {
  return getScopedRecords(STORAGE_KEYS.schedules);
}

function getStoredMeasurements() {
  return getScopedRecords(STORAGE_KEYS.measurements);
}

function getScopedRecords(key) {
  const currentUser = getCurrentUser();
  if (!currentUser) return [];
  const records = readStorage(key, []);
  if (currentUser.role === 'trainer') {
    const clientId = getSelectedClientId();
    return clientId
      ? records.filter((record) => record.trainerId === currentUser.id && record.clientId === clientId)
      : [];
  }
  return records.filter((record) => record.userId === currentUser.id);
}

function getTrainerClients() {
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== 'trainer') return [];
  return readStorage(STORAGE_KEYS.clients, [])
    .filter((client) => client.trainerId === currentUser.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function findLinkedClient(userId) {
  return readStorage(STORAGE_KEYS.clients, []).find((client) => client.userId === userId && client.status !== 'inactive') || null;
}

function attachLinkedClient(record, userId) {
  const client = findLinkedClient(userId);
  return client ? { ...record, trainerId: client.trainerId, clientId: client.id } : record;
}

function getSelectedClientId() {
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== 'trainer') return '';
  const clients = getTrainerClients();
  const key = `fitmetric-selected-client-${currentUser.id}`;
  const storedId = localStorage.getItem(key);
  return clients.some((client) => client.id === storedId) ? storedId : (clients[0] ? clients[0].id : '');
}

function setSelectedClientId(id) {
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== 'trainer') return;
  localStorage.setItem(`fitmetric-selected-client-${currentUser.id}`, id);
}

function getStoredGoals() {
  const currentUser = getCurrentUser();
  if (!currentUser) return [];
  const goals = readStorage(STORAGE_KEYS.goals, []);
  if (currentUser.role === 'trainer') {
    const clientId = getSelectedClientId();
    return clientId ? goals.filter((goal) => goal.trainerId === currentUser.id && goal.clientId === clientId) : [];
  }
  return goals.filter((goal) => goal.userId === currentUser.id);
}

function createId(prefix) {
  return `${prefix}-${window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function findUserById(id) {
  const users = readStorage(STORAGE_KEYS.users, []);
  return users.find((user) => user.id === id) || null;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getUserRoleLabel(role) {
  return translate(role === 'trainer' ? 'Personal Trainer' : 'Member');
}

function formatDate(value) {
  return window.fitmetricI18n
    ? window.fitmetricI18n.formatDate(value, { month: 'short', day: 'numeric' })
    : new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function hashInRange(days) {
  const dayInMs = 24 * 60 * 60 * 1000;
  const today = new Date();
  const start = new Date(today.getTime() - (days - 1) * dayInMs);
  return (date) => {
    const current = new Date(date);
    return current >= start && current <= today;
  };
}

function renderSummaryCards() {
  const currentUser = getCurrentUser();
  const summaryGrid = document.getElementById('summaryGrid');
  if (!summaryGrid || !currentUser) return;

  if (currentUser.role === 'trainer') {
    const clients = getTrainerClients();
    const activeClients = clients.filter((client) => client.status !== 'inactive').length;
    const workouts = readStorage(STORAGE_KEYS.workouts, []).filter((workout) => workout.trainerId === currentUser.id);
    const schedules = readStorage(STORAGE_KEYS.schedules, []).filter((schedule) => schedule.trainerId === currentUser.id);
    const goals = readStorage(STORAGE_KEYS.goals, []).filter((goal) => goal.trainerId === currentUser.id);
    const cards = [
      { label: 'Total Clients', value: formatNumber(clients.length), trend: translate('Across your client roster') },
      { label: 'Active Clients', value: formatNumber(activeClients), trend: translate('Currently training') },
      { label: 'Client Workouts', value: formatNumber(workouts.length), trend: translate('Logged sessions') },
      { label: 'Today’s Sessions', value: formatNumber(schedules.filter((entry) => entry.date === new Date().toISOString().slice(0, 10)).length), trend: translate('Scheduled today') },
      { label: 'Completed Goals', value: formatNumber(goals.filter((goal) => goal.completed).length), trend: translate('Across all clients') },
      { label: 'Client Goals', value: formatNumber(goals.length), trend: translate('Being tracked') }
    ];
    summaryGrid.innerHTML = cards.map((card) => `
      <div class="summary-card">
        <span class="label">${translate(card.label)}</span>
        <div class="value">${card.value}</div>
        <div class="trend">${card.trend}</div>
      </div>
    `).join('');
    return;
  }

  const workouts = getStoredWorkouts();
  const measurements = [...getStoredMeasurements()].sort((a, b) => new Date(a.date) - new Date(b.date));
  const seen = hashInRange(7);
  const weeklyWorkouts = workouts.filter((workout) => seen(new Date(workout.date)));
  const weeklyMinutes = weeklyWorkouts.reduce((sum, workout) => sum + safeNumber(workout.duration, 0), 0);
  const totalVolume = weeklyWorkouts.reduce((sum, workout) => sum + safeNumber(workout.sets, 0) * safeNumber(workout.reps, 0) * safeNumber(workout.weight, 0), 0);
  const currentWeight = measurements.length ? safeNumber(measurements[measurements.length - 1].weight, 72.5) : 72.5;
  const previousWeight = measurements.length > 1 ? safeNumber(measurements[measurements.length - 2].weight, currentWeight) : currentWeight;
  const weeklyProgress = Math.min(100, Math.max(0, Math.round((weeklyWorkouts.length / 5) * 100)));
  const goalCompletion = Math.min(100, Math.max(0, Math.round((weeklyMinutes / 210) * 100)));

  const cards = [
    { label: 'Total Workouts', value: formatNumber(workouts.length), trend: `${formatNumber(weeklyWorkouts.length)} ${translate('this week')}` },
    { label: 'Calories Burned', value: formatNumber(weeklyWorkouts.reduce((sum, workout) => sum + Math.round((safeNumber(workout.duration, 0) * 7) + (safeNumber(workout.weight, 0) * 1.5)), 0)), trend: `+12% ${translate('vs last week')}` },
    { label: 'Workout Duration', value: `${formatNumber(weeklyMinutes)} ${translate('min')}`, trend: translate('Consistent pace') },
    { label: 'Current Weight', value: `${formatNumber(currentWeight, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`, trend: `${formatNumber(previousWeight - currentWeight, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg ${translate('this period')}` },
    { label: 'Weekly Progress', value: `${formatNumber(weeklyProgress)}%`, trend: translate('Built momentum') },
    { label: 'Fitness Goal Completion', value: `${formatNumber(goalCompletion)}%`, trend: translate('Strong target rhythm') }
  ];

  summaryGrid.innerHTML = cards.map((card) => `
    <div class="summary-card">
      <span class="label">${translate(card.label)}</span>
      <div class="value">${card.value}</div>
      <div class="trend"><i data-lucide="arrow-up-right"></i> ${card.trend}</div>
    </div>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

function renderCharts(rangeDays = 30) {
  const weeklyChartElement = document.getElementById('weeklyChart');
  const workouts = getStoredWorkouts();

  if (weeklyChartElement && window.Chart) {
    if (window.fitmetricWeeklyChart) {
      window.fitmetricWeeklyChart.destroy();
    }

    const labels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => {
      const localizedDay = new Intl.DateTimeFormat(window.fitmetricI18n?.getLocale() || 'en-US', { weekday: 'short' }).format(new Date(`2024-01-${String(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(day) + 1).padStart(2, '0')}T12:00:00`));
      return localizedDay;
    });
    const totals = Array(7).fill(0);

    workouts.forEach((workout) => {
      const date = new Date(workout.date);
      const dayIndex = date.getDay();
      if (dayIndex >= 1 && dayIndex <= 6) totals[dayIndex - 1] += safeNumber(workout.duration, 0);
    });

    window.fitmetricWeeklyChart = new Chart(weeklyChartElement, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: translate('Workout Duration'),
          data: totals,
          backgroundColor: 'rgba(163,255,12,0.8)',
          borderRadius: 12
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        locale: window.fitmetricI18n ? window.fitmetricI18n.getLocale() : 'en-US',
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            grid: { color: 'rgba(255,255,255,0.06)' },
            ticks: { color: '#9ca3af' }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#9ca3af' }
          }
        }
      }
    });
  }

  const progressChartElement = document.getElementById('progressChart');
  if (progressChartElement && window.Chart) {
    if (window.fitmetricProgressChart) {
      window.fitmetricProgressChart.destroy();
    }

    const measurements = [...getStoredMeasurements()].sort((a, b) => new Date(a.date) - new Date(b.date));
    const cutoffDate = new Date(Date.now() - (rangeDays - 1) * 24 * 60 * 60 * 1000);
    const filteredMeasurements = measurements.filter((entry) => new Date(entry.date) >= cutoffDate);

    const labels = filteredMeasurements.length ? filteredMeasurements.map((item) => formatDate(item.date)) : [translate('No measurement data for this period')];
    const weights = filteredMeasurements.length ? filteredMeasurements.map((item) => safeNumber(item.weight, 0)) : [0];
    const frequencies = filteredMeasurements.length ? filteredMeasurements.map((item, index) => {
      const count = getStoredWorkouts().filter((workout) => {
        const date = new Date(workout.date);
        const itemDate = new Date(item.date);
        return date.toDateString() === itemDate.toDateString();
      }).length;
      return count || index + 1;
    }) : [0];

    window.fitmetricProgressChart = new Chart(progressChartElement, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: translate('Weight (kg)'),
            data: weights,
            borderColor: '#A3FF12',
            backgroundColor: 'rgba(163,255,12,0.15)',
            tension: 0.35,
            fill: true
          },
          {
            label: translate('Workout Frequency'),
            data: frequencies,
            borderColor: '#31d0aa',
            tension: 0.2,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        locale: window.fitmetricI18n ? window.fitmetricI18n.getLocale() : 'en-US',
        plugins: {
          legend: { labels: { color: '#ffffff', usePointStyle: true } }
        },
        scales: {
          y: {
            ticks: { color: '#9ca3af' },
            grid: { color: 'rgba(255,255,255,0.06)' }
          },
          x: {
            ticks: { color: '#9ca3af' },
            grid: { display: false }
          }
        }
      }
    });
  }
}

function renderTodayWorkoutList() {
  const list = document.getElementById('todayWorkoutList');
  if (!list) return;

  const today = new Date().toDateString();
  const workouts = getStoredWorkouts().filter((workout) => new Date(workout.date).toDateString() === today);

  if (!workouts.length) {
    list.innerHTML = `
      <div class="empty-state">
        <i data-lucide="calendar-range" style="width: 32px; height: 32px; margin: 0 auto;"></i>
        <strong>${translate('No workout logged today')}</strong>
        <span>${translate('Start your session and keep the streak alive.')}</span>
      </div>
    `;
    const badge = document.getElementById('todayStatus');
    if (badge) badge.textContent = translate('Ready');
    if (window.lucide) lucide.createIcons();
    return;
  }

  list.innerHTML = workouts.map((workout) => `
    <div class="list-item">
      <div class="item-main">
        <span class="status-dot ${workout.completed ? 'done' : 'upcoming'}"></span>
        <div>
          <strong>${escapeHtml(workout.name)}</strong>
          <div class="list-meta">${translate(workout.exerciseType)} • ${formatNumber(workout.sets)} ${translate('Sets').toLowerCase()} • ${formatNumber(workout.reps)} ${translate('Reps').toLowerCase()}</div>
        </div>
      </div>
      <span class="pill ${workout.completed ? 'done' : 'pending'}">${translate(workout.completed ? 'Done' : 'Planned')}</span>
    </div>
  `).join('');

  const badge = document.getElementById('todayStatus');
  if (badge) badge.textContent = `${formatNumber(workouts.length)} ${translate(workouts.length > 1 ? 'sessions' : 'session')}`;
}

function renderUpcomingWorkoutList() {
  const list = document.getElementById('upcomingWorkoutList');
  if (!list) return;

  const schedules = getStoredSchedules();
  const upcoming = schedules.filter((entry) => entry.status === 'upcoming' || entry.status === 'done').slice(0, 3);

  if (!upcoming.length) {
    list.innerHTML = `<div class="empty-state"><strong>${translate('No workouts scheduled')}</strong><span>${translate('Your next session will appear here.')}</span></div>`;
    return;
  }

  list.innerHTML = upcoming.map((entry) => `
    <div class="list-item">
      <div class="item-main">
        <span class="status-dot ${entry.status === 'done' ? 'done' : 'upcoming'}"></span>
        <div>
          <strong>${escapeHtml(entry.program)}</strong>
          <div class="list-meta">${translate(entry.day)} • ${entry.time}</div>
        </div>
      </div>
      <span class="pill ${entry.status === 'done' ? 'done' : 'pending'}">${translate(entry.status === 'done' ? 'Done' : 'Upcoming')}</span>
    </div>
  `).join('');
}

function renderRecentActivitiesList() {
  const list = document.getElementById('recentActivitiesList');
  if (!list) return;

  const workouts = [...getStoredWorkouts()].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);

  list.innerHTML = workouts.map((workout) => `
    <div class="list-item">
      <div class="item-main">
        <span class="status-dot ${workout.completed ? 'done' : 'upcoming'}"></span>
        <div>
          <strong>${escapeHtml(workout.name)}</strong>
          <div class="list-meta">${formatDate(workout.date)} • ${formatNumber(workout.duration)} ${translate('min')}</div>
        </div>
      </div>
      <span class="pill done">+${formatNumber(safeNumber(workout.duration, 0))} ${translate('min')}</span>
    </div>
  `).join('');
}

function renderWeeklyStatsList() {
  const list = document.getElementById('weeklyStatsList');
  if (!list) return;

  const workouts = getStoredWorkouts();
  const totalMinutes = workouts.reduce((sum, workout) => sum + safeNumber(workout.duration, 0), 0);
  const totalVolume = workouts.reduce((sum, workout) => sum + safeNumber(workout.sets, 0) * safeNumber(workout.reps, 0) * safeNumber(workout.weight, 0), 0);
  const completed = workouts.filter((workout) => workout.completed).length;
  const consistency = Math.min(100, Math.round((completed / Math.max(workouts.length, 1)) * 100));

  const items = [
    { label: 'Training Sessions', value: formatNumber(workouts.length) },
    { label: 'Total Volume', value: `${formatNumber(totalVolume)} kg` },
    { label: 'Average Duration', value: `${formatNumber(Math.round(totalMinutes / Math.max(workouts.length, 1)))} ${translate('min')}` },
    { label: 'Consistency', value: `${formatNumber(consistency)}%` }
  ];

  list.innerHTML = items.map((item) => `
    <div class="mini-stat">
      <span>${translate(item.label)}</span>
      <strong>${item.value}</strong>
    </div>
  `).join('');
}

function renderWorkoutHistory() {
  const list = document.getElementById('workoutHistoryList');
  const count = document.getElementById('historyCount');
  if (!list || !count) return;

  const workouts = [...getStoredWorkouts()].sort((a, b) => new Date(b.date) - new Date(a.date));
  const currentUser = getCurrentUser();
  count.textContent = `${formatNumber(workouts.length)} ${translate(workouts.length === 1 ? 'entry' : 'entries')}`;

  if (!workouts.length) {
    list.innerHTML = `<div class="empty-state"><strong>${translate('No workouts logged yet')}</strong><span>${translate('Your logs will appear here.')}</span></div>`;
    return;
  }

  list.innerHTML = workouts.map((workout) => `
    <div class="list-item">
      <div class="item-main">
        <span class="status-dot ${workout.completed ? 'done' : 'upcoming'}"></span>
        <div>
          <strong>${escapeHtml(workout.name)}</strong>
          <div class="list-meta">${translate(workout.exerciseType)} • ${formatNumber(workout.sets)}x${formatNumber(workout.reps)} • ${formatNumber(workout.weight)} kg • ${formatNumber(workout.duration)} ${translate('min')}</div>
        </div>
      </div>
      ${(currentUser.role === 'trainer' ? workout.createdBy === 'trainer' : workout.createdBy !== 'trainer') ? `<div class="list-actions">
        <button class="icon-btn" type="button" data-action="edit-workout" data-id="${escapeHtml(workout.id)}" title="${translate('Edit workout')}" data-i18n-title="Edit workout"><i data-lucide="pencil"></i></button>
        <button class="icon-btn" type="button" data-action="delete-workout" data-id="${escapeHtml(workout.id)}" title="${translate('Delete workout')}" data-i18n-title="Delete workout"><i data-lucide="trash-2"></i></button>
      </div>` : ''}
    </div>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

function renderScheduleList() {
  const list = document.getElementById('scheduleList');
  if (!list) return;

  const dateFilter = document.getElementById('scheduleDateFilter')?.value || '';
  const schedules = [...getStoredSchedules()]
    .filter((entry) => !dateFilter || entry.date === dateFilter)
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0) || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(a.day) - ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(b.day));

  if (!schedules.length) {
    list.innerHTML = `<div class="empty-state"><strong>${translate('No schedule items')}</strong><span>${translate('Plan your next training day.')}</span></div>`;
    return;
  }

  list.innerHTML = schedules.map((entry) => `
    <div class="list-item">
      <div class="item-main">
        <span class="status-dot ${entry.status === 'done' ? 'done' : entry.status === 'missed' ? 'missed' : 'upcoming'}"></span>
        <div>
          <strong>${escapeHtml(entry.program)}</strong>
          <div class="list-meta">${escapeHtml(entry.date || translate(entry.day))} • ${escapeHtml(entry.time)}</div>
        </div>
      </div>
      <div class="list-actions">
        <span class="pill ${entry.status}">${translate(entry.status === 'upcoming' ? 'Upcoming' : entry.status === 'done' ? 'Done' : 'Missed')}</span>
        ${entry.status !== 'done' ? `<button class="icon-btn" type="button" data-action="complete-schedule" data-id="${escapeHtml(entry.id)}" title="${translate('Mark complete')}"><i data-lucide="check"></i></button>` : ''}
        <button class="icon-btn" type="button" data-action="edit-schedule" data-id="${escapeHtml(entry.id)}" title="${translate('Edit schedule')}"><i data-lucide="pencil"></i></button>
        <button class="icon-btn" type="button" data-action="delete-schedule" data-id="${escapeHtml(entry.id)}" title="${translate('Delete schedule')}"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

function renderGoalsList() {
  const list = document.getElementById('goalList');
  if (!list) return;

  const currentUser = getCurrentUser();
  const goals = getStoredGoals();
  if (!goals.length) {
    list.innerHTML = `<div class="empty-state"><strong>${translate('No goals yet')}</strong><span>${translate('Add a goal to start tracking progress.')}</span></div>`;
    return;
  }

  list.innerHTML = goals.map((goal) => `
    <div class="list-item" style="display:block;">
      <div style="display:flex; justify-content:space-between; align-items: center; margin-bottom: 8px;">
        <strong>${escapeHtml(goal.name)}</strong>
        <span>${formatNumber(goal.progress || 0)}%</span>
      </div>
      <div style="height: 9px; background: rgba(255,255,255,0.05); border-radius: 999px; overflow: hidden;">
        <div style="height: 100%; width: ${Math.max(0, Math.min(100, safeNumber(goal.progress, 0)))}%; background: linear-gradient(90deg, #A3FF12, #d6ff78); border-radius: inherit;"></div>
      </div>
      <div class="list-meta goal-meta">${escapeHtml(goal.type || translate('Personal goal'))} · ${escapeHtml(goal.deadline || translate('No deadline'))}${goal.completed ? ` · ${translate('Completed')}` : ''}</div>
      <div class="list-actions goal-actions">
        ${goal.createdBy === 'trainer' && currentUser.role === 'member' ? `<button class="btn btn-secondary" type="button" data-action="update-goal-progress" data-id="${escapeHtml(goal.id)}">${translate('Update progress')}</button>` : ''}
        ${goal.completed || (currentUser.role === 'member' && goal.createdBy === 'trainer') ? '' : `<button class="icon-btn" type="button" data-action="complete-goal" data-id="${escapeHtml(goal.id)}" title="${translate('Mark complete')}"><i data-lucide="check"></i></button>`}
        ${goal.createdBy === 'trainer' && currentUser.role === 'member' ? '' : `<button class="icon-btn" type="button" data-action="edit-goal" data-id="${escapeHtml(goal.id)}" title="${translate('Edit goal')}"><i data-lucide="pencil"></i></button><button class="icon-btn" type="button" data-action="delete-goal" data-id="${escapeHtml(goal.id)}" title="${translate('Delete goal')}"><i data-lucide="trash-2"></i></button>`}
      </div>
    </div>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

function renderProfile() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;

  const roleBadge = document.getElementById('currentUserBadge');
  const trainerBadge = document.getElementById('trainerBadge');
  const profileRole = document.getElementById('profileRole');
  const profileName = document.getElementById('profileName');
  const profileEmail = document.getElementById('profileEmail');
  const profilePhone = document.getElementById('profilePhone');
  const welcomeSubtitle = document.getElementById('welcomeSubtitle');
  const trainerInfo = document.getElementById('trainerInfo');
  const connectedTrainerInfo = document.getElementById('connectedTrainerInfo');
  const sidebarRole = document.getElementById('sidebarRole');
  const trainerClientPicker = document.getElementById('trainerClientPicker');
  const measurementForm = document.getElementById('measurementForm');
  const addMeasurementButton = document.querySelector('[data-action="add-measurement"]');

  if (roleBadge) roleBadge.textContent = translate(currentUser.role === 'trainer' ? 'Personal Trainer' : 'Member');
  if (trainerBadge) trainerBadge.textContent = translate(currentUser.role === 'trainer' ? 'Personal Trainer' : 'Coach');
  if (profileRole) profileRole.textContent = translate(currentUser.role === 'trainer' ? 'Personal Trainer' : 'Member');
  if (sidebarRole) sidebarRole.textContent = translate(currentUser.role === 'trainer' ? 'Personal Trainer' : 'Member');
  if (profileName) profileName.textContent = `${translate('Name')}: ${currentUser.name}`;
  if (profileEmail) profileEmail.textContent = `${translate('Email')}: ${currentUser.email}`;
  if (profilePhone) profilePhone.textContent = currentUser.phone ? `${translate('Phone')}: ${currentUser.phone}` : '';
  if (welcomeSubtitle) welcomeSubtitle.textContent = translate(currentUser.role === 'trainer' ? 'Monitor client progress and adjust training goals.' : 'Keep your momentum high and hit your next milestone.');
  if (trainerInfo) trainerInfo.textContent = currentUser.role === 'trainer'
    ? translate('Select a client to manage their training, schedule, measurements, and goals.')
    : translate('Your trainer is helping you maintain a strong and sustainable training rhythm.');
  const trainer = stateCache.get('fitmetric-linked-trainer');
  if (connectedTrainerInfo) {
    connectedTrainerInfo.innerHTML = currentUser.role === 'member' && trainer
      ? `<span class="client-avatar">${trainer.photo && /^https?:\/\//i.test(trainer.photo) ? `<img src="${escapeHtml(trainer.photo)}" alt="" />` : '<i data-lucide="user-round"></i>'}</span><div><span class="list-meta">${translate('Connected trainer')}</span><strong>${escapeHtml(trainer.name)}</strong><span>${escapeHtml(trainer.email)}</span>${trainer.phone ? `<span>${translate('Phone')}: ${escapeHtml(trainer.phone)}</span>` : ''}${trainer.specialty ? `<span>${translate('Specialization')}: ${escapeHtml(trainer.specialty)}</span>` : ''}${trainer.experience ? `<span>${translate('Experience')}: ${escapeHtml(trainer.experience)}</span>` : ''}</div><button class="btn btn-secondary" type="button" data-action="disconnect-trainer" data-id="${escapeHtml(trainer.relationshipId)}">${translate('Disconnect')}</button>`
      : '';
  }
  if (window.lucide) lucide.createIcons();
  if (trainerClientPicker) trainerClientPicker.classList.toggle('hidden', currentUser.role !== 'trainer');
  if (measurementForm) measurementForm.classList.toggle('hidden', currentUser.role !== 'member');
  if (addMeasurementButton) addMeasurementButton.classList.toggle('hidden', currentUser.role !== 'member');
  document.querySelectorAll('[data-role]').forEach((element) => {
    element.classList.toggle('hidden', !element.dataset.role.split(/\s+/).includes(currentUser.role));
  });
  const notesButton = document.getElementById('addTrainerNoteButton');
  if (notesButton) notesButton.classList.toggle('hidden', currentUser.role !== 'trainer');

  const title = document.querySelector('#overviewSection h2');
  if (title) title.textContent = `${translate(currentUser.role === 'trainer' ? 'Trainer Dashboard' : 'Welcome Back! Ready to Crush Your Goals?')}`;
  renderClientPicker();
}

function renderClientPicker() {
  const select = document.getElementById('activeClientSelect');
  if (!select) return;
  const clients = getTrainerClients();
  const selectedId = getSelectedClientId();
  select.innerHTML = clients.length
    ? clients.map((client) => `<option value="${escapeHtml(client.id)}" ${client.id === selectedId ? 'selected' : ''}>${escapeHtml(client.name)}</option>`).join('')
    : `<option value="">${translate('No clients yet')}</option>`;
  select.disabled = !clients.length;
  renderSelectedClientOverview();
}

function renderSelectedClientOverview() {
  const details = document.getElementById('selectedClientDetails');
  if (!details) return;
  const client = getTrainerClients().find((entry) => entry.id === getSelectedClientId());
  if (!client) {
    details.innerHTML = `<div class="empty-state"><strong>${translate('No clients yet')}</strong><span>${translate('Add a client to view their training overview.')}</span></div>`;
    return;
  }
  const measurements = readStorage(STORAGE_KEYS.measurements, [])
    .filter((entry) => entry.trainerId === client.trainerId && entry.clientId === client.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const workouts = readStorage(STORAGE_KEYS.workouts, []).filter((entry) => entry.trainerId === client.trainerId && entry.clientId === client.id);
  const goals = readStorage(STORAGE_KEYS.goals, []).filter((entry) => entry.trainerId === client.trainerId && entry.clientId === client.id);
  details.innerHTML = `
    <div class="selected-client-details">
      <div><span class="list-meta">${translate('Name')}</span><strong>${escapeHtml(client.name)}</strong></div>
      <div><span class="list-meta">${translate('Email')}</span><strong>${escapeHtml(client.email)}</strong></div>
      <div><span class="list-meta">${translate('Phone')}</span><strong>${escapeHtml(client.phone || '—')}</strong></div>
      <div><span class="list-meta">${translate('Height')}</span><strong>${client.height ? `${formatNumber(client.height)} cm` : '—'}</strong></div>
      <div><span class="list-meta">${translate('Status')}</span><strong>${translate((client.status || 'active') === 'active' ? 'Active' : 'Inactive')}</strong></div>
      <div><span class="list-meta">${translate('Current Weight')}</span><strong>${measurements[0] ? `${formatNumber(measurements[0].weight)} kg` : translate('No data')}</strong></div>
      <div><span class="list-meta">${translate('Training Sessions')}</span><strong>${formatNumber(workouts.length)}</strong></div>
      <div><span class="list-meta">${translate('Fitness Goal')}</span><strong>${escapeHtml(goals.filter((goal) => !goal.completed).map((goal) => goal.name).join(', ') || translate('Not set'))}</strong></div>
      <div><span class="list-meta">${translate('Joined')}</span><strong>${escapeHtml(client.joinedAt || '—')}</strong></div>
      <div><span class="list-meta">${translate('Goals')}</span><strong>${formatNumber(goals.filter((goal) => goal.completed).length)} / ${formatNumber(goals.length)} ${translate('completed')}</strong></div>
    </div>
  `;
}

function renderClientList() {
  const list = document.getElementById('clientList');
  if (!list) return;
  const search = (document.getElementById('clientSearch')?.value || '').trim().toLowerCase();
  const status = document.getElementById('clientStatusFilter')?.value || 'all';
  const clients = getTrainerClients().filter((client) => {
    const matchesText = `${client.name} ${client.email}`.toLowerCase().includes(search);
    const matchesStatus = status === 'all' || status === 'active';
    return matchesText && matchesStatus;
  });
  const invitations = readStorage(STORAGE_KEYS.invitations, []).filter((invitation) => {
    const matchesText = `${invitation.name} ${invitation.email}`.toLowerCase().includes(search);
    const matchesStatus = status === 'all' || invitation.status === status;
    return matchesText && matchesStatus;
  });
  if (!clients.length && !invitations.length) {
    list.innerHTML = `<div class="empty-state"><strong>${translate('No clients found')}</strong><span>${translate('Add a client or adjust your search filters.')}</span></div>`;
    return;
  }
  list.innerHTML = [
    ...clients.map((client) => `
    <article class="client-card">
      <div class="client-card-info">
        <span class="client-avatar">${client.photo && /^https?:\/\//i.test(client.photo) ? `<img src="${escapeHtml(client.photo)}" alt="" />` : '<i data-lucide="user-round"></i>'}</span>
        <div>
          <strong>${escapeHtml(client.name)}</strong>
          <div class="list-meta">${escapeHtml(client.email)}${client.phone ? ` · ${escapeHtml(client.phone)}` : ''}</div>
          <span class="pill done">${translate('Active')}</span>
        </div>
      </div>
      <div class="list-actions">
        <button class="btn btn-secondary" type="button" data-action="select-client" data-id="${escapeHtml(client.id)}">${translate('View details')}</button>
        <button class="btn btn-secondary" type="button" data-action="disconnect-client" data-id="${escapeHtml(client.id)}">${translate('Disconnect')}</button>
      </div>
    </article>
  `),
    ...invitations.map((invitation) => `
      <article class="client-card">
        <div class="client-card-info">
          <span class="client-avatar"><i data-lucide="mail"></i></span>
          <div>
            <strong>${escapeHtml(invitation.name || invitation.email || translate('Invitation code'))}</strong>
            <div class="list-meta">${escapeHtml(invitation.email || translate('Share this code with a member'))}</div>
            ${invitation.code ? `<div class="list-meta">${translate('Invitation code')}: <strong>${escapeHtml(invitation.code)}</strong></div>` : ''}
            <span class="pill ${invitation.status === 'rejected' ? 'missed' : 'pending'}">${translate(invitation.status === 'rejected' ? 'Rejected' : 'Pending')}</span>
          </div>
        </div>
        ${invitation.code ? `<button class="btn btn-secondary" type="button" data-action="copy-invite" data-code="${escapeHtml(invitation.code)}">${translate('Copy code')}</button>` : ''}
      </article>
    `)
  ].join('');
  if (window.lucide) lucide.createIcons();
}

function renderMeasurementHistory() {
  const list = document.getElementById('measurementHistory');
  if (!list) return;
  const measurements = [...getStoredMeasurements()].sort((a, b) => new Date(b.date) - new Date(a.date));
  const currentUser = getCurrentUser();
  list.innerHTML = measurements.length ? measurements.map((entry) => `
    <div class="list-item">
      <div>
        <strong>${formatDate(entry.date)} · ${formatNumber(entry.weight)} kg</strong>
        <div class="list-meta">${translate('Height')}: ${entry.height ? `${formatNumber(entry.height)} cm` : '—'} · ${translate('Waist')}: ${entry.waist ? `${formatNumber(entry.waist)} cm` : '—'} · ${translate('Chest')}: ${entry.chest ? `${formatNumber(entry.chest)} cm` : '—'} · ${translate('Arm')}: ${entry.arm ? `${formatNumber(entry.arm)} cm` : '—'} · ${translate('Thigh')}: ${entry.thigh ? `${formatNumber(entry.thigh)} cm` : '—'} · ${translate('Body Fat')}: ${entry.fat ? `${formatNumber(entry.fat)}%` : '—'}</div>
      </div>
      ${currentUser.role === 'member' ? `<div class="list-actions">
        <button class="icon-btn" type="button" data-action="edit-measurement" data-id="${escapeHtml(entry.id)}" title="${translate('Edit measurement')}"><i data-lucide="pencil"></i></button>
        <button class="icon-btn" type="button" data-action="delete-measurement" data-id="${escapeHtml(entry.id)}" title="${translate('Delete measurement')}"><i data-lucide="trash-2"></i></button>
      </div>` : ''}
    </div>
  `).join('') : `<div class="empty-state"><strong>${translate('No measurements yet')}</strong><span>${translate('Your measurement history will appear here.')}</span></div>`;
  if (window.lucide) lucide.createIcons();
}

function renderTrainerNotes() {
  const list = document.getElementById('trainerNotesList');
  if (!list) return;
  const currentUser = getCurrentUser();
  const notes = readStorage(STORAGE_KEYS.notes, []).filter((note) => currentUser.role === 'trainer'
    ? note.trainerId === currentUser.id && note.clientId === getSelectedClientId()
    : note.userId === currentUser.id);
  list.innerHTML = notes.length ? notes.sort((a, b) => new Date(b.date) - new Date(a.date)).map((note) => `
    <article class="list-item note-item">
      <div>
        <strong>${escapeHtml(note.title)}</strong>
        ${currentUser.role === 'member' ? `<div class="list-meta">${translate('From')}: ${escapeHtml(note.trainerName || translate('Personal Trainer'))}</div>` : ''}
        <p>${escapeHtml(note.evaluation || note.text)}</p>
        ${note.recommendation ? `<div class="note-recommendation"><strong>${translate('Next workout recommendation')}:</strong> ${escapeHtml(note.recommendation)}</div>` : ''}
        ${note.target ? `<div class="note-recommendation"><strong>${translate('Target')}:</strong> ${escapeHtml(note.target)}</div>` : ''}
        <div class="list-meta">${formatDate(note.date)} · ${translate('Trainer note')} · ${translate(note.readAt ? 'Read' : 'New')}</div>
      </div>
      <div class="list-actions">
        ${currentUser.role === 'trainer' ? `<button class="icon-btn" type="button" data-action="edit-note" data-id="${escapeHtml(note.id)}" title="${translate('Edit note')}"><i data-lucide="pencil"></i></button><button class="icon-btn" type="button" data-action="delete-note" data-id="${escapeHtml(note.id)}" title="${translate('Delete note')}"><i data-lucide="trash-2"></i></button>` : ''}
        ${currentUser.role === 'member' && !note.readAt ? `<button class="btn btn-secondary" type="button" data-action="read-note" data-id="${escapeHtml(note.id)}">${translate('Mark as read')}</button>` : ''}
      </div>
    </article>
  `).join('') : `<div class="empty-state"><strong>${translate('No trainer notes yet')}</strong><span>${translate('Trainer feedback will appear here.')}</span></div>`;
  if (window.lucide) lucide.createIcons();
  renderMemberInvitations();
}

function renderMemberInvitations() {
  const list = document.getElementById('memberInvitationsList');
  if (!list) return;
  const invitations = readStorage(STORAGE_KEYS.invitations, []);
  list.innerHTML = invitations.length ? invitations.map((invitation) => `
    <article class="list-item">
      <div>
        <strong>${escapeHtml(invitation.trainerName)}</strong>
        <div class="list-meta">${escapeHtml(invitation.trainerEmail)} · ${formatDate(invitation.createdAt)}</div>
      </div>
      <div class="list-actions">
        <button class="btn btn-primary" type="button" data-action="respond-invite" data-id="${escapeHtml(invitation.id)}" data-accept="true">${translate('Accept')}</button>
        <button class="btn btn-secondary" type="button" data-action="respond-invite" data-id="${escapeHtml(invitation.id)}" data-accept="false">${translate('Reject')}</button>
      </div>
    </article>
  `).join('') : `<div class="empty-state"><strong>${translate('No pending invitations')}</strong><span>${translate('Trainer invitations will appear here.')}</span></div>`;
}

function renderNotifications() {
  const list = document.getElementById('notificationsList');
  const count = document.getElementById('notificationCount');
  if (!list || !count) return;
  const notifications = readStorage(STORAGE_KEYS.notifications, []);
  const unread = notifications.filter((notification) => !notification.readAt).length;
  count.textContent = formatNumber(unread);
  list.innerHTML = notifications.length ? notifications.slice(0, 8).map((notification) => `
    <div class="list-item notification-item ${notification.readAt ? '' : 'unread'}">
      <div>
        <strong>${escapeHtml(notification.message)}</strong>
        <div class="list-meta">${formatDate(notification.createdAt)}</div>
      </div>
      ${notification.readAt ? '' : `<button class="btn btn-secondary" type="button" data-action="read-notification" data-id="${escapeHtml(notification.id)}">${translate('Mark as read')}</button>`}
    </div>
  `).join('') : `<div class="empty-state"><strong>${translate('No notifications yet')}</strong><span>${translate('Updates from your trainer and members will appear here.')}</span></div>`;
}

function refreshDashboardLanguage() {
  renderProfile();
  renderSummaryCards();
  const activeFilter = document.querySelector('#progressFilters .filter-btn.active');
  renderCharts(activeFilter ? Number(activeFilter.dataset.range || 30) : 30);
  renderTodayWorkoutList();
  renderUpcomingWorkoutList();
  renderRecentActivitiesList();
  renderWeeklyStatsList();
  renderWorkoutHistory();
  renderScheduleList();
  renderGoalsList();
  renderClientList();
  renderMeasurementHistory();
  renderTrainerNotes();
  renderNotifications();
  if (window.lucide) lucide.createIcons();
}

function openDataDialog(title, fields, onSave) {
  const dialog = document.getElementById('dataDialog');
  const form = document.getElementById('dataDialogForm');
  const fieldContainer = document.getElementById('dataDialogFields');
  const error = document.getElementById('dataDialogError');
  document.getElementById('dataDialogTitle').textContent = translate(title);
  error.classList.remove('show');
  fieldContainer.innerHTML = fields.map((field) => {
    const value = field.value == null ? '' : field.value;
    return `
      <div class="form-field">
        <label for="dialog-${escapeHtml(field.name)}">${translate(field.label)}</label>
        ${field.multiline
          ? `<textarea id="dialog-${escapeHtml(field.name)}" name="${escapeHtml(field.name)}" rows="3" ${field.required ? 'required' : ''}>${escapeHtml(value)}</textarea>`
          : `<input id="dialog-${escapeHtml(field.name)}" name="${escapeHtml(field.name)}" type="${field.type || 'text'}" value="${escapeHtml(value)}" ${field.required ? 'required' : ''} ${field.min != null ? `min="${field.min}"` : ''} ${field.step ? `step="${field.step}"` : ''} ${field.max != null ? `max="${field.max}"` : ''} />`}
      </div>
    `;
  }).join('');
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const result = await onSave(data);
      if (result === false) return;
      dialog.close();
    } catch (submitError) {
      showLocalizedError(error, submitError.message);
    } finally {
      submitButton.disabled = false;
    }
  };
  if (!dialog.open) dialog.showModal();
  if (window.lucide) lucide.createIcons();
}

function refreshDashboardData() {
  renderProfile();
  renderSummaryCards();
  renderCharts();
  renderTodayWorkoutList();
  renderUpcomingWorkoutList();
  renderRecentActivitiesList();
  renderWeeklyStatsList();
  renderWorkoutHistory();
  renderScheduleList();
  renderGoalsList();
  renderClientList();
  renderMeasurementHistory();
  renderTrainerNotes();
  renderNotifications();
}

function saveCollectionRecord(key, record, recordId) {
  const allRecords = [...readStorage(key, [])];
  const currentUser = getCurrentUser();
  if (recordId) {
    const index = allRecords.findIndex((entry) => entry.id === recordId && (
      currentUser.role === 'trainer'
        ? entry.trainerId === currentUser.id && entry.clientId === getSelectedClientId()
        : entry.userId === currentUser.id && entry.createdBy !== 'trainer'
    ));
    if (index < 0) return false;
    allRecords[index] = { ...allRecords[index], ...record };
  } else {
    allRecords.push(record);
  }
  persistStorage(key, allRecords);
  return true;
}

function removeCollectionRecord(key, recordId) {
  const currentUser = getCurrentUser();
  const records = readStorage(key, []);
  const filtered = records.filter((entry) => !(entry.id === recordId && (
    currentUser.role === 'trainer'
      ? entry.trainerId === currentUser.id && entry.clientId === getSelectedClientId()
      : entry.userId === currentUser.id && entry.createdBy !== 'trainer'
  )));
  if (filtered.length === records.length) return false;
  persistStorage(key, filtered);
  return true;
}

function requireSelectedClient() {
  if (getCurrentUser().role !== 'trainer' || getSelectedClientId()) return true;
  showToast('dashboardToast', 'Connect a member before managing client data.');
  return false;
}

function openClientDialog() {
  openDataDialog('Add Client', [
    { name: 'email', label: 'Member Email', type: 'email', required: true }
  ], async (data) => {
    const result = await apiRequest('/api/invitations', {
      method: 'POST',
      body: { email: data.email.trim().toLowerCase() }
    });
    await refreshServerState();
    showToast('dashboardToast', `Invitation created. Code: ${result.invitation.code}`);
  });
}

function openInviteCodeDialog() {
  openDataDialog('Create Invite Code', [
    { name: 'email', label: 'Member Email (optional)', type: 'email' }
  ], async (data) => {
    const result = await apiRequest('/api/invitations', {
      method: 'POST',
      body: { email: data.email.trim().toLowerCase() }
    });
    await refreshServerState();
    showToast('dashboardToast', `Invitation code: ${result.invitation.code}`);
  });
}

function openGoalDialog(goal) {
  if (!requireSelectedClient()) return;
  const currentUser = getCurrentUser();
  const editing = Boolean(goal);
  openDataDialog(editing ? 'Edit Goal' : 'Add Goal', [
    { name: 'name', label: 'Goal', value: goal?.name, required: true },
    { name: 'type', label: 'Goal Type', value: goal?.type || '', required: true },
    { name: 'target', label: 'Target Value', value: goal?.target || '', required: true },
    { name: 'deadline', label: 'Deadline', type: 'date', value: goal?.deadline || '' },
    { name: 'progress', label: 'Progress (%)', type: 'number', min: 0, max: 100, value: goal?.progress || 0, required: true }
  ], (data) => {
    const existing = readStorage(STORAGE_KEYS.goals, []);
    const clientId = currentUser.role === 'trainer' ? getSelectedClientId() : '';
    const client = currentUser.role === 'trainer' ? getTrainerClients().find((entry) => entry.id === clientId) : null;
    const saved = {
      ...goal,
      id: goal?.id || createId('goal'),
      name: data.name.trim(),
      type: data.type.trim(),
      target: data.target.trim(),
      deadline: data.deadline,
      progress: Math.max(0, Math.min(100, safeNumber(data.progress, 0))),
      completed: Boolean(goal?.completed),
      createdBy: currentUser.role === 'trainer' ? 'trainer' : 'member',
      userId: currentUser.role === 'trainer' ? client?.userId || '' : currentUser.id,
      trainerId: currentUser.role === 'trainer' ? currentUser.id : undefined,
      clientId: currentUser.role === 'trainer' ? clientId : undefined
    };
    if (goal) {
      const idx = existing.findIndex((entry) => entry.id === goal.id && (
        currentUser.role === 'trainer'
          ? entry.trainerId === currentUser.id && entry.clientId === clientId
          : entry.userId === currentUser.id && entry.createdBy !== 'trainer'
      ));
      if (idx < 0) return false;
      existing[idx] = { ...existing[idx], ...saved };
      persistStorage(STORAGE_KEYS.goals, existing);
    } else {
      existing.push(saved);
      persistStorage(STORAGE_KEYS.goals, existing);
    }
    renderGoalsList();
    renderSummaryCards();
    showToast('dashboardToast', 'Goal saved successfully.');
  });
}

async function saveTrainerNote(data, note = null) {
  const payload = {
    title: data.title.trim(),
    evaluation: data.evaluation.trim(),
    recommendation: data.recommendation.trim(),
    target: data.target.trim()
  };
  if (note) {
    await apiRequest(`/api/notes/${encodeURIComponent(note.id)}`, { method: 'PATCH', body: payload });
  } else {
    if (!requireSelectedClient()) return false;
    payload.clientId = getSelectedClientId();
    await apiRequest('/api/notes', { method: 'POST', body: payload });
  }
  await refreshServerState();
  showToast('dashboardToast', note ? 'Note updated.' : 'Note saved.');
}

function startEditMeasurement(measurement) {
  document.getElementById('measurementId').value = measurement.id;
  document.getElementById('bodyDate').value = measurement.date.slice(0, 10);
  ['Weight', 'Waist', 'Chest', 'Height', 'Arm', 'Thigh', 'Fat'].forEach((name) => {
    const key = name.toLowerCase();
    const input = document.getElementById(`body${name}`);
    if (input) input.value = measurement[key] || '';
  });
  document.getElementById('cancelMeasurementEdit').classList.remove('hidden');
  document.getElementById('measurementForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function attachWorkoutActions() {
  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    const currentUser = getCurrentUser();
    const trainerOnlyActions = [
      'add-client', 'create-invite-code', 'select-client', 'disconnect-client',
      'invite-client', 'edit-selected-client', 'add-note', 'edit-note', 'delete-note', 'edit-schedule',
      'delete-schedule', 'complete-schedule'
    ];
    if (trainerOnlyActions.includes(action) && currentUser.role !== 'trainer') return;

    if (action === 'add-measurement') {
      if (currentUser.role !== 'member') return;
      if (!requireSelectedClient()) return;
      document.getElementById('measurementForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.getElementById('bodyDate').focus();
    } else if (action === 'edit-selected-client') {
      openDataDialog('Add Trainer Note', [
        { name: 'title', label: 'Title', required: true },
        { name: 'evaluation', label: 'Training Evaluation', multiline: true, required: true },
        { name: 'recommendation', label: 'Next Workout Recommendation', multiline: true },
        { name: 'target', label: 'Target', multiline: true }
      ], (data) => saveTrainerNote(data));
    } else if (action === 'add-client') {
      openClientDialog();
    } else if (action === 'create-invite-code') {
      openInviteCodeDialog();
    } else if (action === 'select-client') {
      setSelectedClientId(id);
      renderClientPicker();
      refreshDashboardData();
      document.querySelector('[data-section="overview"][data-role*="trainer"]').click();
    } else if (action === 'disconnect-client' || action === 'disconnect-trainer') {
      if (!window.confirm(translate('Disconnect this trainer-member connection? Their history will be preserved.'))) return;
      try {
        await apiRequest(`/api/relationships/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (currentUser.role === 'trainer' && getSelectedClientId() === id) {
          localStorage.removeItem(`fitmetric-selected-client-${currentUser.id}`);
        }
        await refreshServerState();
        showToast('dashboardToast', 'Account connection ended.');
      } catch (error) {
        showToast('dashboardToast', error.message);
      }
    } else if (action === 'copy-invite') {
      try {
        await navigator.clipboard.writeText(target.dataset.code);
        showToast('dashboardToast', 'Invitation code copied.');
      } catch (error) {
        showToast('dashboardToast', 'Could not copy the invitation code.');
      }
    } else if (action === 'respond-invite') {
      try {
        await apiRequest(`/api/invitations/${encodeURIComponent(id)}/respond`, {
          method: 'POST',
          body: { accept: target.dataset.accept === 'true' }
        });
        await refreshServerState();
        showToast('dashboardToast', target.dataset.accept === 'true' ? 'Invitation accepted.' : 'Invitation rejected.');
      } catch (error) {
        showToast('dashboardToast', error.message);
      }
    } else if (action === 'read-notification') {
      try {
        await apiRequest(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: {} });
        await refreshServerState();
      } catch (error) {
        showToast('dashboardToast', error.message);
      }
    } else if (action === 'read-note') {
      try {
        await apiRequest(`/api/notes/${encodeURIComponent(id)}/read`, { method: 'POST', body: {} });
        await refreshServerState();
      } catch (error) {
        showToast('dashboardToast', error.message);
      }
    } else if (action === 'edit-workout') {
      const workout = getStoredWorkouts().find((entry) => entry.id === id);
      if (!workout) return;
      const form = document.getElementById('workoutForm');
      document.getElementById('workoutId').value = workout.id;
      document.getElementById('exerciseType').value = workout.exerciseType;
      document.getElementById('exerciseName').value = workout.name;
      document.getElementById('sets').value = workout.sets;
      document.getElementById('reps').value = workout.reps;
      document.getElementById('weight').value = workout.weight;
      document.getElementById('duration').value = workout.duration;
      document.getElementById('workoutNotes').value = workout.notes || '';
      document.getElementById('workoutCompleted').checked = Boolean(workout.completed);
      document.getElementById('cancelWorkoutEdit').classList.remove('hidden');
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'delete-workout') {
      if (!window.confirm(translate('Delete this workout?'))) return;
      removeCollectionRecord(STORAGE_KEYS.workouts, id);
      refreshDashboardData();
      showToast('dashboardToast', 'Workout removed.');
    } else if (action === 'add-goal') {
      openGoalDialog();
    } else if (action === 'edit-goal') {
      const goal = getStoredGoals().find((entry) => entry.id === id);
      if (goal && (currentUser.role === 'trainer' || goal.createdBy !== 'trainer')) openGoalDialog(goal);
    } else if (action === 'delete-goal') {
      const goals = readStorage(STORAGE_KEYS.goals, []);
      const goal = getStoredGoals().find((entry) => entry.id === id);
      if (!goal || (currentUser.role === 'member' && goal.createdBy === 'trainer')) return;
      if (!window.confirm(translate('Delete this goal?'))) return;
      persistStorage(STORAGE_KEYS.goals, goals.filter((entry) => entry.id !== id));
      renderGoalsList();
    } else if (action === 'complete-goal' || action === 'update-goal-progress') {
      const goal = getStoredGoals().find((entry) => entry.id === id);
      if (!goal) return;
      if (action === 'complete-goal') {
        if (goal.createdBy === 'trainer' && currentUser.role === 'member') return;
        const goals = readStorage(STORAGE_KEYS.goals, []);
        persistStorage(STORAGE_KEYS.goals, goals.map((entry) => entry.id === id ? { ...entry, completed: true, progress: 100 } : entry));
        renderGoalsList();
      } else {
        if (goal.createdBy !== 'trainer' || currentUser.role !== 'member') return;
        openDataDialog('Update Goal Progress', [
          { name: 'progress', label: 'Progress (%)', type: 'number', min: 0, max: 100, value: goal.progress, required: true }
        ], (data) => {
          const goals = readStorage(STORAGE_KEYS.goals, []);
          persistStorage(STORAGE_KEYS.goals, goals.map((entry) => entry.id === id && entry.userId === currentUser.id
            ? { ...entry, progress: Math.min(100, safeNumber(data.progress, 0)), completed: safeNumber(data.progress, 0) >= 100 }
            : entry));
          renderGoalsList();
        });
      }
    } else if (action === 'edit-measurement') {
      const measurement = getStoredMeasurements().find((entry) => entry.id === id);
      if (measurement) startEditMeasurement(measurement);
    } else if (action === 'delete-measurement') {
      if (!window.confirm(translate('Delete this measurement?'))) return;
      removeCollectionRecord(STORAGE_KEYS.measurements, id);
      refreshDashboardData();
    } else if (action === 'edit-schedule') {
      const entry = getStoredSchedules().find((schedule) => schedule.id === id);
      if (!entry) return;
      document.getElementById('scheduleId').value = entry.id;
      document.getElementById('scheduleDay').value = entry.day;
      document.getElementById('scheduleDate').value = entry.date || '';
      document.getElementById('scheduleTime').value = entry.time;
      document.getElementById('scheduleProgram').value = entry.program;
      document.getElementById('scheduleStatus').value = entry.status;
      document.querySelector('[data-section="schedule"]').click();
    } else if (action === 'delete-schedule') {
      if (!window.confirm(translate('Delete this schedule?'))) return;
      removeCollectionRecord(STORAGE_KEYS.schedules, id);
      refreshDashboardData();
    } else if (action === 'complete-schedule') {
      const schedules = readStorage(STORAGE_KEYS.schedules, []);
      persistStorage(STORAGE_KEYS.schedules, schedules.map((entry) => entry.id === id && entry.trainerId === currentUser.id && entry.clientId === getSelectedClientId()
        ? { ...entry, status: 'done' }
        : entry));
      refreshDashboardData();
    } else if (action === 'edit-profile') {
      openDataDialog('Edit Profile', [
        { name: 'name', label: 'Full Name', value: currentUser.name, required: true },
        { name: 'email', label: 'Email', type: 'email', value: currentUser.email, required: true },
        { name: 'photo', label: 'Profile Photo URL', type: 'url', value: currentUser.photo || '' },
        { name: 'phone', label: 'Phone', value: currentUser.phone || '' },
        { name: 'height', label: 'Height (cm)', type: 'number', min: 1, step: '0.1', value: currentUser.height || '' },
        { name: 'specialty', label: 'Specialization', value: currentUser.specialty || '' },
        { name: 'experience', label: 'Experience', value: currentUser.experience || '' },
        { name: 'password', label: 'New Password (optional)', type: 'password', value: '' }
      ], async (data) => {
        await apiRequest('/api/profile', {
          method: 'PATCH',
          body: {
            name: data.name.trim(),
            email: data.email.trim().toLowerCase(),
            photo: data.photo.trim(),
            phone: data.phone.trim(),
            height: data.height ? safeNumber(data.height, 0) : null,
            specialty: data.specialty.trim(),
            experience: data.experience.trim(),
            password: data.password
          }
        });
        await refreshServerState();
        showToast('dashboardToast', 'Profile updated.');
      });
    } else if (action === 'add-note') {
      if (!requireSelectedClient()) return;
      openDataDialog('Add Trainer Note', [
        { name: 'title', label: 'Title', required: true },
        { name: 'evaluation', label: 'Training Evaluation', multiline: true, required: true },
        { name: 'recommendation', label: 'Next Workout Recommendation', multiline: true },
        { name: 'target', label: 'Target', multiline: true }
      ], (data) => saveTrainerNote(data));
    } else if (action === 'edit-note') {
      const note = readStorage(STORAGE_KEYS.notes, []).find((entry) => entry.id === id);
      if (!note || currentUser.role !== 'trainer' || note.trainerId !== currentUser.id) return;
      openDataDialog('Edit Trainer Note', [
        { name: 'title', label: 'Title', value: note.title, required: true },
        { name: 'evaluation', label: 'Training Evaluation', multiline: true, value: note.evaluation || note.text, required: true },
        { name: 'recommendation', label: 'Next Workout Recommendation', multiline: true, value: note.recommendation },
        { name: 'target', label: 'Target', multiline: true, value: note.target }
      ], (data) => saveTrainerNote(data, note));
    } else if (action === 'delete-note') {
      if (!window.confirm(translate('Delete this trainer note?'))) return;
      try {
        await apiRequest(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refreshServerState();
        showToast('dashboardToast', 'Note deleted.');
      } catch (error) {
        showToast('dashboardToast', error.message);
      }
    }
  });

  document.querySelectorAll('[data-dialog-close]').forEach((button) => {
    button.addEventListener('click', () => document.getElementById('dataDialog').close());
  });
}

async function initDashboardPage() {
  try {
    const state = await apiRequest('/api/state');
    cacheServerState(state);
  } catch (error) {
    if (error.message.includes('sign in') || error.message.includes('session has expired')) {
      window.location.href = 'auth.html';
      return;
    }
    showToast('dashboardToast', error.message);
    return;
  }
  const currentUser = getCurrentUser();

  renderProfile();
  refreshDashboardData();
  window.addEventListener('fitmetric:languageChanged', refreshDashboardLanguage);

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', body: {} });
      clearCurrentUser();
      window.location.href = 'auth.html';
    } catch (error) {
      showToast('dashboardToast', error.message);
    }
  });

  const navigate = (section) => {
    const button = document.querySelector(`.nav-item[data-section="${section}"][data-role~="${currentUser.role}"]`);
    if (button) button.click();
  };
  document.getElementById('quickWorkoutBtn')?.addEventListener('click', () => {
    navigate('workouts');
    document.getElementById('exerciseName').focus();
  });
  document.getElementById('quickClientBtn')?.addEventListener('click', () => openClientDialog());
  document.getElementById('addWorkoutButton')?.addEventListener('click', () => {
    navigate('workouts');
    document.getElementById('exerciseName').focus();
  });

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.classList.contains('hidden')) return;
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      document.querySelectorAll('.dashboard-section').forEach((panel) => {
        panel.classList.toggle('hidden', panel.id !== `${button.dataset.section}Section`);
      });
      if (button.dataset.section === 'progress' && window.fitmetricProgressChart) {
        requestAnimationFrame(() => window.fitmetricProgressChart.resize());
      }
    });
  });

  document.getElementById('activeClientSelect').addEventListener('change', (event) => {
    setSelectedClientId(event.target.value);
    refreshDashboardData();
  });
  document.getElementById('clientSearch').addEventListener('input', renderClientList);
  document.getElementById('clientStatusFilter').addEventListener('change', renderClientList);
  document.getElementById('scheduleDateFilter').addEventListener('change', renderScheduleList);
  document.getElementById('redeemInvitationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = document.getElementById('invitationCode').value.trim();
    if (!code) return;
    try {
      await apiRequest('/api/invitations/redeem', { method: 'POST', body: { code } });
      event.currentTarget.reset();
      await refreshServerState();
      showToast('dashboardToast', 'Invitation accepted.');
    } catch (error) {
      showToast('dashboardToast', error.message);
    }
  });

  document.getElementById('workoutForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !requireSelectedClient()) return;
    const workoutId = document.getElementById('workoutId').value;
    const userId = currentUser.role === 'trainer'
      ? getTrainerClients().find((client) => client.id === getSelectedClientId())?.userId || ''
      : currentUser.id;
    let workout = {
      id: workoutId || createId('workout'),
      name: document.getElementById('exerciseName').value.trim(),
      exerciseType: document.getElementById('exerciseType').value,
      sets: safeNumber(document.getElementById('sets').value, 0),
      reps: safeNumber(document.getElementById('reps').value, 0),
      weight: safeNumber(document.getElementById('weight').value, 0),
      duration: safeNumber(document.getElementById('duration').value, 0),
      notes: document.getElementById('workoutNotes').value.trim(),
      completed: document.getElementById('workoutCompleted').checked,
      date: new Date().toISOString(),
      createdBy: currentUser.role,
      userId,
      ...(currentUser.role === 'trainer' ? { trainerId: currentUser.id, clientId: getSelectedClientId() } : {})
    };
    if (currentUser.role === 'member') workout = attachLinkedClient(workout, currentUser.id);
    if (!saveCollectionRecord(STORAGE_KEYS.workouts, workout, workoutId)) {
      showToast('dashboardToast', 'Could not save workout. Please try again.');
      return;
    }
    form.reset();
    document.getElementById('workoutId').value = '';
    document.getElementById('workoutCompleted').checked = true;
    document.getElementById('cancelWorkoutEdit').classList.add('hidden');
    refreshDashboardData();
    showToast('dashboardToast', 'Workout saved successfully.');
  });
  document.getElementById('cancelWorkoutEdit').addEventListener('click', () => {
    document.getElementById('workoutForm').reset();
    document.getElementById('workoutId').value = '';
    document.getElementById('workoutCompleted').checked = true;
    document.getElementById('cancelWorkoutEdit').classList.add('hidden');
  });

  document.getElementById('scheduleForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity() || !requireSelectedClient()) return;
    const id = document.getElementById('scheduleId').value;
    const client = currentUser.role === 'trainer' ? getTrainerClients().find((entry) => entry.id === getSelectedClientId()) : null;
    let schedule = {
      id: id || createId('schedule'),
      day: document.getElementById('scheduleDay').value,
      date: document.getElementById('scheduleDate').value,
      time: document.getElementById('scheduleTime').value,
      program: document.getElementById('scheduleProgram').value.trim(),
      status: document.getElementById('scheduleStatus').value,
      createdBy: currentUser.role,
      userId: currentUser.role === 'trainer' ? client?.userId || '' : currentUser.id,
      ...(currentUser.role === 'trainer' ? { trainerId: currentUser.id, clientId: client.id } : {})
    };
    if (currentUser.role === 'member') schedule = attachLinkedClient(schedule, currentUser.id);
    if (!saveCollectionRecord(STORAGE_KEYS.schedules, schedule, id)) return;
    event.currentTarget.reset();
    document.getElementById('scheduleId').value = '';
    refreshDashboardData();
    showToast('dashboardToast', 'Schedule updated.');
  });

  document.getElementById('measurementForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity() || !requireSelectedClient()) return;
    const id = document.getElementById('measurementId').value;
    const client = currentUser.role === 'trainer' ? getTrainerClients().find((entry) => entry.id === getSelectedClientId()) : null;
    let measurement = {
      id: id || createId('measure'),
      weight: safeNumber(document.getElementById('bodyWeight').value, 0),
      height: safeNumber(document.getElementById('bodyHeight').value, 0) || null,
      waist: safeNumber(document.getElementById('bodyWaist').value, 0) || null,
      chest: safeNumber(document.getElementById('bodyChest').value, 0) || null,
      arm: safeNumber(document.getElementById('bodyArm').value, 0) || null,
      thigh: safeNumber(document.getElementById('bodyThigh').value, 0) || null,
      fat: safeNumber(document.getElementById('bodyFat').value, 0) || null,
      date: new Date(`${document.getElementById('bodyDate').value}T12:00:00`).toISOString(),
      createdBy: currentUser.role,
      userId: currentUser.role === 'trainer' ? client?.userId || '' : currentUser.id,
      ...(currentUser.role === 'trainer' ? { trainerId: currentUser.id, clientId: client.id } : {})
    };
    if (currentUser.role === 'member') measurement = attachLinkedClient(measurement, currentUser.id);
    if (!saveCollectionRecord(STORAGE_KEYS.measurements, measurement, id)) return;
    event.currentTarget.reset();
    document.getElementById('measurementId').value = '';
    document.getElementById('cancelMeasurementEdit').classList.add('hidden');
    refreshDashboardData();
    showToast('dashboardToast', 'Measurement saved.');
  });
  document.getElementById('cancelMeasurementEdit').addEventListener('click', () => {
    document.getElementById('measurementForm').reset();
    document.getElementById('measurementId').value = '';
    document.getElementById('cancelMeasurementEdit').classList.add('hidden');
  });

  document.getElementById('progressFilters').addEventListener('click', (event) => {
    const button = event.target.closest('.filter-btn');
    if (!button) return;
    document.querySelectorAll('.filter-btn').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    renderCharts(Number(button.dataset.range || 7));
  });

  attachWorkoutActions();
  document.querySelector('.nav-item.active')?.click();
  if (currentUser.role === 'trainer') {
    document.querySelector('[data-section="overview"][data-role*="trainer"]')?.classList.add('active');
  }
  document.getElementById('bodyDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('scheduleDate').value = new Date().toISOString().slice(0, 10);
  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      refreshServerState().catch((error) => console.error('Live data refresh failed:', error));
    }
  }, 10000);
}

document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname.toLowerCase();

  if (path.includes('auth.html')) {
    initAuthPage();
  }

  if (path.includes('dashboard.html')) {
    initDashboardPage();
  }

  if (path.endsWith('/index.html') || path.endsWith('/') || path === '') {
    initLandingPage();
  }
});
