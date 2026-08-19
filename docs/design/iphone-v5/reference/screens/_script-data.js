<script type="text/x-dc" data-dc-script data-props="{&quot;$preview&quot;:{&quot;width&quot;:1000,&quot;height&quot;:1100},&quot;day&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;easy&quot;,&quot;quality&quot;,&quot;race&quot;],&quot;default&quot;:&quot;easy&quot;,&quot;tsType&quot;:&quot;'easy'|'quality'|'race'&quot;,&quot;section&quot;:&quot;Today&quot;},&quot;readiness&quot;:{&quot;editor&quot;:&quot;int&quot;,&quot;min&quot;:38,&quot;max&quot;:84,&quot;tsType&quot;:&quot;number&quot;,&quot;section&quot;:&quot;Today&quot;},&quot;startFromPhone&quot;:{&quot;editor&quot;:&quot;boolean&quot;,&quot;default&quot;:true,&quot;tsType&quot;:&quot;boolean&quot;,&quot;section&quot;:&quot;Settings&quot;},&quot;compactCoach&quot;:{&quot;editor&quot;:&quot;boolean&quot;,&quot;default&quot;:false,&quot;tsType&quot;:&quot;boolean&quot;,&quot;section&quot;:&quot;Today&quot;},&quot;verdict&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;ahead&quot;,&quot;behind&quot;,&quot;stale&quot;,&quot;weather&quot;,&quot;course&quot;,&quot;injury&quot;,&quot;lock&quot;,&quot;races&quot;],&quot;default&quot;:&quot;ahead&quot;,&quot;tsType&quot;:&quot;'ahead'|'behind'|'stale'|'weather'|'course'|'injury'|'lock'|'races'&quot;,&quot;section&quot;:&quot;Races&quot;},&quot;paceDirection&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;slower&quot;,&quot;faster-training&quot;,&quot;faster-race&quot;],&quot;default&quot;:&quot;slower&quot;,&quot;tsType&quot;:&quot;'slower'|'faster-training'|'faster-race'&quot;,&quot;section&quot;:&quot;Season&quot;}}">
const R = window.FaffRunDesignSystem_1f682c;

// The whole block, sixteen weeks. Load per day in miles, Monday first: phase decides the
// shape (base carries one quality day, the race phases two), weeks 4, 8 and 12 cut back.
const BLOCK_WEEKS = (() => {
  const PHASES = [
    { name: 'Base', from: 1, to: 8, q: 1 },
    { name: 'Quality', from: 9, to: 12, q: 2 },
    { name: 'Race specific', from: 13, to: 15, q: 2 },
    { name: 'Taper', from: 16, to: 16, q: 1 }
  ];
  const TOTALS = [34, 36, 40, 28, 42, 44, 46, 34, 48, 50, 46, 38, 54, 52, 42, 26];
  const LONGS = [14, 14, 16, 11, 16, 16, 18, 13, 18, 20, 16, 14, 20, 18, 14, 26];
  return TOTALS.map((mi, i) => {
    const n = i + 1;
    const phase = PHASES.find((p) => n >= p.from && n <= p.to);
    const long = LONGS[i];
    const cut = [4, 8, 12].indexOf(n) >= 0;
    const race = n === 16;
    const rest = mi - long;
    const easy = Math.round((rest / (phase.q + 3)) * 10) / 10;
    const days = [
      { load: easy },
      { load: phase.q > 1 ? easy + 1 : 0, quality: phase.q > 1 },
      { load: easy + 1, quality: true },
      { load: easy },
      { load: Math.max(3, easy - 1) },
      { load: 0 },
      { load: long, quality: n >= 9 || race, race: race }
    ];
    const now = n === 6;
    if (now) {
      days[3].today = true;
      for (let k = 4; k < 7; k++) days[k].future = true;
    } else if (n > 6) {
      days.forEach((x) => { x.future = true; });
    }
    return {
      week: 'Wk ' + n,
      flag: now ? 'This week' : race ? 'Race week' : cut ? 'Cutback' : phase.name,
      phase: phase.name,
      mi,
      now,
      days,
      detail: [
        { label: race ? 'Race' : 'Long run', value: long + (race ? '.2 mi Sunday' : ' mi') },
        { label: 'Quality', value: phase.q + (phase.q > 1 ? ' sessions' : ' session') + (n < 6 ? ', done' : n === 6 ? ', done' : '') },
        { label: n <= 6 ? 'Ran' : 'Planned', value: (n < 6 ? mi : n === 6 ? 34 : mi) + ' of ' + mi + ' mi' }
      ]
    };
  });
})();

const BLOCK_WEEKS_OLD = [
  {
    week: 'Wk 1', flag: 'Base', mi: 34,
    days: [{ load: 5 }, { load: 0 }, { load: 6, quality: true }, { load: 5 }, { load: 4 }, { load: 0 }, { load: 14 }],
    detail: [{ label: 'Long run', value: '14 mi' }, { label: 'Quality', value: '1 session' }, { label: 'Ran', value: '34 of 34 mi' }]
  },
  {
    week: 'Wk 4', flag: 'Cutback', mi: 28,
    days: [{ load: 4 }, { load: 0 }, { load: 5, quality: true }, { load: 4 }, { load: 4 }, { load: 0 }, { load: 11 }],
    detail: [{ label: 'Long run', value: '11 mi' }, { label: 'Quality', value: '1 session' }, { label: 'Ran', value: '26 of 28 mi' }]
  },
  {
    week: 'Wk 6', flag: 'This week', mi: 44, now: true,
    days: [{ load: 5.2 }, { load: 0 }, { load: 8, quality: true }, { load: 6, today: true }, { load: 5, future: true }, { load: 0, future: true }, { load: 16, quality: true, future: true }],
    detail: [{ label: 'Long run', value: '16 mi Sunday' }, { label: 'Quality', value: '1 session, done' }, { label: 'Ran so far', value: '34 of 44 mi' }]
  },
  {
    week: 'Wk 9', flag: 'Quality', mi: 48,
    days: [{ load: 6, future: true }, { load: 5, quality: true, future: true }, { load: 6, future: true }, { load: 8, quality: true, future: true }, { load: 5, future: true }, { load: 0, future: true }, { load: 18, future: true }],
    detail: [{ label: 'Long run', value: '18 mi' }, { label: 'Quality', value: '2 sessions' }, { label: 'Planned', value: '48 mi' }]
  },
  {
    week: 'Wk 13', flag: 'Peak', mi: 54,
    days: [{ load: 6, future: true }, { load: 8, quality: true, future: true }, { load: 6, future: true }, { load: 9, quality: true, future: true }, { load: 5, future: true }, { load: 0, future: true }, { load: 20, future: true }],
    detail: [{ label: 'Long run', value: '20 mi, the longest' }, { label: 'Quality', value: '2 sessions' }, { label: 'Planned', value: '54 mi' }]
  },
  {
    week: 'Wk 16', flag: 'Taper', mi: 26,
    days: [{ load: 5, future: true }, { load: 5, quality: true, future: true }, { load: 4, future: true }, { load: 0, future: true }, { load: 3, future: true }, { load: 0, future: true }, { load: 26, quality: true, future: true }],
    detail: [{ label: 'Race', value: '26.2 mi Sunday' }, { label: 'Quality', value: 'One sharpener' }, { label: 'Planned', value: '26 mi' }]
  }
];

// Every change the runner can make to the block from here. The coach states the trade-off in
// full before anything is applied, and the verb on the button is the change itself.
// The whole race calendar, next first, then what has already been run. A is the race the
// block is written for; B is a real read; C is a tune-up that costs nothing.
const RACES = [
  {
    name: 'Clarksburg Half', when: 'Half marathon · 8 Nov · 6 weeks', rank: 'B', value: 'Sub 1:36',
    detail: [{ label: 'Why it is on here', value: 'A real read' }, { label: 'Taper', value: 'Three easy days' }, { label: 'Reads as', value: 'VDOT 49 if hit' }]
  },
  {
    name: 'Davis Turkey Trot', when: '10k · 27 Nov · 9 weeks', rank: 'C', value: 'No taper',
    detail: [{ label: 'Why it is on here', value: 'It is fun' }, { label: 'Taper', value: 'None' }, { label: 'Counts toward', value: 'Nothing' }]
  },
  {
    name: 'CIM', when: 'Marathon · 7 Dec · 10 weeks', rank: 'A', value: 'Sub 3:30', next: true,
    detail: [{ label: 'The plan is written for this', value: '16 weeks' }, { label: 'Taper', value: 'Three weeks' }, { label: 'Course', value: 'Net downhill' }]
  },
  {
    name: 'Summer Breeze Half', when: 'Half marathon · 16 Jul', rank: 'B', value: '1:38:12', done: true,
    detail: [{ label: 'Read', value: 'VDOT 47.9' }, { label: 'Weight', value: 'Full for 7 more days' }, { label: 'Against goal', value: '2:14 short' }]
  },
  {
    name: 'Bay Bridge 10k', when: '10k · 4 May', rank: 'C', value: '41:20', done: true,
    detail: [{ label: 'Read', value: 'VDOT 46.2' }, { label: 'Weight', value: 'Decayed to nothing' }, { label: 'Against goal', value: 'Not comparable' }]
  },
  {
    name: 'CIM', when: 'Marathon · 8 Dec, last year', rank: 'A', value: '3:52:40', done: true,
    detail: [{ label: 'Read', value: 'VDOT 43.8' }, { label: 'Weight', value: 'History only' }, { label: 'To beat', value: '22:40 quicker' }]
  }
];

const PLAN_CHANGES = [
  {
    key: 'cutback', label: 'I need an easier week', sub: 'Week 6 becomes a cutback',
    verb: 'Cut week 6 back',
    say: 'Week 6 drops from 32 mi to 24.5 and the long from 12 to 9.5 · that is 23% off the week. The second quality session becomes an easy run. You lose a hard week of the build. Nothing before or after week 6 moves, and the race date does not change.',
    caveats: [],
    changed: 'Week 6 cut back', changedSub: '32 mi became 24.5 · long run 9.5'
  },
  {
    key: 'travel', label: 'I am away', sub: 'Pick your dates',
    verb: 'Take these dates out',
    changed: 'Travel dates taken out', changedSub: 'Comes back at a reduced load'
  },
  {
    key: 'extra_day', label: 'I can run more days', sub: 'Five now, six from week 7',
    verb: 'Run six days',
    say: 'Six days spreads the same miles thinner · every run gets easier and the week gets harder to escape. It suits base, and you can go back to five in the taper. This changes the block only — your saved weekly frequency stays five days until you update it in Settings.',
    changed: 'Six days a week', changedSub: 'Same miles, one more day'
  },
  {
    key: 'another_race', label: 'I entered another race', sub: 'Santa Monica 10K in week 3',
    verb: 'Put the 10k in',
    say: 'Santa Monica 10K on 5 September lands in week 3. The two days before it ease off and the days after it stay easy until you have recovered, so that week reads as a cutback. You trade that week\u2019s cruise intervals for a real fitness read 14 weeks out. The long run is not displaced unless the race falls on it. The rest of the block is re-authored from where you are now, so other weeks can move by a mile or two. Nothing before today changes.',
    caveats: ['The week mileages after this are re-authored by the plan engine, not the numbers above.', 'The diff shows exactly what moved once it has run.'],
    changed: 'Santa Monica 10K in week 3', changedSub: 'Replaces the quality session'
  },
  {
    key: 'move_day', label: 'I need to move a day', sub: 'Easy run, Fri → Mon',
    verb: 'Move Friday to Monday',
    say: 'Your easy run moves from Friday 23 October to Monday 26 October. Friday becomes rest. The week keeps its 34.5 mi and its hard days stay spaced the way doctrine asks.',
    changed: 'Easy run moved to Monday', changedSub: 'Friday is now a rest day'
  }
];

const NIGGLES = ['Left calf', 'Right calf', 'Achilles', 'Knee', 'Hip', 'Foot'];

const SHOES = [
  { name: 'Endorphin Speed 4', mi: 214 },
  { name: 'Novablast 5', mi: 386 },
  { name: 'Vaporfly 3', mi: 58 }
];

const RETIRE_AT = { 'Endorphin Speed 4': 250, 'Novablast 5': 400, 'Vaporfly 3': 250 };
const RETIRED_SHOES = [
  { name: 'Pegasus 40', mi: 412, sub: 'Retired · replaced by the Novablast' }
];

const ICON_URL = (inner) => "'data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>') + "'";
const CAL_ICON_URL = ICON_URL('<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');

// A scrolling list of upcoming and recent sessions, grouped by week. Reachable from the
// calendar icon beside the avatar on Today.
const CALENDAR_WEEKS = [
  {
    range: 'This week', sub: '34 of 44 mi',
    days: [
      { date: 'Mon 17', type: 'Rest day', rest: true, done: true },
      { date: 'Tue 18', type: 'Easy', dose: '5 mi', done: true },
      { date: 'Wed 19', type: 'Threshold', dose: '2 \u00d7 3 mi', done: true },
      { date: 'Thu 20', type: 'Easy', dose: '6 mi', today: true },
      { date: 'Fri 21', type: 'Easy', dose: '5 mi', future: true },
      { date: 'Sat 22', type: 'Rest day', rest: true, future: true },
      { date: 'Sun 23', type: 'Long', dose: '16 mi', future: true }
    ]
  },
  {
    range: 'Week 7', sub: '34 mi planned · cutback',
    days: [
      { date: 'Mon 24', type: 'Easy', dose: '4 mi', future: true },
      { date: 'Tue 25', type: 'Rest day', rest: true, future: true },
      { date: 'Wed 26', type: 'Threshold', dose: '2 \u00d7 2 mi', future: true },
      { date: 'Thu 27', type: 'Easy', dose: '4 mi', future: true },
      { date: 'Fri 28', type: 'Rest day', rest: true, future: true },
      { date: 'Sat 29', type: 'Rest day', rest: true, future: true },
      { date: 'Sun 30', type: 'Long', dose: '13 mi', future: true }
    ]
  },
  {
    range: 'Week 8', sub: '46 mi planned · quality returns',
    days: [
      { date: 'Mon 31', type: 'Easy', dose: '5 mi', future: true },
      { date: 'Tue 1', type: 'Rest day', rest: true, future: true },
      { date: 'Wed 2', type: 'Threshold', dose: '3 \u00d7 2 mi', future: true },
      { date: 'Thu 3', type: 'Easy', dose: '6 mi', future: true },
      { date: 'Fri 4', type: 'Easy', dose: '5 mi', future: true },
      { date: 'Sat 5', type: 'Rest day', rest: true, future: true },
      { date: 'Sun 6', type: 'Long', dose: '17 mi', future: true }
    ]
  }
];

