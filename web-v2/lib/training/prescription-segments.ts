/**
 * lib/training/prescription-segments.ts · PARSER-SHARE-1 (2026-09-06) · the
 * ONE parser for a long run's prescription-string race-pace segments,
 * consumed by both AUTHORING (`lib/plan/spec-builder.ts` and its siblings in
 * `lib/plan/`) and EVIDENCE INTERPRETATION (`lib/adaptation/canonical/
 * deterioration.ts`).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────
 *
 * `extractLongSegments` was authored in `lib/plan/spec-builder.ts` (VARIETY-
 * LONG-1, 2026-08-28 · SEGLONG-1, 2026-08-29) to read a long day's sub_label
 * back into its ordered race-pace segments — `"LONG · 3mi @ M + 2mi @ T"` →
 * `[{mi:3, tag:'M'}, {mi:2, tag:'T'}]`. STEADYEFFORT-1 (2026-09-05) needed
 * the identical parse inside `lib/adaptation/canonical/deterioration.ts`, to
 * tell a deliberate fast-finish/progression long from genuine late-session
 * fade. Importing `spec-builder.ts` directly from `canonical/` would have
 * drawn an import edge from the shared, walled engine layer
 * (`lib/adaptation/canonical/` — consumed by the lever files, the shadow
 * live-input loader, and this directory's own siblings) INTO a `lib/plan/`
 * consumer of it, inverting the layering. The session that found this first
 * duplicated the regex locally instead, with a comment arguing the trade —
 * but David ruled against that directly: "Do not keep a duplicated
 * extractLongSegments regex. Move the prescription-shape parser into a
 * neutral shared module and make both authoring and evidence interpretation
 * consume it."
 *
 * This file is that neutral module. It sits in `lib/training/`, alongside
 * `aerobic-decoupling.ts` and `lib/terrain/grade-adjust.ts` — both already
 * imported directly into `lib/adaptation/canonical/deterioration.ts` for the
 * same reason: a shared PURE primitive that both a walled engine file and a
 * `lib/plan/` consumer need is not a "canonical/" concern or a "plan/"
 * concern, it belongs one level below both. Nothing in this file imports a
 * database, a pool, `fetch`, or anything from `lib/plan/` or
 * `lib/adaptation/`, so it cannot be the edge that inverts either layering —
 * only files that import IT can, and the import always runs outward from
 * this module, never into it.
 *
 * `lib/plan/spec-builder.ts#extractLongSegments` now re-exports this file's
 * function verbatim, so every existing `lib/plan/` caller
 * (`dosing.ts`, `intensity-distribution.ts`, `spec-builder.ts` itself, and
 * the test suites `_seglong_authoring.test.ts` / `_variety_invariants.test.ts`
 * / `expand-spec.test.ts`) is unaffected — same name, same module path, same
 * behaviour, byte-for-byte. `deterioration.ts`'s `steadyEffortReadabilityFrac`
 * now imports this file directly instead of carrying its own transcription.
 * `_prescription_segments_parity.test.ts` (in this directory) proves both
 * consumers resolve one prescription string to identical segment boundaries,
 * so a future edit here cannot silently diverge the two without a red test.
 */

/**
 * VARIETY-LONG-1 (2026-08-28) · EVERY race-pace segment of a long run's
 * prescription, in order.
 *
 * `Research/04` §4.3's progression long run walks TWO paces after its easy bulk
 * ("middle at strong E or M, final 1/4 to 1/3 at M to T"), which one
 * `finish_mi` cannot say. The generator writes it as
 * `"LONG · 3mi @ M + 2mi @ T"` and this reads all of the segments back — the
 * same one-carrier contract `extractFinishSegment` has always had, widened to a
 * list. A single-segment label returns a one-element list whose head is exactly
 * what `extractFinishSegment` returns (plus the `T` tag, which only the
 * multi-segment shape ever writes), so every single-segment consumer is
 * byte-identical.
 *
 * Tags: 'HM' half-marathon pace · 'M' marathon pace (also written MP) ·
 * 'T' threshold. Only ever read against a LONG day's sub_label.
 *
 * SEGLONG-1 (2026-08-29) · `E` joins the alternation so a long run can carry
 * easy running BETWEEN its quality blocks, not only in front of them.
 *
 * Until now every segment was contiguous and tail-anchored: the label named
 * quality blocks, the expander put all the easy miles in one bulk phase up
 * front, and the blocks ran back-to-back to the finish. That expresses a
 * progression or a fast finish, and cannot express the shape doctrine calls
 * a modified block (§11.1 Variations, "two segments separated by short
 * rest") or the broken long run a coach writes as 15/12/10 min of LT with
 * easy running between — repeated re-entry into threshold under accumulating
 * fatigue, which is a different stimulus from one sustained block.
 *
 * Note what is NOT changed: an easy token is folded into the PRECEDING
 * quality segment as its `recoveryMi` and never appended to the output, so
 * every existing consumer that sums `s.mi` as hard miles (dosing.ts's
 * per-bucket charge, intensity-distribution.ts's easy/quality split) stays
 * correct with no edit — the gap miles simply remain in the easy remainder,
 * which is what they are. A leading easy token, before any quality block, is
 * the opening bulk the expander already computes as the remainder, so it is
 * dropped.
 *
 * EVIDENCE-INTERPRETATION CONSUMERS (`deterioration.ts`'s
 * `steadyEffortReadabilityFrac`) use exactly this same function and read only
 * `mi` and `recoveryMi` off the result — the `tag` field is authoring-only
 * information (which pace bucket a segment doses against) that evidence
 * interpretation has no use for, but returning the full shape costs nothing
 * and keeps this ONE function rather than two that could drift.
 */
export function extractLongSegments(
  prescription?: string | null,
): Array<{ mi: number; tag: 'HM' | 'M' | 'T'; recoveryMi?: number }> {
  if (!prescription) return [];
  const out: Array<{ mi: number; tag: 'HM' | 'M' | 'T'; recoveryMi?: number }> = [];
  const re = /(\d+(?:\.\d+)?)\s*mi\s*@\s*(HM|MP|M|T|E)\b/gi;
  for (let m = re.exec(String(prescription)); m; m = re.exec(String(prescription))) {
    const mi = Number(m[1]);
    if (!Number.isFinite(mi) || mi <= 0) continue;
    const raw = m[2].toUpperCase();
    if (raw === 'E') {
      const prev = out[out.length - 1];
      if (prev) prev.recoveryMi = (prev.recoveryMi ?? 0) + mi;
      continue;
    }
    out.push({ mi, tag: raw === 'T' ? 'T' : raw.startsWith('H') ? 'HM' : 'M' });
  }
  return out;
}
