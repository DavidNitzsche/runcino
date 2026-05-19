/**
 * Adaptive recommendation pattern — the philosophy in code.
 *
 * Every adaptive module in this app (max HR validator, VDOT updater,
 * easy pace classifier, training load detector, future modules)
 * MUST conform to the rules in this file.
 *
 * The philosophy, restated:
 *   "I'd rather the app under-react slightly and feel like a calm
 *    experienced coach than over-react and feel like a nervous
 *    algorithm."
 *
 * Concretely, every module that proposes a change to a stored value
 * must satisfy ALL of these:
 *
 *   1. EVIDENCE THRESHOLD — minimum N observations before firing.
 *      Single events never trigger a change. The defaults below are
 *      the floor; specific modules can raise them.
 *
 *   2. CONTEXT FILTERS — outliers get explained away before being
 *      treated as signal. Heat, recent race, illness, accumulated
 *      fatigue, life-stress check-ins all attenuate signal weight.
 *
 *   3. ASYMMETRIC THRESHOLDS — slower to bump fitness up than to
 *      flag overreach down. Cost of overtraining > cost of leaving
 *      a small fitness gain on the table. Default ratio: 1.5× more
 *      evidence required to propose an UP change than a DOWN change.
 *
 *   4. TREND-BASED — compare 4-week windows, not single workouts.
 *      Single-point signals are downgraded to "watch" status; only
 *      sustained trends become "propose" status.
 *
 *   5. EVIDENCE SURFACED — every proposed change carries the
 *      evidence array. UI must render it. No silent updates ever.
 *
 *   6. FALSIFIER — every recommendation states what would change
 *      its mind. The runner can rebut.
 *
 *   7. DISMISSAL WITH NEW-EVIDENCE OVERRIDE — when the runner says
 *      "keep current," suppress for a reasonable window. But re-fire
 *      if new sustained evidence appears (not single events).
 *
 * Modules import the types + helpers below. The TypeScript compiler
 * enforces the shape; the helpers enforce the rules.
 */

// ── Verdict shape (every adaptive module returns this) ──────────────

/** Direction of a proposed change relative to the stored value. */
export type ChangeDirection = 'up' | 'down' | 'none';

/** A single observation that contributed to the verdict. The UI
 *  renders these inline so the runner can audit the reasoning. */
export interface EvidenceItem {
  /** What the observation was — keep this short, runner-readable. */
  label: string;
  /** When it happened. ISO date or descriptive ("last 14 days"). */
  when: string;
  /** The numeric value observed. Optional for qualitative items. */
  value?: number;
  /** Unit string for value, when present. "bpm", "sec/mi", "mi" etc. */
  unit?: string;
  /** How much weight the verdict gives this item, 0.0–1.0. Context
   *  filters multiply this down (e.g., heat run = 0.5, recent race = 0.3). */
  weight: number;
  /** Tag for grouping in the UI: 'peak', 'race', 'trend', 'workout', 'context'. */
  kind: 'peak' | 'race' | 'trend' | 'workout' | 'context';
}

export interface AdaptiveVerdict {
  /** True when the module wants to propose a change. */
  hasFinding: boolean;
  /** Direction of the proposed change. 'none' when hasFinding=false. */
  direction: ChangeDirection;
  /** Confidence level — drives the prominence of the UI surface.
   *    high   = banner with Apply button, falsifier visible
   *    medium = quiet hint, requires user to expand
   *    low    = watching only, not surfaced unless requested
   */
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** All observations that fed the decision. UI must render. */
  evidence: EvidenceItem[];
  /** Plain-English reason — the "why we think this". */
  reason: string;
  /** Plain-English falsifier — the "what would change our mind". */
  falsifier: string;
  /** True when a dismissal is in effect AND no new sustained
   *  evidence has overridden it. UI hides the banner. */
  dismissed: boolean;
}

// ── Evidence thresholds (rule 1 + rule 3) ───────────────────────────

/** Default minimums per direction. Modules can override per-rule. */
export const DEFAULT_THRESHOLDS = {
  /** Min evidence items needed to propose an UP change (e.g.
   *  "fitness has improved" / "max HR is higher than stored"). */
  upMinEvidence: 3,
  /** Min for a DOWN change (e.g. "fitness is decaying" / "stored
   *  max HR is too high"). Lower because the cost of missing a
   *  downward signal (overtraining) is higher than missing an
   *  upward one (mild under-prescription). */
  downMinEvidence: 2,
  /** Min combined evidence weight (after context filters) to fire
   *  with HIGH confidence. UP needs more total weight than DOWN. */
  upMinWeight: 2.5,
  downMinWeight: 1.5,
  /** Window for trend analysis. 28 days is the floor — anything
   *  shorter is too noisy. */
  trendWindowDays: 28,
} as const;