// A push from the Races schedule row. Turns the calendar-entry gap into a course, a pace
// plan and a taper read.
const RACE_DETAIL = {
  name: 'CIM', when: 'Marathon · Sunday 7 December · 10 weeks out',
  goal: '3:30:00', projected: '3:31:48', gap: '+1:48',
  elevation: [120, 118, 114, 116, 108, 102, 98, 90, 84, 80, 76, 70, 64, 60, 55, 50, 44, 40, 36, 30, 24, 18, 10, 4, 0, 0],
  marks: [{ at: .08, label: 'Rollers, mile 3' }, { at: .5, label: 'Big drop, mile 16' }, { at: .93, label: 'Flat to the line' }],
  elevFootnotes: ['Net \u2212120 ft', 'Nothing over 2%'],
  paceSections: [
    { title: 'Miles 1 \u2013 6', note: 'Easy into it', pace: '8:00 \u00b7 8:10 /mi' },
    { title: 'Miles 7 \u2013 20', note: 'Marathon effort, the pace that matters', pace: '7:58 \u00b7 8:05 /mi' },
    { title: 'Miles 21 \u2013 26.2', note: 'Whatever is left, honestly', pace: 'Even or better' }
  ],
  taperWeeks: 10, taperMax: 16,
  shoe: 'Endorphin Speed 4', shoeSub: '214 mi · plenty left for race day',
  coach: 'The course drops the whole way \u00b7 bank nothing early and it pays you back after mile 20.'
};

// A session in progress, started from the phone. Simulated, not live GPS.
const LIVE_RUN = {
  type: 'Threshold', miTotal: 6, miDone: 2.4, elapsed: '18:42',
  pace: 452, band: { low: 440, high: 465 }, paceEnds: ['7:00', '8:20'],
  hr: 158, hrCeiling: 168, hrEnds: ['110', '180'],
  splitsSoFar: [{ mi: 1, pace: '7:38' }, { mi: 2, pace: '7:31' }],
  interval: 'Interval 2 of 4 \u00b7 0.6 mi to go',
  coach: 'Right on the number \u00b7 hold it through the interval, then take the full recovery.'
};

// Treadmill variant: speed and incline drive the numbers, not GPS. No route, no weather.
// The console is the point \u2014 big enough to read at arm's length while moving.
const TREADMILL_RUN = {
  type: 'Threshold', miTotal: 6, miDone: 2.4, elapsed: '18:42',
  speedDefault: 8.0, inclineDefault: 1.0,
  hr: 158, hrCeiling: 168, hrEnds: ['110', '180'], hrBand: { low: 100, high: 168 },
  splitsSoFar: [{ mi: 1, pace: '7:38' }, { mi: 2, pace: '7:31' }],
  interval: 'Interval 2 of 4 \u00b7 0.6 mi to go',
  next: 'Next \u00b7 8.6 mph in 0.6 mi',
  coach: 'The belt is holding the pace for you \u00b7 just manage the effort and the heart rate.'
};

// A niggle flagged from Today. Rest, not run, with the week rewritten around it.
const INJURY = {
  area: 'Left calf', flagged: 'Flagged 2 days ago',
  verdict: 'Rest, not run \u00b7 the calf gets three days to settle before anything reintroduces load.',
  weekNote: '12 mi this week, walking and easy cross-training only.',
  checkOptions: [
    { key: 'better', label: 'Better today', sub: 'Loosen back in gradually tomorrow' },
    { key: 'same', label: 'About the same', sub: 'One more day off, then reassess' },
    { key: 'worse', label: 'Worse', sub: 'Worth a call with someone who can look at it' }
  ]
};

// A planned break, not a flare. The plan resumes where the runner is.
const WEEK_OFF = {
  reason: 'Travel \u00b7 Denver, altitude and no motivation to chase miles',
  range: '18 \u2013 24 August',
  coach: 'A zero week goes in the book \u00b7 the plan resumes where you are, not where the calendar says.',
  returns: 'Monday 25 \u00b7 Easy, 4 mi'
};

// After the goal race, before the next block is written.
const OFF_SEASON = {
  since: 'Since CIM \u00b7 3 weeks ago',
  note: 'No block is written. Running is optional, and nothing here is measured against a goal.',
  weekRange: '0 \u2013 20 mi, whatever feels good'
};

// The five ways a runner arrives with a fitness estimate. Radio, per the design system.
const ONBOARD_MODES = [
  { key: 'recent', label: 'I have a recent race', sub: 'A time from the last 12 months reads best' },
  { key: 'effort', label: 'I know my hard-effort pace', sub: 'A pace you can hold for 20 minutes, honestly' },
  { key: 'consistent', label: 'I have been training without racing', sub: 'Consistent weeks, no time trial' },
  { key: 'timeoff', label: 'I am coming back from time off', sub: 'Fitness has to be rebuilt, not assumed' },
  { key: 'new', label: 'I am new to structured training', sub: 'The habit comes before the pace' }
];

const DAYS = {
  easy: {
    stateName: 'a mid-base easy day', badge: 'Easy', badgeTone: 'neutral',
    dateLine: 'Thursday 20 August', weekLine: 'Week 6 of 16 · Base',
    type: 'Easy', dose: '6 mi', note: 'Recovery loop · about 52 min',
    heroLede: '6 mi easy', heroA: '~52', heroAUnit: 'min', heroB: '8:50–9:35', heroBUnit: '/mi',
    paceMin: 480, paceMax: 640, paceBand: { low: 530, high: 575 }, paceTarget: null,
    paceEnds: ['8:00', '10:40'], paceLabel: 'Pace band 8:50 · 9:35',
    askedPace: '8:50 · 9:35',
    plan: [
      { title: 'Easy run', tone: 'hue', note: '', steps: [{ n: 1, main: 'Conversational the whole way', sub: '8:50 · 9:35 /mi' }] }
    ],
    hr: 146, hrMin: 110, hrMax: 170, hrBand: { low: 110, high: 146 }, hrEnds: ['110', '170'],
    eff: 3, effBand: { low: 2, high: 4 },
    coach: 'Keep it truly easy. Nose-breathing pace the whole way · Saturday is the one that needs your legs.',
    why: 'Base miles are the floor the rest of the block stands on. Saturday is the run that needs your legs · today just keeps the engine turning over.',
    shoe: 1, fuel: null, canMove: true, moveSub: 'Friday and Saturday are both open',
    moveOptions: [
      { label: 'Move to Friday', sub: 'Friday is empty', done: 'Moved to Friday', doneSub: 'Today is now a rest day' },
      { label: 'Move to Saturday', sub: 'Sits before Sunday\u2019s long run', done: 'Moved to Saturday', doneSub: 'Back to back with the long run' },
      { label: 'Skip it', sub: 'The week loses 6 mi', done: 'Skipped', doneSub: 'The week is 34 of 44 mi and that is fine' }
    ],
    weather: '55°F · light rain, no wind',
    nextUp: 'Friday · 5 mi easy', nextNote: 'Then 16 mi Sunday, the one that matters',
    readyDetail: [
      { label: 'Sleep', sub: 'Two nights under seven', value: '6h 40m' },
      { label: 'Resting heart', sub: 'Your normal is 48', value: '51' }
    ],
    readiness: 64, weekSub: '34 of 44 mi planned', weekPct: '77%',
    grad: 'var(--g-rest)', railToday: 'var(--state-rest)', gradRail: 'var(--material-control)',
    time: 'about 54 min', zone: 2, zoneShares: [12, 76, 12, 0, 0], weekDone: 34, weekPlan: 44,
    coachShort: 'Keep it truly easy · nose-breathing pace the whole way.',
    segments: [{ mi: 6, kind: 'easy', label: '6 mi', pace: '8:50 · 9:35', dist: '6 mi' }],
    week: [{ load: 5.2 }, { load: 0 }, { load: 8, quality: true }, { load: 6, today: true }, { load: 5, future: true }, { load: 0, future: true }, { load: 16, quality: true, future: true }],
    strip: [17, 18, 19, 20, 21, 22, 23], stripToday: 3, stripRun: [0, 2, 3, 4, 6], stripDone: [0, 1, 2],
    groupHeader: 'Targets', groupFooter: 'Bands come from your last 34 runs, anchored on a 63-day window.',
    rows: [{ label: 'Pace band', value: '8:50 · 9:35 /mi' }, { label: 'Heart-rate cap', value: '146 bpm' }, { label: 'Best window', value: '6 — 8 AM' }],
    dockLabel: 'Start the session', dockNote: 'Your watch has it · starting there logs it here.',
    watchSub: 'Today is already on the watch'
  },
  quality: {
    stateName: 'a threshold session', badge: 'Threshold', badgeTone: 'neutral',
    dateLine: 'Tuesday 25 August', weekLine: 'Week 7 of 16 · Build',
    type: 'Threshold', dose: '2 × 3 mi @ 7:22', note: 'Ladder · 1 mi float between',
    heroLede: '2 × 3 mi', heroA: '7:15–7:29', heroAUnit: '/mi work', heroB: '9:15', heroBUnit: '/mi float',
    paceMin: 415, paceMax: 600, paceBand: { low: 435, high: 449 }, paceTarget: 442,
    paceEnds: ['6:55', '10:00'], paceLabel: 'Work pace 7:15 · 7:29',
    askedPace: '7:15 · 7:29',
    plan: [
      { title: 'Warm up', tone: 'quiet', note: '1.5 mi', steps: [{ n: 1, main: '1.5 mi easy', sub: '9:30 /mi or slower' }] },
      { title: 'Twice through', tone: 'hue', note: '8 mi', steps: [
        { n: 2, main: '3 mi at 7:22', sub: '7:15 · 7:29 /mi' },
        { n: 3, main: '1 mi float', sub: '9:05 · 9:25 /mi' }
      ] },
      { title: 'Cool down', tone: 'quiet', note: '1.5 mi', steps: [{ n: 4, main: '1.5 mi easy', sub: '9:30 /mi or slower' }] }
    ],
    hr: 172, hrMin: 120, hrMax: 185, hrBand: { low: 150, high: 172 }, hrEnds: ['120', '185'],
    eff: 7, effBand: { low: 6, high: 8 },
    coach: 'Two blocks, one honest effort each. If the second drifts past 7:35, stop it at two miles · the work is already banked.',
    why: 'This is the session that teaches your legs to hold 7:22 after it stops being comfortable. Two blocks is enough · a third buys fatigue, not fitness.',
    shoe: 0, fuel: null, canMove: true, moveSub: 'Thursday is the only day that still works this week',
    moveOptions: [
      { label: 'Move to Thursday', sub: 'The last day it still fits', done: 'Moved to Thursday', doneSub: 'Friday becomes the easy day' },
      { label: 'Make it easy instead', sub: '6 mi conversational, no work', done: 'Swapped for 6 mi easy', doneSub: 'The block absorbs one missed session' },
      { label: 'Skip it', sub: 'The week loses its only quality run', done: 'Skipped', doneSub: 'Next Tuesday carries the work' }
    ],
    weather: '63°F · humid, still',
    nextUp: 'Wednesday · rest', nextNote: 'Nothing until Thursday, and that is the point',
    readyDetail: [
      { label: 'Sleep', sub: 'Short, and the session is hard', value: '6h 05m' },
      { label: 'Resting heart', sub: 'Your normal is 48', value: '53' }
    ],
    readiness: 57, weekSub: '18 of 46 mi planned', weekPct: '39%',
    grad: 'var(--g-quality)', railToday: 'var(--state-quality)', gradRail: 'var(--material-control)',
    time: 'about 75 min', zone: 4, zoneShares: [8, 26, 14, 46, 6], weekDone: 18, weekPlan: 46,
    coachShort: 'Two blocks, one honest effort each · past 7:35 you stop at two miles.',
    segments: [
      { mi: 1.5, kind: 'easy', label: '', pace: '9:30', dist: '1.5' },
      { mi: 3, kind: 'quality', label: '7:22', pace: '7:22', dist: '3 mi' },
      { mi: 1, kind: 'easy', label: '', pace: '9:15', dist: '1' },
      { mi: 3, kind: 'quality', label: '7:22', pace: '7:22', dist: '3 mi' },
      { mi: 1.5, kind: 'easy', label: '', pace: '9:30', dist: '1.5' }
    ],
    week: [{ load: 6 }, { load: 9, quality: true, today: true }, { load: 0, future: true }, { load: 7, future: true }, { load: 5, future: true }, { load: 0, future: true }, { load: 18, quality: true, future: true }],
    strip: [24, 25, 26, 27, 28, 29, 30], stripToday: 1, stripRun: [0, 1, 3, 4, 6], stripDone: [0],
    groupHeader: 'Targets', groupFooter: 'The float is not a rest · it keeps the second block honest.',
    rows: [{ label: 'Work pace', value: '7:15 · 7:29 /mi' }, { label: 'Float', value: '9:15 /mi' }, { label: 'Heart-rate cap', value: '172 bpm' }, { label: 'Bail line', value: '7:35 /mi' }],
    dockLabel: 'Start the session', dockNote: 'Warm up 12 min before the first block.',
    watchSub: 'Blocks and floats are loaded'
  },
  race: {
    stateName: 'race morning', badge: 'Race', badgeTone: 'signal',
    dateLine: 'Sunday 4 October', weekLine: 'Race day · Marathon',
    type: 'Race', dose: '26.2 mi · 8:00 /mi', note: 'Goal 3:30 · flat to halfway',
    heroLede: 'Marathon', heroA: '3:30', heroAUnit: 'goal', heroB: '8:55', heroBUnit: 'gun',
    paceMin: 450, paceMax: 520, paceBand: { low: 476, high: 484 }, paceTarget: 480,
    paceEnds: ['7:30', '8:40'], paceLabel: 'Goal pace 7:56 · 8:04',
    askedPace: '7:56 · 8:04',
    plan: [
      { title: 'Race', tone: 'hue', note: '26.2 mi', steps: [
        { n: 1, main: 'First 10k at 8:00', sub: '7:56 · 8:04 /mi' },
        { n: 2, main: 'Mile 7 to 20, hold 8:00', sub: 'no quicker, whatever the crowd does' },
        { n: 3, main: 'Last 10k', sub: '7:56 or quicker if it is there' }
      ] }
    ],
    hr: 168, hrMin: 120, hrMax: 180, hrBand: { low: 140, high: 168 }, hrEnds: ['120', '180'],
    eff: 9, effBand: { low: 8, high: 10 },
    coach: 'Eight flat to halfway. Anything quicker in the first six miles is borrowed, not banked · fuel at 40 minutes and every 30 after.',
    why: 'Sixteen weeks are in the bank. Today is the withdrawal · the only thing left to get right is the first half.',
    shoe: 2, fuel: { value: '5 gels', sub: 'At 40 minutes, then every 30' }, canMove: false, moveSub: '',
    weather: '52°F · 8 mph headwind out',
    nextUp: 'Next week · walking only', nextNote: 'The plan resumes when the legs do',
    readyDetail: [
      { label: 'Sleep', sub: 'Race-eve normal', value: '7h 20m' },
      { label: 'Resting heart', sub: 'Your normal is 48', value: '46' }
    ],
    readiness: 71, weekSub: '12 of 26 mi · taper', weekPct: '46%',
    grad: 'var(--g-race)', railToday: 'var(--state-race)', gradRail: 'var(--material-control)',
    time: 'gun 8:55', zone: 3, zoneShares: [0, 18, 54, 26, 2], weekDone: 12, weekPlan: 26,
    coachShort: 'Eight flat to halfway · anything quicker early is borrowed, not banked.',
    segments: [
      { mi: 6.2, kind: 'race', label: '8:00', pace: '8:00', dist: '10k' },
      { mi: 13.1, kind: 'race', label: '8:00', pace: '8:00', dist: 'to 20' },
      { mi: 6.9, kind: 'racefast', label: '7:56', pace: '7:56', dist: 'last 10k' }
    ],
    week: [{ load: 5 }, { load: 4 }, { load: 6, quality: true }, { load: 0 }, { load: 3 }, { load: 2 }, { load: 26.2, quality: true, today: true }],
    strip: [28, 29, 30, 1, 2, 3, 4], stripToday: 6, stripRun: [0, 1, 2, 4, 5, 6], stripDone: [0, 1, 2, 3, 4, 5],
    groupHeader: 'The plan', groupFooter: 'Corral opens 8:10 · start 8:55. The watch has the pacing plan.',
    rows: [{ label: 'First 10k', value: '50:00' }, { label: 'Halfway', value: '1:44:30' }, { label: 'Last 10k', value: '49:00' }, { label: 'Fuel', value: '40 min · then every 30' }],
    dockLabel: 'Start the race', dockNote: 'Corral 8:10 · gun 8:55.',
    watchSub: 'Pacing plan and fuel alerts loaded'
  }
};

