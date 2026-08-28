/**
 * decision-cards · the ONE interruption grammar (web recomposition deck,
 * Decision 2 · approved 2026-08-17).
 *
 * Before this module the app interrupted the runner with four unrelated
 * chromes: CoachProposalCard (warn-red gradient), PlanProposalCard (amber
 * or teal gradient), WorkoutProposalBanner (its own .wpb CSS family) and
 * AdaptationCard (.fa-adapt badge card). Four shapes, four button
 * vocabularies, and a CSS gag in globals.css that hid every banner after
 * the first so the brief's one-banner cap could not be violated.
 *
 * The deck's ruling: one card, kind-driven dressing.
 *
 *   kind 'decision' · amber accent · "COACH · NEEDS A DECISION"
 *                     the coach is waiting on the runner.
 *   kind 'notice'   · recovery-blue accent · "COACH · APPLIED"
 *                     the coach already acted; nothing to decide.
 *
 * Decisions outrank notices. When more than one waits, ONE renders with an
 * "N waiting" pager instead of a stack — which is why the CSS gag can go:
 * multiplicity is handled structurally, not by hiding DOM.
 *
 * Button grammar (locked): the primary always starts ACCEPT, the secondary
 * always starts KEEP. Notices carry a single quiet link instead.
 *
 * This module is PURE — no React, no fetch, no DOM. CoachDecisionCard.tsx
 * renders whatever comes out of selectCoachDecisions(). That is what makes
 * kind / priority / pager selection testable (decision-cards.test.ts).
 */

/** Amber = the coach needs a call. Recovery blue = already applied. */
export type DecisionKind = 'decision' | 'notice';

/** Which loader produced the row. Drives the endpoint, not the dressing. */
export type DecisionSource =
  | 'coach_proposal'
  | 'plan_proposal'
  | 'workout_proposal'
  | 'adaptation';

/**
 * One button. `role` fixes the grammar:
 *   accept · primary, label always begins "ACCEPT"
 *   keep   · secondary, label always begins "KEEP"
 *   link   · quiet text link on notices ("SEE THE CHANGE ›")
 *   undo   · secondary on a NOTICE, label always begins "PUT"
 *
 * 2026-08-25 · THE GRAMMAR GREW BY ONE, and it is worth saying why rather than
 * quietly widening a union the deck locked.
 *
 * The deck's rule was: notices carry a single quiet link, because a notice is
 * something that already happened and there is nothing left to decide. That
 * held for as long as an applied change was irreversible. It is not any more —
 * the runner's ruling on 2026-08-25 was "apply, but let me undo", and an undo
 * the runner cannot reach is not an undo.
 *
 * `keep` was the obvious reuse and it is wrong here. "KEEP THE CURRENT PLAN"
 * means decline a change that has not happened. On a notice the change HAS
 * happened, so a KEEP button would be offering to keep the thing the runner is
 * trying to get rid of. A separate role with its own verb is the honest shape.
 */
export type DecisionAction = {
  role: 'accept' | 'keep' | 'link' | 'undo';
  label: string;
  /** Shown while the POST is in flight. Ignored for role 'link'. */
  busyLabel?: string;
  /** POST target. Absent on 'link' actions, which navigate to href. */
  endpoint?: string;
  /** JSON body for the POST. Absent when the id rides in the path. */
  body?: Record<string, unknown>;
  /** Navigation target for 'link' actions. */
  href?: string;
};

export type CoachDecision = {
  /** Stable React key · source-scoped so ids from different tables can't collide. */
  key: string;
  source: DecisionSource;
  kind: DecisionKind;
  /** Eyebrow copy. Kind-driven, not source-driven (deck: one grammar). */
  eyebrow: string;
  /** Oswald display line. Sentence case, coach voice. */
  title: string;
  /** Body paragraph. Coach voice: short, direct, no em dashes, no hype. */
  body: string;
  /**
   * Notices show a date stamp where decisions show the pager. ISO or a
   * pre-formatted short date; null when the source carried no timestamp.
   */
  stamp: string | null;
  actions: DecisionAction[];
  /**
   * Sort weight WITHIN a kind. Lower renders first. Kind always wins over
   * priority: every decision precedes every notice.
   */
  priority: number;
};

