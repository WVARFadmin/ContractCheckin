// Made-up contracts, calls and visits for practice. Everything here is fictional:
// names, phone numbers (the 555-01xx range is reserved for fiction) and the
// example.org addresses of the pretend callers.
//
// buildDemo(crpIndex, now) returns { contracts, calls, visits } covering the last
// 26 weeks. The first demo CRP's service is improving overall; the second's is
// slipping, so the trend views show both directions. Every color appears.

const DAY = 24 * 60 * 60 * 1000;
const WEEKS = 26;

const SITES_STATE = [
  'County Office Building', 'Regional Licensing Office', 'State Park Lodge', 'District Courthouse Annex',
  'Veterans Service Center', 'Highway District Garage', 'Workforce Center', 'Public Health Clinic',
  'Regional Records Center', 'Community College Annex', 'Rest Area — I-79 North', 'State Office Complex',
];
const SITES_OTHER = ['Downtown Bank Branch', 'Medical Office Park', 'Credit Union Main Office', 'Senior Living Center'];
const PEOPLE = [
  'Jordan Lee', 'Casey Morgan', 'Taylor Brooks', 'Riley Adams', 'Morgan Price', 'Avery Cole', 'Jamie Rivera',
  'Drew Bennett', 'Quinn Harper', 'Reese Walker', 'Sam Turner', 'Alex Carter', 'Robin Hayes', 'Logan Ellis',
  'Cameron Wade', 'Skyler Reed', 'Hayden Ross', 'Parker Lane', 'Emerson Gray', 'Rowan Blake',
];
const CALLERS = ['demo.office@example.org', 'demo.supervisor@example.org'];
const SAID = {
  green: [
    'Everything looks great. No complaints.',
    'The crew is doing a nice job — restrooms are always stocked.',
    'Floors look excellent this week.',
    'All good here, thank you for checking in.',
    'Really happy with the service lately.',
  ],
  yellow: [
    'Mostly good, but the break-room trash was missed on Tuesday.',
    'Pretty good. The lobby glass has smudges again.',
    'Fine overall — dust is building up on the high ledges.',
    'Good, though the carpets could be vacuumed more often.',
    'No big problems. The entry mats could be cleaned.',
  ],
  red: [
    "The restrooms weren't restocked twice this week.",
    "Trash wasn't picked up two nights in a row.",
    "Floors haven't been mopped and there's a smell in the kitchen.",
    'Nobody came Monday night and the offices were not cleaned.',
    'Spill in the hallway was left overnight. Staff complained.',
  ],
};
const FIXES = {
  'Missed task': ['Walked the route with the crew and added a sign-off sheet for each room.', 'Added the missed rooms to the nightly checklist.'],
  Staffing: ['Assigned a second person to this site on Mondays and Wednesdays.', 'Set up a backup cleaner for call-offs.'],
  Training: ['Re-trained the crew on the restroom restocking steps.', 'Showed the crew the floor-care steps from the scope of work.'],
  'Supplies / equipment': ['Restocked the supply closet and set a weekly supply check.', 'Replaced the broken vacuum and the mop heads.'],
  'Not in scope': ['Reviewed the scope with the customer; quoted the extra work separately.'],
};

// How each kind of site behaved, week by week (0 = 26 weeks ago, 25 = this week).
const PROFILES = {
  improving: (w) => (w < 15 ? 'red' : w < 20 ? 'yellow' : 'green'),
  improvingLate: (w) => (w < 18 ? 'yellow' : w < 20 ? (w % 2 ? 'yellow' : 'green') : 'green'),
  slipping: (w) => (w < 15 ? 'green' : w < 21 ? 'yellow' : 'red'),
  slippingSoft: (w) => (w < 19 ? 'green' : 'yellow'),
  steadyGreen: () => 'green',
  steadyYellow: (w) => (w % 6 === 0 ? 'green' : 'yellow'),
  bouncy: (w) => (Math.floor(w / 2) % 2 ? 'yellow' : 'green'),
  recovered: (w) => (w >= 11 && w < 14 ? 'red' : w >= 14 && w < 16 ? 'yellow' : 'green'),
  newRed: (w) => (w >= 24 ? 'red' : 'green'),
  overdueCall: () => 'green',
  newContract: () => 'yellow',
};

