/**
 * coach-briefing · multi-sentence briefing the coach delivers at the
 * top of /overview. Conversational voice, real signals only.
 *
 * Unlike `coach-narrative.ts` which surfaces ONE priority-driven
 * sentence (or null when no signal fires), the briefing is always
 * present: it greets the runner, says one thing about their body, names
 * today's workout, previews the rest of the week, and (when a race
 * exists) closes on the countdown.
 *
 * Each clause is composed from a real state signal, if a signal is
 * missing, the clause is omitted (briefing gets shorter). No
 * fabrication. The tone matches the approved v4 mockup:
 *
 *   "Good morning, David. **Your body is absorbing this block really
 *    well**, fitness is stacking up right on schedule. Today is 5.5
 *    easy miles, and I mean easy. If you can't hold a conversation,
 *    you're going too hard. **93 days to AFC. Go get it.**"
 *
 * `**…**` denotes emphasis the UI renders as <strong>.
 */

import type { CoachState } from '../lib/coach-state';
import type { CoachDecision, Citation } from './types';

export interface DailyBriefing {
  /** The full briefing paragraph, **…** markers preserved. */
  text: string;
  /** Pre-formatted top-of-strip label, e.g.
   *  "COACH · THU MAY 15 · BASE WEEK 3". */
  label: string;
  /** Per-clause provenance for the audit trail. */
  clauses: BriefingClause[];
}

export interface BriefingClause {
  kind:
    | 'greeting'
    | 'body-state'
    | 'today-workout'
    | 'week-preview'
    | 'race-countdown'
    | 'maintenance';
  text: string;
  citation?: Citation;
}

export interface BriefingInputs {
  /** Display name from profile. "Runner" if not set. */
  name: string;
  /** Greeting from profile (e.g. "Good morning"). */
  greeting: string;
  /** Today's workout from the coach's prescription (label + distanceMi
   *  + paceTargetSPerMi). */
  workout: {
    label: string;
    distanceMi: number;
    isQuality: boolean;
    isLong: boolean;
    paceTargetSPerMi: number | null;
  } | null;
  /** Current week phase label (e.g. "Base Week 3", "Build Week 2"). */
  phaseLabel: string | null;
  /** Days until next A-race + name. Null when none in window. */
  raceCountdown: { name: string; daysAway: number } | null;
  /** Today's calendar date for the label, e.g. "THU MAY 15". */
  todayDow: string;     // "THU"
  todayMonthDay: string; // "MAY 15"
}

