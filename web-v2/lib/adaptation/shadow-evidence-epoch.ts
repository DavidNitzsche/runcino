/**
 * lib/adaptation/shadow-evidence-epoch.ts · WHICH GENERATION OF BELIEF a
 * shadow-compare record was produced under.
 *
 * ── WHY A SEPARATE STAMP ──────────────────────────────────────────────────
 *
 * The shadow log (`adaptation_shadow_log`, `docs/reports/adaptation-shadow-
 * log/*.jsonl`) is the evidence a promotion review reads to decide whether the
 * Adaptation Engine may ever move from shadow to authority. Every record
 * already carries the ENGINE's version (`modelVersion`). It did not carry the
 * versions of the BELIEFS the engine consumed — threshold capacity, the
 * Evidence Engine's per-activity classification, the reexamination rule, the
 * runner state, the race outlook — and on 2026-09-01 those beliefs were
 * corrected under the P0 coaching-loop push (`docs/reports/p0-coaching-loop-
 * completion-handback-2026-09-01.md` §3-§4: the threshold reader was rewritten
 * to consume Evidence Engine verdicts, the one-session hero move was capped,
 * staleness moved from the level to the support). A PACE proposal recorded
 * before that correction compared a plan against a belief the app no longer
 * holds. Its `modelVersion` says `1.0.0` either side of the correction, because
 * the engine did not change; the ground under it did.
 *
 * So a promotion review cannot filter pre-correction records by any version
 * the record carried. This constant is the filter. It names the belief
 * generation, and every record produced from here on carries it beside the
 * live version constants of each belief model (`BeliefModelStamp`).
 *
 * ── HOW TO USE IT ─────────────────────────────────────────────────────────
 *
 *   · A promotion review counts ONLY records whose `beliefModel.epoch` equals
 *     the current value of this constant. Records without a stamp, or with an
 *     older epoch, are history — kept (the JSONL files are git-tracked and are
 *     never rewritten), never counted.
 *   · BUMP THIS CONSTANT when a belief correction lands that changes what any
 *     capacity, evidence or outlook resolver would answer for the same
 *     activities. Not for a reason-code rename; for a change in the number a
 *     belief resolves to. The version constants beside it move on their own
 *     files' own rules and are recorded so a reviewer can see which one moved.
 *   · Never lower it, never reuse a value. The format is a date and a short
 *     name for the correction, so the log reads as a history and not as a
 *     counter.
 *
 * ── EPOCH HISTORY ─────────────────────────────────────────────────────────
 *
 *   1 · `2026-09-02.threshold-contract-f967cab1` — the P0 threshold-contract
 *       correction (deployed `f967cab1`, Railway `708a200b`). Superseded the
 *       same day, before the cron wrote a single record under it.
 *   2 · `2026-09-02.phase1-durability-59fed35e` — CURRENT. Phase 1 of the
 *       brain completion (`59fed35e` and the commits merged with it):
 *       durability spends representativeness and names a single-long-race
 *       exponent, capacity gains a cross-tier day-to-day continuity cap and a
 *       `trainingDurability` component, prescription gains
 *       `marathonRangeSecPerMi`, the threshold continuity chain is walked
 *       rather than sampled, and the race outlook reports its own age. FIVE of
 *       the eight pinned belief sources changed, and every one of them moves
 *       what a belief RESOLVES to for the same activities — branch (a) of the
 *       decision below. Shadow evidence restarts here.
 *
 * THE FIRST BUMP WAS NOT HYPOTHETICAL, and it is the strongest evidence this
 * mechanism is needed: Phase 1 changed all five of those files and left
 * `CAPACITY_MODEL_VERSION`, `PRESCRIPTION_MODEL_VERSION` and
 * `RACE_OUTLOOK_MODEL_VERSION` at `1.0.0`. A promotion review filtering on
 * those constants would have counted pre-Phase-1 records as current. The pin
 * gate went red on exactly the five changed files and forced this entry to be
 * written.
 */
export const SHADOW_EVIDENCE_EPOCH = '2026-09-02.runner-owns-readiness';

/** The epoch format: `YYYY-MM-DD.<slug>`. Pinned by test so a future value
 *  cannot drift into a bare counter or an undated label. */
