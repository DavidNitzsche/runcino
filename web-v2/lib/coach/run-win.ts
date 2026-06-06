/**
 * lib/coach/run-win.ts · synthesize a coach-voice "win line" for a
 * completed run.
 *
 * iPhone brief · run-recap-win-line-brief.md
 *
 * The Today v2 post-run sheet shows a green check + one-sentence win
 * line under the run title. This composer authors that sentence ·
 * 4-10 words, plain runner English, no em dashes, no citations.
 *
 * Returns null when:
 *   · No usable signal (off-plan, DNF, missing data)
 *   · Run quality was off-target on the primary axis
 *
 * Examples per workout kind:
 *   · recovery   "Easy and honest · legs stayed fresh"
 *   · easy       "Steady the whole way"
 *   · long       "Negative-split · strong finish"
 *   · tempo      "Held the line · 6:38 dead even"
 *   · intervals  "Six on the rail · last two the strongest"
 *   · race       "Even effort · finish strong"
 */

import type { WorkoutType, Phase } from './run-purpose';

export interface WinInput {
  type: WorkoutType;
  phase: Phase | null;
  plannedMi: number;
  plannedPaceSPerMi: number | null;
  plannedHrCap: number | null;
  actualMi: number;
  actualPaceSPerMi: number | null;
  actualAvgHr: number | null;
  /** Splits in canonical shape · normalizeSplit handles both wire shapes. */
  splits?: Array<{
    mile?: number;
    paceSPerMi?: number | null;
    avgHr?: number | null;
    pace?: string | null;
    hr?: number | null;
    /** 2026-06-01 · treadmill phase fields · null on outdoor runs. */
    actualSpeedMph?: number | null;
    actualInclinePct?: number | null;
    completed?: boolean | null;
    type?: string | null;
    /** 2026-06-02 · Tier 1 · watch-derived verdict per phase ·
     *  "hit" / "drifted" / "missed" / "incomplete" · null when phase
     *  has no target pace. */
    verdict?: string | null;
    /** 2026-06-02 · Tier 1 · seconds within target pace ±tolerance. */
    timeInToleranceSec?: number | null;
    /** 2026-06-02 · Tier 1 · seconds outside the target band. */
    timeOutOfToleranceSec?: number | null;
    /** 2026-06-02 · Tier 1 · 5-second HR timeline · null when no
     *  samples landed. */
    hrSamples?: Array<{ tSec: number; bpm: number | null }> | null;
    /** 2026-06-02 · Tier 1 · 5-second pace timeline. */
    paceSamples?: Array<{ tSec: number; paceSPerMi: number | null; distMi: number }> | null;
    /** 2026-06-02 · Tier 2 · subjective per-rep RPE (1-5). */
    rep_rpe?: number | null;
    /** 2026-06-02 · Tier 2 · optional qualifier · 'legs'|'lungs'|'mind'|'pace'. */
    rep_rpe_tag?: string | null;
  }>;
  /** Verdict from deriveRecap · gates win composition. */
  verdict: string;
  /** 2026-06-01 · treadmill ingest. When true, the win composer routes
   *  through treadmill-aware patterns (speed adherence, incline
   *  discipline, rep progression) instead of pace-based patterns. */
  indoor?: boolean;
  /** 2026-06-01 · source · 'treadmill' triggers indoor-specific
   *  framing even when indoor flag was missed by older payloads. */
  source?: string;
  /** A4 — per-rep phase data from coach_intents watch_completion.
   *  When present, winIntervals uses these instead of per-mile splits.
   *  Cold-start: absent on non-Faff-watch runs; winIntervals falls
   *  through to the per-mile heuristic in that case. */
  phases?: Array<{
    type?: string | null;
    verdict?: string | null;
    actualPaceSPerMi?: number | null;
    targetPaceSPerMi?: number | null;
  }>;
}

/**
 * Compose the win line. Returns null when the run wasn't a "win" ·
 * verdict is the honest gate (no coach fabrication of a win when
 * one didn't happen).
 */
