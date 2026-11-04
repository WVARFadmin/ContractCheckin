// Contract Check-In — single-page app (no build step).
// Routes use the URL hash: #/, #/contract/12, #/contract/12/call, #/queue, ...
//
// Sign-in uses Netlify Identity through Netlify's @netlify/identity library
// (bundled into /vendor by `npm run build:vendor`). The sign-in, reset and invite
// forms are this app's own forms, so browsers and password managers can save
// passwords. Reset and invite links are only redeemed when the person submits a
// new password — never just because the link was opened.

import * as auth from '/vendor/netlify-identity.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const who = document.getElementById('who');

const COLOR_INFO = {
  green: { label: 'Green', says: 'Everything is great, no complaints', next: 'Keep calling on schedule. Walk through on the regular rotation.' },
  yellow: { label: 'Yellow', says: 'Good, but any issue or room to improve', next: 'Goes in the visit queue — visit within 1–2 weeks.' },
  red: { label: 'Red', says: 'There is an issue or a problem', next: 'Goes to the top of the visit queue — visit within 2 business days.' },
};
const ROOT_CAUSES = ['Missed task', 'Not in scope', 'Staffing', 'Training', 'Supplies / equipment', 'Other'];
const SCHEDULES = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly' };

let me = null;            // result of /api/me
let listFilter = 'all';   // contracts list filter

// Practice mode: a WVARF admin working inside a demo CRP (made-up data only).
const PRACTICE_KEY = 'practice-crp';
function getPractice() {
  try { return JSON.parse(sessionStorage.getItem(PRACTICE_KEY) || 'null'); } catch { return null; }
}
function setPractice(crp) {
  try { if (crp) sessionStorage.setItem(PRACTICE_KEY, JSON.stringify(crp)); else sessionStorage.removeItem(PRACTICE_KEY); } catch { /* ignore */ }
  me = null;
  listFilter = 'all';
}

// ---------- helpers ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(iso, opts = { month: 'short', day: 'numeric' }) {
  if (!iso) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, opts);
}
function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
function relDue(iso) {
  if (!iso) return '';
  const days = Math.round((new Date(iso) - new Date()) / 86400000);
  if (days < -1) return `${-days} days overdue`;
  if (days === -1) return '1 day overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due ${fmtDate(iso)}`;
}
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
const telHref = (p) => `tel:${String(p || '').replace(/[^\d+]/g, '')}`;
const pill = (c) => c ? `<span class="pill ${c}">${COLOR_INFO[c].label}</span>` : '<span class="pill none">Not called</span>';
const typeTag = (t) => t === 'state' ? '<span class="tag">WVARF / State</span>' : '<span class="tag other">Other</span>';
const demoTag = (c) => (c && c.is_demo ? ' <span class="tag demo">Demo</span>' : '');

// ---------- trend history (charts are plain SVG; every color also has a word) ----------

const TREND = {
  improving: { word: 'Improving', arrow: 'M4 12l5-5 4 4 7-7M14 4h6v6', cls: 'up' },
  steady: { word: 'Steady', arrow: 'M3 12h16M15 8l4 4-4 4', cls: 'flat' },
  slipping: { word: 'Slipping', arrow: 'M4 6l5 5 4-4 7 7M14 18h6v-6', cls: 'down' },
  new: { word: 'New — not enough history', arrow: 'M12 6v6l4 2', cls: 'new' },
};
const COLOR_HEX = { green: '#2E7D32', yellow: '#F2B705', red: '#C62828' };
const weekLabel = (iso) => fmtDate(iso, { month: 'short', day: 'numeric' });

function trendBadge(trend, { long = false } = {}) {
  const t = TREND[trend.direction] || TREND.new;
  const detail = long && trend.change !== null
    ? ` <span class="muted">· score ${trend.recent}, ${trend.change >= 0 ? 'up' : 'down'} ${Math.abs(trend.change)} from ${trend.prior}</span>` : '';
  return `<span class="trend ${t.cls}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${t.arrow}"/></svg>${t.word}${detail}</span>`;
}

// Tiny line of the service score (0–100) over the 12 weeks; gaps where there was no color yet.
function sparkline(scores, label) {
  const w = 96; const h = 28; const pad = 3;
  const x = (i) => pad + (i * (w - 2 * pad)) / Math.max(1, scores.length - 1);
  const y = (v) => pad + ((100 - v) * (h - 2 * pad)) / 100;
  let d = ''; let pen = false;
  scores.forEach((v, i) => {
    if (v === null || v === undefined) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; pen = true;
  });
  const lastI = scores.map((v, i) => (v === null || v === undefined ? -1 : i)).filter((i) => i >= 0).pop();
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">
    <title>${esc(label)}</title>
    <line x1="${pad}" x2="${w - pad}" y1="${y(50)}" y2="${y(50)}" class="spark-mid"/>
    ${d ? `<path d="${d}" class="spark-line"/>` : ''}
    ${lastI !== undefined ? `<circle cx="${x(lastI)}" cy="${y(scores[lastI])}" r="3" class="spark-dot"/>` : ''}
  </svg>`;
}
const sparkLabel = (scores) => {
  const known = scores.filter((v) => v !== null && v !== undefined);
  return known.length ? `Service score over 12 weeks: ${known.join(', ')} (100 = all green, 0 = all red)` : 'No calls yet';
};

// One square per week, colored by that week's status, with the word in each tooltip.
function weekStrip(colors, ends) {
  return `<div class="strip" role="list" aria-label="Color each week, oldest first">${colors.map((c, i) => `
    <span role="listitem" class="cell ${c || 'none'}" title="Week ending ${weekLabel(ends[i])}: ${c ? COLOR_INFO[c].label : 'no color yet'}">
      <span class="sr">Week ending ${weekLabel(ends[i])}: ${c ? COLOR_INFO[c].label : 'no color yet'}</span></span>`).join('')}
  </div>
  <div class="strip-axis small muted"><span>12 weeks ago</span><span>This week</span></div>`;
}

// Share of contracts green / yellow / red each week, as 100% stacked bars.
function trendChart(weeks, title) {
  const narrow = window.matchMedia('(max-width: 560px)').matches;
  const W = 640; const H = narrow ? 300 : 210; const L = narrow ? 62 : 36; const R = 8; const T = 12; const B = narrow ? 34 : 26;
  const n = weeks.length; const slot = (W - L - R) / n; const bw = Math.min(34, slot - 6);
  const yv = (pct) => T + ((100 - pct) * (H - T - B)) / 100;
  const bars = weeks.map((wk, i) => {
    const total = wk.green + wk.yellow + wk.red;
    const x = L + i * slot + (slot - bw) / 2;
    const tip = total
      ? `Week ending ${weekLabel(wk.week_end)}: ${wk.green} green, ${wk.yellow} yellow, ${wk.red} red · score ${wk.score}`
      : `Week ending ${weekLabel(wk.week_end)}: no colors yet`;
    let acc = 0; let segs = '';
    ['green', 'yellow', 'red'].forEach((k) => {
      if (!total || !wk[k]) return;
      const pct = (wk[k] / total) * 100;
      const y1 = yv(acc + pct); const y0 = yv(acc);
      const gap = acc > 0 ? 2 : 0; // 2px surface gap between stacked segments
      segs += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, y0 - y1 - gap).toFixed(1)}" rx="2" fill="${COLOR_HEX[k]}"/>`;
      acc += pct;
    });
    const label = i % (narrow ? 4 : 3) === (n - 1) % (narrow ? 4 : 3) ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" class="ax" text-anchor="middle">${weekLabel(wk.week_end)}</text>` : '';
    return `<g class="bar"><title>${esc(tip)}</title><rect x="${(L + i * slot).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B}" fill="transparent"/>${segs}${label}</g>`;
  }).join('');
  const grid = [0, 50, 100].map((p) => `<line x1="${L}" x2="${W - R}" y1="${yv(p)}" y2="${yv(p)}" class="grid"/><text x="${L - 6}" y="${yv(p) + 4}" class="ax" text-anchor="end">${p}%</text>`).join('');
  const rows = weeks.map((wk) => `<tr><td>${weekLabel(wk.week_end)}</td><td class="num">${wk.green}</td><td class="num">${wk.yellow}</td><td class="num">${wk.red}</td><td class="num">${wk.score ?? '—'}</td></tr>`).join('');
  return `<figure class="chart">
    <div class="legend" aria-hidden="true"><span><i class="dot green"></i>Green</span><span><i class="dot yellow"></i>Yellow</span><span><i class="dot red"></i>Red</span>
      <span class="muted small">Share of contracts each week · hover a bar, or open the table, for counts</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${bars}</svg>
    <details class="small"><summary>Show as a table</summary>
      <div class="tablewrap"><table><thead><tr><th>Week ending</th><th class="num">Green</th><th class="num">Yellow</th><th class="num">Red</th><th class="num">Score</th></tr></thead><tbody>${rows}</tbody></table></div>
    </details>
  </figure>`;
}

