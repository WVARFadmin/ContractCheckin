// Contract Check-In — single-page app (no build step).
// Routes use the URL hash: #/, #/contract/12, #/contract/12/call, #/queue, ...

const identity = window.netlifyIdentity;
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
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  phone: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
};

// ---------- API ----------

async function api(path, { method = 'GET', body } = {}) {
  const user = identity.currentUser();
  if (!user) throw Object.assign(new Error('Please sign in'), { status: 401 });
  const token = await user.jwt(); // refreshes the token when it is about to expire
  const res = await fetch(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
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
  if (!me) { nav.innerHTML = ''; who.innerHTML = ''; return; }
  const tabs = [];
  if (me.crp) {
    tabs.push(['#/', 'Contracts', icons.list, ['', 'contract']]);
    tabs.push(['#/queue', 'Visits', icons.pin, ['queue']]);
  }
  if (me.is_wvarf_admin) tabs.push(['#/statewide', 'Statewide', icons.chart, ['statewide']]);
  if (me.can_admin_crp || me.is_wvarf_admin) tabs.push(['#/admin', 'People', icons.people, ['admin']]);
  nav.innerHTML = tabs.length > 1
    ? tabs.map(([href, label, icon, keys]) =>
      `<a href="${href}" ${keys.includes(route) ? 'aria-current="page"' : ''}>${icon}${label}</a>`).join('')
    : '';
  who.innerHTML = `<span class="crpname">${esc(me.crp ? me.crp.name : (me.is_wvarf_admin ? 'WVARF' : ''))}</span>
    <button class="linkbtn" type="button" id="signout">Sign out</button>`;
  document.getElementById('signout').onclick = () => identity.logout();
}

function setMain(html) {
  main.innerHTML = html;
  window.scrollTo(0, 0);
}

function errorView(ex) {
  if (ex.status === 401) return renderSignedOut();
  setMain(`<div class="card stack"><h1 class="small">Something went wrong</h1><p>${esc(ex.message)}</p>
    <div><button class="btn secondary" type="button" onclick="location.reload()">Try again</button></div></div>`);
}

// ---------- views ----------

function renderSignedOut() {
  me = null;
  renderShell('');
  setMain(`<section class="landing">
    <div class="bigdots" aria-hidden="true"><i style="background:var(--green)"></i><i style="background:var(--yellow)"></i><i style="background:var(--red)"></i></div>
    <h1>Contract Check-In</h1>
    <p>Call every janitorial customer, mark green, yellow or red, and see which sites need a visit first.</p>
    <button class="btn" type="button" id="signin">Sign in</button>
    <p class="small muted">New here? Use the invitation email you received, or ask your CRP or WVARF administrator to add you.</p>
  </section>`);
  document.getElementById('signin').onclick = () => identity.open('login');
}

function renderNoAccess() {
  setMain(`<section class="landing">
    <h1>Almost there</h1>
    <p>You're signed in as <strong>${esc(me.email)}</strong>, but your account isn't linked to a CRP yet.</p>
    <p class="muted">Ask your CRP administrator or WVARF to add this email address. Then refresh this page.</p>
    <button class="btn secondary" type="button" onclick="location.reload()">Refresh</button>
  </section>`);
}

async function viewContracts() {
  const data = await api('/contracts');
  const { counts, contracts, calls_due, crp } = data;
  const shown = listFilter === 'all' ? contracts
    : listFilter === 'due' ? contracts.filter((c) => c.call_due)
    : contracts.filter((c) => (c.current_color || 'none') === listFilter);
  const filters = [['all', 'All'], ['due', 'Calls due'], ['red', 'Red'], ['yellow', 'Yellow'], ['green', 'Green']];
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
        </a>`).join('')}</div>`
        : `<div class="card empty">${contracts.length ? 'Nothing in this filter.' : 'No contracts yet. Add each janitorial contract to start.'}</div>`}
    </div>`);
  main.querySelectorAll('[data-filter]').forEach((b) => {
    b.onclick = () => { listFilter = b.dataset.filter; viewContracts().catch(errorView); };
  });
}

async function viewContract(id) {
  const { contract: c, calls, visits } = await api(`/contracts/${id}`);
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
        <div class="sub row">#${esc(c.contract_number)} ${typeTag(c.agreement_type)}${c.site_supervisor ? ` · Site supervisor: ${esc(c.site_supervisor)}` : ''}</div></div>
      ${pill(c.current_color)}
    </div>
    <div class="stack">
      <div class="card stack">
        <div class="row small">
          <span>${c.last_called_at ? `Last call ${fmtWhen(c.last_called_at)}` : 'Not called yet'}</span>
          ${c.call_due ? '<span class="due">· Call due now</span>' : `<span class="muted">· Next call ${fmtDate(c.call_due_at)}</span>`}
        </div>
        ${visitLine ? `<div class="small ${c.visit_overdue ? 'due' : ''}">${esc(visitLine)}${c.last_visited_at ? ` · last visit ${fmtDate(c.last_visited_at)}` : ''}</div>` : ''}
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

async function viewStatewide() {
  const s = await api('/statewide');
  const t = s.totals;
  const pct = (n, d) => d ? Math.round((n / d) * 100) : 0;
  const bar = (r) => `<div class="bar" role="img" aria-label="${r.green} green, ${r.yellow} yellow, ${r.red} red, ${r.not_called} not called">
    <i class="g" style="width:${pct(r.green, r.total)}%"></i><i class="y" style="width:${pct(r.yellow, r.total)}%"></i>
    <i class="r" style="width:${pct(r.red, r.total)}%"></i><i class="n" style="width:${pct(r.not_called, r.total)}%"></i></div>`;
  setMain(`
    <div class="page-head"><div><h1>Statewide view</h1><div class="sub">WVARF / State contracts only · private contracts are never shown · as of ${fmtWhen(s.as_of)}</div></div>
      <button class="btn secondary small" type="button" onclick="window.print()">Print</button></div>
    <div class="stack">
      <div class="kpis">
        <div class="kpi"><span>State contracts</span><b>${t.total}</b><span>${s.crps.length} ${s.crps.length === 1 ? 'CRP' : 'CRPs'}</span></div>
        <div class="kpi red"><span>Red</span><b>${t.red}</b></div>
        <div class="kpi yellow"><span>Yellow</span><b>${t.yellow}</b></div>
        <div class="kpi green"><span>Green</span><b>${t.green}</b><span>${pct(t.green, t.total)}% of contracts</span></div>
        <div class="kpi"><span>Called on schedule</span><b>${pct(t.on_schedule, t.total)}%</b><span>${t.total - t.on_schedule} overdue</span></div>
      </div>
      <section class="card">
        <h2 class="section-title" style="margin-top:0">By CRP</h2>
        ${s.crps.length ? `<div class="tablewrap"><table>
          <thead><tr><th>CRP</th><th class="num">Contracts</th><th>Green / Yellow / Red</th><th class="num">Red</th><th class="num">Oldest red</th><th class="num">On schedule</th></tr></thead>
          <tbody>${s.crps.map((r) => `<tr><td><strong>${esc(r.name)}</strong></td><td class="num">${r.total}</td><td>${bar(r)}</td>
            <td class="num" style="color:var(--red);font-weight:800">${r.red}</td>
            <td class="num">${r.oldest_red_days === null ? '—' : `${r.oldest_red_days} days`}</td>
            <td class="num">${pct(r.on_schedule, r.total)}%</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">No WVARF / State contracts have been added yet.</p>'}
      </section>
      <section class="card">
        <h2 class="section-title" style="margin-top:0"><span class="dot red" aria-hidden="true"></span>Open reds</h2>
        ${s.open_reds.length ? `<div class="tablewrap"><table>
          <thead><tr><th>Contract</th><th>CRP</th><th class="num">Days red</th><th>Visit</th></tr></thead>
          <tbody>${s.open_reds.map((r) => `<tr><td>${esc(r.name)} <span class="muted small">#${esc(r.contract_number)}</span></td><td>${esc(r.crp_name)}</td>
            <td class="num">${r.days_red}</td><td class="${r.visit_overdue && !r.last_visited_at ? 'due' : ''}">${r.last_visited_at ? `Visited ${fmtDate(r.last_visited_at)}` : esc(relDue(r.visit_due_at))}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">No open reds statewide.</p>'}
      </section>
    </div>`);
}

async function viewAdmin() {
  const wvarf = me.is_wvarf_admin;
  const [members, crps] = await Promise.all([api('/admin/members'), wvarf ? api('/admin/crps') : Promise.resolve([])]);
  const roleName = { supervisor: 'Supervisor', crp_admin: 'CRP admin', wvarf_admin: 'WVARF admin' };
  setMain(`
    <div class="page-head"><div><h1>People${wvarf ? ' & CRPs' : ''}</h1>
      <div class="sub">Add someone's email here, then invite them to sign in (see the setup guide). Everyone at a CRP sees all of that CRP's contracts.</div></div></div>
    <div class="stack">
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
          <thead><tr><th>Email</th><th>Name</th>${wvarf ? '<th>CRP</th>' : ''}<th>Role</th><th></th></tr></thead>
          <tbody>${members.map((m) => `<tr><td>${esc(m.email)}</td><td>${esc(m.name || '')}</td>${wvarf ? `<td>${esc(m.crp_name || '—')}</td>` : ''}
            <td>${roleName[m.role]}</td>
            <td class="num">${m.email !== me.email ? `<button class="btn danger small" type="button" data-remove="${esc(m.email)}">Remove</button>` : '<span class="muted small">You</span>'}</td></tr>`).join('')}</tbody>
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
    await api('/admin/members', { method: 'POST', body: d });
    toast('Person saved');
    viewAdmin().catch(errorView);
  });
  main.querySelectorAll('[data-remove]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`Remove ${b.dataset.remove}? They will lose access.`)) return;
      try { await api(`/admin/members/${encodeURIComponent(b.dataset.remove)}`, { method: 'DELETE' }); toast('Removed'); viewAdmin(); }
      catch (ex) { toast(ex.message); }
    };
  });
}

// ---------- router ----------

async function route() {
  if (!identity.currentUser()) return renderSignedOut();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const key = parts[0] || '';
  try {
    if (!me) me = await api('/me');
    renderShell(key);
    if (!me.crp && !me.is_wvarf_admin) return renderNoAccess();
    if (!me.crp && ['', 'contract', 'queue'].includes(key)) { location.hash = '#/statewide'; return; }

    if (key === '') return await viewContracts();
    if (key === 'queue') return await viewQueue();
    if (key === 'statewide' && me.is_wvarf_admin) return await viewStatewide();
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

// The login widget starts itself when the page loads; begin routing once it is ready.
let started = false;
function start() {
  if (started) return;
  started = true;
  window.addEventListener('hashchange', route);
  route();
}
identity.on('init', start);
identity.on('login', () => { identity.close(); me = null; if (started) route(); else start(); });
identity.on('logout', () => { me = null; location.hash = '#/'; renderSignedOut(); });
window.addEventListener('load', () => setTimeout(start, 0));
