/**
 * Workout descriptions, recipe-style breakdown per workout, with
 * paces DERIVED FROM THE USER'S FITNESS instead of hardcoded.
 *
 * Each workout template carries zone refs ('E', 'T', 'I', 'race-pace'),
 * not literal pace strings. At read time, the resolved fitness bundle
 * (lib/fitness-resolver.ts) supplies the actual bpm bands.
 *
 * Calling `describeWorkout(label, type, fitness)` returns concrete
 * pace strings tuned to the runner. Calling it without fitness falls
 * back to a VDOT-45 default profile so existing call sites that don't
 * yet pass fitness still render reasonable strings.
 *
 * THIS IS THE FIX for the bug where a runner with a 1:30:00 HM goal
 * (6:52/mi race pace) saw 7:30–7:50/mi on their workout cards.
 */

import { pacesFromVdot, type DanielsPaceSet } from './vdot';
import { fmtPaceBand, type ResolvedFitness, type FitnessHrZones } from './fitness-types';

/** Daniels pace zone → HR zone mapping. Both anchor to physiological
 *  effort thresholds, easy aerobic pace lives in Z2 HR; threshold
 *  pace lives in Z4; VO2max intervals live in Z5. */
function hrZoneForPaceZone(zoneRef: ZoneRef, hrZones: FitnessHrZones | null): { lowBpm: number; highBpm: number } | null {
  if (!hrZones) return null;
  switch (zoneRef) {
    case 'E':         return hrZones.z2;
    case 'M':         return hrZones.z3;
    case 'T':         return hrZones.z4;
    case 'I':         return hrZones.z5;
    case 'R':         return hrZones.z5;
    case 'race-pace': return hrZones.z4;  // HM-pace effort lives in Z4
    case 'fast':              return hrZones.z5;
    case 'powerful':          return null; // strides, HR lags too much to be meaningful
    case 'mixed-easy-to-race':return null; // headline-only ref
  }
}

function fmtHrBand(band: { lowBpm: number; highBpm: number } | null): string | null {
  if (!band) return null;
  return `${band.lowBpm}-${band.highBpm} bpm`;
}

// ── Public types ──────────────────────────────────────────────────

export interface SimpleStep {
  kind: 'simple';
  name: string;
  duration: string;
  pace: string;
  zone: string;
  /** HR target band derived from fitness.hrZones. Format: "105-122 bpm".
   *  null when max HR isn't set or this step doesn't have a meaningful
   *  HR target (e.g., recovery jogs). */
  hrTarget?: string | null;
}

export interface LoopItem {
  verb: string;
  duration: string;
  pace?: string;
  zone?: string;
  suffix?: string;
  hrTarget?: string | null;
}

export interface LoopStep {
  kind: 'loop';
  name: string;
  times: number;
  items: LoopItem[];
}

export type WorkoutStep = SimpleStep | LoopStep;

export interface WorkoutDescription {
  zone: string;
  paceTarget: string;
  steps: WorkoutStep[];
  effort: string;
  why: string;
  /** Coach-voice TODAY'S JOB line — translates this prescription into
   *  goal-relevant action for the runner. Quality days include a
   *  stretch-pace target; long days emphasize accumulation; easy/rest
   *  emphasize that recovery IS the work that enables tomorrow's session.
   *  First-person ("tells me you're ready"), no jargon, no em dashes. */
  todaysJob: string;
}

// ── Internal template types, what the catalog stores ─────────────

type ZoneRef = 'E' | 'M' | 'T' | 'I' | 'R' | 'race-pace' | 'fast' | 'powerful' | 'mixed-easy-to-race';

interface SimpleStepTemplate {
  kind: 'simple';
  name: string;
  duration: string;
  /** Resolves to a pace string via fitness. */
  zoneRef: ZoneRef;
  /** Display label after the pace ("easy", "half-marathon goal"). */
  zoneLabel: string;
  /** Override if zoneRef can't capture the nuance (e.g. "hard uphill"). */
  paceOverride?: string;
}

interface LoopItemTemplate {
  verb: string;
  duration: string;
  zoneRef?: ZoneRef;
  zoneLabel?: string;
  paceOverride?: string;
  suffix?: string;
}