const VERDICTS = {
  ahead: {
    mode: 'decision', badge: 'Comfortable \u00b7 realistic',
    menuLabel: 'Fitness ahead of the goal',
    currentLabel: 'Sub 3:30', altLabel: '3:16:45', altVdot: '51.2', altGap: '+0:18', baseVdot: '51.2', baseGap: '+2:56',
    ask: 'Fitness now supports more than the plan asked for \u00b7 VDOT reads at 51.2 against a goal that only needed 49.8.',
    targets: [{ label: 'Safe target', value: 'Sub 3:30' }, { label: 'Stretch target', value: '3:16:45' }],
    cautions: ['Only two long runs have touched marathon effort', 'The last hard week ran short on sleep', 'Chip time locks four weeks out, not sooner'],
    takeLabel: 'Take 3:16:45', thirdLabel: 'Not now',
    holdLine: 'Sub 3:30 stands \u00b7 the extra fitness banks as margin, not a faster number, and I will ask again at four weeks out.',
    takeLine: '3:16:45 it is \u00b7 every pace in the plan just moved up to hold it.',
    laterLine: 'Left open \u00b7 nothing changes today and I will put it in front of you again next Sunday.'
  },
  behind: {
    mode: 'decision', badge: 'Aggressive',
    menuLabel: 'Fitness behind the goal',
    currentLabel: 'Sub 3:30', altLabel: 'Sub 3:42', altVdot: '46.1', altGap: '\u22120:00', baseVdot: '46.1', baseGap: '\u22124:10',
    ask: 'The goal needs more than today\u2019s fitness shows \u00b7 VDOT reads 46.1 against the 49.8 that Sub 3:30 requires, with eight weeks left to close it.',
    targets: [{ label: 'Safe target', value: 'Sub 3:42' }, { label: 'Stretch target', value: 'Sub 3:30' }],
    cautions: ['Long runs have stalled at 12 mi for three weeks', 'Two threshold sessions were cut short this block', 'Eight weeks is tight for a gap this size'],
    takeLabel: 'Take Sub 3:42', thirdLabel: 'Not now',
    holdLine: 'Sub 3:30 stays the goal \u00b7 the next four weeks need to close real ground, not just hold pace.',
    takeLine: 'Sub 3:42 it is \u00b7 the plan resets around a number the fitness already supports.',
    laterLine: 'Left open \u00b7 I will bring the same numbers back after next week\u2019s long run.'
  },
  stale: {
    mode: 'decision', badge: 'Unreadable',
    menuLabel: 'Evidence has gone stale',
    currentLabel: 'Sub 3:30', altLabel: '3:16:45', altVdot: '51.2', altGap: '+0:18', baseVdot: '51.2*', baseGap: '+2:56',
    ask: 'The last real evidence is 19 days old \u00b7 nothing since has touched marathon effort, so today\u2019s number is a guess wearing a decimal point.',
    targets: [{ label: 'Safe target', value: 'Sub 3:30' }, { label: 'Stretch target', value: '3:16:45' }],
    cautions: ['No run above 10 mi since the 19-day mark', 'The next real test is not until Saturday', 'Chip time locks in five weeks, not sooner'],
    takeLabel: 'Take 3:16:45', thirdLabel: 'Wait for Saturday',
    holdLine: 'Sub 3:30 stands until Saturday says otherwise.',
    takeLine: '3:16:45 it is, on evidence that is three weeks old \u00b7 Saturday either confirms it or walks it back.',
    laterLine: 'Left open \u00b7 Saturday\u2019s long run gets the real say, not this reading.'
  },
  weather: {
    mode: 'fact', badge: 'Unchanged',
    menuLabel: 'Race-morning heat',
    ask: 'Race morning heat is forecast at 68\u00b0F wet-bulb, well above what the paces were built for \u00b7 the goal stands, race morning is harder.',
    cautions: ['Heat like this has cost 3\u20134% in every past race', 'The fuel plan was not built for this dew point', 'Course shade is thin after mile 18'],
    actions: [
      { key: 'ack', label: 'Acknowledge', sub: 'The goal and pacing plan stay exactly as they are' },
      { key: 'repace', label: 'Re-pace the day', sub: 'Build a heat contingency for race morning only' }
    ],
    settledLines: {
      ack: 'Acknowledged \u00b7 Sub 3:30 stands, race morning just gets no easier.',
      repace: 'Race morning gets a heat contingency \u00b7 the goal itself does not change.'
    }
  },
  course: {
    mode: 'fact', badge: 'Unchanged \u00b7 projection moves',
    menuLabel: 'Course changed',
    ask: 'The final six miles were rerouted uphill this week \u00b7 we can see the elevation moved, we cannot know which course you will actually race.',
    cautions: ['312 ft more climb than the original route', 'No long run has touched a grade like mile 24', 'The race director has not confirmed a certified time'],
    actions: [
      { key: 'ack', label: 'Acknowledge', sub: 'The projection updates, the goal does not' }
    ],
    settledLines: {
      ack: 'Acknowledged \u00b7 the projection now reflects the new elevation.'
    }
  },
  injury: {
    mode: 'decision', badge: 'Out-of-reach \u00b7 date-passed',
    menuLabel: 'Returning from injury',
    currentLabel: 'Sub 3:30', altLabel: 'Finish healthy', altVdot: '46.8', altGap: '\u2014', baseVdot: '46.8', baseGap: '+2:30',
    ask: 'Sub 3:30 was set before the calf flare \u00b7 four weeks back running is not four weeks of marathon buildup.',
    targets: [{ label: 'Safe target', value: 'Finish healthy' }, { label: 'Stretch target', value: 'Sub 3:30' }],
    cautions: ['Longest run back is 9 mi, not 20', 'The calf has not been tested above threshold', 'Six weeks remain to rebuild what three months lost'],
    takeLabel: 'Take finish healthy', thirdLabel: 'Not now',
    holdLine: 'Sub 3:30 stays on the board \u00b7 the calf gets veto power over every week between here and there.',
    takeLine: 'Finish healthy it is \u00b7 the plan stops asking the calf for a number.',
    laterLine: 'Left open \u00b7 I will ask again once the calf has a real test behind it.'
  },
  lock: {
    mode: 'fact', badge: 'Training effort \u00b7 race to lock in',
    menuLabel: 'Chip time locks soon',
    ask: 'Chip time locks Friday \u00b7 confirm the official time now, or leave it provisional until then.',
    cautions: ['Two more long runs before the lock, not four', 'VDOT has moved twice already this block', 'A wrong guess here means the wrong corral all day'],
    actions: [
      { key: 'confirm', label: 'Confirm official time', sub: 'Locks the corral to Sub 3:30' },
      { key: 'provisional', label: 'Leave it provisional', sub: 'Stays labeled training effort until Friday' }
    ],
    settledLines: {
      confirm: 'Confirmed \u00b7 Sub 3:30 is locked in for the corral.',
      provisional: 'Left provisional \u00b7 still training effort until Friday.'
    }
  },
  races: {
    mode: 'choice', badge: 'Open-ended, loosely',
    menuLabel: 'Two A races conflict',
    ask: 'CIM and the half in October are both marked A \u00b7 the plan can peak for one, not both \u00b7 which one is the goal.',
    cautions: ['The half sits five weeks before CIM', 'Peaking twice costs both a full taper', 'Only one can keep the current long-run ramp'],
    actions: [
      { key: 'cim', label: 'CIM is the goal', sub: 'The half runs as a supported long run, not a peak' },
      { key: 'half', label: 'The half is the goal', sub: 'CIM becomes the supported one instead' }
    ],
    settledLines: {
      cim: 'CIM is the goal \u00b7 the half runs as a supported long run.',
      half: 'The half is the goal \u00b7 CIM becomes the supported race instead.'
    }
  }
};

// Readiness cratered overnight and the session downgraded while the runner slept.
// Three independent signals converged — sleep alone never moves a session, per the build gate.
const OVERNIGHT = {
  changedNote: 'Updated 3:12 AM \u00b7 was Threshold',
  type: 'Easy', dose: '5 mi',
  coach: 'Three short nights, four days of low HRV and a resting heart rate above your usual. Today is easy running instead. The threshold session comes back when the numbers do.',
  converged: [
    { label: 'Sleep, 7-day median', sub: 'Your baseline is 7h 10m', value: '5h 40m' },
    { label: 'HRV, four days low', sub: 'Your baseline is 68 ms', value: '52 ms' },
    { label: 'Resting heart', sub: 'Your baseline is 48', value: '54' }
  ],
  movedLabel: 'Threshold, 2 \u00d7 3 mi', movedSub: 'Moves to Thursday, the last day it still fits'
};