export function deriveWin(input: WinInput): string | null {
  // Gate · only compose for "on plan" / "banked" / "delivered" verdicts.
  // Off-plan, DNF, struggled runs return null and the sheet falls
  // back to verdict + recap.
  if (!gateOnVerdict(input.verdict)) return null;

  // Need at least pace data to call most wins.
  const splits = normalizeSplits(input.splits);

  // 2026-06-01 · treadmill route · take over when indoor=true or
  // source='treadmill'. Falls back to null when no treadmill pattern
  // matches, which preserves the "honest, no fabrication" doctrine.
  if (input.indoor === true || input.source === 'treadmill') {
    return winTreadmill(input);
  }

  // 2026-06-02 · Tier 1+2 composers · field-presence-gated. Try in
  // priority order. First non-null wins. Falls through to type-
  // specific composers when none fire.
  //
  // Order rationale:
  //   1. flagRpeMismatch · "hit pace but felt brutal" is the most
  //      actionable insight · catch overcommitment first
  //   2. winRpeUndershot · suggests stepping up next week
  //   3. winRpeMatched · clean confirmation the prescription was right
  //   4. winRpeTrajectory · fade-vs-hold pattern across the set
  //   5. winVerdictHit · Tier 1 reps-hit pattern
  //   6. winTimeInTolerance · pacing discipline as a percentage
  //
  // Each composer gates on field presence · returns null when data
  // missing. Old runs without Tier 1/2 fields fall through to the
  // existing type-based dispatch below.
  const tier12 = flagRpeMismatch(input)
    ?? winRpeUndershot(input)
    ?? winRpeMatched(input)
    ?? winRpeTrajectory(input)
    ?? winVerdictHit(input)
    ?? winTimeInTolerance(input);
  if (tier12) return tier12;

  switch (input.type) {
    case 'recovery':
      return winRecovery(input);
    case 'easy':
      return winEasy(input, splits);
    case 'long':
      return winLong(input, splits);
    case 'tempo':
    case 'threshold':
      return winTempo(input, splits);
    case 'intervals':
      return winIntervals(input, splits);
    case 'race':
      return winRace(input, splits);
    case 'progression':
      return winProgression(input, splits);
    case 'fartlek':
      return winFartlek(input);
    case 'shakeout':
      return winShakeout(input);
    default:
      return null;
  }
}

// ─── verdict gate ──────────────────────────────────────────────────────

function gateOnVerdict(verdict: string): boolean {
  const v = verdict.toLowerCase();
  // Honest wins · these verdicts indicate the run hit
  if (v.includes('banked') || v.includes('delivered') || v.includes('held') ||
      v.includes('on plan') || v.includes('nailed') || v.includes('solid')) {
    return true;
  }
  // Honest non-wins · don't fabricate
  if (v.includes('off plan') || v.includes('struggled') || v.includes('dnf') ||
      v.includes('skipped') || v.includes('cut short') || v.includes('missed')) {
    return false;
  }
  // Neutral default · compose, let the per-type composer decide null
  return true;
}

// ─── per-type composers ────────────────────────────────────────────────

function winRecovery(input: WinInput): string | null {
  // Recovery is a win when the runner kept it easy · we check pace
  // is at-or-slower than planned (not faster · faster = not recovery)
  if (input.actualPaceSPerMi && input.plannedPaceSPerMi) {
    if (input.actualPaceSPerMi >= input.plannedPaceSPerMi - 5) {
      return 'Easy and honest · legs stayed fresh';
    }
    return 'Recovery run logged · could have been easier';
  }
  return 'Easy day banked';
}

function winEasy(input: WinInput, splits: NormalSplit[]): string | null {
  // Steady = pace variation across splits is low (CV < 5%)
  const cv = paceCV(splits);
  if (cv != null && cv < 0.05) {
    return 'Steady the whole way';
  }
  if (input.actualPaceSPerMi && input.plannedPaceSPerMi) {
    const delta = input.actualPaceSPerMi - input.plannedPaceSPerMi;
    if (Math.abs(delta) <= 15) {
      return 'Easy and on plan';
    }
  }
  return 'Easy day in the books';
}

function winLong(input: WinInput, splits: NormalSplit[]): string | null {
  // Negative split is the headline · second half faster than first
  const ns = isNegativeSplit(splits);
  if (ns) return 'Negative-split · strong finish';
  // Marathon-pace finish if last 2-3 miles meaningfully faster
  const closing = closingKick(splits);
  if (closing != null && closing > 8) {
    return `Closed strong · last miles ${closing}s/mi quicker`;
  }
  // Mileage banked
  if (input.actualMi >= input.plannedMi * 0.95) {
    return 'Long run banked · time on feet earned';
  }
  return null;
}