/* ── priority ladder ─────────────────────────────────────────────────────
   Injury / illness first: those rows exist because something happened to
   the runner's body. Then plan-level drift, then a single workout, then
   the passive notices. */
const PRIORITY = {
  coach_proposal: 10,
  plan_proposal_pending: 20,
  workout_proposal: 30,
  plan_proposal_applied: 60,
  adaptation: 70,
} as const;

const EYEBROW_DECISION = 'COACH · NEEDS A DECISION';
const EYEBROW_NOTICE = 'COACH · APPLIED';

/* ── input shapes · structural mirrors of the existing loaders ───────────
   Deliberately structural (not imports) so this module stays pure and the
   test can build fixtures without dragging the DB types in. */

export type CoachProposalInput = {
  id: number;
  proposal_type: string;
  reason: string;
  suggested: string;
  created_at?: string;
};

export type PlanProposalInput = {
  id: number;
  kind: string;
  status: string;
  message: string;
  createdAt?: string;
  newPlanId?: string | null;
  previousPlanId?: string | null;
  planId?: string | null;
};

export type WorkoutProposalInput = {
  id: number;
  workoutDateISO: string;
  actionKind: 'downgrade' | 'shave' | 'reschedule' | 'field_test' | string;
  actionPayload: {
    newType?: string;
    newDate?: string;
    shaveFraction?: number;
    why?: string;
  };
  reason: string;
  createdAt?: string;
};

export type AdaptationInput = {
  ts: string;
  summary: string;
  severity: 'info' | 'warn' | 'override' | string;
};

export type SelectDecisionsInput = {
  coachProposals?: CoachProposalInput[] | null;
  planProposals?: PlanProposalInput[] | null;
  workoutProposals?: WorkoutProposalInput[] | null;
  adaptations?: AdaptationInput[] | null;
  /** Today, ISO. Used for the workout-proposal day phrasing. */
  todayISO?: string;
  /**
   * Plan-proposal kinds this surface must NOT render because another
   * surface owns them. See TARGETS_OWNED_PLAN_KINDS.
   */
  excludeKinds?: readonly string[];
};

/**
 * Plan-proposal kinds that belong to Targets, not to Today.
 *
 * Deck Decision 3a mounts the goal renegotiation inside THE PATH, directly
 * under the number line that justifies it. If Today also rendered it from
 * the generic plan-proposal list, the runner would be asked the same
 * question twice on two pages, and answering it in one place would leave a
 * stale card in the other. The renegotiation is a decision ABOUT a number;
 * it belongs beside that number.
 *
 * This is a list, not a special case, because the next surface-owned kind
 * will want the same treatment.
 */
export const TARGETS_OWNED_PLAN_KINDS = ['goal_renegotiation'] as const;

/* ── kind labels ─────────────────────────────────────────────────────── */

/** Plan-drift kinds → the coach's own headline. Mirrors the labels the
 *  retired PlanProposalCard shipped, minus its per-kind eyebrows (the
 *  eyebrow is kind-driven now). */
