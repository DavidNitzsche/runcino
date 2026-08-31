/**
 * lib/plan/plan-delta.ts · WHAT A REBUILD ACTUALLY CHANGED.
 *
 * ─── why this file exists ────────────────────────────────────────────────────
 *
 * 2026-08-25, 09:29:32 UTC. The `plan-drift` cron fired `long_drift` against
 * the owner's post-race recovery block, ran `generatePlan`, archived the
 * fourteen-day block he was in the middle of and authored a seven-day one. His
 * week went from 23 miles to 38. He found out because the week counter reset.
 *
 * Two things were missing and both of them are answered by the same question —
 * *what changed?* — asked at the one moment the answer is cheap, which is
 * inside the rebuild transaction with both plans in hand:
 *
 *   1. NOTHING SHOULD HAPPEN WHEN NOTHING CHANGED. A rebuild whose output is
 *      byte-identical to the block it replaces still archives that block. It
 *      burns the block identity, resets the week counter, and mints a notice
 *      card, in exchange for nothing at all. `samePrescription` is the gate:
 *      generate.ts rolls the whole transaction back when it fires, and the
 *      runner keeps the block they were in.
 *
 *   2. THE NOTICE HAD NO CONTENT. `plan_proposals.reasons.message` carried the
 *      drift SIGNAL ("your long runs have drifted from this plan's targets"),
 *      which is the *why*. Nothing anywhere carried the *what*. `computeDelta`
 *      produces it and `describeDelta` says it in coach voice: "Drift raised
 *      this week from 23 to 38 miles, and the long run from 7 to 13."
 *
 * ─── PURE ────────────────────────────────────────────────────────────────────
 *
 * No pg, no fetch, no Date.now(). Every input is passed in, `todayISO`
 * included. That is what lets `_plan_delta.test.ts` state the 2026-08-25
 * numbers as a fixture and assert the sentence the runner would have read.
 *
 * ─── THE FINGERPRINT, AND WHAT IT DELIBERATELY IGNORES ───────────────────────
 *
 * `prescriptionFingerprint` is the equality the no-op gate turns on, so the two
 * ways it can be wrong are not symmetric:
 *
 *   TOO NARROW (ignores a field that is really a prescription) → a genuine
 *   change is suppressed and the runner's plan silently fails to update. This
 *   is the dangerous direction.
 *
 *   TOO WIDE (includes something incidental, like a row id) → the gate never
 *   fires, and we are exactly where we were this morning. Wasteful, not
 *   harmful.
 *
 * So it errs wide. It covers every field `persistPlan` writes that the runner
 * or any surface can read as an instruction — type, distance, target pace,
 * sub-label, spec, quality/long flags, notes — plus the block's own shape
 * (mode, race, goal date, week starts, phase labels, race-week and cutback
 * flags). It ignores exactly three things, each because it is guaranteed to
 * differ between any two separately authored plans and means nothing:
 *
 *   · row ids (`pln_…`, `pw_…`, `wk_…`, `phs_…`) — freshly minted per plan
 *   · `dow` — a pure function of `date_iso`
 *   · `original_*` — the runner's own adapter history, not the prescription
 *
 * `workout_spec` is jsonb and key order out of Postgres is not guaranteed
 * stable across two separately-built objects, so it is canonicalised
 * (recursively key-sorted) before it enters the string. Comparing raw
 * `JSON.stringify` would make every rebuild look like a change, which is the
 * harmless direction but would also make the gate dead code.
 */

// ONE WAY TO WRITE A NUMBER DOWN. `roundTo` and `miNum` are the app's single
// distance rounding and single distance rendering — the same pair the recap and
// the poster were split over until they were unified. A module that produces a
// sentence a runner reads has no business spelling its own.
import { roundTo, miNum } from '@/lib/format/run';
import { createHash } from 'crypto';

