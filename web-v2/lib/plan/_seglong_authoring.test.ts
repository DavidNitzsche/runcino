/**
 * SEGLONG-2 · does a marathon build ACTUALLY produce a segmented long run?
 *
 * The grammar landing (SEGLONG-1) and the session being authored are separate
 * questions, and only the second one reaches the runner. `finish_segments`
 * could express a gap for a full day before anything emitted one, because the
 * composer's long-run label had three hardcoded shapes and none of them
 * carried an `@ E` token. A capability nothing selects is a capability the
 * runner never sees.
 *
 * So this composes a real advanced-marathon plan — David's own persona, the
 * same fixture _r3_adv_g_david uses — and reads the labels back out.
 */
import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import { composePlan, finalizeComposedPlan, inlinePrescriptions, type ComposePlanInput, type DOW } from './generate';
import { tPaceFromGoal, extractLongSegments } from './spec-builder';

const START_MONDAY = '2026-01-05';

function marathonInput(weeklyBaseMi = 60): ComposePlanInput {
  const distanceMi = 26.2, goalSec = 10800, weeksOut = 18;
  const cat = distanceCategoryOrThrow(distanceMi);
  const raceDay = new Date(START_MONDAY + 'T12:00:00Z');
  raceDay.setUTCDate(raceDay.getUTCDate() + weeksOut * 7 - 1);
  return {
    raceDistanceMi: distanceMi,
    goalSec,
    goalPaceSec: Math.round(goalSec / distanceMi),
    raceDateISO: raceDay.toISOString().slice(0, 10),
    startMondayISO: START_MONDAY,
    level: 'advanced',
    /* TIEREVIDENCE-2 (2026-09-02) · THE FIXTURE NOW CARRIES THE EVIDENCE ITS
     * NAME CLAIMS.
     *
     * `Research/00a` §3 tags the embedded-T medium-long "(advanced)", and the
     * composer's gate for it used to be `level === 'advanced'` — the word.
     * With `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` §"What may not" removing
     * self-declared experience bands, the gate is now the DEMONSTRATED capacity
     * band, and this fixture — a 60 mi/wk build for a 3:00 marathon, which is
     * what "an advanced marathon build" means — reached the composer with no
     * measured fitness at all and was therefore graded unmeasured.
     *
     * VDOT 53 predicts ~3:00 at the marathon (~412 s/mi), inside
     * `TIER_PACE_EDGES.m.advanced` (420). The fixture is unchanged in every
     * other respect; what changed is that the claim in its name is now backed
     * by evidence rather than asserted by a label.
     */
    bestRecentVdot: 53,
    recentWeeklyMi: weeklyBaseMi,
    easyDayMedianMi: Math.max(3, Math.round(weeklyBaseMi / 5)),
    recentLongMi: 14,
    isMidBlock: false,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: tPaceFromGoal(goalSec, distanceMi),
    lthr: null,
    maxHr: null,
  } as ComposePlanInput;
}

/** Every long-run sub_label in the composed plan. */
function longLabels(input: ComposePlanInput): string[] {
  const res = composePlan(input);
  const out: string[] = [];
  for (const w of res.weeks) {
    for (const d of w.days) {
      if (d.type === 'long' && typeof d.subLabel === 'string') out.push(d.subLabel);
    }
  }
  return out;
}

