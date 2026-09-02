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
 * The first value names the P0 threshold-contract correction, deployed as
 * `f967cab1` (Railway `708a200b`, 2026-09-02T01:23Z for the race-row refresh
 * that ran inside production against it).
 */
export const SHADOW_EVIDENCE_EPOCH = '2026-09-02.threshold-contract-f967cab1';

/** The epoch format: `YYYY-MM-DD.<slug>`. Pinned by test so a future value
 *  cannot drift into a bare counter or an undated label. */
export const SHADOW_EVIDENCE_EPOCH_PATTERN = /^\d{4}-\d{2}-\d{2}\.[a-z0-9][a-z0-9-]*$/;
