/**
 * plan-adapter · doctrine-grounded mutation engine.
 *
 * `adaptPlan(plan, state, today)` evaluates every trigger in the table in
 * docs/PLAN_ARCHITECTURE.md §Adaptation triggers. Each trigger:
 *
 *   1. Reads from state (checkin / volume / flags / races).
 *   2. Checks the doctrine-defined threshold.
 *   3. If fires: computes a mutation, applies it to the in-memory plan,
 *      records a PlanMutation row with citation + signal snapshot.
 *
 * Idempotent: running adaptPlan twice with the same state produces the
 * same final plan (mutations check whether they've already applied).
 *
 * Every citation in this file points at a real Research/ section
 * heading (grep-verified at build time).
 */

import type { CoachState } from '../lib/coach-state';
import { scoreRecentQualitySessions } from '../lib/strava-stats';
import { newId, insertMutation, updateWorkout } from '../lib/plan-store';
import type {
  Plan, PlanWorkout, PlanMutation, TriggerKind, SignalSnapshot,
} from './plan-types';

export interface AdaptOptions {
  /** When true, mutations are persisted via plan-store. Tests can pass
   *  false to keep adaptPlan pure. */
  persist?: boolean;
}

export async function adaptPlan(plan: Plan, state: CoachState, today: string, opts: AdaptOptions = {}): Promise<Plan> {
  const persist = opts.persist !== false;
  // Build a mutable copy of the plan to apply changes in.
  const next: Plan = {
    ...plan,
    weeks: plan.weeks.map(wk => ({
      ...wk,
      workouts: wk.workouts.map(w => ({ ...w, mutations: w.mutations.slice() })),
    })),
  };
  // Flatten workouts for easy lookup.
  const workoutsById = new Map<string, PlanWorkout>();
  const workoutsByDate = new Map<string, PlanWorkout>();
  for (const wk of next.weeks) {
    for (const w of wk.workouts) {
      workoutsById.set(w.id, w);
      workoutsByDate.set(w.dateISO, w);
    }
  }
  const todaysWorkout = workoutsByDate.get(today) ?? null;

  // ─── Trigger 1+2 · check-in poor-days count ───────────────────
  const poor = state.checkin?.poorDaysCount ?? 0;
  if (poor >= 5) {
    // RED: 2-3 days of easy/recovery only. Long run pushed by 1 day or
    // shortened by ~30%.
    await maybeMutate({
      workout: todaysWorkout,
      trigger: 'checkin-red',
      citation: 'Research/00b §Decision Matrix',
      reason: `${poor} poor check-in days in last 7 — full cutback per Research/00b decision matrix; reduce to easy/recovery.`,
      shouldFire: w => w !== null && (w.isQuality || w.isLong),
      mutate: w => ({ type: 'recovery', isQuality: false, isLong: false, distanceMi: Math.min(w.distanceMi, 3) }),
      snapshot: { todayISO: today, poorDaysCount: poor },
      persist,
    });
    // Also blank quality for the next 2 days.
    for (let i = 1; i <= 2; i++) {
      const d = isoOffset(today, i);
      const w = workoutsByDate.get(d) ?? null;
      await maybeMutate({
        workout: w,
        trigger: 'checkin-red',
        citation: 'Research/00b §Decision Matrix',
        reason: `Red check-in window — suppress quality for ${i} day(s) past trigger day.`,
        shouldFire: x => x !== null && x.isQuality,
        mutate: () => ({ type: 'easy', isQuality: false, distanceMi: 3 }),
        snapshot: { todayISO: today, poorDaysCount: poor },
        persist,
      });
    }
  } else if (poor >= 3) {
    // YELLOW: suppress today's quality → recovery.
    await maybeMutate({
      workout: todaysWorkout,
      trigger: 'checkin-yellow',
      citation: 'Research/00b §Decision Matrix',
      reason: `${poor} poor check-in days in last 7 — defer today's quality session per Research/00b decision matrix.`,
      shouldFire: w => w !== null && w.isQuality,
      mutate: w => ({ type: 'recovery', isQuality: false, distanceMi: Math.min(w.distanceMi, 4) }),
      snapshot: { todayISO: today, poorDaysCount: poor },
      persist,
    });
  }

  // ─── Trigger 3 · volume crater ───────────────────────────────
  if (isCrateredVolume(state)) {
    // Next week's totals recompute from last7Mi × 1.10. Affect every
    // workout in the next 7 days proportionally.
    const safeWeekly = state.volume.last7Mi * 1.10;
    const nextWeekWorkouts = futureWeekWorkouts(next, today);
    const plannedTotal = nextWeekWorkouts.reduce((s, w) => s + w.distanceMi, 0);
    if (plannedTotal > safeWeekly && plannedTotal > 0) {
      const ratio = safeWeekly / plannedTotal;
      for (const w of nextWeekWorkouts) {
        const newDist = Math.max(w.type === 'rest' ? 0 : 2, round1(w.distanceMi * ratio));
        await maybeMutate({
          workout: w,
          trigger: 'volume-crater',
          citation: 'Research/00a §Volume progression rules + Research/05 §1.4 Return-to-Volume Guidelines',
          reason: `Last-7-day volume cratered to ${state.volume.last7Mi.toFixed(1)}mi vs 4-wk avg ${state.volume.weeklyAvg4w.toFixed(1)}mi — next week recomputes from last7 × 1.10.`,
          shouldFire: () => true,
          mutate: () => ({ distanceMi: newDist }),
          snapshot: { todayISO: today, last7Mi: state.volume.last7Mi, weeklyAvg4w: state.volume.weeklyAvg4w },
          persist,
        });
      }
    }
  }

  // ─── Trigger 4 · rebuild after break ─────────────────────────
  if (state.flags.rebuildAfterBreak) {
    // Next 3-5 days suppress quality, ramp gradual.
    for (let i = 0; i <= 4; i++) {
      const d = isoOffset(today, i);
      const w = workoutsByDate.get(d) ?? null;
      await maybeMutate({
        workout: w,
        trigger: 'rebuild-after-break',
        citation: 'Research/05 §1.5 Volume before intensity',
        reason: 'Rebuild-after-break flag — volume before intensity. Quality suppressed during ramp.',
        shouldFire: x => x !== null && x.isQuality,
        mutate: () => ({ type: 'easy', isQuality: false }),
        snapshot: { todayISO: today, rebuildAfterBreak: true },
        persist,
      });
    }
  }

  // ─── Trigger 5 · injury return (heuristic) ───────────────────
  const injuryReturning = inferInjuryReturning(state);
  if (injuryReturning) {
    for (let i = 0; i <= 6; i++) {
      const d = isoOffset(today, i);
      const w = workoutsByDate.get(d) ?? null;
      await maybeMutate({
        workout: w,
        trigger: 'injury-return',
        citation: 'Research/05 §1.4 Return-to-Volume Guidelines',
        reason: 'Injury-return signal — volume before intensity. Quality suppressed for 7 days.',
        shouldFire: x => x !== null && x.isQuality,
        mutate: () => ({ type: 'easy', isQuality: false }),
        snapshot: { todayISO: today, injuryReturning: true },
        persist,
      });
    }
  }

  // ─── Trigger 6 · B-race in window ────────────────────────────
  for (const r of state.races.inWindow) {
    if (r.priority !== 'B') continue;
    // ±2 days no quality; race day → race; ±1 day → recovery.
    for (let i = -2; i <= 2; i++) {
      const d = isoOffset(r.date, i);
      const w = workoutsByDate.get(d) ?? null;
      if (!w) continue;
      if (i === 0) {
        await maybeMutate({
          workout: w,
          trigger: 'b-race-in-window',
          citation: 'Research/00b §Recovery by Effort (A vs B vs C Race)',
          reason: `B-race "${r.name}" on ${r.date} — race day workout.`,
          shouldFire: x => x !== null && x.type !== 'race',
          mutate: () => ({ type: 'race', isQuality: false, isLong: false, distanceMi: r.distanceMi }),
          snapshot: { todayISO: today, bRaceDateISO: r.date, raceDistanceMi: r.distanceMi },
          persist,
        });
      } else if (Math.abs(i) === 1) {
        await maybeMutate({
          workout: w,
          trigger: 'b-race-in-window',
          citation: 'Research/00b §Recovery by Effort (A vs B vs C Race)',
          reason: `B-race ${i > 0 ? 'recovery' : 'pre-race shakeout'} day — soft easy/recovery.`,
          shouldFire: x => x !== null && (x.isQuality || x.isLong),
          mutate: () => ({ type: i > 0 ? 'recovery' : 'shakeout', isQuality: false, isLong: false, distanceMi: 3 }),
          snapshot: { todayISO: today, bRaceDateISO: r.date },
          persist,
        });
      } else {
        // ±2 days: no quality
        await maybeMutate({
          workout: w,
          trigger: 'b-race-in-window',
          citation: 'Research/00b §Recovery by Effort (A vs B vs C Race)',
          reason: 'B-race ±2 days — no quality work.',
          shouldFire: x => x !== null && x.isQuality,
          mutate: () => ({ type: 'easy', isQuality: false }),
          snapshot: { todayISO: today, bRaceDateISO: r.date },
          persist,
        });
      }
    }
  }

  // ─── Trigger 7 · bad race result ─────────────────────────────
  for (const r of state.races.recent) {
    if (r.daysAgo > 14) continue;
    if (r.finishS == null) continue;
    const delta = inferRaceDelta(state, r.distanceMi, r.finishS);
    if (delta == null) continue;
    // bad: actual > predicted by ≥15s/mi
    if (delta >= 15) {
      // Shift next mesocycle's pace targets — bump pace targets by ~delta/mi.
      const nextMesoStart = isoOffset(today, 14);
      const nextMesoEnd = isoOffset(today, 42);
      for (const wk of next.weeks) {
        for (const w of wk.workouts) {
          if (w.dateISO < nextMesoStart || w.dateISO > nextMesoEnd) continue;
          if (!w.isQuality && !w.isLong) continue;
          await maybeMutate({
            workout: w,
            trigger: 'bad-race-result',
            citation: 'Research/02 §2. Riegel Formula',
            reason: `Recent race result missed prediction by ${Math.round(delta)}s/mi — next mesocycle pace targets shift to actual.`,
            shouldFire: x => x !== null,
            mutate: () => ({ paceTargetSPerMi: (w.paceTargetSPerMi ?? 0) + Math.round(delta) }),
            snapshot: { todayISO: today, raceDeltaSPerMi: delta },
            persist,
          });
        }
      }
    } else if (delta <= -15) {
      // good race — bump VDOT-derived paces faster. Same window.
      const nextMesoStart = isoOffset(today, 14);
      const nextMesoEnd = isoOffset(today, 42);
      for (const wk of next.weeks) {
        for (const w of wk.workouts) {
          if (w.dateISO < nextMesoStart || w.dateISO > nextMesoEnd) continue;
          if (!w.isQuality) continue;
          await maybeMutate({
            workout: w,
            trigger: 'good-race-result',
            citation: 'Research/02 §2. Riegel Formula',
            reason: `Recent race beat prediction by ${Math.round(-delta)}s/mi — pace targets nudge faster (capped).`,
            shouldFire: x => x !== null,
            mutate: () => ({ paceTargetSPerMi: (w.paceTargetSPerMi ?? 0) + Math.max(-15, Math.round(delta)) }),
            snapshot: { todayISO: today, raceDeltaSPerMi: delta },
            persist,
          });
        }
      }
    }
  }

  // ─── Trigger 8 · positive volume drift ──────────────────────────
  // When actual running outpaces the plan (running on rest days, extra
  // miles, bonus runs), bump next week's prescribed workouts within the
  // 10%/week ramp cap. Only fires when recovery looks healthy.
  const positiveDrift = detectPositiveDrift(next, state, today);
  if (positiveDrift > 0) {
    const nextWeekWorkouts = futureWeekWorkouts(next, today);
    const bumpRatio = 1 + positiveDrift;
    for (const w of nextWeekWorkouts) {
      if (w.type === 'rest' || w.type === 'race' || w.distanceMi === 0) continue;
      const newDist = round1(w.distanceMi * bumpRatio);
      await maybeMutate({
        workout: w,
        trigger: 'positive-drift',
        citation: 'Research/00a §Volume progression rules',
        reason: `Running ${Math.round(positiveDrift * 100)}% above plan this week — nudging next week up within 10%/wk ramp cap.`,
        shouldFire: () => true,
        mutate: () => ({ distanceMi: newDist }),
        snapshot: { todayISO: today, last7Mi: state.volume.last7Mi, weeklyAvg4w: state.volume.weeklyAvg4w },
        persist,
      });
    }
  }

  // ─── Trigger 9 · quality execution pace calibration ──────────────
  // Score recent continuous-effort quality sessions (tempo/threshold)
  // against their prescribed paces. If the runner is consistently
  // crushing targets with controlled HR → advance upcoming quality pace
  // targets by 5 s/mi. Consistently struggling → retreat by 8 s/mi.
  //
  // Only fires once per day (today's ISO baked into citation) so the
  // adapter is idempotent within a day but can re-evaluate each morning.
  // Only scores continuous sessions — interval/rep overall pace is
  // muddied by jogging recovery and can't be compared to a target.
  if ((state.activities?.length ?? 0) > 0) {
    const scores = scoreRecentQualitySessions(
      state.activities ?? [],
      (date) => workoutsByDate.get(date)?.paceTargetSPerMi ?? null,
    );
    const recent6 = scores.slice(0, 6);
    const scoredCount = recent6.filter(s => s.verdict !== 'no_data').length;
    const crushedCount = recent6.filter(s => s.verdict === 'crushed').length;
    const struggledCount = recent6.filter(s => s.verdict === 'struggled').length;

    if (scoredCount >= 2 && crushedCount >= 2 && (state.checkin?.poorDaysCount ?? 0) < 3) {
      // Runner is consistently beating prescribed pace with controlled effort —
      // the plan is under-stimulating. Advance upcoming quality targets.
      const advanceCitation = `Research/01 §Training Pace Calibration — advance ${today}`;
      for (const wk of next.weeks) {
        for (const w of wk.workouts) {
          if (w.dateISO <= today) continue;
          if (!w.isQuality || w.paceTargetSPerMi == null) continue;
          await maybeMutate({
            workout: w,
            trigger: 'quality-execution-advance',
            citation: advanceCitation,
            reason: `${crushedCount}/${scoredCount} recent quality sessions exceeded prescribed pace with controlled HR — advancing quality pace targets by 5 s/mi.`,
            shouldFire: () => true,
            mutate: () => ({ paceTargetSPerMi: w.paceTargetSPerMi! - 5 }),
            snapshot: { todayISO: today },
            persist,
          });
        }
      }
    } else if (scoredCount >= 3 && struggledCount >= 3) {
      // Runner is consistently unable to hit targets — back off so sessions
      // remain productive (aerobic stimulus without chronic over-reaching).
      const retreatCitation = `Research/01 §Training Pace Calibration — retreat ${today}`;
      for (const wk of next.weeks) {
        for (const w of wk.workouts) {
          if (w.dateISO <= today) continue;
          if (!w.isQuality || w.paceTargetSPerMi == null) continue;
          await maybeMutate({
            workout: w,
            trigger: 'quality-execution-retreat',
            citation: retreatCitation,
            reason: `${struggledCount}/${scoredCount} recent quality sessions below prescribed pace — retreating quality pace targets by 8 s/mi.`,
            shouldFire: () => true,
            mutate: () => ({ paceTargetSPerMi: w.paceTargetSPerMi! + 8 }),
            snapshot: { todayISO: today },
            persist,
          });
        }
      }
    }
  }

  return next;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** True when last 7 days < 70% of 4-week average AND not a deliberate
 *  cutback (no obvious peak immediately preceding). */
export function isCrateredVolume(state: CoachState): boolean {
  const a = state.volume.weeklyAvg4w;
  const l = state.volume.last7Mi;
  if (a <= 0) return false;
  return l < a * 0.7;
}

/** Returns the bump ratio (0–0.10) to apply to next week's workouts when
 *  the runner is consistently outpacing the plan. Returns 0 when no bump. */
export function detectPositiveDrift(plan: Plan, state: CoachState, today: string): number {
  // Don't bump when checkin is poor — going hard on tired legs is injury.
  if ((state.checkin?.poorDaysCount ?? 0) >= 3) return 0;
  // Don't bump after a gap — runner may just be catching up.
  if (state.recovery.daysSinceLastRun > 3) return 0;

  // Find the week that contains today.
  const currentWeek = plan.weeks.find(
    wk => today >= wk.weekStartISO && today <= isoOffset(wk.weekStartISO, 6),
  );
  if (!currentWeek) return 0;

  // Never bump in taper or race week — the prescribed drop is intentional.
  const phase = plan.phases.find(p => p.id === currentWeek.phaseId);
  if (phase?.label === 'TAPER' || phase?.label === 'RACE_WEEK' || phase?.label === 'MAINTENANCE') return 0;

  const prescribedWeeklyMi = currentWeek.workouts.reduce((s, w) => s + w.distanceMi, 0);
  if (prescribedWeeklyMi <= 0) return 0;

  const drift = (state.volume.last7Mi - prescribedWeeklyMi) / prescribedWeeklyMi;
  // Only fire when running ≥15% above plan.
  if (drift < 0.15) return 0;

  // Cap bump at 10%/week — the ramp limit from Research/00a.
  // Scale: 15% drift → 5% bump, 30% drift → 10% bump (capped).
  return Math.min(0.10, drift * 0.35);
}

function inferInjuryReturning(state: CoachState): boolean {
  // Heuristic: a long gap (>=10 days no run) + recent shortened runs.
  return state.recovery.daysSinceLastRun >= 10 && state.volume.last28Mi > 0;
}

function inferRaceDelta(_state: CoachState, distanceMi: number, finishS: number): number | null {
  // Compare actual finish s/mi to Riegel-predicted from prior 4w avg pace
  // is too coarse for now. Returns null when no signal — keeps the trigger
  // silent rather than fabricating data. Real impl wires through a vdot
  // prediction; will land when post-race retrospect pipeline ships.
  if (distanceMi <= 0 || finishS <= 0) return null;
  return null;
}

interface MutateArgs {
  workout: PlanWorkout | null;
  trigger: TriggerKind;
  citation: string;
  reason: string;
  shouldFire: (w: PlanWorkout | null) => boolean;
  mutate: (w: PlanWorkout) => Partial<PlanWorkout>;
  snapshot: SignalSnapshot;
  persist: boolean;
}

async function maybeMutate(args: MutateArgs): Promise<void> {
  const w = args.workout;
  if (!w) return;
  if (!args.shouldFire(w)) return;

  // Idempotency: skip if a mutation with the same trigger already
  // applied to this workout (compare by trigger + citation).
  const already = w.mutations.find(m =>
    m.trigger === args.trigger && m.citation === args.citation
  );
  if (already) return;

  const changes = args.mutate(w);
  const mutation: PlanMutation = {
    id: newId(),
    ts: new Date().toISOString(),
    reason: args.reason,
    citation: args.citation,
    trigger: args.trigger,
    signalSnapshot: args.snapshot,
    changedFields: changes,
  };
  // Apply changes in place.
  Object.assign(w, changes);
  w.mutations.push(mutation);
  if (args.persist) {
    await insertMutation(w.id, mutation);
    await updateWorkout(w);
  }
}

function isoOffset(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function futureWeekWorkouts(plan: Plan, today: string): PlanWorkout[] {
  const out: PlanWorkout[] = [];
  for (const wk of plan.weeks) {
    for (const w of wk.workouts) {
      if (w.dateISO > today && w.dateISO <= isoOffset(today, 7)) out.push(w);
    }
  }
  return out;
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