describe('SEGLONG-2 · the segmented long run is actually authored', () => {
  it('an 18-week advanced marathon build produces at least one', () => {
    const labels = longLabels(marathonInput());
    const segmented = labels.filter((l) => /@ E\b/.test(l));
    expect(
      segmented.length,
      'no long run in the whole build carries an easy block between two quality blocks.\n'
      + 'The grammar exists (SEGLONG-1) but nothing authored one, which is the state this\n'
      + 'test was written to prevent. Labels seen:\n  ' + [...new Set(labels)].join('\n  '),
    ).toBeGreaterThan(0);
  });

  it('the segmented label round-trips to two quality blocks with a gap, not three blocks', () => {
    const seg = longLabels(marathonInput()).find((l) => /@ E\b/.test(l))!;
    const parsed = extractLongSegments(seg);
    // Two QUALITY blocks. The easy token is a gap hanging off the first, never
    // a third entry — that is what keeps the dosing census and the easy/quality
    // split correct without either of them knowing gaps exist.
    expect(parsed).toHaveLength(2);
    expect(parsed[0].recoveryMi).toBeGreaterThan(0);
    expect(parsed[1].recoveryMi).toBeUndefined();
    expect(parsed.every((p) => p.tag === 'M')).toBe(true);
  });

  it('the quality blocks and the gap fit inside the day', () => {
    const res = composePlan(marathonInput());
    for (const w of res.weeks) {
      for (const d of w.days) {
        if (d.type !== 'long' || typeof d.subLabel !== 'string') continue;
        if (!/@ E\b/.test(d.subLabel)) continue;
        const segs = extractLongSegments(d.subLabel);
        const used = segs.reduce((a, s) => a + s.mi + (s.recoveryMi ?? 0), 0);
        // Strictly inside: doctrine keeps the easy bulk the run's first act,
        // so the blocks can never be the whole long run.
        expect(used, `${d.subLabel} on a ${d.distanceMi}mi long run`)
          .toBeLessThan(d.distanceMi as number);
      }
    }
  });

  it('a plan that cannot fund two real blocks authors none · no half-sized session', () => {
    // 25 mi/wk cannot pay for two marathon-pace blocks at the two-mile floor.
    // The branch must refuse rather than emit a token block, the same contract
    // the progression long uses.
    for (const label of longLabels(marathonInput(25))) {
      if (!/@ E\b/.test(label)) continue;
      for (const s of extractLongSegments(label)) {
        expect(s.mi, `${label} carries a block below the 2mi floor`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

/* ─────────────────────────────────────────── DOWNHILL-2 · course gating ── */

/** CIM-shaped: a real net-downhill course, on trusted geometry. */
function cimTerrain() {
  return {
    shape: 'net_downhill' as const,
    netFt: -1200, gainFt: 400, lossFt: 1600, vertPer10Mi: 150,
    provenance: 'course_geometry' as never,
    confidence: 'high' as never,
    trusted: true,
    geometrySource: 'course_geometry' as const,
  };
}

describe('DOWNHILL-2 · the eccentric protocol reaches a net-downhill race, and only that race', () => {
  it('a CIM-shaped marathon gets the downhill simulation', () => {
    // The pass runs in finalizeComposedPlan, which is where applyCourseGuidance
    // lives and where the real pipeline (generatePlan, /api/plan/simulate) runs
    // it. Composing without finalizing is not the shipped plan.
    const input = { ...marathonInput(), courseTerrain: cimTerrain() } as ComposePlanInput;
    const res = composePlan(input);
    finalizeComposedPlan(res, 26.2, 'advanced', cimTerrain() as never);
    const kinds: string[] = [];
    for (const w of res.weeks) for (const d of w.days) {
      if (d.type === 'long' && d.longRunKind) kinds.push(String(d.longRunKind));
    }
    // Research/11's protocol is the reason this engine knows CIM is different
    // from a flat marathon. Before DOWNHILL-2 the whole response was a
    // sentence appended to a long-run note.
    expect(
      kinds.some((k) => k === 'downhill_simulation'),
      `no downhill simulation in a net-downhill build · kinds seen: ${[...new Set(kinds)].join(', ')}`,
    ).toBe(true);
  });

  it('a flat marathon gets none · the protocol is course-specific, not free variety', () => {
    // The cost of this session is deliberate muscle damage. Offering it to a
    // runner whose race does not descend is the engine inventing a stimulus.
    const res = composePlan(marathonInput());
    finalizeComposedPlan(res, 26.2, 'advanced');
    for (const w of res.weeks) for (const d of w.days) {
      expect(String(d.longRunKind ?? '')).not.toBe('downhill_simulation');
    }
  });
});

describe('VARIATION-CLOSE-1 · §3 embedded-T medium-long is authored, not just catalogued', () => {
  // The trap this guards: the medium_long SLOT is never passed to the
  // selector — the composer authors the MLR directly — so a structure added
  // to the catalogue entry is unreachable. That is the same shape §11.1's
  // Canova block sat in for months, and it is only caught by asking the
  // composed plan rather than the catalogue.
  const mlrLabels = (input: ComposePlanInput) => {
    const res = composePlan(input);
    const out: string[] = [];
    for (const w of res.weeks) for (const d of w.days) {
      if (typeof d.subLabel === 'string' && d.subLabel.startsWith('MEDIUM-LONG')) out.push(d.subLabel);
    }
    return out;
  };

  it('an advanced marathon build authors at least one', () => {
    const labels = mlrLabels(marathonInput());
    expect(
      labels.some((l) => /@ T\b/.test(l)),
      `no embedded-T medium-long · labels seen:\n  ${[...new Set(labels)].join('\n  ')}`,
    ).toBe(true);
  });

  it('a runner with no demonstrated advanced pace never gets one · the doc tags the variant "(advanced)"', () => {
    // TIEREVIDENCE-2 · the discriminator is the EVIDENCE, not the word. This
    // used to be `{ ...marathonInput(25), level: 'beginner' }`, which asserted
    // that a typed label withheld the session; the label is inert now, so the
    // case withholds the MEASUREMENT instead — a 25 mi/wk runner the app has
    // never seen race. `bestRecentVdot: undefined` is the whole difference from
    // the case above.
    const unmeasured = {
      ...marathonInput(25), level: 'beginner', bestRecentVdot: undefined,
    } as unknown as ComposePlanInput;
    const labels = mlrLabels(unmeasured);
    for (const l of labels) expect(l).not.toMatch(/@ T\b/);
  });

  it('never lands on a week whose long run already carries race pace', () => {
    // §3: "should not compete with the long run for recovery". A structured
    // MLR plus a race-pace long plus the week's quality day is a third hard
    // session nobody budgeted for.
    const res = composePlan(marathonInput());
    for (const w of res.weeks) {
      const mlr = w.days.find((d) => typeof d.subLabel === 'string' && d.subLabel.startsWith('MEDIUM-LONG'));
      if (!mlr || !/@ T\b/.test(String(mlr.subLabel))) continue;
      const long = w.days.find((d) => d.isLong && d.type === 'long');
      expect(String(long?.subLabel ?? 'LONG'), `week with ${mlr.subLabel}`).toBe('LONG');
    }
  });
});

describe('SEGLONG-2 · the kind never outlives the shape', () => {
  it('a modified block trimmed to one segment stops calling itself one', () => {
    // A 0.5-mile dosing give-back is enough to collapse the shape, and the gap
    // is the only thing that made it §11.1's session. A day labelled
    // modified_block over a single-segment label claims a stimulus — returning
    // to race pace on tired legs — the runner is not being given.
    const res = composePlan(marathonInput());
    finalizeComposedPlan(res, 26.2, 'advanced');
    for (const w of res.weeks) for (const d of w.days) {
      if (d.longRunKind !== 'modified_block') continue;
      expect(
        String(d.subLabel ?? ''),
        `week claims modified_block but its label has no easy block: ${d.subLabel}`,
      ).toMatch(/@ E\b/);
    }
  });
});

describe('SEGLONG-3 · a long run\'s notes never describe segments its label does not carry', () => {
  // `setLongFinish`'s header states the contract: "the label and the notes are
  // rewritten together and there is no third place to drift." The flatten path
  // honoured it; the SEGLONG-2 / ROTATION-REFUSE-1 re-split path rewrote the
  // label and returned, leaving `layoutWeek`'s note describing the segments the
  // day used to carry.
  //
  // Caught on the owner's live CIM authoring (2026-08-30): the week of 10-05
  // was labelled `LONG · 3mi @ M + 1mi @ E + 2mi @ M` — five race-pace miles,
  // which is what `buildWorkoutSpec` reads back out of the label and what the
  // watch therefore runs — over a note reading "then 7mi at marathon effort ...
  // then 5mi at marathon effort". Twelve miles promised in prose against five
  // prescribed. The runner reads the prose.
  //
  // The sum is the assertion rather than the exact string, because the note is
  // allowed to be worded differently for the block, the progression and the
  // plain finish. What it is not allowed to do is name a different quantity of
  // race-pace running than the label the spec is built from.
  const labelRacePaceMi = (subLabel: string | null | undefined): number =>
    [...String(subLabel ?? '').matchAll(/([\d.]+)\s*mi\s*@\s*(?:HM|MP|M|T)\b/gi)]
      .reduce((s, m) => s + Number(m[1]), 0);
  const notesRacePaceMi = (notes: string | null | undefined): number =>
    [...String(notes ?? '').matchAll(
      /([\d.]+)\s*mi at (?:marathon pace|marathon effort|half-marathon pace|threshold)/gi,
    )].reduce((s, m) => s + Number(m[1]), 0);

  for (const baseMi of [40, 50, 60, 70]) {
    it(`holds across an 18-week advanced marathon build off ${baseMi} mi/wk`, () => {
      const res = composePlan(marathonInput(baseMi));
      finalizeComposedPlan(res, 26.2, 'advanced');
      for (const w of res.weeks) for (const d of w.days) {
        if (d.type !== 'long') continue;
        const fromLabel = labelRacePaceMi(d.subLabel);
        const fromNotes = notesRacePaceMi(d.notes);
        // A note that quantifies nothing (the plain conversational long) is
        // fine; a note that quantifies must agree with the label.
        if (fromLabel === 0 && fromNotes === 0) continue;
        expect(
          fromNotes,
          `week ${w.startISO}: label promises ${fromLabel}mi at race pace, notes promise ` +
            `${fromNotes}mi\n  label: ${d.subLabel}\n  notes: ${d.notes}`,
        ).toBeCloseTo(fromLabel, 1);
      }
    });
  }
});
