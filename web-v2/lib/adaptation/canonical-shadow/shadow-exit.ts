/**
 * lib/adaptation/canonical-shadow/shadow-exit.ts · EVERY WAY THE LIVE
 * CANONICAL SHADOW EVALUATION CAN END, AS A NAMED, MACHINE-READABLE FACT.
 *
 * David, 2026-09-05: "Determine why canonical shadow stopped after 9/3.
 * Instrument every exit: No active plan. Input missing. Belief conflict.
 * Evaluation refusal. Evaluation error. Persistence failure. Successful
 * write. Do not return 'cause unknown' again if the running system can be
 * instrumented and observed safely."
 *
 * ── WHAT WENT WRONG, AND WHY A STRING WAS NOT ENOUGH ──────────────────────
 *
 * `runAndPersistCanonicalShadowEvaluation` already reported every one of
 * these. It reported them as `{ ran: boolean, detail: string }` into
 * `console.warn`, from inside a cron loop, on Railway. Measured against
 * production on 2026-09-05:
 *
 *   canonical_adaptation_shadow_log      3 rows, 1 user, all written
 *                                        2026-09-03 18:22:28 UTC
 *   cron/run-adaptations `cron_ok`      12 rows, twice daily, most recent
 *                                        2026-09-05 07:30:52 UTC
 *   adaptation_shadow_log (the PACE      14 rows/day on 09-04 and 09-05 —
 *   shadow, the statement immediately    the loop reaches the line above
 *   ABOVE this one in the same loop)     this one every single pass
 *
 * The cron ran. The loop reached the call. The call returned `ran: false`
 * with a perfectly honest sentence naming the cause, four times a day, for
 * two days, and nothing anywhere could see it. The cause was
 * `DATABASE_URL_RO` never having been set on the Railway service — so the
 * function returned on its FIRST LINE, every time, and the three rows that
 * do exist came from one hand-run of
 * `scripts/p0-proof/trigger-canonical-shadow-once.ts` on a laptop whose
 * `.env.local` has that variable.
 *
 * It never stopped after 9/3. It never started.
 *
 * ── THE RULE THIS FILE ENFORCES ───────────────────────────────────────────
 *
 * CLAUDE.md Rule 11 · "don't know", "measured zero" and "the read failed"
 * are three facts, never one. Applied here: a runner with no race, a plan
 * whose belief anchor is missing, and a database read that threw are three
 * different things, and an operator seeing "nothing was written" must be
 * able to tell which one happened WITHOUT reading a log line.
 *
 * So every exit carries:
 *
 *   · `code`    — one of ten, closed set, greppable, storable
 *   · `health`  — OK / EXPECTED / DEFECT. This is the load-bearing field.
 *                 EXPECTED means the system worked and the honest answer was
 *                 "nothing to say about this runner". DEFECT means something
 *                 is broken and a human must act. Collapsing those two is
 *                 exactly how a job stays silently dead for two days.
 *   · `detail`  — the sentence a human reads.
 *   · `remedy`  — for a DEFECT, what actually fixes it. Named, not implied.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT DO ────────────────────────────────────
 *
 *   · It cannot make a wrong coaching decision visible. `WROTE` means rows
 *     landed, not that the engine was right. Nothing here grades a decision.
 *   · It cannot notice an exit that no call site reports. It is a vocabulary,
 *     not a scanner; `_shadow_exit_taxonomy.test.ts` is what pins the call
 *     sites to it, by deriving the set of codes actually constructed in
 *     `run-live-shadow-evaluation.ts` and `live-input.ts` from source.
 *   · It cannot tell "the cron did not run" from "the cron ran and exited".
 *     `lib/ops/cron-ledger.ts` owns that question and already answers it;
 *     this file deliberately does not offer a second answer (Rule 16).
 */

/** The closed set. Adding one means adding a row to `SHADOW_EXITS` below,
 *  which is what makes `health` and `remedy` impossible to forget. */
