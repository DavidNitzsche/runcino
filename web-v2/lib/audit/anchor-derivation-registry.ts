/**
 * lib/audit/anchor-derivation-registry.ts · CLAUDE.md Rule 10.
 *
 * "A value derived from a physiological anchor — LTHR, HRmax, VDOT, threshold
 * pace — that is written to a row and read back as authoritative MUST either
 * carry the anchor it was computed from, or be recomputed at read time."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EVERY OTHER GUARD IS BLIND TO THIS
 *
 * By construction. `lib/runs/derived-registry.ts` has nine families and all
 * nine ask whether a row agrees with ITSELF. `reconcileHrZones` asks whether
 * five numbers sum to 100. A distribution bucketed at a threshold the runner no
 * longer has is INTERNALLY PERFECT — it sums, it is well-shaped, every member
 * of its family agrees with every other — which is precisely why it survives
 * every check and wins permanently.
 *
 * The owner's 2026-08-30 long run — 13.49 mi at avg HR 159, an easy aerobic day
 * — is stored as `{z1:4,z2:15,z3:11,z4:10,z5:60}` and rendered 60% Zone 5,
 * because its shares were frozen at LTHR 162 while the anchor had been
 * re-derived to 168. Verified still on the row, unstamped, on 2026-08-30.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE POSTURES Rule 10 NAMES
 *
 *   · `recompute`       — the inputs survive on the row, so the derivation is
 *                         redone at read time and the persisted copy is a
 *                         cache, not an authority. `resolveHrZoneShares` in
 *                         `lib/coach/hr-zone-bucket.ts` is the worked example.
 *   · `stamped`         — the row carries `{anchor, value, at}` beside the
 *                         derivation, so a reader can tell a current value from
 *                         a stale one by looking. `projection_snapshots`'
 *                         `vdot_anchor_date` / `vdot_anchor_distance_mi` are
 *                         this, partially.
 *   · `refuse-or-label` — the surface declines to present the number as
 *                         authoritative, or labels it modelled/estimated.
 *   · `exempt`          — freezing is the INTENT and re-deriving would be the
 *                         bug. A watch heat-easing band records the band the
 *                         wrist actually held; recomputing it against today's
 *                         anchor would rewrite history. Requires an argued
 *                         reason, and the list is a ratchet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE SCANNER DOES WITH THIS FILE
 *
 * `_anchor_derivation_scan.test.ts` finds, mechanically:
 *
 *   1. Every call to a `DERIVATION_BUILDER` that passes a literal `null` (or
 *      omits the argument entirely, which is the same value) in a position
 *      declared to carry a physiological anchor, IN A FILE THAT ALSO WRITES a
 *      persisted derivation column. Omission counts — `app/api/plan/restore`
 *      wipes `hr_cap_bpm` by stopping at the fourth argument, not by writing a
 *      null into the sixth.
 *   2. Every registered site whose declared writers no longer match what
 *      `sql-scan.ts` reports, in either direction.
 *
 * A finding must carry an entry here. The two mistakes this file exists to stop
 * are both real and both shipped:
 *
 *   · ANCHOR-STALE-2 · `recompute-paces.ts` read the threshold off the FROZEN
 *     `authored_state.lthr_bpm` and passed `maxHr` as a literal null, so the
 *     one mechanism whose job is to bring a plan up to date re-cemented the
 *     anchor the plan was born with. Fixed `db3fb5e7`.
 *   · ANCHOR-STALE-3 · `adapt.ts:rebuildWorkoutDerivations` passed null for
 *     both, under the note that "the next briefing/render will re-load HR
 *     anchors." Nothing does — rendering and briefing are READ paths, and
 *     `preserveProgressionSql` carries forward exactly one key. So a shave did
 *     not leave the HR numbers stale, it DELETED them: `lthr_bpm`,
 *     `hr_target_bpm`, and both HR contingency rules the watch acts on
 *     mid-session.
 *
 * Both wrote the SAME false sentence about a downstream re-derivation that does
 * not exist. That sentence is the bug class, and a comment cannot be gated —
 * the call shape can.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FORMAT CONTRACT
 *
 * Every entry keeps `id:`, `posture:` and `anchor:` on ONE line each, single
 * quoted. That is what lets `scripts/check-anchor-derivation.sh` read this file
 * with no TypeScript toolchain on a cold container, exactly as
 * `check-doctrine.sh` reads its claims. Break the contract and the extractor
 * floor in that script fails the build rather than quietly reading fewer sites.
 */

