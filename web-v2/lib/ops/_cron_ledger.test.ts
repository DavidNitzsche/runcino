/**
 * lib/ops/_cron_ledger.test.ts · the gate behind the scheduler.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CANNOT FAIL ON (CLAUDE.md Rule 22)
 *
 * Written down first, because the honest list is the useful part:
 *
 *   · It cannot tell whether a job is scheduled at the RIGHT hour. Every slot
 *     here is asserted against the workflow file that already used it, so a
 *     wrong hour agreed on by both would pass.
 *   · It cannot prove the scheduler works END TO END. Nothing here starts a
 *     server or issues an HTTP request; `POST /api/cron/tick` is exercised
 *     against production by hand, and that evidence lives in the session
 *     report, not in this file.
 *   · It cannot see a job that succeeds for one runner and throws for another.
 *     The ledger and this gate both operate at the level of the ROUTE.
 *   · It cannot tell a stale `ops_alerts` heartbeat from a fresh one — there is
 *     no database here. The staleness ARITHMETIC is tested; the read is not.
 *   · The distribution question Rule 22 actually asks: this suite is heavier on
 *     "does it correctly REFUSE to run" than on "does it correctly run". That
 *     imbalance is deliberate and argued — a scheduler that runs something it
 *     should not can double an idempotent job (cheap), whereas one that refuses
 *     wrongly can silently stop authoring plans (the failure this work exists
 *     to end). Both directions ARE covered; the weighting is not habit.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CRON_JOBS,
  EXCLUDED_FROM_TICK,
  blockedBy,
  cronJob,
  isDue,
  ledgerSource,
  mostRecentSlot,
  staleness,
  type LastSuccess,
} from './cron-ledger';

const utc = (iso: string) => new Date(iso);
const ran = (iso: string): LastSuccess => ({ state: 'ran', at: utc(iso) });
const never: LastSuccess = { state: 'never' };
const readFailed: LastSuccess = { state: 'read_failed', error: 'connection terminated' };

const CRON_DIR = path.resolve(__dirname, '../../app/api/cron');

describe('mostRecentSlot', () => {
  it('returns today\'s slot once it has opened', () => {
    expect(mostRecentSlot(utc('2026-08-30T05:00:00Z'), [3])?.toISOString())
      .toBe('2026-08-30T03:00:00.000Z');
  });

  it('reaches back across the UTC day boundary for a slot not yet opened today', () => {
    // 02:00 on the 30th, slot at 09:00. The slot it is LATE FOR is the 29th's,
    // not the 30th's — a scheduler that picked the future slot would report
    // "not due" forever and this is the shape that would hide it.
    expect(mostRecentSlot(utc('2026-08-30T02:00:00Z'), [9])?.toISOString())
      .toBe('2026-08-29T09:00:00.000Z');
  });

  it('picks the latest of several slots that have opened', () => {
    expect(mostRecentSlot(utc('2026-08-30T10:00:00Z'), [4, 9])?.toISOString())
      .toBe('2026-08-30T09:00:00.000Z');
    expect(mostRecentSlot(utc('2026-08-30T06:00:00Z'), [4, 9])?.toISOString())
      .toBe('2026-08-30T04:00:00.000Z');
  });

  it('is exact on the slot boundary', () => {
    expect(mostRecentSlot(utc('2026-08-30T03:00:00Z'), [3])?.toISOString())
      .toBe('2026-08-30T03:00:00.000Z');
  });
});

describe('isDue · the catch-up property', () => {
  const job = cronJob('run-adaptations')!;

  it('runs a job whose trigger arrived TWELVE HOURS LATE', () => {
    // This is the measured production case: slot 03:00 UTC, actual GitHub start
    // 15:08 UTC. Under a plain cron the 03:00 firing simply did not happen.
    const verdict = isDue(utc('2026-08-30T15:08:00Z'), job, ran('2026-08-29T09:01:00Z'));
    expect(verdict.due).toBe(true);
    expect(verdict).toMatchObject({ reason: 'slot_open' });
  });

  it('does NOT run it a second time once the slot is satisfied', () => {
    const verdict = isDue(utc('2026-08-30T20:00:00Z'), job, ran('2026-08-30T15:08:00Z'));
    expect(verdict.due).toBe(false);
    expect(verdict).toMatchObject({ reason: 'satisfied' });
  });

  it('runs a job that has never run', () => {
    expect(isDue(utc('2026-08-30T15:00:00Z'), job, never)).toMatchObject({
      due: true, reason: 'never_run',
    });
  });

  it('does NOT stampede when the ledger read FAILED', () => {
    // Rule 11 pointed at a job runner. `read_failed` is not "nothing has run";
    // treating it as such would fire every job in the registry on every tick
    // for as long as the database was unwell. Falsified by inverting the guard
    // in isDue during development: with `read_failed` folded into `never`, this
    // assertion flips to due:true and the test fails, which is the proof the
    // guard is load-bearing rather than decorative.
    const verdict = isDue(utc('2026-08-30T15:00:00Z'), job, readFailed);
    expect(verdict.due).toBe(false);
    expect(verdict).toMatchObject({ reason: 'unknown_last_success' });
  });

  it('honours BOTH of plan-drift\'s daily slots', () => {
    const drift = cronJob('plan-drift')!;
    expect(drift.slotsUtcHour).toEqual([4, 9]);
    // Satisfied at 05:00 for the 04:00 slot, then due again once 09:00 opens.
    expect(isDue(utc('2026-08-30T06:00:00Z'), drift, ran('2026-08-30T05:00:00Z')).due).toBe(false);
    expect(isDue(utc('2026-08-30T09:30:00Z'), drift, ran('2026-08-30T05:00:00Z')).due).toBe(true);
  });
});

describe('blockedBy · the ordering guarantee, made to fail on purpose', () => {
  const now = utc('2026-08-30T15:00:00Z');
  const drift = cronJob('plan-drift')!;

  it('DEFERS plan-drift while run-adaptations is still due', () => {
    // The incident, reproduced. Both slots are open (03:00 and 04:00, it is
    // 15:00) and neither has run. plan-drift authors the block and
    // run-adaptations re-anchors the LTHR it stamps, so running plan-drift here
    // is what freezes fourteen weeks of HR ceilings on a stale anchor.
    const last = new Map<string, LastSuccess>([
      ['run-adaptations', ran('2026-08-29T09:00:00Z')],
      ['snapshot-projections', ran('2026-08-30T13:11:00Z')],
    ]);
    expect(blockedBy(now, drift, last, new Set())).toEqual(['run-adaptations']);
  });

  it('releases it once the predecessor has run in THIS pass', () => {
    const last = new Map<string, LastSuccess>([
      ['run-adaptations', ran('2026-08-29T09:00:00Z')],
      ['snapshot-projections', ran('2026-08-30T13:11:00Z')],
    ]);
    expect(blockedBy(now, drift, last, new Set(['run-adaptations']))).toEqual([]);
  });

  it('releases it once the predecessor has run on its own', () => {
    const last = new Map<string, LastSuccess>([
      ['run-adaptations', ran('2026-08-30T09:01:00Z')],
      ['snapshot-projections', ran('2026-08-30T13:11:00Z')],
    ]);
    expect(blockedBy(now, drift, last, new Set())).toEqual([]);
  });

  it('reports EVERY unmet predecessor, not just the first', () => {
    const last = new Map<string, LastSuccess>([
      ['run-adaptations', never],
      ['snapshot-projections', never],
      ['readiness-snapshot', never],
    ]);
    expect(blockedBy(now, drift, last, new Set()).sort())
      .toEqual(['run-adaptations', 'snapshot-projections']);
  });

  it('the dependency graph is acyclic and every edge names a real job', () => {
    // A cycle would deadlock both jobs forever, each waiting on the other, and
    // the tick would report `waiting_on_predecessor` every five minutes while
    // nothing ran. Cheaper to forbid than to debug.
    const index = new Map(CRON_JOBS.map((j, i) => [j.id, i]));
    for (const job of CRON_JOBS) {
      for (const dep of job.requires) {
        expect(index.has(dep), `${job.id} requires unknown job ${dep}`).toBe(true);
        // Declared order IS the topological order, so every edge must point
        // backwards. That is also what makes a single top-to-bottom pass able
        // to satisfy a whole chain.
        expect(index.get(dep)!, `${job.id} requires ${dep}, which is declared after it`)
          .toBeLessThan(index.get(job.id)!);
      }
    }
  });
});

describe('staleness · "is that too long ago"', () => {
  const job = cronJob('run-adaptations')!;

  it('is ok inside the budget, even when the job ran very late', () => {
    expect(staleness(utc('2026-08-30T20:00:00Z'), job, ran('2026-08-30T15:08:00Z')))
      .toMatchObject({ state: 'ok' });
  });

  it('goes STALE past it', () => {
    // 30h budget. Last success two days ago.
    const s = staleness(utc('2026-08-30T20:00:00Z'), job, ran('2026-08-28T15:08:00Z'));
    expect(s.state).toBe('stale');
    expect((s as { ageHours: number }).ageHours).toBeGreaterThan(30);
  });

  it('keeps never-run and read-failed apart from stale', () => {
    // Three facts, three answers. Collapsing them is how "the cron has never
    // been wired" and "the database blipped" become the same alert, and the
    // second one wakes somebody for nothing.
    expect(staleness(utc('2026-08-30T20:00:00Z'), job, never)).toEqual({ state: 'never_run' });
    expect(staleness(utc('2026-08-30T20:00:00Z'), job, readFailed)).toEqual({ state: 'unknown' });
  });

  it('every job\'s budget leaves room for at least one missed slot', () => {
    // A budget tighter than the gap between slots would alert on a job that is
    // merely between runs.
    for (const j of CRON_JOBS) {
      expect(j.staleAfterHours, `${j.id} budget too tight to be meaningful`)
        .toBeGreaterThanOrEqual(20);
      expect(j.staleAfterHours, `${j.id} budget so loose a whole day could vanish unnoticed`)
        .toBeLessThanOrEqual(48);
    }
  });
});

describe('the registry cannot silently rot', () => {
  /** Every cron route on disk. Derived, never listed. */
  const routesOnDisk = fs.readdirSync(CRON_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(CRON_DIR, name, 'route.ts')));

  it('LIVENESS · the scan found routes at all', () => {
    // Rule 18 §2. A scanner that reports clean because it looked at nothing is
    // the worst outcome available, because it also reports confidence. The
    // `._*` AppleDouble siblings on this volume are exactly the kind of thing
    // that turns a directory listing into a lie, hence the dot filter above and
    // this floor beneath it.
    expect(routesOnDisk.length).toBeGreaterThanOrEqual(10);
  });

  it('every cron route is either DRIVEN or EXPLICITLY EXCLUDED, with a reason', () => {
    // The hole this closes is the one named in cron-ledger.ts's own header: a
    // new cron route that nobody adds to CRON_JOBS is unscheduled and unwatched
    // while the tick cheerfully reports the other nine green. Every hardcoded
    // list in this repo has eventually rotted; this one is checked against disk.
    const excluded = new Set(EXCLUDED_FROM_TICK.map((e) => e.id));
    // `tick` itself is the only name exempt from this rule, and the reason is
    // structural rather than a judgement call: it is the SCHEDULER, not a
    // scheduled job. Listing it in CRON_JOBS would have it drive itself, and
    // listing it in EXCLUDED_FROM_TICK would read as "a job we chose not to
    // run". It is still accounted for elsewhere — GUARD 3 of
    // `lib/audit/_automatic_mutations.test.ts` pairs `.github/workflows/tick.yml`
    // with the `cron/tick` entry in the automatic-mutation registry, so the one
    // route this test waives is covered by the gate next door.
    const unaccounted = routesOnDisk.filter(
      (name) => name !== 'tick' && !CRON_JOBS.some((j) => j.id === name) && !excluded.has(name),
    );
    expect(unaccounted, 'add these to CRON_JOBS or to EXCLUDED_FROM_TICK with a reason').toEqual([]);
  });

  it('every exclusion carries an argued reason, not a placeholder', () => {
    for (const e of EXCLUDED_FROM_TICK) {
      expect(e.why.length, `${e.id} exclusion needs a real reason`).toBeGreaterThan(60);
    }
  });

  it('every driven job points at a route that exists', () => {
    for (const j of CRON_JOBS) {
      expect(j.path).toBe(`/api/cron/${j.id}`);
      expect(
        fs.existsSync(path.join(CRON_DIR, j.id, 'route.ts')),
        `${j.id} is in CRON_JOBS but app/api/cron/${j.id}/route.ts does not exist`,
      ).toBe(true);
    }
  });

  it('every driven job STAMPS THE LEDGER FROM ITS OWN ROUTE', () => {
    // The single most important assertion here. If a route does not stamp, the
    // ledger never records a success, the job reads as due on every tick
    // forever, and the scheduler turns from a catch-up mechanism into a loop
    // that re-runs it every five minutes. It also breaks the dedupe that lets
    // the old GitHub workflows keep running beside the new tick.
    //
    // Falsified by deleting the `recordCronSuccess('dedupe-runs', …)` call from
    // dedupe-runs/route.ts: this test names that job and fails. Restored.
    for (const j of CRON_JOBS) {
      const src = fs.readFileSync(path.join(CRON_DIR, j.id, 'route.ts'), 'utf8');
      expect(
        src.includes(`recordCronSuccess('${j.id}'`),
        `app/api/cron/${j.id}/route.ts never calls recordCronSuccess('${j.id}') — `
        + 'it would read as due on every tick forever',
      ).toBe(true);
    }
  });

  it('every driven job cites its idempotence, and cites the audit that establishes it', () => {
    // The brief's instruction was to verify idempotence PER JOB rather than
    // assume it. `lib/audit/automatic-mutation-registry.ts` is where that was
    // already audited, writer by writer, so every entry has to point at it
    // rather than at somebody's confidence.
    for (const j of CRON_JOBS) {
      expect(j.idempotenceEvidence.length, `${j.id} needs real evidence`).toBeGreaterThan(80);
      expect(
        j.idempotenceEvidence.includes('automatic-mutation-registry'),
        `${j.id} must cite lib/audit/automatic-mutation-registry.ts`,
      ).toBe(true);
    }
  });

  it('every job\'s tick timeout leaves room for its route\'s own maxDuration', () => {
    // FOUND BY REVIEW, not by a failing test, and worth a permanent one: the
    // first draft of the tick shared a single 100s budget across the pass,
    // which would have aborted strava-sync (maxDuration 300) on every pass
    // forever while looking like a network problem. A scheduler that can never
    // let a job finish has switched it off.
    for (const j of CRON_JOBS) {
      const src = fs.readFileSync(path.join(CRON_DIR, j.id, 'route.ts'), 'utf8');
      const m = src.match(/^export const maxDuration = (\d+);/m);
      if (!m) continue;
      const routeMs = Number(m[1]) * 1000;
      // Read the number out of the route at run time rather than restating it
      // here — a check that hardcodes both sides only proves it agrees with
      // itself (Rule 18).
      expect(
        j.timeoutMs,
        `${j.id}: tick timeout ${j.timeoutMs}ms is under its route's maxDuration ${routeMs}ms`,
      ).toBeGreaterThanOrEqual(routeMs);
    }
  });

  it('ids are unique and the ledger source is derived from them', () => {
    expect(new Set(CRON_JOBS.map((j) => j.id)).size).toBe(CRON_JOBS.length);
    expect(ledgerSource('plan-drift')).toBe('cron/plan-drift');
  });
});