/** One prescribed day, as the fingerprint and the delta read it. */
export interface PrescribedDay {
  dateISO: string;
  type: string;
  distanceMi: number | null;
  paceTargetSPerMi: number | null;
  subLabel: string | null;
  workoutSpec: unknown;
  isQuality: boolean;
  isLong: boolean;
  notes: string | null;
}

/** One week's shape. Week ids are excluded on purpose; the start date is the key. */
export interface PrescribedWeek {
  startISO: string;
  phase: string;
  isRaceWeek: boolean;
  isCutback: boolean;
}

/**
 * A whole block, reduced to what it prescribes. `planId` is carried for the
 * caller's benefit and is NOT part of the fingerprint — two plans with
 * different ids and identical content are, for this module's purposes, the
 * same plan.
 */
export interface PlanPrescription {
  planId: string;
  mode: string | null;
  raceId: string | null;
  goalISO: string | null;
  weeks: PrescribedWeek[];
  days: PrescribedDay[];
}

/** An empty block. What a runner with no active plan has. */
export const EMPTY_PRESCRIPTION: PlanPrescription = {
  planId: '',
  mode: null,
  raceId: null,
  goalISO: null,
  weeks: [],
  days: [],
};

// ── fingerprint ───────────────────────────────────────────────────────────────

/**
 * Recursively key-sorted JSON. Two structurally equal jsonb values produce the
 * same string regardless of the key order Postgres happened to return.
 *
 * Arrays keep their order — an interval list is a sequence, not a set, and
 * sorting it would make a reordered workout look unchanged.
 */
function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Distances compare at the precision the column stores, so 7 and 7.0 agree. */
function num2(n: number | null): string {
  return n == null || !Number.isFinite(n) ? 'null' : n.toFixed(2);
}

/** One day, as a line. Exported so a failing test can print the offending day. */
export function dayFingerprint(d: PrescribedDay): string {
  return [
    d.dateISO,
    d.type,
    num2(d.distanceMi),
    d.paceTargetSPerMi == null ? 'null' : String(Math.round(d.paceTargetSPerMi)),
    d.subLabel ?? '',
    d.isQuality ? 1 : 0,
    d.isLong ? 1 : 0,
    (d.notes ?? '').trim(),
    canonicalJson(d.workoutSpec ?? null),
  ].join('|');
}

/**
 * The whole block as a stable string. Equality of two fingerprints is the
 * definition of "this rebuild changed nothing".
 */
export function prescriptionFingerprint(p: PlanPrescription): string {
  const weeks = [...p.weeks]
    .sort((a, b) => (a.startISO < b.startISO ? -1 : a.startISO > b.startISO ? 1 : 0))
    .map((w) => `${w.startISO}|${w.phase}|${w.isRaceWeek ? 1 : 0}|${w.isCutback ? 1 : 0}`)
    .join('\n');
  const days = [...p.days]
    .sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0))
    .map(dayFingerprint)
    .join('\n');
  return [
    `MODE ${p.mode ?? ''}`,
    `RACE ${p.raceId ?? ''}`,
    `GOAL ${p.goalISO ?? ''}`,
    `WEEKS\n${weeks}`,
    `DAYS\n${days}`,
  ].join('\n');
}

/**
 * A fingerprint reduced to something a jsonb field can hold and an index can
 * compare. The full fingerprint is one line per prescribed day; a sixteen-week
 * block runs to several kilobytes, and storing that on every undo row to
 * compare it by string equality would be storing a whole plan twice.
 *
 * SHA-256 truncated to 32 hex characters (128 bits). A collision here would
 * mean refusing a rebuild that merely looks like an undone one, over a search
 * space of one runner's blocks across fourteen days. 128 bits is not close.
 *
 * Deterministic and side-effect free, so this module stays testable without a
 * database despite reaching for node's crypto.
 */
export function fingerprintDigest(fingerprint: string): string {
  return createHash('sha256').update(fingerprint).digest('hex').slice(0, 32);
}

/**
 * True when a rebuild produced the block it was about to replace.
 *
 * FALSE when either side is empty. A runner with no active plan and a runner
 * whose new plan came out empty are both cases where "nothing changed" would
 * be a lie, and where rolling back would leave them with nothing.
 */