// A fitness re-anchor, stated plainly. Zones move by different amounts — faster zones shift
// less — and the copy stops short of naming a cause the evidence doesn't confirm.
// Faster has two distinct sources: a race result is hard evidence; a training-derived read is
// modelled and soft-capped, and wears the tilde mark reserved for modelled numbers.
const PACE_SHIFT = {
  slower: {
    since: 'Since 6 July', headline: 'Paces slower',
    coach: 'Every zone reads slower, and by different amounts \u00b7 threshold moved 24 sec, rep pace only 19. The re-anchor is real \u00b7 what is behind it is not confirmed yet.',
    zoneHeader: 'Every zone, its own shift',
    zones: [
      { label: 'Threshold', leftLabel: '6 Jul', leftValue: '7:10', rightLabel: 'Now', rightValue: '7:34', gapLabel: 'Moved', gapValue: '+24', modelled: true },
      { label: 'Interval', leftLabel: '6 Jul', leftValue: '6:39', rightLabel: 'Now', rightValue: '7:01', gapLabel: 'Moved', gapValue: '+22', modelled: true },
      { label: 'Rep', leftLabel: '6 Jul', leftValue: '5:37', rightLabel: 'Now', rightValue: '5:56', gapLabel: 'Moved', gapValue: '+19', modelled: true }
    ],
    sourceCaption: 'Modelled from training \u00b7 not confirmed by a race',
    evidenceHeader: 'Also true this month',
    causes: [
      { label: 'Weekly mileage', sub: 'Up 18% over six weeks' },
      { label: 'Cutback weeks', sub: 'Two in a row were skipped' },
      { label: 'Sleep average', sub: 'Down 40 min a night since June' }
    ],
    confirmHeader: 'Did this race count?',
    confirmOptions: [
      { key: 'representative', label: 'Yes, it counts', sub: 'Every pace band moves to match, starting tomorrow' },
      { key: 'compromised', label: 'It was compromised', sub: 'Heat, illness, or something threw it off' },
      { key: 'unrepresentative', label: 'No, it doesn\u2019t count', sub: 'Paced a friend, or ran it as a workout' }
    ],
    confirmedNote: 'Confirmed \u00b7 every pace band moved to match, starting tomorrow.',
    noiseNote: 'Logged \u00b7 falls back to your last solid read, not the faster paces from before.'
  },
  fasterTraining: {
    since: 'Since 6 July', headline: 'Paces faster',
    coach: 'Every zone reads quicker in training, and by different amounts \u00b7 threshold moved 14 sec, rep pace only 9. Modelled from sessions, not confirmed by a race \u00b7 the read stays capped until one is.',
    zoneHeader: 'Every zone, its own shift',
    zones: [
      { label: 'Threshold', leftLabel: '6 Jul', leftValue: '7:34', rightLabel: 'Now', rightValue: '7:20', gapLabel: 'Moved', gapValue: '\u221214', modelled: true },
      { label: 'Interval', leftLabel: '6 Jul', leftValue: '7:01', rightLabel: 'Now', rightValue: '6:49', gapLabel: 'Moved', gapValue: '\u221212', modelled: true },
      { label: 'Rep', leftLabel: '6 Jul', leftValue: '5:56', rightLabel: 'Now', rightValue: '5:47', gapLabel: 'Moved', gapValue: '\u22129', modelled: true }
    ],
    sourceCaption: 'Modelled from training \u00b7 not confirmed by a race',
    evidenceHeader: 'Also true this month',
    causes: [
      { label: 'Weekly mileage', sub: 'Steady for six weeks, nothing spiked' },
      { label: 'Long runs', sub: 'Every one has hit its target since June' },
      { label: 'Sleep average', sub: 'Up 20 min a night since June' }
    ],
    confirmHeader: 'Is this the new normal',
    confirmOptions: [
      { key: 'confirm', label: 'Confirm it', sub: 'Every pace band tightens to match, capped until a race confirms it' },
      { key: 'noise', label: 'Just a good patch', sub: 'Keep training on today\u2019s bands' }
    ],
    confirmedNote: 'Confirmed \u00b7 every pace band tightened to match, starting tomorrow.',
    noiseNote: 'Logged as a good patch \u00b7 bands hold, I will check again in two weeks.'
  },
  fasterRace: {
    since: 'Cedar Falls Half \u00b7 3 Aug', headline: 'Paces faster',
    coach: 'Cedar Falls confirmed it \u00b7 a half marathon run at 7:01 pace is hard evidence, not a guess. Every zone below moves to match.',
    zoneHeader: 'Every zone, its own shift',
    zones: [
      { label: 'Threshold', leftLabel: '6 Jul', leftValue: '7:34', rightLabel: 'Now', rightValue: '7:04', gapLabel: 'Moved', gapValue: '\u221230' },
      { label: 'Interval', leftLabel: '6 Jul', leftValue: '7:01', rightLabel: 'Now', rightValue: '6:31', gapLabel: 'Moved', gapValue: '\u221230' },
      { label: 'Rep', leftLabel: '6 Jul', leftValue: '5:56', rightLabel: 'Now', rightValue: '5:30', gapLabel: 'Moved', gapValue: '\u221226' }
    ],
    evidenceHeader: 'The evidence',
    causes: [
      { label: 'Race', sub: 'Cedar Falls Half, 13.1 mi' },
      { label: 'Finish', sub: '1:32:04' },
      { label: 'Effort', sub: 'All-out, not a tempo effort' }
    ],
    confirmHeader: 'Lock these in',
    confirmOptions: [
      { key: 'confirm', label: 'Update my paces', sub: 'Every zone moves to match, starting tomorrow' }
    ],
    confirmedNote: 'Updated \u00b7 every pace band now matches Cedar Falls.'
  }
};

// The eight-stage walk-run ladder that follows a flare, once it clears to return.
// Per Research/05 §1.1: max one stage per week, two sessions minimum at each.
const LADDER_STAGES = [
  { label: 'Run 1 min \u00b7 walk 4 min', sub: '\u00d75' },
  { label: 'Run 2 min \u00b7 walk 3 min', sub: '\u00d75' },
  { label: 'Run 3 min \u00b7 walk 2 min', sub: '\u00d75' },
  { label: 'Run 5 min \u00b7 walk 2 min', sub: '\u00d74' },
  { label: 'Run 8 min \u00b7 walk 2 min', sub: '\u00d73' },
  { label: 'Run 12 min \u00b7 walk 2 min', sub: '\u00d72' },
  { label: 'Run 20 min \u00b7 walk 1 min', sub: '\u00d72' },
  { label: 'Run 30 min', sub: 'Continuous, no walking' }
];

class Component extends DCLogic {
  state = { day: null, a: {}, b: {}, stage: 2 };

  componentDidMount() {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.body.setAttribute('data-theme', 'dark');
  }

  get day() { return this.state.day || this.props.day || 'easy'; }

  get verdict() { return this.state.verdict || this.props.verdict || 'ahead'; }

  get paceDirection() { return this.props.paceDirection || 'slower'; }

  get readiness() {
    const day = DAYS[this.day];
    return this.props.readiness ?? day.readiness;
  }

  readySub() {
    const v = this.readiness;
    if (v < 54) return 'Under your normal';
    if (v > 72) return 'Over your normal';
    if (v <= 60) return 'Low end of your normal';
    if (v >= 68) return 'Top of your normal';
    return 'Inside your normal';
  }

  watchSide() {
    const s = this.state.c || {};
    const set = (patch) => this.setState((st) => ({ c: Object.assign({}, st.c, patch) }));
    const d = DAYS[this.day];
    return {
      dateLine: s.moved ? 'Moved to tomorrow' : d.dateLine,
      coach: s.moved
        ? 'Today moved to tomorrow. The week still lands where it should.'
        : s.live ? 'Running now. Chase nothing · the targets are already set.' : d.coachShort,
      watchLine: s.moved ? 'Moved to tomorrow' : s.live ? 'Running · started 6:04' : 'Ready',
      watchDot: s.live ? 'var(--state-easy)' : s.moved ? 'var(--state-quality)' : 'var(--text-quiet)',
      startLabel: s.live ? 'Stop' : 'Start',
      startHere: () => set({ live: !s.live, moved: false }),
      openSheet: () => set({ open: true }),
      closeSheet: () => set({ open: false }),
      move: () => set({ open: false, moved: true, live: false })
    };
  }

  side(key) {
    const s = this.state[key] || {};
    const d = DAYS[this.day];
    const set = (patch) => this.setState((st) => ({ [key]: Object.assign({}, st[key], patch) }));
    const moved = s.moved, live = s.live;
    return {
      was: null,
      dateLine: moved ? 'Moved to tomorrow' : d.dateLine,
      headTone: moved ? 'attention' : 'primary',
      coach: moved
        ? 'Today moved to Friday. The week still lands at its planned mileage · nothing was lost by shifting a day.'
        : live
          ? 'Session is running on the watch. Check nothing, chase nothing · the targets are already in your wrist.'
          : d.coach,
      readySub: this.readySub(),
      dockLabel: moved ? 'Put it back on today' : live ? 'Running on Watch' : d.dockLabel,
      dockVariant: live || moved ? 'secondary' : 'accent',
      dockNote: moved ? 'Friday now carries this session.' : live ? 'Started 6:04 · logging to Today.' : d.dockNote,
      openSheet: () => { if (moved) return set({ moved: false }); if (live) return set({ live: false }); set({ open: true }); },
      closeSheet: () => set({ open: false }),
      startWatch: () => set({ open: false, live: true, moved: false }),
      move: () => set({ open: false, moved: true, live: false })
    };
  }

