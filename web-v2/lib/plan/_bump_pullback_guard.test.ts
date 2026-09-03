/**
 * lib/plan/_bump_pullback_guard.test.ts · the pull-down / push-up window.
 *
 * The defect (2026-08-28 audit): `tryAdaptiveBump` only skipped when
 * pull-back actions fired the SAME cron tick, so a downgrade applied Monday
 * did not stop a volume bump Tuesday. Doctrine spaces hard
 * from easy in DAYS (Research/00b §"The Hard-Easy Principle" · "hard day →
 * 1–2 easy/recovery/rest days → next hard day"), so the guard is now a
 * 48-hour lookback over the adapter's own applied pull-back intents.
 *
 * ── 2026-09-02 · WHAT THE ADAPTATION SEAM DID TO THIS FILE ───────────────
 *
 * `lib/plan/adaptation-authority.ts` made `tryAdaptiveBump` return at its
 * FIRST line while `AUTOMATIC_ADAPTATION_AUTHORITY` is false. Section 2 used
 * to drive the 48-hour window through that entry point, and after the seal
 * all four of its tests were measuring the seam instead:
 *
 *   · three PASSED VACUOUSLY. `issued` is empty and `training_plans` is
 *     unqueried under a closed seam whatever the window decides, so
 *     "same-tick short-circuits", "inside 48h blocks" and "fails closed on an
 *     unreadable read" were all satisfied by a function that never looked.
 *   · one FAILED — "older than 48h does not block" asserted the ramp REACHED
 *     its plan lookup, which is the one thing a closed seam guarantees it
 *     cannot do.
 *
 * A guard that passes for the wrong reason is worse than one that fails, so
 * the window is now driven on its own terms through `recentPullbackTs` +
 * `pullbackBlocksBump` (section 2), and the seam gets its own honest
 * assertion instead of three accidental ones (section 3).
 *
 * Locked here:
 *   · pull-back Monday BLOCKS a bump Tuesday, ALLOWS one Thursday (pure)
 *   · the intents read names the right population and the right reasons
 *   · the guard fails CLOSED when the intents read fails
 *   · the seam refuses the bump before any read, deliberately and visibly
 *   · the reason list is NON-EMPTY and every entry is still written by
 *     `adapt.ts` — otherwise the whole guard is a query over a column nothing
 *     can populate, which is Rule 11's failure wearing a thorough-looking list
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-08-28'),
}));

import { pool } from '@/lib/db/pool';
import {
  PULLBACK_BUMP_LOOKBACK_HOURS,
  PULLBACK_INTENT_REASONS,
  pullbackBlocksBump,
  recentPullbackTs,
  tryAdaptiveBump,
} from './adaptive-ramp';
import {
  AUTOMATIC_ADAPTATION_AUTHORITY,
  automaticPlanMutationIsAuthorised,
} from './adaptation-authority';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = pool.query as any;
let issued: string[] = [];

const UUID = '00000000-0000-0000-0000-000000000042';

beforeEach(() => {
  vi.clearAllMocks();
  issued = [];
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · the pure window
 * ═══════════════════════════════════════════════════════════════════════ */