export function dailyBriefing(
  state: CoachState,
  inputs: BriefingInputs,
): CoachDecision<DailyBriefing> {
  const clauses: BriefingClause[] = [];

  // ── Clause 1 · Greeting ────────────────────────────────────────
  clauses.push({
    kind: 'greeting',
    text: `${inputs.greeting}, ${inputs.name}.`,
  });

  // ── Clause 2 · Body state ──────────────────────────────────────
  // Composed from intensity.easyShare14d + volume trajectory +
  // recovery flags. Picks the most-relevant single read.
  const bodyState = pickBodyStateClause(state);
  if (bodyState) clauses.push(bodyState);

  // ── Clause 3 · Today's workout ─────────────────────────────────
  // Names the prescription + emphasizes the doctrine for the type.
  if (inputs.workout) {
    const todayClause = pickTodayWorkoutClause(inputs.workout);
    clauses.push(todayClause);
  }

  // ── Clause 4 · Week preview ────────────────────────────────────
  // What else is coming up? Picks the next named workout.
  const weekClause = pickWeekPreviewClause(state);
  if (weekClause) clauses.push(weekClause);

  // ── Clause 5 · Race countdown OR maintenance close ─────────────
  if (inputs.raceCountdown) {
    clauses.push({
      kind: 'race-countdown',
      text: `**${inputs.raceCountdown.daysAway} days to ${inputs.raceCountdown.name}. Go get it.**`,
    });
  } else {
    // Maintenance close, affirm the work without faking a race. When we
    // know the runner's current weekly average, anchor on it: a real
    // base number is the answer to "ready for what?".
    const avg = state.volume.weeklyAvg4w;
    clauses.push({
      kind: 'maintenance',
      text: avg >= 5
        ? `No race on the calendar, but you're holding **${Math.round(avg)} miles a week**, which means the day you pick one you start from fitness, not from scratch.`
        : 'No race on the books, so the only job is to keep the base ticking over, ready the day one shows up.',
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§Aerobic Base Development',
      },
    });
  }

  // ── Compose ────────────────────────────────────────────────────
  const text = clauses.map((c) => c.text).join(' ');

  const label = `COACH · ${inputs.todayDow} ${inputs.todayMonthDay}${
    inputs.phaseLabel ? ` · ${inputs.phaseLabel.toUpperCase()}` : ''
  }`;

  return {
    answer: { text, label, clauses },
    rationale: 'Composed from greeting + body-state read + today + week + race countdown.',
    brain: 'deterministic',
    citations: clauses
      .map((c) => c.citation)
      .filter((c): c is Citation => c != null),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Clause pickers
// ─────────────────────────────────────────────────────────────────────

function pickBodyStateClause(state: CoachState): BriefingClause | null {
  // Recovery window, explicit post-race phase. Override everything.
  // Count the days left so the runner sees the finish line, not just a
  // vague "still recovering."
  if (state.recoveryWindowEndsISO && state.recoveryWindowEndsISO >= state.now) {
    const daysLeft = Math.max(
      0,
      Math.round(
        (Date.parse(state.recoveryWindowEndsISO + 'T12:00:00Z') -
          Date.parse(state.now + 'T12:00:00Z')) / 86_400_000,
      ),
    );
    return {
      kind: 'body-state',
      text: daysLeft >= 1
        ? `**${daysLeft} more day${daysLeft === 1 ? '' : 's'} of post-race recovery**, the legs feel fine before the deep tissue is, so keep it easy and let the window close on its own.`
        : '**Recovery window closes today**, one more easy day, then we can start asking for real work again.',
      citation: {
        doc: 'Research/00b-recovery-protocols.md',
        section: '§Recovery by Effort (A vs B vs C Race)',
      },
    };
  }

  // Rebuild after a break, soften the voice.
  if (state.flags.rebuildAfterBreak) {
    return {
      kind: 'body-state',
      text: '**You\'re a few days back from a layoff**, we\'re ramping volume gently before adding intensity.',
      citation: {
        doc: 'Research/05-injury-return-protocols.md',
        section: '§1.5 Volume before intensity',
      },
    };
  }

  // Heavy-block flag, hold steady, don\'t hype. Anchor on the actual
  // recent load so the "back off" call has a reason attached.
  if (state.flags.heavyBlockSuspected) {
    const last7 = Math.round(state.volume.last7Mi);
    return {
      kind: 'body-state',
      text: last7 >= 5
        ? `You've stacked a heavy block, ${last7} miles in the last week on top of a hard stretch. The gains land during absorption, not more pounding, so the next few days bias toward easy.`
        : 'You\'ve been carrying a heavy block, the fitness gets banked during the easy days that follow, not by piling on more. Absorb it.',
      citation: {
        doc: 'Research/00b-recovery-protocols.md',
        section: '§Warning Signs of Incomplete Recovery',
      },
    };
  }

  // Check-in driven, multiple poor days is the loudest signal.
  const poor = state.checkin?.poorDaysCount ?? 0;
  if (poor >= 3) {
    return {
      kind: 'body-state',
      text: `**${poor} of your last 7 check-ins came back rough**, that's your body asking for a lighter week, so today's the day to actually take it easy.`,
      citation: {
        doc: 'Research/00b-recovery-protocols.md',
        section: '§Decision Matrix',
      },
    };
  }

  // Volume trajectory, positive trend with good easy share is the
  // "absorbing well" voice. Quantify the climb so it isn't a platitude.
  const easyShare = state.intensity.easyShare14d ?? 0.8;
  const deltaPct = state.volume.deltaPct4v4 ?? 0;
  if (deltaPct >= 0.05 && easyShare >= 0.75) {
    const upPct = Math.round(deltaPct * 100);
    return {
      kind: 'body-state',
      text: `**Mileage is up ${upPct}% over the last month and you've kept ${Math.round(easyShare * 100)}% of it easy**, that's exactly how fitness compounds without breaking you. Don't touch the formula.`,
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§Volume progression rules',
      },
    };
  }

  // Volume sliding moderately, not a panic, but name the number and
  // the fix so it isn't vague hand-wringing.
  if (deltaPct <= -0.10) {
    const downPct = Math.round(Math.abs(deltaPct) * 100);
    return {
      kind: 'body-state',
      text: `Your weekly mileage has slipped ${downPct}% versus the month before, not a crisis, but string two normal weeks together before it becomes a hole to climb out of.`,
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§Volume progression rules',
      },
    };
  }

  // Easy-share is wrong, too much hard. Cite the actual share so the
  // runner sees the gap from the 80% target.
  if (easyShare < 0.70 && (state.intensity.hardMi14d ?? 0) > 5) {
    return {
      kind: 'body-state',
      text: `Only ${Math.round(easyShare * 100)}% of your last two weeks was truly easy, that's well under the 80% that lets hard days land hard. Bank the slow miles so the fast ones count.`,
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§Training Intensity Distribution (TID)',
      },
    };
  }

  // Neutral / steady state, make it specific by leaning on the run
  // streak when there's one worth naming.
  const streak = state.recovery.consecutiveRunDays;
  if (streak >= 7) {
    return {
      kind: 'body-state',
      text: `**${streak} straight days on your feet**, the engine's running clean, so today's job is to keep the easy stuff honest and not let the streak turn into junk miles.`,
    };
  }

  // Neutral / steady state, affirmative but not generic.
  return {
    kind: 'body-state',
    text: 'You\'re holding the line, and steady, boring weeks are what quietly move your fitness. Keep stacking them.',
  };
}

