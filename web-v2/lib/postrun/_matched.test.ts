/**
 * lib/postrun/_matched.test.ts · PR-15's ranking, as a set of falsifiable claims.
 *
 * Every case here was FALSIFIED against the unfixed module before it landed
 * (Rule 18 clause 1): the two regression cases at the bottom both failed when
 * written, because they describe defects this file's subject actually had on
 * the owner's real history.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT IS FIXTURES. Rule 13 clause 2 is explicit that fixtures skip the code
 *     paths that break, and both defects below were found by running against
 *     production, not here. `_detail_live.audit.test.ts` is the real-rows half
 *     and neither file substitutes for the other.
 *   · IT SAYS NOTHING ABOUT THE PHONE. Whether any of this reaches a screen is
 *     a render question and is not claimed here.
 *   · IT CANNOT TELL YOU THE RANKING IS *RIGHT*. It can only tell you the
 *     ranking is what Q44 describes. Whether Q44's order produces the session
 *     a coach would have picked is a judgement no unit test holds.
 *   · IT HAS NO OPINION ON LONG RUNS. The two-work-segment gate excludes them
 *     by design, so no case here exercises a steady comparison — that feature
 *     does not exist and this file cannot notice its absence.
 *
 * ── THE DISTRIBUTION (Rule 22) ──────────────────────────────────────────────
 *
 * Deliberately balanced: five cases assert a candidate is ADMITTED or chosen,
 * five assert one is REFUSED. A comparator gate is exactly the kind of
 * mechanism that drifts toward refusing everything — it never looks broken,
 * because a missing card reads as a design decision.
 */
import { describe, it, expect } from 'vitest';
import {
  signatureOf, refuse, pickMatchedWorkout, composeMatchedWorkout,
  REP_DISTANCE_TOLERANCE, INTENSITY_TOLERANCE, MATCH_WINDOW_DAYS,
  type MatchSegment, type MatchCandidate, type WorkReading,
} from './matched';

/**
 * The grader's `WorkSummary`, reproduced for fixtures.
 *
 * In production these two figures arrive from `WorkoutVerdict.work` and
 * `matched.ts` never computes them — see `WorkReading` for why. A fixture has
 * no grader to ask, so the test computes them the same duration-weighted way
 * `lib/execution/verdict.ts` does. That keeps the fixtures honest about what
 * the module will actually be handed, and it keeps the module free of the
 * arithmetic.
 */
function workReading(segments: MatchSegment[]): WorkReading {
  const work = segments.filter((s) => s.kind === 'work' && !s.isStride);
  const mean = (pick: (s: MatchSegment) => number | null) => {
    let num = 0;
    let den = 0;
    for (const s of work) {
      const v = pick(s);
      const w = s.durationSec;
      if (v == null || w == null || !(w > 0)) continue;
      num += v * w;
      den += w;
    }
    return den > 0 ? num / den : null;
  };
  return { paceSecPerMi: mean((s) => s.paceSecPerMi), hrBpm: mean((s) => s.avgHr) };
}

/** `signatureOf` with the reading a real grader would have supplied. */
function sig(segments: MatchSegment[]) {
  return signatureOf(segments, workReading(segments));
}

/* ════════════════════════════ fixtures ═════════════════════════════════ */

function work(distanceMi: number, paceSecPerMi: number, opts: {
  target?: number | null; hr?: number | null; stride?: boolean;
} = {}): MatchSegment {
  return {
    kind: 'work',
    paceSecPerMi,
    distanceMi,
    durationSec: Math.round(distanceMi * paceSecPerMi),
    avgHr: opts.hr ?? 160,
    targetSecPerMi: opts.target === undefined ? 430 : opts.target,
    isStride: opts.stride ?? false,
  };
}

function jog(sec = 60, pace = 800): MatchSegment {
  return {
    kind: 'recovery', paceSecPerMi: pace, distanceMi: (sec / pace),
    durationSec: sec, avgHr: 150, targetSecPerMi: null, isStride: false,
  };
}

function warmup(mi = 2): MatchSegment {
  return {
    kind: 'warmup', paceSecPerMi: 520, distanceMi: mi, durationSec: mi * 520,
    avgHr: 140, targetSecPerMi: 502, isStride: false,
  };
}

