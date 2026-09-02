/**
 * MP-SPACING GATE (2026-09-01) · `Research/04` §16, ACROSS THE WEEK BOUNDARY.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * §16 "Combinations to avoid" names it outright:
 *
 *   | MP long run + hard tempo within 5 days | Same energy system, same
 *     impact pattern, no recovery between |
 *
 * The engine already honours that rule INSIDE a week: `DOCTRINE-MPLONG-1`
 * takes the tempo slot out of any week whose long run carries marathon pace
 * (`mpLongWeek` in `layoutWeek`). The rule was enforced per WEEK, and §16 is
 * stated in DAYS, so a pair five days apart that straddles a Sunday/Monday
 * boundary was invisible to it.
 *
 * Two of the block's own passes then place exactly such a pair, by design and
 * in different weeks:
 *
 *   · `authorDressRehearsal` puts §4.6's rehearsal on the long run three
 *     weeks out ("3 weeks pre-marathon; before taper begins"), which is the
 *     LAST DAY of the last race-specific week;
 *   · `taperMpDose` puts §9.2's week-minus-3 session ("Final MP-specific
 *     (14-16 mi w/ 10-12 mi at MP)") in the FIRST taper week, two days later.
 *
 * Measured on the owner's live CIM block `pln_9a57561debb776e5`, and
 * reproduced by this fixture against the composer:
 *
 *   2026-11-15  LONG 16 mi · "4mi @ M"                 (dress rehearsal)
 *   2026-11-17  TEMPO 15 mi · "2.5 WU · 11 mi @ MP · 1.5 CD"
 *
 * Two days apart, fifteen miles at marathon pace across three days, on the
 * legs a taper exists to freshen. §16 asks for five days.
 *
 * ── WHAT THIS GATE ASSERTS ──────────────────────────────────────────────────
 *
 * Over a composed marathon block: no marathon-pace QUALITY session and no
 * marathon-pace LONG RUN land within §16's window of each other. The window
 * is read out of the doc at run time rather than hardcoded, so the gate cannot
 * quietly disagree with doctrine (Rule 18: a check that hardcodes both sides
 * only proves the test agrees with itself).
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ─────────────────────────────────
 *
 *   · It reads the SUB_LABEL for marathon-pace content, because that is where
 *     the composer records a long run's race-pace segment between compose and
 *     persist. A session that carried MP without saying so in its label would
 *     be invisible to it.
 *   · It is scoped to §16's MP row. The other four rows of that table (VO2max
 *     + long within 48 h, two thresholds back to back, fast-finish long before
 *     a goal race, 400m R the day before a threshold) are not checked here.
 *   · It composes ONE runner shape. It cannot say the rule holds for every
 *     archetype; `_sweep_allusers` owns breadth, and this owns the pair the
 *     corpus cannot express because the corpus has no dress rehearsal.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { OWNER_DAILY_MI } from './history-shapes';
import { resolveCitation } from '@/lib/doctrine/resolve';

/** §16's own window, in days, parsed from the row rather than restated. */
function mpTempoWindowDays(): number {
  const cite = resolveCitation('Research/04-workout-vocabulary.md', '## 16. Combinations to avoid');
  const row = cite.table().cell('MP long run + hard tempo within 5 days', 'Why');
  // The window is in the row's own KEY; assert the key still says what we read.
  const m = /within\s+(\d+)\s+days/i.exec('MP long run + hard tempo within 5 days');
  if (!m || !row) {
    throw new Error(
      'MP-SPACING · Research/04 §16 no longer carries the "MP long run + hard tempo within N days" row. '
      + 'Re-read the table and re-derive the window; do not hardcode it.',
    );
  }
  return Number(m[1]);
}

const OWNER_AFC_HALF_SEC = 1 * 3600 + 41 * 60 + 53;

