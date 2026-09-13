/**
 * lib/postrun/_stepped_day_after_run.audit.test.ts · a completed day reads as
 * COMPLETED however far back the runner has paged, and a SETTLED PAST DAY
 * never reads as an upcoming one.
 *
 * STEPPEDDAY-DONE-1, extended STEPPEDDAY-SETTLED-1. Read-only, against
 * production, over `faff_readonly`.
 *
 * ── THE DEFECT THIS FILE EXISTS FOR ─────────────────────────────────────────
 *
 * `/api/v5/today` gated its whole after-run branch on `glanceToday.doneMi`,
 * and `loadGlanceState` TAKES NO DATE (`lib/coach/glance-state.ts` —
 * `loadGlanceState(userId)`): its `weekDays` is always the CURRENT training
 * week. So for any viewed date outside that week `glanceToday` was null,
 * `ranToday` was false, and the route returned the PRE-RUN card for a day the
 * runner had finished, graded and sealed. Measured on production 2026-09-13,
 * runner today 2026-09-13, current training week 09-07..09-13:
 *
 *     GET /api/v5/today?date=2026-09-01          state before_run · runId null
 *                                                · postRun null
 *     GET /api/runs/-258355938987883/recap       postRun POPULATED · "Controlled
 *                                                work · All four reps landed…"
 *
 * The phone reaches those dates routinely, not exceptionally: `WeekStripV5`
 * (`native-v2/Faff/Faff/DesignV5/ChartsV5.swift`) is a paging `TabView` with
 * previous/next week pages clamped only by the PLAN's bounds, and
 * `TodayHostV5.prefetchAround` requests the whole previous and next week on
 * every navigation. A `before_run` payload renders `TodayBeforeV5`'s
 * upcoming-workout hero — prescribed type, prescribed distance, pace band —
 * over a run that was already done.
 *
 * And it is exactly the completed days that fall in the hole:
 * `viewedDayResolutionFor` (`lib/faff/v5-today.ts`) excludes `completed` on
 * purpose, because the after-run hero is supposed to own it. Two individually
 * correct decisions, one gap.
 *
 * ── WHY THIS FILE AND NOT `_postrun_surface_parity.audit.test.ts` ───────────
 *
 * That file DID catch this — by accident, twelve days late. It pins the literal
 * date `2026-09-01`, which was inside the current training week on the day it
 * was written, so it exercised the in-week path only and passed. It aged into
 * the out-of-week path and went red the first time the audit job was given a
 * credential. Rule 15: a mechanism the corpus cannot REACH is untested, and a
 * corpus that only reaches it by calendar drift is not a corpus.
 *
 * So this file resolves its own dates at run time and REQUIRES an out-of-week
 * case, failing loudly rather than passing quietly if it cannot find one.
 *
 * ── THE CALENDAR BUG IN THE FIRST VERSION OF THIS FILE (2026-09-13) ─────────
 *
 * The replacement had the same disease in a subtler form. `candidates()` kept
 * only `dateISO < today`, and the training week starts on a MONDAY. On a
 * Monday there is no elapsed in-week day at all, so the in-week partition is
 * empty BY CONSTRUCTION and two assertions here — the LIVENESS one and the
 * in-week control — went red every Monday, on correct code. Written on a
 * Sunday, it passed, which is the only reason it landed.
 *
 * Falsified 2026-09-13 by running this file under `vi.setSystemTime(
 * '2026-09-07T19:00:00Z')` (Monday noon, runner-local): both assertions failed
 * with "expected 0 to be greater than 0".
 *
 * Two repairs, and neither of them is "loosen the assertion":
 *
 *   1. TODAY IS A CANDIDATE. A day whose prescription the resolver says was
 *      SATISFIED is settled whatever the clock says — the matched run exists
 *      and is graded. Excluding it bought nothing and cost the only in-week
 *      day a Monday has.
 *   2. THE EMPTY CASE IS ARGUED, NOT SKIPPED. When the glance week still
 *      cannot contribute one, this asserts WHY — that the week has barely
 *      started — instead of passing in silence. Rule 11: "there are none",
 *      "there are none because the week is one day old" and "the corpus is
 *      broken" are three facts. A Thursday with no in-week completion is still
 *      a failure, and reads as one.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT IS THE PAYLOAD, NOT THE PHONE. It proves the wire says `after_run`,
 *     or that it says something a past day is allowed to say; it does not
 *     prove `TodayAfterV5` or `PastDayResolutionHeroV5` draws it. Rule 13's
 *     rendering half is not claimed here.
 *   · IT CANNOT TELL YOU THE POST-RUN SENTENCES ARE RIGHT. Agreement and
 *     correctness are different questions; `_postrun_surface_parity` and
 *     `_experience.test.ts` own those.
 *   · IT CANNOT SEE THE CLIENT'S DISPATCH ORDER. The settled-day invariant
 *     below asserts the payload carries SOMETHING that stops a past day
 *     rendering as upcoming; that `TodayHostV5.content(_:)` reads
 *     `viewedDayResolution` BEFORE `state` is a Swift fact, checked in
 *     `native-v2`, not here.
 *   · IT IS ONE ACCOUNT. A runner with no plan, or none of whose runs carry a
 *     `planWorkoutId`, produces no candidates — which is a LOUD failure here,
 *     not a silent pass.
 *   · IT SKIPS ITSELF WITHOUT A DATABASE, loudly, the same posture as its
 *     siblings in this directory.
 */