/** A 4 x 1 mile session. The shape the whole feature was specified against. */
function fourByOne(paces: number[], o: { target?: number | null; hr?: number[] } = {}): MatchSegment[] {
  const out: MatchSegment[] = [warmup()];
  paces.forEach((p, i) => {
    out.push(work(1.0, p, { target: o.target === undefined ? 430 : o.target, hr: o.hr?.[i] ?? 160 }));
    if (i < paces.length - 1) out.push(jog());
  });
  return out;
}

function candidate(dateISO: string, segments: MatchSegment[], extra: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    runId: `run-${dateISO}`,
    dateISO,
    segments,
    work: workReading(segments),
    totalDistanceMi: 8.5,
    elevGainFt: 60,
    tempF: 60,
    weeksToRace: null,
    sessionTypeDisplay: 'Threshold',
    ...extra,
  };
}

const TODAY = candidate('2026-09-01', fourByOne([422, 429, 422, 419], { hr: [158, 161, 164, 166] }));

/* ═══════════════════════════ the signature ══════════════════════════════ */

describe('signatureOf', () => {
  it('reduces a 4 x 1 mile session to its structure', () => {
    const s = sig(TODAY.segments);
    expect(s.workCount).toBe(4);
    expect(s.repDistanceMi).toBe(1.0);
    expect(s.totalWorkMi).toBe(4);
    expect(s.targetSecPerMi).toBe(430);
    // Duration-weighted, so the longer reps pull harder. All are one mile
    // here, so it lands on the arithmetic mean of the four.
    expect(Math.round(s.workPaceSecPerMi!)).toBe(423);
    expect(s.repSpreadSec).toBe(10);
    // Last rep quicker than the first: a negative fade.
    expect(s.fadeSec).toBe(-3);
  });

  it('STRIDES ARE NOT WORK · six accelerations do not make a rep session', () => {
    /* The owner's 2026-09-02 easy day, in miniature. If strides counted, this
     * would report a seven-segment workout and would match against one. */
    const segs: MatchSegment[] = [work(5.0, 515, { target: 522 })];
    for (let i = 0; i < 6; i++) {
      segs.push(work(0.05, 380, { target: null, stride: true }));
      segs.push(jog(60, 546));
    }
    const s = sig(segs);
    expect(s.workCount).toBe(1);
    expect(s.repDistanceMi).toBe(5.0);
  });

  it('fade needs three reps · two is one comparison and is not a session shape', () => {
    expect(sig(fourByOne([420, 440])).fadeSec).toBeNull();
    expect(sig(fourByOne([420, 430, 440])).fadeSec).toBe(20);
  });
});

/* ═════════════════════════════ the gates ════════════════════════════════ */

describe('refuse · admissibility', () => {
  const now = sig(TODAY.segments);

  it('ADMITS a 4 x 1 mile session at a similar target', () => {
    expect(refuse(now, sig(fourByOne([400, 405, 412, 410], { target: 403 })))).toBeNull();
  });

  it('ADMITS a three-rep session · one segment either way is still the session', () => {
    expect(refuse(now, sig(fourByOne([420, 425, 430], { target: 430 })))).toBeNull();
  });

  it('REFUSES the 1 km session · same rep count, same family, wrong rep', () => {
    /* The trap the owner's own history contains: 2026-08-11 is 4 x 1 KM at a
     * threshold target one second per mile from this one. Structure is not rep
     * count alone, and this is the case that proves it. */
    const km = sig(fourByOne([381, 387, 402, 416], { target: 412 })
      .map((s) => (s.kind === 'work' ? { ...s, distanceMi: 0.62 } : s)));
    expect(refuse(now, km)).toBe('rep-distance-differs');
  });

  it('REFUSES a session two segments away', () => {
    expect(refuse(now, sig(fourByOne([420, 425])))).toBe('segment-count-differs');
    expect(refuse(now, sig(fourByOne([1, 2, 3, 4, 5, 6].map(() => 420)))))
      .toBe('segment-count-differs');
  });

  it('REFUSES a different intensity · 6:29 reps are not 7:10 reps', () => {
    // 389 against 430 is 9.5 percent, outside the band.
    expect(refuse(now, sig(fourByOne([406, 408, 408, 407], { target: 389 }))))
      .toBe('intensity-differs');
  });

  it('REFUSES a steady run · one work segment is the whole-run average in disguise', () => {
    const easy = sig([work(6.0, 520, { target: 522 })]);
    expect(refuse(now, easy)).toBe('no-work-segments');
    // And symmetrically: a steady run has no comparator of this kind either.
    expect(refuse(easy, now)).toBe('no-work-segments');
  });

  it('the tolerances are the ones the header claims', () => {
    // A check that hardcodes both sides only proves it agrees with itself, so
    // these read the exported constants and exercise their edges.
    const just = 1 + REP_DISTANCE_TOLERANCE - 0.01;
    const over = 1 + REP_DISTANCE_TOLERANCE + 0.01;
    const at = (f: number) => sig(fourByOne([420, 425, 422, 419])
      .map((s) => (s.kind === 'work' ? { ...s, distanceMi: f } : s)));
    expect(refuse(now, at(just))).toBeNull();
    expect(refuse(now, at(over))).toBe('rep-distance-differs');

    const tgt = (t: number) => sig(fourByOne([420, 425, 422, 419], { target: t }));
    expect(refuse(now, tgt(Math.round(430 * (1 + INTENSITY_TOLERANCE - 0.005))))).toBeNull();
    expect(refuse(now, tgt(Math.round(430 * (1 + INTENSITY_TOLERANCE + 0.01)))))
      .toBe('intensity-differs');
  });
});

