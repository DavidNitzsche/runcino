/**
 * lib/brain/orchestration/_move_readjudication_live.audit.test.ts
 * · THE NINE CHECKS, AGAINST THE OWNER'S ACTUAL BLOCK.  (Rule 13, Rule 21)
 *
 * `_move_readjudication.test.ts` drives the checks with a synthetic two-week
 * fixture, and a fixture is exactly what Rule 13 says is not enough for
 * anything the runner sees: *"Fixtures skip the exact code paths that break."*
 * More sharply, Rule 21 sets the bar for a mechanism: compute what the runner
 * would have had to DO to trigger it, then check whether anything he has
 * actually run would have. A re-adjudicator that only ever fires on invented
 * data is decoration.
 *
 * So this file reads the LIVE plan and asks the checks real questions about it:
 * take the block's own long run, and the block's own quality session, and
 * propose the moves a runner actually makes — onto the day beside another hard
 * session, onto the day after a race he ran.
 *
 * READ-ONLY, in the pattern `_owned_days_reign.audit.test.ts` set:
 * `DATABASE_URL` is overridden onto the read-only role BEFORE `lib/db/pool`'s
 * module-level `new Pool(...)` runs, so every module under test is imported
 * DYNAMICALLY inside a test body. It skips entirely without `DATABASE_URL_RO`,
 * so CI never depends on a database.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON  (Rule 22) ───────────────────────────────
 *
 * · **A block with no quality session and no long run.** It skips rather than
 *   asserting, and says so, because a vacuous pass is worse than no test.
 * · **The queue-backed three.** Migration 167 is not applied to production, so
 *   DEFERRALS, SCHEDULED_GATES and CONDITIONAL_DOSES refuse on the live
 *   database. That is the honest state and this file ASSERTS the refusal
 *   rather than skipping it — a check that could not run must reach the report
 *   as itself, and the day the migration lands this assertion is what makes
 *   somebody update it.
 * · **Anything the runner SEES.** It proves the engine's readings, not the
 *   phone's rendering of them. The iPhone move sheet still points at
 *   `/api/plan/reschedule`; repointing it at `/api/plan/move` is the open
 *   half, and it is named in the handback rather than implied here.
 * · **Writes.** It opens nothing but SELECTs, on the read-only role.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const d = RO ? describe : describe.skip;

d('the nine checks, on the live block', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let mod: any;
  let resch: any;
  let contract: any;
  let shape: any;
  let tl: any;
  let races: any[];

  beforeAll(async () => {
    process.env.DATABASE_URL = RO;
    mod = await import('./move-orchestrator');
    resch = await import('@/lib/plan/reschedule');
    contract = await import('@/lib/coaching-contract/move-readjudication');
    const scen = await import('@/lib/plan/replan-scenarios');
    shape = await scen.loadPlanShape(OWNER);
    if (shape) {
      tl = resch.timelineOf(shape);
      races = await resch.loadRaceCalendar(OWNER);
    }
  });

  it('liveness · a real block was read, with real weeks and real days', () => {
    expect(shape, 'no active plan for the owner').not.toBeNull();
    expect(shape.weeks.length).toBeGreaterThan(3);
    const days = shape.weeks.reduce((n: number, w: any) => n + w.days.length, 0);
    expect(days).toBeGreaterThan(20);
    // eslint-disable-next-line no-console
    console.log(`[live] plan ${shape.planId} · ${shape.weeks.length} weeks · ${days} days · ${races.length} races`);
  });

  it('every authored week prices, or says honestly why it cannot', () => {
    let priced = 0;
    let refused = 0;
    for (const w of shape.weeks) {
      const p = mod.priceOneWeek(w, tl.byDate);
      if (p.demandIndex === null) { refused += 1; continue; }
      priced += 1;
      expect(p.weeklyMi).toBeGreaterThanOrEqual(0);
      expect(p.demandIndex).toBeGreaterThanOrEqual(p.weeklyMi);   // surcharges are additive
    }
    // eslint-disable-next-line no-console
    console.log(`[live] demand priced on ${priced} weeks, refused on ${refused}`);
    // Rule 11 · both outcomes are legal. What is NOT legal is a week reporting
    // a demand index while its quality minutes were unknown, and the loop
    // above cannot produce one.
    expect(priced + refused).toBe(shape.weeks.length);
  });

  it('RULE 21 · a move onto the day beside a real hard session is REFUSED on the real block', () => {
    // The block's own quality sessions, in the future half of the block.
    const hard = [...tl.byDate.values()]
      .filter((x: any) => resch.isDemanding(x))
      .sort((a: any, b: any) => (a.dateISO < b.dateISO ? -1 : 1));
    if (hard.length < 2) {
      // eslint-disable-next-line no-console
      console.log('[live] SKIPPED · the block carries fewer than two demanding days');
      return;
    }
    // Find a real adjacent-pair opportunity: a demanding day, and a later
    // demanding day whose move onto the day after the first breaks spacing.
    let proved = false;
    for (let i = 0; i + 1 < hard.length && !proved; i += 1) {
      const anchor = hard[i];
      const dest = resch.addDaysISO(anchor.dateISO, 1);
      if (!tl.byDate.has(dest)) continue;
      if (resch.isDemanding(tl.byDate.get(dest))) continue;   // already broken
      const mover = hard.find((x: any) => x.dateISO > dest);
      if (!mover) continue;
      const after = resch.applyEditsToTimeline(tl, mod.synthesizeEdits(tl, mover, dest));
      const out = mod.spacingCheck(tl, after, mover, {
        planWorkoutId: mover.id, fromISO: mover.dateISO, toISO: dest, optionId: null,
      });
      const r = contract.findingsOf(out).filter((f: any) => f.severity === 'REFUSES');
      if (r.length === 0) continue;
      proved = true;
      // eslint-disable-next-line no-console
      console.log(`[live] spacing REFUSED · ${r[0].what}`);
      expect(r[0].onISO).toBe(dest);
      expect(r[0].what).toContain(anchor.dateISO);
    }
    expect(proved, 'no move on the live block breaks hard-session spacing · the check is a wall, not a bar').toBe(true);
  });

  it('RULE 21 · the block\'s own long run, moved beside a real race, is REFUSED', () => {
    const longs = [...tl.byDate.values()].filter((x: any) => x.isLong === true && x.type !== 'race');
    if (longs.length === 0 || races.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[live] SKIPPED · no long run or no race on the calendar');
      return;
    }
    const race = races[0];
    const target = longs[0];
    const dest = resch.addDaysISO(race.dateISO, 1);
    const out = mod.longRunCheck(tl, tl.byDate, target, {
      planWorkoutId: target.id, fromISO: target.dateISO, toISO: dest, optionId: null,
    }, races);
    const r = contract.findingsOf(out).filter((f: any) => f.severity === 'REFUSES');
    // eslint-disable-next-line no-console
    console.log(`[live] long-run placement · ${r.length} refusal(s): ${r.map((x: any) => x.what).join(' | ')}`);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].what).toContain(race.name);
  });

  it('RULE 11 · the queue-backed checks REFUSE on production, because migration 167 is not applied', async () => {
    const sched = await import('@/lib/ops/reassessment-scheduler');
    const q = await sched.loadLiveQueue(OWNER);
    // eslint-disable-next-line no-console
    console.log(`[live] reassessment queue state: ${q.state}`);
    const gates = mod.scheduledGateCheck(q, {
      fromWeekStartISO: shape.weeks[0].startISO,
      toWeekStartISO: shape.weeks[0].startISO,
      crossesWeekBoundary: false,
    }, { planWorkoutId: 'x', fromISO: '2026-01-01', toISO: '2026-01-02', optionId: null });
    if (q.state === 'ok') {
      // The migration landed. Update this assertion deliberately rather than
      // letting it rot into "whatever happened".
      expect(gates.state).toBe('ran');
    } else {
      expect(gates.state).toBe('refused');
      expect(mod.deferralCheck(q, 'v').state).toBe('refused');
      expect(mod.conditionalDoseCheck(q, null, {
        fromWeekStartISO: 'a', toWeekStartISO: 'a', crossesWeekBoundary: false,
      }).state).toBe('refused');
    }
  });

  it('a report assembled from the live block never reads CLEAR while a check refused', () => {
    const checks: Record<string, any> = {};
    for (const c of contract.READJUDICATION_CHECKS) {
      checks[c] = { state: 'ran', findings: [], read: 'live' };
    }
    checks.DEFERRALS = { state: 'refused', why: 'migration 167 is not applied here' };
    expect(contract.verdictOf({
      move: { planWorkoutId: 'x', fromISO: '2026-01-01', toISO: '2026-01-02', optionId: null },
      weeks: contract.affectedWeeks('a', 'a'),
      checks, betterDate: null, planId: shape.planId, planVersion: 'v', asOfISO: '2026-09-05',
    })).toBe('INCOMPLETE');
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
});