describe('1 · pullbackBlocksBump', () => {
  // The brief's exact scenario: the 03:00 cron applied a readiness downgrade
  // Monday morning; the Tuesday and Thursday crons then consider a bump.
  const MONDAY_PULLBACK = '2026-08-24T03:05:00Z';
  const TUESDAY_CRON = Date.parse('2026-08-25T03:00:00Z');
  const THURSDAY_CRON = Date.parse('2026-08-27T03:00:00Z');

  it('a pull-back Monday blocks a bump Tuesday', () => {
    expect(pullbackBlocksBump(MONDAY_PULLBACK, TUESDAY_CRON)).toBe(true);
  });

  it('and allows one Thursday · the window is 48h, not forever', () => {
    expect(pullbackBlocksBump(MONDAY_PULLBACK, THURSDAY_CRON)).toBe(false);
  });

  it('no pull-back on record does not block', () => {
    expect(pullbackBlocksBump(null, TUESDAY_CRON)).toBe(false);
    expect(pullbackBlocksBump(undefined, TUESDAY_CRON)).toBe(false);
  });

  it('an unparseable timestamp blocks · a guard that cannot read its evidence does not wave load through', () => {
    expect(pullbackBlocksBump('not-a-date', TUESDAY_CRON)).toBe(true);
  });

  it('the window is the doctrine window · 48h', () => {
    expect(PULLBACK_BUMP_LOOKBACK_HOURS).toBe(48);
  });

  it('the reasons are exactly the two a live trigger still writes', () => {
    // 2026-09-02 · was three, the third being
    // `readiness_convergence_red_no_quality`. Readiness no longer produces a
    // trigger, so nothing writes that row any more.
    expect([...PULLBACK_INTENT_REASONS])
      .toEqual(['plan_adapt_downgrade', 'plan_adapt_shave']);
  });

  it('RULE 11 · the list is non-empty and every entry is still WRITTEN by adapt.ts', () => {
    // The failure this closes: shrink the list to nothing (or to reasons the
    // adapter stopped emitting) and `recentPullbackTs` becomes a query that
    // can only ever return no rows. The guard would then report "no pull-back
    // on record" forever — a missing input silently disabling a safety
    // mechanism — and every test above would still pass, because they all
    // exercise `pullbackBlocksBump`, which never looks at the list.
    expect(PULLBACK_INTENT_REASONS.length).toBeGreaterThan(0);

    const adaptSrc = readFileSync(path.join(process.cwd(), 'lib', 'plan', 'adapt.ts'), 'utf8');
    // Rule 18 §2 · liveness. An unreadable or empty file must not read as
    // "every reason is present".
    expect(adaptSrc.length, 'adapt.ts read as empty · this scan saw nothing')
      .toBeGreaterThan(5_000);
    for (const reason of PULLBACK_INTENT_REASONS) {
      expect(
        adaptSrc.includes(`'${reason}'`),
        `${reason} is in PULLBACK_INTENT_REASONS but adapt.ts never writes it · `
        + 'the 48h guard would be reading for a row that cannot exist',
      ).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · the DB shell · the 48-hour window ON ITS OWN TERMS
 *
 * Driven through `recentPullbackTs` (the read) composed with
 * `pullbackBlocksBump` (the predicate), which is the whole guard, rather than
 * through `tryAdaptiveBump`, which the seam now short-circuits before either
 * one runs. See the file header for the three vacuous passes this replaces.
 * ═══════════════════════════════════════════════════════════════════════ */

let issuedParams: unknown[][] = [];

function routeQueries(handler: (sql: string) => { rows: Record<string, unknown>[] } | 'throw') {
  query.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const text = String(sql);
    issued.push(text);
    issuedParams.push(params ?? []);
    const r = handler(text);
    if (r === 'throw') throw new Error('connection terminated');
    return { rows: r.rows, rowCount: r.rows.length };
  });
}

/** The read + the predicate, i.e. the guard, exactly as tryAdaptiveBump composes them. */
async function guardBlocks(): Promise<boolean> {
  const pullback = await recentPullbackTs(UUID);
  return pullback.failed || pullbackBlocksBump(pullback.ts, Date.now());
}

const intentRow = (hoursAgo: number) => ({
  rows: [{ ts: new Date(Date.now() - hoursAgo * 3600_000).toISOString() }],
});

describe('2 · the 48h window, read from coach_intents', () => {
  beforeEach(() => { issuedParams = []; });

  it('LIVENESS · the read actually issues its query', async () => {
    // Rule 18 §2. Every assertion below is downstream of this one, and a
    // `recentPullbackTs` that returned without reading would satisfy the
    // fail-closed case by accident — which is precisely how the tests this
    // section replaces came to pass without looking at anything.
    routeQueries(() => ({ rows: [] }));
    await recentPullbackTs(UUID);
    expect(issued.filter((s) => s.includes('MAX(ts)'))).toHaveLength(1);
  });

  it('RULE 14 · the read names its population — this user, these reasons', async () => {
    // The query is the only thing standing between the guard and every other
    // account's rows, and the reason list is what decides whether it can ever
    // match. Neither was asserted anywhere before: the old shell tests only
    // ever matched on the substring `MAX(ts)`.
    routeQueries(() => ({ rows: [] }));
    await recentPullbackTs(UUID);
    const at = issued.findIndex((s) => s.includes('MAX(ts)'));
    expect(at).toBeGreaterThan(-1);
    expect(issued[at]).toContain('COALESCE(user_uuid, user_id) = $1::uuid');
    expect(issued[at]).toContain('reason = ANY($2::text[])');
    expect(issuedParams[at][0]).toBe(UUID);
    expect(issuedParams[at][1]).toEqual([...PULLBACK_INTENT_REASONS]);
  });

  it('a pull-back 12h ago BLOCKS', async () => {
    routeQueries((sql) => (sql.includes('MAX(ts)') ? intentRow(12) : { rows: [] }));
    expect(await guardBlocks()).toBe(true);
  });

  it('a pull-back 72h ago DOES NOT BLOCK · the window really has a far edge', async () => {
    // The direction the seam broke, restated where it can still be measured.
    // Without this the section could only ever prove the guard says no.
    routeQueries((sql) => (sql.includes('MAX(ts)') ? intentRow(72) : { rows: [] }));
    expect(await guardBlocks()).toBe(false);
  });

  it('no pull-back on record DOES NOT BLOCK', async () => {
    routeQueries(() => ({ rows: [] }));
    const pullback = await recentPullbackTs(UUID);
    expect(pullback).toEqual({ failed: false, ts: null });
    expect(await guardBlocks()).toBe(false);
  });

  it('fails CLOSED · an unreadable intents table is not "no recent pull-back"', async () => {
    // RULE 11 · and the two facts stay apart in the return value, not just in
    // the verdict: `failed: true` is distinguishable from `ts: null`, which is
    // what lets the caller log the difference.
    routeQueries((sql) => (sql.includes('MAX(ts)') ? 'throw' : { rows: [] }));
    const pullback = await recentPullbackTs(UUID);
    expect(pullback).toEqual({ failed: true, ts: null });
    expect(await guardBlocks()).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · the seam · asserted deliberately, once, instead of three times by
 *     accident.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('3 · tryAdaptiveBump refuses at the seam, before the window is even asked', () => {
  it('no input reaches a read while AUTOMATIC_ADAPTATION_AUTHORITY is false', async () => {
    // Both arguments, because `pullbackApplied: true` used to be its own
    // "short-circuits before any read" test and is now the same fact as the
    // other branch. One test, stated once (Rule 17), naming the real cause.
    for (const pullbackApplied of [true, false]) {
      issued.length = 0;
      routeQueries(() => ({ rows: [] }));
      expect(await tryAdaptiveBump(UUID, pullbackApplied)).toBeNull();
      expect(issued, `pullbackApplied=${pullbackApplied} · the sealed bump read the database`)
        .toEqual([]);
    }
  });

  it('and the seam is the reason · the switch is off and this file says which one', () => {
    // Names the cause, so if the owner ever opens the seam this test fails and
    // whoever opens it is sent back to section 2 to re-couple the window to
    // the entry point. Without this the section above would silently become a
    // test of nothing the day the switch flips.
    expect(AUTOMATIC_ADAPTATION_AUTHORITY).toBe(false);
    expect(automaticPlanMutationIsAuthorised()).toBe(false);
  });
});
