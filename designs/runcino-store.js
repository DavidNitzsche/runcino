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
  const SEED_VERSION = 7;

  // ── Shoe-purpose vocabulary ─────────────────────────────────────
  // Canonical run types the shoe is appropriate for. Maps directly to
  // the workout types in buildPlan() (easy/recovery/long/quality/race)
  // plus two extras: 'trail' (surface) and 'daily' (catch-all).
  // /log later uses this to highlight matching shoes for a run's type.
  const SHOE_PURPOSE_OPTIONS = [
    { id: 'easy',      label: 'Easy'      },
    { id: 'recovery',  label: 'Recovery'  },
    { id: 'long',      label: 'Long'      },
    { id: 'threshold', label: 'Threshold' },
    { id: 'intervals', label: 'Intervals' },
    { id: 'race',      label: 'Race'      },
    { id: 'trail',     label: 'Trail'     },
    { id: 'daily',     label: 'Daily'     },
  ];
  const SHOE_PURPOSE_LABEL = Object.fromEntries(SHOE_PURPOSE_OPTIONS.map(o => [o.id, o.label]));
  function formatShoePurposes(purposes) {
    if (!Array.isArray(purposes) || !purposes.length) return '';
    return purposes.map(p => SHOE_PURPOSE_LABEL[p] || p).join(' · ');
  }

  // ── Level doctrine ──────────────────────────────────────────────
  // Mapped from Research/00a-distance-running-training.md §"Volume
  // Guidelines by Experience and Distance" (HM column). Each level
  // has a peak weekly mileage band plus race-experience signals.
  // The app uses these thresholds for:
  //   · placing the user in a level when they edit prefs
  //   · capping weekly volume + long-run length in buildPlan()
  //   · gating which workout types appear (Advanced+ unlocks
  //     cruise-interval thresholds and HM-finish long runs)
  const LEVEL_DOCTRINE = {
    beginner:     { label: 'Beginner',     peakMiBand: [10, 25],  longRunCapMi: 8,  racesMin: 0, copy: '10–25 mi/wk peak · just finishing distance' },
    intermediate: { label: 'Intermediate', peakMiBand: [25, 50],  longRunCapMi: 13, racesMin: 1, copy: '25–50 mi/wk peak · raced HM or marathon' },
    advanced:     { label: 'Advanced',     peakMiBand: [50, 70],  longRunCapMi: 18, racesMin: 3, copy: '50–70 mi/wk peak · sub-elite mileage' },
    elite:        { label: 'Elite',        peakMiBand: [70, 140], longRunCapMi: 22, racesMin: 8, copy: '70+ mi/wk peak · sub-1:15 HM territory' },
  };

  // Default training prefs — canonical AFC plan shape. Mon recovery,
  // Tue+Thu quality, Wed/Fri easy, Sat rest, Sun long. User edits in
  // /profile mutate these and re-trigger buildPlan().
  const DEFAULT_PREFS = {
    level: 'intermediate',          // research-grounded; user is mid-range volume + sub-1:35 HM
    longRunDay: 'sun',
    qualityDays: ['tue', 'thu'],
    restDay: 'sat',
  };

  // ── Plan builder ────────────────────────────────────────────────
  // Generates all 14 weeks of the AFC Half plan from a compact template.
  // Each week's days roll the date forward from a plan startDate. Day
  // shape: { dow, date, type, label, distanceMi, hasStrength, isRest,
  // paceMin, completed (computed elsewhere via date < today) }.
  //
  // The template is authored in a canonical day-order (long-run = Sun,
  // rest = Sat, quality = Tue/Thu). User prefs rotate the slots: when
  // the user moves long-run to Sat or rest to Fri, the placeholder
  // role-slots reshuffle to match. This is what makes the Training
  // Profile prefs actually influence the plan instead of being decorative.
  function buildPlan(prefs) {
    const p = prefs || DEFAULT_PREFS;
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

    // Slight per-day variance so 'actual vs plan' looks realistic in the
    // mockup. In production this would come from Strava activity matching.
    const variance = [-0.2, 0, 0.2, 0.5, -0.1, 0, 0.1, 0, -0.3, 0.2, 0, 0, -0.1, 0];
    const today = '2026-05-16';

    // Canonical template positions: 0=Mon recovery, 1=Tue quality, 2=Wed easy+strides,
    // 3=Thu easy+S, 4=Fri easy/hill+S, 5=Sat rest, 6=Sun long.
    // Map "role" → "canonical day index" so we can rotate per prefs.
    const canonicalIdx = { recovery: 0, qualityA: 1, easyMid: 2, easyOrStrides: 3, easyLate: 4, rest: 5, long: 6 };
    // Compute target day-index (0=Mon..6=Sun) for each role based on prefs.
    // Falls back to canonical positions when prefs match defaults.
    const dowToIdx = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
    const longIdx = dowToIdx[p.longRunDay] ?? 6;
    const restIdx = dowToIdx[p.restDay] ?? 5;
    const qDays = (p.qualityDays || ['tue', 'thu']).map((d) => dowToIdx[d]).filter((i) => i != null);
    // Build a per-day role assignment. Start with all slots = null; place
    // long → restidx → quality(s) → fill rest with recovery/easy.
    function buildRoleMap() {
      const slots = new Array(7).fill(null);
      slots[longIdx] = 'long';
      if (slots[restIdx] == null) slots[restIdx] = 'rest';
      // Quality days — prefer up to 2; second only if BUILD phase or later
      const qPrimary = qDays[0];
      const qSecondary = qDays[1];
      if (qPrimary != null && slots[qPrimary] == null) slots[qPrimary] = 'qualityA';
      if (qSecondary != null && slots[qSecondary] == null) slots[qSecondary] = 'qualityB';
      // Recovery — Monday by default, or first open slot
      let recoveryPlaced = false;
      if (slots[0] == null) { slots[0] = 'recovery'; recoveryPlaced = true; }
      else for (let i = 0; i < 7; i++) if (slots[i] == null) { slots[i] = 'recovery'; recoveryPlaced = true; break; }
      // Remaining slots = easy days
      for (let i = 0; i < 7; i++) if (slots[i] == null) slots[i] = 'easy';
      return slots;
    }
    const roleMap = buildRoleMap();

    // Volume cap from level doctrine (caps the long run + scales weekly volume).
    const lvl = LEVEL_DOCTRINE[p.level] || LEVEL_DOCTRINE.intermediate;
    function applyLevelCap(role, distanceMi) {
      if (role === 'long' && distanceMi > lvl.longRunCapMi) return lvl.longRunCapMi;
      return distanceMi;
    }

    const weeks = template.map((dayTpl, wIdx) => {
      const weekNum = wIdx + 1;
      const phase = phaseFor(weekNum);
      const wkStart = isoAdd(startDate, wIdx * 7);
      // Source the canonical day tuples by ROLE rather than by position,
      // then re-place them according to the user's roleMap.
      const canonical = {
        recovery:  dayTpl[0],
        qualityA:  dayTpl[1],
        qualityB:  dayTpl[3] && dayTpl[3][0] === 'quality' ? dayTpl[3] : null, // only in BUILD+
        easy:      dayTpl[2] || dayTpl[4],
        easyMid:   dayTpl[2],
        easyAlt:   dayTpl[4],
        rest:      null,
        long:      dayTpl[6],
      };
      const days = roleMap.map((role, dIdx) => {
        const date = isoAdd(wkStart, dIdx);
        const dow = dowList[dIdx];
        // Resolve tuple for this role. Falls back to an easy day when
        // the canonical week doesn't have a tuple for the requested
        // role (eg user wants 2 quality days but the BASE template
        // only has 1 — second quality slot becomes an easy day).
        let t;
        if (role === 'rest') t = null;
        else if (role === 'qualityB' && canonical.qualityB == null) t = canonical.easy;
        else t = canonical[role] != null ? canonical[role] : canonical.easy;
        if (!t) return { dow, date, type: 'rest', label: 'Rest', isRest: true };
        const [type, label, distanceMi, hasStrength] = t;
        const paceMin = type === 'easy' ? '9:15'
                     : type === 'recovery' ? '10:00'
                     : type === 'long' ? '9:30'
                     : type === 'quality' ? '7:30'
                     : type === 'race' ? '7:15'
                     : '9:00';
        const cappedDistance = applyLevelCap(role, distanceMi);
        const day = { dow, date, type, label, distanceMi: cappedDistance, paceMin };
        if (hasStrength) day.hasStrength = true;
        // Past completed days get an actualMi (simulating Strava match).
        // Thursday May 14 is a known double-run day — user ran twice; total
        // is plan 5.5 + extra 3.2 = 8.7. In production this would come from
        // summing Strava activities on the same calendar date.
        if (date < today && type !== 'rest') {
          if (date === '2026-05-14') {
            day.actualMi = 8.7;
            day.activitiesCount = 2;
          } else {
            const vIdx = (wIdx * 7 + dIdx) % variance.length;
            const actual = Math.max(0, Math.round((cappedDistance + variance[vIdx]) * 10) / 10);
            day.actualMi = actual;
            day.activitiesCount = 1;
          }
        }
        return day;
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

  // Shoe wear-status derived from currentMi ÷ capMi.
  // Returns { label, tone } where tone drives the color of the status pill.
  function shoeStatus(mi, cap) {
    const pct = (mi || 0) / (cap || 300);
    if (pct >= 0.90) return { label: 'Retire soon', tone: 'warn' };
    if (pct >= 0.70) return { label: 'Aging',       tone: 'amber' };
    if (pct >= 0.20) return { label: 'Healthy',     tone: 'green' };
    return { label: 'Fresh', tone: 'green' };
  }

  const SEED = {
    _version: SEED_VERSION,
    today: '2026-05-16',
    // Identity. avatar.mode is 'initials' | 'strava' | 'upload'.
    // stravaUrl is populated by the (future) Strava OAuth flow; until
    // that exists, the toggle in /profile shows it as unavailable.
    user: {
      name: 'David Nitzsche',
      initials: 'DN',
      age: 40,
      sex: 'M',
      location: 'Los Angeles',
      avatar: { mode: 'initials', uploadDataUrl: null, stravaUrl: null },
    },

    // Training prefs — what the engine reads to shape the plan.
    prefs: { ...DEFAULT_PREFS },

    // Personal goals — coach surfaces these in the weekly narrative.
    // type: 'speed' | 'volume' | 'habit'; target: human label;
    // progress: 0-100; meta: short status note.
    goals: {
      active: [
        { id: 'g-sub-135-half', type: 'speed',  target: 'Sub-1:35 Half Marathon', current: 'Current: 1:34:54 · AFC Half is the test', progress: 92, meta: 'Within range · 6 sec margin' },
        { id: 'g-1000-mi-2026', type: 'volume', target: '1,000 mi in 2026',        current: 'Current: 624 mi · on pace for 1,705 mi',  progress: 62, meta: 'On track · projecting +70%' },
        { id: 'g-strength-2x',  type: 'habit',  target: 'Strength 2× per week',    current: 'This month: 7 sessions across 4 weeks',   progress: 88, meta: 'Light week ago · catch up Sat' },
      ],
    },

    plan: buildPlan(DEFAULT_PREFS),

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

    // Shoe rotation. Source-of-truth for both /profile and /log shoe
    // pickers. Each shoe has:
    //   id           — stable key
    //   name         — full model name
    //   purpose      — short role label ("Race · Long · Tempo")
    //   capMi        — manufacturer-recommended lifetime miles (default 300)
    //   currentMi    — running total (baseline + activities since)
    //   retired      — true if user has marked it retired
    //   color        — accent color (used in mileage bar + log dot)
    shoes: {
      list: [
        // purposes is the structured array (IDs from SHOE_PURPOSE_OPTIONS).
        // Display strings are derived via formatShoePurposes() so /profile,
        // /log shoe picker, and any future "matching shoe" highlight all
        // read from the same canonical source.
        { id: 'nb-sct-v3',     name: 'New Balance SC Trainer v3',   purposes: ['race','long','threshold','intervals'], capMi: 300, currentMi: 40,  retired: false, color: '#2CA82F' },
        { id: 'hoka-mach-6',   name: 'Hoka Mach 6',                 purposes: ['easy','recovery','daily'],              capMi: 300, currentMi: 185, retired: false, color: '#2563EB' },
        { id: 'saucony-es-4',  name: 'Saucony Endorphin Speed 4',   purposes: ['threshold','race','intervals'],         capMi: 300, currentMi: 235, retired: false, color: '#D4900A' },
        { id: 'brooks-casc17', name: 'Brooks Cascadia 17',          purposes: ['trail','long'],                          capMi: 300, currentMi: 275, retired: false, color: '#E85D26' },
      ],
      byRun: {
        // run-id → shoe-id assignments using the real shoe rotation
        'thu-may-14': 'hoka-mach-6',
        'tue-may-12': 'saucony-es-4',
        'mon-may-11': 'hoka-mach-6',
        'sun-may-3':  'nb-sct-v3',
        'thu-may-1':  'hoka-mach-6',
        'sun-apr-26': 'nb-sct-v3',
        'sun-apr-19': 'brooks-casc17',
        'fri-apr-18': 'brooks-casc17',
        'wed-apr-15': 'hoka-mach-6',
        'mon-apr-13': 'saucony-es-4',
        'sat-apr-11': 'brooks-casc17',
        'thu-apr-9':  'hoka-mach-6',
        'tue-apr-7':  'saucony-es-4',
        'sun-apr-5':  'brooks-casc17',
        'fri-apr-3':  'hoka-mach-6',
        'wed-apr-1':  'saucony-es-4',
        'sun-mar-29': 'brooks-casc17',
        'thu-mar-26': 'hoka-mach-6',
        'tue-mar-24': 'hoka-mach-6',
      },
    },
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

  // ── Shoes ────────────────────────────────────────────────────────
  function setShoeForRun(runId, shoeId) {
    if (!runId) return;
    return setState((s) => {
      const byRun = { ...(s.shoes && s.shoes.byRun || {}) };
      if (shoeId) byRun[runId] = shoeId; else delete byRun[runId];
      return { ...s, shoes: { ...s.shoes, byRun } };
    });
  }

  function getShoeForRun(runId) {
    const s = getState();
    return s.shoes?.byRun?.[runId] || null;
  }

  // Active shoes (not retired). Used by both the /profile rotation
  // card and the /log shoe picker so they stay in sync.
  function activeShoes() {
    const s = getState();
    return (s.shoes?.list || []).filter((sh) => !sh.retired);
  }

  // ── Shoe CRUD (called from /profile modals) ─────────────────────
  function addShoe(shoe) {
    if (!shoe || !shoe.name) return;
    const id = shoe.id || ('shoe-' + Date.now().toString(36));
    const entry = {
      id,
      name: shoe.name,
      purposes: Array.isArray(shoe.purposes) ? shoe.purposes : [],
      capMi: shoe.capMi || 300,
      currentMi: shoe.currentMi || 0,
      retired: false,
      color: shoe.color || '#2CA82F',
    };
    return setState((s) => ({ ...s, shoes: { ...s.shoes, list: [...(s.shoes?.list || []), entry] } }));
  }

  function updateShoe(id, patch) {
    if (!id || !patch) return;
    return setState((s) => ({
      ...s,
      shoes: {
        ...s.shoes,
        list: (s.shoes?.list || []).map((sh) => sh.id === id ? { ...sh, ...patch } : sh),
      },
    }));
  }

  function retireShoe(id) { return updateShoe(id, { retired: true }); }
  function unretireShoe(id) { return updateShoe(id, { retired: false }); }
  function deleteShoe(id) {
    return setState((s) => ({
      ...s,
      shoes: {
        ...s.shoes,
        list: (s.shoes?.list || []).filter((sh) => sh.id !== id),
        // Unassign any runs that pointed at the deleted shoe.
        byRun: Object.fromEntries(Object.entries(s.shoes?.byRun || {}).filter(([_, v]) => v !== id)),
      },
    }));
  }

  // ── User / Prefs / Goals (called from /profile modals) ──────────
  function setUser(patch) {
    if (!patch) return;
    return setState((s) => ({ ...s, user: { ...s.user, ...patch } }));
  }

  function setAvatar(mode, dataUrl) {
    return setState((s) => ({
      ...s,
      user: { ...s.user, avatar: { ...(s.user.avatar || {}), mode, uploadDataUrl: mode === 'upload' ? (dataUrl || s.user.avatar?.uploadDataUrl) : s.user.avatar?.uploadDataUrl } },
    }));
  }

  // Setting prefs ALWAYS regenerates the 14-week plan from the new
  // pref shape. That's the actual wiring that makes Training Profile
  // edits influence training — not just decoration.
  function setPrefs(patch) {
    if (!patch) return;
    return setState((s) => {
      const prefs = { ...(s.prefs || DEFAULT_PREFS), ...patch };
      const plan = buildPlan(prefs);
      return { ...s, prefs, plan };
    });
  }

  function addGoal(goal) {
    if (!goal || !goal.target) return;
    const id = goal.id || ('goal-' + Date.now().toString(36));
    const entry = {
      id,
      type: goal.type || 'speed',
      target: goal.target,
      current: goal.current || '',
      progress: typeof goal.progress === 'number' ? goal.progress : 0,
      meta: goal.meta || 'New goal',
    };
    return setState((s) => ({ ...s, goals: { active: [...(s.goals?.active || []), entry] } }));
  }

  function updateGoal(id, patch) {
    return setState((s) => ({
      ...s,
      goals: { active: (s.goals?.active || []).map((g) => g.id === id ? { ...g, ...patch } : g) },
    }));
  }

  function deleteGoal(id) {
    return setState((s) => ({
      ...s,
      goals: { active: (s.goals?.active || []).filter((g) => g.id !== id) },
    }));
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
    // Shoes
    setShoeForRun,
    getShoeForRun,
    activeShoes,
    addShoe,
    updateShoe,
    retireShoe,
    unretireShoe,
    deleteShoe,
    shoeStatus,
    SHOE_PURPOSE_OPTIONS,
    formatShoePurposes,
    // User / Prefs / Goals
    setUser,
    setAvatar,
    setPrefs,
    addGoal,
    updateGoal,
    deleteGoal,
    // Doctrine
    LEVEL_DOCTRINE,
    SEED_VERSION,
  };

  // Auto-seed on first load
  if (!read()) write(SEED);

  console.log('[runcino-store] loaded · today =', getState().today, '· check-ins logged:', Object.keys(getState().checkins).length);
})();