function ownerBlock() {
  return buildSimPlan({
    goalMode: 'race', distance: 'marathon', experienceLevel: 'advanced',
    weeklyFrequency: 6, weeklyMileageBucket: 45, longestRunBucket: '10+',
    longRunDay: 'sun', restDay: 'fri',
    startDateISO: '2026-08-30', raceDateISO: '2026-12-06',
    goalTimeSec: 10800, planWeeks: 0,
    lastRaceFinishedDaysAgo: 14, lastRaceDistance: 'half',
    raceHistory: [{ distance: 'half', timeSec: OWNER_AFC_HALF_SEC, whenRaced: '<6mo' }],
    availableDays: [], dailyMiMostRecentFirst: [...OWNER_DAILY_MI], isMidBlock: true,
  } as unknown as Parameters<typeof buildSimPlan>[0]);
}

/** Marathon pace declared in a day's own prescription. `@ M`, `@ MP`. */
function carriesMarathonPace(subLabel: string | null | undefined): boolean {
  return /@\s*MP?\b/i.test(String(subLabel ?? ''));
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000,
  );
}

interface MpDay { dateISO: string; kind: 'long' | 'quality'; label: string; mi: number }

/** Every day in the composed block whose prescription declares marathon pace. */
function marathonPaceDays(built: ReturnType<typeof buildSimPlan>): MpDay[] {
  if (!built.ok) throw new Error('compose failed: ' + (built as { reason?: string }).reason);
  const out: MpDay[] = [];
  for (const w of built.composed.weeks) {
    const startDow = new Date(w.startISO + 'T12:00:00Z').getUTCDay();
    for (const d of w.days) {
      if (d.type === 'race' || d.type === 'rest') continue;
      if (!carriesMarathonPace(d.subLabel)) continue;
      out.push({
        dateISO: addDays(w.startISO, ((d.dow - startDow) % 7 + 7) % 7),
        kind: d.isLong ? 'long' : 'quality',
        label: String(d.subLabel),
        mi: d.distanceMi,
      });
    }
  }
  return out.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

describe('Research/04 §16 · an MP long run and a hard MP tempo are not run within five days', () => {
  it('the window is doctrine\'s own, read out of the table', () => {
    expect(mpTempoWindowDays()).toBe(5);
  });

  it('no MP long run sits inside §16\'s window of an MP quality session', () => {
    const built = ownerBlock();
    const windowDays = mpTempoWindowDays();
    const days = marathonPaceDays(built);
    // LIVENESS (Rule 18 point 2). A gate that finds no MP work at all and
    // reports clean is the worst outcome available: this block is a marathon
    // build and it must contain marathon-pace sessions of both kinds.
    expect(days.filter((d) => d.kind === 'long').length, 'no MP LONG RUN in a marathon block · the gate is scanning nothing').toBeGreaterThan(0);
    expect(days.filter((d) => d.kind === 'quality').length, 'no MP QUALITY session in a marathon block · the gate is scanning nothing').toBeGreaterThan(0);

    const violations: string[] = [];
    for (const a of days) {
      for (const b of days) {
        if (a === b) continue;
        if (a.kind === b.kind) continue;           // §16 names the PAIR, one of each
        const gap = Math.abs(daysBetween(a.dateISO, b.dateISO));
        if (gap === 0 || gap >= windowDays) continue;
        const [long, quality] = a.kind === 'long' ? [a, b] : [b, a];
        const key = `${long.dateISO} LONG "${long.label}" (${long.mi}mi) → ${quality.dateISO} ${quality.kind.toUpperCase()} "${quality.label}" (${quality.mi}mi) · ${gap} day(s)`;
        if (!violations.includes(key)) violations.push(key);
      }
    }
    expect(
      violations,
      'Research/04 §16: "MP long run + hard tempo within 5 days | Same energy system, same impact\n'
      + 'pattern, no recovery between". These pairs are inside that window. The rule is enforced\n'
      + 'per WEEK by DOCTRINE-MPLONG-1 and §16 is stated in DAYS, so a pair straddling the\n'
      + 'week boundary passed every existing check.\n  '
      + violations.join('\n  '),
    ).toEqual([]);
  });
});
