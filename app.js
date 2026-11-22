const API = 'https://zfwfzuasswjmvgonluag.supabase.co/functions/v1/team';
const TOKEN_KEY = 'whyl-team-token';
const EMAIL_KEY = 'whyl-team-email';
const INSTALL_DISMISSED_KEY = 'whyl-team-install-dismissed';
const REFRESH_MS = 20000;

const app = document.getElementById('app');
let token = localStorage.getItem(TOKEN_KEY);
let state = null;
let agreement = null;
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
  if (res.status === 401 && token && path !== 'verify') {
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

function renderEmail(message = '') {
  const saved = localStorage.getItem(EMAIL_KEY) || '';
  app.innerHTML = `
    <header class="top"><span class="mark">whyl.</span><span class="mark-sub">team</span></header>
    <form class="gate" novalidate>
      <h1>What everyone<br>is on.</h1>
      <p>For Chloe, Olalla, and Adhrit. Sign in with your whyl.ai email.</p>
      ${installHint()}
      <input class="field" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@whyl.ai" value="${esc(saved)}" required>
      <button class="primary" type="submit">Send me a code</button>
      <p class="error" role="alert">${esc(message)}</p>
    </form>`;
  bindInstall();
  const form = app.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    const button = form.querySelector('button[type=submit]');
    const error = form.querySelector('.error');
    if (!email.includes('@')) {
      error.textContent = 'Enter your whyl.ai email.';
      return;
    }
    button.disabled = true;
    button.textContent = 'Sending…';
    error.textContent = '';
    try {
      await api('code', { email });
      localStorage.setItem(EMAIL_KEY, email);
      renderCode(email);
    } catch (cause) {
      error.textContent = cause.message;
      button.disabled = false;
      button.textContent = 'Send me a code';
    }
  });
}

function renderCode(email) {
  app.innerHTML = `
    <header class="top"><span class="mark">whyl.</span><span class="mark-sub">team</span></header>
    <form class="gate" novalidate>
      <h1>Check your<br>email.</h1>
      <p>We sent a 6-digit code to <strong>${esc(email)}</strong>.</p>
      <input class="field field-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="······" required>
      <button class="primary" type="submit">Sign in</button>
      <p class="error" role="alert"></p>
      <button class="link" type="button" data-resend>Send a new code</button>
      <button class="link" type="button" data-back>Use a different email</button>
    </form>`;
  const form = app.querySelector('form');
  const input = form.code;
  const button = form.querySelector('button[type=submit]');
  const error = form.querySelector('.error');
  input.focus();

  const submit = async () => {
    const code = input.value.replace(/\D/g, '');
    if (code.length !== 6) {
      error.textContent = 'Enter all 6 digits.';
      return;
    }
    button.disabled = true;
    button.textContent = 'Checking…';
    error.textContent = '';
    try {
      const result = await api('verify', { email, code });
      token = result.token;
      localStorage.setItem(TOKEN_KEY, token);
      await load();
    } catch (cause) {
      error.textContent = cause.message;
      button.disabled = false;
      button.textContent = 'Sign in';
      input.select();
    }
  };

  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value.length === 6) submit();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  form.querySelector('[data-back]').addEventListener('click', () => renderEmail());
  form.querySelector('[data-resend]').addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      await api('code', { email });
      error.textContent = 'New code sent.';
    } catch (cause) {
      error.textContent = cause.message;
    }
    event.target.disabled = false;
  });
}

/* Agreement */

async function loadAgreement() {
  if (!agreement) agreement = await api('agreement');
  return agreement;
}

function inline(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function renderTable(rows) {
  const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  const [head, , ...body] = rows;
  const signedInitials = Object.fromEntries(
    state.members.filter((m) => m.signedAt).map((m) => [m.name, m.initials]),
  );
  const headCells = cells(head);
  const initialCol = headCells.findIndex((cell) => cell.toLowerCase() === 'initial');
  return body.map((row) => {
    const values = cells(row);
    const initials = signedInitials[values[0]];
    const fields = values.slice(1).map((value, offset) => {
      const i = offset + 1;
      if (i === initialCol) {
        return `<div><span>${inline(headCells[i])}</span><b class="${initials ? 'initialed' : 'blank'}">${initials ? esc(initials) : 'Not initialed yet'}</b></div>`;
      }
      return `<div><span>${inline(headCells[i])}</span><b>${inline(value)}</b></div>`;
    }).join('');
    return `<div class="row-card"><h3>${inline(values[0])}</h3>${fields}</div>`;
  }).join('');
}

function renderMarkdown(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const html = [];
  let paragraph = [];
  let list = [];
  let table = [];
  const flush = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    if (list.length) html.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
    if (table.length) html.push(renderTable(table));
    paragraph = [];
    list = [];
    table = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    if (trimmed.startsWith('|')) { table.push(trimmed); continue; }
    if (trimmed === '---') { flush(); html.push('<hr>'); continue; }
    if (trimmed.startsWith('## ')) { flush(); html.push(`<h2>${inline(trimmed.slice(3))}</h2>`); continue; }
    if (trimmed.startsWith('# ')) { flush(); html.push(`<h1>${inline(trimmed.slice(2))}</h1>`); continue; }
    if (trimmed.startsWith('- ')) { if (paragraph.length) flush(); list.push(trimmed.slice(2)); continue; }
    paragraph.push(trimmed);
  }
  flush();
  return html.join('');
}

