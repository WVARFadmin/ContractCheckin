// Trend history: what color each contract was, week by week, and whether
// service is improving, steady or slipping.
//
// A contract's color for a week is its color at the end of that week: the color
// from the most recent answered call, or confirmed visit, on or before that day.
//
// Service score: green = 100, yellow = 50, red = 0, averaged across contracts
// that had a color that week. The trend compares the average of the last 4 weeks
// with the first 4 weeks of the 12-week window (about 2–3 months earlier), so a
// slow, steady change shows up as well as a sudden one.

export const HISTORY_WEEKS = 12;
export const TREND_WINDOW = 4;      // weeks averaged on each side of the comparison
export const TREND_THRESHOLD = 10;  // score points of change that count as a trend
export const SCORE = { green: 100, yellow: 50, red: 0 };
const WEEK = 7 * 24 * 60 * 60 * 1000;

// Week-end times, oldest first; the last one is "now".
export function weekEnds(now, weeks = HISTORY_WEEKS) {
  const end = new Date(now).getTime();
  return Array.from({ length: weeks }, (_, i) => new Date(end - (weeks - 1 - i) * WEEK));
}

// contracts: [{ id, created_at }]
// events:    [{ contract_id, at, color }]  (answered calls and confirmed visit fixes)
// returns Map(contract id -> [color | null for each week])
export function colorsByWeek(contracts, events, ends) {
  const byContract = new Map(contracts.map((c) => [c.id, []]));
  for (const e of events) {
    const list = byContract.get(e.contract_id);
    if (list) list.push({ t: new Date(e.at).getTime(), color: e.color });
  }
  const out = new Map();
  for (const c of contracts) {
    const list = byContract.get(c.id).sort((a, b) => a.t - b.t);
    const created = c.created_at ? new Date(c.created_at).getTime() : -Infinity;
    let i = 0;
    let current = null;
    out.set(c.id, ends.map((end) => {
      const t = end.getTime();
      while (i < list.length && list[i].t <= t) current = list[i++].color;
      return t < created ? null : current;
    }));
  }
  return out;
}

const avg = (xs) => {
  const vals = xs.filter((x) => x !== null && x !== undefined);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};

// scores: number | null per week, oldest first
export function trendOf(scores) {
  const recent = avg(scores.slice(-TREND_WINDOW));
  // Earliest weeks with a color, so a contract added mid-window compares against its own start.
  const firstKnown = scores.findIndex((x) => x !== null && x !== undefined);
  const earlyEnd = Math.min(firstKnown + TREND_WINDOW, scores.length - TREND_WINDOW);
  const prior = firstKnown < 0 || earlyEnd <= firstKnown ? null : avg(scores.slice(firstKnown, earlyEnd));
  if (recent === null || prior === null) {
    return { direction: 'new', recent: recent === null ? null : Math.round(recent), prior: null, change: null };
  }
  const change = Math.round(recent - prior);
  const direction = change >= TREND_THRESHOLD ? 'improving' : change <= -TREND_THRESHOLD ? 'slipping' : 'steady';
  return { direction, recent: Math.round(recent), prior: Math.round(prior), change };
}

// One contract: its weekly colors, scores and trend.
export function contractHistory(colors) {
  const scores = colors.map((c) => (c ? SCORE[c] : null));
  return { colors, scores, trend: trendOf(scores) };
}

// A group of contracts (one CRP, or statewide): counts per week, scores, trend.
export function groupHistory(contractIds, colorMap, ends) {
  const weeks = ends.map((end, w) => {
    const row = { week_end: end.toISOString(), green: 0, yellow: 0, red: 0, none: 0 };
    let sum = 0;
    let n = 0;
    for (const id of contractIds) {
      const color = (colorMap.get(id) || [])[w];
      if (color) { row[color]++; sum += SCORE[color]; n++; } else row.none++;
    }
    row.score = n ? Math.round(sum / n) : null;
    return row;
  });
  return { weeks, trend: trendOf(weeks.map((w) => w.score)) };
}