export const SHADOW_EVIDENCE_EPOCH_PATTERN = /^\d{4}-\d{2}-\d{2}\.[a-z0-9][a-z0-9-]*$/;

/* ══════════════════════════════════════════════════════════════════════════
 * THE GATE · why a version constant cannot be the filter
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * WHY THE EPOCH IS PINNED TO FILE DIGESTS AND NOT TO THE BELIEF MODELS' OWN
 * VERSION CONSTANTS.
 *
 * The obvious design is "filter on `CAPACITY_MODEL_VERSION`". Measured on this
 * repo, 2026-09-02, that design does not work: `origin/brain/beliefs-thesis`
 * changes what the Coaching Thesis resolves (`c2ace1f4`, evidence-first primary
 * limiter) and what the pace rules admit (`7dbdc788`), and leaves
 * `CAPACITY_MODEL_VERSION` and `PRESCRIPTION_MODEL_VERSION` at `1.0.0` on both
 * sides. The same was true of the Phase 1 durability/capacity work in flight
 * while this was written. A belief can move without its own version constant
 * moving, so a promotion review that filtered on those constants would count
 * pre-correction records as current — the exact failure this mechanism exists
 * to prevent.
 *
 * So the epoch is a SEPARATE stamp a human bumps, and this digest list is what
 * makes "a human bumps it" a check rather than a hope (Rule 20: a product rule
 * with no gate is a hypothesis). If any belief file below changes, the gate
 * fails and the engineer landing the change makes ONE of two calls, explicitly:
 *
 *   · the change moves what a belief RESOLVES to for the same activities →
 *     bump `SHADOW_EVIDENCE_EPOCH` and re-pin the digest. Shadow evidence
 *     restarts from that epoch; older records stay as history, uncounted.
 *   · the change is comments, types, tests or a refactor that cannot move a
 *     resolved value → re-pin the digest alone, and say so in `why`.
 *
 * Neither branch is free, which is the point: the decision gets made by
 * someone who knows what they changed, instead of being inherited by silence.
 *
 * The digest is the first 16 hex of the file's SHA-256. It is deliberately
 * CONTENT, not an mtime or a git sha, so it is stable across worktrees,
 * checkouts and rebases.
 */
export interface BeliefSourcePin {
  /** Path relative to `web-v2/`. */
  file: string;
  /** First 16 hex characters of the file's SHA-256. */
  digest: string;
  /** Why the current digest was pinned — the last decision made about it. */
  why: string;
}