  doneRun() {
    const d = DAYS[this.day];
    const scale = (p) => React.createElement(R.RangeScale, Object.assign({ size: 's', surface: 'page', style: { marginTop: 0 } }, p));
    const set = {
      easy: {
        type: 'Easy', when: '6:09 to 7:05', distance: '6.02', time: '54:16', pace: '9:02', elev: 148,
        splits: [{ pace: 545 }, { pace: 528 }, { pace: 519 }, { pace: 522 }, { pace: 511 }, { pace: 534 }],
        paceVal: 542, hrVal: 141, effVal: 3,
        pieces: [
          { label: 'Mile 1', asked: '8:50 · 9:35', ran: '9:05', value: 545, band: { low: 530, high: 575 } },
          { label: 'Mile 2', asked: '8:50 · 9:35', ran: '9:12', value: 552, band: { low: 530, high: 575 } },
          { label: 'Mile 3', asked: '8:50 · 9:35', ran: '8:58', value: 538, band: { low: 530, high: 575 } },
          { label: 'Mile 4', asked: '8:50 · 9:35', ran: '9:21', value: 561, band: { low: 530, high: 575 } },
          { label: 'Mile 5', asked: '8:50 · 9:35', ran: '8:31', value: 511, band: { low: 530, high: 575 } },
          { label: 'Mile 6', asked: '8:50 · 9:35', ran: '9:09', value: 549, band: { low: 530, high: 575 } }
        ],
        groups: [{ title: 'Easy run', tone: 'hue', note: '6.02 mi', idx: [0, 1, 2, 3, 4, 5] }],
        verdict: 'Sat in the band all the way bar mile five, which crept thirty seconds quick · pull that one back and this is a clean easy day.'
      },
      quality: {
        type: 'Threshold', when: '6:12 to 7:31', distance: '10.1', time: '1:18:44', pace: '7:47', elev: 210,
        splits: [{ pace: 560 }, { pace: 444 }, { pace: 441 }, { pace: 552 }, { pace: 447 }, { pace: 458 }],
        paceVal: 447, hrVal: 169, effVal: 7, rowPaceLabel: 'Work pace', rowPace: '7:27',
        pieces: [
          { label: '1.5 mi easy', asked: '9:30', ran: '9:36', delta: 'On it', value: 576, band: { low: 570, high: 600 } },
          { label: '3 mi at 7:22', asked: '7:22', ran: '7:21', delta: 'On it', value: 441, band: { low: 435, high: 449 } },
          { label: '1 mi float', asked: '9:15', ran: '9:12', delta: 'On it', value: 552, band: { low: 545, high: 565 } },
          { label: '3 mi at 7:22', asked: '7:22', ran: '7:33', delta: '11s slow', value: 453, band: { low: 435, high: 449 } },
          { label: '1.5 mi easy', asked: '9:30', ran: '9:41', delta: 'On it', value: 581, band: { low: 570, high: 600 } }
        ],
        groups: [
          { title: 'Warm up', tone: 'quiet', note: '1.5 mi', idx: [0] },
          { title: 'First time through', tone: 'hue', note: '4 mi', idx: [1, 2] },
          { title: 'Second time through', tone: 'hue', note: '3 mi', idx: [3] },
          { title: 'Cool down', tone: 'quiet', note: '1.5 mi', idx: [4] }
        ],
        verdict: 'First block sat dead on it, second gave up eleven seconds a mile · that is the honest edge of your threshold today, not a miss.'
      },
      race: {
        type: 'Race', when: '8:55 to 12:26', distance: '26.31', time: '3:31:12', pace: '8:03', elev: 486,
        splits: [{ pace: 476 }, { pace: 478 }, { pace: 479 }, { pace: 481 }, { pace: 492 }, { pace: 504 }],
        paceVal: 483, hrVal: 166, effVal: 9,
        pieces: [
          { label: 'First 10k', asked: '8:00', ran: '7:59', delta: 'On it', value: 479, band: { low: 476, high: 484 } },
          { label: 'Mile 7 to 20', asked: '8:00', ran: '8:03', delta: 'On it', value: 483, band: { low: 476, high: 484 } },
          { label: 'Last 10k', asked: '7:56', ran: '8:24', delta: '28s slow', value: 504, band: { low: 465, high: 476 } }
        ],
        groups: [{ title: 'Race', tone: 'hue', note: '26.31 mi', idx: [0, 1, 2] }],
        verdict: 'Eight flat to twenty, then the last 10k asked for it back · ninety seconds off the goal on a day that was honestly run.'
      }
    }[this.day];
    const lo = Math.min(d.paceMin, ...set.splits.map((s) => s.pace)) - 8;
    const hi = Math.max(d.paceMax, ...set.splits.map((s) => s.pace)) + 8;
    const pos = (p) => ((p - lo) / (hi - lo)) * 100;
    const mid = (d.paceBand.low + d.paceBand.high) / 2;
    const fmt = (p) => Math.floor(p / 60) + ':' + String(Math.round(p % 60)).padStart(2, '0');
    const pieces = (set.pieces || []).map((p) => {
      const out = p.value < p.band.low || p.value > p.band.high;
      return {
        label: p.label, asked: p.asked, ran: p.ran, delta: p.delta,
        bandLeft: pos(p.band.low) + '%',
        bandW: (pos(p.band.high) - pos(p.band.low)) + '%',
        bandFill: d.railToday,
        markLeft: 'calc(' + pos(p.value) + '% - 3px)',
        markFill: out ? 'var(--state-quality)' : 'var(--text-primary)',
        chipBg: out ? 'var(--state-quality)' : 'var(--material-control)',
        chipInk: out ? 'var(--action-primary-text)' : 'var(--text-secondary)',
        ranInk: out ? 'var(--state-quality)' : 'var(--text-primary)',
        dots: (p.dots || []).map((v) => ({ left: 'calc(' + pos(v) + '% - 3px)' }))
      };
    });
    const bars = set.splits.map((s, i) => {
      const out = s.pace < d.paceBand.low || s.pace > d.paceBand.high;
      return {
        mile: i + 1, pace: fmt(s.pace),
        bandLeft: pos(d.paceBand.low) + '%',
        bandW: (pos(d.paceBand.high) - pos(d.paceBand.low)) + '%',
        markLeft: 'calc(' + pos(s.pace) + '% - 3px)',
        fill: out ? 'var(--state-quality)' : 'var(--text-primary)',
        ink: out ? 'var(--state-quality)' : 'var(--text-secondary)'
      };
    });
    const row = (label, min, max, band, value, text) => {
      const f = (v) => ((v - min) / (max - min)) * 100;
      const out = value < band.low || value > band.high;
      return {
        label, value: text,
        bandLeft: f(band.low) + '%', bandW: (f(band.high) - f(band.low)) + '%',
        bandFill: d.railToday,
        markLeft: 'calc(' + f(value) + '% - 3px)',
        markFill: out ? 'var(--state-quality)' : 'var(--text-primary)',
        ink: out ? 'var(--state-quality)' : 'var(--text-primary)'
      };
    };
    return Object.assign({}, set, {
      pieces, bars,
      listTitle: (set.pieces || []).length > 1 ? 'Piece by piece' : 'Mile by mile',
      summaryTitle: set.rowPaceLabel ? 'The work' : 'Whole run',
      groups: (set.groups || []).map((g) => ({
        title: g.title, note: g.note,
        labelInk: g.tone === 'hue' ? 'var(--text-primary)' : 'var(--text-quiet)',
        bodyFill: 'transparent',
        bodyPad: '0',
        steps: g.idx.map((i) => {
          const p = set.pieces[i];
          const out = p.value < p.band.low || p.value > p.band.high;
          return { n: i + 1, main: p.label, asked: p.asked, ran: p.ran, ink: out ? 'var(--state-quality)' : 'var(--text-primary)' };
        })
      })),
      steps: (set.pieces || []).map((p, i) => {
        const out = p.value < p.band.low || p.value > p.band.high;
        return {
          n: i + 1, main: p.label, asked: p.asked, ran: p.ran,
          ink: out ? 'var(--state-quality)' : 'var(--text-primary)'
        };
      }),
      summary: [
        {
          label: set.rowPaceLabel || 'Pace', asked: d.askedPace, ran: set.rowPace || set.pace,
          ink: (set.paceVal < d.paceBand.low || set.paceVal > d.paceBand.high) ? 'var(--state-quality)' : 'var(--text-primary)',
          plain: true
        },
        {
          label: 'Heart', asked: 'under ' + d.hr, ran: set.hrVal,
          ink: set.hrVal > d.hr ? 'var(--state-quality)' : 'var(--text-primary)',
          plain: true
        },
        {
          label: 'Effort', asked: d.effBand.low + ' to ' + d.effBand.high,
          ran: this.state.effort == null ? '' : this.state.effort + ' of 10',
          ink: this.state.effort != null && (this.state.effort < d.effBand.low || this.state.effort > d.effBand.high)
            ? 'var(--state-quality)' : 'var(--text-primary)',
          tap: this.state.effort != null,
          plain: this.state.effort == null,
          tapBg: 'transparent',
          tapPad: '0',
          onClick: () => this.setState((st) => ({ effortOpen: !st.effortOpen }))
        }
      ],
      effortAsked: 'Asked for ' + d.effBand.low + ' to ' + d.effBand.high,
      zoneLead: d.zoneShares[d.zone - 1] + '%',
      beltSpeed: (() => {
        const parts = set.pace.split(':');
        const secPerMi = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        return (3600 / secPerMi).toFixed(1);
      })(),
      beltIncline: this.day === 'race' ? '1.0' : this.day === 'quality' ? '1.5' : '1.0',
      effortValue: this.state.effort == null ? 'Not yet' : this.state.effort + ' of 10',
      effortSub: this.state.effort == null ? 'Asked for ' + d.effBand.low + ' to ' + d.effBand.high
        : 'Asked for ' + d.effBand.low + ' to ' + d.effBand.high + ' · you said ' + this.state.effort,
      shoeValue: SHOES[this.state.shoe ?? d.shoe].name,
      shoeSub: SHOES[this.state.shoe ?? d.shoe].mi + ' mi on them',
      scaleLeft: d.paceEnds[0], scaleRight: d.paceEnds[1],
      overlay: (() => {
        const pieces = set.pieces || [];
        const vals = pieces.reduce((a, p) => a.concat([p.band.low, p.band.high, p.value]), []);
        const lo = Math.min.apply(null, vals) - 14;
        const hi = Math.max.apply(null, vals) + 14;
        const y = (v) => ((v - lo) / (hi - lo)) * 100;
        return d.segments.map((g, i) => {
          const p = pieces[i];
          if (!p) return { mi: g.mi, bandTop: '40%', bandH: '10%', bandFill: 'rgba(255,255,255,.15)', ruleTop: '45%', ruleFill: 'var(--text-primary)', ran: '', labelTop: '52%', name: '' };
          const out = p.value < p.band.low || p.value > p.band.high;
          const rule = y(p.value);
          return {
            mi: g.mi,
            bandTop: y(p.band.low) + '%',
            bandH: (y(p.band.high) - y(p.band.low)) + '%',
            bandFill: 'rgba(255,255,255,.15)',
            ruleTop: rule + '%',
            ruleFill: out ? 'var(--state-quality)' : 'var(--text-primary)',
            labelTop: rule > 76 ? 'calc(' + rule + '% - 19px)' : 'calc(' + rule + '% + 5px)',
            ran: p.ran,
            name: p.label.split(' · ')[0]
          };
        });
      })(),
      scaleFast: (() => {
        const pieces = set.pieces || [];
        const vals = pieces.reduce((a, p) => a.concat([p.band.low, p.band.high, p.value]), [600]);
        const lo = Math.min.apply(null, vals) - 14;
        return Math.floor(lo / 60) + ':' + String(Math.round(lo % 60)).padStart(2, '0');
      })(),
      scaleSlow: (() => {
        const pieces = set.pieces || [];
        const vals = pieces.reduce((a, p) => a.concat([p.band.low, p.band.high, p.value]), [400]);
        const hi = Math.max.apply(null, vals) + 14;
        return Math.floor(hi / 60) + ':' + String(Math.round(hi % 60)).padStart(2, '0');
      })(),
      shapePlan: (() => {
        const total = d.segments.reduce((s, g) => s + g.mi, 0);
        return d.segments.map((g, i) => {
          const p = (set.pieces || [])[i];
          const wide = g.mi / total > 0.18;
          const asked = p ? p.asked.replace(' or easier', '') : g.pace;
          return {
            mi: g.mi,
            h: { easy: '46%', quality: '100%', race: '78%', racefast: '96%' }[g.kind],
            fill: 'var(--material-control)',
            ink: 'var(--text-secondary)',
            text: wide ? asked : asked.split(' · ')[0]
          };
        });
      })(),
      shapeRan: d.segments.map((g, i) => {
        const p = (set.pieces || [])[i];
        const out = p ? (p.value < p.band.low || p.value > p.band.high) : false;
        return {
          mi: g.mi,
          h: { easy: '46%', quality: '100%', race: '78%', racefast: '96%' }[g.kind],
          fill: out ? 'var(--state-quality)' : 'var(--text-primary)',
          ink: 'var(--action-primary-text)',
          text: p ? p.ran : ''
        };
      }),
      planRows: [
        row(set.rowPaceLabel || 'Pace', d.paceMin, d.paceMax, d.paceBand, set.paceVal, (set.rowPace || set.pace) + ' /mi'),
        row('Heart', d.hrMin, d.hrMax, d.hrBand, set.hrVal, set.hrVal + ' bpm'),
        row('Effort', 1, 10, d.effBand, set.effVal, set.effVal + ' of 10')
      ],
      bandTop: pos(d.paceBand.low) + '%',
      bandH: (pos(d.paceBand.high) - pos(d.paceBand.low)) + '%',
      metrics: [
        { label: 'Pace', sub: 'Against the band', value: set.pace, unit: '/mi', scale: scale({ min: d.paceMin, max: d.paceMax, band: d.paceBand, value: set.paceVal, endpoints: d.paceEnds, hue: 'pace', tone: 'auto' }) },
        { label: 'Heart', sub: 'Against the ceiling', value: set.hrVal, unit: 'bpm', scale: scale({ mode: 'ceiling', min: d.hrMin, max: d.hrMax, band: d.hrBand, value: set.hrVal, endpoints: d.hrEnds, hue: 'heart', tone: 'auto' }) },
        { label: 'Effort', sub: 'As prescribed', value: set.effVal, unit: 'of 10', scale: scale({ min: 1, max: 10, band: d.effBand, value: set.effVal, endpoints: ['1', '10'], hue: 'effort', tone: 'auto' }) }
      ]
    });
  }

  topOptions() {
    return [
      {
        id: '4a', name: 'Today', rule: 'Label names the place, avatar opens settings. The title band carries the one thing this screen is about.',
        label: 'Today', title: 'Thursday 20 August', titleSize: '26px', titleRight: 'Week 6 · Base'
      },
      {
        id: '4b', name: 'Block', rule: 'Same two bands, same positions. Only the label and the headline change between places.',
        label: 'Block', title: 'Week 6 of 16', titleSize: '26px', titleRight: 'Base · 10 to go'
      },
      {
        id: '4c', name: 'Season', rule: 'The headline is the argument the screen exists to settle, never a second copy of the label.',
        label: 'Season', title: 'Sub 3:30', titleSize: '26px', titleRight: 'Marathon · 4 Oct'
      }
    ];
  }

  // the block after whatever the runner has changed: each applied change rewrites the weeks
  // it touches, so the shapes and totals in the list are the plan as it now stands.
  blockWeeks() {
    const applied = this.state.planApplied || [];
    const scale = (w, f) => Object.assign({}, w, {
      mi: Math.round(w.mi * f),
      days: w.days.map((day) => Object.assign({}, day, { load: Math.round(day.load * f * 10) / 10 }))
    });
    return BLOCK_WEEKS.map((w) => {
      const n = parseInt(w.week.slice(3), 10);
      let out = w;
      if (applied.indexOf('cutback') >= 0 && n === 6) {
        out = Object.assign({}, scale(out, 24.5 / out.mi), {
          flag: 'Cutback',
          detail: [{ label: 'Long run', value: '9.5 mi' }, { label: 'Quality', value: '1 session' }, { label: 'Planned', value: '24.5 mi' }]
        });
      }
      if (applied.indexOf('travel') >= 0 && n === 7) {
        out = Object.assign({}, out, {
          mi: 0, flag: 'Away',
          days: out.days.map(() => ({ load: 0, future: true })),
          detail: [{ label: 'Away', value: 'No running planned' }, { label: 'Quality', value: 'None' }, { label: 'Planned', value: '0 mi' }]
        });
      }
      if (applied.indexOf('travel') >= 0 && n === 9) {
        out = Object.assign({}, scale(out, 30.5 / out.mi), {
          flag: 'Return from travel',
          detail: [{ label: 'Long run', value: 'Scaled down' }, { label: 'Quality', value: out.detail[1].value }, { label: 'Planned', value: '30.5 mi' }]
        });
      }
      if (applied.indexOf('another_race') >= 0 && n === 3 && applied.indexOf('travel') < 0) {
        out = Object.assign({}, out, {
          flag: '10k', mi: Math.round(out.mi * 0.85),
          days: out.days.map((day, i) => i === 5
            ? { load: 6, quality: true, race: true, future: true }
            : Object.assign({}, day, { load: Math.round(day.load * 0.92 * 10) / 10 })),
          detail: [{ label: 'Race', value: 'Santa Monica 10K' }, { label: 'Quality', value: 'The race is the session' }, { label: 'Planned', value: Math.round(out.mi * 0.85) + ' mi' }]
        });
      }
      if (applied.indexOf('move_day') >= 0 && n === 7 && out.days.length === 7) {
        const days = out.days.map((d) => Object.assign({}, d));
        const fri = days[4], mon = days[0];
        days[0] = Object.assign({}, mon, { load: fri.load });
        days[4] = Object.assign({}, fri, { load: 0 });
        out = Object.assign({}, out, { days });
      }
      if (applied.indexOf('extra_day') >= 0 && n > 6 && out.mi > 0) {
        out = Object.assign({}, out, {
          days: out.days.map((day, i) => i === 5 && !day.load
            ? { load: Math.round(out.mi * 0.09 * 10) / 10, future: true }
            : day)
        });
      }
      return out;
    });
  }

  get fromPhone() {
    return this.state.fromPhone ?? this.props.startFromPhone ?? true;
  }

  phoneTabs(place) {
    const opts = this.navOptions();
    const spec = this.fromPhone ? '3b' : '3a';
    const src = opts.find((o) => o.id === spec);
    const active = place || (this.state.nav || {}).phone || 'today';
    return src.items.map((t) => {
      const on = t.id === 'run' ? false : active === t.id;
      const run = t.id === 'run';
      return Object.assign({}, t, {
        bg: run ? 'var(--material-action)' : 'transparent',
        ink: run ? 'var(--action-primary-text)' : on ? 'var(--text-primary)' : 'var(--text-quiet)',
        font: run ? '700 14px/1 var(--font-core)' : (on ? '600 ' : '500 ') + '12px/1 var(--font-core)',
        onClick: run
          ? () => this.setState({ runPickerOpen: true })
          : () => this.setState((st) => ({ nav: Object.assign({}, st.nav, { phone: t.id }) }))
      });
    });
  }

