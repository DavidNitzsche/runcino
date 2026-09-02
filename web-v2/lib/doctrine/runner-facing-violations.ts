/**
 * lib/doctrine/runner-facing-violations.ts · the doctrine violations a RUNNER
 * can see, acknowledged by name.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `DOCTRINE_REGISTRY` lets a claim carry an `exempt` map: a recorded violation
 * with an argued reason, checked for staleness. That is the right instrument
 * for a deviation nobody outside the engine can observe — an unimplemented
 * altitude trigger, a 5K recovery profile that is structurally unreachable.
 *
 * It is the WRONG instrument for a violation the runner reads off his phone,
 * and on 2026-09-01 three of them were sitting in it:
 * `CONVENTION.simulator-projection-band` at 5K, 10K and half, each entry
 * opening with the words "REAL VIOLATION, RUNNER-FACING, NOT FIXED HERE".
 *
 * Two failures compounded and made them invisible:
 *
 *   1 · `scripts/check-doctrine.sh:114` ran `vitest run lib/doctrine --silent`,
 *       which suppressed the gate's own report line — `=== DOCTRINE · 323
 *       claims · 12 recorded violations ===` — on every build. The gate printed
 *       "doctrine OK · 323 citations resolve" and nothing else. The `--silent`
 *       is gone.
 *
 *   2 · Nothing distinguished a runner-facing violation from an internal one.
 *       Twelve entries, all equally quiet, and the three that change a number
 *       on somebody's screen read exactly like the nine that do not.
 *
 * ── THE INSTRUMENT ──────────────────────────────────────────────────────────
 *
 * Any exemption whose reason contains the string "RUNNER-FACING" must be
 * acknowledged here, by `claimId::exemptKey`, with an owner and a decision.
 * A new one fails the build. An entry here whose exemption is gone fails until
 * deleted. This is a RATCHET and it is not a licence: every row below is a
 * defect that is live in production right now, and the acknowledgement records
 * who has to decide, not that the decision was made.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22): it can only see a violation somebody
 * chose to write "RUNNER-FACING" into. A runner-facing deviation recorded in
 * neutral prose is invisible to it, exactly as these three were before anyone
 * looked. It is a floor on honesty, not a detector.
 */

export interface RunnerFacingViolation {
  /** `<claim id>::<exempt key>`, matching DOCTRINE_REGISTRY exactly. */
  id: string;
  /** Who decides. A person or a system, never "someone". */
  owner: string;
  /** What the runner actually sees, and what closing it would take. */
  decision: string;
}

export const RUNNER_FACING_ACKNOWLEDGED: readonly RunnerFacingViolation[] = [
  {
    id: 'CONVENTION.simulator-projection-band::band-tighter-than-doctrine:5K',
    owner: 'David · product decision. Widening the band changes what every 5K runner is '
      + 'shown, so it is not a gate fix and was not taken unilaterally.',
    decision: 'At a VDOT-48 anchor the 5K band is ±0.38% against Research §13.7\'s tightest '
      + 'published interval of ±1.5%, roughly four times too confident. A 19:46 projection '
      + 'produces an A-goal of 19:41 and a C-goal of 19:51: ten seconds apart is not three '
      + 'goals, it is one goal printed three times. Closes when SIGMA_SEC_PER_MILE\'s '
      + 'short-distance rows are resized against §13.7.',
  },
  {
    id: 'CONVENTION.simulator-projection-band::band-tighter-than-doctrine:10K',
    owner: 'David · product decision, same call as the 5K row; they get resized together.',
    decision: 'The same defect, half as severe: ±0.73% against §13.7\'s ±1.5% floor, so a '
      + '40:59 projection spans 38 seconds from A-goal to C-goal. §13.7\'s own 5K→10K row — a '
      + 'prediction from a race that actually happened, on the day — is ±1.5%, and a '
      + 'projection of fitness a runner does not have yet cannot be twice as certain as that.',
  },
  {
    id: 'CONVENTION.simulator-projection-band::band-tighter-than-doctrine:half',
    owner: 'David · product decision, same call as the 5K and 10K rows.',
    decision: 'MARGINAL: ±1.38% against §13.7\'s ±1.5% floor, under the line but only just, '
      + 'and in the same direction. Listed rather than rounded away because the marathon row '
      + 'clears the floor comfortably (±3.46% against a ±3% half→marathon entry), which shows '
      + 'the shape of the defect: the per-mile sigma is calibrated for the marathon and '
      + 'everything shorter inherits a band that is too tight.',
  },
];
