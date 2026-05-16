/**
 * runcino-store.js — central data hub for the v4 local build.
 *
 * Every v4 page (overview, training, races, health) includes this
 * script. localStorage is the persistence layer; the store API gives
 * pages a clean way to read state and dispatch actions.
 *
 * State shape (seeded from the current production snapshot, persists
 * across page loads and tabs):
 *
 *   today           string (ISO date) — the day the app is operating on
 *   user            { name, initials }
 *   plan            { name, startDate, raceDate, totalWeeks, currentWeek,
 *                     currentPhase, phases[], weeks[][days[]] }
 *   races           { upcoming[], recent[] }
 *   vdot            { anchor, source, daysToRefresh }
 *   health          { readiness, form, fitness, fatigue, postRace{} }
 *   checkins        map of YYYY-MM-DD → { energy, soreness, stress, loggedAt }
 *   vitals          { sleep7d, rhr, hrv, strain7d }
 *
 * Cross-tab sync: storage events propagate writes to any other open tab.
 *
 * Usage in a page:
 *   <script src="runcino-store.js"></script>
 *   const s = RuncinoStore.getState();
 *   RuncinoStore.logCheckIn({ energy: 7, soreness: 3, stress: 2 });
 *   RuncinoStore.subscribe((next, prev) => renderFromState(next));
 */