function signatureBlock(closingLine) {
  const rows = state.members.map((m) => {
    const when = m.signedAt
      ? `Signed ${new Date(m.signedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : 'Not signed yet';
    return `<div class="sig ${m.signedAt ? 'done' : ''}"><span>${esc(m.name)}<br><small>${esc(m.email)}</small></span><span>${when}</span></div>`;
  }).join('');
  return `<h2>Signatures</h2><p>The Effective Date is the day the last founder signs.</p><div class="sig-list">${rows}</div><p>${inline(closingLine)}</p>`;
}

async function renderAgreement() {
  app.innerHTML = '<div class="loading">Loading the agreement…</div>';
  const doc = await loadAgreement();
  const me = state.members.find((m) => m.email === state.me);
  const [body, signatures = ''] = doc.text.split(/\n## Signatures\n/);
  const closingLine = signatures.trim().split('\n').filter(Boolean).pop() || '';
  app.innerHTML = `
    <header class="top"><span class="mark">whyl.</span></header>
    <p class="lead">Read the agreement, then sign at the bottom. The board opens after you sign.</p>
    <article class="doc">
      ${renderMarkdown(body)}
      ${signatureBlock(closingLine)}
      <form class="sign-form" novalidate>
        <label>Your full name, as written above
          <input class="field" name="typedName" autocomplete="name" placeholder="${esc(me.name)}" required>
        </label>
        <label>Your initials for Schedule A
          <input class="field" name="initials" autocapitalize="characters" autocomplete="off" maxlength="4" placeholder="${esc(me.initials)}" required>
        </label>
        <label class="check"><input type="checkbox" name="agree"> I have read the Founders' Agreement and I sign it electronically. My typed name is my signature.</label>
        <button class="primary" type="submit">Sign the agreement</button>
        <p class="error" role="alert"></p>
      </form>
    </article>
    <div class="foot"><button class="link" data-signout>Sign out</button></div>`;
  app.querySelector('[data-signout]').addEventListener('click', signOut);
  const form = app.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = form.querySelector('.error');
    const button = form.querySelector('button[type=submit]');
    if (!form.agree.checked) {
      error.textContent = 'Check the box to agree.';
      return;
    }
    button.disabled = true;
    button.textContent = 'Signing…';
    error.textContent = '';
    try {
      state = await api('sign', {
        typedName: form.typedName.value,
        initials: form.initials.value,
        agree: true,
        agreementSha256: doc.sha256,
      });
      window.scrollTo(0, 0);
      render();
    } catch (cause) {
      error.textContent = cause.message;
      button.disabled = false;
      button.textContent = 'Sign the agreement';
    }
  });
}

/* Board */

function personHtml(member) {
  if (!member.card) return `<article class="person"><h2>${esc(firstName(member))}</h2><p class="quiet">Hasn't signed yet</p></article>`;
  const doing = member.card.now
    ? `<p>${esc(member.card.now)}</p>`
    : '<p class="quiet">Nothing posted yet</p>';
  const need = member.card.need ? `<p class="need">Needs ${esc(member.card.need)}</p>` : '';
  const when = member.card.updatedAt ? `<p class="when">${esc(ago(member.card.updatedAt))}</p>` : '';
  return `<article class="person"><h2>${esc(firstName(member))}</h2>${doing}${need}${when}</article>`;
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
      <div class="who"><h1>You</h1><span class="saved" hidden>Saved</span></div>
      <label>What are you doing?
        <textarea name="now" rows="2" maxlength="140" placeholder="One line">${esc(me.card.now)}</textarea>
      </label>
      <label>Need something?
        <textarea name="need" rows="2" maxlength="140" placeholder="Leave this blank if you don't">${esc(me.card.need)}</textarea>
      </label>
      <p class="error" role="alert"></p>
    </form>
    <section class="others">${othersHtml()}</section>
    <div class="foot"><button class="link" type="button" data-signout>Sign out</button></div>`;
  app.querySelector('[data-signout]').addEventListener('click', signOut);
  const form = app.querySelector('.you');
  const saved = form.querySelector('.saved');
  const save = async () => {
    const now = form.now.value;
    const need = form.need.value;
    const card = state.members.find((m) => m.email === state.me).card;
    if (now.trim() === card.now && need.trim() === card.need) return;
    form.querySelector('.error').textContent = '';
    try {
      state = await api('card', { now, need });
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
  if (!state.signed) {
    stopRefresh();
    return renderAgreement();
  }
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
    if (state.signed) renderBoard();
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
  if (!document.hidden && state?.signed) refresh();
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
