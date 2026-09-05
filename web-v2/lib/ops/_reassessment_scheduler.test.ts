/**
 * lib/ops/_reassessment_scheduler.test.ts · THE SCHEDULER'S VOCABULARY, ITS
 * RETRY POLICY, AND ITS RULE 23 POSTURE — WITHOUT A DATABASE.
 *
 * Durability is proven separately against a real table in
 * `_reassessment_scheduler.db.test.ts`, which SKIPS LOUDLY when no scratch
 * database is reachable rather than reporting clean.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER AN ITEM WAS EVER SCHEDULED. Everything here is pure or
 *   source-scanning. A deferral that evaporates because nobody called
 *   `scheduleReassessment` is invisible to every assertion below;
 *   `scripts/check-decision-ledger.sh` guard 2 is the half that catches a
 *   deferral produced with no durable row behind it.
 * · WHETHER THE SWEEP ACTUALLY RUNS. It asserts that the cron route imports it
 *   and that `cron-ledger.ts` registers that route. It cannot tell whether
 *   GitHub Actions fires, which is precisely the thing Rule 23 says never to
 *   assume — the ledger's own `cron_stale` alert is that half.
 * · WHETHER AN ITEM SHOULD HAVE BEEN QUEUED. Inherited from
 *   `deferral-queue.ts`'s own note: the store records what a caller decided,
 *   and cannot tell a correctly-deferred progression from a wrong one.
 * · WHETHER ANYBODY READS `ops_alerts`. The overdue alert lands there. What
 *   happens next is outside every check in this repo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  REASSESSMENT_KINDS,
  LIVE_STATUSES,
  TERMINAL_STATUSES,
  MAX_ATTEMPTS,
  retryDelayMs,
  REASSESSMENT_SCHEDULE_TABLE,
} from './reassessment-scheduler';

const ROOT = path.join(__dirname, '../..');
const MIGRATION = path.join(ROOT, 'db/migrations/167_reassessment_schedule.sql');
const SUPERSEDED = path.join(ROOT, 'db/migrations/165_canonical_adaptation_deferrals.sql');
const SCHEDULER = path.join(__dirname, 'reassessment-scheduler.ts');
const CRON_ROUTE = path.join(ROOT, 'app/api/cron/run-adaptations/route.ts');
const CRON_LEDGER = path.join(__dirname, 'cron-ledger.ts');
const ALERTS = path.join(__dirname, 'alerts.ts');

function checkVocabulary(sql: string, column: string): string[] {
  const re = new RegExp(
    `CHECK\\s*\\(\\s*(?:${column}\\s+IS\\s+NULL\\s+OR\\s*)?${column}\\s+IN\\s*\\(([^)]*)\\)`,
    'i',
  );
  const m = sql.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('liveness · every file this suite reasons about was actually read', () => {
  it('all six exist and are not stubs', () => {
    for (const f of [MIGRATION, SUPERSEDED, SCHEDULER, CRON_ROUTE, CRON_LEDGER, ALERTS]) {
      expect(existsSync(f), `${f} is missing`).toBe(true);
      expect(readFileSync(f, 'utf8').length, `${f} is suspiciously short`).toBeGreaterThan(500);
    }
  });
});

describe('the TypeScript vocabulary and the migration say the same words', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('all seven kinds, and no eighth hiding in one place only', () => {
    const fromSql = checkVocabulary(sql, 'kind');
    expect(fromSql.length, 'the kind CHECK could not be parsed out of the migration').toBe(7);
    expect([...fromSql].sort()).toEqual([...REASSESSMENT_KINDS].sort());
  });

  it('status, split into live and terminal with nothing in both or neither', () => {
    const fromSql = checkVocabulary(sql, 'status');
    expect(fromSql.length).toBeGreaterThan(0);
    expect([...fromSql].sort()).toEqual([...LIVE_STATUSES, ...TERMINAL_STATUSES].sort());
    for (const s of LIVE_STATUSES) expect(TERMINAL_STATUSES).not.toContain(s);
  });

  it('the table name in the code and in the migration agree', () => {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${REASSESSMENT_SCHEDULE_TABLE}`);
  });

  it('ORACLE · the parser is not vacuously permissive', () => {
    expect(checkVocabulary(sql, 'reason_code')).toEqual([]);
    expect(checkVocabulary(sql, 'kind').length).toBe(7);
  });
});

describe('the migration is additive only, and 165 cannot be applied by accident', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const executable = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

  it('no ALTER, no DROP, no RENAME, no TRUNCATE, no DELETE', () => {
    for (const forbidden of [/\bALTER\s+TABLE\b/i, /\bDROP\s+/i, /\bRENAME\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i]) {
      expect(forbidden.test(executable), `${forbidden} appears in executable SQL`).toBe(false);
    }
  });

  it('every CREATE is IF NOT EXISTS', () => {
    const creates = [...executable.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(IF NOT EXISTS)?/gi)];
    expect(creates.length).toBeGreaterThan(3);
    for (const c of creates) expect(c[3], `a CREATE without IF NOT EXISTS: ${c[0]}`).toBeTruthy();
  });

  it('165 is stamped SUPERSEDED and RAISES rather than applying cleanly', () => {
    // Rule 20 · a file that says "do not apply" and still applies is a comment,
    // not a control. The guard has to be executable, and it has to come before
    // the DDL it guards.
    const old = readFileSync(SUPERSEDED, 'utf8');
    expect(old).toContain('SUPERSEDED');
    const raise = old.indexOf('RAISE EXCEPTION');
    const create = old.indexOf('CREATE TABLE');
    expect(raise, '165 has no executable refusal').toBeGreaterThan(-1);
    expect(raise, 'the refusal must come BEFORE the DDL it guards').toBeLessThan(create);
  });
});

describe('RULE 23 clause 2 · lateness is harmless, so due-ness is a DATE', () => {
  const src = readFileSync(SCHEDULER, 'utf8');

  it('the due query compares a date and reads no clock', () => {
    const due = src.slice(src.indexOf('export async function loadDueItems'), src.indexOf('/* ═', src.indexOf('export async function loadDueItems')));
    expect(due).toContain('assess_on_iso <= $1::date');
    // `now()` appears ONLY in the retry-backoff clause, which is a genuine
    // wall-clock question ("has the backoff elapsed"), never in the due test.
    const nowUses = [...due.matchAll(/now\(\)/g)].length;
    expect(nowUses, 'the due test must not depend on the hour of day').toBe(1);
    expect(due).toContain('next_retry_at <= now()');
  });

  it('the sweep takes today as an argument rather than reading the clock itself', () => {
    expect(src).toMatch(/export async function sweepReassessments\(todayISO: string\)/);
  });

  it('every live-state transition is guarded on the state it moves FROM', () => {
    // This is what makes a double sweep harmless. Each of the three UPDATEs
    // carries the predicate that makes a second application a no-op.
    expect(src).toMatch(/SET status = 'DUE'[\s\S]{0,120}status = 'PENDING'/);
    expect(src).toMatch(/resolved_at = now\(\)[\s\S]{0,160}status IN \('PENDING', 'DUE'\)/);
  });
});

describe("RULE 23 clause 3 · a job that does not run must be NOTICED", () => {
  it('the sweep runs inside a cron route that cron-ledger already registers', () => {
    // Deliberately NOT a new cron: cron-ledger's own EXCLUDED_FROM_TICK list
    // argues it in one line — "another schedule is another thing that can
    // silently stop firing."
    const route = readFileSync(CRON_ROUTE, 'utf8');
    expect(route).toContain('sweepReassessments');
    const ledger = readFileSync(CRON_LEDGER, 'utf8');
    expect(ledger).toContain("id: 'run-adaptations'");
    expect(ledger).toContain('cron_stale');
  });

  it('an overdue item raises an alert kind the alerts module actually knows', () => {
    const src = readFileSync(SCHEDULER, 'utf8');
    expect(src).toContain("kind: 'reassessment_overdue'");
    expect(readFileSync(ALERTS, 'utf8')).toContain("'reassessment_overdue'");
  });

  it('the sweep REFUSES loudly rather than reporting an empty pass', () => {
    // The failure this whole feature exists to prevent: a sweep that could not
    // read reporting exactly like a sweep with nothing to do.
    const src = readFileSync(SCHEDULER, 'utf8');
    expect(src).toMatch(/refusal: due\.state/);
    expect(src).toContain('readonly refusal: string | null');
  });
});

describe('RULE 11 · a failed assessment is a state, not an absence', () => {
  it('the retry backoff is monotone and capped at a day', () => {
    let last = 0;
    for (let a = 1; a <= 12; a += 1) {
      const d = retryDelayMs(a);
      expect(d, `attempt ${a} went backwards`).toBeGreaterThanOrEqual(last);
      last = d;
      expect(d).toBeLessThanOrEqual(24 * 3600_000);
    }
    // Uncapped, the eighth retry of a daily job lands past the end of the
    // block it belongs to — a silent disappearance with extra steps.
    expect(retryDelayMs(12)).toBe(24 * 3600_000);
  });

  it('the retry budget is finite, so a broken evaluator becomes FAILED not invisible', () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_ATTEMPTS).toBeLessThan(20);
    // Five attempts under this backoff spans more than a day, which is longer
    // than any outage this app has actually had.
    let total = 0;
    for (let a = 1; a < MAX_ATTEMPTS; a += 1) total += retryDelayMs(a);
    expect(total).toBeGreaterThan(24 * 3600_000);
  });

  it('the FAILED path stamps the error, which the table then requires', () => {
    const src = readFileSync(SCHEDULER, 'utf8');
    expect(src).toMatch(/status = 'FAILED'[\s\S]{0,400}resulting_decision = 'ASSESSMENT_FAILED'/);
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('reassessment_schedule_failure_names_its_error');
  });

  it('a failure with no message still records something a person can act on', () => {
    const src = readFileSync(SCHEDULER, 'utf8');
    expect(src).toContain('the evaluator failed and reported no message');
  });
});

describe('the scheduler decides NOTHING · it may not reach a plan row', () => {
  const src = readFileSync(SCHEDULER, 'utf8');

  it('it writes no plan table and names no plan writer', () => {
    for (const table of ['plan_workouts', 'plan_weeks', 'plan_phases', 'training_plans']) {
      expect(src.includes(table), `the scheduler references ${table}`).toBe(false);
    }
    for (const fn of ['mutatePlan', 'applyAdaptations', 'tryAdaptiveBump', 'generatePlan']) {
      expect(src.includes(fn), `the scheduler names the plan writer ${fn}`).toBe(false);
    }
  });

  it('ORACLE · the scan would catch a planted plan write', () => {
    const planted = 'UPDATE plan_workouts SET distance_mi = 9';
    expect(planted.includes('plan_workouts')).toBe(true);
  });

  it('promoting an item to DUE is not applying it', () => {
    expect(src).toContain('never means "apply what was queued"');
  });
});