(function () {
  'use strict';

  const STORE_KEY = 'runcino_v4_state';
  const SEED_VERSION = 2;

  // ── Plan builder ────────────────────────────────────────────────
  // Generates all 14 weeks of the AFC Half plan from a compact template.
  // Each week's days roll the date forward from a plan startDate. Day
  // shape: { dow, date, type, label, distanceMi, hasStrength, isRest,
  // paceMin, completed (computed elsewhere via date < today) }.
  function buildPlan() {
    const startDate = '2026-05-11';
    const phaseFor = (wk) => {
      if (wk <= 4) return 'BASE';
      if (wk <= 8) return 'BUILD';
      if (wk <= 12) return 'PEAK';
      if (wk === 13) return 'TAPER';
      return 'RACE_WEEK';
    };
    const dowList = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

    // [type, label, distanceMi, hasStrength?]  ·  null = rest
    const template = [
      // BASE
      [['recovery','Recovery',5.5],['quality','Threshold · Cruise Intervals',7],['easy','Easy + Strides',5.5],['easy','Easy',5.5,true],['easy','Easy',5.5,true],null,['long','Long',10.5]],
      [['recovery','Recovery',5.5],['quality','Threshold · Cruise Intervals',7.5],['easy','Easy + Strides',5.5],['easy','Easy',5.5,true],['easy','Hill Strides',5.5,true],null,['long','Long',11]],
      [['recovery','Recovery',4.5],['quality','Threshold · Cruise Intervals',6],['easy','Easy + Strides',4.5],['easy','Easy',4.5,true],['easy','Easy',4.5,true],null,['long','Long',11.5]],
      [['recovery','Recovery',6],['quality','Threshold · Cruise Intervals',8],['easy','Easy + Strides',6],['easy','Easy',6,true],['easy','Hill Strides',6,true],null,['long','Long',12]],
      // BUILD
      [['easy','Easy',6.5,true],['quality','Threshold · HM Threshold Blocks',7.5],['easy','Easy',6.5],['quality','Intervals',6],['easy','Easy',6.5,true],null,['long','Long Run · HM Finish',12.5]],
      [['easy','Easy',5,true],['quality','Threshold · HM Cruise Intervals',6.5],['easy','Easy',5],['quality','Intervals',5],['easy','Easy',5,true],null,['long','Long',11.5]],
      [['easy','Easy',7,true],['quality','Threshold · HM Threshold Blocks',8],['easy','Easy',7],['quality','Intervals',6],['easy','Easy',7,true],null,['long','Long Run · HM Finish',13]],
      [['easy','Easy',7,true],['quality','Threshold · HM Cruise Intervals',8.5],['easy','Easy',7],['quality','Intervals',6.5],['easy','Easy',7,true],null,['long','Long Run · Progression',13.5]],
      // PEAK
      [['easy','Easy',6,true],['quality','Threshold · HM Continuous Tempo',7],['easy','Easy',6],['quality','Intervals',5.5],['easy','Easy',6,true],null,['long','Long',11.5]],
      [['easy','Easy',7.5,true],['quality','Threshold · HM Continuous Tempo',9],['easy','Easy',7.5],['quality','Intervals',7],['easy','Easy',7.5,true],null,['long','Long Run · Progression',14]],
      [['easy','Easy',7.5,true],['quality','Threshold · HM Continuous Tempo',9],['easy','Easy',7.5],['quality','Intervals',7],['easy','Easy',7.5,true],null,['long','Long Run · HM Finish',14.5]],
      [['easy','Easy',8,true],['quality','Threshold · HM Continuous Tempo',9.5],['easy','Easy',8],['quality','Intervals',7],['easy','Easy',8,true],null,['long','Long Run · Progression',15]],
      // TAPER
      [['easy','Easy',5.5],['quality','Threshold Touch',5],['easy','Easy',5.5],['easy','Easy',5.5,true],['easy','Easy',5.5],null,['long','Long Run · Taper',7.5]],
      // RACE WEEK — Sun is race
      [['easy','Easy',5],['quality','Threshold · Race Week Tune-Up',4],['easy','Easy',5],null,null,['easy','Shake-out',3],['race','AFC Half',13.1]],
    ];

    function isoAdd(start, days) {
      const d = new Date(start + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    }

    const weeks = template.map((dayTpl, wIdx) => {
      const weekNum = wIdx + 1;
      const phase = phaseFor(weekNum);
      const wkStart = isoAdd(startDate, wIdx * 7);
      const days = dayTpl.map((t, dIdx) => {
        const date = isoAdd(wkStart, dIdx);
        const dow = dowList[dIdx];
        if (!t) return { dow, date, type: 'rest', label: 'Rest', isRest: true };
        const [type, label, distanceMi, hasStrength] = t;
        const paceMin = type === 'easy' ? '9:15'
                     : type === 'recovery' ? '10:00'
                     : type === 'long' ? '9:30'
                     : type === 'quality' ? '7:30'
                     : type === 'race' ? '7:15'
                     : '9:00';
        return Object.assign({ dow, date, type, label, distanceMi, paceMin },
                             hasStrength ? { hasStrength: true } : {});
      });
      const plannedMi = days.reduce((s, d) => s + (d.distanceMi || 0), 0);
      return { weekNum, phase, startDate: wkStart, plannedMi: Math.round(plannedMi * 10) / 10, days };
    });

    return {
      name: 'Americas Finest City Half',
      startDate,
      raceDate: '2026-08-16',
      totalWeeks: 14,
      currentWeek: 1,
      currentPhase: 'BASE',
      currentPhaseWeek: 1,
      currentPhaseWeeks: 4,
      phases: [
        { name: 'BASE',       weeks: [1, 2, 3, 4] },
        { name: 'BUILD',      weeks: [5, 6, 7, 8] },
        { name: 'PEAK',       weeks: [9, 10, 11, 12] },
        { name: 'TAPER',      weeks: [13] },
        { name: 'RACE_WEEK',  weeks: [14] },
      ],
      weeks,
    };
  }

  const SEED = {
    _version: SEED_VERSION,
    today: '2026-05-16',
    user: { name: 'David Nitzsche', initials: 'DN' },

    plan: buildPlan(),

    races: {
      upcoming: [
        { name: 'Americas Finest City', date: '2026-08-16', distanceLabel: 'Half Marathon · 13.24 mi · San Diego', goal: '1:35:00', goalPace: '7:15/mi', daysAway: 92, priority: 'A' },
        { name: 'Dodgers 10K',           date: '2026-09-26', distanceLabel: '10K · 6.17 mi · Los Angeles',          goal: '45:00',   goalPace: '7:18/mi', daysAway: 133, priority: 'C' },
        { name: 'Run Malibu',            date: '2026-11-08', distanceLabel: 'Half Marathon · 13.12 mi · Malibu',    goal: '1:30:00', goalPace: '6:52/mi', daysAway: 176, priority: 'B' },
        { name: 'CIM',                   date: '2026-12-06', distanceLabel: 'Marathon',                              goal: '3:00:00', goalPace: '6:52/mi', daysAway: 204, priority: 'A' },
        { name: 'LA Marathon',           date: '2027-03-07', distanceLabel: 'Marathon · 26.41 mi · Los Angeles',    goal: '3:31:00', goalPace: '8:00/mi', daysAway: 295, priority: 'A' },
      ],
      recent: [
        { date: '2026-05-03', name: 'Sombrero Half Marathon',         distanceLabel: 'Half Marathon',                    finish: '1:40:57', pace: '7:40/mi', priority: 'C' },
        { date: '2026-04-26', name: 'Big Sur Marathon',                distanceLabel: 'Marathon · 2,140 ft climb',        finish: '3:36:55', pace: '8:17/mi', priority: 'A' },
        { date: '2026-04-18', name: 'Point Magu Half Marathon',        distanceLabel: 'Half Marathon · trail',            finish: '2:09:02', pace: '9:33/mi', priority: 'C' },
        { date: '2026-03-15', name: 'Los Angeles Marathon',            distanceLabel: 'Marathon',                          finish: '3:31:00', pace: '8:03/mi', priority: 'A', note: 'marathon PR' },
        { date: '2026-02-01', name: 'Powered by the Mouse for a PR',   distanceLabel: 'Half Marathon',                    finish: '1:34:54', pace: '7:05/mi', priority: 'A', note: 'VDOT 48.1 · current anchor', currentAnchor: true },
        { date: '2026-01-18', name: 'Rose Bowl Half Marathon',         distanceLabel: 'Half Marathon',                    finish: '1:38:38', pace: '7:24/mi', priority: 'A', note: 'VDOT 46' },
      ],
    },

    vdot: { anchor: 48.1, source: 'Powered by the Mouse · Feb 1', daysToRefresh: 26 },

    health: {
      readiness: 88,
      readinessState: 'Building',
      form: 12,
      fitness: 52,
      fatigue: 40,
      postRace: {
        raceName: 'Big Sur',
        raceDate: '2026-04-26',
        daysAgo: 20,
        systems: [
          { name: 'Tendons',         daysLeft: 8 },
          { name: 'Aerobic markers', daysLeft: 14 },
        ],
      },
    },

    // Date → { energy, soreness, stress, loggedAt }. May 6 intentionally missing.
    checkins: {
      '2026-05-03': { energy: 6, soreness: 8, stress: 3, loggedAt: '2026-05-03T19:42:00Z' },
      '2026-05-04': { energy: 5, soreness: 7, stress: 4, loggedAt: '2026-05-04T19:42:00Z' },
      '2026-05-05': { energy: 6, soreness: 5, stress: 3, loggedAt: '2026-05-05T19:42:00Z' },
      '2026-05-07': { energy: 7, soreness: 4, stress: 3, loggedAt: '2026-05-07T19:42:00Z' },
      '2026-05-08': { energy: 7, soreness: 4, stress: 2, loggedAt: '2026-05-08T19:42:00Z' },
      '2026-05-09': { energy: 8, soreness: 3, stress: 2, loggedAt: '2026-05-09T19:42:00Z' },
      '2026-05-10': { energy: 8, soreness: 3, stress: 3, loggedAt: '2026-05-10T19:42:00Z' },
      '2026-05-11': { energy: 7, soreness: 4, stress: 3, loggedAt: '2026-05-11T19:42:00Z' },
      '2026-05-12': { energy: 6, soreness: 5, stress: 3, loggedAt: '2026-05-12T19:42:00Z' },
      '2026-05-13': { energy: 6, soreness: 5, stress: 3, loggedAt: '2026-05-13T19:42:00Z' },
      '2026-05-14': { energy: 7, soreness: 4, stress: 3, loggedAt: '2026-05-14T19:42:00Z' },
      '2026-05-15': { energy: 7, soreness: 3, stress: 2, loggedAt: '2026-05-15T19:42:00Z' },
      // 2026-05-16 (today) intentionally not logged
    },

    vitals: { sleep7d: 7.4, rhr: 48, hrv: 62, strain7d: 11.4 },
  };

  const listeners = new Set();

  function read() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed._version !== SEED_VERSION) return null; // bumped seed → reseed
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function write(s) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch (_) { /* quota / private mode — ignore */ }
  }

  function getState() {
    const existing = read();
    const base = existing || SEED;
    if (!existing) write(SEED);
    // Derive daysAway on every read so race countdowns track today.
    if (base.races && base.races.upcoming) {
      base.races.upcoming.forEach((r) => {
        if (r.date) r.daysAway = daysBetween(base.today, r.date);
      });
    }
    return base;
  }

  function setState(updater) {
    const prev = getState();
    const next = typeof updater === 'function' ? updater(prev) : updater;
    write(next);
    notify(next, prev);
    return next;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify(next, prev) {
    listeners.forEach((fn) => { try { fn(next, prev); } catch (_) {} });
  }

  // Cross-tab sync — when another tab writes, fire local listeners.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEY) return;
    try {
      const next = e.newValue ? JSON.parse(e.newValue) : SEED;
      const prev = e.oldValue ? JSON.parse(e.oldValue) : SEED;
      notify(next, prev);
    } catch (_) {}
  });

  // ── Actions ──────────────────────────────────────────────────────
  function logCheckIn(values) {
    const { energy, soreness, stress } = values || {};
    if ([energy, soreness, stress].some((v) => typeof v !== 'number')) return null;
    return setState((s) => {
      const today = s.today;
      return {
        ...s,
        checkins: {
          ...s.checkins,
          [today]: { energy, soreness, stress, loggedAt: new Date().toISOString() },
        },
      };
    });
  }

  function clearCheckIn(dateISO) {
    return setState((s) => {
      const c = { ...s.checkins };
      delete c[dateISO || s.today];
      return { ...s, checkins: c };
    });
  }

  function resetState() {
    try { localStorage.removeItem(STORE_KEY); } catch (_) {}
    return getState();
  }

  // ── Selectors ────────────────────────────────────────────────────
  function todayCheckIn() {
    const s = getState();
    return s.checkins[s.today] || null;
  }

  function recentCheckIns(days = 14) {
    const s = getState();
    const out = [];
    const today = new Date(s.today + 'T00:00:00Z');
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);
      out.push({ date: iso, log: s.checkins[iso] || null });
    }
    return out;
  }

  function daysBetween(fromISO, toISO) {
    const a = new Date(fromISO + 'T00:00:00Z');
    const b = new Date(toISO + 'T00:00:00Z');
    return Math.round((b - a) / 86400000);
  }

  function getCurrentWeekContext() {
    const s = getState();
    const start = new Date(s.plan.startDate + 'T00:00:00Z');
    const today = new Date(s.today + 'T00:00:00Z');
    const diffDays = Math.floor((today - start) / 86400000);
    const weekNum = Math.max(1, Math.min(s.plan.totalWeeks, Math.floor(diffDays / 7) + 1));
    const week = s.plan.weeks.find((w) => w.weekNum === weekNum);
    const phase = week ? week.phase : 'BASE';
    const phaseSpec = s.plan.phases.find((p) => p.name === phase);
    const phaseWeekNum = phaseSpec ? (phaseSpec.weeks.indexOf(weekNum) + 1) : 1;
    const phaseWeeksTotal = phaseSpec ? phaseSpec.weeks.length : 0;
    return { weekNum, week, phase, phaseWeekNum, phaseWeeksTotal };
  }

  function currentWeekPlan() {
    return getCurrentWeekContext().week || null;
  }

  function todayWorkout() {
    const s = getState();
    const week = currentWeekPlan();
    if (!week) return null;
    return week.days.find((d) => d.date === s.today) || null;
  }

  function fmtDayLabel(isoDate) {
    const d = new Date(isoDate + 'T00:00:00Z');
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
    return `${dow} ${month} ${d.getUTCDate()}`;
  }

  // Expose
  window.RuncinoStore = {
    getState,
    setState,
    subscribe,
    logCheckIn,
    clearCheckIn,
    resetState,
    todayCheckIn,
    recentCheckIns,
    currentWeekPlan,
    getCurrentWeekContext,
    todayWorkout,
    fmtDayLabel,
    SEED_VERSION,
  };

  // Auto-seed on first load
  if (!read()) write(SEED);

  console.log('[runcino-store] loaded · today =', getState().today, '· check-ins logged:', Object.keys(getState().checkins).length);
})();
