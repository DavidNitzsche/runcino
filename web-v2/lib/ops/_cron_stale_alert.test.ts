/**
 * lib/ops/_cron_stale_alert.test.ts · prove the staleness alert FIRES.
 *
 * Split from `_cron_ledger.test.ts` because this file mocks the database and
 * the alert dispatcher, and a suite that mocks `@/lib/db/pool` for everything
 * cannot also assert the pure arithmetic honestly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `staleness()` returning `{ state: 'stale' }` proves the arithmetic. It does
 * not prove that anything HAPPENS — and an alerting path whose first real
 * exercise is the incident it was built for is the shape CLAUDE.md Rule 20 is
 * about. `check-modelled-mark.sh` scanning zero files and reporting clean is
 * the same failure one level down.
 *
 * So this drives `raiseStaleAlert` end to end against a stubbed pool and asserts
 * on the ALERT, not on the verdict that should have caused it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CANNOT FAIL ON (Rule 22)
 *
 *   · The `ops_alerts` INSERT is mocked, so a schema mismatch — a renamed
 *     column, a CHECK constraint added to `kind` later — passes here and fails
 *     in production. `raiseAlert` swallows its own insert failure by design
 *     (alerts.ts), so that failure would be silent. Verified by hand against
 *     production instead: `ops_alerts.kind` is plain `text` with no CHECK
 *     constraint (pg_constraint, 2026-08-30).
 *   · It cannot prove the Slack webhook delivers; `OPS_SLACK_WEBHOOK_URL` is
 *     unset in this environment and the dispatch is best-effort either way.
 *   · Both directions ARE asserted here — that it fires when stale AND that it
 *     stays quiet when healthy. The second is the one a suite written by
 *     somebody worried about missed alerts would forget, and a check that can
 *     only ever say "yes" is not a check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db/pool', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

const raised: Array<Record<string, unknown>> = [];
vi.mock('@/lib/ops/alerts', () => ({
  raiseAlert: async (input: Record<string, unknown>) => { raised.push(input); },
}));

const { cronJob, raiseStaleAlert, staleness, stalenessIsAlertable } =
  await import('./cron-ledger');

const job = cronJob('run-adaptations')!;
const now = new Date('2026-08-30T20:00:00Z');

/** No prior `cron_stale` row within the cooldown, so an alert may be written. */
const noCooldownRow = () => query.mockResolvedValue({ rows: [], rowCount: 0 });

beforeEach(() => {
  raised.length = 0;
  query.mockReset();
});

describe('raiseStaleAlert', () => {
  it('FIRES on a job that has stopped running, at error severity', async () => {
    noCooldownRow();
    const s = staleness(now, job, { state: 'ran', at: new Date('2026-08-28T15:08:00Z') });
    expect(s.state).toBe('stale');

    const wrote = await raiseStaleAlert(job, s);

    expect(wrote).toBe(true);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      kind: 'cron_stale',
      severity: 'error',
      source: 'cron/run-adaptations',
    });
    // The message has to carry the number a human needs, not just a label.
    expect(String(raised[0].message)).toMatch(/run-adaptations/);
    expect(String(raised[0].message)).toMatch(/last completed .*h ago, budget 30h/);
    expect(raised[0].metadata).toMatchObject({ job: 'run-adaptations', state: 'stale' });
  });

  it('FIRES on a job with no recorded completion at all, at warn', async () => {
    // The state reachable on the first deploy, and therefore the one that gives
    // this alerting path its first live exercise rather than its first
    // untested one.
    noCooldownRow();
    const s = staleness(now, job, { state: 'never' });

    expect(await raiseStaleAlert(job, s)).toBe(true);
    expect(raised[0]).toMatchObject({ kind: 'cron_stale', severity: 'warn' });
    expect(String(raised[0].message)).toMatch(/no recorded successful completion at all/);
  });

  it('FIRES on an unreadable ledger, at warn, and says so is not the job\'s fault', async () => {
    noCooldownRow();
    const s = staleness(now, job, { state: 'read_failed', error: 'connection terminated' });

    expect(await raiseStaleAlert(job, s)).toBe(true);
    expect(raised[0]).toMatchObject({ severity: 'warn' });
    expect(String(raised[0].message)).toMatch(/health is unknown/);
  });

  it('STAYS QUIET on a healthy job', async () => {
    // The other direction. A stale-alerter that fires on everything is as
    // useless as one that fires on nothing, and after a week of noise it is
    // worse, because it teaches the reader to skip the row.
    noCooldownRow();
    const s = staleness(now, job, { state: 'ran', at: new Date('2026-08-30T15:08:00Z') });
    expect(s.state).toBe('ok');
    expect(stalenessIsAlertable(s)).toBe(false);
  });

  it('the tick\'s alertability predicate covers all three bad states', () => {
    // FOUND BY FALSIFYING THIS FILE. Narrowing `stalenessIsAlertable` to
    // `s.state === 'stale'` alone left all six tests above GREEN, because each
    // "FIRES" case calls `raiseStaleAlert` directly and never asks the
    // predicate the TICK actually consults. So the one line that decides
    // whether an alert is attempted at all was, until this assertion, gated by
    // nothing — a `never_run` job and an unreadable ledger would both have gone
    // silent with a full-green suite. Rule 18: the gate has to be made to fail
    // before it is worth anything, and this is the failure it produced.
    expect(stalenessIsAlertable({ state: 'stale', ageHours: 50 })).toBe(true);
    expect(stalenessIsAlertable({ state: 'never_run' })).toBe(true);
    expect(stalenessIsAlertable({ state: 'unknown' })).toBe(true);
    expect(stalenessIsAlertable({ state: 'ok', ageHours: 1 })).toBe(false);
  });

  it('STAYS QUIET while an identical alert is inside the cooldown', async () => {
    // A job dead for a week must produce a handful of rows, not one every five
    // minutes — an alert surface nobody can read is an alert surface nobody
    // reads.
    query.mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 });
    const s = staleness(now, job, { state: 'ran', at: new Date('2026-08-28T15:08:00Z') });

    expect(await raiseStaleAlert(job, s)).toBe(false);
    expect(raised).toHaveLength(0);
  });

  it('STAYS QUIET when the cooldown check itself could not be read', async () => {
    // Fails closed in the quiet direction, deliberately: a dedupe guard that
    // cannot see must not mint a duplicate on every tick. The staleness is
    // still reported in the tick's response body, so the FACT does not vanish
    // with the row — which is the only reason this direction is acceptable.
    query.mockRejectedValue(Object.assign(new Error('connection terminated'), { code: '08006' }));
    const s = staleness(now, job, { state: 'ran', at: new Date('2026-08-28T15:08:00Z') });

    expect(await raiseStaleAlert(job, s)).toBe(false);
    expect(raised).toHaveLength(0);
  });
});
