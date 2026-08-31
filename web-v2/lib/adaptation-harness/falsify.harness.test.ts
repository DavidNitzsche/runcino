/**
 * lib/adaptation-harness/falsify.harness.test.ts · make the harness fail.
 *
 * CLAUDE.md Rule 18: "A gate is not trusted until it has been made to fail."
 * This project has shipped a gate that created the tree it audited, a tamper
 * check any comment satisfied, a doctrine claim whose exemption switched the
 * assertion off, and a scrub test that passed while corrupting its own input.
 * Every one of them reported clean, which is worse than reporting nothing,
 * because it also reported confidence.
 *
 * So each scenario in `worlds.harness.test.ts` has a sibling here that BREAKS
 * the mechanism on purpose and asserts the observable moves the other way —
 * and, where the harness names a mechanism, that it names the right one.
 *
 * Read this file as the answer to "how do you know the green run means
 * anything". Every assertion below is a green check being driven red.
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  assertHarnessDatabase, inspectConnectionString, OWNER_UUID, HARNESS_DB_NAME,
} from './fence';

assertHarnessDatabase();

import {
  resetToBase, shiftRealBlockOntoToday, plusDays, degradeReadinessSignals,
} from './substrate';
import { rampDiagnosis, bump, repaceTo, detect } from './drive';
import { seeWeek, fingerprint, adaptationVerbTableMatchesComponent } from './observe';

afterAll(async () => {
  const { pool } = await import('@/lib/db/pool');
  await pool.end().catch(() => {});
});

describe('FALSIFIER · the fence refuses', () => {
  it('refuses a production connection string, and accepts only its own database', () => {
    // The real production host, from web-v2/.env.local. No credentials here —
    // the shape is what the fence judges.
    const prod = inspectConnectionString('postgresql://u:p@crossover.proxy.rlwy.net:20769/railway');
    expect(prod.ok, 'the fence accepted a production URL').toBe(false);
    expect(prod.refusal).toMatch(/not loopback/);

    // Local is not sufficient. The harness truncates and rewrites every table
    // it touches, so it must own the database by name.
    const sandbox = inspectConnectionString('postgresql://localhost:5432/faff_sandbox');
    expect(sandbox.ok, 'the fence accepted the sandbox database').toBe(false);
    expect(sandbox.refusal).toMatch(/not '.*'/);

    const missing = inspectConnectionString(undefined);
    expect(missing.ok).toBe(false);
    expect(missing.refusal).toMatch(/not set/);

    // And it does accept the one it owns, so the refusals above are a fence
    // and not a function that says no to everything.
    expect(inspectConnectionString(`postgresql://localhost:5432/${HARNESS_DB_NAME}`).ok).toBe(true);
  });

  it('throws rather than degrading when pointed somewhere else', () => {
    expect(() => assertHarnessDatabase('postgresql://u:p@crossover.proxy.rlwy.net:20769/railway'))
      .toThrow(/REFUSING TO RUN/);
  });
});

describe('FALSIFIER · the observable mirror', () => {
  it('reports a stale mirror rather than passing on an unreadable component', () => {
    const broken = adaptationVerbTableMatchesComponent('/nonexistent-repo-root');
    expect(broken.ok, 'the mirror check passed against a file it could not read').toBe(false);
    expect(broken.detail).toMatch(/cannot read/);
  });
});

describe('FALSIFIER · world 1 · the sealed-day check can go red', () => {
  it('detects a rewritten past day', async () => {
    await resetToBase();
    const sub = await shiftRealBlockOntoToday();
    const from = plusDays(sub.todayISO, -14);
    const to = plusDays(sub.todayISO, -1);

    const before = fingerprint(await seeWeek(sub.planId, from, to));

    // Break it: rewrite a day the runner has already run. This is exactly the
    // mutation `w1.sealed-days-stay-sealed` claims cannot happen.
    const { pool } = await import('@/lib/db/pool');
    const victim = (await pool.query<{ id: string }>(
      `SELECT id::text FROM plan_workouts
        WHERE plan_id = $1 AND date_iso >= $2 AND date_iso <= $3 AND distance_mi > 1
        ORDER BY date_iso DESC LIMIT 1`,
      [sub.planId, from, to],
    )).rows[0];
    expect(victim, 'no past day to rewrite — the falsifier could not be posed').toBeTruthy();
    await pool.query(`UPDATE plan_workouts SET distance_mi = distance_mi + 3 WHERE id = $1`, [victim.id]);

    const after = fingerprint(await seeWeek(sub.planId, from, to));
    expect(after, 'the sealed-day fingerprint did not notice a rewritten past day').not.toBe(before);
  });
});

describe('FALSIFIER · world 3 · the volume-ramp check can go red, and names the gate', () => {
  it('goes red with the tier ceiling removed, and blames belowTierUpper', async () => {
    await resetToBase();
    const sub = await shiftRealBlockOntoToday();

    // Make the runner green the way world 3 does, so the ONLY difference
    // between this run and the passing one is the break.
    const { pool } = await import('@/lib/db/pool');
    await pool.query(
      `DELETE FROM coach_intents
        WHERE COALESCE(user_uuid, user_id) = $1::uuid AND ts >= NOW() - interval '7 days'
          AND reason IN ('plan_adapt_downgrade','plan_adapt_shave',
                         'readiness_convergence_red_no_quality','readiness_convergence_red_proposed')`,
      [OWNER_UUID],
    );

    // Break it: take the tier bands off the plan. This is the exact shape of
    // the owner's LIVE recovery block, which world 0 reports on — so this
    // falsifier is also a rehearsal of the state production is in tonight.
    await pool.query(
      `UPDATE training_plans
          SET authored_state = authored_state - 'tier_peak_weekly_band' - 'tier_peak_long_band'
        WHERE id = $1`,
      [sub.planId],
    );

    const diag = await rampDiagnosis();
    expect(diag.blockedBy, 'removing the tier ceiling did not shut the headroom gate')
      .toContain('belowTierUpper');
    expect(await bump(false), 'the ramp fired with no tier ceiling to measure headroom against').toBeNull();
  });

  it('goes red when a pull-back stands inside the 48-hour window', async () => {
    await resetToBase();
    const sub = await shiftRealBlockOntoToday();
    const { pool } = await import('@/lib/db/pool');

    // Break it: record an applied downgrade an hour ago. Doctrine's hard-easy
    // principle says the plan must not add load into the window a pull-back
    // just opened, and `PULLBACK_BUMP_LOOKBACK_HOURS` is how that is enforced.
    await pool.query(
      `INSERT INTO coach_intents (user_uuid, user_id, reason, field, value, ts)
       VALUES ($1::uuid, $1::uuid, 'plan_adapt_downgrade', 'falsifier',
               '{"why":"falsifier"}', NOW() - interval '1 hour')`,
      [OWNER_UUID],
    );
    expect(await bump(false), 'the ramp pushed load up one hour after a pull-back').toBeNull();
    expect(sub.planId).toBeTruthy();
  });
});

describe('FALSIFIER · world 3 · the pace check can go red', () => {
  it('finds nothing faster when the anchor moves DOWN', async () => {
    await resetToBase();
    const sub = await shiftRealBlockOntoToday();
    const { pool } = await import('@/lib/db/pool');
    const anchor = Number((await pool.query<{ v: string | null }>(
      `SELECT vdot::text AS v FROM projection_snapshots
        WHERE user_uuid = $1::uuid AND vdot IS NOT NULL ORDER BY snapshot_date DESC LIMIT 1`,
      [OWNER_UUID],
    )).rows[0]?.v ?? 0);

    await repaceTo(sub.planId, anchor);
    const before = await seeWeek(sub.planId, sub.todayISO, plusDays(sub.todayISO, 21));
    // Break it: re-anchor DOWN. The check asserts "faster"; a downward move
    // must not satisfy it, or the check is really asserting "something changed".
    await repaceTo(sub.planId, anchor - 3);
    const after = await seeWeek(sub.planId, sub.todayISO, plusDays(sub.todayISO, 21));

    const paced = before.filter((b) => b.paceTargetSPerMi != null);
    const faster = paced.filter((b) => {
      const a = after.find((x) => x.workoutId === b.workoutId);
      return a?.paceTargetSPerMi != null && a.paceTargetSPerMi < b.paceTargetSPerMi! - 0.5;
    });
    expect(paced.length, 'no paced days to compare — the falsifier could not be posed').toBeGreaterThan(0);
    expect(faster.length, 'a DOWNWARD re-anchor satisfied the "paces got harder" check').toBe(0);
  });
});

describe('FALSIFIER · world 2 · the readiness check discriminates', () => {
  it('does not fire a pull-back on an untouched week', async () => {
    await resetToBase();
    await shiftRealBlockOntoToday();
    // No `degradeReadinessSignals` call. If a pull-back fires anyway, world 2's
    // readiness scenario proves nothing — it would be reporting a trigger the
    // runner's own untouched data produces.
    const { triggers } = await detect();
    expect(
      triggers.map((t) => t.kind),
      'readiness_pullback fired on an UNTOUCHED week, so world 2 was never measuring the degradation',
    ).not.toContain('readiness_pullback');
  });

  it('fires once the biometrics are moved, and only then', async () => {
    await resetToBase();
    const sub = await shiftRealBlockOntoToday();
    const moved = await degradeReadinessSignals(7, sub.todayISO);
    expect(moved, 'no readings were moved, so the scenario was not posed').toBeGreaterThan(0);
    const { triggers } = await detect();
    expect(triggers.map((t) => t.kind)).toContain('readiness_pullback');
  });
});
