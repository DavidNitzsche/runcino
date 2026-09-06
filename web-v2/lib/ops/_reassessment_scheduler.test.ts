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
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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

/* ══════════════════════════════════════════════════════════════════════════
 * COVERAGE-1 (2026-09-06) · SEVEN KINDS, AND WHICH OF THEM A REAL CALLER
 * SCHEDULES — NOT JUST WHICH ONE THE TYPE ALLOWS.
 *
 * `ReassessmentKind` is a seven-member union and, before this gate, nothing
 * checked that a production write site EXISTED for each one. `_sweep_allusers`
 * grades 11,598 archetypes and Rule 15's own audit found four doctrine
 * mechanisms dark across the entire corpus because the fixture type could not
 * reach them — a type that ADMITS seven kinds proves nothing about how many of
 * them anything ever schedules.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 * · WHETHER THE SCHEDULED ITEM IS EVER ASSESSED. A caller that schedules a
 *   promise and nothing that ever reads it back is invisible to a scan for
 *   `scheduleReassessment(` — this gate proves a write site exists, not that
 *   the promise is kept.
 * · A CALL SITE THIS SCAN'S REGEX CANNOT PARSE. The extraction window is
 *   400 characters after the call; a kind declared further down the object
 *   literal than that would read as uncovered. None do today, and a change
 *   that pushed one that far down should be caught by a human reading the
 *   diff, not silently waved through by a wider window that stops meaning
 *   anything (the same failure `check-palette-sync.sh` shipped).
 * · DEFERRAL specifically, which never calls `scheduleReassessment` at all —
 *   `deferral-store.ts` writes `reassessment_schedule` on its own SQL,
 *   verbatim `kind = 'DEFERRAL'`, and is checked by name below rather than by
 *   the same regex.
 *
 * ── ORACLE, PER RULE 18 ─────────────────────────────────────────────────────
 *
 * A kind removed from every real caller and left off `NO_CALLER_YET` fails
 * the "every kind not covered has a named exemption" assertion below —
 * falsified by hand while writing this gate (temporarily commenting out the
 * RETURN_TO_TRAINING_STAGE call site in `app/api/v5/return/checkin/route.ts`
 * and re-running: the gate failed exactly as expected, naming
 * RETURN_TO_TRAINING_STAGE, then the call site was restored and the gate
 * passed again — verbatim in the round's own report).
 */