export const BELIEF_SOURCE_PINS: readonly BeliefSourcePin[] = [
  {
    file: 'lib/training/capacity-resolver.ts',
    digest: 'cf92e16d481c0801',
    why: 'Re-pinned at epoch 3 (brain integration) · epoch 2 pinned this file mid-Phase-1, before the continuity cap was made a faithful WALK (per-day fallback, per-day corroboration bar). That changed what the threshold belief resolves to for the same activities again — the owner\'s June replay moved from a 26 s/mi largest daily step to 9 — so the epoch bumps rather than the pin moving quietly. The pin caught it on the integration merge, which is exactly what it is for.',
  },
  {
    file: 'lib/training/prescription-resolver.ts',
    digest: '1658609e04cf69be',
    why: 'Re-pinned at epoch 4 (runner owns readiness) · `applyState` no longer acts. Its `reduce` limb used to replace a quality session with easy running at the same distance, and its `recover` / `replace` / `stop` limbs blanked the prescription outright (shape `none`, every pace null). Both are deleted: the states that reached them came from the readiness convergence and from the illness / injury / niggle arms of `runnerIsCompromised`, all removed on 2026-09-02 per PLAN_SIMPLIFICATION_DOCTRINE.md. The decision is still resolved and still recorded on `stateAdjustment`; it changes no pace, shape or distance. This is case (a), not (b) — the same activities now resolve to a DIFFERENT prescription on any day the state was not `proceed` — so the epoch bumps rather than the pin moving quietly.',
  },
  {
    file: 'lib/training/durability-anchor.ts',
    digest: '3ee67060d8ec22d8',
    why: 'Re-pinned at epoch 2 · Phase 1 weights race observations by representativeness and names a single-long-race exponent, which moves the endurance exponent and with it the marathon anchor.',
  },
  {
    file: 'lib/training/runner-state.ts',
    digest: '2056981b58a4be45',
    why: 'Re-pinned at epoch 4 (runner owns readiness) · `gradeConvergence` is no longer an input. It was the only signal that could carry this resolver past `proceed` on how a morning read, and the illness / injury / niggle arms of `runnerIsCompromised` went with it, so `COMPROMISED_DECISION` is down to a single `gap_reentry` row and `CONVERGENCE_DECISION` is deleted. What remains reads training: a comeback window, a post-race window the calendar authored, and ACWR. Case (a): the same activities resolve to a different state.',
  },
  {
    file: 'lib/evidence/activity-evidence.ts',
    digest: '1f84dadd9940fb1b',
    why: 'Pinned at the epoch. Every control judgement the PACE lever trusts — executionQuality, late collapse, internal cost — is this file\'s output.',
  },
  {
    file: 'lib/evidence/reexamination.ts',
    digest: '4da0110f3112bac1',
    why: 'Pinned at the epoch. Decides when belief tension relaxes the corroboration bar, which changes which sessions count.',
  },
  {
    file: 'lib/race/race-outlook.ts',
    digest: 'b2bc402ea22c691e',
    why: 'Re-pinned ALONE at epoch 3, branch (b), 2026-09-02 · CEFFORT-1 made `race.priority` load-bearing, so a C race is now priced as a controlled effort (Research/00b §"Recovery by Effort") instead of identically to an A race. What moved is `execution` — the target, the strategy label and the HR band for a C-effort DAY. What did NOT move is every belief a shadow record compares against: `capacity`, `currentProjection`, `expectedRaceDay` and `trainingPrescription` resolve byte-identically for the same activities, and an A or B race is untouched end to end (`_controlled_c_effort.test.ts` asserts that limb explicitly, as the control). A prescription for one day is not a belief about the runner, so no record written under epoch 3 compares against a number this changed, and bumping the epoch would discard the whole shadow corpus for a change that cannot move a single comparison. Stated rather than assumed, per this file\'s own instruction that the decision be made by someone who knows what they changed. '
      + 'Re-pinned ALONE again the same day (ROW-CONTRACT-1, also branch b): `coachSet` was DELETED. It was a '
      + 'second A/B/C ladder over `expectedRaceDay.likelyRangeSec`, 40 s from the one `lib/race/coach-goal.ts` '
      + 'owns and the race detail actually draws, and it was read by no route, no component and no Swift '
      + 'model. Removing an output nothing consumes cannot move a belief: the same four resolvers named above '
      + 'are untouched by it too. '
      + 'Re-pinned ALONE a third time, 2026-09-03, branch (b), for EXECTARGET-1 and CEFFORT-2, and the branch '
      + 'is argued rather than assumed. EXECTARGET-1 changes `execution.targetSec` from the stated goal '
      + 'clamped to the forecast range\'s fast edge to `currentProjection.expectedSec`, adds '
      + '`conditionalUpside` and `blockSeam`, and deletes two `execution.source` values '
      + '(docs/PROGRESSIVE_BASELINE_DOCTRINE.md Q7). CEFFORT-2 reprices a C race from the threshold carry to '
      + '0.6 of the span between threshold and the marathon anchor. Both move ONE DAY\'S PRESCRIPTION. The '
      + 'four resolvers a shadow record compares against — `capacity`, `currentProjection`, '
      + '`expectedRaceDay`, `trainingPrescription` — are byte-identical for the same activities, and '
      + '`_race_outlook_contract.test.ts` asserts each of them is unchanged by the stated goal across three '
      + 'postures. The new `blockSeam` READS `authored_state`; it resolves no belief and feeds none. Bumping '
      + 'the epoch would discard the whole shadow corpus for a change that cannot move a single comparison.',
  },
  {
    file: 'lib/training/pace-corpus.ts',
    digest: '573503045116ea89',
    why: 'Re-pinned at epoch 2 · Phase 1 walks the threshold continuity chain rather than sampling it, with a faithful per-day fallback, which moves which sessions carry the belief.',
  },
];