/** The physiological anchors Rule 10 names. */
export type PhysiologicalAnchor = 'lthr' | 'hrmax' | 'vdot' | 'tpace';

/**
 * A function that turns an anchor into a number destined for a row, with the
 * ZERO-BASED argument positions that carry each anchor.
 *
 * Positions, not names, because the call sites are positional and several pass
 * six of eleven arguments. An argument that is absent is `null` by the
 * signature's own default, so the scanner treats omission and explicit null
 * identically — which is what catches `restore/route.ts`.
 */
export interface DerivationBuilder {
  /** The callee identifier as it appears in source. */
  fn: string;
  /** Zero-based argument index → which anchor sits there. */
  anchorArgs: ReadonlyArray<{ index: number; anchor: PhysiologicalAnchor }>;
  /** Total positional arity, so an omitted trailing anchor is still checked. */
  arity: number;
}

/**
 * Seeded 2026-08-30 from every `buildWorkoutSpec` call site in the repo.
 *
 * `buildWorkoutSpec(type, distance_mi, tPaceSec, lthr, prescription, maxHr, …)`
 * — `lthr` at index 3 and `maxHr` at index 5 are the two HR anchors. `tPaceSec`
 * at index 2 is a VDOT-derived pace and is NOT checked as an anchor here: it is
 * required, never defaulted, and every call site computes it fresh, so it has
 * no null-shaped failure mode to catch. Adding it would produce noise, not
 * findings.
 */
export const DERIVATION_BUILDERS: readonly DerivationBuilder[] = [
  {
    fn: 'buildWorkoutSpec',
    anchorArgs: [{ index: 3, anchor: 'lthr' }, { index: 5, anchor: 'hrmax' }],
    arity: 11,
  },
];

/**
 * Files that declare their OWN function sharing a builder's name, shadowing the
 * canonical import.
 *
 * The scanner's anchor positions describe the canonical signature. A fork has a
 * different one, so the positions mean something else and applying them yields
 * a finding about an argument that is not an anchor. The scanner therefore
 * skips a shadowing file — but only one named here, so a NEW fork fails the
 * build instead of quietly disappearing from coverage.
 *
 * A fork is itself worth knowing about: this one computes easy/long/recovery HR
 * caps at 88/85/75 % of LTHR, while the canonical `hrCapEasy` uses 89 % and
 * cross-checks the Daniels 78 %-HRmax ceiling. That divergence is real, is
 * confined to a one-off backfill script, and is recorded here rather than
 * fixed.
 */
export const DERIVATION_BUILDER_FORKS: readonly {
  file: string; fn: string; reason: string;
}[] = [
  {
    file: 'web-v2/scripts/backfill-workout-spec.mjs',
    fn: 'buildWorkoutSpec',
    reason:
      'A LOCAL FORK WITH A DIFFERENT SIGNATURE: '
      + '`buildWorkoutSpec(type, subLabel, distanceMi, paceSet, lthr)` — five '
      + 'parameters, LTHR at index 4 and no HRmax at all, against the canonical '
      + 'eleven with LTHR at 3 and HRmax at 5. The registry\'s positions describe '
      + 'the canonical shape, so checking them here would report on `paceSet`. Its '
      + 'HR math has also drifted (88/85/75 % of LTHR vs the canonical 89 % plus '
      + 'the 78 %-HRmax cross-check), which is a real divergence but belongs to a '
      + 'one-off backfill script, not the app. The live route that does this same '
      + 'job — app/api/admin/backfill-workout-spec — imports the canonical builder '
      + 'and passes live `lthr` and `maxHr`.',
  },
];

/**
 * Persisted columns whose contents are derived from a physiological anchor.
 * `table`/`column` are what `sql-scan.ts` reports, so the coverage check can
 * compare declared writers against the live source.
 */
export interface PersistedDerivation {
  table: string;
  column: string;
  /** The jsonb fields inside `column` that hold the derivation, if any. */
  fields: readonly string[];
  anchors: readonly PhysiologicalAnchor[];
}

