/**
 * lib/prescription/hr-ceiling.ts · WHICH heart rate the session asked you to
 * stay under, and OVER WHAT.
 *
 * PURE. A `workout_spec` in, a ceiling out.
 *
 * ── WHY THIS EXISTS (Rule 16) ───────────────────────────────────────────────
 *
 * "The heart-rate ceiling" was three different quantities under one name, and
 * the same three-rung ladder was retyped at three call sites:
 *
 *     Number(spec.hr_cap_bpm ?? spec.hr_target_bpm ?? spec.lthr_bpm) || null
 *
 * — `app/api/v5/today/route.ts`, `lib/watch/build-workout.ts`, and (before
 * this file) `lib/postrun/load.ts`. Each then re-derived `askedHrIsHardCap`
 * from `hr_cap_bpm > 0`, because only the first rung is a ceiling at all: the
 * second is a target to hover near and the third is a bare LTHR reference. A
 * threshold session that reached its own LTHR executed exactly as asked, and
 * inking that amber grades the point of the session as a fault.
 *
 * ── AND THE ONE THE LADDER NEVER LOOKED AT ──────────────────────────────────
 *
 * `spec.rules` carries a `pass` rule authored by `spec-builder.ts` off
 * `thresholdPassHrBpm(lthr)` — for the owner's 2026-09-01 threshold session,
 * `{kind:'pass', metric:'hr', op:'<=', scope:'work', value:164,
 *   label:'Pass: avgHr ≤ 164 on the work'}`. That is a genuine, doctrine-cited,
 * runner-facing ceiling. It is what the wrist shows. No server reader has ever
 * read it, so the post-run screens said nothing about what the session cost on
 * exactly the sessions where the plan had stated a cost budget.
 *
 * ── SCOPE IS PART OF THE ANSWER, NOT A FOOTNOTE ─────────────────────────────
 *
 * The pass rule's ceiling is scoped to the WORK phases. `hr_cap_bpm` is a
 * whole-run ceiling. Comparing a whole-run average against a work-scoped
 * ceiling is the Rule 16 scope error in its purest form — the number is real,
 * the ceiling is real, and putting them beside each other states something
 * neither of them says. So a caller asks for the scope it can honestly measure
 * and gets a ceiling for THAT scope or nothing.
 *
 * ── RULE 22 · WHAT THIS CANNOT FAIL ON ──────────────────────────────────────
 *
 *   · It reads what the spec says, not whether the spec is right. A wrong
 *     `hr_cap_bpm` is returned faithfully.
 *   · It cannot see the runner's live LTHR, so a spec frozen at a stale anchor
 *     (Rule 10) is returned as authored. Re-anchoring is `recompute-paces`'s
 *     job and this file must not become a second answer to it.
 */

export type HrCeilingScope = 'work' | 'overall';

export interface HrCeiling {
  bpm: number;
  scope: HrCeilingScope;
  /** Where it came from, for a report or a test. Never rendered. */
  source: 'pass_rule' | 'hr_cap_bpm';
}

interface RuleLike {
  kind?: unknown; metric?: unknown; op?: unknown; scope?: unknown; value?: unknown;
}

/** A bpm, or null. Written as guards rather than a ternary-to-absence so the
 *  two rejections stay separable: `NaN` is "the spec did not say", and a
 *  non-positive value is "the spec said something that is not a heart rate".
 *  Neither is a ceiling, and neither may be spent as zero. */
function positive(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.round(n);
}

/**
 * The ceiling for the WORK, or null.
 *
 * Only the `pass`/`hr`/`<=`/`work` rule qualifies. `hr_cap_bpm` deliberately
 * does NOT fall through to here: it bounds the whole run, and a whole-run mean
 * ceiling says nothing about what a rep may average.
 */
export function workHrCeiling(spec: Record<string, unknown> | null | undefined): HrCeiling | null {
  const rules = spec && Array.isArray((spec as { rules?: unknown }).rules)
    ? ((spec as { rules: RuleLike[] }).rules)
    : [];
  for (const r of rules) {
    if (!r || typeof r !== 'object') continue;
    if (r.kind !== 'pass' || r.metric !== 'hr' || r.op !== '<=' || r.scope !== 'work') continue;
    const bpm = positive(r.value);
    if (bpm != null) return { bpm, scope: 'work', source: 'pass_rule' };
  }
  return null;
}

/**
 * The ceiling for the WHOLE RUN, or null.
 *
 * `hr_cap_bpm` only. `hr_target_bpm` is a target and `lthr_bpm` is a
 * reference — both fine to DISPLAY as an ask, neither a thing to be under.
 */
export function overallHrCeiling(spec: Record<string, unknown> | null | undefined): HrCeiling | null {
  const bpm = positive(spec?.hr_cap_bpm);
  return bpm != null ? { bpm, scope: 'overall', source: 'hr_cap_bpm' } : null;
}

/**
 * The number a screen may print beside the word "asked", and whether it is a
 * CEILING or merely a reference.
 *
 * This is the three-rung ladder the three call sites were each retyping, now
 * with one home. `isCeiling` is false on the lower two rungs, and a surface
 * that grades against a non-ceiling has said something the plan did not.
 */
export function displayedHrAsk(
  spec: Record<string, unknown> | null | undefined,
): { bpm: number; isCeiling: boolean } | null {
  const cap = positive(spec?.hr_cap_bpm);
  if (cap != null) return { bpm: cap, isCeiling: true };
  const target = positive(spec?.hr_target_bpm);
  if (target != null) return { bpm: target, isCeiling: false };
  const lthr = positive(spec?.lthr_bpm);
  if (lthr != null) return { bpm: lthr, isCeiling: false };
  return null;
}
