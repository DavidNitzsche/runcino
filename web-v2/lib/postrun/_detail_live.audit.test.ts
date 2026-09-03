/**
 * lib/postrun/_detail_live.audit.test.ts · the chart stack and the matched
 * workout, against production.
 *
 * READ-ONLY. Sibling of `_postrun_live.audit.test.ts` and armed the same way:
 * the write barrier installed by `vitest.setup.ts` refuses every production
 * write for the life of the run, so this file is structurally incapable of
 * touching the owner's training history.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * `_analysis.test.ts` and `_matched.test.ts` are fixtures, and Rule 13 clause
 * 2 says fixtures skip the code paths that break. That is not a figure of
 * speech here: BOTH defects the matcher shipped with were invisible to the
 * fixtures and obvious on the first real run.
 *
 *   · a terrain gate keyed on `elevGainFt` threw away the single best
 *     comparator in six months, on a field `elev-sanity.ts` exists because
 *     nobody trusts (one row claims 2807 ft over 7.78 miles);
 *   · a row with no target, no heart rate and three identical rep paces was
 *     admitted ahead of it, and produced a card reading "34 s/mi slower" over
 *     a pace no instrument measured.
 *
 * Neither is reachable from a fixture, because a fixture is written by the
 * same person who wrote the gate and it has the same idea of what a session
 * looks like (Rule 22). This file is the one that has met the data.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT IS THE PAYLOAD, NOT THE PHONE. Nothing here proves a chart is drawn.
 *   · IT IS ONE ACCOUNT AND TWO RUNS. Treadmill, race, injury and off-season
 *     rows are not exercised.
 *   · IT SKIPS ITSELF WITHOUT A DATABASE. The skip is loud where credentials
 *     exist and silent where they never did — the same posture, and the same
 *     argument, as `_postrun_live.audit.test.ts`.
 *   · IT PINS TODAY'S ANSWER. If the owner runs another 4 x 1 mile session,
 *     the comparator for 2026-09-01 is unchanged (it only looks backwards),
 *     but a re-ingest that rewrites those rows would fail this file. That is
 *     intended: it should fail loudly rather than quietly describe new data.
 */
import { describe, it, expect } from 'vitest';
import { pool } from '@/lib/db/pool';
import { loadPostRunDetailExtras } from './detail-load';

const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
/** The 4 x 1 mile threshold session. `8.5 mi`, nine phases, 799 wrist samples. */
const RUN_0901 = '-258355938987883';
/** The easy-plus-strides session. `6.41 mi` total, 5.98 across thirteen phases. */
const RUN_0902 = '-145861381014809';

const RO = process.env.DATABASE_URL_RO ?? process.env.DATABASE_URL;

async function haveDb(): Promise<boolean> {
  try { await pool.query('SELECT 1'); return true; } catch { return false; }
}