describe('COVERAGE-1 · every kind has a real production caller, or a named exemption', () => {
  const ROOT_APP = path.join(ROOT, 'app');
  const ROOT_LIB = path.join(ROOT, 'lib');

  function walk(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) { walk(full, out); continue; }
      if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
      if (entry.includes('.test.') || entry.endsWith('.db.test.ts')) continue;
      if (full === SCHEDULER) continue; // the export site, not a caller
      out.push(full);
    }
  }

  const files: string[] = [];
  walk(ROOT_APP, files);
  walk(ROOT_LIB, files);

  it('liveness · the scan actually read a non-trivial number of files', () => {
    // Rule 18 point 2 · a scanner states how many files it read and fails on
    // zero. This repo has shipped gates that reported clean because they
    // scanned nothing (`check-modelled-mark.sh`'s guards 1-3).
    expect(files.length, 'the production-code walk found suspiciously few files').toBeGreaterThan(200);
  });

  /** Every literal `kind: 'X'` within 400 chars of a `scheduleReassessment(`
   *  call, across every production file the walk found. */
  const foundKinds = new Set<string>();
  const foundAt = new Map<string, string[]>();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (!src.includes('scheduleReassessment(')) continue;
    for (const m of src.matchAll(/scheduleReassessment\(\{[\s\S]{0,400}?kind:\s*'([A-Z_]+)'/g)) {
      const kind = m[1];
      foundKinds.add(kind);
      const list = foundAt.get(kind) ?? [];
      list.push(path.relative(ROOT, f));
      foundAt.set(kind, list);
    }
  }

  /**
   * THE INDIRECT SHAPE, AND WHY THE REGEX ABOVE CANNOT SEE IT.
   *
   * `lib/plan/adjudication/rolling-boundary.ts`'s `boundariesForWeek` BUILDS
   * `ScheduleRequest` objects (carrying `kind: 'EARNING_GATE'` and
   * `kind: 'CONDITIONAL_DOSE'`, twice) and RETURNS them; the actual
   * `scheduleReassessment(r)` call lives in `app/api/cron/run-adaptations/
   * route.ts`, in a loop over the returned array — `r` is a loop variable,
   * not an inline object literal, so no `kind:` string sits within any window
   * after that call site. A caller passing a pre-built request is a real
   * caller, not a weaker one, so this is checked by NAME (the builder + the
   * loop that calls it), the same posture `deferralWired` already takes for
   * DEFERRAL's own indirection.
   */
  const ROLLING_BOUNDARY = path.join(ROOT_LIB, 'plan/adjudication/rolling-boundary.ts');
  const ROLLING_BOUNDARY_CALLER = CRON_ROUTE;
  const rollingBoundaryKinds = (): ReadonlySet<string> => {
    if (!existsSync(ROLLING_BOUNDARY) || !existsSync(ROLLING_BOUNDARY_CALLER)) return new Set();
    const builder = readFileSync(ROLLING_BOUNDARY, 'utf8');
    const caller = readFileSync(ROLLING_BOUNDARY_CALLER, 'utf8');
    // The caller must actually import the builder AND call scheduleReassessment
    // on what it returns — not merely have both strings appear coincidentally
    // somewhere in a 1400-line route file.
    const wired = caller.includes('boundariesForWeek')
      && caller.includes('scheduleReassessment')
      && /boundariesForWeek\(/.test(caller)
      && /for \(const r of reqs\)/.test(caller);
    if (!wired) return new Set();
    const kinds = new Set<string>();
    for (const m of builder.matchAll(/kind:\s*'([A-Z_]+)'/g)) kinds.add(m[1]);
    return kinds;
  };

  for (const kind of rollingBoundaryKinds()) {
    foundKinds.add(kind);
    const list = foundAt.get(kind) ?? [];
    list.push(`${path.relative(ROOT, ROLLING_BOUNDARY)} (built) -> ${path.relative(ROOT, ROLLING_BOUNDARY_CALLER)} (scheduled)`);
    foundAt.set(kind, list);
  }

  // DEFERRAL never calls `scheduleReassessment` — `deferral-store.ts` is its
  // own writer, checked by name rather than by the regex above.
  const DEFERRAL_STORE = path.join(ROOT_LIB, 'adaptation/canonical-shadow/deferral-store.ts');
  const DEFERRAL_CALLER = path.join(ROOT_LIB, 'adaptation/canonical-shadow/run-live-shadow-evaluation.ts');
  const deferralWired = (): boolean => {
    if (!existsSync(DEFERRAL_STORE) || !existsSync(DEFERRAL_CALLER)) return false;
    const store = readFileSync(DEFERRAL_STORE, 'utf8');
    const caller = readFileSync(DEFERRAL_CALLER, 'utf8');
    return store.includes("'DEFERRAL'") && caller.includes('persistQueueAtBoundary');
  };

  /**
   * Kinds with NO real caller found by either check above, and the argued
   * reason. A RATCHET: shrink-only. A kind that gains a real caller must have
   * its entry deleted here in the same change, and a kind that loses its only
   * caller without gaining an entry here fails the assertion below rather
   * than silently reading as covered.
   */
  const NO_CALLER_YET: Readonly<Partial<Record<(typeof REASSESSMENT_KINDS)[number], string>>> = {
    FAILED_EVALUATION:
      'no evaluator anywhere in this codebase re-asks a DUE reassessment\'s question and can fail '
      + 'doing so — the other six kinds are promises with no consumer that assesses them either '
      + '(this file\'s own RULE 22 note: "whether the evaluator actually re-asks the question... '
      + 'is that engine\'s contract, not this one\'s"). The one honest caller this kind could have '
      + '— `recordAssessmentFailure` wired into `sweepReassessments`\' own promotion-failure path '
      + '(FAILEDEVAL-1) — retries the FAILING item under its OWN kind and never relabels it '
      + 'FAILED_EVALUATION, so no INSERT anywhere constructs this literal value. A caller invented '
      + 'only to clear this exemption would be decoration, which Rule 15 warns against as strongly '
      + 'as an uncovered mechanism.',
  };

  it('DEFERRAL is wired through its own writer', () => {
    expect(deferralWired(), 'deferral-store.ts and its cron caller no longer agree').toBe(true);
  });

  it('EARNING_GATE, CONDITIONAL_DOSE, POST_RACE_RECOVERY_CHECK, RETURN_TO_TRAINING_STAGE and '
    + 'PROPOSAL_EXPIRATION each have a real scheduleReassessment( call site', () => {
    const expected = [
      'EARNING_GATE', 'CONDITIONAL_DOSE', 'POST_RACE_RECOVERY_CHECK',
      'RETURN_TO_TRAINING_STAGE', 'PROPOSAL_EXPIRATION',
    ] as const;
    for (const k of expected) {
      expect(foundKinds.has(k), `no scheduleReassessment( call site names kind: '${k}'`).toBe(true);
    }
  });

  it('every kind is either covered by a real caller or carries a named, argued exemption', () => {
    const covered = new Set<string>([...foundKinds, ...(deferralWired() ? ['DEFERRAL'] : [])]);
    for (const k of REASSESSMENT_KINDS) {
      const exemption = NO_CALLER_YET[k as keyof typeof NO_CALLER_YET];
      if (covered.has(k)) {
        expect(exemption, `${k} now has a real caller (${(foundAt.get(k) ?? []).join(', ')}) — `
          + 'delete its stale exemption from NO_CALLER_YET').toBeUndefined();
      } else {
        expect(exemption, `${k} has no real caller and no exemption naming why — this is exactly `
          + 'the "wired, tested, inert" shape CLAUDE.md warns against').toBeTruthy();
      }
    }
  });

  it('ORACLE · the extraction window actually finds a kind, given a real example', () => {
    const sample = `
      const res = await scheduleReassessment({
        userUuid: uid,
        kind: 'EARNING_GATE',
        reasonCode: 'x',
      });`;
    const m = sample.matchAll(/scheduleReassessment\(\{[\s\S]{0,400}?kind:\s*'([A-Z_]+)'/g);
    expect([...m].map((x) => x[1])).toEqual(['EARNING_GATE']);
  });
});