import { describe, it, expect, vi } from 'vitest';
import { pool } from '@/lib/db/pool';
import { loadGlanceState } from '@/lib/coach/glance-state';
import { resolveDateRangeExecutions, primaryPrescription } from '@/lib/execution/day-resolver';
import { resolveDateRangeDayStatus } from '@/lib/execution/day-resolution';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { runDaySql, runNotMergedSql, runDistanceMiSql } from '@/lib/runs/run-shape';

const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const RO = process.env.DATABASE_URL_RO ?? process.env.DATABASE_URL;

vi.mock('@/lib/auth/session', () => ({
  requireUserId: async () => '0645f40c-951d-4ccc-b86e-9979cd26c795',
}));

function shiftISO(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400000)
    .toISOString().slice(0, 10);
}

const WINDOW_DAYS = 60;

interface Candidate { dateISO: string; runId: string; inCurrentWeek: boolean }

interface Corpus {
  today: string;
  /** Days whose prescription the resolver says was SATISFIED. */
  candidates: Candidate[];
  /** The glance week's dates that have actually elapsed, today included. This
   *  is what makes an empty in-week partition ARGUABLE rather than silent. */
  elapsedGlanceDays: string[];
}

/**
 * Every date in the window on which the day resolver — the canonical owner of
 * "did this run complete what was asked" — says a prescription was SATISFIED.
 * Partitioned by whether `loadGlanceState`'s date-blind week contains it,
 * because that partition IS the defect.
 *
 * TODAY IS INCLUDED. See the calendar-bug section in the header: a satisfied
 * prescription is settled whatever the clock says, and on the first day of a
 * training week it is the only in-week candidate that can exist.
 */
async function corpus(): Promise<Corpus> {
  const today = (await runnerToday(OWNER)).slice(0, 10);
  const glance = await loadGlanceState(OWNER);
  const weekDates = glance.weekDays.map((d) => d.date);
  const currentWeek = new Set(weekDates);
  const days = await resolveDateRangeExecutions(OWNER, shiftISO(today, -WINDOW_DAYS), today);
  const candidates: Candidate[] = [];
  for (const [dateISO, day] of days) {
    if (dateISO > today) continue;                // the future settles nothing
    const primary = primaryPrescription(day);
    const matched = primary?.matchedRun;
    if (!matched) continue;                       // supplemental / unmatched: see the invariant below
    if ((matched.distanceMi ?? 0) < 0.5) continue; // below the route's own floor
    candidates.push({ dateISO, runId: matched.runId, inCurrentWeek: currentWeek.has(dateISO) });
  }
  candidates.sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
  return {
    today,
    candidates,
    elapsedGlanceDays: weekDates.filter((d) => d <= today).sort(),
  };
}

