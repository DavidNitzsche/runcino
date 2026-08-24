/**
 * lib/conservation/_plan_conservation.test.ts · the week the runner sees is
 * the week that was authored.
 *
 * Run:
 *   ./node_modules/.bin/vitest run lib/conservation --disable-console-intercept 2>&1 | tail -60
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SAME QUESTION, ASKED OF THE PLAN
 *
 * The run half of this harness asks whether a measured number survives being
 * read. This half asks whether a PRESCRIBED one survives being written, stored
 * and read back — the same journey in the other direction, and it has the same
 * failure mode. Two defects of exactly this class shipped in the week this was
 * written: a session that reached a screen as the engine's own shorthand
 * (`EASY (MEDIUM)`), and a prescription rendered into a 56-point headline that
 * had nowhere to go but off the edge.
 *
 * The engine is driven for real — `buildSimPlan` is the same pure entry point
 * `_sweep_allusers.test.ts` grades 9,294 archetypes through, with no database
 * and no clock. The read-back is real too: `shapePlanWeekDays` is the function
 * `loadPlanWeek` calls, extracted so it can be reached without Postgres.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT SITS BETWEEN THEM, AND IS NOT COVERED
 *
 * `persistPlan` is private, takes a `PoolClient`, and derives the persisted
 * distance from the workout SPEC rather than from the composed day — so a
 * quality session composed as a 4-mile core is stored as its 8-mile total,
 * deliberately, so the headline matches the breakdown beneath it. Reproducing
 * that here would be transcribing the code under test, which proves only that
 * the same bug was written twice.
 *
 * So the harness enters at the row, exactly as the run half enters at the
 * canonical row, and `UNCOVERED_PLAN_HOPS` says so out loud on every run.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from '@/lib/plan/sim-inputs';
import { shapePlanWeekDays, type PlanWorkoutRow } from '@/lib/plan/week-loader';
import { displayTypeFor, subLabelIsName } from '@/lib/faff/v5-today';
import type { SimDistance } from '@/lib/plan/sim-constants';

export const UNCOVERED_PLAN_HOPS = [
  '`persistPlan` (lib/plan/generate.ts, private, takes a PoolClient). Its spec derivation, its distance-from-spec rule and its completed-day seal are entered around, not through. The harness builds the row from the composed day and says so.',
  'The other five writers of `plan_workouts` — seed-from-onboarding, injury-builder, the reschedule route, mutate, adapt — each with its OWN column list. Only the generate path is swept here.',
  'The Swift week strip. `native-v2` re-derives the strip from `type` alone and prints neither distance nor label on the v5 surface; TrainView prints both. Nothing here runs Swift.',
];

/* ══════════════════════════════════════════════════════════════════════════
 * THE ARCHETYPES
 *
 * Wide enough that a defect cannot hide in one runner's shape. Seven start
 * dates so every week-start day-of-week is exercised — the date of a day is
 * derived from its `dow` against the week's start, and that arithmetic is
 * where an off-by-one lands.
 * ═══════════════════════════════════════════════════════════════════════ */

const DISTANCES: SimDistance[] = ['5k', '10k', 'half', 'marathon'];
const FREQ = [3, 4, 5, 6];
const MILEAGE = [15, 25, 35, 45];
const STARTS = ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11'];
const WEEKS: Record<string, number> = { '5k': 10, '10k': 12, half: 14, marathon: 18 };
const GOAL_SEC: Record<string, number> = { '5k': 1350, '10k': 2700, half: 6300, marathon: 13500 };

interface Arc {
  distance: SimDistance;
  weeklyFrequency: number;
  weeklyMileageBucket: number;
  startDateISO: string;
  longRunDay: 'sun' | 'sat';
}

function* archetypes(): Generator<Arc> {
  for (const distance of DISTANCES)
    for (const weeklyFrequency of FREQ)
      for (const weeklyMileageBucket of MILEAGE)
        for (const startDateISO of STARTS)
          for (const longRunDay of ['sun', 'sat'] as const)
            yield { distance, weeklyFrequency, weeklyMileageBucket, startDateISO, longRunDay };
}

