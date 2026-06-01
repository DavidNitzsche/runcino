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
  }>;
  /** Verdict from deriveRecap · gates win composition. */
  verdict: string;
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
  // Find work-segments · the fastest N splits where N is the rep count
  const repPaces = workSplitPaces(splits);
  if (repPaces.length < 3) return null;
  // Last reps as strong or stronger than first reps?
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
