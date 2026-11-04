import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekEnds, colorsByWeek, trendOf, groupHistory, contractHistory } from '../lib/history.mjs';
import { buildDemo } from '../lib/demo-data.mjs';

const NOW = new Date('2026-11-04T18:00:00Z');
const DAY = 86400000;
const ago = (days) => new Date(NOW.getTime() - days * DAY);

test('12 week-ends, oldest first, ending now', () => {
  const ends = weekEnds(NOW, 12);
  assert.equal(ends.length, 12);
  assert.equal(ends[11].getTime(), NOW.getTime());
  assert.equal(ends[0].getTime(), NOW.getTime() - 77 * DAY);
});

test('a week takes the latest color on or before its end; none before the contract existed', () => {
  const ends = weekEnds(NOW, 12);
  const contracts = [{ id: 1, created_at: ago(200) }, { id: 2, created_at: ago(10) }];
  const events = [
    { contract_id: 1, at: ago(100), color: 'red' },
    { contract_id: 1, at: ago(30), color: 'yellow' },
    { contract_id: 1, at: ago(2), color: 'green' },
    { contract_id: 2, at: ago(5), color: 'yellow' },
  ];
  const m = colorsByWeek(contracts, events, ends);
  assert.deepEqual(m.get(1), ['red', 'red', 'red', 'red', 'red', 'red', 'red', 'yellow', 'yellow', 'yellow', 'yellow', 'green']);
  // Added 10 days ago, first called 5 days ago: no color a week ago, yellow now.
  assert.deepEqual(m.get(2), [null, null, null, null, null, null, null, null, null, null, null, 'yellow']);
});

test('trend compares the last 4 weeks with the first 4 weeks', () => {
  assert.equal(trendOf([0, 0, 0, 0, 50, 50, 50, 50, 100, 100, 100, 100]).direction, 'improving');
  assert.equal(trendOf([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 0, 0]).direction, 'slipping');
  assert.equal(trendOf([50, 50, 100, 50, 50, 50, 100, 50, 50, 50, 50, 100]).direction, 'steady');
  // A slow climb counts, not only a jump.
  const slow = trendOf([50, 55, 60, 65, 70, 75, 80, 85, 90, 90, 90, 90]);
  assert.equal(slow.direction, 'improving');
  assert.equal(slow.prior, 58);
  assert.equal(slow.recent, 90);
});

test('not enough history is called out, not guessed', () => {
  assert.equal(trendOf(Array(12).fill(null)).direction, 'new');
  assert.equal(trendOf([...Array(10).fill(null), 50, 50]).direction, 'new');
  // Added mid-window: compared against its own first weeks.
  assert.equal(trendOf([null, null, null, null, 0, 0, 0, 0, 100, 100, 100, 100]).direction, 'improving');
});

test('group history counts colors and averages the score', () => {
  const ends = weekEnds(NOW, 12);
  const colorMap = new Map([[1, Array(12).fill('green')], [2, Array(12).fill('red')], [3, Array(12).fill(null)]]);
  const g = groupHistory([1, 2, 3], colorMap, ends);
  assert.deepEqual(
    { green: g.weeks[0].green, red: g.weeks[0].red, none: g.weeks[0].none, score: g.weeks[0].score },
    { green: 1, red: 1, none: 1, score: 50 }
  );
  assert.equal(contractHistory(Array(12).fill('yellow')).scores[0], 50);
});

test('demo data covers every color and is fictional', () => {
  for (const n of [0, 1]) {
    const d = buildDemo(n, NOW);
    assert.equal(d.contracts.length, 10);
    const colors = new Set(d.calls.filter((c) => !c.no_answer).map((c) => c.color));
    assert.deepEqual([...colors].sort(), ['green', 'red', 'yellow']);
    assert.ok(d.calls.every((c) => new Date(c.called_at) <= NOW), 'no calls in the future');
    assert.ok(d.visits.every((v) => new Date(`${v.visit_date}T00:00:00Z`) <= NOW), 'no visits in the future');
    assert.ok(d.contracts.every((c) => /\(304\) 555-01\d\d/.test(c.contact1_phone)), 'only 555-01xx phone numbers');
    assert.ok(d.calls.every((c) => c.called_by.endsWith('@example.org')), 'only example.org callers');
    assert.ok(d.visits.some((v) => v.customer_confirmed && v.confirmed_by && v.confirmed_on), 'some fixes are confirmed');
    assert.ok(d.contracts.some((c) => c.agreement_type === 'other'), 'includes private contracts');
  }
});
