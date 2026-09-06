/**
 * lib/audit/_decision_ledger_gate.test.ts · LEDGER-1 · NO DECISION BYPASSES THE
 * LEDGER, NO MUTATION COMMITS OUTSIDE ITS RECORD, AND NO DEFERRAL LIVES ONLY IN
 * MEMORY.
 *
 * The scanning half of `scripts/check-decision-ledger.sh`. Three guards, and
 * each one exists because the corresponding failure has already happened in
 * this codebase — two of them in a neighbouring shape and the third in this
 * exact one:
 *
 *   GUARD 1 · EVERY EXIT OF `mutatePlan` LANDS A LEDGER ROW.
 *
 *     `plan_mutation_rejections` (migration 150) records what the boundary
 *     REFUSED and has never recorded what it PERMITTED. So the audit surface in
 *     front of the only door into `plan_workouts` could answer "what did we
 *     stop" and not "what did we do" — which is CLAUDE.md Rule 21's question,
 *     and the reason its census had to be reconstructed sideways out of
 *     `coach_intents`. A behavioural test cannot close this: it can only prove
 *     the exits it happens to drive, and the exit that matters is the one
 *     nobody thought to drive. So this is a source scan over the function's own
 *     returns and throws.
 *
 *   GUARD 3 · A PLAN MUTATION AND ITS LEDGER RECORD ARE ONE ATOMIC OUTCOME.
 *
 *     LEDGERATOMIC-1. This file's OWN previous assertion enforced the defect:
 *     it demanded that the ledger store never write on a caller's transaction,
 *     which is right for a refusal and backwards for a commit. The boundary
 *     therefore ran COMMIT, then wrote the row on a second connection, then
 *     logged the failure and returned success. The full statement of what that
 *     is not allowed to be is on GUARD 3's own block below.
 *
 *   GUARD 2 · A DEFERRED ACTION HAS A DURABLE SCHEDULER ROW.
 *
 *     Before the queue existed, arbitration produced a `SuppressionNote`
 *     carrying a `reconsiderAtISO` and the whole proposal was gone — "the date
 *     was a PROMISE nothing kept", in `deferral-queue.ts`'s own words. A module
 *     that turns a decision into a queued item and does not persist it has
 *     rebuilt exactly that, and it would look identical from the outside: a
 *     queue that works perfectly until the process ends.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * · A LEDGER CALL THAT RUNS AND WRITES NOTHING. It scans SOURCE. A `land(...)`
 *   whose write silently fails is invisible here; `decision-ledger.ts` logs
 *   that at `console.error` and `_decision_ledger.db.test.ts` proves the write
 *   works against a real table. Neither is this file's job.
 * · A DECISION MADE SOMEWHERE OTHER THAN `mutatePlan`. Guard 1 is scoped to the
 *   one door. `_mutation_boundary.test.ts` is what keeps raw `plan_workouts`
 *   writes from appearing outside that door in the first place, and this guard
 *   inherits its scope entirely — if that scan ever narrows, this one narrows
 *   with it and nothing here would say so.
 * · WHETHER THE LEDGER ROW IS TRUE. It cannot tell a correct explanation from a
 *   plausible one.
 * · WHETHER MIGRATION 166 OR 167 IS APPLIED ANYWHERE. Neither is on production,
 *   deliberately. Rule 19: green is not deployed.
 * · A SECOND QUEUE ADDED SOMEWHERE ELSE. Guard 2 checks that the deferral
 *   producers persist; it cannot notice a brand-new in-memory queue in a module
 *   it does not know to look at.
 * · WHETHER A ROLLBACK ACTUALLY DISCARDS THE PLAN WRITES when the ledger
 *   refuses. Guard 3 proves the call site is on the right side of the COMMIT;
 *   `lib/plan/_ledger_atomicity.db.test.ts` measures the outcome against a real
 *   table, and skips loudly with no scratch database.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '../..');
const MUTATE = path.join(ROOT, 'lib/plan/mutate.ts');
const SHADOW_RUN = path.join(ROOT, 'lib/adaptation/canonical-shadow/run-live-shadow-evaluation.ts');

/** The function body, from its signature to the last line of the function. */
function mutatePlanBody(src: string): string {
  const start = src.indexOf('export async function mutatePlan<T>');
  expect(start, 'mutatePlan has been renamed or removed — the gate is watching nothing').toBeGreaterThan(-1);
  const end = src.indexOf('\n// ── the record ──', start);
  expect(end, "mutatePlan's end marker has moved — re-point the gate rather than widening it")
    .toBeGreaterThan(start);
  return src.slice(start, end);
}

