/**
 * lib/plan/_recompute_paces.audit.test.ts · THE BEFORE/AFTER, ON REAL DATA.
 *
 * Rule 13: "a fix to something the runner sees is verified by RENDERING it,
 * with real data ... not against a sample fixture, not by asserting the absence
 * of the bad thing." The runner-facing artefact of PRESCRIPTION-WIRE-1 is a
 * `plan_workouts` row — the number his phone and his watch read off — so the
 * render is: build the exact spec the live path will write, for every real row
 * of his real block, and print it beside what is stored today.
 *
 * ── WHAT MAKES THIS THE REAL PATH AND NOT A MODEL OF IT ─────────────────────
 *
 * It calls `resolvePrescribedPaceAnchors` and `buildWorkoutSpec` — the same two
 * functions `recomputePacesForPlan` calls, in the same order, with the same
 * arguments — against the same account. Nothing here reimplements a derivation.
 * If this file and the live path ever disagree it is because someone changed
 * one of the two, which is exactly the failure the file exists to catch.
 *
 * ── READ-ONLY, AND ENFORCED ────────────────────────────────────────────────
 *
 * `process.env.DATABASE_URL` is overridden onto the read-only role BEFORE
 * `lib/db/pool`'s module-level `new Pool(...)` is constructed, which is why
 * every app module below is imported DYNAMICALLY inside the test body. A static
 * top-level import would hoist ahead of the override. Same convention as
 * `_prescription_resolver.audit.test.ts`, and the `.audit.` name keeps it out of
 * the CI gate chain.
 *
 *   npx vitest run lib/plan/_recompute_paces.audit.test.ts --disable-console-intercept
 *
 * ── RULE 22 · WHAT THIS CANNOT FAIL ON ─────────────────────────────────────
 *
 *   · IT READS ONE ACCOUNT. Every number is one runner's. Nothing generalises.
 *   · IT CANNOT TELL A GOOD ANCHOR FROM A BAD ONE. It checks the ORDER of the
 *     paces on each row and the coherence of the set; a set uniformly 90 s/mi
 *     too slow is perfectly ordered and passes.
 *   · IT DOES NOT WRITE. It cannot catch a defect in the UPDATE statements, the
 *     seal predicate or the mutation boundary — those are exercised by actually
 *     running the recompute and reading the rows back, which is a separate step
 *     and was performed.
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = '2026-08-31';

const pace = (s: number | null | undefined): string => {
  if (s == null || !Number.isFinite(s)) return '   -   ';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}/mi`;
};
const delta = (a: number | null, b: number | null): string => {
  if (a == null || b == null) return '      -';
  const d = Math.round(b - a);
  return `${d > 0 ? '+' : ''}${d} s/mi`;
};
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));

describe.skipIf(!RO)('RECOMPUTE PACES · the exact before/after on the owner\'s live block', () => {
  it('builds every real row through the wired path and reports the change', async () => {
    process.env.DATABASE_URL = RO;

    const { pool } = await import('@/lib/db/pool');
    const { resolvePrescribedPaceAnchors } = await import('@/lib/training/load-prescription-anchors');
    const { buildWorkoutSpec } = await import('./spec-builder');
    const { loadEffectiveMaxHr } = await import('@/lib/training/max-hr');

    /* ── 1 · THE ACTIVE PLAN · resolved, never assumed (Rule 14) ──────────── */
    const plan = (await pool.query<{ id: string; mode: string; race_id: string | null }>(
      `SELECT id, mode, race_id
         FROM training_plans
        WHERE user_uuid = $1::uuid AND archived_iso IS NULL
        ORDER BY authored_iso DESC LIMIT 1`,
      [OWNER],
    )).rows[0];
    expect(plan).toBeTruthy();

    /* ── 2 · THE ANCHORS · the exact call the live path makes ─────────────── */
    const read = await resolvePrescribedPaceAnchors(OWNER, TODAY);
    if (!read.ok) throw new Error(`anchors refused: ${read.reason} · ${read.detail}`);
    const a = read.anchors;

    /* ── 3 · THE HR ANCHORS · the exact reads the live path makes ─────────── */
    const lthr = (await pool.query<{ lthr: number | null }>(
      `SELECT lthr FROM profile WHERE user_uuid = $1 LIMIT 1`, [OWNER],
    )).rows[0]?.lthr ?? null;
    const maxHr = (await loadEffectiveMaxHr(OWNER, TODAY)).bpm;

    /* ── 4 · THE ROWS THE RECOMPUTE WOULD TOUCH ───────────────────────────── */
    const EXEMPT = ['rest', 'cross', 'strength', 'race', 'race_week_tuneup'];
    const rows = (await pool.query<{
      date_iso: string; type: string; distance_mi: string | null; sub_label: string | null;
      pace_target_s_per_mi: number | null; workout_spec: Record<string, unknown> | null;
      sealed: boolean;
    }>(
      `SELECT pw.date_iso::text AS date_iso, pw.type, pw.distance_mi::text AS distance_mi,
              pw.sub_label, pw.pace_target_s_per_mi, pw.workout_spec,
              EXISTS (
                SELECT 1 FROM runs r
                 WHERE r.user_uuid = $2::uuid
                   AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
                   AND NOT (r.data ? 'mergedIntoId')
              ) AS sealed
         FROM plan_workouts pw
        WHERE pw.plan_id = $1
          AND pw.date_iso::date >= $3::date
          AND pw.type <> ALL($4::text[])
        ORDER BY pw.date_iso::date ASC`,
      [plan.id, OWNER, TODAY, EXEMPT],
    )).rows;
    expect(rows.length).toBeGreaterThan(0);

    /* eslint-disable no-console */
    console.log('\n' + '═'.repeat(118));
    console.log(`RECOMPUTE DRY RUN · plan ${plan.id} · mode=${plan.mode} · race=${plan.race_id} · today=${TODAY}`);
    console.log('═'.repeat(118));
    console.log('\n── THE ANCHORS THIS RUN WOULD PRICE THE BLOCK AT ─────────────────────────');
    console.log(`  repetition (R)     ${pace(a.repetitionSecPerMi)}`);
    console.log(`  interval   (I)     ${pace(a.intervalSecPerMi)}   ${a.basis.highIntensity.sourceMode} conf=${a.basis.highIntensity.confidence.toFixed(3)}`);
    console.log(`  threshold  (T)     ${pace(a.thresholdSecPerMi)}   ${a.basis.threshold.sourceMode} conf=${a.basis.threshold.confidence.toFixed(3)} vdot=${a.basis.threshold.vdot}`);
    console.log(`  sub-threshold(ST)  ${pace(a.thresholdSecPerMi + 15)}   T + ST_OFFSET_S_PER_MI (Research/04 §"Pace zone shorthand")`);
    console.log(`  marathon   (M/MP)  ${pace(a.marathonSecPerMi)}   exponent=${a.basis.marathon.enduranceExponent.toFixed(4)} personal=${a.basis.marathon.personallyEvidenced}`);
    console.log(`  easy ceiling       ${pace(a.easyCeilingSecPerMi)}   ${a.basis.easyCeiling.sourceMode} conf=${a.basis.easyCeiling.confidence.toFixed(3)}`);
    console.log(`  shakeout ceiling   ${pace(a.shakeoutCeilingSecPerMi)}   easy + SHAKEOUT_CEILING_PAD_S_PER_MI`);
    console.log(`\n  HR anchors read live · lthr=${lthr} maxHr=${maxHr}`);

    console.log('\n── PER-DAY, THE ROWS THE RECOMPUTE WOULD REWRITE ─────────────────────────');
    console.log(`  ${pad('DATE', 11)}${pad('TYPE', 11)}${pad('SEAL', 6)}${pad('BEFORE', 20)}${pad('AFTER', 20)}${pad('DELTA', 10)}LABEL`);

    let touched = 0;
    let sealedCount = 0;
    let changed = 0;
    const findings: string[] = [];

    for (const r of rows) {
      if (r.sealed) { sealedCount++; }
      const distanceMi = r.distance_mi != null ? Number(r.distance_mi) : null;
      const built = buildWorkoutSpec(
        r.type, distanceMi, a.thresholdSecPerMi, lthr, r.sub_label, maxHr,
        null, a.intervalSecPerMi, a.thresholdSecPerMi, false, null, a,
      );

      // The number the runner reads: a quality row's headline pace, or the fast
      // edge of an easy/long/shakeout band. Same reading on both sides.
      const spec = (r.workout_spec ?? {}) as Record<string, unknown>;
      const newSpec = (built.spec ?? {}) as Record<string, unknown>;
      const before = r.pace_target_s_per_mi ?? (typeof spec.pace_target_s_per_mi_lo === 'number'
        ? spec.pace_target_s_per_mi_lo : null);
      const after = built.paceTargetSPerMi ?? (typeof newSpec.pace_target_s_per_mi_lo === 'number'
        ? newSpec.pace_target_s_per_mi_lo : null);

      const beforeStr = typeof spec.pace_target_s_per_mi_lo === 'number'
        ? `${pace(spec.pace_target_s_per_mi_lo as number)}-${pace(spec.pace_target_s_per_mi_hi as number)}`
        : pace(before);
      const afterStr = typeof newSpec.pace_target_s_per_mi_lo === 'number'
        ? `${pace(newSpec.pace_target_s_per_mi_lo as number)}-${pace(newSpec.pace_target_s_per_mi_hi as number)}`
        : pace(after);

      if (!r.sealed) touched++;
      if (before != null && after != null && Math.round(before) !== Math.round(after)) changed++;

      console.log(
        `  ${pad(r.date_iso, 11)}${pad(r.type, 11)}${pad(r.sealed ? 'SEAL' : '', 6)}` +
        `${pad(beforeStr, 20)}${pad(afterStr, 20)}${pad(delta(before, after), 10)}${r.sub_label ?? ''}`,
      );

      /* ── THE SANITY CHECKS, ON EVERY ROW ────────────────────────────────
       * Rule 13 point 3: assert the SHAPE of the result, not the absence of
       * the defect. These are the properties that would be a defect whatever
       * the numbers are, and they are what makes a red run readable. */
      const lo = typeof newSpec.pace_target_s_per_mi_lo === 'number'
        ? newSpec.pace_target_s_per_mi_lo as number : null;
      if (lo != null && lo <= a.thresholdSecPerMi) {
        findings.push(`${r.date_iso} ${r.type}: easy-family fast edge ${pace(lo)} is at or faster than threshold ${pace(a.thresholdSecPerMi)}`);
      }
      if (after != null && after <= 0) {
        findings.push(`${r.date_iso} ${r.type}: non-positive pace ${after}`);
      }
      if (built.paceTargetSPerMi != null && built.paceTargetSPerMi < a.repetitionSecPerMi!) {
        findings.push(`${r.date_iso} ${r.type}: headline pace ${pace(built.paceTargetSPerMi)} is faster than repetition capacity ${pace(a.repetitionSecPerMi)}`);
      }
      // The finish/segment paces a long run carries.
      for (const seg of (Array.isArray(newSpec.finish_segments) ? newSpec.finish_segments : []) as Array<Record<string, unknown>>) {
        const p = Number(seg.pace_s_per_mi);
        if (Number.isFinite(p) && (p < a.thresholdSecPerMi || p > a.easyCeilingSecPerMi)) {
          findings.push(`${r.date_iso} segment @ ${seg.label}: ${pace(p)} sits outside [threshold, easy ceiling]`);
        }
      }
    }

    console.log(`\n  rows in scope ${rows.length} · sealed (never touched) ${sealedCount} · would rewrite ${touched} · pace changes ${changed}`);
    if (findings.length > 0) {
      console.log('\n── SANITY FINDINGS · DO NOT APPLY ────────────────────────────────────────');
      for (const f of findings) console.log(`  ✗ ${f}`);
    } else {
      console.log('\n  no sanity findings · zone order holds on every row');
    }
    console.log('');
    /* eslint-enable no-console */

    /* ── ASSERTIONS ────────────────────────────────────────────────────────
     * Rule 18 · LIVENESS FIRST. A report that built nothing would print a
     * clean page and mean nothing. */
    expect(rows.length).toBeGreaterThan(50);
    expect(touched).toBeGreaterThan(40);
    expect(findings).toEqual([]);

    // The anchor set's own order, checked here as well as inside
    // `composePaceAnchors`, because this is the assertion a human reads.
    expect(a.repetitionSecPerMi!).toBeLessThan(a.intervalSecPerMi);
    expect(a.intervalSecPerMi).toBeLessThan(a.thresholdSecPerMi);
    expect(a.thresholdSecPerMi).toBeLessThan(a.marathonSecPerMi);
    expect(a.marathonSecPerMi).toBeLessThan(a.easyCeilingSecPerMi);
    expect(a.easyCeilingSecPerMi).toBeLessThan(a.shakeoutCeilingSecPerMi);
  }, 180_000);
});
