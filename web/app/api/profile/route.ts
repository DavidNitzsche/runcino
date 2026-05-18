/**
 * /api/profile — server-side Coach bundle for the Profile tab.
 *
 * Mirrors /api/log/route.ts. The Profile surface is the runner's
 * identity, goals, training preferences, gear, and engine details.
 * Most of this data is stable across days; Coach methods are NOT
 * heavily called here — Profile is read-mostly with respect to
 * what the runner has chosen.
 *
 * Real data sources:
 *   - gatherCoachState()        · races + volume + intensity
 *   - getCachedActivities()     · lifetime activity rollup
 *   - listShoes()               · shoe rotation (real DB-backed)
 *   - listPersonalGoals()       · personal_goals table
 *   - getProfile() / getUserPrefs() · profile + prefs tables
 *   - vdotSnapshot(state)       · VDOT picture from races
 *
 * No demo / mockup fallbacks remain. When a signal is unavailable,
 * the wire shape returns null / [] / honest defaults and the page
 * renders "NO DATA YET" or "—".
 */

import { gatherCoachState, type CoachState } from '../../../lib/coach-state';
import { getCachedActivities } from '../../../lib/strava-cache';
import { naivePRs, isProbablyRace } from '../../../lib/strava-stats';
import { listShoes } from '../../../lib/shoe-store';
import type { Shoe } from '../../../lib/shoe-utils';
import type { NormalizedActivity } from '../strava/activities/route-shared';
import { getProfile, type ProfileRow } from '../../../lib/profile-store';
import { getUserPrefs, type PrefsRow } from '../../../lib/prefs-store';
import { listPersonalGoals, type GoalRow } from '../../../lib/goals-store';
import { vdotSnapshot } from '../../../lib/vdot';
import { gatherFreshness } from '../../../lib/freshness';
import type { FreshnessMap } from '../../../lib/freshness-types';

// ─────────────────────────────────────────────────────────────────────
// Wire shapes
// ─────────────────────────────────────────────────────────────────────

/** Identity hero — name, age, city, plus 4 lifetime KPIs. */
export interface ProfileApiIdentity {
  /** Display name. null when no profile row exists. */
  fullName: string | null;
  /** Two-letter initials for the avatar. null when no name. */
  initials: string | null;
  /** Sex · Age · City line. null when none of those fields are set. */
  bioLine: string | null;
  /** Runner ID label. */
  idLabel: string;
  /** "SINCE 2019" eyebrow — null when no since_year. */
  sinceLabel: string | null;
  /** "7 YEARS RUNNING" pin label — null when no since_year. */
  yearsRunningPin: string | null;
  /** 4 KPI quads — lifetime miles / races / days run / peak year. */
  kpis: ProfileApiKpi[];
}

