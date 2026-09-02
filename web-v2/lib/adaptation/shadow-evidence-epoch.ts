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
    digest: 'b9696cd4ec75eb97',
    why: 'Pinned at the epoch. Owns threshold / high-intensity / easy-ceiling / durability capacity — every number the PACE lever compares a plan against.',
  },
  {
    file: 'lib/training/prescription-resolver.ts',
    digest: '9f5f731e0bde03f2',
    why: 'Pinned at the epoch. Turns capacity into the prescribed anchors a phase breakdown is priced from.',
  },
  {
    file: 'lib/training/durability-anchor.ts',
    digest: '4a8aa1ad46a6f54a',
    why: 'Pinned at the epoch. The endurance exponent carries threshold to race distance, so a change here moves the marathon-pace anchor and the race outlook.',
  },
  {
    file: 'lib/training/runner-state.ts',
    digest: '78aa27b7b8e54cd1',
    why: 'Pinned at the epoch. The state that gates the whole upward path (STATE_BLOCKS_PROGRESS).',
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
    digest: 'a1f890d72ab89d3a',
    why: 'Pinned at the epoch. The outlook the race rows and the expected-race-day number are resolved from.',
  },
  {
    file: 'lib/training/pace-corpus.ts',
    digest: 'ee2247d56d7cf0bf',
    why: 'Pinned at the epoch. The threshold corpus and its admission rules — the P0 correction that created this epoch landed here.',
  },
];