  navOptions() {
    const GLYPH = {
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
      list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
      flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
      play: '<polygon points="6 3 20 12 6 21 6 3"/>'
    };
    const mask = (name, px) => ({
      iconPx: px + 'px',
      iconUrl: "'data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + GLYPH[name] + '</svg>') + "'"
    });
    const DEST = [{ id: 'today', label: 'Today', icon: 'sun' }, { id: 'block', label: 'Block', icon: 'list' }, { id: 'season', label: 'Races', icon: 'flag' }];
    const nav = this.state.nav || {};
    const pick = (k) => nav[k] || 'today';
    const set = (k, id) => () => this.setState((st) => ({ nav: Object.assign({}, st.nav, { [k]: id }) }));
    const stacked = (k, active) => DEST.map((t) => {
      const on = pick(k) === t.id;
      return Object.assign({}, t, {
        flex: 1, h: '100%', radius: '18px', bg: 'transparent', dir: 'column', iconGap: '4px', padX: 0,
        ink: on ? 'var(--text-primary)' : 'var(--text-quiet)',
        font: (on ? '600 ' : '500 ') + '12px/1 var(--font-core)',
        showIcon: true, showLabel: true, onClick: set(k, t.id)
      }, mask(t.icon, 22));
    });
    return [
      {
        id: '3a', name: 'Three places', isVerbRow: false, bandHeight: '62px', gap: '4px', bandPad: '0 12px', bandFill: 'var(--surface-page)',
        rule: 'Destinations only, icon over label. The verb lives on the screen it acts on, never in the bar.',
        items: stacked('a')
      },
      {
        id: '3b', name: 'Three places and the verb', isVerbRow: false, bandHeight: '62px', gap: '6px', bandPad: '0 12px', bandFill: 'var(--surface-page)',
        rule: 'The same three, plus RUN as a filled slot inside the band. One verb, flush with the bar, never raised.',
        items: stacked('b').concat([Object.assign({
          id: 'run', label: 'RUN', icon: 'play', flex: 1.1, h: '44px', radius: '999px',
          bg: 'var(--material-action)', ink: 'var(--action-primary-text)', dir: 'row', iconGap: '6px', padX: 12,
          font: '700 14px/1 var(--font-core)', showIcon: true, showLabel: true, onClick: set('b', 'run')
        }, mask('play', 16))])
      },
      {
        id: '3c', name: 'Words, no glyphs', isVerbRow: false, bandHeight: '62px', gap: '6px', bandPad: '0 12px', bandFill: 'var(--surface-page)',
        rule: 'No icons at all: three words at 15px, the current place filled. Nothing to learn, biggest targets.',
        items: DEST.map((t) => {
          const on = pick('c') === t.id;
          return Object.assign({}, t, {
            flex: 1, h: '44px', radius: '999px', dir: 'row', iconGap: '0px', padX: 8,
            bg: on ? 'var(--material-action)' : 'var(--material-tile)',
            ink: on ? 'var(--action-primary-text)' : 'var(--text-secondary)',
            font: (on ? '600 ' : '500 ') + '15px/1 var(--font-core)',
            showIcon: false, showLabel: true, onClick: set('c', t.id)
          }, mask(t.icon, 20));
        })
      },
      {
        id: '3d', name: 'Glyphs, one word', isVerbRow: false, bandHeight: '62px', gap: '8px', bandPad: '0 16px', bandFill: 'var(--surface-page)',
        rule: 'Icons only until a place is current, then that one alone carries its word. The quietest bar that still says where you are.',
        items: DEST.map((t) => {
          const on = pick('d') === t.id;
          return Object.assign({}, t, {
            flex: on ? 1.6 : 0.7, h: '44px', radius: '999px', dir: 'row', iconGap: '8px', padX: 12,
            bg: on ? 'var(--material-tile)' : 'transparent',
            ink: on ? 'var(--text-primary)' : 'var(--text-quiet)',
            font: '600 14px/1 var(--font-core)',
            showIcon: true, showLabel: on, onClick: set('d', t.id)
          }, mask(t.icon, 22));
        })
      },
      {
        id: '3e', name: 'Today first, places under', isVerbRow: true, bandHeight: '44px', gap: '4px', bandPad: '0 12px', bandFill: 'var(--material-tile)',
        rule: "Two bands: today's state and its verb on top, a slim destination row beneath. The bar admits most taps are about today.",
        items: DEST.map((t) => {
          const on = pick('e') === t.id;
          return Object.assign({}, t, {
            flex: 1, h: '32px', radius: '999px', dir: 'row', iconGap: '6px', padX: 8,
            bg: 'transparent',
            ink: on ? 'var(--text-primary)' : 'var(--text-quiet)',
            font: (on ? '600 ' : '500 ') + '13px/1 var(--font-core)',
            showIcon: true, showLabel: true, onClick: set('e', t.id)
          }, mask(t.icon, 16));
        })
      }
    ];
  }

