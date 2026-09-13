/**
 * lib/postrun/_stepped_day_after_run.audit.test.ts · a completed day reads as
 * COMPLETED however far back the runner has paged.
 *
 * STEPPEDDAY-DONE-1. Read-only, against production, over `faff_readonly`.
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
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT IS THE PAYLOAD, NOT THE PHONE. It proves the wire says `after_run`;
 *     it does not prove `TodayAfterV5` draws it. Rule 13's rendering half is
 *     not claimed here.
 *   · IT ONLY ASKS ABOUT DAYS WITH AN EXACT PRESCRIPTION MATCH. A supplemental
 *     day (a run with no durable association) is CORRECTLY `before_run` per
 *     WORKOUT-EXECUTION-ID-1 and David's ruling, and is deliberately excluded
 *     from the candidate set rather than asserted either way.
 *   · IT IS ONE ACCOUNT. A runner with no plan, or none of whose runs carry a
 *     `planWorkoutId`, produces no candidates — which is a LOUD failure here,
 *     not a silent pass.
 *   · IT CANNOT TELL YOU THE POST-RUN SENTENCES ARE RIGHT. Agreement and
 *     correctness are different questions; `_postrun_surface_parity` and
 *     `_experience.test.ts` own those.
 *   · IT SKIPS ITSELF WITHOUT A DATABASE, loudly, the same posture as its
 *     siblings in this directory.
 */
import { describe, it, expect, vi } from 'vitest';
import { pool } from '@/lib/db/pool';
import { loadGlanceState } from '@/lib/coach/glance-state';
import { resolveDateRangeExecutions, primaryPrescription } from '@/lib/execution/day-resolver';
import { runnerToday } from '@/lib/runtime/runner-tz';

const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const RO = process.env.DATABASE_URL_RO ?? process.env.DATABASE_URL;

vi.mock('@/lib/auth/session', () => ({
  requireUserId: async () => '0645f40c-951d-4ccc-b86e-9979cd26c795',
}));

function shiftISO(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400000)
    .toISOString().slice(0, 10);
}

interface Candidate { dateISO: string; runId: string; inCurrentWeek: boolean }

/**
 * Every date in the last 60 days on which the day resolver — the canonical
 * owner of "did this run complete what was asked" — says a prescription was
 * SATISFIED. Partitioned by whether `loadGlanceState`'s date-blind week
 * contains it, because that partition IS the defect.
 */
async function candidates(): Promise<Candidate[]> {
  const today = (await runnerToday(OWNER)).slice(0, 10);
  const glance = await loadGlanceState(OWNER);
  const currentWeek = new Set(glance.weekDays.map((d) => d.date));
  const days = await resolveDateRangeExecutions(OWNER, shiftISO(today, -60), today);
  const out: Candidate[] = [];
  for (const [dateISO, day] of days) {
    if (dateISO >= today) continue; // a day still in progress is not settled
    const primary = primaryPrescription(day);
    const matched = primary?.matchedRun;
    if (!matched) continue;                       // supplemental / unmatched: excluded, see header
    if ((matched.distanceMi ?? 0) < 0.5) continue; // below the route's own floor
    out.push({ dateISO, runId: matched.runId, inCurrentWeek: currentWeek.has(dateISO) });
  }
  return out.sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
}

async function todayPayload(dateISO: string) {
  process.env.DATABASE_URL = RO as string;
  const { GET } = await import('@/app/api/v5/today/route');
  const r = await GET(new Request(`https://faff.run/api/v5/today?date=${dateISO}`) as never);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}

describe.skipIf(!RO)('stepped day · a finished run never renders as an upcoming one', () => {
  it('LIVENESS · production answered, and it holds BOTH kinds of candidate day', async () => {
    // Rule 18 clause 2. Without this the file can report green having found
    // nothing to ask about — and the out-of-week half is the whole point, so
    // its absence is a failure of the CORPUS, reported as such.
    expect((await pool.query('SELECT 1')).rowCount).toBe(1);
    const c = await candidates();
    expect(c.length).toBeGreaterThan(2);
    expect(c.filter((x) => x.inCurrentWeek).length).toBeGreaterThan(0);
    expect(c.filter((x) => !x.inCurrentWeek).length).toBeGreaterThan(0);
  }, 240_000);

  it('OUT OF THE CURRENT TRAINING WEEK · still after_run, still carries the run', async () => {
    /* THE FALSIFIER. Run against the unfixed route this fails on the first
     * candidate with `state: 'before_run'`, `runId: null`, `postRun: null`;
     * against the fixed one every out-of-week completed day answers exactly
     * as its in-week twin does. Asserted on the SHAPE of the right answer
     * (Rule 13 clause 3), not on the absence of the wrong one. */
    const out = (await candidates()).filter((c) => !c.inCurrentWeek).slice(0, 3);
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
    // regression wearing a fix's clothes.
    const inWk = (await candidates()).filter((c) => c.inCurrentWeek).slice(0, 2);
    expect(inWk.length).toBeGreaterThan(0);
    for (const c of inWk) {
      const { status, body } = await todayPayload(c.dateISO);
      expect(status).toBe(200);
      expect({ date: c.dateISO, state: body.state })
        .toEqual({ date: c.dateISO, state: 'after_run' });
      expect(body.runId).toBe(c.runId);
      expect(body.postRun).toBeTruthy();
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