function winTempo(input: WinInput, splits: NormalSplit[]): string | null {
  // "Held the line" = pace held within ±5 s/mi of target
  if (!input.actualPaceSPerMi || !input.plannedPaceSPerMi) return null;
  const delta = input.actualPaceSPerMi - input.plannedPaceSPerMi;
  const paceStr = formatPace(input.actualPaceSPerMi);
  if (Math.abs(delta) <= 5) {
    return `Held the line · ${paceStr} dead even`;
  }
  if (delta < -5 && delta >= -15) {
    return `Held the line · ${paceStr} slightly under target`;
  }
  if (delta > 5 && delta <= 12) {
    return `Held form · ${paceStr} just off target`;
  }
  return null;
}

function winIntervals(input: WinInput, splits: NormalSplit[]): string | null {
  // A4 — prefer phase-level data from coach_intents when available.
  // Per-mile splits are unreliable for intervals (GPS jitter + pause
  // gaps inflate mile times, mix rep + recovery paces, and can't
  // distinguish "4 reps" from "5 per-mile segments"). Phase data
  // carries the watch's own verdict per rep.
  if (input.phases && input.phases.length > 0) {
    return winIntervalsFromPhases(input.phases);
  }
  // Legacy fallback: per-mile heuristic for non-Faff-watch runs
  // (Strava, Apple Watch Workouts, older iPhone HK ingests).
  const repPaces = workSplitPaces(splits);
  if (repPaces.length < 3) return null;
  const firstHalf = repPaces.slice(0, Math.ceil(repPaces.length / 2));
  const lastHalf = repPaces.slice(Math.ceil(repPaces.length / 2));
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const lastAvg = lastHalf.reduce((a, b) => a + b, 0) / lastHalf.length;
  if (lastAvg <= firstAvg + 3) {
    const strongCount = lastHalf.length;
    return `${repPaces.length} on the rail · last ${strongCount} the strongest`;
  }
  return `${repPaces.length} reps delivered`;
}

/**
 * A4 — intervals win from coach_intents phase data.
 * Uses the watch's own per-rep verdict (hit/drifted/missed) rather
 * than per-mile GPS splits that can't distinguish rep from recovery.
 * Cold-start: returns null when phase list is empty or has no work reps.
 */
function winIntervalsFromPhases(
  phases: NonNullable<WinInput['phases']>,
): string | null {
  const work = phases.filter((p) => {
    const t = String(p.type ?? '').toLowerCase();
    return t === 'work' || t === 'rep' || t === 'intervals' || t === 'tempo' || t === 'threshold';
  });
  if (work.length < 2) return null;

  const hits    = work.filter((p) => p.verdict === 'hit').length;
  const drifted = work.filter((p) => p.verdict === 'drifted').length;
  const missed  = work.filter((p) => p.verdict === 'missed').length;
  const total   = work.length;
  const nearTarget = hits + drifted;   // hit + close-enough-to-drifted

  // Majority missed → not a win; return null so recap shows truth.
  if (missed >= Math.ceil(total / 2)) return null;

  // Clean sweep
  if (hits === total) {
    return `${total} on the rail · clean set.`;
  }

  // All near target (every rep hit or drifted)
  if (nearTarget === total) {
    const lastHalf = work.slice(Math.ceil(total / 2));
    const lastNear = lastHalf.filter((p) => p.verdict === 'hit' || p.verdict === 'drifted').length;
    if (lastNear >= lastHalf.length) {
      return `${total} on the rail · held form through the set.`;
    }
    return `${total} reps near target.`;
  }

  // Majority near target
  if (nearTarget > Math.floor(total / 2)) {
    return `${nearTarget} of ${total} reps on target.`;
  }

  return null;
}

function winRace(input: WinInput, splits: NormalSplit[]): string | null {
  if (isNegativeSplit(splits)) return 'Even effort · negative split';
  if (input.actualMi >= input.plannedMi * 0.99) return 'Race executed';
  return null;
}

function winProgression(_input: WinInput, splits: NormalSplit[]): string | null {
  // Progression = each third faster than the last
  if (splits.length < 6) return null;
  const third = Math.floor(splits.length / 3);
  const a = avgPace(splits.slice(0, third));
  const b = avgPace(splits.slice(third, 2 * third));
  const c = avgPace(splits.slice(2 * third));
  if (a == null || b == null || c == null) return null;
  if (b < a && c < b) return 'Built the gear · each third quicker';
  return null;
}