export type ShadowExitCode =
  /** `DATABASE_URL_RO` is not configured, so the fenced read-only evidence
   *  connection cannot be built at all and nothing was attempted. THE 2026-09
   *  production cause. */
  | 'NO_RO_CONNECTION'
  /** This athlete has no `training_plans` row with `archived_iso IS NULL`.
   *  Nothing to evaluate, and nothing is wrong. */
  | 'NO_ACTIVE_PLAN'
  /** A read THREW while assembling the input. Not the same as data being
   *  absent — something is broken. */
  | 'INPUT_READ_FAILED'
  /** A required input is genuinely absent: no linked race, no race distance,
   *  no race date. The plan is under-specified; the system is fine. */
  | 'INPUT_MISSING'
  /** The plan carries no usable capacity belief to evaluate against — its
   *  `authored_state` has no readable threshold pace, so there is no anchor
   *  for the engine to agree or disagree with. */
  | 'BELIEF_CONFLICT'
  /** `evaluateAdaptation` threw, which its own contract says never happens.
   *  Always a defect in the engine or its input. */
  | 'EVALUATION_ERROR'
  /** The engine ran to completion and REFUSED on every lever. A real,
   *  correct, informative answer — and the one most easily mistaken for
   *  "nothing happened". */
  | 'EVALUATION_REFUSAL'
  /** `canonical_adaptation_shadow_log` does not exist on this database, so
   *  records were computed and could not be kept. */
  | 'PERSISTENCE_UNAVAILABLE'
  /** The table exists and the INSERT threw. */
  | 'PERSISTENCE_FAILED'
  /** At least one decision record was written. The healthy path. */
  | 'WROTE';

/**
 * OK      · the mechanism did its job.
 * EXPECTED· the mechanism did its job and the honest answer was "nothing".
 *           No human action is implied.
 * DEFECT  · something is broken. A human must act, and `remedy` says how.
 */
export type ShadowExitHealth = 'OK' | 'EXPECTED' | 'DEFECT';

interface ShadowExitSpec {
  readonly health: ShadowExitHealth;
  /** What fixes it. Non-null exactly when `health === 'DEFECT'` — asserted
   *  by `_shadow_exit_taxonomy.test.ts`, so a new DEFECT cannot be added
   *  without saying what to do about it. */
  readonly remedy: string | null;
}

export const SHADOW_EXITS: Readonly<Record<ShadowExitCode, ShadowExitSpec>> = {
  NO_RO_CONNECTION: {
    health: 'DEFECT',
    remedy:
      'Set DATABASE_URL_RO on the Railway service to the faff_readonly role\'s connection '
      + 'string. The evaluation deliberately refuses rather than falling back to the '
      + 'writable pool (lib/adaptation/canonical-shadow/read-only-db.ts), so nothing runs '
      + 'until it is set.',
  },
  NO_ACTIVE_PLAN: { health: 'EXPECTED', remedy: null },
  INPUT_READ_FAILED: {
    health: 'DEFECT',
    remedy:
      'A database read threw while assembling the evidence. Check the read-only connection '
      + 'and the query named in the detail. This is NOT "the runner has no data".',
  },
  INPUT_MISSING: { health: 'EXPECTED', remedy: null },
  BELIEF_CONFLICT: { health: 'EXPECTED', remedy: null },
  EVALUATION_ERROR: {
    health: 'DEFECT',
    remedy:
      'evaluateAdaptation threw. Its own header states it is structurally incapable of '
      + 'throwing, so either that claim is now false or the input violates a type contract. '
      + 'Reproduce with lib/adaptation/canonical-shadow/_live_shadow_probe.script.ts.',
  },
  EVALUATION_REFUSAL: { health: 'EXPECTED', remedy: null },
  PERSISTENCE_UNAVAILABLE: {
    health: 'DEFECT',
    remedy:
      'Apply web-v2/db/migrations/164_canonical_adaptation_shadow_log.sql. Records are being '
      + 'computed and thrown away until it lands.',
  },
  PERSISTENCE_FAILED: {
    health: 'DEFECT',
    remedy:
      'The INSERT into canonical_adaptation_shadow_log threw. Check the column list in '
      + 'run-live-shadow-evaluation.ts against the live table shape — a migration that added '
      + 'or renamed a column is the usual cause.',
  },
  WROTE: { health: 'OK', remedy: null },
};

export interface ShadowExit {
  readonly code: ShadowExitCode;
  readonly health: ShadowExitHealth;
  /** One sentence a human reads. Never empty. */
  readonly detail: string;
  /** Non-null exactly for DEFECT codes. */
  readonly remedy: string | null;
  /**
   * LIVENESS (Rule 18) · how much this pass actually looked at. A scanner
   * that reports clean because it read nothing is the worst outcome
   * available, and this is the field that makes that visible: an exit
   * reporting `recordsEvaluated: 0` alongside `code: 'WROTE'` is a
   * contradiction the gate rejects.
   */
  readonly recordsEvaluated: number;
  readonly recordsPersisted: number;
}

