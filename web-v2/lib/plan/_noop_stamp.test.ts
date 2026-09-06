/**
 * NOOPSTAMP-1 · `last_adapted_at` MEANS "THE PRESCRIPTION CHANGED", AND
 * NOTHING ELSE.
 *
 * David, 2026-09-05, item 12: fix "`last_adapted_at` changing on a no-op".
 *
 * ── THE MEASUREMENT ───────────────────────────────────────────────────────
 *
 * Production, read-only, 2026-09-05. All seven active plans:
 *
 *   fb21cb09…  pln_0c917a6cbe63d080   2026-09-05 11:21:42.113899+00
 *   d2f504ac…  pln_0c75f856a3849c32   2026-09-05 11:21:41.347161+00
 *   bcefea06…  pln_2684dabde181e595   2026-09-05 11:21:40.788625+00
 *   b04e35e9…  pln_5e51f75b89cc8f00   2026-09-05 11:21:40.168922+00
 *   9298919a…  pln_bb0ee646c2ace790   2026-09-05 11:21:38.595874+00
 *   606bcc38…  pln_c773986632a66584   2026-09-05 11:21:36.431513+00
 *   0645f40c…  pln_7636bcc0a201bf2d   2026-09-05 11:21:27.417353+00
 *
 * Fifteen seconds apart — one pass — and `ops_alerts` records
 * `cron/snapshot-projections completed` at 11:21:42.446. The most recent
 * `plan_adapt_*` coach intent for ANY runner at that moment was 2026-09-03
 * 07:53. Seven prescriptions "adapted" and nothing adapted.
 *
 * ── WHY IT MATTERS MORE THAN A WRONG TIMESTAMP ────────────────────────────
 *
 * `lib/plan/plan-version.ts` builds `planVersion` as `${id}:${last_adapted_at}`
 * and five consumers read it as "the prescription changed":
 * `/api/v5/today`, `lib/plan/week-loader.ts`, `lib/plan/plan-snapshot.ts`
 * (the watch), `lib/brain/proposal/staleness.ts` — which marks a PENDING
 * PROPOSAL STALE the instant it moves — and
 * `lib/adaptation/canonical/deferral-queue.ts`, which expires a deferred
 * progression as `PLAN_VERSION_CHANGED`. So a nightly no-op stamp retires
 * every outstanding question the coach has asked the runner, and does it on
 * exactly the nights the engine decided nothing.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (CLAUDE.md Rule 22) ─────────────────────
 *
 *   · It cannot fail on a caller that OMITS `didChange` and is genuinely
 *     no-op-prone. The default is "stamp", deliberately, so no existing
 *     caller changed behaviour — which means a NEW unattended writer that
 *     forgets the predicate reintroduces the defect. Guard 4 pins the three
 *     per-pass writers known to run for every runner every cycle; it cannot
 *     know about a fourth.
 *   · It cannot fail on `didChange` being WRONG. It proves the predicate is
 *     honoured, not that `updated > 0` is the right question for that caller.
 *   · It cannot observe production. The seven rows above are evidence
 *     gathered by hand; nothing in this repo can re-read them.
 *   · It cannot fail on ledger absence (LEDGERREQUIRED-1, 2026-09-06). The
 *     mock reports the ledger table present and its insert successful on
 *     every run, deliberately, so a bypass mutation here reaches the stamp
 *     decision the same way it would once migration 166 is applied. The
 *     refuse-before-mutate contract for a genuinely absent table is proved
 *     against a real database in `_ledger_atomicity.db.test.ts` (0b/0c), not
 *     here — this file has never asserted anything about table presence and
 *     should not start silently depending on it.
 *   · Distribution (Rule 22): four assertions require the stamp to still
 *     happen and four require it not to. A gate that only checked "no-ops
 *     don't stamp" would pass a boundary that had stopped stamping entirely,
 *     which would freeze every client cache instead of busting it — the same
 *     defect in the mirror, and worse, because it is invisible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ══════════════════════════════════════════════════════════════════════════
 * A · BEHAVIOUR · both directions, through the real boundary
 * ═══════════════════════════════════════════════════════════════════════ */

/** Every statement the boundary issued, in order. */
const issued: string[] = [];

