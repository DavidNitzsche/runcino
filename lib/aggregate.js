/**
 * Turn a list of Strava activities into the metrics each page renders.
 *
 * Inputs are raw Strava activity blobs (see GET /athlete/activities). Outputs
 * are plain numbers/strings the client hydration script can drop into the DOM
 * without further computation.
 *
 * All distance math is in miles (1 mi = 1609.344 m) and all elevation is
 * surfaced in feet (1 m = 3.28084 ft) to match the existing UI copy.
 */

'use strict';

const M_PER_MI = 1609.344;
const FT_PER_M = 3.28084;

function isRun(a) {
  return a.sport_type === 'Run' || a.type === 'Run' || a.sport_type === 'TrailRun' || a.type === 'TrailRun';
}

function isRace(a) {
  return a.workout_type === 1;
}

function paceSPerMi(distM, movingS) {
  if (!distM || !movingS) return null;
  return movingS / (distM / M_PER_MI);
}

function fmtPace(sPerMi) {
  if (!sPerMi || !isFinite(sPerMi)) return '—';
  const s = Math.round(sPerMi);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtHMS(totalS) {
  if (!totalS || !isFinite(totalS)) return '—';
  const s = Math.round(totalS);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtMS(totalS) {
  if (!totalS || !isFinite(totalS)) return '—';
  const s = Math.round(totalS);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtMonthDay(d) {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

function startOfWeek(d) {
  const out = new Date(d);
  const dow = out.getDay(); // 0 = Sun
  // Treat week as Monday-start (matches the "Mon 20 – Sun 26" copy)
  const offset = (dow + 6) % 7;
  out.setDate(out.getDate() - offset);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Compute an aggregate snapshot used to hydrate every page. */
function aggregate(activities, { now = new Date() } = {}) {
  const runs = activities.filter(isRun);
  const races = runs.filter(isRace);

  const yearStart = new Date(now.getFullYear(), 0, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = monthStart;
  const weekStart = startOfWeek(now);
  const sixWeeksAgo = new Date(now.getTime() - 42 * 24 * 3600 * 1000);

  const totals = {
    ytd: { miles: 0, count: 0, elev_ft: 0, time_s: 0, hr_sum: 0, hr_n: 0 },
    month: { miles: 0, count: 0, elev_ft: 0, time_s: 0, hr_sum: 0, hr_n: 0 },
    lastMonth: { miles: 0, count: 0, elev_ft: 0, time_s: 0, hr_sum: 0, hr_n: 0 },
    week: { miles: 0, count: 0, elev_ft: 0, time_s: 0 },
    last6w: { miles: 0, count: 0 },
    allTime: { miles: 0, count: 0 },
  };

  for (const a of runs) {
    const d = new Date(a.start_date);
    const mi = a.distance / M_PER_MI;
    const elev = (a.total_elevation_gain || 0) * FT_PER_M;
    const time = a.moving_time || 0;
    totals.allTime.miles += mi;
    totals.allTime.count += 1;
    if (d >= yearStart) {
      totals.ytd.miles += mi; totals.ytd.count += 1; totals.ytd.elev_ft += elev; totals.ytd.time_s += time;
      if (a.average_heartrate) { totals.ytd.hr_sum += a.average_heartrate; totals.ytd.hr_n += 1; }
    }
    if (d >= monthStart) {
      totals.month.miles += mi; totals.month.count += 1; totals.month.elev_ft += elev; totals.month.time_s += time;
      if (a.average_heartrate) { totals.month.hr_sum += a.average_heartrate; totals.month.hr_n += 1; }
    } else if (d >= lastMonthStart && d < lastMonthEnd) {
      totals.lastMonth.miles += mi; totals.lastMonth.count += 1; totals.lastMonth.elev_ft += elev; totals.lastMonth.time_s += time;
      if (a.average_heartrate) { totals.lastMonth.hr_sum += a.average_heartrate; totals.lastMonth.hr_n += 1; }
    }
    if (d >= weekStart) {
      totals.week.miles += mi; totals.week.count += 1; totals.week.elev_ft += elev; totals.week.time_s += time;
    }
    if (d >= sixWeeksAgo) {
      totals.last6w.miles += mi; totals.last6w.count += 1;
    }
  }

  const monthDeltaPct =
    totals.lastMonth.miles > 0
      ? ((totals.month.miles - totals.lastMonth.miles) / totals.lastMonth.miles) * 100
      : null;

  // Personal bests by canonical race distance (within ±1.5%).
  const PB_TARGETS = [
    { key: '1mi', label: '1 mile',  meters: 1609.344, tolerance: 0.05 },
    { key: '5k',  label: '5K',      meters: 5000,    tolerance: 0.02 },
    { key: '10k', label: '10K',     meters: 10000,   tolerance: 0.02 },
    { key: 'half',label: 'Half',    meters: 21097.5, tolerance: 0.015 },
    { key: 'marathon', label: 'Marathon', meters: 42195, tolerance: 0.015 },
  ];
  const personalBests = PB_TARGETS.map(t => {
    const within = runs.filter(a => Math.abs(a.distance - t.meters) / t.meters <= t.tolerance && a.moving_time);
    if (within.length === 0) return { ...t, finish_s: null, finish_display: '—', activity_id: null, date: null, pace_s_per_mi: null, pace_display: '—' };
    within.sort((a, b) => a.moving_time - b.moving_time);
    const best = within[0];
    const pace = paceSPerMi(best.distance, best.moving_time);
    return {
      ...t,
      finish_s: best.moving_time,
      finish_display: fmtHMS(best.moving_time),
      activity_id: best.id,
      activity_name: best.name,
      date: best.start_date,
      pace_s_per_mi: pace,
      pace_display: fmtPace(pace),
    };
  });

  // Past races (workout_type = 1) sorted newest-first
  const pastRaces = races
    .slice()
    .sort((a, b) => Date.parse(b.start_date) - Date.parse(a.start_date))
    .map(a => {
      const pace = paceSPerMi(a.distance, a.moving_time);
      const distMi = a.distance / M_PER_MI;
      return {
        id: a.id,
        name: a.name,
        date: a.start_date,
        date_display: fmtMonthDay(new Date(a.start_date)),
        distance_m: a.distance,
        distance_mi: distMi,
        distance_display: distMi >= 25 ? '26.2 mi' : distMi >= 12.5 && distMi <= 13.5 ? '13.1 mi' : distMi >= 6 && distMi < 6.5 ? '10K' : distMi >= 3.05 && distMi <= 3.2 ? '5K' : `${distMi.toFixed(1)} mi`,
        moving_time_s: a.moving_time,
        finish_display: fmtHMS(a.moving_time),
        pace_s_per_mi: pace,
        pace_display: fmtPace(pace),
        elevation_ft: (a.total_elevation_gain || 0) * FT_PER_M,
        average_heartrate: a.average_heartrate || null,
        location_city: a.location_city || null,
      };
    });

  // Recent activity rows for the log page
  const recentActivities = activities
    .slice()
    .sort((a, b) => Date.parse(b.start_date) - Date.parse(a.start_date))
    .slice(0, 30)
    .map(a => {
      const distMi = a.distance / M_PER_MI;
      const pace = paceSPerMi(a.distance, a.moving_time);
      const d = new Date(a.start_date);
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        sport_type: a.sport_type,
        is_run: isRun(a),
        is_race: isRace(a),
        workout_type: a.workout_type ?? null,
        date: a.start_date,
        date_d: d.getDate(),
        date_m: MONTH_NAMES[d.getMonth()].toUpperCase(),
        date_dow: ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()],
        distance_mi: distMi,
        distance_display: distMi >= 0.05 ? distMi.toFixed(1) : '—',
        moving_time_s: a.moving_time,
        time_display: fmtHMS(a.moving_time),
        pace_s_per_mi: pace,
        pace_display: fmtPace(pace),
        average_heartrate: a.average_heartrate || null,
        elev_ft: (a.total_elevation_gain || 0) * FT_PER_M,
        kind_class: classifyKind(a),
      };
    });

  // The next "future" race is anything with workout_type=1 in the future, but
  // Strava activities are after-the-fact only, so this is null until the user
  // also configures a goal race manually. We surface the latest marathon as a
  // baseline + leave the goal as the responsibility of the goal config.
  const lastMarathon = personalBests.find(p => p.key === 'marathon');

  return {
    counts: {
      total_runs: runs.length,
      total_activities: activities.length,
      total_races_year: races.filter(a => new Date(a.start_date) >= yearStart).length,
      total_races_alltime: races.length,
    },
    miles: {
      week_mi: round1(totals.week.miles),
      week_count: totals.week.count,
      week_elev_ft: Math.round(totals.week.elev_ft),
      week_time_s: totals.week.time_s,
      week_time_display: fmtHMS(totals.week.time_s),
      month_mi: round1(totals.month.miles),
      month_count: totals.month.count,
      month_elev_ft: Math.round(totals.month.elev_ft),
      month_time_s: totals.month.time_s,
      month_time_display: fmtHMS(totals.month.time_s),
      month_avg_pace_display: totals.month.miles > 0 ? fmtPace(totals.month.time_s / totals.month.miles) : '—',
      month_avg_hr: totals.month.hr_n > 0 ? Math.round(totals.month.hr_sum / totals.month.hr_n) : null,
      last_month_mi: round1(totals.lastMonth.miles),
      month_delta_pct: monthDeltaPct == null ? null : Math.round(monthDeltaPct),
      ytd_mi: Math.round(totals.ytd.miles),
      ytd_count: totals.ytd.count,
      ytd_target_mi: 1608, // matches the existing 1,608/yr UI copy; can be parameterized later
      ytd_pct: totals.ytd.miles > 0 ? Math.round((totals.ytd.miles / 1608) * 100) : 0,
      last6w_avg_mpw: round1(totals.last6w.miles / 6),
      alltime_mi: Math.round(totals.allTime.miles),
    },
    personalBests,
    pastRaces,
    recentActivities,
    lastMarathon: lastMarathon && lastMarathon.finish_s ? {
      finish_display: lastMarathon.finish_display,
      pace_display: lastMarathon.pace_display,
      activity_id: lastMarathon.activity_id,
      activity_name: lastMarathon.activity_name,
      date: lastMarathon.date,
    } : null,
  };
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function classifyKind(a) {
  if (a.workout_type === 1) return 'race';
  if (a.workout_type === 2) return 'long';
  if (a.workout_type === 3) return 'tempo';
  if (!isRun(a)) return 'xt';
  // Heuristic: long if > 12 mi, tempo/int if name suggests, else easy
  const distMi = a.distance / M_PER_MI;
  if (distMi >= 13) return 'long';
  const n = (a.name || '').toLowerCase();
  if (/tempo|threshold|lt/.test(n)) return 'tempo';
  if (/interval|x\s?\d|repeats|track/.test(n)) return 'int';
  if (/race/.test(n)) return 'race';
  if (distMi < 0.05) return 'rest';
  return 'easy';
}

module.exports = {
  M_PER_MI,
  FT_PER_M,
  isRun,
  isRace,
  paceSPerMi,
  fmtPace,
  fmtHMS,
  fmtMS,
  fmtMonthDay,
  aggregate,
};