export function samePrescription(before: PlanPrescription, after: PlanPrescription): boolean {
  if (before.days.length === 0 || after.days.length === 0) return false;
  return prescriptionFingerprint(before) === prescriptionFingerprint(after);
}

// ── delta ─────────────────────────────────────────────────────────────────────

/**
 * What moved, in the terms the runner thinks in. Every number is READ off the
 * two persisted blocks — none of it is modelled, so none of it needs the `~`
 * mark the design reserves for a modelled number.
 */
export interface PlanDelta {
  /** Miles prescribed in the week containing `todayISO`. Null when neither
   *  block prescribes that week (a plan that starts next Monday). */
  thisWeekMiFrom: number | null;
  thisWeekMiTo: number | null;
  /**
   * BLOCKSWAP-1 · miles in the first week the NEW block fully owns — the week
   * starting the day after the current window ends.
   *
   * The forward number. A block replacement's honest headline is what the
   * runner is about to do, not a delta on a week that has already been run.
   * Optional because rows persisted before 2026-08-30 do not carry it, and a
   * sentence that needs it must degrade rather than print `undefined`.
   */
  nextWeekMiTo?: number | null;
  /** The long run in the week containing `todayISO`. */
  longRunMiFrom: number | null;
  longRunMiTo: number | null;
  /** Dates from today onward whose prescription is not identical. Includes
   *  days added and days removed. */
  daysChangedFromToday: number;
  /** Last prescribed date on each side. This is what caught the fourteen-day
   *  block being replaced by a seven-day one. */
  lastDayFrom: string | null;
  lastDayTo: string | null;
  /** Whole weeks on each side. */
  weeksFrom: number;
  weeksTo: number;
  /** True when nothing at all moved. `describeDelta` returns null for this. */
  unchanged: boolean;
}

/** Monday-agnostic: the week a plan prescribes is the week its own row starts. */
function weekWindowFor(p: PlanPrescription, todayISO: string): { startISO: string; endISO: string } | null {
  const today = todayISO.slice(0, 10);
  const candidates = [...p.weeks]
    .sort((a, b) => (a.startISO < b.startISO ? -1 : a.startISO > b.startISO ? 1 : 0));
  for (const w of candidates) {
    const end = addDaysISO(w.startISO, 6);
    if (w.startISO <= today && today <= end) return { startISO: w.startISO, endISO: end };
  }
  return null;
}