// Which kinds of sites each demo CRP has. The mix sets the CRP's overall trend.
const MIXES = [
  // Improving overall
  ['improving', 'improving', 'improvingLate', 'steadyGreen', 'steadyGreen', 'recovered', 'bouncy', 'steadyYellow', 'overdueCall', 'newContract'],
  // Slipping overall
  ['slipping', 'slipping', 'slippingSoft', 'slippingSoft', 'newRed', 'steadyGreen', 'steadyYellow', 'bouncy', 'recovered', 'improving'],
];

// Small, repeatable random numbers so each reload looks the same.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

function weekday(d) {
  const x = new Date(d);
  while (x.getUTCDay() === 0 || x.getUTCDay() === 6) x.setUTCDate(x.getUTCDate() - 1);
  return x;
}
const at = (d, hour) => { const x = new Date(d); x.setUTCHours(hour, Math.floor((x.getTime() / 60000) % 50), 0, 0); return x; };
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

export function buildDemo(crpIndex, now = new Date()) {
  const mix = MIXES[crpIndex % MIXES.length];
  const r = rng(1000 + crpIndex * 7919);
  const letter = String.fromCharCode(65 + (crpIndex % 26));
  const end = new Date(now).getTime();
  const weekStart = (w) => end - (WEEKS - 1 - w) * 7 * DAY - 6 * DAY;

  const contracts = [];
  const calls = [];
  const visits = [];

  let stateN = 0;
  let otherN = 0;
  mix.forEach((kind, i) => {
    const color = PROFILES[kind];
    const isOther = i === 3 || i === 7;
    // Each site name is used once per CRP; the two CRPs start at different names.
    const site = isOther ? SITES_OTHER[(otherN++ + crpIndex * 2) % SITES_OTHER.length]
      : SITES_STATE[(stateN++ + crpIndex * 5) % SITES_STATE.length];
    const c1 = PEOPLE[(i * 3 + crpIndex * 7) % PEOPLE.length];
    const c2 = PEOPLE[(i * 3 + crpIndex * 7 + 1) % PEOPLE.length];
    const firstWeek = kind === 'newContract' ? WEEKS - 2 : 0;
    const contract = {
      key: i,
      contract_number: `DEMO-${letter}${String(i + 1).padStart(2, '0')}`,
      name: site,
      agreement_type: isOther ? 'other' : 'state',
      contact1_name: c1,
      contact1_phone: `(304) 555-01${String((i * 7 + crpIndex * 31) % 100).padStart(2, '0')}`,
      contact2_name: i % 3 === 2 ? null : c2,
      contact2_phone: i % 3 === 2 ? null : `(304) 555-01${String((i * 7 + crpIndex * 31 + 50) % 100).padStart(2, '0')}`,
      site_supervisor: PEOPLE[(i + 11 + crpIndex) % PEOPLE.length],
      created_at: new Date(weekStart(firstWeek) - DAY),
    };
    contracts.push(contract);

    // Calls every 2 weeks (alternate sites call on alternate weeks).
    const offset = i % 2;
    const lastCallWeek = kind === 'overdueCall' ? WEEKS - 5 : WEEKS - 1;
    let prev = null;
    let openRed = null; // the red that still needs fixing
    for (let w = firstWeek + ((offset + firstWeek) % 2); w <= lastCallWeek; w += 2) {
      // This week's call can be as late as "now", but never in the future.
      let when = weekday(at(weekStart(w) + Math.floor(r() * 5) * DAY, 14 + Math.floor(r() * 4)));
      if (when.getTime() > end) when = weekday(at(end - DAY, 14));
      const col = color(w);
      // An occasional no-answer, followed by the real call a day later.
      if (r() < 0.07 && w < lastCallWeek) {
        calls.push({ key: i, called_at: when, called_by: pick(r, CALLERS), spoke_with: null, what_they_said: null, no_answer: true, color: null });
        when = new Date(Math.min(weekday(new Date(when.getTime() + DAY)).getTime(), end - 60000));
      }
      calls.push({
        key: i, called_at: when, called_by: pick(r, CALLERS), spoke_with: r() < 0.75 ? c1 : (contract.contact2_name || c1),
        what_they_said: pick(r, SAID[col]), no_answer: false, color: col,
      });

      if (col === 'red' && prev !== 'red') {
        // Red: a supervisor visits within 2 days.
        const visitDay = weekday(new Date(when.getTime() + (1 + Math.floor(r() * 2)) * DAY));
        if (visitDay.getTime() <= end) {
          const cause = pick(r, ['Missed task', 'Staffing', 'Training', 'Supplies / equipment']);
          openRed = {
            key: i, visit_date: ymd(visitDay), visited_by: 'demo.supervisor@example.org', met_with: c1,
            color_at_visit: 'red', walkthrough_notes: pick(r, ['Confirmed the problem on the walkthrough.', 'Saw it myself — the customer was right.', 'Walked every floor with the contact.']),
            scope_reviewed: true, checklist_reviewed: r() < 0.7, root_causes: [cause], action_taken: pick(r, FIXES[cause]),
            employees_coached: `${PEOPLE[(i + 5) % PEOPLE.length].split(' ')[0]}, ${PEOPLE[(i + 9) % PEOPLE.length].split(' ')[0]}`,
            followup_date: ymd(new Date(visitDay.getTime() + 7 * DAY)),
            customer_confirmed: false, new_color: null, confirmed_by: null, confirmed_on: null,
          };
          visits.push(openRed);
        }
      } else if (openRed && col !== 'red') {
        // The customer confirms the fix; record it on that visit.
        openRed.customer_confirmed = true;
        openRed.new_color = col;
        openRed.confirmed_by = c1;
        openRed.confirmed_on = ymd(when);
        openRed = null;
      }
      if (col === 'yellow' && prev === 'green' && r() < 0.5) {
        // Some yellows get a visit too.
        const visitDay = weekday(new Date(when.getTime() + 5 * DAY));
        if (visitDay.getTime() <= end) {
          visits.push({
            key: i, visit_date: ymd(visitDay), visited_by: 'demo.supervisor@example.org', met_with: c1, color_at_visit: 'yellow',
            walkthrough_notes: 'Small items; went over the checklist.', scope_reviewed: true, checklist_reviewed: true,
            root_causes: ['Missed task'], action_taken: pick(r, FIXES['Missed task']), employees_coached: null,
            followup_date: null, customer_confirmed: false, new_color: null, confirmed_by: null, confirmed_on: null,
          });
        }
      }
      prev = col;
    }
    // Green sites still get a routine walkthrough now and then.
    if (['steadyGreen', 'overdueCall', 'bouncy'].includes(kind)) {
      const visitDay = weekday(new Date(end - (20 + i * 9) * DAY));
      visits.push({
        key: i, visit_date: ymd(visitDay), visited_by: 'demo.supervisor@example.org', met_with: c1, color_at_visit: 'green',
        walkthrough_notes: 'Routine walkthrough. Building looks good.', scope_reviewed: false, checklist_reviewed: true,
        root_causes: [], action_taken: 'Thanked the crew.', employees_coached: null, followup_date: null,
        customer_confirmed: false, new_color: null, confirmed_by: null, confirmed_on: null,
      });
    }
  });

  return { contracts, calls, visits };
}

// The status fields the contracts table keeps, worked out from the history.
export function summarize(contract, calls, visits) {
  const events = [
    ...calls.filter((c) => !c.no_answer).map((c) => ({ t: new Date(c.called_at).getTime(), color: c.color })),
    ...visits.filter((v) => v.customer_confirmed).map((v) => ({ t: new Date(`${v.confirmed_on}T16:00:00Z`).getTime(), color: v.new_color })),
  ].sort((a, b) => a.t - b.t);
  const last = events[events.length - 1];
  let since = last ? last.t : null;
  for (let k = events.length - 1; k >= 0 && events[k].color === (last && last.color); k--) since = events[k].t;
  const answered = calls.filter((c) => !c.no_answer).map((c) => new Date(c.called_at).getTime());
  const visited = visits.map((v) => new Date(`${v.visit_date}T12:00:00Z`).getTime());
  return {
    current_color: last ? last.color : null,
    color_since: since ? new Date(since) : null,
    last_called_at: answered.length ? new Date(Math.max(...answered)) : null,
    last_visited_at: visited.length ? new Date(Math.max(...visited)) : null,
  };
}
