const API = 'https://zfwfzuasswjmvgonluag.supabase.co/functions/v1/team';
const TOKEN_KEY = 'whyl-team-token';
const EMAIL_KEY = 'whyl-team-email';
const INSTALL_DISMISSED_KEY = 'whyl-team-install-dismissed';
const REFRESH_MS = 20000;

const app = document.getElementById('app');
let token = localStorage.getItem(TOKEN_KEY);
let state = null;
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
    <header class="top"><span class="mark">whyl.</span></header>
    <form class="gate" novalidate>
      <h1>Who are you?</h1>
      <div class="picks">
        ${PEOPLE.map(([email, name]) => `<button type="button" data-email="${email}" class="${email === saved ? 'on' : ''}">${name}</button>`).join('')}
      </div>
      <label class="pass">Password
        <input class="field" name="password" type="password" autocomplete="current-password" required>
      </label>
      <button class="primary" type="submit">Sign in</button>
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
    button.textContent = 'Signing in…';
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
      button.textContent = 'Sign in';
      form.password.focus();
    }
  });
}

/* Board */

function personHtml(member) {
  const line = member.card.now
    ? `<p>${esc(member.card.now)}</p>`
    : '<p class="quiet">Nothing yet</p>';
  return `<article class="person"><h2>${esc(firstName(member))}</h2>${line}</article>`;
}

function othersHtml() {
  return state.members.filter((m) => m.email !== state.me).map(personHtml).join('');
}

let saveTimer = null;

function renderBoard() {
  const typing = app.querySelector('.you textarea') && document.activeElement?.closest?.('.you');
  if (typing) {
    const list = app.querySelector('.others');
    if (list) list.innerHTML = othersHtml();
    return;
  }
  const me = state.members.find((m) => m.email === state.me);
  app.innerHTML = `
    <header class="top"><span class="mark">whyl.</span></header>
    <form class="you" novalidate>
      <article class="person mine">
        <div class="who"><h2>${esc(firstName(me))}</h2><span class="saved" hidden>Saved</span></div>
        <textarea name="now" rows="2" maxlength="140" placeholder="What are you doing?">${esc(me.card.now)}</textarea>
      </article>
      <p class="error" role="alert"></p>
    </form>
    <section class="others">${othersHtml()}</section>
    <div class="foot"><button class="link" type="button" data-signout>Sign out</button></div>`;
  app.querySelector('[data-signout]').addEventListener('click', signOut);
  const form = app.querySelector('.you');
  const saved = form.querySelector('.saved');
  const save = async () => {
    const now = form.now.value;
    const card = state.members.find((m) => m.email === state.me).card;
    if (now.trim() === card.now) return;
    form.querySelector('.error').textContent = '';
    try {
      state = await api('card', { now, need: '' });
      saved.hidden = false;
      const list = app.querySelector('.others');
      if (list) list.innerHTML = othersHtml();
    } catch (cause) {
      saved.hidden = true;
      form.querySelector('.error').textContent = cause.message;
    }
  };
  form.addEventListener('input', () => {
    saved.hidden = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  });
  form.addEventListener('focusout', () => {
    clearTimeout(saveTimer);
    save();
  });
}

/* Flow */

function render() {
  if (!state) return renderEmail();
  renderBoard();
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
    renderBoard();
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