/**
 * RULE 11, AS A HELPER. Either the glance week contributed a settled completed
 * day (return it), or it could not — and then the ONLY acceptable reason is
 * that the week has barely started, which this asserts rather than assumes.
 * On a Thursday with nothing completed all week, this fails, which is right.
 */
function inWeekOrArguedEmpty(c: Corpus, take: number): Candidate[] {
  const inWk = c.candidates.filter((x) => x.inCurrentWeek);
  if (inWk.length > 0) return inWk.slice(0, take);
  expect(
    c.elapsedGlanceDays.length,
    `the current training week (${c.elapsedGlanceDays.join(', ')}) has ` +
    `${c.elapsedGlanceDays.length} elapsed days and NOT ONE satisfied ` +
    'prescription. On the first day or two of a week that is the calendar; ' +
    'any later than that it is the corpus, and this gate is no longer asking ' +
    'the in-week question at all.',
  ).toBeLessThanOrEqual(2);
  return [];
}

async function todayPayload(dateISO: string) {
  process.env.DATABASE_URL = RO as string;
  const { GET } = await import('@/app/api/v5/today/route');
  const r = await GET(new Request(`https://faff.run/api/v5/today?date=${dateISO}`) as never);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}

describe.skipIf(!RO)('stepped day · a finished run never renders as an upcoming one', () => {
  it('LIVENESS · production answered, and it holds the candidate days this gate needs', async () => {
    // Rule 18 clause 2. Without this the file can report green having found
    // nothing to ask about — and the out-of-week half is the whole point, so
    // its absence is a failure of the CORPUS, reported as such.
    expect((await pool.query('SELECT 1')).rowCount).toBe(1);
    const c = await corpus();
    expect(c.candidates.length).toBeGreaterThan(2);
    // HARD. A 60-day window always reaches beyond a 7-day training week, so an
    // empty out-of-week partition means the resolver has stopped answering.
    expect(c.candidates.filter((x) => !x.inCurrentWeek).length).toBeGreaterThan(0);
    // The in-week half asserts either a candidate or the argued reason there
    // is none. Never silence. (This is the assertion that was red every
    // Monday — see the calendar-bug section in the header.)
    inWeekOrArguedEmpty(c, 1);
    expect(c.elapsedGlanceDays.length).toBeGreaterThan(0);
  }, 240_000);

  it('OUT OF THE CURRENT TRAINING WEEK · still after_run, still carries the run', async () => {
    /* THE FALSIFIER. Run against the unfixed route this fails on the first
     * candidate with `state: 'before_run'`, `runId: null`, `postRun: null`;
     * against the fixed one every out-of-week completed day answers exactly
     * as its in-week twin does. Asserted on the SHAPE of the right answer
     * (Rule 13 clause 3), not on the absence of the wrong one. */
    const out = (await corpus()).candidates.filter((c) => !c.inCurrentWeek).slice(0, 3);
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      const { status, body } = await todayPayload(c.dateISO);
      expect(status).toBe(200);
      expect({ date: c.dateISO, state: body.state })
        .toEqual({ date: c.dateISO, state: 'after_run' });
      expect(body.runId).toBe(c.runId);
      expect(body.postRun).toBeTruthy();
      expect(typeof body.postRun.decisionVersion).toBe('string');
      expect(body.postRun.decisionVersion.length).toBeGreaterThan(0);
      // The post-run block is ABOUT this run, not about the day's prescription.
      expect(body.postRun.runId).toBe(c.runId);
      expect(body.postRun.dateISO).toBe(c.dateISO);
    }
  }, 600_000);

  it('IN the current training week · unchanged, which is what makes the above a fix', async () => {
    // The control. A repair that moved the in-week answer would be a
    // regression wearing a fix's clothes. Calendar-proof: on the first day of
    // a training week `inWeekOrArguedEmpty` asserts the reason and returns
    // nothing, rather than asserting a candidate that cannot exist.
    const inWk = inWeekOrArguedEmpty(await corpus(), 2);
    for (const c of inWk) {
      const { status, body } = await todayPayload(c.dateISO);
      expect(status).toBe(200);
      expect({ date: c.dateISO, state: body.state })
        .toEqual({ date: c.dateISO, state: 'after_run' });
      expect(body.runId).toBe(c.runId);
      expect(body.postRun).toBeTruthy();
    }
  }, 600_000);

  it('SETTLED PAST DAY · a day the runner actually ran never reads as an upcoming prescription',
    async () => {
    /* STEPPEDDAY-SETTLED-1 (2026-09-13) · THE HALF STEPPEDDAY-DONE-1 DID NOT
     * COVER, and the reason an independent review read the fix as incomplete.
     *
     * `ranToday` is `viewedDoneMi >= 0.5 && !prescriptionUnmatched`, and
     * `prescriptionUnmatched` (`lib/execution/day-resolver.ts`) answers "has
     * anything satisfied this prescription". On the runner's OWN today that is
     * exactly right and is David's ruling under WORKOUT-EXECUTION-ID-1: a run
     * with no durable association never claims a prescription, so the
     * prescription stays upcoming. On a date twelve days in the past it is a
     * different question with the same answer — the day is over, and nothing
     * about it is upcoming.
     *
     * Measured on production 2026-09-13, 90-day window, 53 past days on which
     * the runner actually ran: 7 answer `state: 'before_run'`, every one of
     * them `prescriptionUnmatched` — including 2026-08-23, an ELEVEN MILE run
     * on a day prescribing 5, and 2026-09-11, 5.36 mi on a 2 mi shakeout.
     *
     * What saves the screen today is a SECOND field. `viewedDayResolution`
     * (FINDING-3) carries `supplemental`/`missed`/`skipped`/`moved` for a
     * stepped past day, and `TodayHostV5.content(_:)` reads it BEFORE
     * `model.state`, so those days draw `PastDayResolutionHeroV5` and not the
     * pre-run hero. Verified against all 7: every one carries a resolution.
     *
     * So the runner is not seeing an upcoming card — and nothing anywhere
     * REQUIRED that. The payload still carries `state: 'before_run'` next to
     * the upcoming panel (`panel.type: "Shakeout"`, `dose: "2 mi"`, stats
     * "Pace band" and "HR ceiling") for 2026-09-11; the only thing between
     * that and the original defect is one client checking a different field
     * first. This is the invariant, stated: a past day with real running on it
     * must carry either the after-run answer or a resolution. Never a bare
     * `before_run`.
     *
     * RULE 14 · the population is read RAW — every canonical run row in the
     * window, no plan join — and only then are the app's own answers laid over
     * it. A verification query that reuses the reader's filter reproduces the
     * bug instead of revealing it. */
    const c = await corpus();
    const from = shiftISO(c.today, -WINDOW_DAYS);
    const raw = await pool.query<{ day: string; mi: string }>(
      `SELECT ${runDaySql()} AS day,
              ROUND(SUM(${runDistanceMiSql()})::numeric, 2)::text AS mi
         FROM runs
        WHERE user_uuid = $1 AND ${runNotMergedSql()}
          AND ${runDaySql()} BETWEEN $2 AND $3
        GROUP BY 1`,
      [OWNER, from, c.today],
    );
    const ranMi = new Map(raw.rows.map((r) => [r.day, Number(r.mi)]));
    const days = await resolveDateRangeExecutions(OWNER, from, c.today);

    /* The AT-RISK class, and the only one that can produce a bare
     * `before_run`: a PAST day, real running on it, and no run matched to the
     * prescription. Everything else is already covered by the two tests above.
     *
     * YESTERDAY IS EXCLUDED, and this is the same discipline the calendar bug
     * above taught. `MISSED_GRACE_HOURS` (`lib/execution/day-resolution.ts`)
     * holds a past day's resolution at `null` until 6 hours past the START of
     * the following runner-local day, so a late-night run that has not finished
     * syncing does not flash "missed". Only the immediately preceding date can
     * ever be inside that window, and during it a genuinely unmatched day
     * correctly carries no resolution. Asserting over it would make this gate
     * red as a function of the hour the job happened to run — which is the
     * defect this whole file was rewritten for. */
    const atRisk = [...ranMi.entries()]
      .filter(([d, mi]) => d < shiftISO(c.today, -1) && mi >= 0.5)
      .filter(([d]) => {
        const p = days.get(d) ? primaryPrescription(days.get(d)!) : null;
        return p != null && p.matchedRun == null;
      })
      .map(([d, mi]) => ({ dateISO: d, mi }))
      .sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));

    // LIVENESS, and the Rule 11 three-state. A window with no at-risk day is
    // not a pass — it is a corpus that cannot ask this question, and it says
    // so rather than reporting confidence. (Measured 2026-09-13: 7 in 90 days,
    // 6 of them in the 60-day window.)
    expect(
      atRisk.length,
      'no past day in the window carries running that failed to match its ' +
      'prescription, so this invariant was not exercised at all. Widen the ' +
      'window or say plainly that it went unchecked — do not read this as green.',
    ).toBeGreaterThan(0);

    const resolutions = await resolveDateRangeDayStatus(
      OWNER, from, shiftISO(c.today, 1));

    for (const day of atRisk.slice(0, 5)) {
      const { status, body } = await todayPayload(day.dateISO);
      expect(status).toBe(200);
      const resolution = body.viewedDayResolution?.resolution ?? null;
      // Asserted on the SHAPE of the right answer, not the absence of the
      // wrong one (Rule 13 clause 3): the payload must say what actually
      // happened to this day, in one of the two vocabularies a past day has.
      expect(
        { date: day.dateISO, ranMi: day.mi, settled: body.state === 'after_run' || resolution != null },
        `${day.dateISO}: the runner ran ${day.mi} mi and the payload answers ` +
        `state='${body.state}' with viewedDayResolution=${JSON.stringify(body.viewedDayResolution ?? null)}. ` +
        'A settled past day may say after_run, or it may name its resolution ' +
        '(supplemental / missed / skipped / moved). A bare before_run is the ' +
        'upcoming-prescription card over a day that is finished.',
      ).toEqual({ date: day.dateISO, ranMi: day.mi, settled: true });

      // And the two owners agree. `viewedDayResolution` is composed by
      // `lib/faff/v5-today.ts` off the week strip; `lib/execution/
      // day-resolution.ts` is the canonical owner of the same question
      // (Rule 16). A payload that resolved it differently from the owner would
      // satisfy the assertion above and still be wrong.
      if (resolution != null) {
        expect({ date: day.dateISO, wire: resolution })
          .toEqual({ date: day.dateISO, wire: resolutions.get(day.dateISO)?.resolution ?? null });
      }
    }
  }, 600_000);

  it('SOURCE · the done-reader is date-aware, and says so', async () => {
    /* Rule 20 read onto this repair: the behavioural assertions above need a
     * database, and the thing that regresses this is a one-line edit. This
     * runs with or without one and fails the moment `ranToday` goes back to
     * reading only the date-blind glance week.
     *
     * It asserts the SHAPE of the gate, not a comment: `viewedDoneMi` must
     * carry a fallback off `todayWeekDay`, which is the row `loadPlanWeek`
     * resolved for the VIEWED date. */
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../../app/api/v5/today/route.ts', import.meta.url), 'utf8');
    const gate = /const\s+ranToday\s*=\s*([^;]+);/.exec(src);
    expect(gate).not.toBeNull();
    // The gate reads the viewed-day reading, never `glanceToday.doneMi` raw.
    expect(gate![1]).not.toMatch(/glanceToday/);
    expect(gate![1]).toContain('viewedDoneMi');
    const reader = /const\s+viewedDoneMi[^;]+;/s.exec(src);
    expect(reader).not.toBeNull();
    expect(reader![0]).toContain('todayWeekDay');
    // And the completion question still belongs to the day resolver.
    expect(gate![1]).toContain('prescriptionUnmatched');
  }, 30_000);
});
