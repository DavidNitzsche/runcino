/**
 * lib/training/_threshold_owner_census.audit.test.ts · THE CENSUS.
 *
 * Rule 13: a claim about what the runner's threshold IS gets measured against
 * the real account, not read out of the code. `_threshold_owner_scan.test.ts`
 * answers "how many places CAN answer this question"; this file answers "and
 * what do they each say TODAY", which is the only form in which a divergence
 * is a number rather than an argument.
 *
 * It is an `.audit.` file on purpose (the convention `_capacity_resolver.
 * audit.test.ts` set): it needs `DATABASE_URL_RO`, it skips without one, and
 * CI never depends on a database. READ-ONLY is enforced rather than assumed —
 * `DATABASE_URL` is overridden onto the read-only role BEFORE `lib/db/pool`'s
 * module-level `new Pool(...)` runs, which is why every app import below is
 * DYNAMIC. A static top-level import would be hoisted ahead of the override.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 *   · IT CANNOT FAIL ON A DIVERGENCE. It is a RENDER, not a gate. Its only
 *     hard assertions are that the canonical owner resolved at all and that
 *     the prescription layer did not alter the number it carries. Two owners
 *     40 s/mi apart PRINT here and the file still passes, because a census
 *     that refused to report would report nothing. The ratchet that fails on
 *     a NEW owner is `_threshold_owner_scan.test.ts`, and it is a text scan.
 *   · IT MEASURES ONE ACCOUNT. Every number below is the owner's. A second
 *     owner that agrees with the canonical on this runner and diverges on a
 *     cold-start runner reads clean here.
 *   · IT CANNOT SEE A COLD-START OWNER AT ALL. `persistMaintenancePlan`
 *     answers inside the onboarding transaction for a user with no rows; this
 *     account has years of rows, so the seeder's rung is reconstructed from
 *     the same inputs rather than observed. That reconstruction is labelled
 *     as such in the output and is a claim, not a measurement.
 *   · IT CANNOT TELL WHETHER THE CANONICAL NUMBER IS RIGHT. Every owner could
 *     agree on a wrong pace and this prints a clean table.
 *
 * Run with:
 *   npx vitest run lib/training/_threshold_owner_census.audit.test.ts
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

/** Fixed so a re-run a week later is comparable. A stale anchor only narrows
 *  the lookback window; it never invalidates the read. */
const TODAY = '2026-09-05';