/* ═══════════════════════════ the two regressions ════════════════════════ */

describe('REGRESSION · the defects production found', () => {
  it('REFUSES a candidate that recorded no intended stimulus', () => {
    /* 2026-07-23 in the owner's history: no target, no heart rate, three reps
     * reading an identical 389 and a fourth with no distance at all. The
     * intensity gate ABSTAINED on it — "no target recorded" spent as "the same
     * target" — and it beat the right comparator. Rule 11.
     *
     * FALSIFIER: delete the `intent-not-recorded` branch in `refuse` and this
     * returns null. */
    const ghost = sig(fourByOne([389, 389, 389], { target: null }));
    expect(refuse(sig(TODAY.segments), ghost)).toBe('intent-not-recorded');
  });

  it('does NOT refuse on terrain · elevGainFt is not a number this app trusts', () => {
    /* The terrain gate threw away 2026-06-16 — the single best comparator in
     * six months — because this run's row claims 786 ft over 8.5 miles and
     * that one claims 6 ft per mile. `elev-sanity.ts` exists because rows in
     * this table claim 2807 ft over 7.78 miles. Q44 lists terrain as a ranking
     * key, sixth of seven, and that is where it now lives.
     *
     * FALSIFIER: restore a terrain gate and this returns a refusal. */
    const flat = sig(fourByOne([400, 405, 412, 410], { target: 403 }));
    expect(refuse(sig(TODAY.segments), flat)).toBeNull();
  });
});

/* ═══════════════════════════ the ranking order ══════════════════════════ */

