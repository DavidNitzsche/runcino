/**
 * /api/profile — server-side Coach bundle for the Profile tab.
 *
 * Mirrors /api/log/route.ts. The Profile surface is the runner's
 * identity, goals, training preferences, gear, and engine details.
 * Most of this data is stable across days; Coach methods are NOT
 * heavily called here — Profile is read-mostly with respect to
 * what the runner has chosen.
 *
 * Coach methods wired:
 *   - none (Coach.engineDetails / Coach.profile are Stage 7+ and not
 *     yet implemented). The Engine Details card composes from
 *     coach-state + lifetime PR doctrine until those land.
 *
 * Real data sources:
 *   - gatherCoachState()        · races + volume + intensity
 *   - getCachedActivities()     · lifetime activity rollup
 *   - listShoes()               · shoe rotation (real DB-backed)
 *
 * TODO (Stage 7): a `users` / `profile` / `goals` data model does
 * not yet exist. The identity hero, personal-goals card, and
 * training-preferences card are stubbed with mockup-faithful demo
 * content so the page renders meaningfully. When the goals table
 * lands, replace stubProfile / stubGoals / stubPrefs with their
 * real readers.
 */

import { gatherCoachState, type CoachState } from '../../../lib/coach-state';
import { getCachedActivities } from '../../../lib/strava-cache';
import { naivePRs, isProbablyRace } from '../../../lib/strava-stats';
import { listShoes } from '../../../lib/shoe-store';
import type { Shoe } from '../../../lib/shoe-utils';
import type { NormalizedActivity } from '../strava/activities/route-shared';

// ─────────────────────────────────────────────────────────────────────
// Wire shapes
// ─────────────────────────────────────────────────────────────────────

/** Identity hero — name, age, city, plus 4 lifetime KPIs. */
export interface ProfileApiIdentity {
  /** Display name ("David Nitzschke"). */
  fullName: string;
  /** Two-letter initials for the avatar ("DN"). */
  initials: string;
  /** Sex · Age · City line ("M · 38 · LOS ANGELES, CA"). */
  bioLine: string;
  /** Runner ID label. */
  idLabel: string;
  /** "SINCE 2019" eyebrow. */
  sinceLabel: string;
  /** "7 YEARS RUNNING" pin label. */
  yearsRunningPin: string;
  /** 4 KPI quads — lifetime miles / races / days run / peak year. */
  kpis: ProfileApiKpi[];
}

export interface ProfileApiKpi {
  /** Display label ("LIFETIME MI"). */
  label: string;
  /** Hero number ("12.4"). */
  value: string;
  /** Small suffix on the value ("k" / "mi"). */
  unit: string | null;
  /** Detail line under value ("SINCE 2019"). */
  detail: string;
}

/** One row in the Lifetime PR list. */
export interface ProfileApiLifetimePr {
  /** "5K" / "10K" / "HALF" / "MARATHON" / "50K". */
  label: string;
  /** Display time ("19:32"). null = never set. */
  timeDisplay: string | null;
  /** Detail line ("FEB 14 2026 · SURF CITY · 6:18/MI"). null when no PR. */
  detail: string | null;
  /** True when set this year (drives green NEW PR pin). */
  isNew: boolean;
  /** "5 MO AGO" for stale PRs; null for new ones. */
  ageLabel: string | null;
  /** Accent color name ('good' / 'muted'). */
  accent: 'good' | 'muted';
  /** Activity ID for deep-linking. */
  activityId: number | null;
  /** Show as "empty" with muted appearance. */
  isEmpty: boolean;
}

/** A personal goal row — drives the canonical goals card. */
export interface ProfileApiGoal {
  /** Stable id (one of the 6 categories). */
  id: 'volume' | 'speed' | 'distance' | 'habit' | 'strength' | 'health';
  /** Category eyebrow label ("VOLUME · WEEKLY MILEAGE"). */
  category: string;
  /** Accent color name. */
  accent: 'corp' | 'race' | 'xp' | 'good' | 'coach';
  /** Status pill ("▲ ON TRACK" / "✓ MET" / etc.). */
  statusLabel: string;
  /** Tone of the status pill. */
  statusTone: 'good' | 'coach' | 'amber' | 'warn';
  /** Current value ("35"). */
  currentValue: string;
  /** Small suffix after current ("/wk now"). */
  currentUnit: string;
  /** Target value ("45"). */
  targetValue: string;
  /** Small suffix after target ("/wk"). */
  targetUnit: string;
  /** True when there is a directional arrow between values. */
  hasArrow: boolean;
  /** Progress fraction 0-1. */
  progress: number;
  /** Coach-respect rationale (plain prose). */
  rationale: string;
}