function mmss(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '     —';
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${String(m)}:${String(r).padStart(2, '0')}/mi`;
}

interface Row {
  owner: string;
  site: string;
  value: number | null;
  note: string;
}

describe.skipIf(!RO)('THRESHOLD CENSUS · every live owner, on the real account', () => {
  it('measures what each site says the threshold is', async () => {
    process.env.DATABASE_URL = RO;

    const rows: Row[] = [];

    /* ── 1 · THE CANONICAL OWNER ─────────────────────────────────────────── */
    const { resolveThresholdCapacity } = await import('@/lib/training/capacity-resolver');
    const canonical = await resolveThresholdCapacity(OWNER, TODAY);
    rows.push({
      owner: 'resolveThresholdCapacity',
      site: 'lib/training/capacity-resolver.ts:1543',
      value: canonical.paceSecPerMi,
      note: `CANONICAL · ${canonical.sourceMode} · conf ${canonical.confidence.toFixed(2)}`
        + ` · ${canonical.evidenceIds.length} evidence ids`,
    });

    /* ── 2 · THE PRESCRIPTION LAYER (must carry, never transform) ────────── */
    const { resolvePrescribedPaceAnchors } = await import('@/lib/training/load-prescription-anchors');
    const anchorRead = await resolvePrescribedPaceAnchors(OWNER, TODAY);
    // The refusal branch carries no `anchors`, so this cannot be read past
    // without branching — the property that makes Rule 11 a type error here.
    const prescribed = anchorRead.ok ? anchorRead.anchors.thresholdSecPerMi : null;
    rows.push({
      owner: 'resolvePrescribedPaceAnchors',
      site: 'lib/training/load-prescription-anchors.ts:81',
      value: prescribed,
      note: 'consumes the canonical · must be byte-equal',
    });

    /* ── 3 · THE LEGACY CASCADE, standing alone ──────────────────────────── */
    // Reconstructed the way `composeThresholdCapacity` calls it: the measured
    // VDOT rung. This is what the app answered with before the resolver
    // existed, and it survives as rungs 2-4 INSIDE the canonical owner.
    const { tPaceFromVdot } = await import('@/lib/training/vdot');
    const { resolveThresholdVdot } = await import('@/lib/training/load-prescription-anchors');
    const canonVdot = await resolveThresholdVdot(OWNER, TODAY);
    rows.push({
      owner: 'tPaceFromVdot(canonical vdot)',
      site: 'lib/training/vdot.ts:492',
      value: canonVdot != null ? tPaceFromVdot(canonVdot) : null,
      note: `the Daniels T column at the canonical's OWN derived vdot ${canonVdot ?? '—'}`
        + ' · a projection of the belief, not a second belief',
    });

    /* ── 4 · GOAL-PROJECTION's TWO FORMER SITES ─────────────────────────── */
    // BEFORE THRESHOLD-OWNER-2 both derived a threshold from a snapshot VDOT
    // threaded in by the caller. The snapshot VDOT is still read here — but
    // now as the COUNTERFACTUAL, so the row shows what the sites WOULD have
    // said and what they say instead. A census that stopped measuring a
    // divergence the moment it was closed could not prove it stayed closed.
    const { pool } = await import('@/lib/db/pool');
    // THE READ IS NOT ALLOWED TO SWALLOW (Rule 11). A failed query and an
    // account with no snapshot are different facts, and a census that printed
    // "—" for both would be reporting its own bug as the engine's silence.
    // This is not hypothetical: the first run of this file printed "—" on
    // three rows and 0.0 mi/wk on a fourth, all of them my own broken SQL.
    let snapshotVdot: number | null = null;
    let snapshotWhy = '';
    try {
      const snap = await pool.query<{ vdot: string | null; d: string | null }>(
        `SELECT vdot::text AS vdot, snapshot_date::text AS d FROM projection_snapshots
          WHERE user_uuid = $1::uuid AND vdot IS NOT NULL
          ORDER BY snapshot_date DESC LIMIT 1`,
        [OWNER],
      );
      if (snap.rows.length === 0) snapshotWhy = 'ABSENT · no projection snapshot carries a vdot';
      else { snapshotVdot = Number(snap.rows[0].vdot); snapshotWhy = `snapshot ${snap.rows[0].d}`; }
    } catch (e) {
      snapshotWhy = `READ FAILED · ${(e as Error).message}`;
    }

    // What the two sites say NOW: both read the canonical, so both are the
    // canonical. Read through the real seam rather than restated.
    rows.push({
      owner: 'goal-projection pass bar (T)',
      site: 'lib/training/goal-projection.ts:956',
      value: prescribed,
      note: `reads resolvePrescribedPaceAnchors · pass bar T+10 = ${prescribed != null ? prescribed + 10 : '—'}`
        + ` · was tPaceFromVdot(${snapshotVdot ?? '—'}) = ${snapshotVdot != null ? tPaceFromVdot(snapshotVdot) : '—'}`,
    });

    const { easyPaceForBlend } = await import('@/lib/training/goal-projection');
    const easy = easyPaceForBlend(prescribed, 'tempo', null);
    rows.push({
      owner: 'goal-projection easyPaceForBlend',
      site: 'lib/training/goal-projection.ts:1202',
      // The easy band is T + 100; report the T it implies so the column is
      // comparable with every other row rather than 100 s/mi off.
      value: easy != null ? easy - 100 : null,
      note: `easy band ${mmss(easy)} = T + 100 · takes the canonical threshold`
        + ` as its first parameter (${snapshotWhy})`,
    });

    /* ── 5 · THE PERSISTED PLAN VALUE (Rule 10) ──────────────────────────── */
    // Rule 14: the population is the ACTIVE plan, which this schema spells
    // `archived_iso IS NULL` — a join on user_uuid alone reads every archived
    // version of the block.
    let persisted: number | null = null;
    let persistedWhy = '';
    try {
      const planRow = await pool.query<{ id: string; t: string | null; d: string | null }>(
        `SELECT id::text,
                COALESCE(authored_state->>'t_pace_s_per_mi', authored_state->>'tPaceSPerMi') AS t,
                to_char(authored_iso, 'YYYY-MM-DD') AS d
           FROM training_plans
          WHERE user_uuid = $1::uuid AND archived_iso IS NULL
          ORDER BY authored_iso DESC LIMIT 1`,
        [OWNER],
      );
      if (planRow.rows.length === 0) persistedWhy = 'ABSENT · no active plan';
      else if (planRow.rows[0].t == null) persistedWhy = 'ABSENT · the active plan stamps no t_pace';
      else { persisted = Number(planRow.rows[0].t); persistedWhy = `frozen at authoring ${planRow.rows[0].d}`; }
    } catch (e) {
      persistedWhy = `READ FAILED · ${(e as Error).message}`;
    }
    rows.push({
      owner: 'authored_state.t_pace_s_per_mi',
      site: 'lib/adaptation/canonical-shadow/live-input.ts:788',
      value: persisted,
      note: `${persistedWhy} · the canonical shadow reads this as "belief"`,
    });

    /* ── 6 · THE COLD-START SEEDER, reconstructed ────────────────────────── */
    // NOT a measurement — see the Rule 22 note. `persistMaintenancePlan`
    // prices for a runner with no rows, and this account has years of them,
    // so what is printed is what the seeder WOULD say today. Since
    // THRESHOLD-OWNER-2 it says it by calling the canonical ladder's own
    // cold-start rung rather than by pricing its own threshold.
    const { coldStartThresholdCapacity } = await import('@/lib/training/capacity-resolver');
    const wk = await pool.query<{ mi: string | null }>(
      `SELECT (COALESCE(SUM((data->>'distanceMi')::numeric), 0) / 4.0)::text AS mi
         FROM runs
        WHERE user_uuid = $1::uuid
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'date') >= to_char($2::date - 28, 'YYYY-MM-DD')
          AND (data->>'date') <= $2::text`,
      [OWNER, TODAY],
    );
    const weeklyMi = wk.rows[0]?.mi != null ? Number(wk.rows[0].mi) : 0;
    // The seeder's own two inputs: a measured VDOT when a backfill produced
    // one (this runner has one), and the onboarding self-report otherwise.
    const cold = coldStartThresholdCapacity({
      measuredVdot: canonVdot,
      measuredVdotSource: 'run',
      selfReportedWeeklyMi: weeklyMi,
      todayISO: TODAY,
    });
    rows.push({
      owner: 'seeder cold start (reconstructed)',
      site: 'lib/plan/seed-from-onboarding.ts:574',
      value: cold.paceSecPerMi,
      note: `coldStartThresholdCapacity · ${cold.sourceMode} · conf ${cold.confidence.toFixed(2)}`
        + ` · off ${weeklyMi.toFixed(1)} mi/wk · reconstructed, not observed`,
    });

    // AND the counterfactual: what the deleted arithmetic would have said for
    // a runner with NO measured vdot, which is the ordinary cold start and the
    // case the 472 came from. Printed so the closed gap stays visible.
    const coldNoVdot = coldStartThresholdCapacity({
      measuredVdot: null,
      selfReportedWeeklyMi: weeklyMi,
      todayISO: TODAY,
    });
    const { conservativeVdotFromMileage } = await import('@/lib/plan/spec-builder');
    const wasT = tPaceFromVdot(conservativeVdotFromMileage(weeklyMi)) ?? 480;
    rows.push({
      owner: 'seeder cold start · NO measured vdot',
      site: 'lib/plan/seed-from-onboarding.ts:574',
      value: coldNoVdot.paceSecPerMi,
      note: `${coldNoVdot.sourceMode} · conf ${coldNoVdot.confidence.toFixed(2)}`
        + ` · the DELETED arithmetic said ${wasT} here`,
    });

    /* ── PRINT ───────────────────────────────────────────────────────────── */
    const vals = rows.map((r) => r.value).filter((v): v is number => v != null);
    const spread = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;

    const out: string[] = [];
    out.push('');
    out.push('╔══════════════════════════════════════════════════════════════════════════════╗');
    out.push(`║ THRESHOLD OWNER CENSUS · owner account · ${TODAY}                          ║`);
    out.push('╚══════════════════════════════════════════════════════════════════════════════╝');
    out.push('');
    for (const r of rows) {
      out.push(`  ${r.owner.padEnd(40)} ${String(r.value ?? '—').padStart(5)} s/mi  ${mmss(r.value)}`);
      out.push(`  ${' '.repeat(40)} ${r.site}`);
      out.push(`  ${' '.repeat(40)} ${r.note}`);
      out.push('');
    }
    out.push(`  DISTINCT VALUES : ${[...new Set(vals)].sort((a, b) => a - b).join(', ')}`);
    out.push(`  WIDEST PAIR     : ${spread} s/mi`);
    out.push('');
    const fs = await import('node:fs');
    const dest = process.env.CENSUS_OUT ?? '/tmp/threshold-census.txt';
    fs.writeFileSync(dest, out.join('\n'));
    // eslint-disable-next-line no-console
    console.log(out.join('\n'));

    /* ── THE ONLY HARD ASSERTIONS ────────────────────────────────────────── */
    // The canonical owner resolved at all.
    expect(canonical.paceSecPerMi, 'the canonical owner produced no threshold').toBeGreaterThan(0);
    // The prescription layer CARRIES the belief and does not transform it.
    // This is the load-bearing one: a wrapping layer that quietly changes the
    // number it exists to carry is a second owner wearing the first's name.
    expect(prescribed, 'the prescription layer altered the canonical threshold')
      .toBe(canonical.paceSecPerMi);
  }, 120_000);
});