export function shadowExit(
  code: ShadowExitCode,
  detail: string,
  counts: { recordsEvaluated?: number; recordsPersisted?: number } = {},
): ShadowExit {
  const spec = SHADOW_EXITS[code];
  return {
    code,
    health: spec.health,
    detail,
    remedy: spec.remedy,
    recordsEvaluated: counts.recordsEvaluated ?? 0,
    recordsPersisted: counts.recordsPersisted ?? 0,
  };
}

/** Every code, for a caller building a per-pass histogram that must show a
 *  ZERO rather than omitting the key — an absent key and a zero read the
 *  same to a human skimming JSON, and they are not the same fact. */
export const ALL_SHADOW_EXIT_CODES: readonly ShadowExitCode[] =
  Object.keys(SHADOW_EXITS) as ShadowExitCode[];

/**
 * The verdict for a WHOLE cron pass, across every athlete.
 *
 * This is the sentence that would have caught the 2026-09 outage on the
 * first night. It is deliberately NOT "did anything get written" — a pass
 * where every runner honestly had nothing to say is healthy, and a pass
 * where one runner's read threw is not, even if six others wrote fine.
 */
export interface ShadowPassVerdict {
  readonly athletes: number;
  /** Every code, including the zeroes. */
  readonly byCode: Readonly<Record<ShadowExitCode, number>>;
  readonly defects: number;
  readonly recordsPersisted: number;
  readonly severity: 'info' | 'warn' | 'error';
  readonly message: string;
}

export function summarisePass(exits: readonly ShadowExit[]): ShadowPassVerdict {
  const byCode = Object.fromEntries(
    ALL_SHADOW_EXIT_CODES.map((c) => [c, 0]),
  ) as Record<ShadowExitCode, number>;
  for (const e of exits) byCode[e.code] += 1;

  const defects = exits.filter((e) => e.health === 'DEFECT').length;
  const recordsPersisted = exits.reduce((a, e) => a + e.recordsPersisted, 0);

  // Rule 11, at the pass level. THREE outcomes, not two:
  //
  //   error · at least one athlete hit a DEFECT. Something is broken.
  //   warn  · nothing broke and nothing was written either. Legitimate — every
  //           runner may honestly have had nothing to say — but a pass that
  //           writes nothing for many days running is how a dead mechanism
  //           looks, so it is not filed as `info`.
  //   info  · rows landed.
  //
  // A pass over ZERO athletes is `error`, not `info`: the loop reading no
  // users is indistinguishable from a healthy quiet night in every previous
  // version of this reporting, and that is precisely the liveness failure
  // Rule 18 names.
  if (exits.length === 0) {
    return {
      athletes: 0, byCode, defects, recordsPersisted,
      severity: 'error',
      message:
        'The canonical shadow pass evaluated ZERO athletes. That is not a quiet night — '
        + 'nothing was looked at, so nothing could be reported either way.',
    };
  }
  if (defects > 0) {
    const worst = exits.find((e) => e.health === 'DEFECT')!;
    return {
      athletes: exits.length, byCode, defects, recordsPersisted,
      severity: 'error',
      message:
        `Canonical shadow: ${defects}/${exits.length} athletes hit a DEFECT. `
        + `First: ${worst.code} — ${worst.detail} Remedy: ${worst.remedy}`,
    };
  }
  if (recordsPersisted === 0) {
    return {
      athletes: exits.length, byCode, defects, recordsPersisted,
      severity: 'warn',
      message:
        `Canonical shadow: ${exits.length} athletes evaluated, nothing broke, and NO records `
        + `were persisted. Every exit was an honest "nothing to say" — `
        + `${describeHistogram(byCode)}.`,
    };
  }
  return {
    athletes: exits.length, byCode, defects, recordsPersisted,
    severity: 'info',
    message:
      `Canonical shadow: ${recordsPersisted} records persisted across ${exits.length} athletes — `
      + `${describeHistogram(byCode)}.`,
  };
}

function describeHistogram(byCode: Readonly<Record<ShadowExitCode, number>>): string {
  const parts = ALL_SHADOW_EXIT_CODES
    .filter((c) => byCode[c] > 0)
    .map((c) => `${c}×${byCode[c]}`);
  return parts.length > 0 ? parts.join(', ') : 'no exits recorded';
}
