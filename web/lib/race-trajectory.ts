/**
 * V3 · Race countdown trajectory directional indicator
 *
 * Surfaces "ahead / on-track / behind / collecting-evidence" on the
 * A-race hero card. Reads the L7 signal evidence layer — same verdict
 * the /profile Coach Reads card consumes — and reduces it to one of
 * four states for the race-page display.
 *
 * STATES + GATING (locked with David round 5):
 *
 *   AHEAD                · 2+ signals firing UP (corroborating fitness
 *                          gain). Strong evidence VDOT trending faster
 *                          than needed for goal.
 *   ON_TRACK             · 1 signal firing UP, none firing DOWN.
 *                          Some momentum, but insufficient corroboration
 *                          to call "ahead" with confidence.
 *   BEHIND               · 1+ signals firing DOWN (fitness regression).
 *                          Gap not closing OR widening.
 *   COLLECTING_EVIDENCE  · Insufficient data, OR signals disagree, OR
 *                          all signals silent. Honest "we don't know yet"
 *                          state — DOES NOT default to a confident
 *                          positive read.
 *
 * Per CLAUDE.md Rule 2 (falsifier-required): each state carries a
 * one-line explanation of what would change the system's mind.
 *
 * NO FAKE GREEN PILLS. Conservative-on-upside discipline holds:
 * "ahead" requires real corroboration. Single-signal positive evidence
 * gets the more conservative "on-track" label.
 */

import { buildAdaptiveVdotVerdict } from './adaptive-vdot-verdict';
import { resolveEffectiveMaxHr } from './compute-max-hr';
import { computeAggregateVdot } from './compute-vdot';
import { COLLECTING_EVIDENCE, SIGNALS_CONFLICTED } from './coach-voice';

export type TrajectoryState = 'ahead' | 'on-track' | 'behind' | 'collecting-evidence';

export interface RaceTrajectory {
  state: TrajectoryState;
  /** Per-signal direction summary (for display tooltips). */
  signals: {
    s1: 'up' | 'down' | 'silent';
    s2: 'up' | 'down' | 'silent';
    s3: 'up' | 'down' | 'silent';
  };
  /** One-line headline. */
  headline: string;
  /** One-line "what would change our mind" line. */
  falsifier: string;
}

function dirSummary(up: boolean, down: boolean): 'up' | 'down' | 'silent' {
  if (up) return 'up';
  if (down) return 'down';
  return 'silent';
}

export async function computeRaceTrajectory(
  userId: string,
  today: Date = new Date(),
): Promise<RaceTrajectory> {
  // Pull the same verdict the Coach Reads card uses. This is the
  // single source of truth for L7 signal fire state — V3 doesn't
  // re-evaluate signals, it reads the existing verdict's signal
  // shape.
  const agg = await computeAggregateVdot(userId);
  const currentVdot = agg?.value ?? 45;
  const maxHrResolved = await resolveEffectiveMaxHr(userId);
  const maxHr = maxHrResolved.value ?? null;
  const verdict = await buildAdaptiveVdotVerdict(userId, currentVdot, maxHr, today);

  // Suspended states (race-week / injury-mark) → collecting-evidence.
  if (verdict.recommendation.kind === 'race-week-suspended' ||
      verdict.recommendation.kind === 'insufficient-data') {
    return {
      state: 'collecting-evidence',
      signals: { s1: 'silent', s2: 'silent', s3: 'silent' },
      headline: COLLECTING_EVIDENCE,
      falsifier: `${COLLECTING_EVIDENCE} — need 3+ threshold workouts (Signal 1), 10+ Z2 mile-splits per 4-week window (Signal 2), or 3+ interval sessions (Signal 3) to read trajectory.`,
    };
  }

  const t = verdict.signals.threshold;
  const s1Up = t.fasterCount >= 3 && t.fasterWeight >= 2.5;
  const s1Down = t.slowerCount >= 2 && t.slowerWeight >= 1.5;
  const s2Up = verdict.signal2.firesUp;
  const s2Down = verdict.signal2.firesDown;
  const s3Up = verdict.signal3.firesUp;
  const s3Down = verdict.signal3.firesDown;

  const upCount = (s1Up ? 1 : 0) + (s2Up ? 1 : 0) + (s3Up ? 1 : 0);
  const downCount = (s1Down ? 1 : 0) + (s2Down ? 1 : 0) + (s3Down ? 1 : 0);

  const signals = {
    s1: dirSummary(s1Up, s1Down),
    s2: dirSummary(s2Up, s2Down),
    s3: dirSummary(s3Up, s3Down),
  };

  // Contradiction (one up, one down) → collecting-evidence (signals
  // disagree, picture is noisy).
  if (upCount > 0 && downCount > 0) {
    return {
      state: 'collecting-evidence',
      signals,
      headline: 'Collecting evidence · signals disagree',
      falsifier: `${SIGNALS_CONFLICTED} — ${upCount} pointing up, ${downCount} pointing down this period. Resolution pending: a third corroborating observation in either direction would break the tie. Most likely one window had a non-representative sample.`,
    };
  }

  if (downCount >= 1) {
    return {
      state: 'behind',
      signals,
      headline: 'Behind · gap not closing',
      falsifier: 'A single faster threshold workout OR 5+ s/mi Z2 pace improvement OR faster interval session in the next two weeks would weaken this read.',
    };
  }

  // CONSERVATIVE GATE: "ahead" requires ≥2 corroborating UP signals.
  if (upCount >= 2) {
    return {
      state: 'ahead',
      signals,
      headline: 'Ahead · trending faster than goal pace requires',
      falsifier: 'A reversal in any firing signal — single slow threshold OR 5+ s/mi Z2 regression OR slower interval — would weaken this read.',
    };
  }

  if (upCount === 1) {
    return {
      state: 'on-track',
      signals,
      headline: 'On track · single corroborating signal',
      falsifier: "A second corroborating signal — we'd revise to 'ahead.' A reversal in the firing signal — we'd revise to 'collecting evidence.'",
    };
  }

  // Zero fires either direction · all signals silent but data sufficient.
  return {
    state: 'collecting-evidence',
    signals,
    headline: `${COLLECTING_EVIDENCE} · signals stable`,
    falsifier: `${COLLECTING_EVIDENCE} — signals are within noise floor (±5 s/mi for pace, gating thresholds for HR). Trajectory direction requires at least one signal to fire above its threshold.`,
  };
}
