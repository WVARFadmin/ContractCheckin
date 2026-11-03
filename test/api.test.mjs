import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createApi } from '../lib/api-core.mjs';

let db;
let clock = new Date('2026-11-03T15:00:00Z'); // a Tuesday
let handle;

before(async () => {
  db = new PGlite();
  const dir = new URL('../netlify/database/migrations/', import.meta.url);
  for (const f of readdirSync(dir).sort()) {
    await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  }
  handle = createApi({
    query: async (text, params) => (await db.query(text, params)).rows,
    // In tests the bearer token simply is the email.
    getUser: async (req) => {
      const a = req.headers.get('authorization') || '';
      return a.startsWith('Bearer ') ? { email: a.slice(7), name: null } : null;
    },
    adminEmails: ['boss@wvarf.org'],
    now: () => clock,
  });
});

async function call(who, method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${who}`;
  const res = await handle(new Request(`https://example.test/api${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  }));
  return { status: res.status, body: await res.json() };
}

let crpA, crpB, stateContract, privateContract, otherCrpContract;

test('sign-in is required', async () => {
  const r = await call(null, 'GET', '/me');
  assert.equal(r.status, 401);
});

test('ADMIN_EMAILS user becomes a WVARF admin automatically', async () => {
  const r = await call('Boss@WVARF.org', 'GET', '/me');
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'wvarf_admin');
  assert.equal(r.body.is_wvarf_admin, true);
});