/** Decide whether the evidence array clears the rule-1 minimum count
 *  AND rule-3 asymmetric weight thresholds for the proposed direction. */
export function meetsEvidenceThreshold(
  evidence: EvidenceItem[],
  direction: ChangeDirection,
  thresholds: typeof DEFAULT_THRESHOLDS = DEFAULT_THRESHOLDS,
): { meets: boolean; confidence: AdaptiveVerdict['confidence'] } {
  if (direction === 'none' || evidence.length === 0) {
    return { meets: false, confidence: 'none' };
  }
  const requiredCount = direction === 'up'
    ? thresholds.upMinEvidence
    : thresholds.downMinEvidence;
  const requiredWeight = direction === 'up'
    ? thresholds.upMinWeight
    : thresholds.downMinWeight;
  const totalWeight = evidence.reduce((s, e) => s + e.weight, 0);
  const meets = evidence.length >= requiredCount && totalWeight >= requiredWeight;
  if (!meets) {
    // Compute partial-evidence confidence — useful for the UI's
    // "watching" state. Threshold met halfway = low; near threshold = medium.
    const countRatio = evidence.length / requiredCount;
    const weightRatio = totalWeight / requiredWeight;
    const minRatio = Math.min(countRatio, weightRatio);
    return {
      meets: false,
      confidence: minRatio >= 0.7 ? 'medium' : minRatio >= 0.4 ? 'low' : 'none',
    };
  }
  // Met threshold — confidence scales with how much we overshot.
  const totalRatio = totalWeight / requiredWeight;
  const confidence: AdaptiveVerdict['confidence'] =
    totalRatio >= 1.5 ? 'high' : totalRatio >= 1.1 ? 'medium' : 'low';
  return { meets: true, confidence };
}

// ── Context filters (rule 2) ─────────────────────────────────────────

export interface ContextSignals {
  /** Most recent race date (ISO) — within 14 days makes any
   *  performance reading suspect (taper-rebound effects, post-race
   *  rust). Older races are fine evidence. */
  lastRaceDate?: string;
  /** Average daytime high temp during the activity, °F. >75 reduces
   *  signal weight; >85 nearly nullifies it. */
  ambientTempF?: number;
  /** Self-reported sleep last 7 days (hours). <6 reduces signal. */
  sleep7dAvgHrs?: number;
  /** Cumulative mileage in the prior 14 days. >1.5× the runner's
   *  28-day baseline = fatigue context; signal weight reduced. */
  prior14dMi?: number;
  /** Runner's 28-day average weekly miles — the baseline that
   *  prior14dMi gets compared to. */
  baselineWeeklyMi?: number;
  /** Daily check-in energy score (1-5), latest entry. <3 reduces
   *  signal weight (runner felt off). */
  energyScore?: number;
}

/** Compute a context multiplier 0.0–1.0 for an observation. Multiply
 *  the observation's raw weight by this to get its filtered weight. */
export function contextMultiplier(
  observationDate: string,
  signals: ContextSignals,
): number {
  let mult = 1.0;

  // RACE RECENCY — anything within 14 days of a race is noisy.
  if (signals.lastRaceDate) {
    const daysSinceRace =
      (Date.parse(observationDate + 'T12:00:00Z')
        - Date.parse(signals.lastRaceDate + 'T12:00:00Z'))
      / 86_400_000;
    if (daysSinceRace >= 0 && daysSinceRace <= 14) {
      mult *= 0.5;  // recent-race rebound / rust
    }
  }

  // HEAT — 75-85°F halves weight, >85 quarters it.
  if (signals.ambientTempF != null) {
    if (signals.ambientTempF >= 85)      mult *= 0.25;
    else if (signals.ambientTempF >= 75) mult *= 0.5;
  }

  // SLEEP — <6h average attenuates physiologic readings.
  if (signals.sleep7dAvgHrs != null && signals.sleep7dAvgHrs < 6) {
    mult *= 0.7;
  }

  // PRIOR LOAD — sustained spike means fatigue context.
  if (
    signals.prior14dMi != null
    && signals.baselineWeeklyMi != null
    && signals.baselineWeeklyMi > 0
  ) {
    const loadRatio = signals.prior14dMi / (signals.baselineWeeklyMi * 2);
    if (loadRatio > 1.5)      mult *= 0.6;
    else if (loadRatio > 1.3) mult *= 0.8;
  }

  // CHECK-IN ENERGY — felt-off days produce weaker signals.
  if (signals.energyScore != null && signals.energyScore < 3) {
    mult *= 0.7;
  }

  // Floor at 0.1 so a single noisy day doesn't completely zero a
  // signal — keep enough weight that pattern detectors can still
  // see something happened.
  return Math.max(0.1, mult);
}