export interface ProfileApiKpi {
  /** Display label ("LIFETIME MI"). */
  label: string;
  /** Hero number ("12.4"). "—" when no data. */
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
  /** Value ("Sunday"). null when no preference set and no default. */
  value: string | null;
  /** True when value is an app-wide default (not user-chosen). */
  isDefault: boolean;
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

/** VDOT block. Every field is nullable — when there's no race history
 *  to derive a VDOT from, the entire block reads "NO DATA YET". */
export interface ProfileApiVdot {
  /** VDOT value (string for display). null when uninferable. */
  value: string | null;
  /** RAW · DECAY caption. null when no VDOT. */
  detail: string | null;
  /** Source label ("DISNEY HALF · 1:32 · 6 MO AGO"). null when no VDOT. */
  source: string | null;
  /** ISO date of the source race. null when none. */
  sourceDate: string | null;
}

/** HR card 5-zone breakdown. */
export interface ProfileApiHrZone {
  letter: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';
  label: string;
  range: string;
  accent: 'good' | 'corp' | 'milestone' | 'warn' | 'xp';
}
export interface ProfileApiHrBlock {
  /** Measured HRmax in bpm. null when not on profile. */
  hrMaxMeasured: number | null;
  /** Tanaka-estimate HRmax from age (208 − 0.7·age). null when no age. */
  hrMaxEstimate: number | null;
  /** Resting HR in bpm. Always null today (HealthKit M2). */
  rhr: number | null;
  /** True when this block has anything to show. */
  hasAny: boolean;
  /** 5-zone breakdown — empty when no HR signal at all. */
  zones: ProfileApiHrZone[];
}

/** Mileage tier block. */
export interface ProfileApiTier {
  /** Current mileage (4-week avg). null when 0. */
  currentMi: number | null;
  /** Tier band label ("LOW BAND (20-40)"). */
  bandLabel: string;
  /** Fraction along the band (0-1). */
  position: number;
  /** Trend label ("▲ +12% V8W"). null when no comparable signal. */
  trendLabel: string | null;
  /** Peak label ("2026 PEAK · 42 MI") or "NO PEAK DATA YET". */
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
  /** Pace zones table (rendered inside the first tile). Empty when
   *  no VDOT signal — UI surfaces "NO DATA YET". */
  paceZones: Array<{ label: string; accent: string; value: string }>;
  /** Plan-integrity validation. Null when the engine doesn't yet
   *  expose a real validation surface — UI renders NO DATA YET. */
  integrity: {
    passed: number;
    total: number;
    headline: string;
    body: string;
  } | null;
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
  /** True when no user_prefs row exists — UI surfaces "Using defaults". */
  prefsAreDefaults: boolean;
  connections: ProfileApiConnection[];
  /** Active + retired shoes joined into a single list (retired hidden). */
  shoes: ProfileApiShoeRow[];
  /** "1 RETIRE · 1 NEAR CAP" pin or null. */
  shoeWarnLabel: string | null;
  engine: ProfileApiEngineBlock;
  /** Per-signal freshness map — drives the "Coach is watching" UI
   *  strip. See lib/freshness.ts for budgets. */
  freshness: FreshnessMap;
  /** User-chosen brand accent (`#RRGGBB`). null = default Runcino blue. */
  accentColor: string | null;
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
    const [cache, dbShoes, profileRow, prefsRow, goalRows] = await Promise.all([
      getCachedActivities().catch(
        () => ({ activities: [] as NormalizedActivity[], fetchedAt: 0 }),
      ),
      listShoes().catch(() => [] as Shoe[]),
      getProfile().catch(() => null as ProfileRow | null),
      getUserPrefs().catch(() => null as PrefsRow | null),
      listPersonalGoals().catch(() => [] as GoalRow[]),
    ]);
    const allRuns = cache.activities;

    const identity = buildIdentity(allRuns, year, profileRow);

    // Lifetime PRs — naive across all activity history. Empty when no
    // runs are loaded; the page renders "No PRs logged yet".
    const lifetimePrs = buildLifetimePrs(allRuns, year);
    const newPrCount = lifetimePrs.filter((p) => p.isNew && !p.isEmpty).length;
    const hasPrThisYear = newPrCount > 0;

    // Personal goals — DB-backed. Empty when no rows.
    const goals = goalRows.map(goalRowToApi);
    const goalsActive = goals.length;

    // VDOT — real coach signal. Returns null block when state has no
    // valid recent race.
    const vdot = buildVdot(state);

    // HR — profile-backed for measured HRmax; Tanaka estimate from age.
    // RHR + actual HRmax require HealthKit (M2) → null today.
    const hrBlock = buildHrBlock(profileRow);

    const tier = buildTier(state, year);

    // Prefs — DB-backed. App-wide defaults surface when nothing logged.
    const { prefs, prefsAreDefaults } = buildPrefs(prefsRow);

    // Connections — Strava is real (we have activity cache); HealthKit
    // is currently not wired (M2). Garmin is "SOON".
    const connections = buildConnections(allRuns.length);

    // Shoes — real DB-backed. Empty list when no rows (page renders
    // "no shoes logged" empty state).
    const shoes = buildShoeRows(dbShoes);
    const overCap = shoes.filter((s) => s.fraction >= 1).length;
    const nearCap = shoes.filter((s) => s.fraction >= 0.8 && s.fraction < 1).length;
    const shoeWarnLabel = overCap > 0 || nearCap > 0
      ? `${overCap > 0 ? `${overCap} RETIRE` : ''}${overCap > 0 && nearCap > 0 ? ' · ' : ''}${nearCap > 0 ? `${nearCap} NEAR CAP` : ''}`
      : null;