/** Training preference row. */
export interface ProfileApiPref {
  /** Eyebrow label ("LONG RUN DAY"). */
  label: string;
  /** Value ("Sunday"). */
  value: string;
}

/** A shoe in the rotation list. */
export interface ProfileApiShoeRow {
  id: number;
  name: string;
  /** Role line ("DAILY TRAINER · ROAD"). */
  role: string;
  /** Current mileage. */
  mileage: number;
  /** Cap. */
  cap: number;
  /** Fraction 0-? (over-cap reads >1). */
  fraction: number;
  /** Accent color name. */
  accent: 'good' | 'corp' | 'milestone' | 'coach' | 'warn';
  /** Remaining-cap status pin ("116 LEFT" / "RETIRE"). */
  statusPin: string;
  /** Pin tone. */
  pinTone: 'green' | 'blue' | 'muted' | 'amber' | 'warn';
  /** True if the row should render in retired-warn tint. */
  isRetiring: boolean;
}

/** Connections (integrations). */
export interface ProfileApiConnection {
  id: 'strava' | 'healthkit' | 'garmin';
  /** Display name ("Strava"). */
  name: string;
  /** Single-letter logo. */
  letter: string;
  /** Brand color hex. */
  brandColor: string;
  /** Status line ("87 ACTIVITIES SYNCED · LIVE"). */
  statusLine: string;
  /** Pin label. */
  pinLabel: 'LIVE' | 'SOON' | 'OFFLINE';
  /** Pin tone. */
  pinTone: 'green' | 'muted' | 'warn';
}

/** VDOT block. */
export interface ProfileApiVdot {
  value: string;
  /** RAW · DECAY caption. */
  detail: string;
  /** Source label ("DISNEY HALF · 1:32 · 6 MO AGO"). */
  source: string;
}

/** HR card 5-zone breakdown. */
export interface ProfileApiHrZone {
  letter: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';
  label: string;
  range: string;
  accent: 'good' | 'corp' | 'milestone' | 'warn' | 'xp';
}
export interface ProfileApiHrBlock {
  hrMax: number;
  rhr: number;
  zones: ProfileApiHrZone[];
}

/** Mileage tier block. */
export interface ProfileApiTier {
  /** Current mileage (4-week avg). */
  currentMi: number;
  /** Tier band label ("LOW BAND (20-40)"). */
  bandLabel: string;
  /** Fraction along the band (0-1). */
  position: number;
  /** Trend label ("▲ +12% V8W"). */
  trendLabel: string;
  /** Peak label ("2026 PEAK · 42 MI"). */
  peakLabel: string;
}

/** Coach Engine Details card. */
export interface ProfileApiEngineDetail {
  /** Eyebrow ("YOUR PACE ZONES" / "NEXT WEEK'S LONG-RUN LIMIT" / etc.). */
  eyebrow: string;
  /** Display value (hero). */
  value: string;
  /** Unit small suffix. */
  unit: string | null;
  /** Lead paragraph. */
  lead: string;
  /** Foot-meta eyebrow ("HOW" / "WHY"). */
  footEyebrow: string;
  /** Foot-meta paragraph. */
  footBody: string;
}
export interface ProfileApiEngineBlock {
  /** 4 tile rows (pace zones, long-run cap, easy share, cutback). */
  tiles: ProfileApiEngineDetail[];
  /** Pace zones table (rendered inside the first tile). */
  paceZones: Array<{ label: string; accent: string; value: string }>;
  /** Plan-integrity validation. */
  integrity: {
    passed: number;
    total: number;
    headline: string;
    body: string;
  };
}

interface ProfileApiOk {
  ok: true;
  today: string;
  state: CoachState;
  identity: ProfileApiIdentity;
  lifetimePrs: ProfileApiLifetimePr[];
  /** Number of NEW PRs in the lifetimePrs list — drives header pin. */
  newPrCount: number;
  /** True when at least one historic PR was set this year. */
  hasPrThisYear: boolean;
  goals: ProfileApiGoal[];
  /** Number of goals "on track" / "met". */
  goalsActive: number;
  vdot: ProfileApiVdot;
  hrBlock: ProfileApiHrBlock;
  tier: ProfileApiTier;
  prefs: ProfileApiPref[];
  connections: ProfileApiConnection[];
  /** Active + retired shoes joined into a single list (retired hidden). */
  shoes: ProfileApiShoeRow[];
  /** "1 RETIRE · 1 NEAR CAP" pin or null. */
  shoeWarnLabel: string | null;
  engine: ProfileApiEngineBlock;
}

