// Core API for Contract Check-In.
// Kept free of Netlify-specific imports so it can be tested against any Postgres.
//
// createApi({ query, getUser, inviteUser, adminEmails, now }) returns handle(req) -> Response
//   query(text, params) -> Promise<rows[]>
//   getUser(req)        -> Promise<{ email, name } | null>  (verified login)
//   inviteUser(email, name) -> Promise<'sent' | 'already_registered'>  (sends the sign-in invite email;
//                          throws if it could not be sent)
//   adminEmails         -> string[] of emails that are always WVARF admins

export const COLORS = ['green', 'yellow', 'red'];
export const SCHEDULE_DAYS = { weekly: 7, biweekly: 14, monthly: 30 };
export const ROOT_CAUSES = ['Missed task', 'Not in scope', 'Staffing', 'Training', 'Supplies / equipment', 'Other'];
const RED_VISIT_BUSINESS_DAYS = 2;
const YELLOW_VISIT_DAYS = 14;
const GREEN_ROTATION_DAYS = 90;
const GREEN_LOOKAHEAD_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

// ---------- input helpers ----------

function text(value, max = 500) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function requiredText(value, field, max = 200) {
  const s = text(value, max);
  if (!s) throw new HttpError(400, `${field} is required`);
  return s;
}

function color(value, field = 'color', required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  const c = String(value).toLowerCase();
  if (!COLORS.includes(c)) throw new HttpError(400, `${field} must be green, yellow or red`);
  return c;
}

function bool(value) {
  if (value === undefined || value === null || value === '') return null;
  return value === true || value === 'true' || value === 'yes';
}

function date(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new HttpError(400, `${field} must be a date (YYYY-MM-DD)`);
  }
  return s;
}

function link(value) {
  const s = text(value, 1000);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) throw new HttpError(400, 'Links must start with http:// or https://');
  return s;
}

function normEmail(value) {
  const s = text(value, 254);
  if (!s || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, 'A valid email is required');
  return s.toLowerCase();
}