    // Engine details — derived deterministic facts from state +
    // doctrine. Long-run cap reads state.volume.longestLast28Mi
    // and applies the 10% bump per Research/00a.
    const engine = buildEngineBlock(state, vdot);

    const freshness = await gatherFreshness({ state });

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
      prefsAreDefaults,
      connections,
      shoes,
      shoeWarnLabel,
      engine,
      freshness,
      accentColor: profileRow?.accent_color ?? null,
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

function buildIdentity(
  runs: NormalizedActivity[],
  year: number,
  profile: ProfileRow | null,
): ProfileApiIdentity {
  const fullName = profile?.full_name?.trim() || null;
  const initials = fullName
    ? fullName
        .split(/\s+/)
        .map((p) => p.charAt(0).toUpperCase())
        .slice(0, 2)
        .join('') || null
    : null;

  const bioBits: string[] = [];
  if (profile?.sex)  bioBits.push(profile.sex);
  if (profile?.age != null) bioBits.push(String(profile.age));
  if (profile?.city) bioBits.push(profile.city.toUpperCase());
  const bioLine = bioBits.length > 0 ? bioBits.join(' · ') : null;

  const sinceYear = profile?.since_year ?? null;
  const sinceLabel = sinceYear ? `SINCE ${sinceYear}` : null;
  const yearsRunning = sinceYear ? Math.max(0, year - sinceYear) : null;
  const yearsRunningPin = yearsRunning != null && yearsRunning > 0
    ? `${yearsRunning} YEAR${yearsRunning === 1 ? '' : 'S'} RUNNING`
    : null;

  const runnerIdBits: string[] = [];
  runnerIdBits.push(profile?.runner_id?.toUpperCase() || 'RUNNER');
  if (sinceLabel) runnerIdBits.push(sinceLabel);
  const idLabel = runnerIdBits.join(' · ');

  // Lifetime stats — pulled from activities when available.
  const lifetimeMi = runs.reduce((s, r) => s + r.distanceMi, 0);
  const lifetimeMiDisplay = lifetimeMi >= 1000
    ? (Math.round(lifetimeMi / 100) / 10).toFixed(1)
    : Math.round(lifetimeMi).toString();
  const lifetimeUnit = lifetimeMi >= 1000 ? 'k' : (runs.length > 0 ? 'mi' : null);

  const races = runs.filter(isProbablyRace);
  const raceCount = races.length;
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
    : 'NO RACES LOGGED';

  const daysSet = new Set(runs.map((r) => r.date));
  const daysRun = daysSet.size;
  const daysRunPct = yearsRunning && yearsRunning > 0
    ? Math.min(100, Math.round((daysRun / (yearsRunning * 365)) * 100))
    : null;
  const daysRunDetail = daysRunPct != null
    ? `~${daysRunPct}% OF ${yearsRunning} YR`
    : daysRun > 0
      ? `${daysRun} UNIQUE DAYS`
      : 'NO DATA YET';

  // Peak year — group by year, find max.
  const byYear = new Map<number, number>();
  for (const r of runs) {
    const y = Number(r.date.slice(0, 4));
    byYear.set(y, (byYear.get(y) ?? 0) + r.distanceMi);
  }
  let peakYearLabel: string | null = null;
  let peakYearMi = 0;
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

  // Lifetime elevation gain — sum elevGainFt across every recorded activity.
  const lifetimeElevFt = runs.reduce((sum, a) => sum + (a.elevGainFt ?? 0), 0);
  const everestCount = lifetimeElevFt > 0 ? lifetimeElevFt / 29029 : 0;
  const elevDisplay = lifetimeElevFt > 0
    ? lifetimeElevFt >= 1_000_000
      ? `${(lifetimeElevFt / 1_000_000).toFixed(1)}M`
      : `${Math.round(lifetimeElevFt / 1000)}K`
    : '—';
  const elevDetail = lifetimeElevFt > 0
    ? everestCount >= 1
      ? `~${everestCount.toFixed(1)}× EVEREST`
      : `${everestCount.toFixed(2)}× EVEREST`
    : 'NO DATA YET';

  const kpis: ProfileApiKpi[] = [
    {
      label: 'LIFETIME MI',
      value: runs.length > 0 ? lifetimeMiDisplay : '—',
      unit: runs.length > 0 ? lifetimeUnit : null,
      detail: sinceLabel ?? (runs.length > 0 ? 'ALL TIME' : 'NO DATA YET'),
    },
    {
      label: 'RACES',
      value: raceCount > 0 ? String(raceCount) : '—',
      unit: null,
      detail: raceBreakdown,
    },
    {
      label: 'DAYS RUN',
      value: daysRun > 0 ? daysRun.toLocaleString('en-US') : '—',
      unit: null,
      detail: daysRunDetail,
    },
    {
      label: 'PEAK YEAR',
      value: peakYearLabel != null && peakYearMi > 0 ? peakYearMi.toLocaleString('en-US') : '—',
      unit: peakYearMi > 0 ? 'mi' : null,
      detail: peakYearLabel ?? 'NO DATA YET',
    },
    {
      label: 'LIFETIME ELEV',
      value: elevDisplay,
      unit: lifetimeElevFt > 0 ? 'ft' : null,
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
// No demo fallback — when there's no race history, every row is empty.
// ─────────────────────────────────────────────────────────────────────

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function buildLifetimePrs(runs: NormalizedActivity[], year: number): ProfileApiLifetimePr[] {
  const raceRuns = runs.filter(isProbablyRace);
  const prs = raceRuns.length > 0 ? naivePRs(raceRuns) : [];
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

  return [
    find('5K'),
    find('10K'),
    find('Half'),
    find('Marathon'),
  ];
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
// Personal Goals · real DB rows → wire shape
//
// `personal_goals` stores the raw fields (target/current/etc. as strings
// chosen by the runner). The wire shape adds presentation: accent
// colors, status pills, progress fractions. Status defaults to "ACTIVE"
// until we run a status-evaluator against state — that lives in Coach
// engine territory and will land separately.
// ─────────────────────────────────────────────────────────────────────

const GOAL_CATEGORY_LABELS: Record<GoalRow['goal_type'], string> = {
  volume:   'VOLUME · WEEKLY MILEAGE',
  speed:    'SPEED · RACE TIME',
  distance: 'DISTANCE · NEXT MILESTONE',
  habit:    'HABIT · RUN FREQUENCY',
  strength: 'STRENGTH · WEEKLY SESSIONS',
  health:   'HEALTH · SLEEP FLOOR',
};

const GOAL_ACCENTS: Record<GoalRow['goal_type'], ProfileApiGoal['accent']> = {
  volume:   'corp',
  speed:    'race',
  distance: 'xp',
  habit:    'good',
  strength: 'xp',
  health:   'coach',
};

const GOAL_UNITS: Record<GoalRow['goal_type'], { current: string; target: string }> = {
  volume:   { current: '/wk now', target: '/wk' },
  speed:    { current: 'now',     target: 'goal' },
  distance: { current: 'now',     target: '' },
  habit:    { current: 'days/wk', target: '' },
  strength: { current: 'sess/wk', target: '' },
  health:   { current: 'hrs',     target: '' },
};

function goalRowToApi(row: GoalRow): ProfileApiGoal {
  const accent = GOAL_ACCENTS[row.goal_type];
  const units = GOAL_UNITS[row.goal_type];
  const hasCurrent = row.current != null && row.current.trim().length > 0;
  // Status: until we evaluate per-goal progress we mark goals as
  // "ACTIVE". Engine will surface ON TRACK / MET / BEHIND later.
  return {
    id: row.goal_type,
    category: GOAL_CATEGORY_LABELS[row.goal_type],
    accent,
    statusLabel: 'ACTIVE',
    statusTone: 'coach',
    currentValue: hasCurrent ? (row.current ?? '') : '—',
    currentUnit: hasCurrent ? units.current : '',
    targetValue: row.target,
    targetUnit: units.target,
    hasArrow: hasCurrent,
    progress: 0,
    rationale: row.rationale?.trim() || 'Coach reads this goal when scheduling weeks.',
  };
}

// ─────────────────────────────────────────────────────────────────────
// VDOT — derived from coach state's race history.
// ─────────────────────────────────────────────────────────────────────

function buildVdot(state: CoachState): ProfileApiVdot {
  const snap = vdotSnapshot(state);
  if (!snap) {
    return {
      value: null,
      detail: null,
      source: null,
      sourceDate: null,
    };
  }
  const r = snap.source;
  const monthsAgo = Math.max(0, Math.round(r.daysAgo / 30));
  const ageLabel = monthsAgo > 0 ? `${monthsAgo} MO AGO` : 'RECENT';
  const distLabel = distanceLabel(r.distanceMi);
  const finishLabel = fmtTime(r.timeS);
  const nameUpper = r.name.toUpperCase().slice(0, 28);
  return {
    value: snap.vdot.toFixed(1),
    detail: `From ${distLabel} race`,
    source: `${nameUpper} · ${finishLabel} · ${ageLabel}`,
    sourceDate: r.date,
  };
}

function distanceLabel(distMi: number): string {
  if (Math.abs(distMi - 3.107) / 3.107 < 0.05) return '5K';
  if (Math.abs(distMi - 6.214) / 6.214 < 0.05) return '10K';
  if (Math.abs(distMi - 9.321) / 9.321 < 0.05) return '15K';
  if (Math.abs(distMi - 13.109) / 13.109 < 0.05) return 'HALF';
  if (Math.abs(distMi - 26.219) / 26.219 < 0.05) return 'MARATHON';
  return `${distMi.toFixed(1)} MI`;
}

// ─────────────────────────────────────────────────────────────────────
// HR block — Tanaka HRmax estimate from age. RHR + measured HRmax
// require HealthKit (M2) → null today.
// ─────────────────────────────────────────────────────────────────────

function buildHrBlock(profile: ProfileRow | null): ProfileApiHrBlock {
  // Tanaka et al. 2001 — HRmax = 208 − 0.7·age. Population-level
  // estimate; individual variance is ~10 bpm so this is a STARTING
  // point, not a replacement for a measured max.
  const hrMaxEstimate = profile?.age != null && profile.age > 0
    ? Math.round(208 - 0.7 * profile.age)
    : null;
  const hrMaxMeasured = profile?.hrmax ?? null;
  // RHR requires HealthKit or manual entry — not on the profile row
  // path today. The `profile.rhr` column exists for forward-compat.
  const rhr = profile?.rhr ?? null;

  const effectiveHrMax = hrMaxMeasured ?? hrMaxEstimate;
  const hasAny = effectiveHrMax != null || rhr != null;

  // Compute 5 zones only when we have an effective HRmax. Zone bounds
  // follow the standard %-of-max bands (Friel/Daniels):
  //   Z1 ≤75%  Z2 76–82%  Z3 83–89%  Z4 90–94%  Z5 95–100%
  const zones: ProfileApiHrZone[] = [];
  if (effectiveHrMax != null) {
    const pct = (p: number) => Math.round(effectiveHrMax * p);
    zones.push(
      { letter: 'Z1', label: 'RECOVERY',  range: `≤ ${pct(0.75)}`,                accent: 'good' },
      { letter: 'Z2', label: 'AEROBIC',   range: `${pct(0.76)}-${pct(0.82)}`,     accent: 'corp' },
      { letter: 'Z3', label: 'TEMPO',     range: `${pct(0.83)}-${pct(0.89)}`,     accent: 'milestone' },
      { letter: 'Z4', label: 'THRESHOLD', range: `${pct(0.90)}-${pct(0.94)}`,     accent: 'warn' },
      { letter: 'Z5', label: 'VO2MAX',    range: `${pct(0.95)}-${effectiveHrMax}`, accent: 'xp' },
    );
  }

  return {
    hrMaxMeasured,
    hrMaxEstimate,
    rhr,
    hasAny,
    zones,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Mileage tier — straight read of state.volume.
// ─────────────────────────────────────────────────────────────────────

function buildTier(state: CoachState, year: number): ProfileApiTier {
  const weeklyAvg = state.volume.weeklyAvg4w;
  const currentMi = weeklyAvg > 0 ? Math.round(weeklyAvg) : null;
  // LOW band 20-40, MID band 40-60. Marker position inside 0-1.
  const position = currentMi != null
    ? Math.max(0, Math.min(1, (currentMi - 20) / 20))
    : 0;
  const delta = state.volume.deltaPct4v4;
  const trendLabel = delta != null
    ? `${delta >= 0 ? '▲' : '▼'} ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)}% V8W`
    : null;

  // Year-peak: scan state.volume.last7Days windows isn't enough — we
  // need the highest weekly rollup. Without a per-week year history in
  // state, we say "NO PEAK DATA YET" rather than fabricate.
  // weeklyAvg8w gives us a soft read but isn't a year peak.
  let peakLabel = 'NO PEAK DATA YET';
  if (currentMi != null) {
    const recent7 = state.volume.last7Mi;
    if (recent7 > 0) {
      peakLabel = `${year} ROLLING · ${Math.round(recent7)} MI / 7D`;
    }
  }

  return {
    currentMi,
    bandLabel: currentMi != null
      ? '4-WEEK AVG · LOW BAND (20-40)'
      : 'NO DATA YET',
    position,
    trendLabel,
    peakLabel,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Training prefs · DB-backed with explicit defaults flag.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_PREFS: PrefsRow = {
  user_id: 'me',
  long_run_day: 'Sunday',
  quality_days: 'Tue / Thu',
  rest_day: 'Mon',
  rest_cadence: '1-2/wk',
  units: 'Imperial · °F',
};

function buildPrefs(row: PrefsRow | null): { prefs: ProfileApiPref[]; prefsAreDefaults: boolean } {
  const effective = row ?? DEFAULT_PREFS;
  const prefsAreDefaults = row == null;

  // Combine rest day + rest cadence into one row to match the mockup.
  const restCombined = [effective.rest_day, effective.rest_cadence]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .join(' · ');

  const prefs: ProfileApiPref[] = [
    {
      label: 'LONG RUN DAY',
      value: effective.long_run_day ?? null,
      isDefault: prefsAreDefaults && DEFAULT_PREFS.long_run_day === effective.long_run_day,
    },
    {
      label: 'QUALITY DAY',
      value: effective.quality_days ?? null,
      isDefault: prefsAreDefaults && DEFAULT_PREFS.quality_days === effective.quality_days,
    },
    {
      label: 'TYPICAL REST',
      value: restCombined || null,
      isDefault: prefsAreDefaults,
    },
    {
      label: 'UNITS',
      value: effective.units ?? null,
      isDefault: prefsAreDefaults && DEFAULT_PREFS.units === effective.units,
    },
  ];
  return { prefs, prefsAreDefaults };
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
// Shoes — real DB rows mapped into the row shape. Empty list when no
// shoes have been logged.
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

// ─────────────────────────────────────────────────────────────────────
// Coach engine details — pace zones + long-run cap + easy share +
// cutback cadence. Long-run cap reads longestTrainingRunLast28Mi
// (training-only — a 26mi race × 1.10 = unsafe 29mi prescription).
// In POST_RACE the cap anchors on preRaceLongestTrainingMi × 0.50
// (50% restart, ramping back 2-3 weeks per Research/00b §Recovery
// by Effort + marathon-specific recovery).
// ─────────────────────────────────────────────────────────────────────

function buildEngineBlock(state: CoachState, vdot: ProfileApiVdot): ProfileApiEngineBlock {
  const inPostRace = state.recoveryWindowEndsISO != null
    && state.now <= state.recoveryWindowEndsISO;
  const longestTraining = state.volume.longestTrainingRunLast28Mi;
  const preRaceTraining = state.volume.preRaceLongestTrainingMi;
  const usePostRaceAnchor = inPostRace && preRaceTraining != null;
  const hasLong = usePostRaceAnchor || longestTraining > 0;
  const longRunCap = !hasLong
    ? null
    : usePostRaceAnchor
      ? Math.round((preRaceTraining as number) * 0.50 * 10) / 10
      : Math.round(longestTraining * 1.10 * 10) / 10;

  const easyShareFrac = state.intensity.easyShare14d;
  const hasEasy = easyShareFrac > 0;
  const easySharePct = hasEasy ? Math.round(easyShareFrac * 100) : null;

  const paceZonesValue = vdot.value != null ? `From VDOT ${vdot.value}` : 'NO DATA YET';
  const paceLead = vdot.value != null
    ? 'The Coach prescribes every run inside one of these 5 pace bands.'
    : 'Coach pace zones require a recent race result. Log one to unlock prescribed paces.';

  const tiles: ProfileApiEngineDetail[] = [
    {
      eyebrow: 'YOUR PACE ZONES',
      value: paceZonesValue,
      unit: null,
      lead: paceLead,
      footEyebrow: '',
      footBody: '',
    },
    {
      eyebrow: "NEXT WEEK'S LONG-RUN LIMIT",
      value: longRunCap != null ? longRunCap.toFixed(1) : 'NO DATA YET',
      unit: longRunCap != null ? 'MI' : null,
      lead: longRunCap == null
        ? 'Long-run cap needs a recent training run. Log one to unlock the +10% bump.'
        : usePostRaceAnchor
          ? `Post-race window — Coach holds next week's long to ${longRunCap.toFixed(1)} mi (~50% of pre-race long).`
          : `The Coach won't prescribe a long run over ${longRunCap.toFixed(1)} mi next week — keeps the jump safe.`,
      footEyebrow: longRunCap != null ? (usePostRaceAnchor ? 'WHY' : 'HOW') : '',
      footBody: longRunCap == null
        ? ''
        : usePostRaceAnchor && preRaceTraining != null
          ? `You just raced — race efforts don't count as training progression. Pre-race longest training run was ${preRaceTraining.toFixed(1)} mi; the long rebuilds at ~50% (${longRunCap.toFixed(1)} mi) and ramps back over 2-3 weeks.`
          : `Your longest training run in the last 28 days was ${longestTraining.toFixed(1)} mi. Coach caps the next at +10% — races are excluded from this baseline.`,
    },
    {
      eyebrow: 'EASY-PACE TARGET',
      value: easySharePct != null ? `≥80` : 'NO DATA YET',
      unit: easySharePct != null ? '%' : null,
      lead: easySharePct != null
        ? `At least 80% of your weekly miles should be at easy pace. You're at ${easySharePct}%.`
        : 'Easy-share needs heart-rate-tagged runs in the last 14 days.',
      footEyebrow: easySharePct != null ? 'WHY' : '',
      footBody: easySharePct != null
        ? 'Polarized training: lots of easy + a little hard beats lots of moderate. Reduces injury, builds aerobic engine.'
        : '',
    },
    {
      eyebrow: 'RECOVERY WEEK CADENCE',
      value: 'Every 3',
      unit: 'WKS',
      lead: 'Every 3rd week the Coach drops volume −20% so the body can absorb training.',
      footEyebrow: 'WHY 3 WEEKS',
      footBody:
        'At a low-band mileage tier, 3-week blocks balance stimulus and recovery without losing fitness.',
    },
  ];

  // Pace zone table — empty when no VDOT signal.
  const paceZones: Array<{ label: string; accent: string; value: string }> = [];
  // Note: when VDOT is available we'd ideally map vdotSnapshot.paces
  // into display strings here. That requires re-snapshotting state
  // (vdot only carries display strings via ProfileApiVdot). Until the
  // engine surfaces a numeric paceset directly we leave the table
  // empty when no VDOT, and the page renders "NO DATA YET" in its
  // place. When VDOT IS available the page renders the existing
  // hero-only tile.

  // Plan integrity — Wave H caught the prior hardcoded "12 of 12" pass
  // count, which never came from the engine. Until coach.engineDetails()
  // (or coach.weekValidation()) exposes a real validation surface, this
  // returns null and the UI renders NO DATA YET. Synthesizing pass/total
  // here would risk shipping a green checkmark when the engine has
  // silently regressed.
  // TODO (Wave K — coach validation): wire to coach.engineDetails(state)
  // or count simulateWeek() outputs passing coach.weekValidation.
  return {
    tiles,
    paceZones,
    integrity: null,
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