export const PERSISTED_DERIVATIONS: readonly PersistedDerivation[] = [
  {
    table: 'plan_workouts',
    column: 'workout_spec',
    // Verified against prod 2026-08-30: hr_cap_bpm on 890 rows, hr_target_bpm
    // on 214, lthr_bpm on 88 (46 of them the literal 162). Read by the phone
    // Today card, the watch quality target, the recap's aerobic gate, the
    // easy-discipline detector and three glance surfaces.
    fields: ['hr_cap_bpm', 'lthr_bpm', 'hr_target_bpm', 'rules'],
    anchors: ['lthr', 'hrmax'],
  },
  {
    table: 'runs',
    column: 'data',
    // The 60%-Zone-5 row. Fixed at two READ sites (`run-state.ts`,
    // `/api/v5/today`) by routing through `resolveHrZoneShares`; the stored
    // value is still there and still unstamped.
    fields: ['hrZonePcts'],
    anchors: ['lthr'],
  },
  {
    table: 'projection_snapshots',
    column: 'vdot',
    fields: [],
    anchors: ['vdot'],
  },
];

/** How a site satisfies Rule 10. */
export type AnchorPosture = 'recompute' | 'stamped' | 'refuse-or-label' | 'exempt';

export interface AnchorDerivationSite {
  /** Stable id: the file, plus what it writes. */
  id: string;
  /** Repo-relative path, as `sql-scan.ts` reports it (`web-v2/…`). */
  file: string;
  /**
   * A VERBATIM substring of the call this entry is about. Rule 7: anchor on
   * quoted text, never a line number — line numbers rot on the next edit. If
   * this string stops appearing in the file, the entry is stale and the ratchet
   * fails until it is deleted or re-pointed.
   */
  anchor: string;
  posture: AnchorPosture;
  /** Argued. Not "it is fine". Enforced at >60 chars and screened for shrugs. */
  reason: string;
}

/**
 * Seeded 2026-08-30. Every entry below was checked against the live source and,
 * where it makes a claim about production, against the read-only replica —
 * not inferred from the audit that requested this gate.
 *
 * RATCHET. This list may shrink, never grow. An entry whose `anchor` string no
 * longer appears, or whose site no longer trips the scanner, is itself a
 * failure, so fixing a site forces the entry's deletion.
 */
