/**
 * lib/coach/_plan_match_ambiguous_leak.test.ts
 *
 * Independent-review finding on `fix/execution-identity-watch-matcher`
 * (WATCHMATCH-1, 2026-09-11): `lib/runs/plan-match-ambiguity.ts`'s
 * `recordPlanMatchAmbiguity()` writes a `plan_match_ambiguous` `coach_intents`
 * row pre-acknowledged specifically so `lib/coach/state-loader.ts`'s
 * pending-intents query (`WHERE acknowledged_at IS NULL`) never sees it — its
 * own doc comment is explicit that "this reason is NEVER meant to reach"
 * that path, because "an ambiguous-match refusal is an engineering signal
 * about identity, not something the coach voice should ever try to phrase
 * to the runner." `lib/runs/plan-type-stamp.ts`'s `PlanDayMatchRefusal.message`
 * carries the identical claim: "Coach-log/audit safe, never shown to the
 * runner verbatim."
 *
 * But `GET /api/coach/intents` is a SEPARATE, unfiltered-by-default read
 * path — its own header comment: "Timeline / history surfaces leave
 * [unacked_only] false to keep the audit log complete" — and it is called
 * with no reason filtering from `native-v2/.../ProfileView.swift:224`
 * (`API.fetchCoachIntents(limit: 20)`), feeding the real, live
 * `CoachActivityTimeline` on the runner's own Profile screen, which renders
 * `.summary` verbatim. `summarize()` in that route has no case for
 * `plan_match_ambiguous`, so it falls through to the generic fallback —
 * `${reason} · ${field}: ${String(value).slice(0, 60)}` — which prints the
 * refusal's raw JSON (candidate ids, internal `code`, `message`) straight
 * to the runner. That directly contradicts both doc comments above and
 * violates coach-voice doctrine (no raw JSON/internal codes in runner-
 * facing text) and Rule 17.
 *
 * FIX (this file's second `it`): `plan_match_ambiguous` is excluded from
 * `/api/coach/intents`'s query outright — Option B. Chosen over giving it a
 * narration (Option A) because the write site's own words are that this
 * event should never be phrased to the runner at all, not just phrased
 * carefully; that puts it in the same "internal, not surfaced, no runner-
 * facing reader exists yet" bucket this codebase already uses elsewhere
 * (`lib/audit/generated-content-registry.ts`'s admin-gated-only entries) —
 * not the "needs a coach-voice sentence" bucket `plan_adapt_*` etc. sit in.
 *
 * Falsified per Rule 18: this file's first `it` was run against the
 * pre-fix `route.ts` (no `reason != 'plan_match_ambiguous'` clause) and
 * failed — the mocked row came back in `rows` with `reason` present and
 * `summary` reading `"plan match ambiguous · 2026-09-05#watch:
 * {"code":"ambiguous-plan-day-match","message":"2 prescriptions...`
 * verbatim, reproducing the reviewer's finding exactly. See the commit
 * message for the before/after transcript.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/auth/session', () => ({
  requireUserId: vi.fn().mockResolvedValue('abcdef12-3456-7890-abcd-ef1234567890'),
}));

import { NextRequest } from 'next/server';
import { pool } from '@/lib/db/pool';
import { GET } from '@/app/api/coach/intents/route';

const AMBIGUOUS_ROW = {
  ts: '2026-09-05T18:04:11.000Z',
  reason: 'plan_match_ambiguous',
  field: '2026-09-05#watch',
  value: JSON.stringify({
    code: 'ambiguous-plan-day-match',
    message: '2 prescriptions plausibly matched actualMi=6.2 on 2026-09-05',
    dateISO: '2026-09-05',
    actualMi: 6.2,
    candidateIds: ['day-abc123', 'day-def456'],
    source: 'watch',
  }),
};

const NORMAL_ROW = {
  ts: '2026-09-04T12:00:00.000Z',
  reason: 'plan_adapt_rhr_spike',
  field: null,
  value: null,
};

// A real Postgres WHERE clause would filter these rows at the database.
// The mock has to do the same filtering the SQL text asks for, or this
// test would pass/fail independent of whatever route.ts actually sends —
// exercising nothing. So: dispatch on the query text like the rest of
// this repo's route tests, and apply the one clause under test.
beforeEach(() => {
  vi.clearAllMocks();
  (pool.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
    const allRows = [AMBIGUOUS_ROW, NORMAL_ROW];
    const rows = typeof sql === 'string' && sql.includes("reason != 'plan_match_ambiguous'")
      ? allRows.filter((r) => r.reason !== 'plan_match_ambiguous')
      : allRows;
    return Promise.resolve({ rows });
  });
});

function getReq(): NextRequest {
  return new NextRequest('https://x/api/coach/intents?limit=20');
}

describe('GET /api/coach/intents · plan_match_ambiguous must never reach the runner', () => {
  it('never returns a plan_match_ambiguous row to the client (Option B: excluded outright)', async () => {
    const res = await GET(getReq());
    const body = await res.json();
    expect(body.ok).toBe(true);
    const reasons = body.rows.map((r: { reason: string }) => r.reason);
    expect(reasons).not.toContain('plan_match_ambiguous');
    // The unrelated row must still come through — this isn't a blanket
    // "hide everything" regression, only the one reason is excluded.
    expect(reasons).toContain('plan_adapt_rhr_spike');
  });

  it('defense in depth: even if a plan_match_ambiguous row somehow reached the response, its summary must never carry raw JSON/internal codes', async () => {
    const res = await GET(getReq());
    const body = await res.json();
    const ambiguous = body.rows.find((r: { reason: string }) => r.reason === 'plan_match_ambiguous');
    // Primary expectation is Option B (row absent, asserted above). This
    // second assertion is a belt-and-suspenders check on the narration
    // itself, so a future regression that re-includes the reason without
    // restoring a narration still fails loudly instead of silently
    // reprinting raw JSON.
    if (ambiguous) {
      expect(ambiguous.summary).not.toMatch(/ambiguous-plan-day-match/);
      expect(ambiguous.summary).not.toMatch(/day-abc123/);
      expect(ambiguous.summary).not.toMatch(/[{}[\]"]/);
    }
  });

  it('does not change the query text used for unacked_only (state-loader.ts is a separate file and separate query, untouched by this fix)', async () => {
    await GET(new NextRequest('https://x/api/coach/intents?unacked_only=true'));
    const [sql] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('acknowledged_at IS NULL');
  });
});