function fakeClient() {
  return {
    query: vi.fn(async (sql: string) => {
      issued.push(String(sql).replace(/\s+/g, ' ').trim());
      const s = String(sql);
      if (/RETURNING last_adapted_at/.test(s)) {
        return { rows: [{ last_adapted_at: '2026-09-05T23:59:59.000Z' }], rowCount: 1 };
      }
      if (/SELECT last_adapted_at/.test(s)) {
        return { rows: [{ last_adapted_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 };
      }
      // LEDGERREQUIRED-1 · this suite is about `last_adapted_at` stamping,
      // not ledger presence. The harness reports the ledger PRESENT and its
      // insert successful so a bypass mutation reaches the stamp decision the
      // same way it would in production with migration 166 applied — the
      // absence path has its own dedicated coverage in
      // `_ledger_atomicity.db.test.ts` (0b/0c) and re-exercising it here would
      // only make this file assert something it does not name (Rule 22).
      if (/to_regclass/.test(s)) {
        return { rows: [{ reg: 'plan_decision_ledger' }], rowCount: 1 };
      }
      if (/INSERT INTO plan_decision_ledger/.test(s)) {
        return { rows: [{ id: 'ldg_test' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
}

vi.mock('@/lib/db/pool', () => {
  const client = fakeClient();
  return {
    pool: {
      connect: vi.fn(async () => client),
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    },
    __client: client,
  };
});

async function runBypassMutation(didChange?: (v: { updated: number }) => boolean) {
  const { mutatePlan } = await import('./mutate');
  return mutatePlan<{ updated: number }>({
    // RUNNER_ACCEPTED is permitted outright, so this exercises the write path
    // rather than the authority refusal.
    authority: 'RUNNER_ACCEPTED',
    userUuid: '00000000-0000-4000-8000-000000000001',
    source: 'noop-stamp-test',
    todayISO: '2026-09-05',
    planId: 'pln_test',
    touches: 'derivations',
    bypass: { reason: 'test harness · exercises the stamp decision only' },
    ...(didChange ? { didChange } : {}),
    apply: async () => ({ updated: didChange ? 0 : 3 }),
  });
}

const stampUpdates = (): string[] =>
  issued.filter((s) => /UPDATE training_plans SET last_adapted_at/.test(s));

describe('NOOPSTAMP-1 · the boundary stamps a change and leaves a no-op alone', () => {
  beforeEach(() => { issued.length = 0; });

  it('DIRECTION 1 · a real mutation still stamps last_adapted_at', async () => {
    const r = await runBypassMutation(undefined);
    expect(r.ok, 'the boundary refused — the harness is wrong, not the code').toBe(true);
    // Liveness (Rule 18) · if the harness issued no statements at all this
    // assertion would pass vacuously without it.
    expect(issued.length, 'the boundary issued NO statements').toBeGreaterThan(1);
    expect(stampUpdates(), 'a real mutation did not stamp').toHaveLength(1);
    // The stamp RETURNS the new value, which is what the ledger row records as
    // `planVersion`. `MutatePlanResult` does not surface it, so the statement
    // shape is the observable: a stamping path uses RETURNING, never a SELECT.
    expect(issued.some((x) => /RETURNING last_adapted_at/.test(x))).toBe(true);
    expect(issued.some((x) => /SELECT last_adapted_at/.test(x))).toBe(false);
  });

  it('DIRECTION 1b · omitting didChange keeps the old behaviour exactly', async () => {
    // The compatibility promise. Every existing caller omits it.
    await runBypassMutation(undefined);
    expect(stampUpdates()).toHaveLength(1);
  });

  it('DIRECTION 2 · a caller that says nothing changed does NOT stamp', async () => {
    const r = await runBypassMutation(() => false);
    expect(r.ok).toBe(true);
    expect(issued.length, 'the boundary issued NO statements').toBeGreaterThan(1);
    expect(stampUpdates(), 'a no-op still stamped last_adapted_at').toHaveLength(0);
  });

  it('DIRECTION 2b · a no-op still REPORTS the version, it does not report null', async () => {
    // Rule 11 · "we looked and nothing changed" must not arrive downstream as
    // "we could not tell". The ledger row still needs a version.
    const r = await runBypassMutation(() => false);
    expect(r.ok).toBe(true);
    // It READ the version rather than skipping the question. If this SELECT
    // vanished, `producedPlanVersion` would be null and the ledger row would
    // say "no version" about a plan that plainly has one.
    expect(issued.some((x) => /SELECT last_adapted_at/.test(x)),
      'a no-op skipped reading the version instead of reporting it').toBe(true);
    expect(issued.some((x) => /RETURNING last_adapted_at/.test(x))).toBe(false);
  });

  it('DIRECTION 3 · didChange returning TRUE stamps, so the predicate is read not assumed', async () => {
    // Guards against a fix that "works" by never stamping when the option is
    // present at all — which would break every caller that passes a predicate
    // for a real change.
    issued.length = 0;
    const { mutatePlan } = await import('./mutate');
    await mutatePlan<{ updated: number }>({
      authority: 'RUNNER_ACCEPTED',
      userUuid: '00000000-0000-4000-8000-000000000001',
      source: 'noop-stamp-test',
      todayISO: '2026-09-05',
      planId: 'pln_test',
      touches: 'derivations',
      bypass: { reason: 'test harness' },
      didChange: (v) => v.updated > 0,
      apply: async () => ({ updated: 7 }),
    });
    expect(stampUpdates(), 'didChange:true did not stamp').toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B · SOURCE · the two unconditional writers are gone, and the per-pass
 *     writers declare their predicate
 * ═══════════════════════════════════════════════════════════════════════ */

describe('NOOPSTAMP-1 · no writer stamps unconditionally on a cron pass', () => {
  it('guard 1 · the run-adaptations cron no longer stamps on the no-op path', () => {
    const src = read('app/api/cron/run-adaptations/route.ts');
    expect(src.length, 'read nothing').toBeGreaterThan(5000);
    // The exact statement that stamped every active plan whenever the pass
    // applied nothing, which under the closed adaptation seam is every pass.
    expect(src).not.toMatch(/if \(applied === 0\) \{\s*\n\s*await pool\.query\(/);
    expect(src).not.toMatch(/UPDATE training_plans SET last_adapted_at = NOW\(\)\s*\n\s*WHERE user_uuid = \$1 AND archived_iso IS NULL`,\s*\n\s*\[uid\]/);
    // And the fact it existed to record has its real owner named.
    expect(src).toContain('recordCronSuccess');
  });

  it('guard 2 · applyAdaptations stamps only when it touched a workout', () => {
    const src = read('lib/plan/adapt.ts');
    expect(src.length).toBeGreaterThan(5000);
    const i = src.indexOf('UPDATE training_plans SET last_adapted_at = NOW()');
    expect(i, 'the stamp is gone entirely — that is the other failure').toBeGreaterThan(0);
    // The 400 characters before it must open the `touched > 0` block. The
    // adaptation_log append has always been inside it; the stamp now is too.
    const before = src.slice(Math.max(0, i - 400), i);
    expect(before, 'the stamp is not inside `if (touched > 0)`').toContain('if (touched > 0) {');
  });

  it('guard 3 · the stamp helper honours the predicate rather than ignoring it', () => {
    const src = read('lib/plan/mutate.ts');
    expect(src).toContain('if (opts.didChange && !opts.didChange(value))');
    // All three commit paths still call it — the ratchet
    // `_planversion_invalidation.test.ts` enforces, restated here so a change
    // to one file fails in both places rather than looking local.
    expect((src.match(/await stampAdapted\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // …and every call now passes the value, or the predicate can never fire.
    expect((src.match(/await stampAdapted\([^)]*, value\)/g) ?? []).length).toBe(3);
  });

  it('guard 4 · the writers that run for every runner on every pass declare didChange', () => {
    // These three are reached by `snapshot-projections` / `plan-drift` per
    // runner per cycle. An unconditional stamp in any of them is a nightly
    // version bump for the whole user base.
    const refresh = read('lib/race/race-row-refresh.ts');
    expect(refresh).toContain('didChange: (v) => (v?.updated ?? 0) > 0');
    const reanchor = read('lib/plan/reanchor-plan.ts');
    expect((reanchor.match(/didChange: \(v\) => \(v\?\.workoutsUpdated \?\? 0\) > 0/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });

  it('guard 5 · recompute-paces keeps its own gated stamp, and the two agree', () => {
    // It was already the only correctly-gated stamp in the codebase, and it
    // was being defeated by the boundary stamping over the top of it on the
    // same transaction. Rule 16 · one quantity, one answer.
    const src = read('lib/plan/recompute-paces.ts');
    expect(src).toContain('if (updated > 0 || raceRowsChanged) {');
  });
});