describe('pickMatchedWorkout', () => {
  it('picks the session that matches the DOSE, not the nearest in time', () => {
    const near = candidate('2026-08-25', fourByOne([420, 425, 422, 419], { target: 430 })
      .map((s) => (s.kind === 'work' ? { ...s, distanceMi: 0.8 } : s)));
    const right = candidate('2026-06-16', fourByOne([400, 405, 412, 410], { target: 403 }));
    const out = pickMatchedWorkout(TODAY, [near, right]);
    // `near` covers 3.2 mi of work against this run's 4.0; `right` covers 4.0.
    // Key 1 decides before recency is ever consulted.
    expect(out.matched?.dateISO).toBe('2026-06-16');
  });

  it('falls through to recency when the structural keys tie · Rule 9', () => {
    /* Two candidates a hundredth of a mile apart in work distance must NOT be
     * separated by key 1. Bucketing is what makes that true, and this is the
     * assertion that a future de-bucketing would break. */
    const older = candidate('2026-06-16', fourByOne([420, 425, 422, 419], { target: 430 }));
    const newer = candidate('2026-08-04', fourByOne([420, 425, 422, 419], { target: 430 })
      .map((s) => (s.kind === 'work' ? { ...s, distanceMi: 1.01 } : s)));
    expect(pickMatchedWorkout(TODAY, [older, newer]).matched?.dateISO).toBe('2026-08-04');
  });

  it('REFUSES OUT LOUD when nothing is comparable', () => {
    const out = pickMatchedWorkout(TODAY, [
      candidate('2026-08-11', fourByOne([381, 387, 402, 416], { target: 412 })
        .map((s) => (s.kind === 'work' ? { ...s, distanceMi: 0.62 } : s))),
    ]);
    expect(out.matched).toBeNull();
    // Q44: say so rather than forcing one. Rule 11: a bare null is
    // indistinguishable from a section that failed to load.
    expect(out.refusal).toContain('No comparable');
    expect(out.refusal).toContain('4 × 1 mi');
  });

  it('is SILENT, not refusing, on a run with no segmented work', () => {
    const easy = candidate('2026-09-02', [work(6.0, 520, { target: 522 })]);
    const out = pickMatchedWorkout(easy, [TODAY]);
    expect(out.matched).toBeNull();
    // No furniture under every easy run.
    expect(out.refusal).toBeNull();
  });

  it('never reaches past the window', () => {
    const old = new Date(Date.parse('2026-09-01T00:00:00Z') - (MATCH_WINDOW_DAYS + 1) * 86_400_000)
      .toISOString().slice(0, 10);
    const out = pickMatchedWorkout(TODAY, [candidate(old, fourByOne([420, 425, 422, 419]))]);
    expect(out.matched).toBeNull();
  });

  it('never compares a run to itself, or to something after it', () => {
    const future = candidate('2026-09-05', fourByOne([420, 425, 422, 419]));
    expect(pickMatchedWorkout(TODAY, [TODAY, future]).matched).toBeNull();
  });
});

/* ═════════════════════════ what the card says ═══════════════════════════ */

describe('composeMatchedWorkout', () => {
  const now = { dateISO: '2026-09-01', sig: sig(TODAY.segments), sessionTypeDisplay: 'Threshold' };
  const then = {
    runId: 'r', dateISO: '2026-06-16',
    sig: sig(fourByOne([400, 405, 412, 410], { target: 403, hr: [160, 161, 160, 164] })),
    sessionTypeDisplay: 'Threshold',
  };

  it('ALWAYS states the basis, and names the structure · Q44', () => {
    const m = composeMatchedWorkout(now, then);
    expect(m.basis).toContain('4 × 1 mi');
    expect(m.basis).toContain('threshold');
    expect(m.basis).toContain('11 weeks ago');
    // "never merely 'matched run'"
    expect(m.basis).not.toBe('Matched run');
  });

  it('carries what each session ASKED FOR beside what was run', () => {
    /* Without it "18 s/mi slower" describes a runner going backwards, when the
     * prescriptions were 27 s/mi apart. */
    const m = composeMatchedWorkout(now, then);
    const asked = m.lines.find((l) => l.label === 'Asked for');
    expect(asked).toBeDefined();
    expect(asked!.now).toBe('7:10/mi');
    expect(asked!.then).toBe('6:43/mi');
  });

  it('NEVER compares whole-run average pace', () => {
    /* The prohibition is structural, not conventional: there is no field on
     * `MatchLine` a whole-run average could occupy and no label that names
     * one. This assertion is what notices if somebody adds one. */
    const m = composeMatchedWorkout(now, then);
    for (const l of m.lines) {
      expect(l.label.toLowerCase()).not.toContain('average pace');
      expect(l.label.toLowerCase()).not.toContain('run pace');
    }
    expect(m.lines.some((l) => l.label === 'Work pace')).toBe(true);
  });

  it('WITHHOLDS the heart-rate line and SAYS it was withheld · Rule 11', () => {
    const noHr = {
      ...then,
      sig: sig(fourByOne([400, 405, 412, 410], { target: 403 })
        .map((s) => ({ ...s, avgHr: null }))),
    };
    const m = composeMatchedWorkout(now, noHr);
    expect(m.lines.some((l) => l.label === 'Work heart rate')).toBe(false);
    expect(m.withheld.join(' ')).toContain('Heart rate');
  });

  it('prints no delta for a difference smaller than the instrument', () => {
    /* 161 against 162 bpm is not a finding, and a card that reports it invites
     * a runner to read noise as adaptation. */
    const m = composeMatchedWorkout(now, then);
    expect(m.lines.find((l) => l.label === 'Work heart rate')?.delta).toBeNull();
  });
});