const PLAN_TITLES: Record<string, string> = {
  volume_drift: 'Your volume has drifted off plan',
  vdot_drift: 'Your fitness has moved',
  staleness: 'This plan is due a refresh',
  easy_drift: 'Your easy days have drifted',
  long_drift: 'Your long runs have drifted',
  quality_drift: 'Your quality work has drifted',
  goal_gap_widening: 'The gap to your goal is widening',
  race_date_changed: 'A race date changed',
  goal_time_changed: 'Your goal time changed',
  a_race_added: 'A goal race was added',
  a_race_removed: 'A goal race was removed',
  goal_renegotiation: 'Your race target needs a call',
  pace_reanchor: 'Your paces are off your fitness',
  // 2026-08-25 · the kinds the writers stamp that this map did not carry. They
  // fell through to the generic "Your plan needs an update", which reads as a
  // request for action on a card that is reporting a change already made.
  replan: 'Your settings reshaped the block',
  plan_change: 'Your settings reshaped the block',
  race_graduate: 'The next block is up',
  recovery_complete: 'Recovery is done',
  plan_elapsed: 'That block ran out',
  maintenance_to_raceprep: 'Race prep starts here',
  // 2026-08-28 · the operator code-upgrade rebuild now writes an auto_applied
  // row so it can be undone (it was the one rebuild undo could not pair).
  silent_rebuild: 'The engine rebuilt your block',
};

/** The concrete thing ACCEPT does, per plan-drift kind. Keeps the verb
 *  specific while the ACCEPT / KEEP grammar stays constant. */
const PLAN_ACCEPT_VERB: Record<string, string> = {
  volume_drift: 'REBUILD THE PLAN',
  vdot_drift: 'REBUILD THE PLAN',
  staleness: 'REFRESH THE PLAN',
  easy_drift: 'REBUILD THE PLAN',
  long_drift: 'REBUILD THE PLAN',
  quality_drift: 'REBUILD THE PLAN',
  goal_gap_widening: 'REBUILD THE PLAN',
  race_date_changed: 'REBUILD THE PLAN',
  goal_time_changed: 'REBUILD THE PLAN',
  a_race_added: 'REBUILD THE PLAN',
  a_race_removed: 'REBUILD THE PLAN',
  goal_renegotiation: 'MOVE THE TARGET',
  pace_reanchor: 'RE-ANCHOR MY PACES',
  // 2026-08-28 · the lifecycle kinds normally auto-apply, but both keep a
  // pending fallback (undone-by-runner, compromised runner, failed rebuild)
  // and the generic 'REBUILD THE PLAN' undersells what accepting starts.
  recovery_complete: 'START THE BUILD',
  plan_elapsed: 'BUILD THE NEXT BLOCK',
};

/* ── per-source mappers ──────────────────────────────────────────────── */

function fromCoachProposal(p: CoachProposalInput): CoachDecision {
  const isInjury = p.proposal_type === 'injury_adjust';
  const isIllness = p.proposal_type === 'illness_adjust';
  const title = isInjury
    ? 'Switch to an injury-return plan'
    : isIllness
      ? 'Take the recovery week'
      // Its two siblings say what the change IS. This one named the speaker
      // instead, in the third person, on the card where the runner most
      // needs to know what is being asked of them.
      : 'There is a change to look at';
  const acceptVerb = isInjury
    ? 'BUILD THE INJURY PLAN'
    : isIllness
      ? 'DROP THIS WEEK’S QUALITY'
      : 'MAKE THE CHANGE';
  // reason = what we noticed, suggested = what we'd do. Both are already
  // coach-voice strings from lib/plan/adapt.ts.
  const body = [p.reason, p.suggested].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
  return {
    key: `coach-${p.id}`,
    source: 'coach_proposal',
    kind: 'decision',
    eyebrow: EYEBROW_DECISION,
    title,
    body,
    stamp: p.created_at ?? null,
    priority: PRIORITY.coach_proposal,
    actions: [
      {
        role: 'accept',
        label: `ACCEPT · ${acceptVerb}`,
        busyLabel: 'APPLYING',
        endpoint: `/api/coach/proposal/${p.id}/accept`,
      },
      {
        role: 'keep',
        label: 'KEEP THE CURRENT PLAN',
        busyLabel: 'NOTING',
        endpoint: `/api/coach/proposal/${p.id}/decline`,
      },
    ],
  };
}