test('unassigned user is told to ask for access', async () => {
  const me = await call('stranger@x.org', 'GET', '/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.crp, null);
  const r = await call('stranger@x.org', 'GET', '/contracts');
  assert.equal(r.status, 403);
});

test('WVARF admin creates CRPs and assigns people', async () => {
  crpA = (await call('boss@wvarf.org', 'POST', '/admin/crps', { name: 'Alpha Industries', call_schedule: 'weekly' })).body;
  crpB = (await call('boss@wvarf.org', 'POST', '/admin/crps', { name: 'Beta Services' })).body;
  assert.equal(crpA.call_schedule, 'weekly');
  assert.equal(crpB.call_schedule, 'biweekly');
  const dupe = await call('boss@wvarf.org', 'POST', '/admin/crps', { name: 'alpha industries' });
  assert.equal(dupe.status, 409);

  assert.equal((await call('boss@wvarf.org', 'POST', '/admin/members', { email: 'ann@alpha.org', crp_id: crpA.id, role: 'crp_admin' })).status, 201);
  assert.equal((await call('boss@wvarf.org', 'POST', '/admin/members', { email: 'bob@beta.org', crp_id: crpB.id })).status, 201);
  const noCrp = await call('boss@wvarf.org', 'POST', '/admin/members', { email: 'x@y.org' });
  assert.equal(noCrp.status, 400);
});

test('supervisors cannot use WVARF-only routes', async () => {
  assert.equal((await call('bob@beta.org', 'GET', '/statewide')).status, 403);
  assert.equal((await call('bob@beta.org', 'POST', '/admin/crps', { name: 'Hack' })).status, 403);
  assert.equal((await call('bob@beta.org', 'GET', '/admin/members')).status, 403);
});

test('CRP admin adds a supervisor to their own CRP only', async () => {
  const r = await call('ann@alpha.org', 'POST', '/admin/members', { email: 'sam@alpha.org', crp_id: crpB.id });
  assert.equal(r.status, 201);
  assert.equal(r.body.crp_id, crpA.id, 'crp_id from body is ignored for CRP admins');
  const steal = await call('ann@alpha.org', 'POST', '/admin/members', { email: 'bob@beta.org' });
  assert.equal(steal.status, 409);
  const escalate = await call('ann@alpha.org', 'POST', '/admin/members', { email: 'z@alpha.org', role: 'wvarf_admin' });
  assert.equal(escalate.status, 403);
  const list = await call('ann@alpha.org', 'GET', '/admin/members');
  assert.deepEqual(list.body.map((m) => m.email).sort(), ['ann@alpha.org', 'sam@alpha.org']);
});

test('contracts are created with validation', async () => {
  const bad = await call('ann@alpha.org', 'POST', '/contracts', { name: 'No number', agreement_type: 'state' });
  assert.equal(bad.status, 400);
  const badLink = await call('ann@alpha.org', 'POST', '/contracts', {
    contract_number: 'X1', name: 'X', agreement_type: 'state', scope_link: 'javascript:alert(1)' });
  assert.equal(badLink.status, 400);

  stateContract = (await call('ann@alpha.org', 'POST', '/contracts', {
    contract_number: 'SU-1', name: 'County Office', agreement_type: 'state',
    contact1_name: 'Pat', contact1_phone: '304-555-0100' })).body;
  privateContract = (await call('sam@alpha.org', 'POST', '/contracts', {
    contract_number: 'PV-1', name: 'Bank Branch', agreement_type: 'other' })).body;
  otherCrpContract = (await call('bob@beta.org', 'POST', '/contracts', {
    contract_number: 'SU-9', name: 'Lodge', agreement_type: 'state' })).body;
  assert.ok(stateContract.id && privateContract.id && otherCrpContract.id);

  const dupe = await call('ann@alpha.org', 'POST', '/contracts', { contract_number: 'SU-1', name: 'Again', agreement_type: 'state' });
  assert.equal(dupe.status, 409);
});

test('everyone in a CRP sees all of its contracts, nobody else does', async () => {
  const ann = await call('ann@alpha.org', 'GET', '/contracts');
  const sam = await call('sam@alpha.org', 'GET', '/contracts');
  assert.equal(ann.body.contracts.length, 2);
  assert.equal(sam.body.contracts.length, 2);
  const bob = await call('bob@beta.org', 'GET', '/contracts');
  assert.deepEqual(bob.body.contracts.map((c) => c.name), ['Lodge']);

  assert.equal((await call('bob@beta.org', 'GET', `/contracts/${stateContract.id}`)).status, 404);
  assert.equal((await call('bob@beta.org', 'POST', `/contracts/${stateContract.id}/calls`, { color: 'green' })).status, 404);
  assert.equal((await call('bob@beta.org', 'PUT', `/contracts/${stateContract.id}`, { contract_number: 'z', name: 'z', agreement_type: 'state' })).status, 404);
  // A WVARF admin with no CRP cannot open a CRP's contract either.
  assert.equal((await call('boss@wvarf.org', 'GET', `/contracts/${stateContract.id}`)).status, 403);
});

test('new contracts are due for a call', async () => {
  const r = await call('ann@alpha.org', 'GET', '/contracts');
  assert.equal(r.body.calls_due, 2);
  assert.equal(r.body.counts.none, 2);
});

test('logging a call sets the color and records who called', async () => {
  const noColor = await call('sam@alpha.org', 'POST', `/contracts/${stateContract.id}/calls`, { what_they_said: 'hi' });
  assert.equal(noColor.status, 400);

  const r = await call('sam@alpha.org', 'POST', `/contracts/${stateContract.id}/calls`, {
    spoke_with: 'Pat', what_they_said: 'Restrooms not restocked', color: 'red' });
  assert.equal(r.status, 201);
  assert.equal(r.body.called_by, 'sam@alpha.org');

  const detail = await call('ann@alpha.org', 'GET', `/contracts/${stateContract.id}`);
  assert.equal(detail.body.contract.current_color, 'red');
  assert.equal(detail.body.contract.call_due, false);
  assert.equal(detail.body.calls[0].called_by, 'sam@alpha.org', 'Ann sees Sam\'s call');
});

test('a no-answer attempt leaves the contract due', async () => {
  const r = await call('ann@alpha.org', 'POST', `/contracts/${privateContract.id}/calls`, { no_answer: true });
  assert.equal(r.status, 201);
  const list = await call('ann@alpha.org', 'GET', '/contracts');
  const pv = list.body.contracts.find((c) => c.id === privateContract.id);
  assert.equal(pv.call_due, true);
  assert.equal(pv.current_color, null);
});

test('red visit is due within 2 business days and appears in the queue', async () => {
  const q = await call('ann@alpha.org', 'GET', '/queue');
  assert.equal(q.body.red.length, 1);
  // Marked red Tue Nov 3 -> due Thu Nov 5
  assert.equal(q.body.red[0].visit_due_at.slice(0, 10), '2026-11-05');
  assert.equal(q.body.not_called.length, 1);
});

test('business days skip the weekend', async () => {
  clock = new Date('2026-11-06T15:00:00Z'); // Friday
  await call('bob@beta.org', 'POST', `/contracts/${otherCrpContract.id}/calls`, { color: 'red' });
  const q = await call('bob@beta.org', 'GET', '/queue');
  assert.equal(q.body.red[0].visit_due_at.slice(0, 10), '2026-11-10'); // Tuesday
});

test('a visit only changes color when the customer confirms', async () => {
  const needsColor = await call('ann@alpha.org', 'POST', `/contracts/${stateContract.id}/visits`, { customer_confirmed: true });
  assert.equal(needsColor.status, 400);

  const v1 = await call('ann@alpha.org', 'POST', `/contracts/${stateContract.id}/visits`, {
    visit_date: '2026-11-04', walkthrough_notes: 'Saw it', root_causes: ['Supplies / equipment', 'Bogus'],
    scope_reviewed: true, new_color: 'green' });
  assert.equal(v1.status, 201);
  assert.deepEqual(v1.body.root_causes, ['Supplies / equipment']);
  assert.equal(v1.body.color_at_visit, 'red');
  assert.equal(v1.body.new_color, null, 'not confirmed, so no new color');
  let d = await call('ann@alpha.org', 'GET', `/contracts/${stateContract.id}`);
  assert.equal(d.body.contract.current_color, 'red');
  assert.ok(d.body.contract.last_visited_at);

  const v2 = await call('ann@alpha.org', 'POST', `/contracts/${stateContract.id}/visits`, {
    visit_date: '2026-11-06', customer_confirmed: true, new_color: 'yellow',
    confirmed_by: 'Pat', confirmed_on: '2026-11-06' });
  assert.equal(v2.status, 201);
  assert.equal(v2.body.confirmed_by, 'Pat');
  assert.equal(v2.body.confirmed_on, '2026-11-06');
  d = await call('ann@alpha.org', 'GET', `/contracts/${stateContract.id}`);
  assert.equal(d.body.contract.current_color, 'yellow');
  assert.equal(d.body.visits.length, 2);
  // Dates come back as plain calendar dates, not midnight-UTC timestamps.
  assert.equal(d.body.visits[0].visit_date, '2026-11-06');
  assert.equal(d.body.visits[0].confirmed_on, '2026-11-06');
  assert.equal(d.body.visits[1].confirmed_by, null);
});

test('confirming a fix requires the customer contact name and a valid date', async () => {
  const path = `/contracts/${stateContract.id}/visits`;
  const base = { visit_date: '2026-11-06', customer_confirmed: true, new_color: 'green' };
  const noName = await call('ann@alpha.org', 'POST', path, { ...base, confirmed_on: '2026-11-06' });
  assert.equal(noName.status, 400);
  assert.match(noName.body.error, /name of the customer contact/);
  const blankName = await call('ann@alpha.org', 'POST', path, { ...base, confirmed_by: '   ', confirmed_on: '2026-11-06' });
  assert.equal(blankName.status, 400);
  const noDate = await call('ann@alpha.org', 'POST', path, { ...base, confirmed_by: 'Pat' });
  assert.equal(noDate.status, 400);
  assert.match(noDate.body.error, /date the customer confirmed/);
  const future = await call('ann@alpha.org', 'POST', path, { ...base, confirmed_by: 'Pat', confirmed_on: '2026-12-25' });
  assert.equal(future.status, 400);
  const beforeVisit = await call('ann@alpha.org', 'POST', path, { ...base, confirmed_by: 'Pat', confirmed_on: '2026-11-01' });
  assert.equal(beforeVisit.status, 400);
  // None of the rejected attempts changed the color.
  const d = await call('ann@alpha.org', 'GET', `/contracts/${stateContract.id}`);
  assert.equal(d.body.contract.current_color, 'yellow');
  assert.equal(d.body.visits.length, 2);
});

test('name and date are ignored when the fix is not confirmed', async () => {
  const r = await call('ann@alpha.org', 'POST', `/contracts/${stateContract.id}/visits`, {
    visit_date: '2026-11-06', customer_confirmed: false, confirmed_by: 'Pat', confirmed_on: '2026-11-06', new_color: 'green' });
  assert.equal(r.status, 201);
  assert.equal(r.body.confirmed_by, null);
  assert.equal(r.body.confirmed_on, null);
  const d = await call('ann@alpha.org', 'GET', `/contracts/${stateContract.id}`);
  assert.equal(d.body.contract.current_color, 'yellow');
});

test('statewide view: only WVARF/State contracts, never private ones', async () => {
  const r = await call('boss@wvarf.org', 'GET', '/statewide');
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.total, 2);
  const names = r.body.open_reds.map((x) => x.name);
  assert.deepEqual(names, ['Lodge']);
  const alpha = r.body.crps.find((c) => c.name === 'Alpha Industries');
  assert.equal(alpha.total, 1, 'private Bank Branch is excluded');
  assert.equal(alpha.yellow, 1);
  assert.ok(!JSON.stringify(r.body).includes('Bank Branch'));
});