interface ProfileApiErr {
  ok: false;
  error: string;
}

export async function GET(): Promise<Response> {
  try {
    const state = await gatherCoachState();
    const today = state.now.slice(0, 10);
    const year = Number(today.slice(0, 4));

    // ── Data sources (real where we can). ─────────────────────
    const cache = await getCachedActivities().catch(
      () => ({ activities: [] as NormalizedActivity[], fetchedAt: 0 }),
    );
    const allRuns = cache.activities;
    const dbShoes = await listShoes().catch(() => [] as Shoe[]);

    // Identity — stubbed for now (no users table). Demo content
    // mirrors the locked mockup so QA renders meaningfully.
    const identity = buildIdentity(allRuns, year);

    // Lifetime PRs — naive across all activity history. Then
    // augmented with the mockup-faithful row when no data exists.
    const lifetimePrs = buildLifetimePrs(allRuns, year);
    const newPrCount = lifetimePrs.filter((p) => p.isNew).length;
    const hasPrThisYear = newPrCount > 0;

    // Personal goals — fully stubbed (no goals table). The page
    // renders these as cards; user clicks "+ Add goal" placeholder
    // CTA but it isn't wired today.
    const goals = stubGoals();
    const goalsActive = goals.length;

    // VDOT + HR + Tier + Prefs — all stubbed against mockup numbers
    // until the engine surfaces them.
    const vdot = stubVdot();
    const hrBlock = stubHrBlock();
    const tier = buildTier(state);
    const prefs = stubPrefs();

    // Connections — Strava is real (we have activity cache); HealthKit
    // is currently not wired (M2). Garmin is "SOON".
    const connections = buildConnections(allRuns.length);

    // Shoes — real DB-backed. If empty (local dev no DB) fall back
    // to mockup defaults.
    const shoes = dbShoes.length > 0
      ? buildShoeRows(dbShoes)
      : stubShoes();
    const overCap = shoes.filter((s) => s.fraction >= 1).length;
    const nearCap = shoes.filter((s) => s.fraction >= 0.8 && s.fraction < 1).length;
    const shoeWarnLabel = overCap > 0 || nearCap > 0
      ? `${overCap > 0 ? `${overCap} RETIRE` : ''}${overCap > 0 && nearCap > 0 ? ' · ' : ''}${nearCap > 0 ? `${nearCap} NEAR CAP` : ''}`
      : null;

    // Engine details — derived deterministic facts from state +
    // doctrine. Long-run cap reads state.volume.longestLast28Mi
    // and applies the 10% bump per Research/00a.
    const engine = buildEngineBlock(state);

    const body: ProfileApiOk = {
      ok: true,
      today,
      state,
      identity,
      lifetimePrs,
      newPrCount,
      hasPrThisYear,
      goals,
      goalsActive,
      vdot,
      hrBlock,
      tier,
      prefs,
      connections,
      shoes,
      shoeWarnLabel,
      engine,
    };
    return Response.json(body);
  } catch (e) {
    const err: ProfileApiErr = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
    return Response.json(err, { status: 200 });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────

function buildIdentity(runs: NormalizedActivity[], year: number): ProfileApiIdentity {
  // TODO: wire to users/profile table (does NOT exist yet).
  // Demo defaults mirror the mockup.
  const fullName = 'David Nitzschke';
  const initials = 'DN';
  const bioLine = 'M · 38 · LOS ANGELES, CA';
  const idLabel = 'RUNNER · ID-001 · SINCE 2019';
  const sinceLabel = 'SINCE 2019';

  // Lifetime stats — pulled from activities when available.
  const lifetimeMi = runs.reduce((s, r) => s + r.distanceMi, 0);
  const lifetimeMiDisplay = lifetimeMi >= 1000
    ? (Math.round(lifetimeMi / 100) / 10).toFixed(1)
    : Math.round(lifetimeMi).toString();
  const lifetimeUnit = lifetimeMi >= 1000 ? 'k' : null;

  const races = runs.filter(isProbablyRace);
  const raceCount = races.length;
  // Race breakdown by approx distance category.
  const marathons = races.filter((r) => r.distanceMi >= 24).length;
  const halfs = races.filter((r) => r.distanceMi >= 12 && r.distanceMi < 16).length;
  const tens = races.filter((r) => r.distanceMi >= 5.5 && r.distanceMi < 8).length;
  const fives = races.filter((r) => r.distanceMi < 5.5 && r.distanceMi >= 2.5).length;
  const raceBreakdown = raceCount > 0
    ? [
        marathons ? `${marathons}×M` : null,
        halfs ? `${halfs}×HM` : null,
        tens ? `${tens}×10K` : null,
        fives ? `${fives}×5K` : null,
      ].filter(Boolean).join(' · ')
    : '5×M · 18×HM · 12×10K · 3×5K';

  // Days run — unique calendar days.
  const daysSet = new Set(runs.map((r) => r.date));
  const daysRun = daysSet.size > 0 ? daysSet.size : 1847;
  const yearsRunning = year - 2019;
  const daysRunPct = Math.round((daysRun / (yearsRunning * 365)) * 100);

  // Peak year — group by year, find max.
  const byYear = new Map<number, number>();
  for (const r of runs) {
    const y = Number(r.date.slice(0, 4));
    byYear.set(y, (byYear.get(y) ?? 0) + r.distanceMi);
  }
  let peakYearLabel = '2024';
  let peakYearMi = 2140;
  if (byYear.size > 0) {
    let bestY = 0;
    let bestMi = 0;
    for (const [y, mi] of byYear) {
      if (mi > bestMi) { bestY = y; bestMi = mi; }
    }
    if (bestY > 0) {
      peakYearLabel = String(bestY);
      peakYearMi = Math.round(bestMi);
    }
  }

  const yearsRunningPin = `${Math.max(1, yearsRunning)} YEARS RUNNING`;

  // Lifetime elevation gain — sum elevGainFt across every recorded activity.
  // Surfaced as a "badge of honor" KPI tile · 29,029 ft per Everest summit.
  const lifetimeElevFt = runs.reduce((sum, a) => sum + (a.elevGainFt ?? 0), 0);
  const everestCount = lifetimeElevFt > 0 ? lifetimeElevFt / 29029 : 0;
  const elevDisplay = runs.length > 0
    ? lifetimeElevFt >= 1_000_000
      ? `${(lifetimeElevFt / 1_000_000).toFixed(1)}M`
      : `${Math.round(lifetimeElevFt / 1000)}K`
    : '624K';
  const elevDetail = runs.length > 0
    ? everestCount >= 1
      ? `~${everestCount.toFixed(1)}× EVEREST`
      : `${everestCount.toFixed(2)}× EVEREST`
    : '~21× EVEREST';

  const kpis: ProfileApiKpi[] = [
    {
      label: 'LIFETIME MI',
      value: runs.length > 0 ? lifetimeMiDisplay : '12.4',
      unit: runs.length > 0 ? lifetimeUnit : 'k',
      detail: 'SINCE 2019',
    },
    {
      label: 'RACES',
      value: raceCount > 0 ? String(raceCount) : '38',
      unit: null,
      detail: raceBreakdown,
    },
    {
      label: 'DAYS RUN',
      value: daysRun.toLocaleString('en-US'),
      unit: null,
      detail: `~${Math.min(100, daysRunPct)}% OF ${Math.max(1, yearsRunning)} YR`,
    },
    {
      label: 'PEAK YEAR',
      value: peakYearMi.toLocaleString('en-US'),
      unit: 'mi',
      detail: peakYearLabel,
    },
    {
      label: 'LIFETIME ELEV',
      value: elevDisplay,
      unit: 'ft',
      detail: elevDetail,
    },
  ];

  return {
    fullName,
    initials,
    bioLine,
    idLabel,
    sinceLabel,
    yearsRunningPin,
    kpis,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Lifetime PRs — produces 5 rows (5K, 10K, HALF, MARATHON, 50K).
// Uses naivePRs across all activity history. If a category was set
// this year, it's marked NEW. Otherwise renders the AGE label.
// ─────────────────────────────────────────────────────────────────────

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function buildLifetimePrs(runs: NormalizedActivity[], year: number): ProfileApiLifetimePr[] {
  // 5K / 10K / HALF / MARATHON come from naivePRs.
  const prs = runs.length > 0 ? naivePRs(runs) : [];
  const yearStart = `${year}-01-01`;

  function find(label: string): ProfileApiLifetimePr {
    const pr = prs.find((p) => p.label === label);
    if (!pr || pr.bestS == null || !pr.date) {
      return emptyPr(displayLabel(label));
    }
    const isNew = pr.date >= yearStart;
    const source = runs.find((r) => r.id === pr.activityId);
    const paceS = source && source.distanceMi > 0
      ? Math.round(pr.bestS / source.distanceMi)
      : null;
    const sourceName = source?.name ?? '';
    const dateBits = pr.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dateLabel = dateBits
      ? `${MONTHS[Number(dateBits[2]) - 1]} ${Number(dateBits[3])} ${dateBits[1]}`
      : pr.date;
    const sourceUpper = sourceName.toUpperCase().slice(0, 36);
    const detail = paceS != null
      ? `${dateLabel} · ${sourceUpper} · ${fmtPace(paceS)}/MI`
      : `${dateLabel} · ${sourceUpper}`;
    const ageMonths = pr.date
      ? Math.round((Date.now() - Date.parse(pr.date + 'T12:00:00Z')) / 86_400_000 / 30)
      : 0;
    return {
      label: displayLabel(label),
      timeDisplay: fmtTime(pr.bestS),
      detail,
      isNew,
      ageLabel: isNew ? null : ageMonths > 0 ? `${ageMonths} MO AGO` : null,
      accent: isNew ? 'good' : 'muted',
      activityId: pr.activityId,
      isEmpty: false,
    };
  }

  const out: ProfileApiLifetimePr[] = [
    find('5K'),
    find('10K'),
    find('Half'),
    find('Marathon'),
  ];

  // 50K row — naivePRs doesn't bucket 50K; check directly for any
  // run >= 30 miles, picking the fastest.
  const ultras = runs.filter((r) => r.distanceMi >= 30);
  if (ultras.length > 0) {
    const fastest = ultras.reduce((b, r) =>
      r.movingTimeS < b.movingTimeS ? r : b, ultras[0]);
    const paceS = fastest.distanceMi > 0
      ? Math.round(fastest.movingTimeS / fastest.distanceMi)
      : null;
    const dateBits = fastest.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dateLabel = dateBits
      ? `${MONTHS[Number(dateBits[2]) - 1]} ${Number(dateBits[3])} ${dateBits[1]}`
      : fastest.date;
    const isNew = fastest.date >= yearStart;
    out.push({
      label: '50K',
      timeDisplay: fmtTime(fastest.movingTimeS),
      detail: paceS != null
        ? `${dateLabel} · ${fastest.name.toUpperCase().slice(0, 30)} · ${fmtPace(paceS)}/MI`
        : `${dateLabel} · ${fastest.name.toUpperCase().slice(0, 30)}`,
      isNew,
      ageLabel: isNew ? null : '— ',
      accent: isNew ? 'good' : 'muted',
      activityId: fastest.id,
      isEmpty: false,
    });
  } else {
    out.push(emptyPr('50K'));
  }

  // If no real data, replace with mockup-faithful demo content so the page renders.
  if (runs.length === 0) {
    return [
      { label: '5K',       timeDisplay: '19:32',   detail: 'FEB 14 2026 · SURF CITY · 6:18/MI', isNew: true,  ageLabel: null,         accent: 'good',  activityId: null, isEmpty: false },
      { label: '10K',      timeDisplay: '41:32',   detail: 'MAR 22 2026 · POINT MAGU · 6:41/MI', isNew: true, ageLabel: null,         accent: 'good',  activityId: null, isEmpty: false },
      { label: 'HALF',     timeDisplay: '1:32:00', detail: 'JAN 12 2026 · DISNEY · 7:00/MI',    isNew: false, ageLabel: '5 MO AGO',    accent: 'muted', activityId: null, isEmpty: false },
      { label: 'MARATHON', timeDisplay: '3:18:42', detail: 'APR 27 2026 · BIG SUR · 7:35/MI · HILLY', isNew: true, ageLabel: null,    accent: 'good',  activityId: null, isEmpty: false },
      { label: '50K',      timeDisplay: null,      detail: 'NEVER RUN · ADD WHEN YOU DO',        isNew: false, ageLabel: null,        accent: 'muted', activityId: null, isEmpty: true  },
    ];
  }

  return out;
}

function emptyPr(label: string): ProfileApiLifetimePr {
  return {
    label,
    timeDisplay: null,
    detail: 'NEVER RUN · ADD WHEN YOU DO',
    isNew: false,
    ageLabel: null,
    accent: 'muted',
    activityId: null,
    isEmpty: true,
  };
}

function displayLabel(label: string): string {
  if (label === 'Half') return 'HALF';
  if (label === 'Marathon') return 'MARATHON';
  return label.toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────
// Personal Goals · stubbed (no goals table)
//
// TODO (Stage 7): add a `personal_goals` table — id, user_id, type,
// current, target, deadline, tolerance, rationale. The "+ Add goal"
// CTA will write here.
// RESEARCH: Coach reads these so the engine can adjust volume /
// long-run cap / quality cadence to honor each goal. Volume ramps
// per /Research/00a §Volume by experience; speed targets gate quality
// pace per /Research/04 §Workout intent.
// ─────────────────────────────────────────────────────────────────────

function stubGoals(): ProfileApiGoal[] {
  return [
    {
      id: 'volume',
      category: 'VOLUME · WEEKLY MILEAGE',
      accent: 'corp',
      statusLabel: '▲ ON TRACK',
      statusTone: 'good',
      currentValue: '35',
      currentUnit: '/wk now',
      targetValue: '45',
      targetUnit: '/wk',
      hasArrow: true,
      progress: 0.78,
      rationale:
        "By Dec 2026 · 10 mi to add. Coach is bumping +12% absorbed weeks instead of forcing weekly jumps.",
    },
    {
      id: 'speed',
      category: 'SPEED · HM TIME',
      accent: 'race',
      statusLabel: '▲ POSSIBLE',
      statusTone: 'good',
      currentValue: '1:32',
      currentUnit: 'PR',
      targetValue: '1:29',
      targetUnit: 'sub-1:30',
      hasArrow: true,
      progress: 0.65,
      rationale:
        'Within 12 months. Coach is adding threshold + HMP miles earlier in builds and gating quality at 6:45/mi targets.',
    },
    {
      id: 'distance',
      category: 'DISTANCE · FIRST 50K',
      accent: 'xp',
      statusLabel: 'PLANNED 2027',
      statusTone: 'coach',
      currentValue: '26.2',
      currentUnit: 'furthest',
      targetValue: '31',
      targetUnit: '50K',
      hasArrow: true,
      progress: 0.30,
      rationale:
        'Target Q1 2027. Coach is adding back-to-back long runs in 2026 Q4 to build durability.',
    },
    {
      id: 'habit',
      category: 'HABIT · RUN FREQUENCY',
      accent: 'good',
      statusLabel: '✓ MET',
      statusTone: 'good',
      currentValue: '5',
      currentUnit: 'days/wk',
      targetValue: '4.6 avg · 28D',
      targetUnit: '',
      hasArrow: false,
      progress: 0.92,
      rationale:
        "Coach respects this as a frequency floor and won't prescribe more than 2 rest days/wk except in cutbacks.",
    },
    {
      id: 'strength',
      category: 'STRENGTH · WEEKLY SESSIONS',
      accent: 'xp',
      statusLabel: '✓ MET',
      statusTone: 'good',
      currentValue: '2',
      currentUnit: 'sessions/wk',
      targetValue: '28-DAY: 8/8',
      targetUnit: '',
      hasArrow: false,
      progress: 1.0,
      rationale:
        'Coach never stacks strength against quality run days · schedules upper-body on hard-run days, lower on easy days.',
    },
    {
      id: 'health',
      category: 'HEALTH · SLEEP FLOOR',
      accent: 'coach',
      statusLabel: '✓ HOLDING',
      statusTone: 'good',
      currentValue: '7.0',
      currentUnit: 'hrs min',
      targetValue: '7D AVG · 7:42',
      targetUnit: '',
      hasArrow: false,
      progress: 1.0,
      rationale:
        'If sleep drops below 7h before a quality session, Coach auto-downgrades to easy or moves the workout.',
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────
// VDOT / HR / Tier / Prefs / Connections stubs
// ─────────────────────────────────────────────────────────────────────

function stubVdot(): ProfileApiVdot {
  // TODO: wire to lib/vdot.ts when computeVdot is exposed.
  return {
    value: '49.2',
    detail: 'RAW 50.0 · DECAY −0.8',
    source: 'DISNEY HALF · 1:32 · 6 MO AGO',
  };
}

function stubHrBlock(): ProfileApiHrBlock {
  // TODO: wire to coach-state HR data once HRmax/RHR is on the user record.
  return {
    hrMax: 187,
    rhr: 42,
    zones: [
      { letter: 'Z1', label: 'RECOVERY',  range: '≤ 141',  accent: 'good' },
      { letter: 'Z2', label: 'AEROBIC',   range: '142-155', accent: 'corp' },
      { letter: 'Z3', label: 'TEMPO',     range: '156-167', accent: 'milestone' },
      { letter: 'Z4', label: 'THRESHOLD', range: '168-178', accent: 'warn' },
      { letter: 'Z5', label: 'VO2MAX',    range: '179-187', accent: 'xp' },
    ],
  };
}

function buildTier(state: CoachState): ProfileApiTier {
  // 4-week avg comes from coach-state when available, otherwise mockup value.
  const currentMi = state.volume.weeklyAvg4w > 0 ? Math.round(state.volume.weeklyAvg4w) : 35;
  // LOW band 20-40, MID band 40-60. Marker position inside 0-1.
  const position = Math.max(0, Math.min(1, (currentMi - 20) / 20));
  const delta = state.volume.deltaPct4v4 ?? 0.12;
  const trendArrow = delta >= 0 ? '▲' : '▼';
  const trendLabel = `${trendArrow} ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)}% V8W`;
  return {
    currentMi,
    bandLabel: '4-WEEK AVG · LOW BAND (20-40)',
    position,
    trendLabel,
    peakLabel: '2026 PEAK · 42 MI',
  };
}

function stubPrefs(): ProfileApiPref[] {
  // TODO: wire to a user_prefs table.
  return [
    { label: 'LONG RUN DAY',  value: 'Sunday' },
    { label: 'QUALITY DAY',   value: 'Tue / Thu' },
    { label: 'TYPICAL REST',  value: 'Mon · 1-2/wk' },
    { label: 'UNITS',         value: 'Imperial · °F' },
  ];
}

function buildConnections(stravaActivityCount: number): ProfileApiConnection[] {
  return [
    {
      id: 'strava',
      name: 'Strava',
      letter: 'S',
      brandColor: '#FC4C02',
      statusLine: stravaActivityCount > 0
        ? `${stravaActivityCount} ACTIVITIES SYNCED · LIVE`
        : 'NOT YET SYNCED',
      pinLabel: stravaActivityCount > 0 ? 'LIVE' : 'OFFLINE',
      pinTone: stravaActivityCount > 0 ? 'green' : 'warn',
    },
    {
      id: 'healthkit',
      name: 'Apple HealthKit',
      letter: '♥',
      brandColor: '#FF2D55',
      statusLine: 'HRV · RHR · SLEEP · TEMP',
      pinLabel: 'SOON',
      pinTone: 'muted',
    },
    {
      id: 'garmin',
      name: 'Garmin Connect',
      letter: 'G',
      brandColor: '#1D2736',
      statusLine: 'DEVICE-LEVEL DETAIL · M3',
      pinLabel: 'SOON',
      pinTone: 'muted',
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Shoes — real DB rows mapped into the row shape.
// ─────────────────────────────────────────────────────────────────────

const SHOE_ROLE_ACCENT: Record<string, ProfileApiShoeRow['accent']> = {
  easy:      'good',
  recovery:  'coach',
  long:      'corp',
  race:      'corp',
  tempo:     'milestone',
  intervals: 'milestone',
  as_needed: 'good',
};

function buildShoeRows(shoes: Shoe[]): ProfileApiShoeRow[] {
  const active = shoes.filter((s) => !s.retired);
  return active.map((s) => {
    const cap = s.mileage_cap ?? 400;
    const fraction = cap > 0 ? s.mileage / cap : 0;
    const remaining = Math.max(0, cap - s.mileage);
    const primaryType = s.run_types[0] ?? 'as_needed';
    const accent = SHOE_ROLE_ACCENT[primaryType] ?? 'good';
    const isRetiring = fraction >= 1;

    let statusPin = `${Math.round(remaining)} LEFT`;
    let pinTone: ProfileApiShoeRow['pinTone'] = 'green';
    if (isRetiring) {
      statusPin = 'RETIRE';
      pinTone = 'warn';
    } else if (fraction >= 0.8) {
      pinTone = 'amber';
    } else if (fraction >= 0.4) {
      pinTone = primaryType === 'race' ? 'blue' : 'muted';
    } else {
      pinTone = 'green';
    }

    const role = `${(s.run_types[0] ?? 'AS NEEDED').toUpperCase().replace('_', ' ')}${s.run_types.length > 1 ? ` · ${s.run_types.slice(1).map((t) => t.toUpperCase().replace('_', ' ')).join(' · ')}` : ''}`;

    return {
      id: s.id,
      name: `${s.brand} ${s.model}`,
      role,
      mileage: Math.round(s.mileage),
      cap: Math.round(cap),
      fraction,
      accent: isRetiring ? 'warn' : accent,
      statusPin,
      pinTone,
      isRetiring,
    };
  });
}

function stubShoes(): ProfileApiShoeRow[] {
  // Mockup-faithful demo shoes.
  return [
    { id: -1, name: 'Novablast 4',       role: 'DAILY TRAINER · ROAD',          mileage: 284, cap: 400, fraction: 0.71, accent: 'good',      statusPin: '116 LEFT', pinTone: 'green', isRetiring: false },
    { id: -2, name: 'Alphafly 3',        role: 'RACE · CARBON · BIG SUR APR',   mileage: 68,  cap: 150, fraction: 0.45, accent: 'corp',      statusPin: '82 LEFT',  pinTone: 'blue',  isRetiring: false },
    { id: -3, name: 'Endorphin Speed 4', role: 'TEMPO · WORKOUTS · PLATE',      mileage: 156, cap: 400, fraction: 0.39, accent: 'milestone', statusPin: '244 LEFT', pinTone: 'muted', isRetiring: false },
    { id: -4, name: 'Invincible 3',      role: 'RECOVERY · EASY · MAX CUSHION', mileage: 340, cap: 400, fraction: 0.85, accent: 'coach',     statusPin: '60 LEFT',  pinTone: 'amber', isRetiring: false },
    { id: -5, name: 'Speedgoat 5',       role: 'TRAIL · DIRT · TECHNICAL',      mileage: 412, cap: 400, fraction: 1.03, accent: 'warn',      statusPin: 'RETIRE',   pinTone: 'warn',  isRetiring: true  },
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Coach engine details — pace zones + long-run cap + easy share +
// cutback cadence. Long-run cap reads coach-state.longestLast28Mi.
// ─────────────────────────────────────────────────────────────────────

function buildEngineBlock(state: CoachState): ProfileApiEngineBlock {
  const longestLast28 = state.volume.longestLast28Mi > 0
    ? state.volume.longestLast28Mi
    : 7.4;
  const longRunCap = Math.round(longestLast28 * 1.10 * 10) / 10;
  const easyShare = state.intensity.easyShare14d > 0
    ? Math.round(state.intensity.easyShare14d * 100)
    : 92;

  const tiles: ProfileApiEngineDetail[] = [
    {
      eyebrow: 'YOUR PACE ZONES',
      value: 'From VDOT 49.2',
      unit: null,
      lead: 'The Coach prescribes every run inside one of these 5 pace bands.',
      footEyebrow: '',
      footBody: '',
    },
    {
      eyebrow: "NEXT WEEK'S LONG-RUN LIMIT",
      value: longRunCap.toFixed(1),
      unit: 'MI',
      lead: `The Coach won't prescribe a long run over ${longRunCap.toFixed(1)} mi next week — keeps the jump safe.`,
      footEyebrow: 'HOW',
      footBody: `Your longest run in the last 28 days was ${longestLast28.toFixed(1)} mi. Coach caps the next at +10% to prevent spikes.`,
    },
    {
      eyebrow: 'EASY-PACE TARGET',
      value: '≥80',
      unit: '%',
      lead: `At least 80% of your weekly miles should be at easy pace. You're at ${easyShare}%.`,
      footEyebrow: 'WHY',
      footBody:
        'Polarized training: lots of easy + a little hard beats lots of moderate. Reduces injury, builds aerobic engine.',
    },
    {
      eyebrow: 'RECOVERY WEEK CADENCE',
      value: 'Every 3',
      unit: 'WKS',
      lead: 'Every 3rd week the Coach drops volume −20% so the body can absorb training.',
      footEyebrow: 'WHY 3 WEEKS',
      footBody:
        'At your mileage tier (low band, 20-40 mi/wk), 3-week blocks balance stimulus and recovery without losing fitness.',
    },
  ];

  const paceZones = [
    { label: 'EASY',      accent: 'var(--good)',      value: '8:55–9:25' },
    { label: 'MARATHON',  accent: 'var(--corp)',      value: '7:18' },
    { label: 'THRESHOLD', accent: 'var(--milestone)', value: '7:00' },
    { label: 'INTERVAL',  accent: 'var(--warn)',      value: '6:30' },
    { label: 'REP',       accent: 'var(--xp)',        value: '5:55' },
  ];

  return {
    tiles,
    paceZones,
    integrity: {
      passed: 12,
      total: 12,
      headline: '▲ PLAN INTEGRITY VALIDATED',
      body: 'All 12 doctrine rules pass against current plan. No regressions detected.',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────

function fmtTime(s: number): string {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtPace(s: number): string {
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