function fromPlanProposal(p: PlanProposalInput): CoachDecision | null {
  const title = PLAN_TITLES[p.kind] ?? 'Your plan needs an update';

  if (p.status === 'pending') {
    const verb = PLAN_ACCEPT_VERB[p.kind] ?? 'REBUILD THE PLAN';
    return {
      key: `plan-${p.id}`,
      source: 'plan_proposal',
      kind: 'decision',
      eyebrow: EYEBROW_DECISION,
      title,
      body: p.message ?? '',
      stamp: p.createdAt ?? null,
      priority: PRIORITY.plan_proposal_pending,
      actions: [
        {
          role: 'accept',
          label: `ACCEPT · ${verb}`,
          busyLabel: 'REBUILDING',
          endpoint: '/api/plan/proposal',
          body: { id: p.id, action: 'accept' },
        },
        {
          role: 'keep',
          label: 'KEEP THE CURRENT PLAN',
          busyLabel: 'NOTING',
          endpoint: '/api/plan/proposal',
          body: { id: p.id, action: 'dismiss' },
        },
      ],
    };
  }

  if (p.status === 'auto_applied') {
    const from = p.previousPlanId ?? p.planId ?? null;
    const href = p.newPlanId
      ? `/training/plans/${p.newPlanId}/diff${from ? `?from=${from}` : ''}`
      : undefined;
    const actions: DecisionAction[] = [];
    if (href) actions.push({ role: 'link', label: 'SEE THE CHANGE ›', href });
    // 2026-08-25 · the undo. Offered whenever the row records BOTH sides of the
    // swap, because those two ids are what the route needs to reverse it.
    //
    // The button is offered optimistically and the SERVER decides. It has to
    // be that way round: whether an undo is safe depends on which days the
    // runner has run since, which is a database question, and a client that
    // guessed would either hide a safe undo or promise an unsafe one. A refused
    // undo comes back 409 with a sentence to render, which is a better answer
    // than a button that was never there.
    if (from && p.newPlanId) {
      actions.push({
        role: 'undo',
        label: 'PUT THE OLD BLOCK BACK',
        busyLabel: 'PUTTING IT BACK',
        endpoint: '/api/plan/undo',
        body: { id: p.id },
      });
    }
    return {
      key: `plan-${p.id}`,
      source: 'plan_proposal',
      kind: 'notice',
      eyebrow: EYEBROW_NOTICE,
      title,
      body: p.message ?? '',
      stamp: p.createdAt ?? null,
      priority: PRIORITY.plan_proposal_applied,
      actions,
    };
  }

  // accepted / dismissed / superseded / expired / no_change / undone never
  // interrupt. `no_change` is a rebuild that found nothing to do and `undone`
  // is a change the runner has already reversed; neither is news.
  return null;
}

/** "Tomorrow's" / "Today's" / "Thursday's" for the workout-proposal title. */
export function workoutDayLabel(iso: string, todayISO: string): string {
  if (iso === todayISO) return "Today’s";
  const t = Date.parse(todayISO + 'T12:00:00Z');
  const w = Date.parse(iso + 'T12:00:00Z');
  if (Number.isFinite(t) && Number.isFinite(w) && Math.round((w - t) / 86400000) === 1) {
    return "Tomorrow’s";
  }
  const d = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return 'That day’s';
  return (
    new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(d) +
    '’s'
  );
}

/** The concrete change, phrased once and reused in title and button. */
export function workoutActionPhrase(p: WorkoutProposalInput): string {
  if (p.actionKind === 'downgrade') {
    return `swap to ${p.actionPayload.newType ?? 'easy'}`;
  }
  if (p.actionKind === 'shave') {
    const frac = p.actionPayload.shaveFraction ?? 0.15;
    return `trim by ${Math.round(frac * 100)}%`;
  }
  if (p.actionKind === 'reschedule') {
    if (!p.actionPayload.newDate) return 'reschedule';
    const d = new Date(p.actionPayload.newDate + 'T12:00:00Z');
    if (Number.isNaN(d.getTime())) return 'reschedule';
    return `move to ${new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
    }).format(d)}`;
  }
  if (p.actionKind === 'field_test') return 'run as a 30 minute field test';
  return 'adjust';
}