/** Apply context filters across an array of dated observations.
 *  Mutates the `weight` field via context multiplier. Returns a new
 *  array (input is not modified). */
export function applyContextFilters<T extends EvidenceItem & { observationDate?: string }>(
  evidence: T[],
  signals: ContextSignals,
): T[] {
  return evidence.map((e) => {
    const date = e.observationDate ?? e.when;
    const mult = contextMultiplier(date, signals);
    return { ...e, weight: e.weight * mult };
  });
}

// ── Trend math (rule 4) ─────────────────────────────────────────────

export interface TrendSeries {
  date: string;
  value: number;
}

export interface TrendResult {
  /** Median of the most recent window. */
  latestMedian: number;
  /** Median of the prior window (same length, immediately preceding). */
  priorMedian: number;
  /** Latest minus prior. Sign convention is signal-dependent. */
  delta: number;
  /** True when both windows have ≥3 samples — minimum to trust. */
  sufficient: boolean;
  /** Sample counts so callers can decide their own thresholds. */
  latestN: number;
  priorN: number;
}

/** Compare the median of the most-recent N-day window to the
 *  median of the prior N-day window. Designed for things like
 *  "pace at fixed HR has changed over the last 4 weeks". */
export function compareTrendWindows(
  series: TrendSeries[],
  windowDays = DEFAULT_THRESHOLDS.trendWindowDays,
): TrendResult {
  const today = Date.now();
  const cutLatest = today - windowDays * 86_400_000;
  const cutPrior  = today - 2 * windowDays * 86_400_000;
  const latest: number[] = [];
  const prior:  number[] = [];
  for (const p of series) {
    const t = Date.parse(p.date + 'T12:00:00Z');
    if (t > cutLatest) latest.push(p.value);
    else if (t > cutPrior) prior.push(p.value);
  }
  const med = (xs: number[]): number => {
    if (xs.length === 0) return 0;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };
  const latestMedian = med(latest);
  const priorMedian  = med(prior);
  return {
    latestMedian,
    priorMedian,
    delta: latestMedian - priorMedian,
    sufficient: latest.length >= 3 && prior.length >= 3,
    latestN: latest.length,
    priorN: prior.length,
  };
}

// ── Verdict builders ─────────────────────────────────────────────────

/** Build a verdict that conforms to the pattern. The function
 *  enforces:
 *    - hasFinding === true requires meetsEvidenceThreshold().meets
 *    - confidence aligns with evidence weight
 *    - falsifier is non-empty
 *    - evidence array is non-empty when hasFinding=true
 *  Throws in dev if the inputs are inconsistent. */
export function buildVerdict(input: {
  direction: ChangeDirection;
  evidence: EvidenceItem[];
  reason: string;
  falsifier: string;
  dismissed?: boolean;
  thresholds?: typeof DEFAULT_THRESHOLDS;
}): AdaptiveVerdict {
  const { direction, evidence, reason, falsifier } = input;
  if (!falsifier || falsifier.trim().length < 20) {
    throw new Error(
      'adaptive-pattern: every verdict must include a non-trivial falsifier ' +
      '("what would change our mind"). Got: ' + JSON.stringify(falsifier),
    );
  }
  const { meets, confidence } = meetsEvidenceThreshold(
    evidence, direction, input.thresholds,
  );
  return {
    hasFinding: meets,
    direction: meets ? direction : 'none',
    confidence,
    evidence,
    reason,
    falsifier,
    dismissed: input.dismissed ?? false,
  };
}

/** A null verdict — what to return when there's not enough data
 *  to even attempt a recommendation. */
export function insufficientData(reason: string, falsifier: string): AdaptiveVerdict {
  return {
    hasFinding: false,
    direction: 'none',
    confidence: 'none',
    evidence: [],
    reason,
    falsifier,
    dismissed: false,
  };
}