test('calls become due again after the CRP schedule passes', async () => {
  clock = new Date('2026-11-11T15:00:00Z'); // 8 days later; Alpha calls weekly
  const r = await call('ann@alpha.org', 'GET', '/contracts');
  const sc = r.body.contracts.find((c) => c.id === stateContract.id);
  assert.equal(sc.call_due, true);
  const b = await call('bob@beta.org', 'GET', '/contracts');
  assert.equal(b.body.contracts[0].call_due, false, 'Beta calls every 2 weeks');
});

test('CRP admin changes schedule; supervisor cannot', async () => {
  assert.equal((await call('sam@alpha.org', 'PUT', '/crp/settings', { call_schedule: 'monthly' })).status, 403);
  const r = await call('ann@alpha.org', 'PUT', '/crp/settings', { call_schedule: 'monthly' });
  assert.equal(r.status, 200);
  assert.equal(r.body.call_schedule, 'monthly');
});

test('removing people respects CRP boundaries', async () => {
  assert.equal((await call('ann@alpha.org', 'DELETE', '/admin/members/bob%40beta.org')).status, 404);
  assert.equal((await call('ann@alpha.org', 'DELETE', '/admin/members/ann%40alpha.org')).status, 400);
  assert.equal((await call('boss@wvarf.org', 'DELETE', '/admin/members/boss%40wvarf.org')).status, 400);
  assert.equal((await call('ann@alpha.org', 'DELETE', '/admin/members/sam%40alpha.org')).status, 200);
  assert.equal((await call('sam@alpha.org', 'GET', '/contracts')).status, 403);
});

test('unknown routes and bad bodies are handled', async () => {
  assert.equal((await call('ann@alpha.org', 'GET', '/nope')).status, 404);
  assert.equal((await call('ann@alpha.org', 'DELETE', '/contracts')).status, 405);
  const res = await handle(new Request('https://example.test/api/contracts', {
    method: 'POST', headers: { authorization: 'Bearer ann@alpha.org' }, body: 'not json' }));
  assert.equal(res.status, 400);
});