function winFartlek(_input: WinInput): string | null {
  return 'Surges + recovery · honest fartlek';
}

function winShakeout(_input: WinInput): string | null {
  return 'Loose legs · ready for race day';
}

// ─── helpers ───────────────────────────────────────────────────────────

interface NormalSplit { paceS: number | null; hr: number | null; mile: number | null; }

function normalizeSplits(splits: WinInput['splits']): NormalSplit[] {
  if (!splits) return [];
  return splits.map((s) => ({
    paceS: paceSeconds(s),
    hr: s.avgHr ?? s.hr ?? null,
    mile: s.mile ?? null,
  }));
}

function paceSeconds(s: { paceSPerMi?: number | null; pace?: string | null }): number | null {
  if (s.paceSPerMi != null) return s.paceSPerMi > 0 ? s.paceSPerMi : null;
  if (typeof s.pace === 'string') {
    const m = s.pace.match(/^(\d+):(\d{2})$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
  }
  return null;
}

function paceCV(splits: NormalSplit[]): number | null {
  const paces = splits.map((s) => s.paceS).filter((p): p is number => p != null && p > 0);
  if (paces.length < 3) return null;
  const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
  const variance = paces.reduce((s, p) => s + (p - mean) ** 2, 0) / paces.length;
  return Math.sqrt(variance) / mean;
}

function isNegativeSplit(splits: NormalSplit[]): boolean {
  const paces = splits.map((s) => s.paceS).filter((p): p is number => p != null && p > 0);
  if (paces.length < 4) return false;
  const half = Math.floor(paces.length / 2);
  const first = paces.slice(0, half);
  const second = paces.slice(-half);
  const firstAvg = first.reduce((a, b) => a + b, 0) / first.length;
  const secondAvg = second.reduce((a, b) => a + b, 0) / second.length;
  return secondAvg < firstAvg - 5;  // ≥5 s/mi faster second half
}

function closingKick(splits: NormalSplit[]): number | null {
  const paces = splits.map((s) => s.paceS).filter((p): p is number => p != null && p > 0);
  if (paces.length < 6) return null;
  const early = paces.slice(0, Math.ceil(paces.length / 2));
  const late = paces.slice(-2);
  const earlyAvg = early.reduce((a, b) => a + b, 0) / early.length;
  const lateAvg = late.reduce((a, b) => a + b, 0) / late.length;
  return Math.round(earlyAvg - lateAvg);
}

function workSplitPaces(splits: NormalSplit[]): number[] {
  // Pick the fastest splits · likely the reps. Drop the slowest 2
  // (warmup + cooldown) when there are 5+ splits.
  const paces = splits.map((s) => s.paceS).filter((p): p is number => p != null && p > 0);
  if (paces.length < 4) return paces;
  const sorted = [...paces].sort((a, b) => a - b);
  return sorted.slice(0, sorted.length - 2);
}

function avgPace(splits: NormalSplit[]): number | null {
  const paces = splits.map((s) => s.paceS).filter((p): p is number => p != null && p > 0);
  if (paces.length === 0) return null;
  return paces.reduce((a, b) => a + b, 0) / paces.length;
}

function formatPace(spm: number): string {
  const m = Math.floor(spm / 60);
  const s = Math.round(spm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Tier 2 RPE composers (2026-06-02) ────────────────────────────────
//
// All gate on `rep_rpe != null` for at least 2 work phases · null when
// the runner skipped / dismissed / no-tap'd the prompt. Opt-in honesty
// per the watch agent's UX brief.

/**
 * #1 in priority · the "felt brutal but hit pace" anti-pattern.
 *
 * Watch's Tier 1 verdict says the rep hit the target band; RPE says
 * the runner was barely hanging on. That mismatch is a fatigue /
 * overcommitment signal that wouldn't be visible from metrics alone.
 * Strongest reason for capturing RPE in the first place.
 */
function flagRpeMismatch(input: WinInput): string | null {
  const reps = (input.splits ?? []).filter((s) =>
    s.type === 'work' && s.rep_rpe != null && s.verdict != null
  );
  if (reps.length < 2) return null;
  const overcooked = reps.filter((s) => s.verdict === 'hit' && (s.rep_rpe ?? 0) >= 5);
  if (overcooked.length >= 2) {
    return `Hit target pace but rated ${overcooked.length} reps as max effort · quietly overcooked, dial the next session.`;
  }
  return null;
}

/**
 * The "easier than prescribed" pattern · RPE consistently below
 * threshold suggests the pace target may be too soft. Signal to
 * step up the prescription next week.
 */
function winRpeUndershot(input: WinInput): string | null {
  const reps = (input.splits ?? []).filter((s) =>
    s.type === 'work' && s.rep_rpe != null
  );
  if (reps.length < 3) return null;
  const avgRpe = reps.reduce((s, r) => s + (r.rep_rpe ?? 0), 0) / reps.length;
  // Below threshold AND on a workout type that should feel hard.
  const t = input.type;
  if (avgRpe < 3 && (t === 'threshold' || t === 'tempo' || t === 'intervals')) {
    return `Avg RPE ${avgRpe.toFixed(1)}/5 · easier than the prescription. The pace target may be too soft for this block.`;
  }
  return null;
}

/**
 * The "felt as expected" pattern · honest confirmation the prescription
 * was right. RPE 3-4 is the canonical window for threshold / tempo /
 * interval work.
 */
function winRpeMatched(input: WinInput): string | null {
  const reps = (input.splits ?? []).filter((s) =>
    s.type === 'work' && s.rep_rpe != null
  );
  if (reps.length < 2) return null;
  const avgRpe = reps.reduce((s, r) => s + (r.rep_rpe ?? 0), 0) / reps.length;
  if (avgRpe >= 3 && avgRpe <= 4) {
    return `Avg RPE ${avgRpe.toFixed(1)}/5 · effort matched the prescription.`;
  }
  return null;
}

/**
 * The "fade vs. hold" pattern · rep 1 vs rep N RPE. Should be similar
 * for a well-paced threshold. If rep N is 2+ points higher, the runner
 * overcommitted at the start.
 */
function winRpeTrajectory(input: WinInput): string | null {
  const reps = (input.splits ?? []).filter((s) =>
    s.type === 'work' && s.rep_rpe != null
  );
  if (reps.length < 3) return null;
  const first = reps[0].rep_rpe!;
  const last = reps[reps.length - 1].rep_rpe!;
  const delta = last - first;
  if (delta >= 2) {
    return `Rep 1 rated ${first}/5 · rep ${reps.length} rated ${last}/5 · faded across the set, dial the opening next time.`;
  }
  if (delta <= -2) {
    return `Rep 1 rated ${first}/5 · rep ${reps.length} rated ${last}/5 · settled into the work, strong closing reps.`;
  }
  return null;
}

// ─── Tier 1 verdict + time-in-tolerance composers (2026-06-02) ────────

/**
 * The "clean reps" pattern · watch derives `verdict` per phase. Count
 * the work phases that hit cleanly. Fires only when ≥75% of the work
 * reps hit.
 */
function winVerdictHit(input: WinInput): string | null {
  const work = (input.splits ?? []).filter((s) =>
    s.type === 'work' && s.verdict != null
  );
  if (work.length < 2) return null;
  const hits = work.filter((s) => s.verdict === 'hit').length;
  const drift = work.filter((s) => s.verdict === 'drifted').length;
  const miss = work.filter((s) => s.verdict === 'missed').length;
  const hitRate = hits / work.length;
  if (hitRate >= 0.75 && drift + miss <= 1) {
    return `Hit target band on ${hits} of ${work.length} reps · clean execution.`;
  }
  if (hitRate < 0.5 && miss >= 2) {
    return `Missed target band on ${miss} of ${work.length} reps · pace was off today.`;
  }
  return null;
}

/**
 * The "pacing discipline" pattern · time-in-tolerance as a percentage
 * across all work phases. Higher = more steady inside the band.
 */
function winTimeInTolerance(input: WinInput): string | null {
  const work = (input.splits ?? []).filter((s) =>
    s.type === 'work' && s.timeInToleranceSec != null && s.timeOutOfToleranceSec != null
  );
  if (work.length < 2) return null;
  const tin = work.reduce((s, r) => s + (r.timeInToleranceSec ?? 0), 0);
  const tot = tin + work.reduce((s, r) => s + (r.timeOutOfToleranceSec ?? 0), 0);
  if (tot === 0) return null;
  const pct = Math.round((tin / tot) * 100);
  if (pct >= 80) {
    return `${pct}% of work time inside the target band · steady, disciplined pacing.`;
  }
  if (pct < 50) {
    return `${pct}% of work time inside the target band · pace was hunting today.`;
  }
  return null;
}

// ─── treadmill win composer ───────────────────────────────────────────
//
// Three patterns ranked by leverage. First match wins. Returns null
// when no pattern fires (preserves the honest-no-fabrication doctrine).
//
//   1. All work phases at planned mph ± 0.2 → steady-effort win
//   2. Each work rep faster than the last → progression win
//   3. Recovery phases ≤ 5.5 mph (true jog) AND all reps completed →
//      disciplined-recovery win
//
// Doctrine: same gating as outdoor — only fire on positive verdict
// frames. The treadmill phase data lives on splits[i].actualSpeedMph
// and actualInclinePct (added 2026-06-01 in deriveSplitsFromPhases).
function winTreadmill(input: WinInput): string | null {
  const phases = input.splits ?? [];
  if (phases.length === 0) return null;

  // Split into work + recovery phases by `type`. Phases without a type
  // are treated as work if speed > 6 mph, else recovery.
  const isWork = (p: typeof phases[number]): boolean => {
    const t = String(p.type ?? '').toLowerCase();
    if (t === 'work' || t === 'rep' || t === 'tempo' || t === 'threshold' || t === 'intervals') return true;
    if (t === 'recovery' || t === 'rest' || t === 'jog' || t === 'warmup' || t === 'cooldown') return false;
    return (p.actualSpeedMph ?? 0) > 6;
  };
  const workPhases = phases.filter(isWork);
  const recoveryPhases = phases.filter((p) => !isWork(p));
  const workSpeeds = workPhases.map((p) => p.actualSpeedMph ?? 0).filter((v) => v > 0);

  if (workSpeeds.length === 0) return null;

  const allRepsCompleted = workPhases.every((p) => p.completed !== false);

  // Pattern 1 · steady-effort win.
  // All work phases within ±0.2 mph of each other (low CV).
  if (workSpeeds.length >= 2) {
    const meanMph = workSpeeds.reduce((s, v) => s + v, 0) / workSpeeds.length;
    const maxDelta = Math.max(...workSpeeds.map((v) => Math.abs(v - meanMph)));
    if (maxDelta <= 0.2) {
      const inclines = workPhases.map((p) => p.actualInclinePct ?? null).filter((v): v is number => v != null);
      const inclineNote = inclines.length > 0 && Math.abs(Math.max(...inclines) - Math.min(...inclines)) <= 0.5
        ? `, steady incline`
        : '';
      return `Held the line · ${meanMph.toFixed(1)} mph${inclineNote}. The treadmill didn't drift you · the discipline did.`;
    }
  }

  // Pattern 2 · progression win · each rep faster than the last.
  if (workSpeeds.length >= 3) {
    const monotonicUp = workSpeeds.every((v, i) => i === 0 || v >= workSpeeds[i - 1]);
    const totalDelta = workSpeeds[workSpeeds.length - 1] - workSpeeds[0];
    if (monotonicUp && totalDelta >= 0.5) {
      return `Building rep by rep · ${workSpeeds[0].toFixed(1)} mph → ${workSpeeds[workSpeeds.length - 1].toFixed(1)} mph. Last one was the strongest.`;
    }
  }

  // Pattern 3 · disciplined recovery.
  // Recovery jogs at true jog pace (≤ 5.5 mph) AND all reps completed.
  if (recoveryPhases.length >= 2 && allRepsCompleted) {
    const recoverySpeeds = recoveryPhases.map((p) => p.actualSpeedMph ?? 0).filter((v) => v > 0);
    if (recoverySpeeds.length >= 2) {
      const maxRecovery = Math.max(...recoverySpeeds);
      if (maxRecovery <= 5.5) {
        return `Disciplined recovery jogs · the reps did the work, not the jog. That's exactly the setup.`;
      }
    }
  }

  // Pattern 4 · simple "you finished" fallback when all reps done.
  if (allRepsCompleted && workSpeeds.length >= 2) {
    const meanMph = workSpeeds.reduce((s, v) => s + v, 0) / workSpeeds.length;
    return `${workPhases.length} reps at ${meanMph.toFixed(1)} mph · clean session.`;
  }

  return null;
}
