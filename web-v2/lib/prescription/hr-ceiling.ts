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
  source: 'pass_rule' | 'hr_cap_bpm' | 'race_hr_expected_range_upper';
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
 * The race's own evidence-backed HR band UPPER BOUND, or null.
 *
 * F057-#8, 2026-09-15 · `spec.race_hr.expected_range_bpm` — the `[lo, hi]`
 * band `lib/race/race-row-refresh.ts` writes onto every race row right after
 * authoring and on every recompute (see `race-hr-guidance.ts`). Shared by
 * both `workHrCeiling` and `overallHrCeiling` below: a race's graded "work"
 * is usually the whole race distance (a warmup/cooldown outside it is the
 * exception, not the rule), so whichever scope `readCost` resolves for a
 * given race, this is the one real ceiling the row actually carries.
 */
function raceHrBandUpperBound(spec: Record<string, unknown> | null | undefined): number | null {
  const raceHr = spec?.race_hr as Record<string, unknown> | null | undefined;
  const band = raceHr && Array.isArray(raceHr.expected_range_bpm) ? raceHr.expected_range_bpm : null;
  return band && band.length === 2 ? positive(band[1]) : null;
}

/**
 * The ceiling for the WORK, or null.
 *
 * The `pass`/`hr`/`<=`/`work` rule first. `hr_cap_bpm` deliberately does NOT
 * fall through to here: it bounds the whole run, and a whole-run mean ceiling
 * says nothing about what a rep may average.
 *
 * F057-#8, 2026-09-15 · falls back to the race's own HR band UPPER BOUND
 * (`raceHrBandUpperBound` above) when no pass rule exists — a race spec never
 * carries one (`spec-builder.ts`'s `case 'race'` never authors a work-scoped
 * pass rule) but a real race row's graded "work" phase(s) ARE the race, so
 * the band is the honest ceiling for exactly this scope, not a stand-in for
 * a missing one.
 */
export function workHrCeiling(
  spec: Record<string, unknown> | null | undefined,
): (HrCeiling & { source: 'pass_rule' | 'race_hr_expected_range_upper' }) | null {
  const rules = spec && Array.isArray((spec as { rules?: unknown }).rules)
    ? ((spec as { rules: RuleLike[] }).rules)
    : [];
  for (const r of rules) {
    if (!r || typeof r !== 'object') continue;
    if (r.kind !== 'pass' || r.metric !== 'hr' || r.op !== '<=' || r.scope !== 'work') continue;
    const bpm = positive(r.value);
    if (bpm != null) return { bpm, scope: 'work', source: 'pass_rule' };
  }
  const upper = raceHrBandUpperBound(spec);
  return upper != null ? { bpm: upper, scope: 'work', source: 'race_hr_expected_range_upper' } : null;
}

/**
 * The ceiling for the WHOLE RUN, or null.
 *
 * `hr_cap_bpm` first. `hr_target_bpm` is a target and `lthr_bpm` is a
 * reference — both fine to DISPLAY as an ask, neither a thing to be under.
 *
 * F057-#8, 2026-09-15 · a race row carries NO `hr_cap_bpm` BY DESIGN
 * (`spec-builder.ts`'s `case 'race'` sets it null on purpose — "a single
 * ceiling the wrist alarms on for 26 miles was the wrong shape"). That design
 * choice had a side effect nobody intended: with `hr_cap_bpm` absent, this
 * function returned null for every race, so `readCost` printed "the session
 * set no heart-rate ceiling, so the reading is reported without a verdict"
 * over a row that, on the same run, carries `race_hr.expected_range_bpm` — a
 * genuine, evidence-backed `[lo, hi]` band written by
 * `lib/race/race-row-refresh.ts` for exactly this purpose. The suppressed
 * verdict was never a missing measurement; it was a missing fallback SOURCE
 * for a ceiling that already exists on the row. Falls back to the band's
 * UPPER BOUND — the same edge `lateAllowanceBpm` is built from in
 * `race-hr-guidance.ts` — only when `hr_cap_bpm` is absent and the band is
 * present, so a genuine hard cap always wins when both exist. Also covers a
 * race row graded with NO "work" phase at all (scope resolves 'overall'
 * rather than 'work') — the same band, read for whichever scope the run
 * actually produces.
 */
export function overallHrCeiling(
  spec: Record<string, unknown> | null | undefined,
): (HrCeiling & { source: 'hr_cap_bpm' | 'race_hr_expected_range_upper' }) | null {
  const bpm = positive(spec?.hr_cap_bpm);
  if (bpm != null) return { bpm, scope: 'overall', source: 'hr_cap_bpm' };
  const upper = raceHrBandUpperBound(spec);
  return upper != null ? { bpm: upper, scope: 'overall', source: 'race_hr_expected_range_upper' } : null;
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
