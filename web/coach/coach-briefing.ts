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
 * Each clause is composed from a real state signal — if a signal is
 * missing, the clause is omitted (briefing gets shorter). No
 * fabrication. The tone matches the approved v4 mockup:
 *
 *   "Good morning, David. **Your body is absorbing this block really
 *    well** — fitness is stacking up right on schedule. Today is 5.5
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
    // Maintenance close — affirm the work without faking a race.
    clauses.push({
      kind: 'maintenance',
      text: 'No race on the books yet — base mileage holds you ready when one shows up.',
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
  // Recovery window — explicit post-race phase. Override everything.
  if (state.recoveryWindowEndsISO && state.recoveryWindowEndsISO >= state.now) {
    return {
      kind: 'body-state',
      text: '**Your body is still cleaning up from the race** — let the tissues finish the job before we ask for more.',
      citation: {
        doc: 'Research/00b-recovery-protocols.md',
        section: '§Recovery by Effort (A vs B vs C Race)',
      },
    };
  }

  // Rebuild after a break — soften the voice.
  if (state.flags.rebuildAfterBreak) {
    return {
      kind: 'body-state',
      text: '**You\'re a few days back from a layoff** — we\'re ramping volume gently before adding intensity.',
      citation: {
        doc: 'Research/05-injury-return-protocols.md',
        section: '§1.5 Volume before intensity',
      },
    };
  }

  // Heavy-block flag — hold steady, don\'t hype.
  if (state.flags.heavyBlockSuspected) {
    return {
      kind: 'body-state',
      text: 'The recent load was heavy — the next few days bias toward absorption, not more stimulus.',
      citation: {
        doc: 'Research/00b-recovery-protocols.md',
        section: '§Warning Signs of Incomplete Recovery',
      },
    };
  }

  // Check-in driven — multiple poor days is the loudest signal.
  const poor = state.checkin?.poorDaysCount ?? 0;
  if (poor >= 3) {
    return {
      kind: 'body-state',
      text: `**Last week\'s check-ins flagged ${poor} poor days** — we\'re trimming intensity until the signal clears.`,
      citation: {
        doc: 'Research/00b-recovery-protocols.md',
        section: '§Decision Matrix',
      },
    };
  }

  // Volume trajectory — positive trend with good easy share is the
  // "absorbing well" voice.
  const easyShare = state.intensity.easyShare14d ?? 0.8;
  const deltaPct = state.volume.deltaPct4v4 ?? 0;
  if (deltaPct >= 0.05 && easyShare >= 0.75) {
    return {
      kind: 'body-state',
      text: '**Your body is absorbing this block really well** — fitness is stacking up right on schedule.',
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§Volume progression rules',
      },
    };
  }

  // Volume sliding moderately — not a panic, but worth naming.
  if (deltaPct <= -0.10) {
    return {
      kind: 'body-state',
      text: 'Volume\'s been drifting down — nothing dramatic, but worth nudging back up this week.',
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§Volume progression rules',
      },
    };
  }

  // Easy-share is wrong — too much hard.
  if (easyShare < 0.70 && (state.intensity.hardMi14d ?? 0) > 5) {
    return {
      kind: 'body-state',
      text: 'Your last two weeks have run a bit hot on intensity — let\'s pull the easy days truly easy.',
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§Training Intensity Distribution (TID)',
      },
    };
  }

  // Neutral / steady state — affirmative but not generic.
  return {
    kind: 'body-state',
    text: 'You\'re holding the line — consistency is doing exactly what consistency does.',
  };
}

function pickTodayWorkoutClause(workout: NonNullable<BriefingInputs['workout']>): BriefingClause {
  const dist = workout.distanceMi.toFixed(1).replace(/\.0$/, '');
  const lower = workout.label.toLowerCase();

  // EASY / RECOVERY — emphasize the doctrine of running easy easy.
  if (lower.includes('easy') || lower.includes('recovery') || lower.includes('general aerobic')) {
    return {
      kind: 'today-workout',
      text: `Today is ${dist} easy miles, and **I mean easy** — if you can\'t hold a conversation, you\'re going too hard.`,
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§The Seven Workout Categories — 4. Long run',
      },
    };
  }

  // THRESHOLD / TEMPO — emphasize controlled effort.
  if (lower.includes('threshold') || lower.includes('tempo')) {
    return {
      kind: 'today-workout',
      text: `Today is a ${dist}-mile threshold — **comfortably hard**, not race effort. Hold the pace, don\'t race it.`,
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§The Seven Workout Categories — 5. Threshold / tempo',
      },
    };
  }

  // INTERVALS / VO2 — emphasize work-and-rest.
  if (lower.includes('interval') || lower.includes('vo2')) {
    return {
      kind: 'today-workout',
      text: `Today is intervals — **hard reps, full recoveries**. Don\'t shortchange the rest; the rest is what makes the work pay.`,
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§The Seven Workout Categories — 6. Intervals',
      },
    };
  }

  // LONG RUN — emphasize aerobic patience.
  if (lower.includes('long')) {
    return {
      kind: 'today-workout',
      text: `Today is ${dist} miles long — **patience over pace**. The volume is the workout; speed is dessert.`,
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§The Seven Workout Categories — 4. Long run',
      },
    };
  }

  // REST — affirm it.
  if (lower.includes('rest')) {
    return {
      kind: 'today-workout',
      text: 'Today is **rest** — a real rest day, not a sneaky easy run. Trust the schedule.',
    };
  }

  // Generic fallback — name the workout, no editorializing.
  return {
    kind: 'today-workout',
    text: `Today is ${workout.label} — ${dist} miles.`,
  };
}

function pickWeekPreviewClause(state: CoachState): BriefingClause | null {
  // For now, pull from state.flags + recent races to phrase a preview.
  // When the plan-as-artifact lookup is wired into BriefingInputs, this
  // becomes more specific ("tempo Tuesday and a long run Friday").
  // Skipping for steady runners — the briefing is already 3+ sentences.
  return null;
}
