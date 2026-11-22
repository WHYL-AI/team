const API = 'https://zfwfzuasswjmvgonluag.supabase.co/functions/v1/team';
const TOKEN_KEY = 'whyl-team-token';
const EMAIL_KEY = 'whyl-team-email';
const INSTALL_DISMISSED_KEY = 'whyl-team-install-dismissed';
const REFRESH_MS = 20000;

const app = document.getElementById('app');
let token = localStorage.getItem(TOKEN_KEY);
let state = null;
let tab = 'mine';
let installPrompt = null;
let refreshTimer = null;

const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(navigator.userAgent);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && path !== 'enter') {
    signOut();
    throw new Error('Sign in again.');
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

function signOut() {
  token = null;
  state = null;
  localStorage.removeItem(TOKEN_KEY);
  stopRefresh();
  renderEmail();
}

function firstName(member) {
  return member.name.split(' ')[0];
}

function isToday(iso) {
  return iso && new Date(iso).toDateString() === new Date().toDateString();
}

function ago(iso) {
  if (!iso) return 'No update yet';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (isToday(iso)) return `${Math.round(minutes / 60)}h ago`;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (new Date(iso).toDateString() === yesterday.toDateString()) return 'yesterday';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* Sign in */

function installHint() {
  if (isStandalone || localStorage.getItem(INSTALL_DISMISSED_KEY)) return '';
  if (isIOS) {
    return `<div class="install">
      <b>Put it on your home screen first.</b>
      <p>In Safari, tap Share <span class="share-glyph" aria-hidden="true"></span> then <strong>Add to Home Screen</strong>. Open WHYL Team from there and sign in. Signing in here in Safari won't carry over to the app.</p>
      <button class="link" data-dismiss-install>Keep using it in Safari</button>
    </div>`;
  }
  if (isAndroid) {
    return `<div class="install">
      <b>Put it on your home screen.</b>
      ${installPrompt
        ? '<button class="primary" data-install>Install WHYL Team</button>'
        : '<p>In Chrome, tap <strong>⋮</strong> then <strong>Add to Home screen</strong>.</p>'}
      <button class="link" data-dismiss-install>Not now</button>
    </div>`;
  }
  return '';
}

function bindInstall() {
  app.querySelector('[data-dismiss-install]')?.addEventListener('click', () => {
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
    app.querySelector('.install')?.remove();
  });
  app.querySelector('[data-install]')?.addEventListener('click', async () => {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    app.querySelector('.install')?.remove();
  });
}

const PEOPLE = [
  ['chloe@whyl.ai', 'Chloe'],
  ['olalla@whyl.ai', 'Olalla'],
  ['adhrit@whyl.ai', 'Adhrit'],
];

function renderEmail(message = '') {
  const saved = localStorage.getItem(EMAIL_KEY) || 'chloe@whyl.ai';
  app.innerHTML = `
    <header class="top"><span class="mark">whyl.</span><span class="mark-sub">team</span></header>
    <form class="gate" novalidate>
      <h1>What everyone<br>is on.</h1>
      <p>Pick your name, then the password.</p>
      <div class="picks">
        ${PEOPLE.map(([email, name]) => `<button type="button" data-email="${email}" class="${email === saved ? 'on' : ''}">${name}</button>`).join('')}
      </div>
      <input class="field" name="password" type="password" autocomplete="current-password" placeholder="Password" required>
      <button class="primary" type="submit">Open</button>
      <p class="error" role="alert">${esc(message)}</p>
    </form>`;
  const form = app.querySelector('form');
  let email = saved;
  form.querySelectorAll('[data-email]').forEach((button) => {
    button.addEventListener('click', () => {
      email = button.dataset.email;
      form.querySelectorAll('[data-email]').forEach((other) => other.classList.toggle('on', other === button));
    });
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type=submit]');
    const error = form.querySelector('.error');
    button.disabled = true;
    button.textContent = 'Opening…';
    error.textContent = '';
    try {
      const result = await api('enter', { email, password: form.password.value });
      token = result.token;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(EMAIL_KEY, email);
      await load();
    } catch (cause) {
      error.textContent = cause.message;
      button.disabled = false;
      button.textContent = 'Open';
      form.password.focus();
    }
  });
}

/* Lists */

function mineItems() {
  return (state.items || []).filter((item) => item.email === state.me);
}

function reminderHtml(item, tappable) {
  const button = tappable ? 'button' : 'div';
  return `<${button} class="reminder ${item.doneAt ? 'done' : ''}" ${tappable ? `type="button" data-id="${esc(item.id)}"` : ''}>
    <span class="tick" aria-hidden="true"></span>
    <span class="text">${esc(item.text)}</span>
  </${button}>`;
}

function listHtml(items, tappable) {
  const open = items.filter((item) => !item.doneAt);
  const done = items.filter((item) => item.doneAt);
  const openHtml = open.map((item) => reminderHtml(item, tappable)).join('')
    || '<p class="quiet empty-note">Nothing yet.</p>';
  const doneHtml = done.length
    ? `<p class="done-label">Done</p>${done.map((item) => reminderHtml(item, tappable)).join('')}`
    : '';
  return openHtml + doneHtml;
}

function renderMine() {
  const typing = document.activeElement?.closest?.('.composer');
  if (typing && app.querySelector('.list')) {
    app.querySelector('.list').innerHTML = listHtml(mineItems(), true);
    bindReminders();
    return;
  }
  const draft = app.querySelector('.composer input')?.value || '';
  app.innerHTML = `
    <header class="top"><span class="mark">whyl.</span></header>
    <h1 class="page-title">You</h1>
    <form class="composer" novalidate>
      <input class="field" name="text" maxlength="140" placeholder="Add something you did or are doing" value="${esc(draft)}" required>
      <button class="primary" type="submit">Send</button>
      <p class="error" role="alert"></p>
    </form>
    <section class="list">${listHtml(mineItems(), true)}</section>
    <div class="foot"><button class="link" type="button" data-signout>Sign out</button></div>
    ${tabsHtml()}`;
  app.querySelector('[data-signout]').addEventListener('click', signOut);
  bindTabs();
  bindReminders();
  const form = app.querySelector('.composer');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type=submit]');
    const error = form.querySelector('.error');
    button.disabled = true;
    error.textContent = '';
    try {
      state = await api('item', { text: form.text.value });
      form.text.value = '';
      app.querySelector('.list').innerHTML = listHtml(mineItems(), true);
      bindReminders();
    } catch (cause) {
      error.textContent = cause.message;
    }
    button.disabled = false;
    form.text.focus();
  });
}