function fromWorkoutProposal(p: WorkoutProposalInput, todayISO: string): CoachDecision {
  const day = workoutDayLabel(p.workoutDateISO, todayISO);
  const phrase = workoutActionPhrase(p);
  return {
    key: `workout-${p.id}`,
    source: 'workout_proposal',
    kind: 'decision',
    eyebrow: EYEBROW_DECISION,
    title: `${day} workout could ${phrase}`,
    body: p.reason ?? '',
    stamp: p.createdAt ?? null,
    priority: PRIORITY.workout_proposal,
    actions: [
      {
        role: 'accept',
        label: `ACCEPT · ${phrase.toUpperCase()}`,
        busyLabel: 'UPDATING',
        endpoint: `/api/plan/workout-proposals/${p.id}/accept`,
      },
      {
        role: 'keep',
        label: 'KEEP IT AS PLANNED',
        busyLabel: 'KEEPING',
        endpoint: `/api/plan/workout-proposals/${p.id}/dismiss`,
      },
    ],
  };
}

function fromAdaptation(a: AdaptationInput): CoachDecision {
  const isOverride = a.severity === 'override';
  return {
    key: `adapt-${a.ts}`,
    source: 'adaptation',
    kind: 'notice',
    eyebrow: EYEBROW_NOTICE,
    title: isOverride ? 'You overrode the plan' : 'The plan adapted',
    body: a.summary ?? '',
    stamp: a.ts,
    priority: PRIORITY.adaptation,
    actions: [],
  };
}

/* ── the selector ────────────────────────────────────────────────────── */

/**
 * Fold every interruption source into one ordered queue.
 *
 * Ordering, in this exact precedence:
 *   1. kind · every 'decision' precedes every 'notice'
 *   2. priority · the ladder above
 *   3. key · stable tiebreak so the pager never reshuffles between renders
 *
 * The consumer renders queue[index] and shows "index+1 of length waiting"
 * when length > 1.
 */
export function selectCoachDecisions(input: SelectDecisionsInput): CoachDecision[] {
  // CLIENT-ONLY fallback. With no `timeZone` option Intl formats in the
  // process default zone — which in the browser IS the runner's zone
  // (correct), and on the server is UTC (wrong). The only production
  // caller, CoachDecisionCard, is a client component and passes todayISO
  // explicitly. Any server-side caller MUST pass it: a UTC "today" here
  // ages every decision card a day early for a runner west of Greenwich.
  const todayISO = input.todayISO ?? new Intl.DateTimeFormat('en-CA').format(new Date());
  const excluded = new Set(input.excludeKinds ?? []);
  const out: CoachDecision[] = [];

  for (const p of input.coachProposals ?? []) out.push(fromCoachProposal(p));
  for (const p of input.planProposals ?? []) {
    if (excluded.has(p.kind)) continue;
    const d = fromPlanProposal(p);
    if (d) out.push(d);
  }
  for (const p of input.workoutProposals ?? []) out.push(fromWorkoutProposal(p, todayISO));
  for (const a of input.adaptations ?? []) out.push(fromAdaptation(a));

  return out.sort((a, b) => {
    const ka = a.kind === 'decision' ? 0 : 1;
    const kb = b.kind === 'decision' ? 0 : 1;
    if (ka !== kb) return ka - kb;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.key.localeCompare(b.key);
  });
}

/** Accent hex per kind. Amber = waiting on you. Recovery blue = applied. */
export function decisionAccent(kind: DecisionKind): string {
  return kind === 'decision' ? '#F3AD38' : '#27B4E0';
}

/**
 * Pager copy. Null when a single item waits (no pager chrome for one card).
 * Index is 0-based; the label is 1-based because runners count from one.
 */
export function pagerLabel(index: number, total: number): string | null {
  if (total <= 1) return null;
  return `${index + 1} OF ${total} WAITING ›`;
}