interface LoopStepTemplate {
  kind: 'loop';
  name: string;
  times: number;
  items: LoopItemTemplate[];
}

type WorkoutStepTemplate = SimpleStepTemplate | LoopStepTemplate;

interface WorkoutTemplate {
  zone: string;
  /** Which zone drives the modal headline "paceTarget" line. */
  headlineZoneRef: ZoneRef;
  /** Optional override for the headline string (used for mixed
   *  workouts like "9:30 easy → half-marathon goal pace"). */
  headlineOverride?: (paces: DanielsPaceSet, racePace: string) => string;
  steps: WorkoutStepTemplate[];
  effort: string;
  why: string;
  /** TODAY'S JOB coach line. Either a fixed string OR a function that
   *  takes the realized bands so quality days can interpolate a
   *  runner-specific stretch pace (midpoint between prescribed T and
   *  race goal pace). First-person coach voice, no jargon. */
  todaysJob: string | ((bands: FitnessBands) => string);
}

/** Compute a "stretch pace" for quality days — the pace that, if hit
 *  with HR holding, signals the runner is ready for tighter
 *  prescription. Midpoint between prescribed T center and race goal
 *  pace, clamped to ≤10 s/mi faster than prescribed (anything beyond
 *  is sandbagging the prescription, not stretching). */
function stretchPaceSPerMi(bands: FitnessBands): number {
  const tCenter = Math.round((bands.paces.T.lowS + bands.paces.T.highS) / 2);
  const raceCenter = Math.round((bands.racePaceBand.lowS + bands.racePaceBand.highS) / 2);
  const midpoint = Math.round((tCenter + raceCenter) / 2);
  const floor = tCenter - 10;   // never more than 10 s/mi faster than prescribed
  return Math.max(midpoint, floor);
}