function intId(value, field = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${field}`);
  return n;
}

// ---------- date math ----------

function addBusinessDays(start, days) {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) added++;
  }
  return d;
}

// DATE columns are returned as plain 'YYYY-MM-DD' text; as JS Dates they land at
// midnight UTC and show as the previous day in Eastern time.
const VISIT_COLS = `id, contract_id, visit_date::text AS visit_date, visited_by, met_with, color_at_visit,
  walkthrough_notes, scope_reviewed, checklist_reviewed, root_causes, action_taken, employees_coached,
  followup_date::text AS followup_date, customer_confirmed, new_color, confirmed_by,
  confirmed_on::text AS confirmed_on, created_at`;

const addDays = (start, days) => new Date(new Date(start).getTime() + days * DAY);
const toIso = (d) => (d ? new Date(d).toISOString() : null);
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / DAY);

// ---------- the API ----------

export function createApi({ query, getUser, inviteUser = null, adminEmails = [], now = () => new Date() }) {
  const admins = adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);

  async function one(textSql, params) {
    const rows = await query(textSql, params);
    return rows[0] || null;
  }

  // Who is calling, and what are they allowed to do?
  async function loadMember(req) {
    const user = await getUser(req);
    if (!user || !user.email) throw new HttpError(401, 'Please sign in');
    const email = user.email.toLowerCase();
    let member = await one('SELECT * FROM members WHERE email = $1', [email]);

    if (admins.includes(email) && (!member || member.role !== 'wvarf_admin')) {
      member = await one(
        `INSERT INTO members (email, name, role) VALUES ($1, $2, 'wvarf_admin')
         ON CONFLICT (email) DO UPDATE SET role = 'wvarf_admin'
         RETURNING *`,
        [email, text(user.name, 120)]
      );
    } else if (member && !member.name && user.name) {
      member = await one('UPDATE members SET name = $2 WHERE email = $1 RETURNING *', [email, text(user.name, 120)]);
    }
    return { email, name: user.name || null, member };
  }

  function requireCrp(ctx) {
    if (!ctx.member || !ctx.member.crp_id) {
      throw new HttpError(403, 'Your account is not linked to a CRP yet. Ask your WVARF administrator to add you.');
    }
    return ctx.member.crp_id;
  }

  const isWvarf = (ctx) => ctx.member && ctx.member.role === 'wvarf_admin';
  const isCrpAdmin = (ctx) => ctx.member && (ctx.member.role === 'crp_admin' || ctx.member.role === 'wvarf_admin');

  function requireWvarf(ctx) {
    if (!isWvarf(ctx)) throw new HttpError(403, 'Only WVARF administrators can do this');
  }

  async function loadOwnContract(ctx, id) {
    const crpId = requireCrp(ctx);
    const c = await one('SELECT * FROM contracts WHERE id = $1', [intId(id, 'contract')]);
    // Same answer for "missing" and "someone else's" so contracts can't be probed.
    if (!c || c.crp_id !== crpId) throw new HttpError(404, 'Contract not found');
    return c;
  }

  async function crpOf(ctx) {
    const crpId = requireCrp(ctx);
    return one('SELECT * FROM crps WHERE id = $1', [crpId]);
  }

  // ----- status logic shared by list, queue and summary -----

  function decorate(c, schedule) {
    const t = now();
    const sched = SCHEDULE_DAYS[schedule] || 14;
    const callDueAt = c.last_called_at ? addDays(c.last_called_at, sched) : t;
    let visitDueAt = null;
    if (c.current_color === 'red' && c.color_since) visitDueAt = addBusinessDays(c.color_since, RED_VISIT_BUSINESS_DAYS);
    else if (c.current_color === 'yellow' && c.color_since) visitDueAt = addDays(c.color_since, YELLOW_VISIT_DAYS);
    else visitDueAt = c.last_visited_at ? addDays(c.last_visited_at, GREEN_ROTATION_DAYS) : t;
    return {
      ...c,
      call_due: callDueAt <= t,
      call_due_at: toIso(callDueAt),
      visit_due_at: toIso(visitDueAt),
      visit_overdue: visitDueAt <= t,
      days_in_color: c.color_since ? daysBetween(c.color_since, t) : null,
    };
  }

  // ----- route handlers -----

  async function me(ctx) {
    const crp = ctx.member && ctx.member.crp_id ? await one('SELECT * FROM crps WHERE id = $1', [ctx.member.crp_id]) : null;
    return {
      email: ctx.email,
      name: (ctx.member && ctx.member.name) || ctx.name,
      role: ctx.member ? ctx.member.role : null,
      crp,
      can_admin_crp: !!(crp && isCrpAdmin(ctx)),
      is_wvarf_admin: isWvarf(ctx),
    };
  }

  async function listContracts(ctx) {
    const crp = await crpOf(ctx);
    const rows = await query(
      'SELECT * FROM contracts WHERE crp_id = $1 AND active ORDER BY name',
      [crp.id]
    );
    const list = rows.map((c) => decorate(c, crp.call_schedule));
    const counts = { green: 0, yellow: 0, red: 0, none: 0 };
    for (const c of list) counts[c.current_color || 'none']++;
    return {
      crp,
      counts,
      calls_due: list.filter((c) => c.call_due).length,
      contracts: list,
    };
  }

  function contractFields(body) {
    const type = body.agreement_type === 'other' ? 'other' : body.agreement_type === 'state' ? 'state' : null;
    if (!type) throw new HttpError(400, 'Agreement type must be WVARF / State or Other');
    return {
      contract_number: requiredText(body.contract_number, 'Contract number', 60),
      name: requiredText(body.name, 'Contract name', 160),
      agreement_type: type,
      contact1_name: text(body.contact1_name, 120),
      contact1_phone: text(body.contact1_phone, 40),
      contact2_name: text(body.contact2_name, 120),
      contact2_phone: text(body.contact2_phone, 40),
      site_supervisor: text(body.site_supervisor, 120),
      scope_link: link(body.scope_link),
      checklist_link: link(body.checklist_link),
    };
  }

  async function createContract(ctx, body) {
    const crpId = requireCrp(ctx);
    const f = contractFields(body);
    const dupe = await one('SELECT id FROM contracts WHERE crp_id = $1 AND contract_number = $2', [crpId, f.contract_number]);
    if (dupe) throw new HttpError(409, 'That contract number is already on your roster');
    return one(
      `INSERT INTO contracts (crp_id, contract_number, name, agreement_type, contact1_name, contact1_phone,
         contact2_name, contact2_phone, site_supervisor, scope_link, checklist_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [crpId, f.contract_number, f.name, f.agreement_type, f.contact1_name, f.contact1_phone,
        f.contact2_name, f.contact2_phone, f.site_supervisor, f.scope_link, f.checklist_link]
    );
  }

  async function updateContract(ctx, id, body) {
    const c = await loadOwnContract(ctx, id);
    const f = contractFields(body);
    const dupe = await one(
      'SELECT id FROM contracts WHERE crp_id = $1 AND contract_number = $2 AND id <> $3',
      [c.crp_id, f.contract_number, c.id]
    );
    if (dupe) throw new HttpError(409, 'That contract number is already on your roster');
    const active = body.active === false ? false : true;
    return one(
      `UPDATE contracts SET contract_number=$2, name=$3, agreement_type=$4, contact1_name=$5, contact1_phone=$6,
         contact2_name=$7, contact2_phone=$8, site_supervisor=$9, scope_link=$10, checklist_link=$11, active=$12
       WHERE id = $1 RETURNING *`,
      [c.id, f.contract_number, f.name, f.agreement_type, f.contact1_name, f.contact1_phone,
        f.contact2_name, f.contact2_phone, f.site_supervisor, f.scope_link, f.checklist_link, active]
    );
  }

  async function getContract(ctx, id) {
    const c = await loadOwnContract(ctx, id);
    const crp = await crpOf(ctx);
    const calls = await query(
      'SELECT * FROM calls WHERE contract_id = $1 ORDER BY called_at DESC LIMIT 20', [c.id]
    );
    const visits = await query(
      `SELECT ${VISIT_COLS} FROM visits WHERE contract_id = $1 ORDER BY visit_date DESC, created_at DESC LIMIT 20`, [c.id]
    );
    return { contract: decorate(c, crp.call_schedule), calls, visits };
  }

  async function logCall(ctx, id, body) {
    const c = await loadOwnContract(ctx, id);
    const noAnswer = bool(body.no_answer) === true;
    const col = noAnswer ? null : color(body.color, 'Color', true);
    const call = await one(
      `INSERT INTO calls (contract_id, called_by, spoke_with, what_they_said, no_answer, color, called_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [c.id, ctx.email, text(body.spoke_with, 120), text(body.what_they_said, 4000), noAnswer, col, now()]
    );
    if (!noAnswer) {
      // A "no answer" attempt leaves the contract due for a call.
      await query(
        `UPDATE contracts SET
           last_called_at = $2,
           color_since = CASE WHEN current_color IS DISTINCT FROM $3 THEN $2 ELSE color_since END,
           current_color = $3
         WHERE id = $1`,
        [c.id, call.called_at, col]
      );
    }
    return call;
  }

  async function logVisit(ctx, id, body) {
    const c = await loadOwnContract(ctx, id);
    const causes = Array.isArray(body.root_causes)
      ? body.root_causes.map((r) => String(r)).filter((r) => ROOT_CAUSES.includes(r))
      : [];
    const confirmed = bool(body.customer_confirmed) === true;
    const newColor = color(body.new_color, 'New color');
    const visitDate = date(body.visit_date, 'Visit date') || now().toISOString().slice(0, 10);
    let confirmedBy = null;
    let confirmedOn = null;
    if (confirmed) {
      if (!newColor) throw new HttpError(400, 'Pick the new color once the customer confirms');
      confirmedBy = text(body.confirmed_by, 120);
      if (!confirmedBy) throw new HttpError(400, 'Enter the name of the customer contact who confirmed the fix');
      confirmedOn = date(body.confirmed_on, 'Confirmation date');
      if (!confirmedOn) throw new HttpError(400, 'Enter the date the customer confirmed the fix');
      // Compare as calendar dates; allow a day of slack for time zones.
      if (confirmedOn > addDays(now(), 1).toISOString().slice(0, 10)) {
        throw new HttpError(400, 'The confirmation date cannot be in the future');
      }
      if (confirmedOn < visitDate) throw new HttpError(400, 'The confirmation date cannot be before the visit');
    }
    const visit = await one(
      `INSERT INTO visits (contract_id, visit_date, visited_by, met_with, color_at_visit, walkthrough_notes,
         scope_reviewed, checklist_reviewed, root_causes, action_taken, employees_coached, followup_date,
         customer_confirmed, new_color, confirmed_by, confirmed_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING ${VISIT_COLS}`,
      [c.id, visitDate, ctx.email, text(body.met_with, 120), c.current_color, text(body.walkthrough_notes, 4000),
        bool(body.scope_reviewed), bool(body.checklist_reviewed), causes, text(body.action_taken, 4000),
        text(body.employees_coached, 500), date(body.followup_date, 'Follow-up date'), confirmed,
        confirmed ? newColor : null, confirmedBy, confirmedOn]
    );
    await query(
      `UPDATE contracts SET last_visited_at = GREATEST(COALESCE(last_visited_at, $2::timestamptz), $2::timestamptz)
       WHERE id = $1`,
      [c.id, `${visitDate}T12:00:00Z`]
    );
    if (confirmed && newColor) {
      await query(
        `UPDATE contracts SET
           color_since = CASE WHEN current_color IS DISTINCT FROM $2 THEN $3 ELSE color_since END,
           current_color = $2
         WHERE id = $1`,
        [c.id, newColor, now()]
      );
    }
    return visit;
  }

  async function visitQueue(ctx) {
    const { crp, contracts } = await listContracts(ctx);
    const t = now();
    const lookahead = addDays(t, GREEN_LOOKAHEAD_DAYS);
    const byDue = (a, b) => new Date(a.visit_due_at) - new Date(b.visit_due_at);
    return {
      crp,
      red: contracts.filter((c) => c.current_color === 'red').sort(byDue),
      yellow: contracts.filter((c) => c.current_color === 'yellow').sort(byDue),
      green: contracts
        .filter((c) => c.current_color === 'green' && new Date(c.visit_due_at) <= lookahead)
        .sort(byDue),
      not_called: contracts.filter((c) => !c.current_color),
    };
  }

  async function statewide(ctx) {
    requireWvarf(ctx);
    // Only WVARF / State contracts ever leave a CRP.
    const rows = await query(
      `SELECT c.id, c.name, c.contract_number, c.current_color, c.color_since, c.last_called_at,
              c.last_visited_at, c.crp_id, p.name AS crp_name, p.call_schedule
       FROM contracts c JOIN crps p ON p.id = c.crp_id
       WHERE c.active AND c.agreement_type = 'state'`,
      []
    );
    const crps = await query('SELECT id, name, call_schedule FROM crps ORDER BY name', []);
    const t = now();
    const byCrp = new Map(crps.map((p) => [p.id, {
      crp_id: p.id, name: p.name, total: 0, green: 0, yellow: 0, red: 0, not_called: 0,
      on_schedule: 0, oldest_red_days: null,
    }]));
    const reds = [];
    const totals = { total: 0, green: 0, yellow: 0, red: 0, not_called: 0, on_schedule: 0 };
    for (const r of rows) {
      const d = decorate(r, r.call_schedule);
      const b = byCrp.get(r.crp_id);
      const key = r.current_color || 'not_called';
      b.total++; b[key]++; totals.total++; totals[key]++;
      if (!d.call_due) { b.on_schedule++; totals.on_schedule++; }
      if (r.current_color === 'red') {
        const days = d.days_in_color ?? 0;
        b.oldest_red_days = Math.max(b.oldest_red_days ?? 0, days);
        reds.push({ id: r.id, name: r.name, contract_number: r.contract_number, crp_name: r.crp_name,
          days_red: days, visit_due_at: d.visit_due_at, visit_overdue: d.visit_overdue,
          last_visited_at: r.last_visited_at });
      }
    }
    reds.sort((a, b) => b.days_red - a.days_red);
    const list = [...byCrp.values()].filter((b) => b.total > 0)
      .sort((a, b) => b.red - a.red || b.yellow - a.yellow || a.name.localeCompare(b.name));
    return { as_of: t.toISOString(), totals, crps: list, open_reds: reds };
  }

  // ----- admin -----

  async function listCrps(ctx) {
    requireWvarf(ctx);
    return query(
      `SELECT p.*, (SELECT count(*)::int FROM members m WHERE m.crp_id = p.id) AS member_count
       FROM crps p ORDER BY p.name`, []
    );
  }

  async function createCrp(ctx, body) {
    requireWvarf(ctx);
    const name = requiredText(body.name, 'CRP name', 160);
    const schedule = SCHEDULE_DAYS[body.call_schedule] ? body.call_schedule : 'biweekly';
    const exists = await one('SELECT id FROM crps WHERE lower(name) = lower($1)', [name]);
    if (exists) throw new HttpError(409, 'A CRP with that name already exists');
    return one('INSERT INTO crps (name, call_schedule) VALUES ($1, $2) RETURNING *', [name, schedule]);
  }

  async function updateCrpSettings(ctx, body) {
    const crpId = requireCrp(ctx);
    if (!isCrpAdmin(ctx)) throw new HttpError(403, 'Only your CRP administrator can change settings');
    if (!SCHEDULE_DAYS[body.call_schedule]) throw new HttpError(400, 'Call schedule must be weekly, biweekly or monthly');
    return one('UPDATE crps SET call_schedule = $2 WHERE id = $1 RETURNING *', [crpId, body.call_schedule]);
  }

  async function listMembers(ctx) {
    if (isWvarf(ctx)) {
      return query(
        `SELECT m.*, p.name AS crp_name FROM members m LEFT JOIN crps p ON p.id = m.crp_id
         ORDER BY p.name NULLS FIRST, m.email`, []
      );
    }
    const crpId = requireCrp(ctx);
    if (!isCrpAdmin(ctx)) throw new HttpError(403, 'Only your CRP administrator can manage people');
    return query(
      `SELECT m.*, p.name AS crp_name FROM members m JOIN crps p ON p.id = m.crp_id
       WHERE m.crp_id = $1 ORDER BY m.email`, [crpId]
    );
  }

  async function saveMember(ctx, body) {
    const email = normEmail(body.email);
    const name = text(body.name, 120);
    let role = ['supervisor', 'crp_admin', 'wvarf_admin'].includes(body.role) ? body.role : 'supervisor';
    let crpId;
    if (isWvarf(ctx)) {
      crpId = body.crp_id ? intId(body.crp_id, 'CRP') : null;
      if (crpId && !(await one('SELECT id FROM crps WHERE id = $1', [crpId]))) throw new HttpError(400, 'Unknown CRP');
      if (role !== 'wvarf_admin' && !crpId) throw new HttpError(400, 'Pick a CRP for this person');
    } else {
      crpId = requireCrp(ctx);
      if (!isCrpAdmin(ctx)) throw new HttpError(403, 'Only your CRP administrator can manage people');
      if (role === 'wvarf_admin') throw new HttpError(403, 'Only WVARF can add WVARF administrators');
      const existing = await one('SELECT * FROM members WHERE email = $1', [email]);
      if (existing && existing.crp_id && existing.crp_id !== crpId) {
        throw new HttpError(409, 'That person belongs to another CRP. Ask WVARF to move them.');
      }
      if (existing && existing.role === 'wvarf_admin') throw new HttpError(403, 'You cannot change a WVARF administrator');
    }
    if (admins.includes(email)) role = 'wvarf_admin';
    const isNew = !(await one('SELECT email FROM members WHERE email = $1', [email]));
    const member = await one(
      `INSERT INTO members (email, name, crp_id, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, members.name),
         crp_id = EXCLUDED.crp_id, role = EXCLUDED.role
       RETURNING *`,
      [email, name, crpId, role]
    );
    // New people get their sign-in invitation right away. Updating someone who is
    // already on the list does not email them again; use "Send invite" for that.
    const invite = isNew ? await sendInvite(member) : null;
    return { ...member, ...(invite || {}) };
  }

  // Never fails the request: the person is saved either way, and the result says
  // whether the email went out so the screen can tell the admin.
  async function sendInvite(member) {
    if (!inviteUser) return { invite: 'unavailable' };
    try {
      const result = await inviteUser(member.email, member.name);
      return { invite: result === 'already_registered' ? 'already_registered' : 'sent' };
    } catch (err) {
      console.error('Invite failed for', member.email, err);
      return { invite: 'failed', invite_error: String((err && err.message) || err).slice(0, 200) };
    }
  }

  async function resendInvite(ctx, emailParam) {
    const email = normEmail(decodeURIComponent(emailParam));
    const m = await one('SELECT * FROM members WHERE email = $1', [email]);
    if (!m) throw new HttpError(404, 'Person not found');
    if (!isWvarf(ctx)) {
      const crpId = requireCrp(ctx);
      if (!isCrpAdmin(ctx) || m.crp_id !== crpId || m.role === 'wvarf_admin') {
        throw new HttpError(404, 'Person not found');
      }
    }
    return { email, ...(await sendInvite(m)) };
  }

  async function removeMember(ctx, emailParam) {
    const email = normEmail(decodeURIComponent(emailParam));
    if (email === ctx.email) throw new HttpError(400, 'You cannot remove yourself');
    if (admins.includes(email)) throw new HttpError(403, 'This administrator is set in the site settings');
    const m = await one('SELECT * FROM members WHERE email = $1', [email]);
    if (!m) throw new HttpError(404, 'Person not found');
    if (!isWvarf(ctx)) {
      const crpId = requireCrp(ctx);
      if (!isCrpAdmin(ctx) || m.crp_id !== crpId || m.role === 'wvarf_admin') {
        throw new HttpError(404, 'Person not found');
      }
    }
    await query('DELETE FROM members WHERE email = $1', [email]);
    return { removed: email };
  }

  // ----- router -----

  const routes = [
    ['GET', /^\/me$/, (ctx) => me(ctx)],
    ['GET', /^\/contracts$/, (ctx) => listContracts(ctx)],
    ['POST', /^\/contracts$/, (ctx, b) => createContract(ctx, b)],
    ['GET', /^\/contracts\/(\d+)$/, (ctx, b, m) => getContract(ctx, m[1])],
    ['PUT', /^\/contracts\/(\d+)$/, (ctx, b, m) => updateContract(ctx, m[1], b)],
    ['POST', /^\/contracts\/(\d+)\/calls$/, (ctx, b, m) => logCall(ctx, m[1], b)],
    ['POST', /^\/contracts\/(\d+)\/visits$/, (ctx, b, m) => logVisit(ctx, m[1], b)],
    ['GET', /^\/queue$/, (ctx) => visitQueue(ctx)],
    ['GET', /^\/statewide$/, (ctx) => statewide(ctx)],
    ['PUT', /^\/crp\/settings$/, (ctx, b) => updateCrpSettings(ctx, b)],
    ['GET', /^\/admin\/crps$/, (ctx) => listCrps(ctx)],
    ['POST', /^\/admin\/crps$/, (ctx, b) => createCrp(ctx, b)],
    ['GET', /^\/admin\/members$/, (ctx) => listMembers(ctx)],
    ['POST', /^\/admin\/members$/, (ctx, b) => saveMember(ctx, b)],
    ['DELETE', /^\/admin\/members\/([^/]+)$/, (ctx, b, m) => removeMember(ctx, m[1])],
    ['POST', /^\/admin\/members\/([^/]+)\/invite$/, (ctx, b, m) => resendInvite(ctx, m[1])],
  ];

  return async function handle(req) {
    try {
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
      const method = req.method.toUpperCase();
      const match = routes.map(([m, re, fn]) => [m, path.match(re), fn]).filter(([, mm]) => mm);
      if (!match.length) throw new HttpError(404, 'Not found');
      const route = match.find(([m]) => m === method);
      if (!route) throw new HttpError(405, 'Method not allowed');

      const ctx = await loadMember(req);
      let body = {};
      if (method === 'POST' || method === 'PUT') {
        try { body = await req.json(); } catch { throw new HttpError(400, 'Request body must be JSON'); }
        if (!body || typeof body !== 'object') body = {};
      }
      const result = await route[2](ctx, body, route[1]);
      return json(result, method === 'POST' ? 201 : 200);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  };
}