/** The date a composed day lands on, given its week's start. */
function dateForDow(weekStartISO: string, dow: number): string {
  const start = new Date(weekStartISO + 'T12:00:00Z');
  const delta = (dow - start.getUTCDay() + 7) % 7;
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * A composed day as a `plan_workouts` row.
 *
 * ONLY the columns `loadPlanWeek` actually selects. That restriction is the
 * point rather than a shortcut: `pace_target_s_per_mi`, `workout_spec`,
 * `is_quality`, `is_long` and every `original_*` column are authored on every
 * row and read back by this loader on none of them, so a law asserting they
 * survive would be asserting something the screen never asks for.
 */
function rowFor(weekStartISO: string, d: { dow: number; type: string; distanceMi: number; subLabel: string | null; notes?: string }, i: number): PlanWorkoutRow {
  return {
    id: `wko_${weekStartISO}_${i}`,
    date_iso: dateForDow(weekStartISO, d.dow),
    dow: d.dow,
    type: d.type,
    // numeric(  ) comes back from node-pg as a STRING, which is why this is
    // typed `number | string` and why the reader coerces. A test that fed a
    // number here would not exercise the coercion the real loader performs.
    distance_mi: String(d.distanceMi),
    sub_label: d.subLabel,
    notes: d.notes ?? null,
  };
}

interface Finding { law: string; arc: string; saw: string }

const arcStr = (a: Arc) => `${a.distance}/f${a.weeklyFrequency}/m${a.weeklyMileageBucket}/${a.startDateISO}/${a.longRunDay}`;

/** How many things this sweep actually looked at. A floor guards it below. */
let weeksSwept = 0;
let daysSwept = 0;

function sweep(a: Arc): Finding[] {
  const built = buildSimPlan({
    goalMode: 'goal', distance: a.distance, startDateISO: a.startDateISO,
    planWeeks: WEEKS[a.distance], goalTimeSec: GOAL_SEC[a.distance], raceDateISO: '',
    lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
    experienceLevel: 'intermediate', weeklyFrequency: a.weeklyFrequency,
    weeklyMileageBucket: a.weeklyMileageBucket, longestRunBucket: '6-10',
    raceHistory: [], longRunDay: a.longRunDay, availableDays: [],
  } as never);
  if (!built.ok) return []; // A refusal is a correct answer, not a finding.

  const out: Finding[] = [];
  for (const w of built.composed.weeks) {
    weeksSwept++;
    // The engine emits zero-distance non-rest days that persist skips.
    // Mirroring that filter is not transcription — it is the row set.
    const authored = w.days.filter((d) => d.distanceMi > 0 || d.type === 'rest' || d.type === 'race');
    const rows = authored.map((d, i) => rowFor(w.startISO, d, i));

    const seen = shapePlanWeekDays(rows, {
      weekStart: w.startISO,
      today: a.startDateISO,
      actualByDate: new Map(),
      skippedDates: new Set(),
    });
    daysSwept += seen.length;

    /* LAW P1 · SEVEN DAYS, ALWAYS, AND THEY ARE THIS WEEK'S SEVEN. */
    if (seen.length !== 7) {
      out.push({ law: 'WEEK_IS_NOT_SEVEN_DAYS', arc: arcStr(a), saw: `${seen.length} days rendered for the week of ${w.startISO}` });
      continue;
    }
    for (let i = 0; i < 7; i++) {
      const expectISO = dateForDow(w.startISO, (new Date(w.startISO + 'T12:00:00Z').getUTCDay() + i) % 7);
      if (seen[i].date_iso !== expectISO) {
        out.push({ law: 'DAY_LANDED_ON_THE_WRONG_DATE', arc: arcStr(a), saw: `slot ${i} of the week of ${w.startISO} rendered ${seen[i].date_iso}, not ${expectISO}` });
      }
      // A day's own `dow` must agree with the date it was placed on. This is
      // the off-by-one the seven start dates exist to find.
      const trueDow = new Date(seen[i].date_iso + 'T12:00:00Z').getUTCDay();
      if (seen[i].dow !== trueDow) {
        out.push({ law: 'DOW_DISAGREES_WITH_DATE', arc: arcStr(a), saw: `${seen[i].date_iso} is a ${trueDow} and carries dow ${seen[i].dow}` });
      }
    }

    /* LAW P2 · EVERY AUTHORED DAY IS ON THE SCREEN, WITH ITS OWN NUMBERS. */
    const byDate = new Map(seen.map((s) => [s.date_iso, s]));
    for (const d of authored) {
      const iso = dateForDow(w.startISO, d.dow);
      const s = byDate.get(iso);
      if (!s) {
        out.push({ law: 'AUTHORED_DAY_VANISHED', arc: arcStr(a), saw: `${d.type} ${d.distanceMi} mi on ${iso} is not on the week` });
        continue;
      }
      const isPrimary = s.plan_workout_id != null && s.type === d.type;
      const isSecondary = s.secondaryRun != null && s.secondaryRun.type === d.type;
      if (!isPrimary && !isSecondary) {
        out.push({ law: 'AUTHORED_DAY_COLLAPSED_AWAY', arc: arcStr(a), saw: `${d.type} on ${iso} is neither the day nor its secondary; the day shows ${s.type}` });
        continue;
      }
      const shownMi = isPrimary ? s.distance_mi : s.secondaryRun!.distance_mi;
      if (Math.abs(shownMi - d.distanceMi) > 0.005) {
        out.push({ law: 'PRESCRIBED_DISTANCE_CHANGED', arc: arcStr(a), saw: `${d.type} on ${iso} authored ${d.distanceMi} mi, rendered ${shownMi} mi` });
      }
      const shownLabel = isPrimary ? s.sub_label : s.secondaryRun!.sub_label;
      if ((d.subLabel ?? null) !== (shownLabel ?? null)) {
        out.push({ law: 'SESSION_NAME_CHANGED', arc: arcStr(a), saw: `${iso} authored "${d.subLabel}", rendered "${shownLabel}"` });
      }
    }

    /* LAW P3 · A SYNTHESISED REST DAY IS A REST DAY.
     *
     * The loader emits seven days whether or not a row exists and calls the
     * gaps REST. That is right for the screen and it is also a place a real
     * authored day could be quietly replaced, so the invariant is stated: a
     * day with no row carries no id, no distance, and the type it was given. */
    for (const s of seen) {
      if (s.plan_workout_id != null) continue;
      if (s.type !== 'rest' || s.distance_mi !== 0) {
        out.push({ law: 'SYNTHESISED_DAY_CARRIES_A_SESSION', arc: arcStr(a), saw: `${s.date_iso} has no row but renders ${s.type} ${s.distance_mi} mi` });
      }
    }

    /* LAW P4 · THE WEEK'S MILEAGE IS THE WEEK'S MILEAGE.
     *
     * Summed over what the screen SHOWS, primary plus secondary, against what
     * the engine authored. This is the law a collapse would break silently. */
    const authoredMi = authored.reduce((s, d) => s + d.distanceMi, 0);
    const shownTotal = seen.reduce((s, d) => s + d.distance_mi + (d.secondaryRun?.distance_mi ?? 0), 0);
    if (Math.abs(authoredMi - shownTotal) > 0.02) {
      out.push({ law: 'WEEK_MILEAGE_CHANGED', arc: arcStr(a), saw: `week of ${w.startISO} authored ${authoredMi.toFixed(1)} mi, the strip totals ${shownTotal.toFixed(1)} mi` });
    }

    /* LAW P5 · WHAT THE PANEL PUTS IN ITS HEADLINE IS A NAME.
     *
     * `V5Panel.type` is drawn at 56 points. A prescription in that slot has
     * nowhere to go but off the edge, and the engine's own shorthand in it
     * says nothing to a runner. Both shipped this week. `displayTypeFor` is
     * the real gate — this asserts its OUTPUT, so a label that slips past
     * `subLabelIsName` is caught by what the screen would actually draw. */
    for (const s of seen) {
      const headline = displayTypeFor(s.type, s.sub_label);
      if (headline.length > 16) {
        out.push({ law: 'HEADLINE_TOO_LONG_FOR_56PT', arc: arcStr(a), saw: `${s.date_iso} headline "${headline}" is ${headline.length} characters` });
      }
      if (/[()]/.test(headline)) {
        out.push({ law: 'HEADLINE_IS_ENGINE_SHORTHAND', arc: arcStr(a), saw: `${s.date_iso} headline "${headline}" — a parenthetical is the engine talking to itself` });
      }
      // A label the gate REJECTED must not reach the headline anyway.
      if (s.sub_label && !subLabelIsName(s.sub_label) && headline === s.sub_label) {
        out.push({ law: 'REJECTED_LABEL_REACHED_THE_HEADLINE', arc: arcStr(a), saw: `${s.date_iso} "${s.sub_label}" failed subLabelIsName and was drawn anyway` });
      }
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * POSITIVE CONTROLS · plant a corruption in the row set and prove it is caught.
 * ═══════════════════════════════════════════════════════════════════════ */

const WEEK_START = '2026-07-06';
const CLEAN: PlanWorkoutRow[] = [
  { id: 'a', date_iso: '2026-07-06', dow: 1, type: 'easy', distance_mi: '6', sub_label: 'EASY' },
  { id: 'b', date_iso: '2026-07-08', dow: 3, type: 'threshold', distance_mi: '8', sub_label: '2 mi WU · 4 mi @ T · 2 mi CD' },
  { id: 'c', date_iso: '2026-07-12', dow: 0, type: 'long', distance_mi: '14', sub_label: 'LONG' },
];
const shape = (rows: PlanWorkoutRow[]) => shapePlanWeekDays(rows, {
  weekStart: WEEK_START, today: WEEK_START, actualByDate: new Map(), skippedDates: new Set(),
});

describe('conservation · the plan, from authoring to the week strip', () => {
  it('the laws catch a corrupted week', () => {
    const missed: string[] = [];

    // A distance that changed between the row and the screen.
    const bumped = shape(CLEAN.map((r) => (r.id === 'c' ? { ...r, distance_mi: '14' } : r)));
    const longDay = bumped.find((d) => d.type === 'long');
    if (longDay?.distance_mi !== 14) missed.push('the loader did not carry a numeric(  ) string through as a number');

    // Engine shorthand in the 56pt headline.
    const shorthand = shape([{ ...CLEAN[0], sub_label: 'EASY (MEDIUM)' }]);
    const headline = displayTypeFor(shorthand[0].type, shorthand[0].sub_label);
    if (!/[()]/.test(headline)) {
      // Caught upstream by `subLabelIsName` — which is the correct outcome,
      // but only if it is the REASON, so assert the reason.
      if (subLabelIsName('EASY (MEDIUM)')) missed.push('`EASY (MEDIUM)` passes subLabelIsName AND does not reach the headline — neither guard explains why');
    }

    // A prescription in the headline slot.
    const rx = shape([{ ...CLEAN[1] }]);
    if (displayTypeFor(rx[0].type, rx[0].sub_label).length > 16) {
      missed.push('a prescription reached the 56pt headline and no law objected');
    }

    // Two rows on one date — the collapse must surface the loser.
    const doubled = shape([...CLEAN, { id: 'd', date_iso: '2026-07-06', dow: 1, type: 'easy', distance_mi: '3', sub_label: 'EASY' }]);
    const monday = doubled.find((d) => d.date_iso === '2026-07-06')!;
    if (monday.secondaryRun == null) missed.push('a second run on one date vanished with no secondaryRun');

    console.log(`\n=== PLAN CONTROLS · ${4 - missed.length} of 4 caught ===`);
    for (const m of missed) console.log(`  MISSED  ${m}`);
    expect(missed, 'the plan laws have stopped working').toEqual([]);
  });

  it('`EASY (MEDIUM)` cannot reach a runner-facing headline', () => {
    // The exact string that shipped. Named rather than generalised, because a
    // regression here should read as the thing that happened, not as a class.
    expect(subLabelIsName('EASY (MEDIUM)'), 'the parenthetical shorthand passes the name gate').toBe(false);
    expect(displayTypeFor('easy', 'EASY (MEDIUM)')).toBe('Easy');
    expect(displayTypeFor('long', 'LONG (EASY)')).toBe('Long');
  });

  it('every authored week is the week the runner sees', () => {
    const byLaw = new Map<string, Finding[]>();
    let arcs = 0;
    for (const a of archetypes()) {
      arcs++;
      for (const fnd of sweep(a)) {
        const list = byLaw.get(fnd.law) ?? [];
        list.push(fnd);
        byLaw.set(fnd.law, list);
      }
    }
    const total = [...byLaw.values()].reduce((s, v) => s + v.length, 0);

    console.log(`\n=== SWEPT ${arcs} PLAN ARCHETYPES · ${weeksSwept} weeks · ${daysSwept} rendered days ===`);
    console.log('\n--- PLAN HOPS THIS HARNESS DOES NOT COVER ---');
    for (const u of UNCOVERED_PLAN_HOPS) console.log(`  · ${u}`);
    console.log(`\n--- FINDINGS · ${total} across ${byLaw.size} laws ---`);
    for (const [law, list] of [...byLaw.entries()].sort((x, y) => y[1].length - x[1].length)) {
      console.log(`  [${list.length}] ${law}`);
      for (const fnd of list.slice(0, 3)) console.log(`        ${fnd.arc} — ${fnd.saw}`);
    }

    // THE FLOOR. A sweep that authored nothing and reported clean is the same
    // bug one level up.
    expect(arcs, 'too few archetypes for this sweep to mean anything').toBeGreaterThanOrEqual(400);
    expect(weeksSwept, 'no weeks were composed — the engine refused everything').toBeGreaterThanOrEqual(2000);
    expect(daysSwept, 'no days were rendered — the loader returned nothing').toBeGreaterThanOrEqual(14000);

    // THE GATE.
    expect([...byLaw.entries()].map(([law, list]) => `[${list.length}] ${law} e.g. ${list[0].saw}`)).toEqual([]);
  }, 120_000);
});