  renderVals() {
    const d = DAYS[this.day];
    const readiness = this.readiness;
    const scale = (p) => React.createElement(R.RangeScale, Object.assign({ size: 's', surface: 'tile', style: { marginTop: 0 } }, p));
    return {
      coachFlush: { style: { padding: 0 } },
      // The token gradients, same angle and same hexes, interpolated in oklab so the mid
      // hue step does not read as a crease across a short card.
      d: Object.assign({}, d, {
        gradSoft: d.grad,
        gradPanel: {
          'var(--g-easy)': 'var(--g-easy-panel)',
          'var(--g-rest)': 'var(--g-rest-panel)',
          'var(--g-quality)': 'var(--g-quality-panel)',
          'var(--g-race)': 'var(--g-race-panel)'
        }[d.grad] || d.grad,
        kicker: d.time + ' · ' + d.weather.replace(' · ', ' '),
        whereRows: [
          {
            label: 'Readiness',
            sub: d.readiness < 60 ? 'Below your own normal' : 'Inside your own normal',
            value: d.readiness,
            onClick: () => this.setState((st) => ({ readyOpen: !st.readyOpen }))
          }
        ].concat(this.state.readyOpen ? d.readyDetail : [])
          .concat([{ label: 'This week', sub: d.weekSub, value: d.weekPct }]),
        posterStats: [
          { label: d.type === 'Threshold' ? 'Work pace' : d.type === 'Race' ? 'Goal pace' : 'Pace band', value: d.askedPace },
          { label: 'Ceiling', value: d.hr + ' bpm' },
          { label: 'Effort', value: d.eff + ' of 10' }
        ],
        segments: d.segments.map((g) => {
          const kit = {
            easy: { h: '38%', fill: 'var(--material-control)', ink: 'var(--text-secondary)' },
            quality: { h: '100%', fill: 'var(--state-quality)', ink: 'var(--action-primary-text)' },
            race: { h: '72%', fill: 'var(--state-race)', ink: 'var(--action-primary-text)' },
            racefast: { h: '92%', fill: 'var(--state-race)', ink: 'var(--action-primary-text)' }
          }[g.kind];
          return Object.assign({}, g, kit);
        }),
        posterBars: d.segments.map((g) => {
          const soft = g.kind === 'easy';
          return {
            mi: g.mi, pace: g.pace, dist: g.dist,
            h: { easy: '46%', quality: '100%', race: '78%', racefast: '96%' }[g.kind],
            wash: soft ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.92)',
            ink: soft ? '#FFFFFF' : 'rgba(0,0,0,.86)',
            sub: soft ? 'rgba(255,255,255,.62)' : 'rgba(0,0,0,.55)'
          };
        }),
        paceLabelShort: (d.paceLabel || '').replace(/^[^0-9]*/, ''),
        plan: (d.plan || []).map((g) => Object.assign({}, g, {
          labelInk: g.tone === 'hue' ? 'var(--text-primary)' : 'var(--text-quiet)',
          bodyFill: g.tone === 'hue' ? 'var(--material-tile)' : 'transparent',
          bodyPad: g.tone === 'hue' ? '16px' : '0 4px'
        })),
        askRows: [
          {
            label: 'Heart ceiling', value: d.hr + ' bpm',
            bandLeft: (((d.hrBand.low - d.hrMin) / (d.hrMax - d.hrMin)) * 100) + '%',
            bandW: (((d.hrBand.high - d.hrBand.low) / (d.hrMax - d.hrMin)) * 100) + '%',
            bandFill: d.railToday
          },
          {
            label: 'Effort', value: d.eff + ' of 10',
            bandLeft: (((d.effBand.low - 1) / 9) * 100) + '%',
            bandW: (((d.effBand.high - d.effBand.low) / 9) * 100) + '%',
            bandFill: d.railToday
          }
        ],
        strip: d.strip.map((n, i) => ({
          d: ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i], n,
          bg: i === d.stripToday ? 'var(--material-action)' : 'transparent',
          cellBg: i === d.stripToday ? 'var(--material-tile)' : 'transparent',
          ink: i === d.stripToday ? 'var(--text-primary)' : d.stripDone.indexOf(i) >= 0 ? 'var(--text-secondary)' : 'var(--text-quiet)',
          dim: 'var(--text-quiet)',
          rail: d.stripRun.indexOf(i) >= 0 ? (i === d.stripToday ? d.railToday : 'var(--material-control)') : 'transparent',
          dot: d.stripRun.indexOf(i) >= 0 ? (i === d.stripToday ? 'var(--action-primary-text)' : 'var(--signal)') : 'transparent',
          // the strip sits on the gradient wash, so its own steps are white tints
          washBg: i === d.stripToday ? 'rgba(255,255,255,.22)' : 'transparent',
          washInk: i === d.stripToday ? '#FFFFFF' : d.stripDone.indexOf(i) >= 0 ? 'rgba(255,255,255,.96)' : 'rgba(255,255,255,.78)',
          washDim: 'rgba(255,255,255,.82)',
          washRail: d.stripRun.indexOf(i) >= 0 ? (i === d.stripToday ? '#FFFFFF' : 'rgba(255,255,255,.58)') : 'transparent'
        })),
        metrics: [
          { label: 'Ceiling', sub: 'Everything under it is fine', value: d.hr, unit: 'bpm', scale: scale({ mode: 'ceiling', min: d.hrMin, max: d.hrMax, band: d.hrBand, endpoints: d.hrEnds, hue: 'heart' }) },
          { label: 'Effort', sub: 'As prescribed', value: d.eff, unit: 'of 10', scale: scale({ min: 1, max: 10, band: d.effBand, endpoints: ['1', '10'], hue: 'effort' }) }
        ]
      }),
      readiness,
      navOptions: this.navOptions(),
      phoneTabs: this.phoneTabs(),
      topOptions: this.topOptions(),
      done: this.doneRun(),
      doneStrip: d.strip.map((n, i) => {
        const today = i === d.stripToday;
        const ran = d.stripRun.indexOf(i) >= 0;
        const past = i <= d.stripToday;
        return {
          d: ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i], n,
          cellBg: today ? 'var(--material-tile)' : 'transparent',
          ink: today ? 'var(--text-primary)' : past ? 'var(--text-secondary)' : 'var(--text-quiet)',
          dim: 'var(--text-quiet)',
          rail: ran ? (today ? d.railToday : past ? 'var(--text-secondary)' : d.gradRail) : 'transparent',
          washBg: today ? 'rgba(255,255,255,.22)' : 'transparent',
          washInk: today ? '#FFFFFF' : past ? 'rgba(255,255,255,.96)' : 'rgba(255,255,255,.78)',
          washDim: 'rgba(255,255,255,.82)',
          washRail: ran ? (today ? '#FFFFFF' : 'rgba(255,255,255,.58)') : 'transparent'
        };
      }),
      beforeRows: (this.state.shoeOpen ? [] : [
        {
          label: SHOES[this.state.shoe ?? d.shoe].name,
          sub: SHOES[this.state.shoe ?? d.shoe].mi + ' mi on them',
          value: 'Change',
          onClick: () => this.setState({ shoeOpen: true })
        }
      ]).concat(this.state.shoeOpen ? [{ label: 'Which pair', sub: '', value: 'Close', onClick: () => this.setState({ shoeOpen: false }) }] : [])
        .concat(this.state.shoeOpen ? SHOES.map((s, i) => ({
        label: s.name, sub: s.mi + ' mi on them',
        value: i === (this.state.shoe ?? d.shoe) ? 'Wearing' : '',
        onClick: () => this.setState({ shoe: i, shoeOpen: false })
      })) : [])
        .concat(d.fuel ? [{ label: 'Fuel', sub: d.fuel.sub, value: d.fuel.value }] : [])
        .concat(d.canMove ? (
          this.state.moved
            ? [{ label: this.state.moved.label, sub: this.state.moved.sub, value: 'Undo', onClick: () => this.setState({ moved: null }) }]
            : this.state.moveOpen
              ? [{ label: 'Move or skip this run', sub: '', value: 'Keep it', onClick: () => this.setState({ moveOpen: false }) }]
                .concat(d.moveOptions.map((o) => ({
                  label: o.label, sub: o.sub, value: '',
                  onClick: () => this.setState({ moved: { label: o.done, sub: o.doneSub }, moveOpen: false })
                })))
              : [{ label: 'Move or skip this run', sub: d.moveSub, value: 'Change', onClick: () => this.setState({ moveOpen: true }) }]
        ) : []),
      effortOpen: this.state.effort == null || !!this.state.effortOpen,
      effortScale: Array.from({ length: 10 }, (_, i) => {
        const n = i + 1;
        const inBand = n >= d.effBand.low && n <= d.effBand.high;
        const picked = this.state.effort === n;
        return {
          n,
          bg: picked ? 'var(--signal)' : inBand ? 'var(--material-tile-raised)' : 'var(--material-tile)',
          ink: picked ? 'var(--action-primary-text)' : inBand ? 'var(--text-primary)' : 'var(--text-quiet)',
          onClick: () => this.setState({ effort: n, effortOpen: false })
        };
      }),
      setEffort: () => this.setState((st) => ({ effortOpen: !st.effortOpen })),
      afterRows: (() => {
        const ran = parseFloat(this.doneRun().distance);
        const done = Math.round((d.weekDone + ran) * 10) / 10;
        return [
          { label: 'This week', sub: done + ' of ' + d.weekPlan + ' mi done', value: Math.round((done / d.weekPlan) * 100) + '%' },
          { label: d.nextUp, sub: d.nextNote, value: '' }
        ].concat(
          this.state.niggle
            ? [{ label: this.state.niggle + ' flagged', sub: 'The coach has it · it shapes tomorrow', value: 'Undo', onClick: () => this.setState({ niggle: null }) }]
            : this.state.niggleOpen
              ? [{ label: 'Where did it hurt', sub: '', value: 'Nothing did', onClick: () => this.setState({ niggleOpen: false }) }]
                .concat(NIGGLES.map((n) => ({
                  label: n, sub: '', value: '',
                  onClick: () => this.setState({ niggle: n, niggleOpen: false })
                })))
              : [{ label: 'Flag a niggle', sub: 'Anything that felt wrong', value: 'Add', onClick: () => this.setState({ niggleOpen: true }) }]
        );
      })(),
      doneShoeRows: (this.state.doneShoeOpen ? [] : [
        {
          label: SHOES[this.state.shoe ?? d.shoe].name,
          sub: SHOES[this.state.shoe ?? d.shoe].mi + ' mi on them',
          value: 'Change',
          onClick: () => this.setState({ doneShoeOpen: true })
        }
      ]).concat(this.state.doneShoeOpen ? [{ label: 'Which pair', sub: '', value: 'Close', onClick: () => this.setState({ doneShoeOpen: false }) }] : [])
        .concat(this.state.doneShoeOpen ? SHOES.map((s, i) => ({
        label: s.name, sub: s.mi + ' mi on them',
        value: i === (this.state.shoe ?? d.shoe) ? 'Wearing' : '',
        onClick: () => this.setState({ shoe: i, doneShoeOpen: false })
      })) : []),
      stravaBg: this.state.strava ? 'var(--material-control)' : '#FC4C02',
      stravaInk: this.state.strava ? 'var(--text-secondary)' : '#FFFFFF',
      stravaLabel: this.state.strava ? 'Sent to Strava' : 'Send it to Strava',
      pushStrava: () => this.setState({ strava: true }),
      shapeSegments: d.segments.length > 1,
      shapeWeek: d.segments.length === 1,
      readyBand: { low: 54, high: 72 },
      readyEnds: ['Low 38', '84 High'],
      weekLabels: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
      coachSize: this.props.compactCoach ? 'md' : 'lg',
      a: this.side('a'),
      b: this.side('b'),
      c: this.watchSide(),
      cSheet: !!(this.state.c && this.state.c.open),
      aSheet: !!(this.state.a && this.state.a.open),
      bSheet: !!(this.state.b && this.state.b.open),
      stop: (e) => e.stopPropagation(),
      blockTabs: this.phoneTabs('block'),
      seasonTabs: this.phoneTabs('season'),
      season: (() => {
        const v = VERDICTS[this.verdict];
        const moved = this.state.goalMoved;
        // Two axes drive this card: the design trigger (why we're asking) and the backend's
        // standing verdict on the goal (comfortable...unreadable), always shown as a badge.
        // A 'decision' verdict moves the goal/gap/stats together; 'fact' and 'choice' verdicts
        // answer a question the engine can't derive and never touch the goal itself.
        const isDecision = v.mode === 'decision';
        const goal = isDecision ? (moved ? v.altLabel : v.currentLabel) : 'Sub 3:30';
        const gap = isDecision ? (moved ? v.altGap : v.baseGap) : '+2:56';
        return {
          out: '10 weeks out',
          dose: 'Marathon · Dec 7',
          kicker: isDecision && moved ? 'Moved today · was ' + v.currentLabel : 'Your goal since June',
          goal,
          projected: '3:16:45',
          stats: [
            { label: isDecision && moved ? 'Goal, moved today' : 'Goal', value: goal, ink: '#FFFFFF' },
            { label: 'Projected', value: '3:16:45', ink: '#FFFFFF', modelled: true },
            { label: 'Gap', value: gap, ink: '#FFFFFF' }
          ],
          deciding: !this.state.goalCall,
          settled: !!this.state.goalCall,
          isDecision,
          isFact: !isDecision,
          badge: v.badge,
          ask: v.ask,
          targets: v.targets || [],
          cautions: v.cautions.map((text) => ({ text })),
          options: isDecision ? [
            {
              label: 'Hold the goal', flex: 1.1, bg: 'var(--material-action)', ink: 'var(--action-primary-text)',
              font: '700 14px/1 var(--font-core)',
              onClick: () => this.setState({ goalCall: 'held', goalMoved: false })
            },
            {
              label: v.takeLabel, flex: 1.4, bg: 'var(--material-tile-raised)', ink: 'var(--text-primary)',
              font: '600 14px/1 var(--font-core)',
              onClick: () => this.setState({ goalCall: 'moved', goalMoved: true })
            },
            {
              label: v.thirdLabel, flex: 0.8, bg: 'transparent', ink: 'var(--text-secondary)',
              font: '600 14px/1 var(--font-core)',
              onClick: () => this.setState({ goalCall: 'later' })
            }
          ] : [],
          actions: !isDecision ? v.actions.map((a) => ({
            label: a.label, sub: a.sub,
            onClick: () => this.setState({ goalCall: a.key })
          })) : [],
          reopen: () => this.setState({ goalCall: null, goalMoved: false }),
          settledSay: isDecision
            ? ({ held: v.holdLine, moved: v.takeLine, later: v.laterLine }[this.state.goalCall] || '')
            : ((v.settledLines || {})[this.state.goalCall] || ''),
          settledOptions: [{ label: 'Think again', onClick: () => this.setState({ goalCall: null, goalMoved: false }) }],
          proj: [62, 60, 57, 54, 51, 48, 45, 42, 39, 36, 33, 31, 29, 27, 25, 23, 21, 20, 19, 18, 17, 17, 18, 19, 21, 24, 27, 31, 36, 42],
          footnotes: ['Twelve weeks of daily reads', 'Best read so far 3:18'],
          raceCount: RACES.length + ' on file',
          schedule: RACES.map((r, i) => ({
            name: r.name, when: r.when, rank: r.rank,
            value: r.next ? goal : r.value,
            detail: r.detail, open: this.state.raceOpen === i,
            weight: r.next ? 700 : 400,
            ink: r.done ? 'var(--text-secondary)' : 'var(--text-primary)',
            valueInk: r.done ? 'var(--text-secondary)' : r.next ? 'var(--text-primary)' : 'var(--text-secondary)',
            rankBg: r.rank === 'A' ? (r.done ? 'var(--material-control)' : 'var(--signal)') : 'var(--material-control)',
            rankInk: r.rank === 'A' && !r.done ? 'var(--action-primary-text)' : 'var(--text-secondary)',
            rowBg: this.state.raceOpen === i ? 'var(--material-control)' : 'transparent',
            onClick: () => this.setState((st) => ({ raceOpen: st.raceOpen === i ? null : i }))
          })),
          evidence: [
            { label: 'Fitness', sub: (v.altVdot || '49.8') + ' needed for ' + goal, value: 'VDOT 47.9' },
            { label: 'Last race', sub: 'Half marathon, 16 Jul · full weight for 7 more days', value: '63 days ago' }
          ],
          log: [
            { kind: 'week-close', date: '14 Sep', text: '42.1 mi of 44 planned · both quality days landed.' },
            { kind: 'first', date: '7 Sep', text: 'Longest run you have ever logged · 18.2 mi. Old mark 16.4.' },
            { kind: 'phase', date: '24 Aug', text: 'Base done · 8 weeks, 240 mi, long run 10 to 16. Build starts today.' },
            { kind: 'discipline', date: '18 Aug', text: 'Your last five easy days averaged 79% of max. Easy is 65 to 75 · run them under 148 and let the pace fall where it wants.' }
          ]
        };
      })(),
      block: {
        toGo: 'Sub 3:30 · 7 Dec',
        kicker: '2 weeks left of this phase',
        phase: 'Base',
        phaseWeek: '10 weeks to CIM',
        stats: [
          { label: 'Quality share', value: '18%' },
          { label: 'Long run', value: '16 mi' },
          { label: 'This week', value: '44 mi' }
        ],
        phases: [
          { name: 'Base', weeks: 8, current: true, at: 0.72 },
          { name: 'Quality', weeks: 4 },
          { name: 'Race specific', weeks: 3 },
          { name: 'Taper', weeks: 1 }
        ],
        noLabels: ['', '', '', '', '', '', ''],
        say: 'Two more weeks of miles, then the work that decides the race arrives · nothing about today is meant to feel hard yet.',
        hasChanges: (this.state.planApplied || []).length > 0,
        changedRows: (this.state.planApplied || []).map((k) => {
          const c = PLAN_CHANGES.find((x) => x.key === k);
          return {
            label: c.changed, sub: c.changedSub, value: 'Undo',
            onClick: () => this.setState((st) => ({ planApplied: (st.planApplied || []).filter((x) => x !== k) }))
          };
        }),
        weeks: this.blockWeeks().map((w, i) => ({
          week: w.week, mi: w.mi + ' mi', days: w.days, detail: w.detail,
          // the phase name only where it changes; otherwise the row says what is notable about it
          flag: w.now || w.flag === 'Cutback' || w.flag === 'Race week' ? w.flag
            : (i === 0 || BLOCK_WEEKS[i - 1].phase !== w.phase) ? w.phase : '',
          // drawn here rather than by WeekShape: at row scale its 8px radius turns short days
          // into pills. Same reading — height is load, quality white, today signal, rest absent.
          bars: (() => {
            const top = Math.max.apply(null, w.days.map((x) => x.load || 0));
            return w.days.map((day) => ({
              h: day.load ? Math.max(4, Math.round((day.load / top) * 44)) + 'px' : '0px',
              fill: day.today ? 'var(--signal)' : day.quality ? 'var(--plot-ink)' : 'var(--plot-quiet)',
              op: day.future ? 0.5 : 1
            }));
          })(),
          open: this.state.blockWeek === i,
          weight: w.now ? 700 : 400,
          ink: w.now ? 'var(--text-primary)' : 'var(--text-secondary)',
          rowBg: this.state.blockWeek === i ? 'var(--material-control)' : 'transparent',
          onClick: () => this.setState((st) => ({ blockWeek: st.blockWeek === i ? null : i }))
        })),
        soFarRows: [
          { label: 'Miles run', sub: 'Of 656 in the whole block', value: '234' },
          { label: 'Sessions', sub: '3 missed, 1 moved', value: '38 of 42' },
          { label: 'Longest so far', sub: 'The block peaks at 20 mi', value: '16 mi' }
        ],
        libraryRows: (this.state.libOpen
          ? [{ label: 'Workout library', sub: '', value: 'Close', onClick: () => this.setState({ libOpen: false }) }]
            .concat(['Threshold ladder', 'Mile repeats', 'Long run with marathon pace', 'Hill circuit'].map((n) => ({
              label: n, sub: '', value: '', onClick: () => this.setState({ libOpen: false })
            })))
          : [{ label: 'Workout library', sub: '54 named sessions', value: 'Open', onClick: () => this.setState({ libOpen: true }) }]
        ).concat(this.state.recentOpen
          ? [{ label: 'Recent runs', sub: '', value: 'Close', onClick: () => this.setState({ recentOpen: false }) }]
            .concat([
              { label: 'Thursday · 6.02 mi easy', sub: '9:02 /mi · effort 3', value: '' },
              { label: 'Tuesday · 10.1 mi threshold', sub: '7:27 /mi work · effort 7', value: '' },
              { label: 'Sunday · 14.2 mi long', sub: '9:18 /mi · effort 5', value: '' }
            ])
          : [{ label: 'Recent runs', sub: '142 runs, 1,084 mi this year', value: 'Open', onClick: () => this.setState({ recentOpen: true }) }])
      },
      planOpen: !!this.state.planOpen,
      openPlan: () => this.setState({ planOpen: true, planAsk: null, planTravelFrom: '2025-09-30', planTravelTo: '2025-10-06', planTravelChecked: false }),
      closePlan: () => this.setState({ planOpen: false, planAsk: null, planTravelChecked: false }),
      plan: (() => {
        const ask = this.state.planAsk;
        const change = PLAN_CHANGES.find((c) => c.key === ask);
        const from = this.state.planTravelFrom || '2025-09-30';
        const to = this.state.planTravelTo || '2025-10-06';
        const fmt = (iso) => {
          const d = new Date(iso + 'T00:00:00');
          return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
        };
        const spanDays = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
        // The server decides satisfiability from the actual dates against this runner's block;
        // this prototype stands in for that call with a placeholder check on the chosen span.
        const satisfiable = spanDays > 0 && spanDays <= 9;
        const needsRange = ask === 'travel' && !this.state.planTravelChecked;
        const refused = ask === 'travel' && this.state.planTravelChecked && !satisfiable;
        const showBody = !!change && !needsRange;
        const say = !showBody ? '' : ask === 'travel'
          ? 'You are out from ' + fmt(from) + ' to ' + fmt(to) + ' \u00b7 the miles in that window come out of the week and are not made up anywhere, you cannot bank miles. Any long run inside the window goes with it, and the week is rebuilt so the spacing between hard days stays intact. You come back at a reduced load, because a jump straight back to full is past the acute-to-chronic line doctrine calls high risk. The race date and the taper do not move.'
          : change.say;
        return {
          sub: change ? 'The coach has read the rest of the block' : 'Tell the coach and the block gets rewritten around it',
          menu: !change,
          deciding: !!change,
          needsRange,
          travelFrom: from,
          travelTo: to,
          setTravelFrom: (e) => this.setState({ planTravelFrom: e.target.value }),
          setTravelTo: (e) => this.setState({ planTravelTo: e.target.value }),
          checkTravel: () => this.setState({ planTravelChecked: true }),
          refused,
          showSay: showBody && !refused,
          say,
          hasCaveats: showBody && !refused && !!(change.caveats && change.caveats.length),
          caveatsText: change && change.caveats ? change.caveats.join(' ') : '',
          refusalText: refused ? 'These dates pull a long run out entirely and push the return past the window the following week needs for its own long run \u00b7 satisfying the return-to-load limit and the long-run spacing at once is not possible for this range. No edit is proposed \u00b7 try a shorter or different window, or tell the coach directly.' : '',
          confirmLabel: showBody && !refused ? change.verb : '',
          confirm: () => this.setState((st) => ({
            planApplied: (st.planApplied || []).filter((k) => k !== ask).concat([ask]),
            planOpen: false,
            planAsk: null
          })),
          back: () => this.setState({ planAsk: null, planTravelChecked: false }),
          tryAgain: () => this.setState({ planTravelChecked: false }),
          options: PLAN_CHANGES.map((c) => ({
            label: c.label, sub: c.sub, onClick: () => this.setState({ planAsk: c.key })
          }))
        };
      })(),
      accountOpen: !!this.state.accountOpen,
      openAccount: () => this.setState({ accountOpen: true }),
      closeAccount: () => this.setState({ accountOpen: false }),
      accountRows: [
        {
          label: 'Start runs from this phone',
          sub: this.fromPhone ? 'RUN sits in the bottom bar' : 'The watch starts every session',
          value: this.fromPhone ? 'On' : 'Off',
          onClick: () => this.setState({ fromPhone: !this.fromPhone })
        },
        { label: 'Units', sub: 'Pace in minutes per mile', value: 'Miles' },
        { label: 'Coach', sub: 'Honest, no cheerleading', value: 'As is' }
      ],
      navNoop: () => {},
      calendarOpen: !!this.state.calendarOpen,
      openCalendar: () => this.setState({ calendarOpen: true }),
      closeCalendar: () => this.setState({ calendarOpen: false }),
      calendarIconUrl: CAL_ICON_URL,
      calendarWeeks: CALENDAR_WEEKS.map((w) => ({
        range: w.range, sub: w.sub,
        rows: w.days.map((dy) => ({
          label: dy.date,
          sub: dy.rest ? 'Rest day' : dy.type + ' \u00b7 ' + dy.dose,
          value: dy.today ? 'Today' : (dy.done ? 'Done' : ''),
          rowStyle: dy.today ? { background: 'var(--material-tile-raised)' } : {}
        }))
      })),
      raceDetail: Object.assign({}, RACE_DETAIL, {
        stats: [
          { label: 'Goal', value: RACE_DETAIL.goal, ink: '#FFFFFF' },
          { label: 'Projected', value: RACE_DETAIL.projected, ink: '#FFFFFF' },
          { label: 'Gap', value: RACE_DETAIL.gap, ink: 'var(--state-quality-ink)' }
        ],
        taperEndpoints: ['Week ' + RACE_DETAIL.taperWeeks, RACE_DETAIL.taperMax + '-week block'],
        noop: () => {}
      }),
      onboard: (() => {
        const ob = this.state.ob || {};
        const step = ob.step ?? 0;
        const set = (patch) => this.setState((st) => ({ ob: Object.assign({}, st.ob, patch) }));
        const mode = ob.mode || 'recent';
        const days = ob.days ?? 5;
        return {
          s0: step === 0, s1: step === 1, s2: step === 2, s3: step === 3, s4: step === 4,
          dots: [0, 1, 2, 3, 4].map((i) => ({ on: i <= step ? 'var(--signal)' : 'var(--material-control)' })),
          distance: ob.distance || 'marathon',
          distanceOptions: [{ value: '5k', label: '5k' }, { value: '10k', label: '10k' }, { value: 'half', label: 'Half marathon' }, { value: 'marathon', label: 'Marathon' }, { value: 'none', label: 'No race yet' }],
          setDistance: (v) => set({ distance: v }),
          raceDate: ob.raceDate || '', setRaceDate: (v) => set({ raceDate: v }),
          goalTime: ob.goalTime || '', setGoalTime: (v) => set({ goalTime: v }),
          modes: ONBOARD_MODES.map((m) => Object.assign({}, m, { checked: mode === m.key, onChange: () => set({ mode: m.key }) })),
          modeRecent: mode === 'recent', modeEffort: mode === 'effort', modeConsistent: mode === 'consistent', modeTimeoff: mode === 'timeoff', modeNew: mode === 'new',
          recentDist: ob.recentDist || '', setRecentDist: (v) => set({ recentDist: v }),
          recentTime: ob.recentTime || '', setRecentTime: (v) => set({ recentTime: v }),
          effortPace: ob.effortPace || '', setEffortPace: (v) => set({ effortPace: v }),
          weeklyMi: ob.weeklyMi ?? 24, setWeeklyMi: (v) => set({ weeklyMi: v }),
          offWeeks: ob.offWeeks || '', setOffWeeks: (v) => set({ offWeeks: v }),
          offMi: ob.offMi || '', setOffMi: (v) => set({ offMi: v }),
          days, setDays: (v) => set({ days: v }),
          daysHelper: days >= 6 ? 'Six or more and the coach holds at least three easy days.' : 'Five is enough for almost every goal.',
          longDay: ob.longDay || 'sun',
          longDayOptions: [{ value: 'fri', label: 'Friday' }, { value: 'sat', label: 'Saturday' }, { value: 'sun', label: 'Sunday' }],
          setLongDay: (v) => set({ longDay: v }),
          phoneStart: ob.phoneStart ?? true,
          phoneStartSub: (ob.phoneStart ?? true) ? 'The RUN button starts every session' : 'Your watch starts every run instead',
          togglePhoneStart: () => set({ phoneStart: !(ob.phoneStart ?? true) }),
          next: () => set({ step: Math.min(step + 1, 4) }),
          back: () => set({ step: Math.max(step - 1, 0) }),
          restart: () => set({ step: 0 })
        };
      })(),
      settings: (() => {
        const st = this.state.settings || {};
        const set = (patch) => this.setState((s) => ({ settings: Object.assign({}, s.settings, patch) }));
        return {
          longDay: st.longDay || 'sun',
          longDayOptions: [{ value: 'fri', label: 'Friday' }, { value: 'sat', label: 'Saturday' }, { value: 'sun', label: 'Sunday' }],
          setLongDay: (v) => set({ longDay: v }),
          days: st.days ?? 5, setDays: (v) => set({ days: v }),
          fromPhone: this.fromPhone, toggleFromPhone: () => this.setState({ fromPhone: !this.fromPhone }),
          fromPhoneSub: this.fromPhone ? 'RUN sits in the bottom bar' : 'Your watch starts every session',
          reminders: st.reminders ?? true, toggleReminders: () => set({ reminders: !(st.reminders ?? true) }),
          weeklySummary: st.weeklySummary ?? true, toggleWeeklySummary: () => set({ weeklySummary: !(st.weeklySummary ?? true) }),
          units: st.units || 'mi',
          unitsOptions: [{ value: 'mi', label: 'Miles' }, { value: 'km', label: 'Kilometres' }],
          setUnits: (v) => set({ units: v }),
          strava: !!this.state.strava, toggleStrava: () => this.setState({ strava: !this.state.strava }),
          signOut: () => {}
        };
      })(),
      shoes: (() => {
        const worn = this.state.shoe ?? 1;
        const openIdx = this.state.shoeDetail;
        return {
          rows: SHOES.map((s, i) => {
            const cap = RETIRE_AT[s.name] || 300;
            return {
              name: s.name, mi: s.mi, cap,
              endpoints: [s.mi + ' mi', cap + ' mi retirement'],
              wearing: i === worn, open: openIdx === i,
              wearVariant: i === worn ? 'secondary' : 'primary',
              wearingLabel: i === worn ? 'Wearing' : 'Wear these',
              toggleOpen: () => this.setState({ shoeDetail: openIdx === i ? null : i }),
              wear: () => this.setState({ shoe: i, shoeDetail: null }),
              retire: () => this.setState({ shoeDetail: null })
            };
          }),
          retired: RETIRED_SHOES
        };
      })(),
      liveRun: Object.assign({}, LIVE_RUN, {
        paceShort: Math.floor(LIVE_RUN.pace / 60) + ':' + String(Math.round(LIVE_RUN.pace % 60)).padStart(2, '0'),
        stats: [
          { label: 'Distance', value: LIVE_RUN.miDone + ' of ' + LIVE_RUN.miTotal + ' mi' },
          { label: 'Avg pace', value: '7:34 /mi' },
          { label: 'Avg heart', value: '151 bpm' }
        ],
        hrBand: { low: 100, high: LIVE_RUN.hrCeiling },
        splitsSoFar: LIVE_RUN.splitsSoFar.map((s) => ({ miLabel: 'Mile ' + s.mi, pace: s.pace }))
      }),
      injury: Object.assign({}, INJURY, {
        checkOptions: INJURY.checkOptions.map((o) => ({
          label: o.label, sub: o.sub,
          onClick: () => this.setState({ injuryCheck: o.key })
        })),
        checked: this.state.injuryCheck || null,
        checkedNote: this.state.injuryCheck === 'better' ? 'Logged \u00b7 tomorrow eases back in.'
          : this.state.injuryCheck === 'same' ? 'Logged \u00b7 one more day, then reassess.'
          : this.state.injuryCheck === 'worse' ? 'Logged \u00b7 flagged for a second look.' : ''
      }),
      weekOff: WEEK_OFF,
      offSeason: OFF_SEASON,
      overnight: OVERNIGHT,
      paceDrop: (() => {
        const key = { slower: 'slower', 'faster-training': 'fasterTraining', 'faster-race': 'fasterRace' }[this.paceDirection] || 'slower';
        const p = PACE_SHIFT[key];
        return Object.assign({}, p, {
          confirmOptions: p.confirmOptions.map((o) => ({
            label: o.label, sub: o.sub,
            onClick: () => this.setState({ paceCall: o.key })
          })),
          checked: this.state.paceCall || null,
          checkedNote: (() => {
            const k = this.state.paceCall;
            if (k === 'confirm' || k === 'representative') return p.confirmedNote;
            if (k === 'noise' || k === 'compromised' || k === 'unrepresentative') return p.noiseNote;
            return '';
          })()
        });
      })(),
      ladder: (() => {
        const stage = this.state.stage;
        return {
          stage,
          current: LADDER_STAGES[stage - 1],
          areaNote: 'Left calf \u00b7 cleared to return',
          rule: 'A stage advances only if the calf stayed silent during the session and silent again the next morning \u00b7 a good session does not skip a stage.',
          rows: LADDER_STAGES.map((s, i) => {
            const n = i + 1;
            const status = n < stage ? 'Done' : n === stage ? 'Today' : '';
            return {
              label: 'Stage ' + n, sub: s.label + ' \u00b7 ' + s.sub,
              value: status,
              ink: n === stage ? 'var(--text-primary)' : n < stage ? 'var(--text-secondary)' : 'var(--text-quiet)'
            };
          }),
          checkOptions: [
            { key: 'silent', label: 'Calf stayed silent', sub: 'Advance to the next stage' },
            { key: 'off', label: 'Something felt off', sub: 'Repeat this stage tomorrow' }
          ].map((o) => ({
            label: o.label, sub: o.sub,
            onClick: () => this.setState((st) => ({
              ladderCheck: o.key,
              stage: o.key === 'silent' ? Math.min(8, st.stage + 1) : st.stage
            }))
          })),
          checked: this.state.ladderCheck || null,
          checkedNote: this.state.ladderCheck === 'silent' ? 'Logged \u00b7 tomorrow moves to the next stage.'
            : this.state.ladderCheck === 'off' ? 'Logged \u00b7 tomorrow repeats today\u2019s stage.' : ''
        };
      })(),
      hasNiggle: !!this.state.niggle,
      dataOutage: {
        retry: () => this.setState({ outageRetryAt: Date.now() })
      },
      treadmillRun: (() => {
        const speed = this.state.tmSpeed ?? TREADMILL_RUN.speedDefault;
        const incline = this.state.tmIncline ?? TREADMILL_RUN.inclineDefault;
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v * 10) / 10));
        const setSpeed = (delta) => this.setState((st) => ({ tmSpeed: clamp((st.tmSpeed ?? TREADMILL_RUN.speedDefault) + delta, 3, 14) }));
        const setIncline = (delta) => this.setState((st) => ({ tmIncline: clamp((st.tmIncline ?? TREADMILL_RUN.inclineDefault) + delta, 0, 12) }));
        const pace = 3600 / speed;
        const paceMin = Math.floor(pace / 60), paceSec = Math.round(pace % 60);
        const paceShort = paceMin + ':' + String(paceSec).padStart(2, '0');
        return Object.assign({}, TREADMILL_RUN, {
          speed: speed.toFixed(1), incline: incline.toFixed(1),
          pace: paceShort + ' /mi', paceShort,
          intervalShort: TREADMILL_RUN.interval.split('\u00b7')[0].trim(),
          speedDown: () => setSpeed(-0.2), speedUp: () => setSpeed(0.2),
          inclineDown: () => setIncline(-0.5), inclineUp: () => setIncline(0.5),
          splitsSoFar: TREADMILL_RUN.splitsSoFar.map((s) => ({ miLabel: 'Mile ' + s.mi, pace: s.pace }))
        });
      })(),
      runPickerOpen: !!this.state.runPickerOpen,
      closeRunPicker: () => this.setState({ runPickerOpen: false }),
      setEasy: () => this.setState({ day: 'easy', a: {}, b: {} }),
      setQuality: () => this.setState({ day: 'quality', a: {}, b: {} }),
      setRace: () => this.setState({ day: 'race', a: {}, b: {} })
    };
  }
}
</script>
</body>
</html>