function addDaysISO(iso: string, days: number): string {
  const t = Date.parse(iso.slice(0, 10) + 'T12:00:00Z');
  if (!Number.isFinite(t)) return iso.slice(0, 10);
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Miles in a window. The race itself is excluded, exactly as the composer's
 * own VOL-1 reconcile excludes it: a marathon is not 26.2 miles of training
 * volume, and counting it makes race week read as the biggest week of the
 * block.
 */
function milesIn(days: PrescribedDay[], startISO: string, endISO: string): number {
  const total = days.reduce((s, d) => {
    if (d.dateISO < startISO || d.dateISO > endISO) return s;
    if (d.type === 'race') return s;
    return s + (d.distanceMi ?? 0);
  }, 0);
  return roundTo(total, 1);
}

/** The week's long run: the `is_long` day, or failing that its longest run. */
function longRunIn(days: PrescribedDay[], startISO: string, endISO: string): number | null {
  const inWeek = days.filter((d) => d.dateISO >= startISO && d.dateISO <= endISO && d.type !== 'race');
  if (inWeek.length === 0) return null;
  const flagged = inWeek.filter((d) => d.isLong && (d.distanceMi ?? 0) > 0);
  const pool = flagged.length > 0 ? flagged : inWeek;
  const max = pool.reduce((m, d) => Math.max(m, d.distanceMi ?? 0), 0);
  return max > 0 ? roundTo(max, 1) : null;
}

/**
 * The after block's days, completed with the before block's rows for elapsed
 * dates the after block did not author. See BLOCKSWAP-1 in `computeDelta`.
 *
 * Only dates strictly before `todayISO`, and only where the after side has no
 * row at all — an after row always wins, including one that prescribes rest,
 * because that IS the new block speaking.
 */
function effectiveAfterDays(
  beforeDays: PrescribedDay[],
  afterDays: PrescribedDay[],
  todayISO: string,
): PrescribedDay[] {
  const today = todayISO.slice(0, 10);
  const have = new Set(afterDays.map((d) => d.dateISO));
  const carried = beforeDays.filter((d) => d.dateISO < today && !have.has(d.dateISO));
  return carried.length > 0 ? [...afterDays, ...carried] : afterDays;
}

function lastDayOf(p: PlanPrescription): string | null {
  return p.days.reduce<string | null>(
    (m, d) => (m == null || d.dateISO > m ? d.dateISO : m), null,
  );
}

/**
 * Compare two blocks. `before` may be `EMPTY_PRESCRIPTION` (a first plan), in
 * which case every "from" number is null and the delta reads as an authoring
 * rather than a change.
 */
export function computeDelta(
  before: PlanPrescription,
  after: PlanPrescription,
  todayISO: string,
): PlanDelta {
  const today = todayISO.slice(0, 10);

  // The window is taken from the AFTER block when it has one, because that is
  // the week the runner is now looking at. Falling back to the before block
  // covers a rebuild that no longer prescribes this week at all.
  const win = weekWindowFor(after, today) ?? weekWindowFor(before, today);

  // BLOCKSWAP-1 (2026-08-30) · RULE 11 · A DAY THE NEW BLOCK MAY NOT AUTHOR
  // IS NOT A DAY IT PRESCRIBED ZERO MILES FOR.
  //
  // `persistsComposedDay` refuses to write any day before the runner's today
  // that is not sealed — the past is not the incoming block's to author, and
  // that is correct. The consequence is that a block authored mid-week emits
  // a PARTIAL current week, and `milesIn` summed that partial week against
  // the outgoing block's complete one. The difference is the days the new
  // block was structurally forbidden from mentioning, and it was rendered to
  // the runner as a decision: "cut this week from 45 to 38 miles", on the
  // first night of a block 45% BIGGER than the one it replaced.
  //
  // The prescription that actually stands for an elapsed day is the outgoing
  // block's — nobody revoked it, and the runner either ran it or did not. So
  // the after side is completed with the before side's rows for dates STRICTLY
  // BEFORE today that the after side does not carry. Today onward is left
  // alone: those days ARE the new block's to author, and a day it genuinely
  // dropped must keep counting as dropped.
  const afterWeekDays = win ? effectiveAfterDays(before.days, after.days, today) : after.days;

  const thisWeekMiFrom = win && before.days.length > 0 ? milesIn(before.days, win.startISO, win.endISO) : null;
  const thisWeekMiTo = win && after.days.length > 0 ? milesIn(afterWeekDays, win.startISO, win.endISO) : null;
  const longRunMiFrom = win && before.days.length > 0 ? longRunIn(before.days, win.startISO, win.endISO) : null;
  const longRunMiTo = win && after.days.length > 0 ? longRunIn(afterWeekDays, win.startISO, win.endISO) : null;

  // Days from today onward, by date, on both sides. A date present on one side
  // only counts as changed — that is a day added or a day taken away.
  const fpBefore = new Map<string, string>();
  for (const d of before.days) if (d.dateISO >= today) fpBefore.set(d.dateISO, dayFingerprint(d));
  const fpAfter = new Map<string, string>();
  for (const d of after.days) if (d.dateISO >= today) fpAfter.set(d.dateISO, dayFingerprint(d));
  let daysChangedFromToday = 0;
  for (const iso of new Set([...fpBefore.keys(), ...fpAfter.keys()])) {
    if (fpBefore.get(iso) !== fpAfter.get(iso)) daysChangedFromToday++;
  }

  const unchanged = before.days.length > 0 && after.days.length > 0
    && prescriptionFingerprint(before) === prescriptionFingerprint(after);

  // The first week the new block fully owns. Read off the after block's own
  // rows — no completion from `before`, because this window is entirely in
  // the future and everything in it is the new block's to author.
  const nextWeekMiTo = (() => {
    if (!win || after.days.length === 0) return null;
    const start = addDaysISO(win.endISO, 1);
    const end = addDaysISO(start, 6);
    const has = after.days.some((d) => d.dateISO >= start && d.dateISO <= end);
    return has ? milesIn(after.days, start, end) : null;
  })();

  return {
    thisWeekMiFrom, thisWeekMiTo, nextWeekMiTo,
    longRunMiFrom, longRunMiTo,
    daysChangedFromToday,
    lastDayFrom: lastDayOf(before),
    lastDayTo: lastDayOf(after),
    weeksFrom: before.weeks.length,
    weeksTo: after.weeks.length,
    unchanged,
  };
}

// ── the sentence ──────────────────────────────────────────────────────────────

/**
 * Who moved it. The subject of the sentence, per trigger.
 *
 * The default is deliberately "The plan" and not a guess at a cause. Naming a
 * cause we do not have is the fabrication the doctrine gate exists to stop, and
 * a runner reading "Drift raised this week" about a settings change would be
 * being told something untrue about their own training.
 */
const DELTA_SUBJECT: Record<string, string> = {
  volume_drift: 'Drift',
  vdot_drift: 'Drift',
  easy_drift: 'Drift',
  long_drift: 'Drift',
  quality_drift: 'Drift',
  staleness: 'A refresh',
  goal_gap_widening: 'Closing the gap to your goal',
  race_date_changed: 'The new race date',
  goal_time_changed: 'The new goal time',
  a_race_added: 'Your new goal race',
  a_race_removed: 'Losing the goal race',
  race_graduate: 'The next block',
  recovery_complete: 'The end of recovery',
  plan_elapsed: 'The new block',
  maintenance_to_raceprep: 'The build window',
  replan: 'Your settings',
  plan_change: 'Your settings',
  settings_prefs: 'Your settings',
  proposal_accepted: 'The rebuild you accepted',
  silent_rebuild: 'A rebuild',
};

/**
 * `23` not `23.0`; `7.5` stays `7.5`.
 *
 * `miNum` refuses zero, because zero is not a distance and every formatter in
 * that module says so. Here a zero is meaningful — a week cut to nothing is
 * exactly the change a runner most needs to read — so it is spelled out rather
 * than dropped.
 */
function mi(n: number): string {
  if (!(n > 0)) return '0';
  return miNum(n) ?? '0';
}

/**
 * One line saying what moved, in coach voice: short, direct, no hype, no
 * exclamation marks, no emoji, no em dashes, no scolding.
 *
 * Returns NULL when there is nothing worth saying — an unchanged plan, or a
 * change too small to have a number attached. A null return is a real answer
 * and the caller must render nothing rather than reach for filler; a card that
 * says "your plan changed" and cannot say how is the card that was already
 * there on 2026-08-25.
 */
/**
 * BLOCKSWAP-1 · the kinds where one block ENDS and another is authored.
 *
 * For these, the current week is not a comparable quantity. The outgoing and
 * incoming blocks do not author the same population of days for the elapsed
 * part of it — `persistsComposedDay` forbids the new block from writing the
 * past — so their difference over that week is bookkeeping, never a coaching
 * decision. `computeDelta` now completes the population, but rows persisted
 * before that fix still carry the old numbers and `describeDelta` recomposes
 * the sentence from the STORED delta on every read. The owner's row id 60
 * holds `thisWeekMiTo: 38` permanently. Suppressing the clause here is what
 * stops him reading it, with no data write to a live plan.
 *
 * A block swap's story is the block.
 */
const BLOCK_REPLACEMENT_KINDS = new Set([
  'recovery_complete',
  'race_graduate',
  'plan_elapsed',
  'maintenance_to_raceprep',
]);

export function describeDelta(delta: PlanDelta, kind: string): string | null {
  if (delta.unchanged) return null;

  const subject = DELTA_SUBJECT[kind] ?? 'The plan';

  if (BLOCK_REPLACEMENT_KINDS.has(kind)) {
    // What is now in place, forward-looking, every number checkable against
    // the plan beside it. No delta, because there is no honest one to state:
    // the thing that happened is that a block was authored.
    //
    // The hero statement is the reason this is not simply suppressed to null.
    // "There's a world where we push forward and the plan has to push us more
    // and more. That's what the app is for." The first morning of a build is
    // the moment that sentence is most load-bearing, and the app was opening
    // on the word "cut".
    const weeks = delta.weeksTo > 0 ? delta.weeksTo : null;
    const opens = delta.nextWeekMiTo != null && delta.nextWeekMiTo > 0
      ? `, opening at ${mi(delta.nextWeekMiTo)} miles`
      : '';
    if (weeks != null) return `${subject} put a ${weeks}-week block in place${opens}.`;
    // No week count to stand on. Say the shape we do have rather than a number
    // we do not (Rule 11 — a refusal is a correct answer, filler is not).
    return `${subject} put a new block in place.`;
  }

  const clauses: string[] = [];

  const volMoved = delta.thisWeekMiFrom != null && delta.thisWeekMiTo != null
    && Math.abs(delta.thisWeekMiTo - delta.thisWeekMiFrom) >= 0.5;
  const longMoved = delta.longRunMiFrom != null && delta.longRunMiTo != null
    && Math.abs(delta.longRunMiTo - delta.longRunMiFrom) >= 0.5;

  // The verb tracks the WEEK, because that is the headline number. When only
  // the long run moved, it tracks that instead.
  const rising = volMoved
    ? (delta.thisWeekMiTo as number) > (delta.thisWeekMiFrom as number)
    : longMoved
      ? (delta.longRunMiTo as number) > (delta.longRunMiFrom as number)
      : null;
  const verb = rising == null ? 'reshaped' : rising ? 'raised' : 'cut';

  if (volMoved) {
    clauses.push(`this week from ${mi(delta.thisWeekMiFrom as number)} to ${mi(delta.thisWeekMiTo as number)} miles`);
  }
  if (longMoved) {
    clauses.push(`the long run from ${mi(delta.longRunMiFrom as number)} to ${mi(delta.longRunMiTo as number)}`);
  }

  if (clauses.length > 0) {
    return `${subject} ${verb} ${clauses.join(', and ')}.`;
  }

  // Neither headline number moved. Say what did, without inventing a number.
  if (delta.daysChangedFromToday > 0) {
    const n = delta.daysChangedFromToday;
    // Typographic apostrophe, matching the rest of the app's runner-facing copy
    // (decision-cards.ts, CoachDecisionCard). A straight quote here would be
    // the one visibly different sentence on the card.
    return `${subject} changed ${n} ${n === 1 ? 'day' : 'days'} from today on. The week’s mileage held.`;
  }
  if (delta.weeksFrom !== delta.weeksTo) {
    return `${subject} took the block from ${delta.weeksFrom} to ${delta.weeksTo} weeks.`;
  }
  return null;
}

/**
 * The line the runner reads when a block was replaced: what moved, then why.
 *
 * `why` is the drift signal's own message, which is the sentence the detector
 * already writes. It is appended rather than replaced because the two answer
 * different questions and the runner is owed both. When there is no delta to
 * describe, the why stands alone.
 */
export function deltaMessage(
  delta: PlanDelta | null,
  kind: string,
  why: string | null | undefined,
): string | null {
  const what = delta ? describeDelta(delta, kind) : null;
  const tail = (why ?? '').trim();
  if (what && tail) return `${what} ${tail}`;
  return what ?? (tail || null);
}