describe('the slots match the workflows they were taken from', () => {
  const WORKFLOW_DIR = path.resolve(__dirname, '../../../.github/workflows');

  it('LIVENESS · the workflow directory was read', () => {
    const files = fs.readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml') && !f.startsWith('.'));
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('each job\'s slots are the hours its own workflow already used', () => {
    // This is the anti-re-timing check. The tick is a catch-up mechanism, and a
    // registry that quietly moved run-adaptations off 03:00 UTC would be a
    // PRODUCT change — the owner asked for evening adaptations by name ("I dont
    // want to wake up to change runs"). Read the hours out of the workflow at
    // run time rather than hardcoding both sides, per Rule 18.
    for (const j of CRON_JOBS) {
      const wf = path.join(WORKFLOW_DIR, `${j.id}.yml`);
      if (!fs.existsSync(wf)) continue;
      const hours = [...fs.readFileSync(wf, 'utf8').matchAll(/^\s*-\s*cron:\s*'([^']+)'/gm)]
        .map((m) => m[1].split(/\s+/)[1])
        // Only plain daily hours; band expressions (`14-23`) belong to the
        // high-frequency jobs, none of which this tick drives.
        .filter((h) => /^\d+$/.test(h))
        .map(Number);
      if (hours.length === 0) continue;
      expect(
        [...j.slotsUtcHour].sort((a, b) => a - b),
        `${j.id} slots disagree with .github/workflows/${j.id}.yml`,
      ).toEqual([...new Set(hours)].sort((a, b) => a - b));
    }
  });
});