export const ANCHOR_DERIVATION_SITES: readonly AnchorDerivationSite[] = [
  {
    id: 'generate.rep-count-relabel-probe',
    file: 'web-v2/lib/plan/generate.ts',
    anchor: 'day.type, day.distanceMi, reconcileTPaceSec, null, label,',
    posture: 'exempt',
    reason:
      'NOT A WRITE. This spec is a PROBE: the three lines after it read '
      + '`spec?.rep_count` to decide whether the authored label\'s rep count still '
      + 'matches what the builder would produce, and the spec object is then '
      + 'discarded — the only thing that escapes is `day.subLabel`, a string. Rep '
      + 'count is derived from distance and pace and carries no HR term, so a live '
      + 'threshold would change nothing it reads. The file writes `workout_spec` '
      + 'elsewhere (persistPlan, line ~9715), which is why the scanner sees it, and '
      + 'that call passes `args.lthr` and `args.maxHr` live.',
  },
  // NOT LISTED, and deliberately: `lib/plan/intensity-distribution.ts` calls
  // the builder with a null LTHR and a named constant T-pace, and writes
  // nothing — it computes an easy/hard split from the shape via
  // `hardMilesFromSpec`. The scanner's writer restriction excludes it, so an
  // entry here would be stale on the first run. That restriction is the reason
  // this registry stayed short enough to read: a builder called for its shape
  // and thrown away is not a Rule 10 problem, and flagging it would train
  // people to add exemptions rather than read them. (This entry existed for
  // one run and the ratchet deleted it, which is the ratchet working.)
  // `reanchor-plan.maintenance-arm` WAS HERE, AND IS DELETED (2026-08-31,
  // PRESCRIPTION-WIRE-1). Recorded rather than silently dropped, because the
  // ratchet's whole value is that a vanished entry is legible.
  //
  // Its exemption rested entirely on PARITY: `refreshedPaceAndSpec` had to emit
  // "IDENTICAL" specs to `seed-from-onboarding.ts`, so passing live HR anchors
  // in one and null in the other would fork the same runner's numbers. That
  // parity is gone — the maintenance arm now prices off canonical capacity and
  // the seeder still prices off the VDOT cascade — so the argument that
  // licensed the null went with it.
  //
  // The site is FIXED, not re-argued: the maintenance arm reads `profile.lthr`
  // raw and `loadEffectiveMaxHr`, the same two reads `recomputePacesForPlan`
  // makes, and threads them in. Rule 10's "recompute" posture.
  {
    id: 'seed-from-onboarding.onboarding-seed',
    file: 'web-v2/lib/plan/seed-from-onboarding.ts',
    anchor: '/* lthr */ null,',
    posture: 'exempt',
    reason:
      'CORRECT FOR 15 OF 16 PRODUCTION PROFILES, WRONG FOR THE ONE THAT MATTERS. '
      + 'Measured on the read-only replica 2026-08-30: exactly one of sixteen '
      + '`profile` rows carries an `lthr` at all. For the other fifteen the literal '
      + 'null IS the runner\'s threshold — there is nothing to read, and Rule 11 '
      + 'says an absent anchor must not be fabricated. For the owner, whose '
      + '`lthr_set_at` (2026-05-26) precedes his `onboarded_at` (2026-05-29), the '
      + 'seeder discarded a threshold it could have read. So the honest change is '
      + 'to read `profile.lthr` raw and let it be null when it is null: '
      + 'byte-identical for fifteen users, and it stops throwing away the one '
      + 'anchor that exists. Left for its own commit because it moves what every '
      + 'new plan is authored with. UPDATED 2026-08-31: the second half of this '
      + 'reason used to read "and because `reanchor-plan.ts` must move with it to '
      + 'keep the parity contract above." That contract no longer exists — '
      + 'PRESCRIPTION-WIRE-1 moved the re-anchor onto canonical capacity and fixed '
      + 'its HR reads, so this site is now the only one still passing a literal '
      + 'null and has nothing to stay in step with. It is a standalone fix waiting '
      + 'on the authoring-path migration, not a coupled one.',
  },
  {
    id: 'plan-restore.re-derive-on-restore',
    file: 'web-v2/app/api/plan/restore/route.ts',
    anchor: 'buildWorkoutSpec(restoredType, restoredDistanceMi, tPaceSec, null)',
    posture: 'exempt',
    reason:
      'A GENUINE OPEN DEFECT, recorded rather than silently fixed. This is the '
      + 'same shape as ANCHOR-STALE-3: it stops at the fourth argument, so `lthr` '
      + 'is an explicit null and `maxHr` is an omitted one, and it writes the '
      + 'result to `workout_spec`. Restoring an adapted quality workout therefore '
      + 'strips its `lthr_bpm` and both HR contingency rules, and the route\'s own '
      + 'comment ("Spec is deterministic from type + distance + VDOT") is the '
      + 'assumption that makes it look safe — it is not, the spec is also a '
      + 'function of the HR anchors. Not fixed in the ANCHOR-STALE-3 commit to '
      + 'keep that diff to the one function it was scoped to; it needs the same '
      + 'live-anchor read and its own falsification.',
  },
  {
    id: 'progression-pass.reshape-maxhr',
    file: 'web-v2/lib/plan/progression-pass.ts',
    anchor: 'maxHr · re-derives on the next full rebuild, same posture as',
    posture: 'exempt',
    reason:
      'HALF-CORRECT, AND ITS COMMENT IS NOW FALSE IN BOTH DIRECTIONS. It passes '
      + '`args.lthr` live, which is the anchor that matters for a reshaped rep '
      + 'session, so the severe half of the defect is absent. But its null `maxHr` '
      + 'is justified by citing "the same posture as adapt.ts '
      + 'rebuildWorkoutDerivations and recomputePacesForPlan" — and BOTH of those '
      + 'now read the live HRmax, so the cited posture no longer exists. Inert '
      + 'today: this call builds threshold/interval reshapes, and HRmax is read '
      + 'only by `hrCapEasy` and `raceAbortHrBpm`, neither of which those branches '
      + 'reach. Recorded so the stale citation is visible; the fix is one argument '
      + 'and belongs with whoever next touches this file.',
  },
];