function fmtPaceLine(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/mi`;
}

// ── Pace string resolution ────────────────────────────────────────

/** Build a stand-in DanielsPaceSet so consumers that don't pass
 *  fitness still get sensible numbers. VDOT 45 ≈ 7:30 5K runner. */
const FALLBACK_PACES: DanielsPaceSet = pacesFromVdot(45)!;
const FALLBACK_RACE_PACE_S = 7 * 60 + 30; // 7:30/mi

interface FitnessBands {
  paces: DanielsPaceSet;
  racePaceBand: { lowS: number; highS: number; label: string };
  /** HR zone bands derived from max HR, null when max HR isn't set
   *  (manual override absent + no Strava peak high enough). Consumers
   *  use this to attach "105-122 bpm" alongside pace targets. */
  hrZones: FitnessHrZones | null;
}

function bandsFromFitness(fitness: ResolvedFitness | null): FitnessBands {
  if (fitness) {
    return {
      paces: fitness.paces,
      racePaceBand: fitness.racePaceBand,
      hrZones: fitness.hrZones,
    };
  }
  return {
    paces: FALLBACK_PACES,
    racePaceBand: { lowS: FALLBACK_RACE_PACE_S - 10, highS: FALLBACK_RACE_PACE_S + 10, label: 'Race pace' },
    hrZones: null,
  };
}

function paceForZone(zoneRef: ZoneRef, bands: FitnessBands): string {
  switch (zoneRef) {
    case 'E':         return `${fmtPaceBand(bands.paces.E)}`;
    case 'M':         return `${fmtPaceBand(bands.paces.M)}`;
    case 'T':         return `${fmtPaceBand(bands.paces.T)}`;
    case 'I':         return `${fmtPaceBand(bands.paces.I)}`;
    case 'R':         return `${fmtPaceBand(bands.paces.R)}`;
    case 'race-pace': return `${fmtPaceBand(bands.racePaceBand)}`;
    case 'fast':      return '1-mile race pace';
    case 'powerful':  return 'hard';
    case 'mixed-easy-to-race':
      return `${fmtPaceBand(bands.paces.E)} → ${fmtPaceBand(bands.racePaceBand)}`;
  }
}

// ── Catalog: templates with zone refs (NOT literal pace strings) ──

const TEMPLATES: Record<string, WorkoutTemplate> = {
  // ── Easy / aerobic ────────────────────────────────────────────
  'Easy': {
    zone: 'Easy · Zone 2',
    headlineZoneRef: 'E',
    steps: [
      { kind: 'simple', name: 'Easy Run', duration: 'Full distance', zoneRef: 'E', zoneLabel: 'easy' },
    ],
    effort: 'Conversational, you should be able to hold a full sentence the whole way. If breathing makes that hard, slow down.',
    why: 'Easy days are where your aerobic engine builds. Protect them from creeping into "medium-hard."',
    todaysJob: 'Easy today protects the next quality day. If that one lands clean, it\'s because today stayed easy. Skip the urge to push, you\'re investing in the rep that moves your goal.',
  },
  'Easy + Strides': {
    zone: 'Easy · Zone 2 + Strides',
    headlineZoneRef: 'E',
    headlineOverride: (p) => `${fmtPaceBand(p.E)} · strides at 1-mile race pace`,
    steps: [
      { kind: 'simple', name: 'Easy Run', duration: 'Most of the run', zoneRef: 'E', zoneLabel: 'easy' },
      {
        kind: 'loop',
        name: 'Strides at the end',
        times: 8,
        items: [
          { verb: 'Run', duration: '15 sec', zoneRef: 'fast', zoneLabel: 'fast' },
          { verb: 'Walk', duration: '45–60 sec', suffix: 'to recover' },
        ],
      },
    ],
    effort: 'Easy throughout the run. Strides are quick and smooth, about the speed you could just barely hold for a full mile race. Focus on form and turnover.',
    why: 'Strides keep your legs feeling fast and your turnover sharp without adding fatigue.',
    todaysJob: 'Easy with sprinkles. The strides keep your nervous system fresh for the next quality day. Don\'t grind, the cost-benefit is in the easy.',
  },
  'Hill Strides': {
    zone: 'Easy · Zone 2 + Hill Strides',
    headlineZoneRef: 'E',
    headlineOverride: (p) => `${fmtPaceBand(p.E)} · strides hard uphill`,
    steps: [
      { kind: 'simple', name: 'Easy Run', duration: 'Most of the run', zoneRef: 'E', zoneLabel: 'easy' },
      {
        kind: 'loop',
        name: 'Hill Strides at the end',
        times: 8,
        items: [
          { verb: 'Run uphill', duration: '10 sec', zoneRef: 'powerful', zoneLabel: 'powerful' },
          { verb: 'Walk back down', duration: 'to base', suffix: 'fully recover' },
        ],
      },
    ],
    effort: 'Easy on the flat. Strides are powerful and controlled, drive your knees, stay tall. Don\'t sprint.',
    why: 'Sharpens leg power and tendon stiffness without the volume cost of intervals.',
    todaysJob: 'Power without volume. The hill sprints sharpen your legs for race-pace work without adding miles. Stay easy on the flat, let the hills do the work.',
  },

  // ── Long ──────────────────────────────────────────────────────
  'Long': {
    zone: 'Long · Zone 2',
    headlineZoneRef: 'E',
    steps: [
      { kind: 'simple', name: 'Long Run', duration: 'Full distance', zoneRef: 'E', zoneLabel: 'easy' },
    ],
    effort: 'Conversational throughout. Time on feet is the stimulus, don\'t chase pace. Last 20 min can drift slightly faster if it feels natural.',
    why: 'Endurance builds through duration, not speed.',
    todaysJob: 'Mile 11 of your race holds together because of the long runs you do now. Today\'s job is honest aerobic minutes. Don\'t chase pace, time on feet IS the work.',
  },
  'Long Run · HM Finish': {
    zone: 'Long · Zone 2 → Race Pace',
    headlineZoneRef: 'mixed-easy-to-race',
    steps: [
      { kind: 'simple', name: 'Easy Aerobic', duration: 'First ⅔ of run', zoneRef: 'E', zoneLabel: 'easy' },
      { kind: 'simple', name: 'HM Finish',    duration: 'Final 3–4 mi',  zoneRef: 'race-pace', zoneLabel: 'half-marathon goal' },
    ],
    effort: 'Easy for two-thirds. Then disciplined race pace through the finish, same fatigue you\'ll have on race day.',
    why: 'Practice goal pace on tired legs. Pacing discipline is the work.',
    todaysJob: 'The fatigue you feel at mile 9 today is exactly what mile 10 feels like on race day. Hit the finish band, not faster. Discipline now buys you the last 5K on race day.',
  },
  'Long Run · Progression': {
    zone: 'Long · Zone 2 → Zone 3',
    headlineZoneRef: 'mixed-easy-to-race',
    headlineOverride: (p, race) => `${fmtPaceBand(p.E)} → ${race} across the run`,
    steps: [
      { kind: 'simple', name: 'Opening Third', duration: 'First ⅓',  zoneRef: 'E', zoneLabel: 'easy' },
      { kind: 'simple', name: 'Middle Third',  duration: 'Middle ⅓', zoneRef: 'M', zoneLabel: 'steady' },
      { kind: 'simple', name: 'Final Third',   duration: 'Last ⅓',   zoneRef: 'race-pace', zoneLabel: 'progressing' },
    ],
    effort: 'Steady, controlled increase. You should feel stronger as the run develops, not blown out at the end.',
    why: 'Teaches you to push tempo as fatigue builds, race-day pacing without the race.',
    todaysJob: 'Build into goal pace as fatigue accumulates. The last third is the rehearsal — that\'s where the goal-pace work actually matters.',
  },
  'Long Run · Taper': {
    zone: 'Long · Zone 2',
    headlineZoneRef: 'E',
    steps: [
      { kind: 'simple', name: 'Long Run', duration: 'Full distance', zoneRef: 'E', zoneLabel: 'easy' },
    ],
    effort: 'Fully easy. This is sharpening, not building.',
    why: 'Preserves the long-run feel without adding fatigue. Volume drops to set up race week.',
    todaysJob: 'Stay easy. The long-run feel is preserved, the fatigue isn\'t. Race day wants you sharp, not tired.',
  },

  // ── Threshold (Zone 4) ────────────────────────────────────────
  'Threshold · Cruise Intervals': {
    zone: 'Threshold · Zone 4',
    headlineZoneRef: 'T',
    steps: [
      { kind: 'simple', name: 'Warm Up', duration: '15 min', zoneRef: 'E', zoneLabel: 'easy' },
      {
        kind: 'loop',
        name: 'Cruise Intervals',
        times: 5,
        items: [
          { verb: 'Run', duration: '7 min',   zoneRef: 'T', zoneLabel: 'threshold' },
          { verb: 'Jog', duration: '90 sec',  paceOverride: 'easy', suffix: 'to recover' },
        ],
      },
      { kind: 'simple', name: 'Cool Down', duration: '10 min', zoneRef: 'E', zoneLabel: 'easy' },
    ],
    effort: 'Comfortably hard, roughly your 10K race pace. You can say 2–3 words at a time, but not a full sentence.',
    why: 'Controlled, sustainable threshold work. Stay steady at the edge of comfortable; don\'t push harder.',
    todaysJob: (bands) => `Closer to ${fmtPaceLine(stretchPaceSPerMi(bands))} with breathing controlled tells me you're ready for more. Stack three sessions like that and I tighten next week's threshold work. Same effort, faster legs, closer to your race goal.`,
  },
  'Threshold · HM Blocks': {
    zone: 'Threshold · Zone 4',
    headlineZoneRef: 'race-pace',
    headlineOverride: (_p, race) => `${race} (half-marathon goal)`,
    steps: [
      { kind: 'simple', name: 'Warm Up', duration: '15 min', zoneRef: 'E', zoneLabel: 'easy' },
      {
        kind: 'loop',
        name: 'HM-Pace Blocks',
        times: 3,
        items: [
          { verb: 'Run', duration: '13 min', zoneRef: 'race-pace', zoneLabel: 'half-marathon goal' },
          { verb: 'Jog', duration: '3 min',  paceOverride: 'easy', suffix: 'to recover' },
        ],
      },
      { kind: 'simple', name: 'Cool Down', duration: '10 min', zoneRef: 'E', zoneLabel: 'easy' },
    ],
    effort: 'Goal half-marathon pace, sustainable but pressing. Steady, not surging.',
    why: 'Race-specific endurance. Teaches your body to hold goal pace for extended chunks.',
    todaysJob: 'Race rehearsal at goal pace. This is exactly what the middle of AFC feels like. Practice the discipline now, execute it on race day.',
  },
  'Threshold · HM Cruise': {
    zone: 'Threshold · Zone 4',
    headlineZoneRef: 'race-pace',
    headlineOverride: (_p, race) => `${race} (half-marathon pace)`,
    steps: [
      { kind: 'simple', name: 'Warm Up', duration: '15 min', zoneRef: 'E', zoneLabel: 'easy' },
      {
        kind: 'loop',
        name: 'HM-Pace Cruise',
        times: 3,
        items: [
          { verb: 'Run', duration: '10 min', zoneRef: 'race-pace', zoneLabel: 'half-marathon pace' },
          { verb: 'Jog', duration: '2 min',  paceOverride: 'easy', suffix: 'to recover' },
        ],
      },
      { kind: 'simple', name: 'Cool Down', duration: '10 min', zoneRef: 'E', zoneLabel: 'easy' },
    ],
    effort: 'Steady half-marathon pace, feels like work but never out of control.',
    why: 'Solid threshold dose at race pace. Long enough to feel like work, short enough not to overreach.',
    todaysJob: 'Goal pace in shorter blocks. Less volume, same specificity. The discipline of holding pace under controlled fatigue is what wins races.',
  },
  'Threshold · HM Tempo': {
    zone: 'Threshold · Zone 4',
    headlineZoneRef: 'race-pace',
    headlineOverride: (_p, race) => `${race} (half-marathon goal)`,
    steps: [
      { kind: 'simple', name: 'Warm Up',  duration: '15 min', zoneRef: 'E', zoneLabel: 'easy' },
      { kind: 'simple', name: 'HM Tempo', duration: '25 min', zoneRef: 'race-pace', zoneLabel: 'half-marathon goal · continuous' },
      { kind: 'simple', name: 'Cool Down',duration: '10 min', zoneRef: 'E', zoneLabel: 'easy' },
    ],
    effort: 'The hardest sustained effort of the week. If pace slips, finish controlled, don\'t blow up.',
    why: 'Pure race-day specificity. Practice holding goal pace under fatigue.',
    todaysJob: 'The hardest sustained session before race week. If pace slips, finish controlled. Never blow up a tempo, the bigger crime is overcooking it.',
  },
  'Threshold Touch': {
    zone: 'Threshold · Zone 4 (taper)',
    headlineZoneRef: 'T',
    steps: [
      { kind: 'simple', name: 'Warm Up', duration: '10 min', zoneRef: 'E', zoneLabel: 'easy' },
      {
        kind: 'loop',
        name: 'Threshold Touch',
        times: 3,
        items: [
          { verb: 'Run', duration: '4 min',  zoneRef: 'T', zoneLabel: '10K race pace' },
          { verb: 'Jog', duration: '90 sec', paceOverride: 'easy', suffix: 'to recover' },
        ],
      },
      { kind: 'simple', name: 'Cool Down', duration: '10 min', zoneRef: 'E', zoneLabel: 'easy' },
    ],
    effort: 'Comfortably hard. Brief, should feel sharp, not depleted.',
    why: 'Reminds your body what hard feels like during taper without compromising race day.',
    todaysJob: 'Brief reminder of what hard feels like. Don\'t push, just touch the pace and get out. The race wants you sharp, not depleted.',
  },
  'Threshold · Race Week Tune': {
    zone: 'Threshold · Zone 4 (race week)',
    headlineZoneRef: 'race-pace',
    headlineOverride: (_p, race) => `~10 sec/mi slower than ${race}`,
    steps: [
      { kind: 'simple', name: 'Warm Up', duration: '10 min', zoneRef: 'E', zoneLabel: 'easy' },
      {
        kind: 'loop',
        name: 'Race-Week Tune',
        times: 2,
        items: [
          { verb: 'Run', duration: '6 min', zoneRef: 'race-pace', zoneLabel: '~10 sec/mi slower than HM goal' },
          { verb: 'Jog', duration: '2 min', paceOverride: 'easy', suffix: 'to recover' },
        ],
      },
      { kind: 'simple', name: 'Cool Down', duration: '10 min', zoneRef: 'E', zoneLabel: 'easy' },
    ],
    effort: 'Sharp but easy. Wake the system up.',
    why: 'Race-week primer. Don\'t leave anything on the table, save it for race day.',
    todaysJob: 'Sharp but easy. Wake the system up without leaving anything in the tank. Race day is for collecting receipts.',
  },

  // ── VO₂max / Intervals ────────────────────────────────────────
  'Intervals': {
    zone: 'VO₂max · Zone 5',
    headlineZoneRef: 'I',
    steps: [
      { kind: 'simple', name: 'Warm Up', duration: '15 min', zoneRef: 'E', zoneLabel: 'easy' },
      {
        kind: 'loop',
        name: 'VO₂max Intervals',
        times: 6,
        items: [
          { verb: 'Run', duration: '3 min', zoneRef: 'I', zoneLabel: 'faster than 5K race pace' },
          { verb: 'Jog', duration: '2 min', paceOverride: 'easy', suffix: 'to recover' },
        ],
      },
      { kind: 'simple', name: 'Cool Down', duration: '10 min', zoneRef: 'E', zoneLabel: 'easy' },
    ],
    effort: 'Hard, faster than 5K pace. Breathing is the limiter, not your legs.',
    why: 'VO₂max work pushes your aerobic ceiling.',
    todaysJob: 'Hard reps grow your aerobic ceiling. Hit the band, don\'t beat it. The value is AT the band, not below it. Full recoveries so every rep is fresh.',
  },

  // ── Race week ─────────────────────────────────────────────────
  'Shake-out': {
    zone: 'Easy · Zone 1–2',
    headlineZoneRef: 'E',
    steps: [
      { kind: 'simple', name: 'Easy Jog', duration: '3 mi', zoneRef: 'E', zoneLabel: 'fully conversational' },
      { kind: 'simple', name: 'Optional Strides', duration: '3 strides at the end', zoneRef: 'fast', zoneLabel: 'only if you feel flat' },
    ],
    effort: 'Easy and relaxed. Get out, get back.',
    why: 'Loosen up, not train. Save the legs for race day.',
    todaysJob: 'Loosen up, get the legs awake. The training is in the bank. Today\'s job is staying loose, not building.',
  },
  'AFC Half': {
    zone: 'Race · Zone 4–5',
    headlineZoneRef: 'race-pace',
    headlineOverride: () => 'Half-marathon goal pace',
    steps: [
      { kind: 'simple', name: 'Conservative Open', duration: 'Miles 1–3',          zoneRef: 'race-pace', zoneLabel: 'should feel almost too easy', paceOverride: '~10 sec/mi slower than goal' },
      { kind: 'simple', name: 'Settle In',         duration: 'Miles 4–10',         zoneRef: 'race-pace', zoneLabel: 'lock in and hold' },
      { kind: 'simple', name: 'Commit',            duration: 'Mile 10 → finish',   zoneRef: 'race-pace', zoneLabel: 'the last 5K is where the race is won', paceOverride: 'goal pace or faster' },
    ],
    effort: 'Race effort. The training is done; the legs know what to do.',
    why: 'Race day. The first three miles set up everything that comes after. Hold back early, commit when the work shows up.',
    todaysJob: 'First three miles slower than you want — every fast plan dies there. Settle the middle, then commit the last 5K. Take fuel on schedule, drink to thirst, run your race.',
  },

  // ── Rest ──────────────────────────────────────────────────────
  'Rest': {
    zone: 'Rest',
    headlineZoneRef: 'E',
    headlineOverride: () => ', ',
    steps: [],
    effort: 'Sleep, hydrate, gentle mobility if you want. Cross-train lightly only if you feel restless.',
    why: 'Rest is when your body absorbs the work and gets stronger. Take it.',
    todaysJob: 'Adaptation happens here. The work from this week lands while you\'re not moving. Skip the bonus walk or core session, let the body finish what we started.',
  },
};

// ── Realize a template with concrete paces ────────────────────────

function realizeStep(step: WorkoutStepTemplate, bands: FitnessBands): WorkoutStep {
  if (step.kind === 'simple') {
    return {
      kind: 'simple',
      name: step.name,
      duration: step.duration,
      pace: step.paceOverride ?? paceForZone(step.zoneRef, bands),
      zone: step.zoneLabel,
      hrTarget: fmtHrBand(hrZoneForPaceZone(step.zoneRef, bands.hrZones)),
    };
  }
  return {
    kind: 'loop',
    name: step.name,
    times: step.times,
    items: step.items.map((it) => ({
      verb: it.verb,
      duration: it.duration,
      pace: it.paceOverride ?? (it.zoneRef ? paceForZone(it.zoneRef, bands) : undefined),
      zone: it.zoneLabel,
      suffix: it.suffix,
      hrTarget: it.zoneRef ? fmtHrBand(hrZoneForPaceZone(it.zoneRef, bands.hrZones)) : null,
    })),
  };
}

function realizeTemplate(tpl: WorkoutTemplate, bands: FitnessBands): WorkoutDescription {
  const racePaceStr = paceForZone('race-pace', bands);
  const headline = tpl.headlineOverride
    ? tpl.headlineOverride(bands.paces, racePaceStr)
    : paceForZone(tpl.headlineZoneRef, bands);
  const todaysJob = typeof tpl.todaysJob === 'function' ? tpl.todaysJob(bands) : tpl.todaysJob;
  return {
    zone: tpl.zone,
    paceTarget: headline,
    steps: tpl.steps.map((s) => realizeStep(s, bands)),
    effort: tpl.effort,
    why: tpl.why,
    todaysJob,
  };
}

// ── Public API ────────────────────────────────────────────────────

const TYPE_FALLBACKS: Record<string, keyof typeof TEMPLATES> = {
  easy:     'Easy',
  recovery: 'Easy',
  long:     'Long',
  quality:  'Threshold · Cruise Intervals',
  race:     'AFC Half',
  rest:     'Rest',
};

/**
 * Resolve a workout label/type into a concrete description with paces
 * derived from the runner's fitness.
 *
 * @param label   - Plan-day label like "Threshold · HM Blocks"
 * @param type    - Plan-day type like "quality" / "easy"
 * @param fitness - Resolved fitness bundle. When omitted, falls back
 *                  to VDOT-45 default paces so callers that don't yet
 *                  thread fitness still render reasonable strings.
 */
export function describeWorkout(
  label: string,
  type: string,
  fitness?: ResolvedFitness | null,
): WorkoutDescription {
  const bands = bandsFromFitness(fitness ?? null);
  const tpl = TEMPLATES[label]
    ?? TEMPLATES[TYPE_FALLBACKS[type] ?? 'Easy']
    ?? TEMPLATES['Easy'];
  return realizeTemplate(tpl, bands);
}

/**
 * Map a real-plan workout (`type` + optional `subLabel`) to the
 * describeWorkout template key + the human display label. Shared by the
 * /api/overview enrichment and the /overview page's plan adapter so the
 * iPhone app and the web render identical labels off the same plan.
 * describeWorkout falls back by type when the key isn't an exact
 * template, so this only has to get close.
 */
export function describeKeyFromPlan(type: string, subLabel: string | null): string {
  const sub = (subLabel ?? '').trim();
  if (sub) {
    if (sub.includes('·') || sub.includes('+')) return sub;
    if (type === 'quality' || type === 'threshold' || type === 'tempo') return `Threshold · ${sub}`;
    return sub;
  }
  switch (type) {
    case 'easy':
    case 'recovery':
    case 'shakeout':         return 'Easy';
    case 'long':             return 'Long';
    case 'quality':
    case 'threshold':        return 'Threshold · Cruise Intervals';
    case 'interval':
    case 'vo2':              return 'Intervals';
    case 'mp':               return 'Marathon Pace';
    case 'race_week_tuneup': return 'Threshold · Cruise Intervals';
    case 'race':             return 'AFC Half';
    default:                 return 'Easy';
  }
}