function trendCard(history, scopeLabel) {
  const t = history.trend;
  const sentence = t.change === null
    ? 'Not enough history yet. Trends appear after about 5 weeks of calls.'
    : `Service score is <strong>${t.recent}</strong> over the last 4 weeks, ${t.change > 0 ? 'up' : t.change < 0 ? 'down' : 'no change'}${t.change ? ` ${Math.abs(t.change)} points` : ''} from <strong>${t.prior}</strong> about 2–3 months ago.`;
  return `<section class="card stack trendcard">
    <div class="row" style="justify-content:space-between"><h2 class="cardtitle">${esc(scopeLabel)} · last 12 weeks</h2>${trendBadge(t)}</div>
    <p class="small" style="margin:0">${sentence} <span class="muted">Score: green 100, yellow 50, red 0, averaged across contracts.</span></p>
    ${trendChart(history.weeks, `${scopeLabel}: share of contracts green, yellow and red each week for 12 weeks`)}
  </section>`;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

const icons = {
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M10 9l5 3-5 3z"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  phone: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
};

// ---------- API ----------

function readCookie(name) {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// The library keeps the current login in the nf_jwt cookie and refreshes it
// shortly before it expires.
async function accessToken() {
  try { await auth.refreshSession(); } catch { /* fall through to the cookie */ }
  return readCookie('nf_jwt');
}

async function api(path, { method = 'GET', body } = {}) {
  const token = await accessToken();
  if (!token) throw Object.assign(new Error('Please sign in'), { status: 401 });
  const practice = getPractice();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(practice ? { 'x-practice-crp': String(practice.id) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok && practice && res.status === 403 && /practice mode/i.test((data && data.error) || '')) {
    // The demo CRP was removed while practicing: leave practice mode.
    setPractice(null);
    throw Object.assign(new Error('That demo CRP no longer has demo data, so practice mode ended. Open the Demo tab to load it again.'), { status: 409 });
  }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `Request failed (${res.status})`), { status: res.status });
  return data;
}

function formData(form) {
  const fd = new FormData(form);
  const out = {};
  for (const [k, v] of fd.entries()) {
    if (k.endsWith('[]')) (out[k.slice(0, -2)] ||= []).push(v);
    else out[k] = v;
  }
  return out;
}

// Submit a form with a busy button and inline error.
function wireForm(form, submit) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const err = form.querySelector('.form-error');
    if (err) err.remove();
    btn.disabled = true;
    try {
      await submit(formData(form));
    } catch (ex) {
      const box = document.createElement('div');
      box.className = 'form-error';
      box.setAttribute('role', 'alert');
      box.textContent = ex.message;
      btn.insertAdjacentElement('beforebegin', box);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- shell ----------

function renderShell(route) {
  const banner = document.getElementById('practice');
  if (!me || !me.practice) { banner.hidden = true; banner.innerHTML = ''; }
  else {
    banner.hidden = false;
    banner.innerHTML = `<div class="practice-inner"><span><strong>Practice mode</strong> · ${esc(me.crp.name)} — made-up demo data. You're acting as its CRP admin; nothing here is real.</span>
      <button class="btn small" type="button" id="exit-practice">Exit practice</button></div>`;
    document.getElementById('exit-practice').onclick = () => {
      setPractice(null);
      if (location.hash === '#/demo') window.dispatchEvent(new HashChangeEvent('hashchange'));
      else location.hash = '#/demo';
    };
  }
  if (!me) { nav.innerHTML = ''; who.innerHTML = ''; return; }
  const tabs = [];
  if (me.crp) {
    tabs.push(['#/', 'Contracts', icons.list, ['', 'contract']]);
    tabs.push(['#/queue', 'Visits', icons.pin, ['queue']]);
  }
  if (me.is_wvarf_admin) tabs.push(['#/statewide', 'Statewide', icons.chart, ['statewide']]);
  if (me.is_wvarf_admin) tabs.push(['#/demo', 'Demo', icons.play, ['demo']]);
  if (me.can_admin_crp || me.is_wvarf_admin) tabs.push(['#/admin', 'People', icons.people, ['admin']]);
  nav.innerHTML = tabs.length > 1
    ? tabs.map(([href, label, icon, keys]) =>
      `<a href="${href}" ${keys.includes(route) ? 'aria-current="page"' : ''}>${icon}${label}</a>`).join('')
    : '';
  who.innerHTML = `<span class="crpname">${esc(me.crp ? me.crp.name : (me.is_wvarf_admin ? 'WVARF' : ''))}</span>
    <a class="linkbtn" href="#/account" ${route === 'account' ? 'aria-current="page"' : ''}>Account</a>`;
}

async function signOut() {
  try { await auth.logout(); } catch { /* the cookie is cleared either way */ }
  setPractice(null);
  me = null;
  history.replaceState(null, '', '#/');
  renderSignIn({ note: 'You are signed out.' });
}

function setMain(html) {
  main.innerHTML = html;
  window.scrollTo(0, 0);
}

function errorView(ex) {
  if (ex.status === 401) { me = null; return renderSignIn({ note: 'Please sign in again.' }); }
  setMain(`<div class="card stack"><h1 class="small">Something went wrong</h1><p>${esc(ex.message)}</p>
    <div><button class="btn secondary" type="button" onclick="location.reload()">Try again</button></div></div>`);
}

// ---------- sign-in screens ----------

const MIN_PASSWORD = 8;
const TOKEN_KEY = 'pending-auth-link';

// Reset and invite emails link to /#recovery_token=... or /#invite_token=....
// Take the code out of the address bar right away (so it isn't left in history)
// and keep it until the person submits a new password.
function captureEmailLink() {
  const m = location.hash.match(/^#\/?(recovery|invite|confirmation|email_change)_token=([^&]+)/);
  if (!m) return;
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ type: m[1], token: decodeURIComponent(m[2]) })); } catch { /* private mode */ }
  pendingLink = { type: m[1], token: decodeURIComponent(m[2]) };
  history.replaceState(null, '', location.pathname + (m[1] === 'invite' ? '#/welcome' : '#/reset'));
}
let pendingLink = null;
function getPendingLink() {
  if (pendingLink) return pendingLink;
  try { pendingLink = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); } catch { pendingLink = null; }
  return pendingLink;
}
function clearPendingLink() {
  pendingLink = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

function authFrame(title, body, sub = '') {
  me = null;
  renderShell('');
  setMain(`<section class="auth">
    <div class="bigdots" aria-hidden="true"><i style="background:var(--green)"></i><i style="background:var(--yellow)"></i><i style="background:var(--red)"></i></div>
    <h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}
    ${body}
  </section>`);
}

// Friendly words for the errors Netlify Identity returns.
function authMessage(ex, context) {
  const raw = String((ex && ex.message) || '').toLowerCase();
  if (context === 'login' && /invalid|grant|password|not found|email/.test(raw)) {
    return 'That email and password don\'t match. Check for typos, or reset your password below.';
  }
  if (context === 'link') {
    return 'This link has already been used or has expired. Each link works once, and only the newest email works. Request a new link below.';
  }
  if (/network|fetch|timeout/.test(raw)) return 'Could not reach the sign-in service. Check your connection and try again.';
  return (ex && ex.message) || 'Something went wrong. Please try again.';
}

function passwordFields(label = 'New password') {
  return `
    <div class="field"><label for="a-pw">${label}</label>
      <input id="a-pw" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required>
      <span class="hint">At least ${MIN_PASSWORD} characters.</span></div>
    <div class="field"><label for="a-pw2">Type it again</label>
      <input id="a-pw2" name="password2" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required></div>
    <label class="choice"><input type="checkbox" id="a-show"> Show password</label>`;
}
function wireShowPassword() {
  const box = main.querySelector('#a-show');
  if (box) box.onchange = () => main.querySelectorAll('input[name^=password]').forEach((i) => { i.type = box.checked ? 'text' : 'password'; });
}
function checkNewPassword(d) {
  if ((d.password || '').length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
  if (d.password !== d.password2) throw new Error('The two passwords don\'t match.');
}

function renderSignIn({ note = '', email = '' } = {}) {
  authFrame('Contract Check-In', `
    ${note ? `<div class="banner info"><span>${esc(note)}</span></div>` : ''}
    <form class="card stack" id="signin-form" method="post" action="#" novalidate>
      <div class="field"><label for="a-email">Email</label>
        <input id="a-email" name="email" type="email" autocomplete="username" inputmode="email" required value="${esc(email)}"></div>
      <div class="field"><label for="a-pass">Password</label>
        <input id="a-pass" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn block" type="submit">Sign in</button>
      <button class="btn secondary block" type="button" id="a-forgot">Forgot your password?</button>
    </form>
    <p class="small muted">New here? Use the invitation email you received, or ask your CRP or WVARF administrator to add you.</p>`,
  'Call every janitorial customer, mark green, yellow or red, and see which sites need a visit first.');
  const form = main.querySelector('#signin-form');
  main.querySelector('#a-forgot').onclick = () => renderForgot({ email: form.email.value });
  wireForm(form, async (d) => {
    const mail = String(d.email || '').trim();
    if (!mail || !d.password) throw new Error('Enter your email and password.');
    try { await auth.login(mail, d.password); } catch (ex) { throw new Error(authMessage(ex, 'login')); }
    setPractice(null);
    me = null;
    history.replaceState(null, '', '#/');
    route();
  });
  (email ? form.password : form.email).focus();
}

function renderForgot({ email = '', note = '' } = {}) {
  authFrame('Reset your password', `
    ${note ? `<div class="form-error" role="alert">${esc(note)}</div>` : ''}
    <form class="card stack" id="forgot-form" novalidate>
      <div class="field"><label for="a-femail">Email</label>
        <input id="a-femail" name="email" type="email" autocomplete="username" inputmode="email" required value="${esc(email)}"></div>
      <button class="btn block" type="submit">Email me a reset link</button>
      <button class="btn secondary block" type="button" id="a-back">Back to sign in</button>
    </form>`, 'We\'ll email you a link to choose a new password.');
  const form = main.querySelector('#forgot-form');
  main.querySelector('#a-back').onclick = () => renderSignIn({ email: form.email.value });
  wireForm(form, async (d) => {
    const mail = String(d.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new Error('Enter the email you sign in with.');
    try { await auth.requestPasswordRecovery(mail); } catch (ex) {
      // Don't reveal whether an account exists; only report real connection problems.
      if (/network|fetch|timeout/i.test(String(ex && ex.message))) throw new Error(authMessage(ex));
    }
    authFrame('Check your email', `
      <div class="card stack">
        <p>If <strong>${esc(mail)}</strong> has an account, a reset link is on its way. It comes from a Netlify address, so check your spam folder too.</p>
        <p class="small muted">Use the link in the <strong>newest</strong> email only — asking again cancels earlier links.</p>
        <button class="btn secondary block" type="button" id="a-back2">Back to sign in</button>
      </div>`);
    main.querySelector('#a-back2').onclick = () => renderSignIn({ email: mail });
  });
  form.email.focus();
}

// Opened from a reset or invite email. Nothing is redeemed until they submit.
function renderSetPassword(link) {
  const invite = link.type === 'invite';
  if (link.type !== 'invite' && link.type !== 'recovery') {
    clearPendingLink();
    return renderSignIn({ note: 'That link isn\'t used by this app. Sign in below.' });
  }
  authFrame(invite ? 'Welcome! Set your password' : 'Choose a new password', `
    <form class="card stack" id="setpw-form" novalidate>
      <div class="field"><label for="a-semail">Your email</label>
        <input id="a-semail" name="email" type="email" autocomplete="username" inputmode="email" required>
        <span class="hint">The address this email was sent to.</span></div>
      ${passwordFields(invite ? 'Password' : 'New password')}
      <button class="btn block" type="submit">${invite ? 'Create my login' : 'Save new password'}</button>
    </form>`,
  invite ? 'You\'ve been invited to Contract Check-In.' : '');
  wireShowPassword();
  const form = main.querySelector('#setpw-form');
  wireForm(form, async (d) => {
    checkNewPassword(d);
    let account;
    try {
      account = invite ? await auth.acceptInvite(link.token, d.password)
        : await auth.recoverPassword(link.token, d.password);
    } catch (ex) {
      clearPendingLink();
      renderForgot({ email: String(d.email || '').trim(), note: authMessage(ex, 'link') });
      return;
    }
    clearPendingLink();
    // @netlify/identity 2.0.0 doesn't write its sign-in cookie after an invite or
    // reset, and then treats the person as signed out. The password is set now,
    // so sign in with it to get a normal, lasting session.
    const mail = (account && account.email) || String(d.email || '').trim();
    try { await auth.login(mail, d.password); } catch {
      return renderSignIn({ email: mail, note: 'Your password is saved. Please sign in with it.' });
    }
    me = null;
    history.replaceState(null, '', '#/');
    toast(invite ? 'Welcome! You\'re signed in.' : 'Password saved. You\'re signed in.');
    route();
  });
  form.email.focus();
}

// ---------- views ----------

async function viewAccount() {
  setMain(`
    <div class="page-head"><div><h1>Account</h1><div class="sub">Signed in as ${esc(me.email)}</div></div></div>
    <div class="stack">
      <form class="card stack" id="changepw-form" novalidate>
        <h2 class="small" style="font-size:16px;color:var(--blue)">Change password</h2>
        <input type="email" name="email" autocomplete="username" value="${esc(me.email)}" hidden readonly>
        ${passwordFields('New password')}
        <button class="btn" type="submit">Save new password</button>
      </form>
      <div class="card stack">
        <h2 class="small" style="font-size:16px;color:var(--blue)">Sign out</h2>
        <p class="small muted">On a shared computer, always sign out when you're done.</p>
        <div><button class="btn danger" type="button" id="a-signout">Sign out</button></div>
      </div>
    </div>`);
  wireShowPassword();
  main.querySelector('#a-signout').onclick = signOut;
  const form = main.querySelector('#changepw-form');
  wireForm(form, async (d) => {
    checkNewPassword(d);
    try { await auth.updateUser({ password: d.password }); } catch (ex) { throw new Error(authMessage(ex)); }
    form.reset();
    toast('Password changed');
  });
}

function renderNoAccess() {
  setMain(`<section class="landing">
    <h1>Almost there</h1>
    <p>You're signed in as <strong>${esc(me.email)}</strong>, but your account isn't linked to a CRP yet.</p>
    <p class="muted">Ask your CRP administrator or WVARF to add this email address. Then refresh this page.</p>
    <div class="row" style="justify-content:center">
      <button class="btn secondary" type="button" onclick="location.reload()">Refresh</button>
      <button class="btn secondary" type="button" id="a-signout2">Sign out</button>
    </div>
  </section>`);
  main.querySelector('#a-signout2').onclick = signOut;
}

async function viewContracts() {
  const data = await api('/contracts');
  const { counts, contracts, calls_due, crp, history } = data;
  const shown = listFilter === 'all' ? contracts
    : listFilter === 'due' ? contracts.filter((c) => c.call_due)
    : listFilter === 'slipping' ? contracts.filter((c) => c.history.trend.direction === 'slipping')
    : contracts.filter((c) => (c.current_color || 'none') === listFilter);
  const slipping = contracts.filter((c) => c.history.trend.direction === 'slipping').length;
  const filters = [['all', 'All'], ['due', 'Calls due'], ['red', 'Red'], ['yellow', 'Yellow'], ['green', 'Green'], ['slipping', `Slipping (${slipping})`]];
  setMain(`
    <div class="page-head">
      <div><h1>Contracts</h1><div class="sub">${esc(crp.name)} · calls ${esc(SCHEDULES[crp.call_schedule].toLowerCase())}</div></div>
      <a class="btn" href="#/contract/new">+ Add contract</a>
    </div>
    <div class="stack">
      <div class="tiles">
        <a class="tile red" href="#/queue"><b>${counts.red}</b><span>Red</span></a>
        <a class="tile yellow" href="#/queue"><b>${counts.yellow}</b><span>Yellow</span></a>
        <div class="tile green"><b>${counts.green}</b><span>Green</span></div>
      </div>
      ${calls_due ? `<div class="banner"><strong>${calls_due} ${calls_due === 1 ? 'call' : 'calls'} due</strong>&nbsp;— call by phone and mark a color.</div>` : ''}
      ${contracts.length ? trendCard(history, crp.name) : ''}
      <h2 class="section-title" style="margin-bottom:0">Contracts</h2>
      <div class="filters" role="group" aria-label="Filter contracts">
        ${filters.map(([k, l]) => `<button type="button" data-filter="${k}" aria-pressed="${listFilter === k}">${l}</button>`).join('')}
      </div>
      ${shown.length ? `<div class="list">${shown.map((c) => `
        <a class="card contract" href="#/contract/${c.id}">
          <div class="top">
            <div><div class="name">${esc(c.name)}</div><div class="meta">#${esc(c.contract_number)}</div></div>
            ${pill(c.current_color)}
          </div>
          <div class="row small">${typeTag(c.agreement_type)}
            <span class="muted">${c.last_called_at ? `Last call ${fmtDate(c.last_called_at)}` : 'No calls yet'}</span>
            ${c.call_due ? '<span class="due">· Call due</span>' : ''}
          </div>
          <div class="trendrow">${sparkline(c.history.scores, sparkLabel(c.history.scores))}${trendBadge(c.history.trend)}</div>
        </a>`).join('')}</div>`
        : `<div class="card empty">${contracts.length ? 'Nothing in this filter.' : 'No contracts yet. Add each janitorial contract to start.'}</div>`}
    </div>`);
  main.querySelectorAll('[data-filter]').forEach((b) => {
    b.onclick = () => { listFilter = b.dataset.filter; viewContracts().catch(errorView); };
  });
}

async function viewContract(id) {
  const { contract: c, calls, visits, history: hist } = await api(`/contracts/${id}`);
  const history = [
    ...calls.map((x) => ({ at: x.called_at, html: `
      <div class="entry"><span class="dot ${x.color || 'none'}" aria-hidden="true"></span><div>
        <strong>${x.no_answer ? 'Call — no answer' : `Call — ${COLOR_INFO[x.color].label}`}</strong>
        <div class="small muted">${fmtWhen(x.called_at)} · ${esc(x.called_by)}${x.spoke_with ? ` · spoke with ${esc(x.spoke_with)}` : ''}</div>
        ${x.what_they_said ? `<p>“${esc(x.what_they_said)}”</p>` : ''}</div></div>` })),
    // Order a visit by when it was logged if that was the same day; otherwise by its visit date.
    ...visits.map((v) => ({ at: new Date(v.created_at).toLocaleDateString('en-CA') === v.visit_date ? v.created_at : `${v.visit_date}T12:00:00`, html: `
      <div class="entry"><span class="dot ${v.new_color || v.color_at_visit || 'none'}" aria-hidden="true"></span><div>
        <strong>Visit${v.customer_confirmed && v.new_color ? ` — fixed, now ${COLOR_INFO[v.new_color].label}` : ''}</strong>
        <div class="small muted">${fmtDate(v.visit_date, { month: 'short', day: 'numeric', year: 'numeric' })} · ${esc(v.visited_by)}${v.met_with ? ` · met ${esc(v.met_with)}` : ''}</div>
        ${v.walkthrough_notes ? `<p><b>Saw:</b> ${esc(v.walkthrough_notes)}</p>` : ''}
        ${v.root_causes.length ? `<p><b>Cause:</b> ${esc(v.root_causes.join(', '))}</p>` : ''}
        ${v.action_taken ? `<p><b>Fix:</b> ${esc(v.action_taken)}</p>` : ''}
        ${v.employees_coached ? `<p><b>Coached:</b> ${esc(v.employees_coached)}</p>` : ''}
        ${v.customer_confirmed && v.confirmed_by ? `<p><b>Confirmed by:</b> ${esc(v.confirmed_by)} on ${fmtDate(v.confirmed_on, { month: 'short', day: 'numeric', year: 'numeric' })}</p>` : ''}
        ${v.followup_date ? `<p class="small muted">Follow-up call ${fmtDate(v.followup_date)}</p>` : ''}</div></div>` })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  const contact = (n, name, phone) => {
    if (!name && !phone) return '';
    const inner = `<small>CONTACT ${n}</small><span>${esc(name || '—')}</span>
      ${phone ? `<span class="call">${icons.phone} ${esc(phone)}</span>` : '<span class="muted small">No phone on file</span>'}`;
    return phone ? `<a class="contact" href="${telHref(phone)}">${inner}</a>` : `<div class="contact">${inner}</div>`;
  };

  const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const visitLine = c.current_color === 'red' || c.current_color === 'yellow'
    ? `Visit ${lowerFirst(relDue(c.visit_due_at))}` : c.current_color === 'green' ? `Rotation visit ${lowerFirst(relDue(c.visit_due_at))}` : '';

  setMain(`
    <a class="back" href="#/">${icons.back} Contracts</a>
    <div class="page-head">
      <div><h1>${esc(c.name)}</h1>
        <div class="sub row">#${esc(c.contract_number)} ${typeTag(c.agreement_type)}${demoTag(c)}${c.site_supervisor ? ` · Site supervisor: ${esc(c.site_supervisor)}` : ''}</div></div>
      ${pill(c.current_color)}
    </div>
    <div class="stack">
      <div class="card stack">
        <div class="row small">
          <span>${c.last_called_at ? `Last call ${fmtWhen(c.last_called_at)}` : 'Not called yet'}</span>
          ${c.call_due ? '<span class="due">· Call due now</span>' : `<span class="muted">· Next call ${fmtDate(c.call_due_at)}</span>`}
        </div>
        ${visitLine ? `<div class="small ${c.visit_overdue ? 'due' : ''}">${esc(visitLine)}${c.last_visited_at ? ` · last visit ${fmtDate(c.last_visited_at)}` : ''}</div>` : ''}
        <div class="stack" style="gap:6px">
          <div class="row" style="justify-content:space-between"><span class="label">Last 12 weeks</span>${trendBadge(hist.trend, { long: true })}</div>
          ${weekStrip(hist.colors, hist.week_ends)}
        </div>
        <div class="contacts">${contact(1, c.contact1_name, c.contact1_phone)}${contact(2, c.contact2_name, c.contact2_phone)}</div>
        ${(c.scope_link || c.checklist_link) ? `<div class="row small">
          ${c.scope_link ? `<a href="${esc(c.scope_link)}" target="_blank" rel="noopener">Scope of work</a>` : ''}
          ${c.checklist_link ? `<a href="${esc(c.checklist_link)}" target="_blank" rel="noopener">Cleaning checklist</a>` : ''}</div>` : ''}
        <div class="grid2">
          <a class="btn" href="#/contract/${c.id}/call">Log a call</a>
          <a class="btn secondary" href="#/contract/${c.id}/visit">Log a visit</a>
        </div>
        <a class="small" href="#/contract/${c.id}/edit">Edit contract details</a>
      </div>
      <h2 class="section-title">History</h2>
      ${history.length ? `<div class="card history">${history.map((h) => h.html).join('')}</div>` : '<div class="card empty">No calls or visits yet.</div>'}
    </div>`);
}

async function viewContractForm(id) {
  const c = id ? (await api(`/contracts/${id}`)).contract : { agreement_type: 'state', active: true };
  const v = (k) => esc(c[k] ?? '');
  setMain(`
    <a class="back" href="${id ? `#/contract/${id}` : '#/'}">${icons.back} ${id ? 'Back' : 'Contracts'}</a>
    <div class="page-head"><h1>${id ? 'Edit contract' : 'Add a contract'}</h1></div>
    <form class="card stack" novalidate>
      <div class="grid2">
        <div class="field"><label for="f-num">Contract number</label><input id="f-num" name="contract_number" type="text" required value="${v('contract_number')}"></div>
        <div class="field"><label for="f-name">Contract name / site</label><input id="f-name" name="name" type="text" required value="${v('name')}"></div>
      </div>
      <fieldset><legend>Agreement type</legend>
        <div class="row">
          <label class="choice"><input type="radio" name="agreement_type" value="state" ${c.agreement_type === 'state' ? 'checked' : ''}> WVARF / State</label>
          <label class="choice"><input type="radio" name="agreement_type" value="other" ${c.agreement_type === 'other' ? 'checked' : ''}> Other (private)</label>
        </div>
        <span class="hint">WVARF sees colors for WVARF / State contracts only. "Other" contracts stay private to your CRP.</span>
      </fieldset>
      <div class="grid2">
        <div class="field"><label for="f-c1n">Contact 1 name</label><input id="f-c1n" name="contact1_name" type="text" value="${v('contact1_name')}"></div>
        <div class="field"><label for="f-c1p">Contact 1 phone</label><input id="f-c1p" name="contact1_phone" type="tel" value="${v('contact1_phone')}"></div>
        <div class="field"><label for="f-c2n">Contact 2 name</label><input id="f-c2n" name="contact2_name" type="text" value="${v('contact2_name')}"></div>
        <div class="field"><label for="f-c2p">Contact 2 phone</label><input id="f-c2p" name="contact2_phone" type="tel" value="${v('contact2_phone')}"></div>
      </div>
      <div class="field"><label for="f-sup">Site supervisor</label><input id="f-sup" name="site_supervisor" type="text" value="${v('site_supervisor')}"></div>
      <div class="grid2">
        <div class="field"><label for="f-scope">Scope of work link <span class="muted">(optional)</span></label><input id="f-scope" name="scope_link" type="url" placeholder="https://" value="${v('scope_link')}"></div>
        <div class="field"><label for="f-check">Cleaning checklist link <span class="muted">(optional)</span></label><input id="f-check" name="checklist_link" type="url" placeholder="https://" value="${v('checklist_link')}"></div>
      </div>
      ${id ? `<label class="choice"><input type="checkbox" name="inactive" value="yes" ${c.active ? '' : 'checked'}> Contract has ended — hide from the list</label>` : ''}
      <button class="btn block" type="submit">${id ? 'Save changes' : 'Add contract'}</button>
    </form>`);
  wireForm(main.querySelector('form'), async (d) => {
    const body = { ...d, active: d.inactive !== 'yes' };
    if (id) {
      await api(`/contracts/${id}`, { method: 'PUT', body });
      toast('Contract saved');
      location.hash = body.active ? `#/contract/${id}` : '#/';
    } else {
      const created = await api('/contracts', { method: 'POST', body });
      toast('Contract added');
      location.hash = `#/contract/${created.id}`;
    }
  });
}

async function viewCall(id) {
  const { contract: c } = await api(`/contracts/${id}`);
  const contacts = [[c.contact1_name, c.contact1_phone], [c.contact2_name, c.contact2_phone]].filter(([n, p]) => n || p);
  setMain(`
    <a class="back" href="#/contract/${c.id}">${icons.back} ${esc(c.name)}</a>
    <div class="page-head"><div><h1>Check-in call</h1><div class="sub">${esc(c.name)} · last color: ${c.current_color ? COLOR_INFO[c.current_color].label : 'none'}</div></div></div>
    <form class="stack" novalidate>
      ${contacts.length ? `<div class="contacts">${contacts.map(([n, p], i) => p
        ? `<a class="contact" href="${telHref(p)}"><small>CONTACT ${i + 1}</small><span>${esc(n || '—')}</span><span class="call">${icons.phone} Call ${esc(p)}</span></a>`
        : `<div class="contact"><small>CONTACT ${i + 1}</small><span>${esc(n)}</span><span class="muted small">No phone on file</span></div>`).join('')}</div>` : ''}
      <div class="ask"><small>ASK</small><strong>“How is your janitorial service going?”</strong><span>By phone, not email. Then listen.</span></div>
      <div class="card stack">
        <div class="field"><label for="f-spoke">Spoke with</label>
          <input id="f-spoke" name="spoke_with" type="text" list="contact-names" value="${esc(c.contact1_name || '')}">
          <datalist id="contact-names">${contacts.map(([n]) => n ? `<option value="${esc(n)}">` : '').join('')}</datalist></div>
        <div class="field"><label for="f-said">What they said (their words)</label><textarea id="f-said" name="what_they_said" rows="3"></textarea></div>
        <fieldset><legend>Mark the color</legend>
          <div class="colors">
            ${['green', 'yellow', 'red'].map((k) => `
              <label class="colorpick ${k}"><input type="radio" name="color" value="${k}"><b>${COLOR_INFO[k].label.toUpperCase()}</b><span>${COLOR_INFO[k].says}</span></label>`).join('')}
          </div>
        </fieldset>
        <div id="next" class="banner info" hidden></div>
        <label class="choice"><input type="checkbox" name="no_answer" value="yes"> No answer — I'll call back</label>
        <button class="btn block" type="submit">Save call</button>
      </div>
    </form>`);
  const form = main.querySelector('form');
  const next = form.querySelector('#next');
  form.addEventListener('change', () => {
    const d = formData(form);
    const noAnswer = d.no_answer === 'yes';
    form.querySelectorAll('input[name=color]').forEach((i) => { i.disabled = noAnswer; if (noAnswer) i.checked = false; });
    next.hidden = noAnswer || !d.color;
    if (d.color && !noAnswer) next.innerHTML = `<span><strong>Next step:</strong> ${esc(COLOR_INFO[d.color].next)}</span>`;
  });
  wireForm(form, async (d) => {
    const noAnswer = d.no_answer === 'yes';
    if (!noAnswer && !d.color) throw new Error('Pick green, yellow or red — or check "No answer".');
    await api(`/contracts/${c.id}/calls`, { method: 'POST', body: { ...d, no_answer: noAnswer } });
    toast(noAnswer ? 'Attempt saved — still due for a call' : `Saved as ${COLOR_INFO[d.color].label}`);
    location.hash = `#/contract/${c.id}`;
  });
}

async function viewVisit(id) {
  const { contract: c, calls } = await api(`/contracts/${id}`);
  const lastIssue = calls.find((x) => !x.no_answer && x.what_they_said);
  setMain(`
    <a class="back" href="#/contract/${c.id}">${icons.back} ${esc(c.name)}</a>
    <div class="page-head"><div><h1>Site visit</h1><div class="sub">${esc(c.name)}</div></div>${pill(c.current_color)}</div>
    <form class="stack" novalidate>
      ${lastIssue ? `<div class="banner"><span><strong>Last call:</strong> “${esc(lastIssue.what_they_said)}”</span></div>` : ''}
      ${(c.scope_link || c.checklist_link) ? `<div class="grid2">
        ${c.scope_link ? `<a class="btn secondary" href="${esc(c.scope_link)}" target="_blank" rel="noopener">Scope of work</a>` : ''}
        ${c.checklist_link ? `<a class="btn secondary" href="${esc(c.checklist_link)}" target="_blank" rel="noopener">Cleaning checklist</a>` : ''}</div>` : ''}
      <div class="card stack">
        <div class="grid2">
          <div class="field"><label for="f-date">Visit date</label><input id="f-date" name="visit_date" type="date" value="${today()}" max="${today()}"></div>
          <div class="field"><label for="f-met">Met with</label><input id="f-met" name="met_with" type="text" value="${esc(c.contact1_name || '')}"></div>
        </div>
        <div class="field"><label for="f-saw">What I saw on the walkthrough</label><textarea id="f-saw" name="walkthrough_notes" rows="3"></textarea></div>
        <div class="row">
          <label class="choice"><input type="checkbox" name="scope_reviewed" value="yes"> Scope of work reviewed</label>
          <label class="choice"><input type="checkbox" name="checklist_reviewed" value="yes"> Checklist reviewed with customer</label>
        </div>
        <fieldset><legend>Root cause</legend><div class="row">
          ${ROOT_CAUSES.map((r) => `<label class="choice"><input type="checkbox" name="root_causes[]" value="${esc(r)}"> ${esc(r)}</label>`).join('')}
        </div></fieldset>
        <div class="field"><label for="f-fix">Action taken / the fix</label><textarea id="f-fix" name="action_taken" rows="3"></textarea></div>
        <div class="field"><label for="f-crew">Employees coached</label><input id="f-crew" name="employees_coached" type="text" placeholder="Names"></div>
      </div>
      <div class="card stack">
        <h2 class="small" style="font-size:16px;color:var(--blue)">Follow-up</h2>
        <div class="field"><label for="f-fu">Follow-up call date</label><input id="f-fu" name="followup_date" type="date"></div>
        <label class="choice"><input type="checkbox" name="customer_confirmed" value="yes" id="f-confirmed"> Customer confirmed it's fixed</label>
        <div id="confirmation" class="stack" hidden>
          <div class="grid2">
            <div class="field"><label for="f-cby">Confirmed by (customer contact)</label>
              <input id="f-cby" name="confirmed_by" type="text" list="confirm-names" autocomplete="off">
              <datalist id="confirm-names">${[c.contact1_name, c.contact2_name].filter(Boolean).map((n) => `<option value="${esc(n)}">`).join('')}</datalist></div>
            <div class="field"><label for="f-con">Date confirmed</label><input id="f-con" name="confirmed_on" type="date" value="${today()}" max="${today()}"></div>
          </div>
          <fieldset><legend>New color</legend>
            <div class="colors three">
              ${['green', 'yellow', 'red'].map((k) => `<label class="colorpick ${k}"><input type="radio" name="new_color" value="${k}"><b>${COLOR_INFO[k].label.toUpperCase()}</b></label>`).join('')}
            </div>
          </fieldset>
        </div>
        <span class="hint">The contract keeps its current color until a customer contact confirms the fix. Their name and the date are saved with the visit.</span>
        <button class="btn block" type="submit">Save visit</button>
      </div>
    </form>`);
  const form = main.querySelector('form');
  const confirmed = form.querySelector('#f-confirmed');
  const box = form.querySelector('#confirmation');
  confirmed.addEventListener('change', () => {
    box.hidden = !confirmed.checked;
    if (confirmed.checked) form.querySelector('#f-cby').focus();
  });
  // The fix can't be confirmed before the visit happened.
  const visitDate = form.querySelector('#f-date');
  const confirmDate = form.querySelector('#f-con');
  visitDate.addEventListener('change', () => {
    confirmDate.min = visitDate.value;
    if (confirmDate.value && confirmDate.value < visitDate.value) confirmDate.value = visitDate.value;
  });
  wireForm(form, async (d) => {
    const isConfirmed = d.customer_confirmed === 'yes';
    if (isConfirmed && !String(d.confirmed_by || '').trim()) throw new Error('Enter the name of the customer contact who confirmed the fix.');
    if (isConfirmed && !d.confirmed_on) throw new Error('Enter the date the customer confirmed the fix.');
    if (isConfirmed && !d.new_color) throw new Error('Pick the new color the customer confirmed.');
    await api(`/contracts/${c.id}/visits`, {
      method: 'POST',
      body: {
        ...d,
        root_causes: d.root_causes || [],
        scope_reviewed: d.scope_reviewed === 'yes',
        checklist_reviewed: d.checklist_reviewed === 'yes',
        customer_confirmed: isConfirmed,
        new_color: isConfirmed ? d.new_color : null,
        confirmed_by: isConfirmed ? d.confirmed_by : null,
        confirmed_on: isConfirmed ? d.confirmed_on : null,
      },
    });
    toast(isConfirmed ? `Visit saved — now ${COLOR_INFO[d.new_color].label}` : 'Visit saved');
    location.hash = `#/contract/${c.id}`;
  });
}

async function viewQueue() {
  const q = await api('/queue');
  const item = (c) => `
    <a class="card contract" href="#/contract/${c.id}">
      <div class="top"><div><div class="name">${esc(c.name)}</div><div class="meta">#${esc(c.contract_number)}${c.last_visited_at ? ` · last visit ${fmtDate(c.last_visited_at)}` : ''}</div></div>
      <span class="small ${c.visit_overdue ? 'due' : 'muted'}" style="font-weight:700">${esc(relDue(c.visit_due_at))}</span></div>
      <div class="row">${typeTag(c.agreement_type)}<span class="btn small">Start visit</span></div>
    </a>`;
  const group = (title, color, list, emptyText) => `
    <h2 class="section-title"><span class="dot ${color}" aria-hidden="true"></span>${title} <span class="muted small">(${list.length})</span></h2>
    ${list.length ? `<div class="list">${list.map(item).join('')}</div>` : `<div class="card empty small">${emptyText}</div>`}`;
  setMain(`
    <div class="page-head"><div><h1>Visit queue</h1><div class="sub">Reds first, then yellows, then greens due for a walkthrough</div></div></div>
    ${group('Red — visit now', 'red', q.red, 'No red contracts. Nice work.')}
    ${group('Yellow — visit next', 'yellow', q.yellow, 'No yellow contracts.')}
    ${group('Green — rotation due in the next 30 days', 'green', q.green, 'No green walkthroughs due soon.')}
    ${q.not_called.length ? `<div class="banner info" style="margin-top:16px"><span>${q.not_called.length} ${q.not_called.length === 1 ? 'contract has' : 'contracts have'} no color yet. <a href="#/">Call them first.</a></span></div>` : ''}`);
  // The whole card is a link; the "Start visit" span is visual. Send it to the visit form.
  main.querySelectorAll('a.contract').forEach((a) => {
    a.querySelector('.btn').addEventListener('click', (e) => { e.preventDefault(); location.hash = `${a.getAttribute('href')}/visit`; });
  });
}

let statewideDemo = false; // Real CRPs or Demo CRPs on the statewide view

async function viewStatewide() {
  const s = await api(`/statewide${statewideDemo ? '?demo=1' : ''}`);
  if (statewideDemo && !s.has_demo) { statewideDemo = false; return viewStatewide(); }
  const t = s.totals;
  const pct = (n, d) => d ? Math.round((n / d) * 100) : 0;
  const bar = (r) => `<div class="bar" role="img" aria-label="${r.green} green, ${r.yellow} yellow, ${r.red} red, ${r.not_called} not called">
    <i class="g" style="width:${pct(r.green, r.total)}%"></i><i class="y" style="width:${pct(r.yellow, r.total)}%"></i>
    <i class="r" style="width:${pct(r.red, r.total)}%"></i><i class="n" style="width:${pct(r.not_called, r.total)}%"></i></div>`;
  const scope = s.demo ? 'Demo CRPs' : 'Statewide';
  setMain(`
    <div class="page-head"><div><h1>Statewide view</h1><div class="sub">WVARF / State contracts only · private contracts are never shown · as of ${fmtWhen(s.as_of)}</div></div>
      <div class="row">
        ${s.has_demo ? `<div class="filters" role="group" aria-label="Which CRPs">
          <button type="button" data-scope="real" aria-pressed="${!s.demo}">Real CRPs</button>
          <button type="button" data-scope="demo" aria-pressed="${s.demo}">Demo CRPs</button></div>` : ''}
        <button class="btn secondary small" type="button" onclick="window.print()">Print</button>
      </div></div>
    ${s.demo ? '<div class="banner info" style="margin-bottom:12px"><span><strong>Demo CRPs</strong> — made-up practice data, kept out of the real statewide numbers.</span></div>' : ''}
    <div class="stack">
      <div class="kpis">
        <div class="kpi"><span>State contracts</span><b>${t.total}</b><span>${s.crps.length} ${s.crps.length === 1 ? 'CRP' : 'CRPs'}</span></div>
        <div class="kpi red"><span>Red</span><b>${t.red}</b></div>
        <div class="kpi yellow"><span>Yellow</span><b>${t.yellow}</b></div>
        <div class="kpi green"><span>Green</span><b>${t.green}</b><span>${pct(t.green, t.total)}% of contracts</span></div>
        <div class="kpi"><span>Called on schedule</span><b>${pct(t.on_schedule, t.total)}%</b><span>${t.total - t.on_schedule} overdue</span></div>
      </div>
      ${t.total ? trendCard(s.history, scope) : ''}
      <section class="card">
        <h2 class="section-title" style="margin-top:0">By CRP</h2>
        ${s.crps.length ? `<div class="tablewrap"><table>
          <thead><tr><th>CRP</th><th class="num">Contracts</th><th>Green / Yellow / Red now</th><th>12-week trend</th><th class="num">Red</th><th class="num">Oldest red</th><th class="num">On schedule</th></tr></thead>
          <tbody>${s.crps.map((r) => `<tr><td><strong>${esc(r.name)}</strong></td><td class="num">${r.total}</td><td>${bar(r)}</td>
            <td><div class="trendrow">${sparkline(r.history.weeks.map((w) => w.score), `${r.name}: ${sparkLabel(r.history.weeks.map((w) => w.score))}`)}${trendBadge(r.history.trend)}</div></td>
            <td class="num" style="color:var(--red);font-weight:800">${r.red}</td>
            <td class="num">${r.oldest_red_days === null ? '—' : `${r.oldest_red_days} days`}</td>
            <td class="num">${pct(r.on_schedule, r.total)}%</td></tr>`).join('')}</tbody></table></div>`
          : `<p class="muted">${s.demo ? 'No demo data loaded.' : 'No WVARF / State contracts have been added yet.'}</p>`}
      </section>
      <section class="card">
        <h2 class="section-title" style="margin-top:0"><span class="dot red" aria-hidden="true"></span>Open reds</h2>
        ${s.open_reds.length ? `<div class="tablewrap"><table>
          <thead><tr><th>Contract</th><th>CRP</th><th class="num">Days red</th><th>Visit</th></tr></thead>
          <tbody>${s.open_reds.map((r) => `<tr><td>${esc(r.name)} <span class="muted small">#${esc(r.contract_number)}</span></td><td>${esc(r.crp_name)}</td>
            <td class="num">${r.days_red}</td><td class="${r.visit_overdue && !r.last_visited_at ? 'due' : ''}">${r.last_visited_at ? `Visited ${fmtDate(r.last_visited_at)}` : esc(relDue(r.visit_due_at))}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">No open reds.</p>'}
      </section>
    </div>`);
  main.querySelectorAll('[data-scope]').forEach((b) => {
    b.onclick = () => { statewideDemo = b.dataset.scope === 'demo'; viewStatewide().catch(errorView); };
  });
}

// What happened to the sign-in invitation, in words for the admin.
// kind: 'ok' shows as a toast; anything else stays on screen until the next action.
function inviteMessage(email, r) {
  switch (r.invite) {
    case 'sent': return { kind: 'ok', text: `Invitation email sent to ${email}.` };
    case 'already_registered': return { kind: 'ok', text: `${email} already has a login — they can sign in now.` };
    case 'failed': return { kind: 'warn', text: `${email} was saved, but the invitation email could not be sent (${r.invite_error}). Try "Send invite" again, or contact your WVARF administrator.` };
    case 'unavailable': return { kind: 'warn', text: `${email} was saved, but invitations can't be sent from this site yet. Contact your WVARF administrator.` };
    default: return null;
  }
}
let adminNotice = null;

async function viewAdmin() {
  const wvarf = me.is_wvarf_admin;
  const [members, crps] = await Promise.all([api('/admin/members'), wvarf ? api('/admin/crps') : Promise.resolve([])]);
  const roleName = { supervisor: 'Supervisor', crp_admin: 'CRP admin', wvarf_admin: 'WVARF admin' };
  const notice = adminNotice;
  adminNotice = null;
  setMain(`
    <div class="page-head"><div><h1>People${wvarf ? ' & CRPs' : ''}</h1>
      <div class="sub">Adding a new person emails them an invitation to set their password and sign in. Everyone at a CRP sees all of that CRP's contracts.</div></div></div>
    <div class="stack">
      ${notice ? `<div class="form-error" role="alert">${esc(notice)}</div>` : ''}
      ${!wvarf && me.crp ? `<form class="card stack" id="settings" novalidate>
        <h2 class="small" style="font-size:16px;color:var(--blue)">${esc(me.crp.name)} settings</h2>
        <div class="field"><label for="f-sched">Call every contract</label>
          <select id="f-sched" name="call_schedule">${Object.entries(SCHEDULES).map(([k, l]) => `<option value="${k}" ${me.crp.call_schedule === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <span class="hint">Weekly is best. Never less than monthly.</span></div>
        <button class="btn" type="submit">Save settings</button>
      </form>` : ''}
      ${wvarf ? `<form class="card stack" id="newcrp" novalidate>
        <h2 class="small" style="font-size:16px;color:var(--blue)">Add a CRP</h2>
        <div class="grid2">
          <div class="field"><label for="f-crp">CRP name</label><input id="f-crp" name="name" type="text" required></div>
          <div class="field"><label for="f-crps">Call schedule</label><select id="f-crps" name="call_schedule">${Object.entries(SCHEDULES).map(([k, l]) => `<option value="${k}" ${k === 'biweekly' ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <button class="btn" type="submit">Add CRP</button>
      </form>` : ''}
      <form class="card stack" id="newmember" novalidate>
        <h2 class="small" style="font-size:16px;color:var(--blue)">Add or update a person</h2>
        <div class="grid2">
          <div class="field"><label for="f-email">Email</label><input id="f-email" name="email" type="email" required autocomplete="off"></div>
          <div class="field"><label for="f-pname">Name</label><input id="f-pname" name="name" type="text"></div>
          ${wvarf ? `<div class="field"><label for="f-pcrp">CRP</label><select id="f-pcrp" name="crp_id"><option value="">— None (WVARF admin only) —</option>
            ${crps.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>` : ''}
          <div class="field"><label for="f-role">Role</label><select id="f-role" name="role">
            <option value="supervisor">Supervisor</option><option value="crp_admin">CRP admin (can add people)</option>
            ${wvarf ? '<option value="wvarf_admin">WVARF admin (statewide view)</option>' : ''}</select></div>
        </div>
        <button class="btn" type="submit">Save person</button>
      </form>
      <section class="card">
        <h2 class="section-title" style="margin-top:0">People (${members.length})</h2>
        <div class="tablewrap"><table>
          <thead><tr><th>Person</th>${wvarf ? '<th>CRP</th>' : ''}<th>Role</th><th></th></tr></thead>
          <tbody>${members.map((m) => `<tr><td class="email">${m.name ? `<strong>${esc(m.name)}</strong><br>` : ''}<span class="small">${esc(m.email)}</span></td>${wvarf ? `<td>${esc(m.crp_name || '—')}</td>` : ''}
            <td>${roleName[m.role]}</td>
            <td class="num">${m.email !== me.email ? `<div class="actions">
              <button class="btn secondary small" type="button" data-invite="${esc(m.email)}">Send invite</button>
              <button class="btn danger small" type="button" data-remove="${esc(m.email)}">Remove</button></div>` : '<span class="muted small">You</span>'}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>
      ${wvarf && crps.length ? `<section class="card"><h2 class="section-title" style="margin-top:0">CRPs (${crps.length})</h2>
        <div class="tablewrap"><table><thead><tr><th>CRP</th><th>Call schedule</th><th class="num">People</th></tr></thead>
        <tbody>${crps.map((p) => `<tr><td>${esc(p.name)}</td><td>${SCHEDULES[p.call_schedule]}</td><td class="num">${p.member_count}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    </div>`);

  const settings = main.querySelector('#settings');
  if (settings) wireForm(settings, async (d) => { me.crp = await api('/crp/settings', { method: 'PUT', body: d }); toast('Settings saved'); });
  const newcrp = main.querySelector('#newcrp');
  if (newcrp) wireForm(newcrp, async (d) => { await api('/admin/crps', { method: 'POST', body: d }); toast('CRP added'); viewAdmin().catch(errorView); });
  wireForm(main.querySelector('#newmember'), async (d) => {
    const saved = await api('/admin/members', { method: 'POST', body: d });
    const msg = inviteMessage(saved.email, saved);
    if (msg && msg.kind !== 'ok') adminNotice = msg.text;
    toast(msg && msg.kind === 'ok' ? `Saved. ${msg.text}` : 'Person saved');
    viewAdmin().catch(errorView);
  });
  main.querySelectorAll('[data-invite]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api(`/admin/members/${encodeURIComponent(b.dataset.invite)}/invite`, { method: 'POST', body: {} });
        const msg = inviteMessage(r.email, r);
        if (msg && msg.kind === 'ok') toast(msg.text);
        else { adminNotice = msg ? msg.text : 'The invitation could not be sent.'; viewAdmin().catch(errorView); }
      } catch (ex) { toast(ex.message); }
      finally { b.disabled = false; }
    };
  });
  main.querySelectorAll('[data-remove]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`Remove ${b.dataset.remove}? They will lose access.`)) return;
      try { await api(`/admin/members/${encodeURIComponent(b.dataset.remove)}`, { method: 'DELETE' }); toast('Removed'); viewAdmin(); }
      catch (ex) { toast(ex.message); }
    };
  });
}

async function viewDemo() {
  const crps = await api('/demo');
  const demoCrps = crps.filter((p) => p.is_demo);
  const status = (p) => p.is_demo ? `<span class="tag demo">Demo CRP</span> <span class="small muted">${p.demo_contracts} made-up contracts</span>`
    : p.can_use_for_demo ? '<span class="small muted">Empty — can hold demo data</span>'
    : `<span class="small muted">Has ${p.real_contracts} real contract${p.real_contracts === 1 ? '' : 's'} — can't be used for the demo</span>`;
  setMain(`
    <div class="page-head"><div><h1>Demo</h1>
      <div class="sub">A safe place for staff to try every feature with made-up data: six months of pretend calls and visits in every color.</div></div></div>
    <div class="stack">
      ${demoCrps.length ? `<section class="card stack">
        <h2 class="cardtitle">Practice as a CRP</h2>
        <p class="small" style="margin:0">Step into a demo CRP as if you were its CRP admin. Log calls, record visits, add contracts and watch the colors and trends change. People can't be added in practice mode, so no emails go out.</p>
        <div class="list">${demoCrps.map((p) => `
          <div class="card contract" style="box-shadow:none;border:1.5px solid var(--line)">
            <div class="top"><div><div class="name">${esc(p.name)}</div><div class="meta">${p.demo_contracts} made-up contracts</div></div><span class="tag demo">Demo</span></div>
            <button class="btn" type="button" data-practice="${p.id}" data-name="${esc(p.name)}">Practice as ${esc(p.name)}</button>
          </div>`).join('')}</div>
        <p class="small muted" style="margin:0">To compare the demo CRPs' trends, open <a href="#/statewide">Statewide</a> and switch to <strong>Demo CRPs</strong>.</p>
      </section>` : ''}
      <form class="card stack" id="demo-form" novalidate>
        <h2 class="cardtitle">${demoCrps.length ? 'Reload or change the demo data' : 'Set up the demo'}</h2>
        <p class="small" style="margin:0">Pick your test CRPs. Each gets 10 made-up contracts with 6 months of calls and visits: the first CRP's service is <strong>improving</strong> and the second's is <strong>slipping</strong>, with greens, yellows, reds, overdue calls and fixed problems in both. Loading again resets everything staff changed.</p>
        <fieldset><legend>CRPs</legend>
          ${crps.length ? crps.map((p) => `<label class="choice" style="justify-content:space-between;border-radius:12px;padding:10px 12px;min-height:48px">
            <span class="row" style="gap:8px"><input type="checkbox" name="crp_ids[]" value="${p.id}" ${p.can_use_for_demo ? '' : 'disabled'} ${p.is_demo ? 'checked' : ''}> <strong>${esc(p.name)}</strong></span>
            <span>${status(p)}</span></label>`).join('')
            : '<p class="muted small">No CRPs yet. Add your test CRPs on the <a href="#/admin">People</a> page first.</p>'}
        </fieldset>
        <p class="hint" style="margin:0">Only CRPs with no real contracts can hold demo data, so real and made-up data never mix. Demo CRPs are left out of the real statewide numbers.</p>
        <div class="row">
          <button class="btn" type="submit">${demoCrps.length ? 'Reload demo data' : 'Load demo data'}</button>
          ${demoCrps.length ? '<button class="btn danger" type="button" id="demo-clear">Remove all demo data</button>' : ''}
        </div>
      </form>
      <section class="card stack">
        <h2 class="cardtitle">Things to try</h2>
        <ol class="small" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">
          <li>Open <strong>Contracts</strong>: read the 12-week trend chart, then filter to <strong>Slipping</strong>.</li>
          <li>Open a red contract, look at its 12-week strip and history, then <strong>Log a call</strong> and mark it yellow.</li>
          <li>Go to <strong>Visits</strong>, start a visit on a red, check "Customer confirmed it's fixed", and mark it green.</li>
          <li>Find the contract with <strong>Call due</strong> and log a "No answer" call — it stays due.</li>
          <li>Add a contract of your own, then call it twice with different colors.</li>
          <li>Exit practice and compare both demo CRPs on <strong>Statewide → Demo CRPs</strong>.</li>
        </ol>
      </section>
    </div>`);
  main.querySelectorAll('[data-practice]').forEach((b) => {
    b.onclick = () => { setPractice({ id: Number(b.dataset.practice), name: b.dataset.name }); location.hash = '#/'; };
  });
  wireForm(main.querySelector('#demo-form'), async (d) => {
    const ids = (d.crp_ids || []).map(Number);
    if (!ids.length) throw new Error('Pick at least one CRP.');
    if (demoCrps.length && !confirm('Reload the demo data? Anything staff changed in the demo CRPs will be reset.')) return;
    const r = await api('/demo/load', { method: 'POST', body: { crp_ids: ids } });
    toast(`Demo loaded: ${r.contracts} made-up contracts`);
    viewDemo().catch(errorView);
  });
  const clear = main.querySelector('#demo-clear');
  if (clear) clear.onclick = async () => {
    if (!confirm('Remove all demo data? The demo CRPs stay, but their made-up contracts, calls and visits are deleted.')) return;
    try { await api('/demo/clear', { method: 'POST', body: {} }); toast('Demo data removed'); viewDemo(); } catch (ex) { toast(ex.message); }
  };
}

// ---------- router ----------

async function route() {
  captureEmailLink();
  const link = getPendingLink();
  if (link) return renderSetPassword(link);

  let user = null;
  try { user = await auth.getUser(); } catch { user = null; }
  if (!user) return renderSignIn();

  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const key = parts[0] || '';
  try {
    if (!me) me = await api('/me');
    renderShell(key);
    if (key === 'account') return await viewAccount();
    if (!me.crp && !me.is_wvarf_admin) return renderNoAccess();
    if (!me.crp && ['', 'contract', 'queue'].includes(key)) { location.hash = '#/statewide'; return; }

    if (key === '') return await viewContracts();
    if (key === 'queue') return await viewQueue();
    if (key === 'statewide' && me.is_wvarf_admin) return await viewStatewide();
    if (key === 'demo' && me.is_wvarf_admin) return await viewDemo();
    if (key === 'admin' && (me.can_admin_crp || me.is_wvarf_admin)) return await viewAdmin();
    if (key === 'contract') {
      if (parts[1] === 'new') return await viewContractForm(null);
      const id = Number(parts[1]);
      if (!Number.isInteger(id)) throw Object.assign(new Error('Page not found'), { status: 404 });
      if (parts[2] === 'call') return await viewCall(id);
      if (parts[2] === 'visit') return await viewVisit(id);
      if (parts[2] === 'edit') return await viewContractForm(id);
      return await viewContract(id);
    }
    location.hash = '#/';
  } catch (ex) {
    errorView(ex);
  }
}

window.addEventListener('hashchange', route);
// Signing out in another tab signs out here too.
try {
  auth.onAuthChange((event) => {
    if (event === auth.AUTH_EVENTS.LOGOUT && me) { me = null; renderSignIn({ note: 'You are signed out.' }); }
  });
} catch { /* older browsers */ }
route();