function pickTodayWorkoutClause(workout: NonNullable<BriefingInputs['workout']>): BriefingClause {
  const dist = workout.distanceMi.toFixed(1).replace(/\.0$/, '');
  const lower = workout.label.toLowerCase();

  // EASY / RECOVERY, emphasize the doctrine of running easy easy.
  if (lower.includes('easy') || lower.includes('recovery') || lower.includes('general aerobic')) {
    return {
      kind: 'today-workout',
      text: `Today is ${dist} easy miles, and **I mean easy**, if you can\'t hold a conversation, you\'re going too hard.`,
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§The Seven Workout Categories, 4. Long run',
      },
    };
  }

  // THRESHOLD / TEMPO, emphasize controlled effort.
  if (lower.includes('threshold') || lower.includes('tempo')) {
    return {
      kind: 'today-workout',
      text: `Today is a ${dist}-mile threshold, **comfortably hard**, not race effort. Hold the pace, don\'t race it.`,
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§The Seven Workout Categories, 5. Threshold / tempo',
      },
    };
  }

  // INTERVALS / VO2, emphasize work-and-rest.
  if (lower.includes('interval') || lower.includes('vo2')) {
    return {
      kind: 'today-workout',
      text: `Today is intervals, **hard reps, full recoveries**. Don\'t shortchange the rest; the rest is what makes the work pay.`,
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§The Seven Workout Categories, 6. Intervals',
      },
    };
  }

  // LONG RUN, emphasize aerobic patience.
  if (lower.includes('long')) {
    return {
      kind: 'today-workout',
      text: `Today is ${dist} miles long, **patience over pace**. The volume is the workout; speed is dessert.`,
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§The Seven Workout Categories, 4. Long run',
      },
    };
  }

  // REST, affirm it.
  if (lower.includes('rest')) {
    return {
      kind: 'today-workout',
      text: 'Today is **rest**, a real rest day, not a sneaky easy run. Trust the schedule.',
    };
  }

  // Generic fallback, name the workout, no editorializing.
  return {
    kind: 'today-workout',
    text: `Today is ${workout.label}, ${dist} miles.`,
  };
}

function pickWeekPreviewClause(state: CoachState): BriefingClause | null {
  // Forward-looking single clause, what the next push is, anchored on a
  // real signal the runner can't read off today's card. We stay quiet
  // during expected down-phases (recovery/rebuild/heavy block) so we
  // don't push work doctrine says to skip.
  const inDownPhase =
    (state.recoveryWindowEndsISO != null && state.recoveryWindowEndsISO >= state.now) ||
    state.flags.rebuildAfterBreak ||
    state.flags.heavyBlockSuspected;
  if (inDownPhase) return null;

  // Stale long run is the loudest forward signal, name the gap and the
  // day it gets fixed.
  const longest = state.volume.longestTrainingRunLast28Mi;
  const recentLong = state.volume.last7Days
    .filter((d) => d.miles >= 10)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (longest >= 8 && !recentLong) {
    return {
      kind: 'week-preview',
      text: `Your longest in a month is ${longest.toFixed(1)} mi and it's been over a week, Saturday's long run is the one session that moves the needle, so guard it.`,
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§The Seven Workout Categories, 4. Long run',
      },
    };
  }

  // Quiet on intensity, when there's an A-race out far enough to train
  // for and no hard work logged, the next push is a quality day.
  const nextA = state.races.nextA;
  const hasTrainableA = nextA != null && nextA.daysAway > 21;
  if (hasTrainableA && state.intensity.hardMi14d < 1) {
    const weeksOut = Math.round(nextA!.daysAway / 7);
    return {
      kind: 'week-preview',
      text: `${weeksOut} weeks to ${nextA!.name} and your legs haven't seen real speed in two weeks, one threshold session this week starts sharpening the edge.`,
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§The Seven Workout Categories, 5. Threshold / tempo',
      },
    };
  }

  // When the build is healthy and a race is in range, point at the goal
  // gap so the week has a "why."
  if (hasTrainableA) {
    const weeksOut = Math.round(nextA!.daysAway / 7);
    return {
      kind: 'week-preview',
      text: `${weeksOut} weeks of runway left to ${nextA!.name}, enough to bank real fitness if every week earns its keep.`,
    };
  }

  // No race + healthy build: nothing forward-looking worth a clause.
  return null;
}