/**
 * Every line on which `mutatePlan` HANDS CONTROL BACK — a returned result or a
 * thrown error. Deliberately NOT every `return` in the file: the nested
 * closures (`fail`, `land`, `stampAdapted`) return values that the caller then
 * returns, and treating those as exits would demand a ledger write per helper.
 * They are excluded by shape (an arrow body, or a `return` whose expression is
 * not a result), and the count floor below is what catches an exclusion that
 * has quietly grown to cover a real exit.
 */
function exitsOf(body: string): Array<{ line: number; text: string }> {
  const lines = body.split('\n');
  const out: Array<{ line: number; text: string }> = [];
  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (t.startsWith('*') || t.startsWith('//')) return;
    const isResultReturn = /^return \{ ok: (true|false)/.test(t) || /^return fail\(/.test(t);
    const isThrow = /^throw new Error\(/.test(t) || /^throw e;$/.test(t);
    if (isResultReturn || isThrow) out.push({ line: i, text: t });
  });
  return out;
}

/** How far back an exit may reach for its ledger write. */
const LOOKBACK_LINES = 30;

describe('liveness · the gate read the files it reasons about', () => {
  it('both source files exist and are substantial', () => {
    for (const f of [MUTATE, SHADOW_RUN]) {
      expect(existsSync(f), `${f} is missing`).toBe(true);
      expect(readFileSync(f, 'utf8').length).toBeGreaterThan(2000);
    }
  });

  it('the exit extractor finds a plausible number of exits, and never zero', () => {
    // Rule 18 · a scanner that reports clean because it looked at nothing is
    // the worst outcome available, since it also reports confidence.
    const exits = exitsOf(mutatePlanBody(readFileSync(MUTATE, 'utf8')));
    expect(exits.length, 'the exit extractor found nothing — mutatePlan has been restructured')
      .toBeGreaterThanOrEqual(8);
  });
});

describe('GUARD 1 · every exit of the mutation boundary lands a ledger row', () => {
  const body = mutatePlanBody(readFileSync(MUTATE, 'utf8'));
  const lines = body.split('\n');
  const exits = exitsOf(body);

  it('no exit returns or throws without recording the decision first', () => {
    const naked: string[] = [];
    for (const exit of exits) {
      const from = Math.max(0, exit.line - LOOKBACK_LINES);
      const window = lines.slice(from, exit.line).join('\n');
      if (!/\b(await land\(|await landInTx\(|landDecisionInLedger\()/.test(window)) {
        naked.push(`line ${exit.line} of mutatePlan · ${exit.text}`);
      }
    }
    expect(
      naked,
      naked.length === 0 ? '' :
        '\nA DECISION BYPASSES THE LEDGER:\n  ' + naked.join('\n  ') + '\n\n'
        + 'Every exit of `mutatePlan` must record what it decided before handing control\n'
        + 'back — the successes as much as the refusals. `plan_mutation_rejections` already\n'
        + 'records what this boundary REFUSED; the ledger is what lets anyone answer\n'
        + 'CLAUDE.md Rule 21\'s question, which is what it DID and in which direction.\n\n'
        + 'Add `await land(<decision>, <outcome>, <violations>, <account>, <planId>)`\n'
        + 'before the exit. Do NOT widen LOOKBACK_LINES to make this pass.',
    ).toEqual([]);
  });

  it('the REFUSAL lane is on its own connection, so a rollback cannot erase it', () => {
    // A refusal written inside the mutation's transaction is rolled back with
    // it, so the ledger would record every decision EXCEPT the refusals — which
    // are the ones a reader most needs. That half of the original argument is
    // unchanged; GUARD 3 below carries the half it got wrong.
    const store = readFileSync(path.join(ROOT, 'lib/brain/ledger/decision-ledger.ts'), 'utf8');
    // NOTE the missing `\(`. Written with it, this assertion MISSED a planted
    // `client.query<{ id: string }>(...)` — a generic type argument sits
    // between the name and the paren, which is how this codebase writes a typed
    // query nearly everywhere. Rule 18 earned: the gate was falsified, did not
    // fail, and was fixed rather than trusted.
    expect(store).toMatch(/\bpool\.query\b/);
    // `recordDecision` — the refusal lane — must not take an executor. If it
    // ever does, a caller can hand it a transaction and the refusal becomes
    // erasable again, silently.
    expect(store).toMatch(/export async function recordDecision\(entry: LedgerEntry\)/);
  });

  it('the authority REFUSAL records before it throws, so the throw cannot skip it', () => {
    const refusal = body.indexOf('const hold = opts.hold;');
    const land = body.indexOf('await landDecisionInLedger({', refusal);
    const thrown = body.indexOf('throw new Error(', refusal);
    expect(land).toBeGreaterThan(refusal);
    expect(land, 'the refusal throws before it records').toBeLessThan(thrown);
  });

  it('direction is MEASURED here, never accepted from a caller', () => {
    // `adaptation-log.ts` names the hazard about its own log: "a caller that
    // could label its own change would eventually label a downgrade an
    // adjustment, and the log would stop being evidence."
    expect(body).not.toMatch(/opts\.ledger\?\.direction/);
    expect(body).not.toMatch(/opts\.ledger\?\.lever/);
    const src = readFileSync(MUTATE, 'utf8');
    expect(src).toContain('directionOfDelta(delta)');
    expect(src).toContain('leverOfDelta(delta)');
  });

  it('plan lineage is read BEFORE the rebuild archives the plan it replaces', () => {
    // After `clearActivePlansFor` runs, nothing distinguishes "the plan this one
    // replaced" from "some plan this runner archived last March".
    const read = body.indexOf('replacedPlanId = (await rowOrNull');
    const apply = body.indexOf('const value = await opts.apply(client');
    expect(read, 'the replaced-plan read has moved or been removed').toBeGreaterThan(-1);
    expect(read, 'lineage is resolved after the rebuild, which is too late').toBeLessThan(apply);
  });

  it('ORACLE · the scan WOULD flag an exit with no ledger write', () => {
    // Rule 18 · falsified in-process, both directions, so the guard above is a
    // guarantee rather than a hypothesis.
    const planted = [
      'export async function mutatePlan<T>(opts: X) {',
      '  if (bad) {',
      '    return fail("rejected", [], [], null);',
      '  }',
      '}',
      '',
      '// ── the record ──',
    ].join('\n');
    const plantedBody = mutatePlanBody(planted);
    const plantedExits = exitsOf(plantedBody);
    expect(plantedExits).toHaveLength(1);
    const pl = plantedBody.split('\n');
    const window = pl.slice(0, plantedExits[0].line).join('\n');
    expect(/\b(await land\(|await landInTx\(|landDecisionInLedger\()/.test(window)).toBe(false);
  });

  it('ORACLE · and it would NOT flag one that records', () => {
    const planted = [
      'export async function mutatePlan<T>(opts: X) {',
      '  if (bad) {',
      '    await land("REFUSE", "rejected", [], "because", null);',
      '    return fail("rejected", [], [], null);',
      '  }',
      '}',
      '',
      '// ── the record ──',
    ].join('\n');
    const plantedBody = mutatePlanBody(planted);
    const plantedExits = exitsOf(plantedBody);
    expect(plantedExits).toHaveLength(1);
    const pl = plantedBody.split('\n');
    const window = pl.slice(0, plantedExits[0].line).join('\n');
    expect(/\b(await land\(|await landInTx\(|landDecisionInLedger\()/.test(window)).toBe(true);
  });
});

/** Every line on which `mutatePlan` COMMITs. */
function commitsOf(body: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  body.split('\n').forEach((raw, i) => {
    const t = raw.trim();
    if (t.startsWith('*') || t.startsWith('//')) return;
    if (/client\.query\('COMMIT'\)/.test(t)) out.push({ line: i, text: t });
  });
  return out;
}

/**
 * LEDGERATOMIC-1 · GUARD 3.
 *
 * ── WHAT THIS GUARD REPLACED, AND WHY THAT IS THE POINT ───────────────────
 *
 * The assertion that used to sit here read `expect(store).not.toMatch(
 * /\bclient\.query\b/)` — the ledger store may NEVER write on a caller's
 * transaction — and it was enforcing the defect. Its reasoning holds for a
 * refusal and inverts for a commit: on a second connection, `COMMIT` then
 * `land(...)` then `console.error` then `return { ok: true }` is a plan that
 * moved with nothing recording that it had.
 *
 * The owner, verbatim: "A plan mutation and its ledger record must be one
 * atomic outcome. The system may not: (1) mutate the plan, (2) fail to write
 * the ledger, (3) log an error, (4) return success."
 *
 * A behavioural test cannot close this either, for the same reason GUARD 1 is
 * a source scan: it can only prove the commits it happens to drive, and the
 * commit that matters is the one nobody thought to drive. So this walks every
 * `COMMIT` in the function and demands an in-transaction write above it.
 *
 * ── RULE 22 · WHAT GUARD 3 CANNOT FAIL ON ─────────────────────────────────
 *
 * · WHETHER THE ROLLBACK ACTUALLY DISCARDS THE PLAN WRITES. It proves the call
 *   site is on the right side of the COMMIT. That the database then throws the
 *   work away is Postgres's guarantee, measured in
 *   `lib/plan/_ledger_atomicity.db.test.ts` against a real table — which SKIPS,
 *   loudly, with no scratch database.
 * · A COMMIT ISSUED BY `apply`. The boundary's contract forbids it in prose
 *   ("must not BEGIN, COMMIT or ROLLBACK") and nothing here reads the closures
 *   callers pass in.
 * · A LEDGER WRITE THAT IS SYNTACTICALLY PRESENT AND SEMANTICALLY WRONG — one
 *   describing a different mutation, or carrying an outcome that does not match
 *   what committed.
 * · WHETHER `table_absent` IS STILL THE RIGHT POSTURE. It permits the commit by
 *   design, because migration 166 is deliberately unapplied on production. If
 *   that ever stops being true this guard would not notice.
 */
describe('GUARD 3 · a plan mutation and its ledger record are one atomic outcome', () => {
  const body = mutatePlanBody(readFileSync(MUTATE, 'utf8'));
  const lines = body.split('\n');
  const commits = commitsOf(body);

  it('liveness · the walk found every COMMIT, and never zero', () => {
    expect(
      commits.length,
      'no COMMIT found in mutatePlan — the boundary has been restructured and this guard is '
      + 'watching nothing, which is worse than no guard because it also reports confidence',
    ).toBeGreaterThanOrEqual(5);
  });

  it('every COMMIT is preceded by an IN-TRANSACTION ledger write', () => {
    const naked: string[] = [];
    let prev = 0;
    for (const c of commits) {
      const window = lines.slice(prev, c.line).join('\n');
      if (!/\bawait landInTx\(/.test(window)) naked.push(`line ${c.line} of mutatePlan · ${c.text}`);
      prev = c.line;
    }
    expect(
      naked,
      naked.length === 0 ? '' :
        '\nA PLAN MUTATION COMMITS OUTSIDE ITS LEDGER RECORD:\n  ' + naked.join('\n  ') + '\n\n'
        + 'This COMMIT makes a plan change durable with no ledger row in the same transaction,\n'
        + 'so the row can fail afterwards and the boundary would log an error and return\n'
        + 'success — the exact four-step sequence LEDGERATOMIC-1 removed.\n\n'
        + 'Call `await landInTx(<decision>, <outcome>, <violations>, <account>, <planId>)`\n'
        + 'BEFORE the commit. `await land(...)` is the REFUSAL lane and belongs after a\n'
        + 'ROLLBACK, where there is no mutation for the row to be atomic with.',
    ).toEqual([]);
  });

  it('the refusal lane is used after a ROLLBACK and never before a COMMIT', () => {
    // Symmetric to the check above: `land(` immediately before a commit would
    // satisfy a reader skimming the code and would restore the defect.
    const offenders: string[] = [];
    let prev = 0;
    for (const c of commits) {
      let lastLand = -1;
      let lastTx = -1;
      for (let i = prev; i < c.line; i += 1) {
        const t = lines[i].trim();
        if (t.startsWith('*') || t.startsWith('//')) continue;
        if (/\bawait landInTx\(/.test(t)) lastTx = i;
        else if (/\bawait land\(/.test(t)) lastLand = i;
      }
      if (lastLand > -1 && lastLand > lastTx) {
        offenders.push(
          `line ${c.line} of mutatePlan · the last ledger call before this COMMIT is the REFUSAL `
          + `lane (line ${lastLand}), which writes on its own connection. A record that can fail `
          + 'independently of the commit is the defect, whatever it is called.',
        );
      }
      prev = c.line;
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the boundary rolls back rather than returning success when the ledger refuses', () => {
    const src = readFileSync(MUTATE, 'utf8');
    // The outcome exists, is returned, and is distinguishable from a crash.
    expect(src).toContain("| 'ledger_unwritten'");
    expect(src).toContain('class LedgerRefusedMutation extends Error');
    expect(src).toContain('e instanceof LedgerRefusedMutation');
    // And the in-transaction lane must not swallow. A `catch` that returns a
    // state instead of throwing is how the four-step sequence comes back.
    const store = readFileSync(path.join(ROOT, 'lib/brain/ledger/decision-ledger.ts'), 'utf8');
    const txStart = store.indexOf('export async function recordDecisionInTransaction');
    expect(txStart, 'the in-transaction lane has been renamed or removed').toBeGreaterThan(-1);
    // Bounded to THIS function. Slicing to end-of-file swept in
    // `loadRecentDecisions` and `directionCensus`, whose `state: 'failed'` is
    // correct and unrelated — the assertion failed on its first run for that
    // reason, which is the falsification working before the guard was trusted.
    const txEnd = store.indexOf('\n/**', txStart);
    const txLane = store.slice(txStart, txEnd > txStart ? txEnd : undefined);
    expect(txLane).toContain('recordDecisionInTransaction');
    expect(
      /state: 'failed'/.test(txLane),
      'the in-transaction lane returns a `failed` state · a caller can ignore a returned value '
      + 'and commit anyway, which is the whole defect. It must throw.',
    ).toBe(false);
  });

  it('ORACLE · the walk WOULD flag a commit whose ledger write comes after it', () => {
    const planted = [
      'export async function mutatePlan<T>(opts: X) {',
      "    await client.query('COMMIT');",
      "    await landInTx('APPLY', 'applied', [], 'x', p);",
      '}',
      '',
      '// ── the record ──',
    ].join('\n');
    const b = mutatePlanBody(planted);
    const c = commitsOf(b);
    expect(c).toHaveLength(1);
    const window = b.split('\n').slice(0, c[0].line).join('\n');
    expect(/\bawait landInTx\(/.test(window)).toBe(false);
  });

  it('ORACLE · and it would NOT flag one whose write comes before', () => {
    const planted = [
      'export async function mutatePlan<T>(opts: X) {',
      "    await landInTx('APPLY', 'applied', [], 'x', p);",
      "    await client.query('COMMIT');",
      '}',
      '',
      '// ── the record ──',
    ].join('\n');
    const b = mutatePlanBody(planted);
    const c = commitsOf(b);
    expect(c).toHaveLength(1);
    const window = b.split('\n').slice(0, c[0].line).join('\n');
    expect(/\bawait landInTx\(/.test(window)).toBe(true);
  });
});

/**
 * The functions that turn a decision's `reconsiderAtISO` into a QUEUED ITEM.
 * Calling one of these is what makes a module a producer of deferred work.
 */
const DEFERRAL_PRODUCERS = ['enqueueDeferrals(', 'reconsiderAtBoundary('] as const;

/** The functions that give a queued item a durable row. */
const DURABLE_SINKS = [
  'persistQueueAtBoundary(',
  'scheduleReassessment(',
  'upsertDeferral(',
] as const;

describe('GUARD 2 · a deferred action has a durable scheduler row', () => {
  // The file set is enumerated rather than globbed: every module that produces
  // deferred work is named here, and a NEW one is caught by the liveness check
  // below rather than by silence.
  const CANDIDATES = [SHADOW_RUN];

  it('liveness · at least one module actually produces deferred work', () => {
    const producing = CANDIDATES.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return DEFERRAL_PRODUCERS.some((p) => src.includes(p));
    });
    expect(
      producing.length,
      'no module calls a deferral producer any more — either the mechanism was removed '
      + '(delete this guard and say so) or it was renamed (re-point DEFERRAL_PRODUCERS). '
      + 'A guard watching nothing is worse than no guard, because it also reports confidence.',
    ).toBeGreaterThan(0);
  });

  it('every producer also persists what it queued', () => {
    const orphans: string[] = [];
    for (const f of CANDIDATES) {
      const src = readFileSync(f, 'utf8');
      if (!DEFERRAL_PRODUCERS.some((p) => src.includes(p))) continue;
      if (!DURABLE_SINKS.some((s) => src.includes(s))) {
        orphans.push(path.relative(ROOT, f));
      }
    }
    expect(
      orphans,
      orphans.length === 0 ? '' :
        '\nA DEFERRED ACTION HAS NO DURABLE SCHEDULER ROW:\n  ' + orphans.join('\n  ') + '\n\n'
        + 'This module turns a decision into a queued item and never persists it, so the\n'
        + 'promise lives only in memory and dies with the process. That is exactly the\n'
        + 'shape `deferral-queue.ts` was written to end: "the date was a PROMISE nothing\n'
        + 'kept ... whether the deferred change ever happened depended entirely on the same\n'
        + 'evidence happening to clear the same bars again."\n\n'
        + 'Route it through lib/ops/reassessment-scheduler.ts (or the deferral store, which\n'
        + 'writes the same table with kind = DEFERRAL).',
    ).toEqual([]);
  });

  it('the durable sink writes the ONE scheduler table, not a second queue', () => {
    // "Prefer extending or replacing it over adding a third queue." The deferral
    // store and the scheduler both target `reassessment_schedule`; a new table
    // name appearing in either is a third queue arriving quietly.
    const store = readFileSync(path.join(ROOT, 'lib/adaptation/canonical-shadow/deferral-store.ts'), 'utf8');
    const scheduler = readFileSync(path.join(ROOT, 'lib/ops/reassessment-scheduler.ts'), 'utf8');
    expect(store).toContain('reassessment_schedule');
    expect(scheduler).toContain('reassessment_schedule');
    expect(store, 'the deferral store still names the superseded table')
      .not.toContain('INSERT INTO canonical_adaptation_deferrals');
  });

  it('ORACLE · the scan WOULD flag a producer with no sink', () => {
    const planted = 'const outcome = reconsiderAtBoundary({ live, fresh });';
    expect(DEFERRAL_PRODUCERS.some((p) => planted.includes(p))).toBe(true);
    expect(DURABLE_SINKS.some((s) => planted.includes(s))).toBe(false);
  });

  it('ORACLE · and it would NOT flag one that persists', () => {
    const planted = 'const outcome = reconsiderAtBoundary({}); await persistQueueAtBoundary(u, outcome);';
    expect(DEFERRAL_PRODUCERS.some((p) => planted.includes(p))).toBe(true);
    expect(DURABLE_SINKS.some((s) => planted.includes(s))).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 4 (2026-09-06) · A DECLINE THAT MUTATES NOTHING STILL LANDS IN THE
 * LEDGER.
 *
 * A prior round's own finding: "a decline is NOT in `plan_decision_ledger`."
 * `mutatePlan`'s exits (GUARD 1) cannot see this class at all — a decline
 * never reaches `mutatePlan`, because there is nothing for it to mutate. The
 * two routes that answer a runner's "no" — `plan/workout-proposals/[id]/
 * dismiss` and `coach/proposal/[id]/decline` — are enumerated here rather
 * than globbed for the same reason `DEFERRAL_PRODUCERS` are named in GUARD 2:
 * a NEW decline route is caught by the liveness check below going empty, not
 * by silence.
 *
 * ── WHAT THIS GUARD CANNOT FAIL ON (Rule 22) ───────────────────────────────
 *
 * · A THIRD DECLINE SURFACE THIS FILE DOES NOT NAME. Enumerated, not globbed —
 *   the same limit GUARD 2 states about `DEFERRAL_PRODUCERS`.
 * · WHETHER THE LEDGER CALL ACTUALLY WRITES A ROW. It scans source; whether
 *   the write lands is `decision-ledger.ts`'s own contract and a real-database
 *   question, not this file's.
 * · AN ACCEPT ROUTE THAT SHOULD ALSO RECORD SOMETHING. Accept already runs
 *   through `mutatePlan` (GUARD 1's scope) or `applyBrainAction`; this guard is
 *   about the answer that mutates nothing, which is the one GUARD 1 cannot see.
 */
describe('GUARD 4 · a decline that mutates nothing still lands in the ledger', () => {
  const DISMISS_ROUTE = path.join(ROOT, 'app/api/plan/workout-proposals/[id]/dismiss/route.ts');
  const COACH_DECLINE_ROUTE = path.join(ROOT, 'app/api/coach/proposal/[id]/decline/route.ts');
  const LEDGER_ENTRY = path.join(ROOT, 'lib/brain/ledger/ledger-entry.ts');
  const DECLINE_ROUTES = [DISMISS_ROUTE, COACH_DECLINE_ROUTE];

  it('liveness · both declared decline routes exist and are substantial', () => {
    for (const f of DECLINE_ROUTES) {
      expect(existsSync(f), `${f} is missing`).toBe(true);
      expect(readFileSync(f, 'utf8').length).toBeGreaterThan(1000);
    }
  });

  it('declineEntry exists and is what recordDecision is asked to write', () => {
    const entry = readFileSync(LEDGER_ENTRY, 'utf8');
    expect(entry).toContain('export function declineEntry');
    expect(entry).toContain("runnerResponse: 'DECLINED'");
  });

  it('every decline route calls BOTH declineEntry and recordDecision', () => {
    const silent: string[] = [];
    for (const f of DECLINE_ROUTES) {
      const src = readFileSync(f, 'utf8');
      const callsBuilder = src.includes('declineEntry(');
      const callsStore = src.includes('recordDecision(');
      if (!callsBuilder || !callsStore) silent.push(path.relative(ROOT, f));
    }
    expect(
      silent,
      silent.length === 0 ? '' :
        '\nA DECLINE ROUTE NEVER REACHES THE LEDGER:\n  ' + silent.join('\n  ') + '\n\n'
        + 'The runner answered "no" and nothing durable recorded it. Rule 21\'s own class of '
        + 'defect, from the other direction: "the engine never pushes" and "the runner never '
        + 'accepted the push it was offered" are indistinguishable without this row. Call '
        + 'declineEntry(...) (lib/brain/ledger/ledger-entry.ts) and hand it to recordDecision(...) '
        + '(lib/brain/ledger/decision-ledger.ts) — lane B, on its own connection, because a '
        + 'decline never mutates and there is nothing for the row to be atomic with.',
    ).toEqual([]);
  });

  it('ORACLE · the scan WOULD flag a decline route with no ledger call', () => {
    const planted = `
      const ok = await dismissProposal(userId, proposalId);
      console.log('declined', proposalId);
      return NextResponse.json({ ok: true });
    `;
    const callsBuilder = planted.includes('declineEntry(');
    const callsStore = planted.includes('recordDecision(');
    expect(callsBuilder && callsStore, 'the ORACLE positive control itself calls the ledger').toBe(false);
  });

  it('ORACLE · and it would NOT flag one that reaches both', () => {
    const planted = `
      const ok = await dismissProposal(userId, proposalId);
      await recordDecision(declineEntry({ userUuid, planId, planLineageId, provenance: 'x',
        explanation: 'x', proposalId: String(proposalId) }));
      return NextResponse.json({ ok: true });
    `;
    const callsBuilder = planted.includes('declineEntry(');
    const callsStore = planted.includes('recordDecision(');
    expect(callsBuilder && callsStore).toBe(true);
  });
});
