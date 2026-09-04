/**
 * lib/adaptation/canonical/hr-trace-credibility.ts · is this actually a heart
 * rate measurement, or a value carried forward?
 *
 * ── HRFLATLINE-1 (2026-09-04) · THE DEFECT, FROM THE RUNNER'S OWN QUESTION ──
 *
 * David, mid-session: *"I feel like my hr reading is off for the hill
 * intervals. is that the only thing the coach cares about is HR? not incline or
 * speed or anything?"* He was right, and the data says so plainly.
 *
 * His 2026-09-03 hill session — `10×60s hills @ 5K-10K effort` — carries 21
 * phases and ~460 HR samples, and **eight distinct values in the whole
 * session**:
 *
 *   Warm-up      75 samples   2 distinct   [139, 134]
 *   Hill 1       18 samples   1 distinct   [134]
 *   Jog 2 min    30 samples   1 distinct   [134]
 *   Hill 2       18 samples   1 distinct   [134]
 *   Hill 5       18 samples   1 distinct   [103]   ← during a 60s hill rep
 *   Hill 6       19 samples   1 distinct   [109]
 *   Hill 10      11 samples   1 distinct   [111]
 *
 * Heart rate does not hold one value for sixty seconds of hill running, and it
 * does not FALL to 103 bpm going into a rep. This is a sample-and-hold /
 * interpolation artefact — the watch recorded few real readings and the last
 * one was carried forward — and it is device behaviour, not physiology.
 *
 * ── WHY IT MATTERS TO THE ENGINE, IN BOTH DIRECTIONS ───────────────────────
 *
 * `isHrReliable` asked only whether the RUN-LEVEL average sat between 60 and
 * 220. A trace like this averages about 125 and sails through. C4 then grades
 * the session against it, and the failure can go either way:
 *
 *   · FALSE PASS — 103 bpm "comfortably under the 164 ceiling" reads as a
 *     controlled session that was never measured.
 *   · FALSE FAIL — a held-high value reads as an over-cooked one, which is the
 *     shape HRCEILING-1 has just finished cleaning up.
 *
 * Rule 11 is usually stated as "don't know is not failed". This is its other
 * half: **present is not readable.** A number that is there and means nothing
 * is worse than an absent one, because every "is it there" check passes.
 *
 * ── THE TEST, AND WHY IT IS NOT A PHYSIOLOGICAL CLAIM ──────────────────────
 *
 * A work phase whose samples are ALL IDENTICAL is not a measurement. That is a
 * data-integrity statement, not a training-science one: no threshold is being
 * asserted about how much a heart rate should vary, only that a variance of
 * exactly zero across a sustained effort is a carried-forward value. Nothing
 * here needs a `Research/` citation, and deliberately does not carry one.
 *
 * The sample floor exists so a phase with one or two readings — genuinely
 * sparse, not held — is not condemned for having nothing to vary.
 */

/** Below this, a phase has too few readings for "no variation" to mean anything. */
const MIN_SAMPLES_TO_JUDGE = 5;

export interface HrTraceVerdict {
  readonly credible: boolean;
  /** Present when not credible. Reads as a cause, for a human. */
  readonly why: string | null;
}

/**
 * Judge one phase's HR samples.
 *
 * `samples` is bpm values in time order. Fewer than `MIN_SAMPLES_TO_JUDGE`
 * readings is CREDIBLE-by-default: sparse is not the same as held, and refusing
 * it would discard real evidence (Rule 11 again — an absence of grounds to
 * refuse is not grounds to refuse).
 */
export function hrTraceIsCredible(samples: readonly number[]): HrTraceVerdict {
  const usable = samples.filter((n) => Number.isFinite(n) && n > 0);
  if (usable.length < MIN_SAMPLES_TO_JUDGE) return { credible: true, why: null };
  const distinct = new Set(usable).size;
  if (distinct === 1) {
    return {
      credible: false,
      why: `all ${usable.length} heart-rate samples read exactly ${usable[0]} bpm, `
        + 'which is a carried-forward value rather than a measurement',
    };
  }
  return { credible: true, why: null };
}

/**
 * The same judgement across a session's WORK phases.
 *
 * A session is refused when ANY work phase is a flat line, not when all of them
 * are: one held rep is enough to make the set's mean a number about nothing,
 * and C4 reads both the mean and the per-segment values.
 */
export function workTraceIsCredible(
  phases: ReadonlyArray<{ readonly samples: readonly number[]; readonly label?: string | null }>,
): HrTraceVerdict {
  for (const p of phases) {
    const v = hrTraceIsCredible(p.samples);
    if (!v.credible) {
      return { credible: false, why: p.label ? `${p.label}: ${v.why}` : v.why };
    }
  }
  return { credible: true, why: null };
}