describe.skipIf(!RO)('post-run detail · live payload', () => {
  it('LIVENESS · it reached the database and read both runs', async () => {
    expect(await haveDb()).toBe(true);
    expect(await loadPostRunDetailExtras(OWNER, RUN_0901)).not.toBeNull();
    expect(await loadPostRunDetailExtras(OWNER, RUN_0902)).not.toBeNull();
  }, 60_000);

  it('draws the 2026-09-01 threshold session from the wrist stream', async () => {
    if (!await haveDb()) { console.warn('NO DATABASE — this assertion did not run'); return; }
    const a = (await loadPostRunDetailExtras(OWNER, RUN_0901))!.analysis!;
    expect(a).not.toBeNull();

    // The watch recorded it, so the chart is the watch's own readings.
    expect(a.grain).toBe('SAMPLED');
    expect(a.hasPace).toBe(true);
    expect(a.hasHr).toBe(true);

    // Nine phases: warm-up, four one-mile reps with three jogs, cool-down.
    expect(a.bands).toHaveLength(9);
    const work = a.bands.filter((b) => b.kind === 'work');
    expect(work).toHaveLength(4);
    // Every rep carries the SAME target, and it is the one the plan authored.
    expect(new Set(work.map((b) => b.targetSecPerMi))).toEqual(new Set([430]));
    // The jogs carry none. A line ruled across them would mark each a miss.
    expect(a.bands.filter((b) => b.kind === 'recovery')
      .every((b) => b.targetSecPerMi === null)).toBe(true);

    // The bands tile the axis with no gaps and no overlaps, in order.
    for (let i = 1; i < a.bands.length; i++) {
      expect(a.bands[i].fromMi).toBeCloseTo(a.bands[i - 1].toMi, 3);
    }
    expect(a.bands[0].fromMi).toBe(0);
    expect(a.bands[8].toMi).toBeCloseTo(8.5, 1);

    // Every point sits on the axis the bands are drawn on.
    expect(a.points.length).toBeGreaterThan(100);
    expect(Math.max(...a.points.map((p) => p.atMi))).toBeLessThanOrEqual(8.51);

    // NO ELEVATION. This run's splits carry `hr, mile, pace, paceSecPerMi` and
    // nothing else, so the layer is absent rather than flat. Eleven of his
    // last fourteen runs are the same, and this is the honest answer for them.
    expect(a.elevation).toBeNull();

    expect(a.accessibilitySummary).toContain('second by second');
    expect(a.accessibilitySummary).toContain('4 work segments');
  }, 60_000);

  it('matches it to the RIGHT prior session, and states the basis', async () => {
    if (!await haveDb()) { console.warn('NO DATABASE — this assertion did not run'); return; }
    const m = (await loadPostRunDetailExtras(OWNER, RUN_0901))!.match;

    /* 2026-06-16 · 4 x 1 mile at a 403 target, real heart rate on every rep,
     * four genuinely different rep paces, 4.01 miles of work against this
     * run's 4.03.
     *
     * NOT 2026-08-11, which is 4 x 1 KILOMETRE at a target one second per mile
     * away — same rep count, same family, wrong rep.
     * NOT 2026-07-23, which recorded no target and no heart rate at all.
     * NOT 2026-07-16, whose 389 target is 9.5 percent away from this one. */
    expect(m.matched).not.toBeNull();
    expect(m.matched!.dateISO).toBe('2026-06-16');
    expect(m.refusal).toBeNull();

    expect(m.matched!.basis).toContain('4 × 1 mi');
    expect(m.matched!.basis).toContain('threshold');

    const by = (l: string) => m.matched!.lines.find((x) => x.label === l);
    /* The comparison a coach would make, on the numbers that were measured.
     *
     * 7:02 AND NOT 7:03, AND THE ONE SECOND IS THE POINT. This file asserted
     * 7:03 when it was written, because `matched.ts` computed the work-segment
     * mean itself. `check-derived-consistency.sh` flagged that as a place a
     * second opinion about pace is born, the read was routed through
     * `WorkoutVerdict.work` — the app's owner for this quantity — and the
     * owner's answer is 7:02. The duplicate had been wrong by a second, on the
     * same screen that draws the server's figure in its reading rows. Rule 16
     * cost exactly what it says it costs, and this assertion now pins the
     * owner's number rather than a copy of it. */
    expect(by('Work pace')!.now).toBe('7:02/mi');
    expect(by('Work pace')!.then).toBe('6:45/mi');
    // And what each session ASKED for, without which the line above reads as
    // a runner going backwards rather than one hitting two prescriptions.
    expect(by('Asked for')!.now).toBe('7:10/mi');
    expect(by('Asked for')!.then).toBe('6:43/mi');
    // Same work, same heart rate: the fact the pace line alone would hide.
    expect(by('Work heart rate')!.now).toBe('162 bpm');
    expect(by('Work heart rate')!.then).toBe('161 bpm');
    expect(by('Work heart rate')!.delta).toBeNull();
    expect(by('Work covered')!.now).toBe('4.03 mi');
    expect(by('Work covered')!.then).toBe('4.01 mi');

    // Both sessions recorded everything the card wanted.
    expect(m.matched!.withheld).toEqual([]);

    // NEVER the whole run. 8.5 miles against 7.5, and neither appears.
    for (const l of m.matched!.lines) {
      expect(l.now).not.toContain('8.5 mi');
      expect(l.label.toLowerCase()).not.toContain('average');
    }
  }, 60_000);

  it('draws the 2026-09-02 strides session without grading a stride', async () => {
    if (!await haveDb()) { console.warn('NO DATABASE — this assertion did not run'); return; }
    const x = (await loadPostRunDetailExtras(OWNER, RUN_0902))!;
    const a = x.analysis!;

    expect(a.grain).toBe('SAMPLED');
    expect(a.bands).toHaveLength(13);

    // Six strides, marked as strides, and NOT ONE carries a target line —
    // even though the wire stores a 401 against each of them. Four of six
    // were graded as deviations for being quick on 2026-09-02; a chart that
    // drew that target would say the same thing in pictures.
    const strides = a.bands.filter((b) => b.isStride);
    expect(strides).toHaveLength(6);
    expect(strides.every((b) => b.targetSecPerMi === null)).toBe(true);

    // The axis covers what the phases cover, 5.98, and not the 6.41 the run
    // recorded. The four tenths of overtime are the capture sentence's to
    // report and it already reports them, above the numbers (Rule 17).
    expect(a.bands[12].toMi).toBeCloseTo(5.98, 1);
    expect(Math.max(...a.points.map((p) => p.atMi))).toBeLessThan(6.1);

    /* NO COMPARATOR, AND NO SENTENCE ABOUT IT. An easy day has one work
     * segment once the strides are set aside, so a "work pace" for it would
     * be its own average pace under another name — the comparison Q44
     * forbids. The section is absent rather than refusing out loud, because
     * "no comparable session" under every easy run is furniture. */
    expect(x.match.matched).toBeNull();
    expect(x.match.refusal).toBeNull();
  }, 60_000);
});
