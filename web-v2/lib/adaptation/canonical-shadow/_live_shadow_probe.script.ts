/**
 * SHADOWOBS-1 · THE PROBE. What would the canonical shadow evaluation do,
 * RIGHT NOW, for every runner the `run-adaptations` cron loops over?
 *
 * NOT part of `npm test` — `vitest.config.ts`'s `include` does not match
 * `*.script.ts`. Run it deliberately:
 *
 *   npx vitest run --config vitest.probe.config.ts --disable-console-intercept
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * On 2026-09-05 the question "why did canonical shadow stop after 9/3" could
 * not be answered from inside the app. The mechanism reported its outcome to
 * `console.warn` on Railway, so the only observation available was the ABSENCE
 * of rows — which is consistent with a broken connection, a runner with no
 * plan, a missing migration and a cron that never fired, all at once.
 *
 * `shadow-exit.ts` fixes that going forward. This file is how you look TODAY,
 * against real production data, without waiting for a cron cycle. Rule 13's
 * discipline applied to a backend mechanism: observe the real thing with the
 * real account's data, never a fixture.
 *
 * ── IT CANNOT WRITE ───────────────────────────────────────────────────────
 *
 * Reads go over the fenced `DATABASE_URL_RO` connection. The one INSERT the
 * evaluation performs goes through `lib/db/pool`, which `vitest.setup.ts`
 * arms the write barrier against — so under this runner a persist attempt is
 * REFUSED and surfaces as `PERSISTENCE_FAILED`. That is the correct and
 * expected outcome here, and it is worth knowing: seeing `PERSISTENCE_FAILED`
 * from this probe means the evaluation got all the way to the write.
 *
 * ── WHAT IT CANNOT TELL YOU (Rule 22) ─────────────────────────────────────
 *
 *   · Whether production has `DATABASE_URL_RO`. It reads YOUR `.env.local`.
 *     Check the Railway service variables for that; it is the one fact this
 *     probe structurally cannot observe, and it was the 2026-09 cause.
 *   · Whether the cron calls the evaluation. `_shadow_exit_taxonomy.test.ts`
 *     guard 7 gates the mount from source.
 *   · Whether any decision it prints is CORRECT. It reports what the engine
 *     said, not whether the engine was right.
 */
import { describe, it, expect } from 'vitest';

describe('canonical shadow · live probe', () => {
  it('reports the exit for every athlete the cron would loop over', async () => {
    const { Pool } = await import('pg');
    expect(
      process.env.DATABASE_URL_RO,
      'DATABASE_URL_RO is not set in this process — the probe cannot read evidence',
    ).toBeTruthy();

    const ro = new Pool({
      connectionString: process.env.DATABASE_URL_RO,
      ssl: { rejectUnauthorized: false },
      max: 2,
    });

    // The SAME population the cron uses (Rule 14 · the query names its scope),
    // copied deliberately rather than imported, so a divergence between the
    // two shows up here as a different athlete count rather than being hidden
    // by a shared helper.
    const uids = (await ro.query<{ uid: string }>(
      `SELECT DISTINCT user_uuid::text AS uid FROM training_plans
        WHERE archived_iso IS NULL AND user_uuid IS NOT NULL ORDER BY 1`,
    )).rows.map((r) => r.uid);

    // Liveness (Rule 18) · a probe that reads zero athletes and prints nothing
    // is the worst outcome available, because it also prints no error.
    console.log(`PROBE · ${uids.length} athlete(s) with an active plan`);
    expect(uids.length, 'zero athletes — the probe read nothing').toBeGreaterThan(0);

    const { runAndPersistCanonicalShadowEvaluation } =
      await import('@/lib/adaptation/canonical-shadow/run-live-shadow-evaluation');
    const { summarisePass } = await import('@/lib/adaptation/canonical-shadow/shadow-exit');

    const exits = [];
    for (const uid of uids) {
      const r = await runAndPersistCanonicalShadowEvaluation(uid);
      exits.push(r.exit);
      console.log(`PROBE ${uid.slice(0, 8)} · ${r.exit.code} (${r.exit.health}) · `
        + `evaluated ${r.exit.recordsEvaluated} · persisted ${r.exit.recordsPersisted} · ${r.detail}`);
      if (r.records.length > 0) {
        console.log(`         levers: ${r.records.map((x) => `${x.lever}=${x.decision}`).join(' ')}`);
      }
    }

    const pass = summarisePass(exits);
    console.log(`PROBE VERDICT · ${pass.severity} · ${pass.message}`);
    console.log(`PROBE HISTOGRAM · ${JSON.stringify(pass.byCode)}`);

    await ro.end();
  }, 300_000);
});