function renderTeam() {
  const people = state.members.filter((member) => member.email !== state.me);
  const blocks = people.map((member) => {
    const items = (state.items || []).filter((item) => item.email === member.email);
    return `<section class="person-block"><h2>${esc(firstName(member))}</h2>${listHtml(items, false)}</section>`;
  }).join('');
  app.innerHTML = `
    <header class="top"><span class="mark">whyl.</span></header>
    <h1 class="page-title">Team</h1>
    ${blocks}
    <div class="foot"><button class="link" type="button" data-signout>Sign out</button></div>
    ${tabsHtml()}`;
  app.querySelector('[data-signout]').addEventListener('click', signOut);
  bindTabs();
}

function bindReminders() {
  app.querySelectorAll('.reminder[data-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = (state.items || []).find((row) => row.id === button.dataset.id);
      button.disabled = true;
      try {
        state = await api('done', { id: button.dataset.id, done: !item?.doneAt });
        if (tab === 'mine') renderMine();
      } catch (cause) {
        const error = app.querySelector('.error');
        if (error) error.textContent = cause.message;
        button.disabled = false;
      }
    });
  });
}

function tabsHtml() {
  const item = (id, label) => `<button type="button" data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`;
  return `<nav class="tabs">${item('mine', 'Mine')}${item('team', 'Team')}</nav>`;
}

function bindTabs() {
  app.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      tab = button.dataset.tab;
      render();
    });
  });
}

/* Flow */

function render() {
  if (!state) return renderEmail();
  if (tab === 'team') renderTeam();
  else renderMine();
  startRefresh();
}

async function load() {
  app.innerHTML = '<div class="loading">Loading…</div>';
  try {
    state = await api('state');
    render();
  } catch (cause) {
    if (token) app.innerHTML = `<div class="loading">${esc(cause.message)}</div>`;
  }
}

async function refresh() {
  if (!token || document.hidden) return;
  try {
    state = await api('state');
    if (tab === 'team') renderTeam();
    else renderMine();
  } catch {
    // Keep showing the last board; the next refresh tries again.
  }
}

function startRefresh() {
  if (!refreshTimer) refreshTimer = setInterval(refresh, REFRESH_MS);
}

function stopRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = null;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state) refresh();
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  const box = app.querySelector('.install');
  if (box) {
    box.outerHTML = installHint();
    bindInstall();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (token) load();
else renderEmail();
