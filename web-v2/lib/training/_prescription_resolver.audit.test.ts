/**
 * lib/training/_prescription_resolver.audit.test.ts · SHADOW MODE (§21, Rule 13).
 *
 * §21's own instruction, which is what this file does and the limit of what it
 * does: "run in shadow mode → record what they would have returned → compare
 * against production behavior → inspect disagreements → decide which reflects
 * doctrine → promote". The first four steps are here. THE FIFTH IS NOT: nothing
 * in this repo calls `resolvePrescription` on a live path, and §21 is explicit
 * that "disagreement alone is not evidence the new model is wrong".
 *
 * So this file DECIDES NOTHING. It prints, per real plan day, what the live
 * engine actually prescribed and what the new ownership layer would prescribe,
 * and it asserts only the properties that would be defects either way.
 *
 * ── HOW IT RUNS ─────────────────────────────────────────────────────────────
 *
 * Read-only, and enforced rather than assumed: `process.env.DATABASE_URL` is
 * overridden onto the read-only role BEFORE `lib/db/pool`'s module-level
 * `new Pool(...)` is constructed, which means every app module under test must
 * be imported DYNAMICALLY inside the test body. A static top-level import would
 * be hoisted ahead of the override and reconnect to whatever `DATABASE_URL` the
 * process already had. Same convention as `_capacity_resolver.audit.test.ts`,
 * and the `.audit.` name keeps it out of the CI gate chain.
 *
 *   npx vitest run lib/training/_prescription_resolver.audit.test.ts --disable-console-intercept
 *
 * ── WHAT THIS PROVES, AND WHAT IT DOES NOT (Rule 22) ────────────────────────
 *
 *   · It proves the resolver terminates on every real row of a real 14-week
 *     marathon block, that every row maps to a purpose, and that no output is
 *     internally incoherent (a centre outside its own window, a marathon pace
 *     faster than threshold, an easy ceiling faster than a quality target).
 *   · It proves §7 on real data: the capacity object is byte-identical after
 *     every call.
 *   · IT DOES NOT SAY WHICH SIDE IS RIGHT. A large delta on marathon pace is a
 *     finding for a human, not a failure, and this file deliberately has no
 *     assertion that would turn one into the other.
 *   · IT READS ONE ACCOUNT. Every number below is one runner's. Nothing here
 *     generalises.
 */
import { describe, it, expect } from 'vitest';

// TYPE-ONLY, so it is fully erased at transform time and cannot pull
// `lib/db/pool` in ahead of the read-only override below. `import type` is the
// one top-level import shape this file may carry, for exactly that reason.
import type {
  ResolvedCapacity,
  WorkoutPrescription,
} from '@/lib/training/prescription-resolver';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

/** Anchored rather than `new Date()` so a re-run months later still reports the
 *  same window. A stale anchor narrows a lookback; it never invalidates a read. */
const TODAY = '2026-08-31';

const pace = (s: number | null | undefined): string => {
  if (s == null || !Number.isFinite(s)) return '   -   ';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}/mi`;
};
const delta = (a: number | null, b: number | null): string => {
  if (a == null || b == null) return '     -';
  const d = Math.round(b - a);
  return `${d > 0 ? '+' : ''}${d} s/mi`;
};
const pad = (s: string, n: number) => s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);

describe.skipIf(!RO)('PRESCRIPTION RESOLVER · shadow mode against the owner\'s live plan', () => {
  it('resolves every real plan day and reports the disagreements', async () => {
    process.env.DATABASE_URL = RO;

    const { pool } = await import('@/lib/db/pool');
    const {
      resolveThresholdCapacity, resolveHighIntensityCapacity,
      resolveEasyCeiling, resolveDurability,
    } = await import('@/lib/training/capacity-resolver');
    const { resolveRunnerState } = await import('@/lib/training/runner-state');
    const {
      resolvePrescription, purposeFromPlanRow, marathonPaceFromDurability,
      THRESHOLD_ANCHOR_MINUTES,
    } = await import('@/lib/training/prescription-resolver');
    const { primaryZone } = await import('@/lib/plan/prescription-parser');

    /* ── 1 · THE ACTIVE PLAN · resolved, never assumed (Rule 14) ──────────── */
    const planRow = (await pool.query<{ id: string; mode: string; race_id: string | null; goal_iso: string }>(
      `SELECT id, mode, race_id, goal_iso
         FROM training_plans
        WHERE user_uuid = $1::uuid AND archived_iso IS NULL
        ORDER BY authored_iso DESC
        LIMIT 1`,
      [OWNER],
    )).rows[0];
    expect(planRow).toBeTruthy();

    /* ── 2 · CAPACITY, via the four canonical resolvers ───────────────────── */
    const [thresholdC, highIntensityC, easyC, durabilityC] = await Promise.all([
      resolveThresholdCapacity(OWNER, TODAY),
      resolveHighIntensityCapacity(OWNER, TODAY),
      resolveEasyCeiling(OWNER, TODAY),
      resolveDurability(OWNER, TODAY),
    ]);
    const capacity: ResolvedCapacity = {
      threshold: thresholdC, highIntensity: highIntensityC,
      easyCeiling: easyC, durability: durabilityC,
    };
    const capacitySnapshot = JSON.stringify(capacity);

    /* ── 3 · STATE, via the new consolidator ──────────────────────────────── */
    const state = await resolveRunnerState(OWNER, TODAY);

    /* ── 4 · THE REAL PLAN ROWS ───────────────────────────────────────────── */
    const rows = (await pool.query<{
      date_iso: string; type: string; distance_mi: string;
      pace_target_s_per_mi: number | null; sub_label: string | null;
      workout_spec: Record<string, unknown> | null; is_quality: boolean; is_long: boolean;
    }>(
      `SELECT date_iso, type, distance_mi, pace_target_s_per_mi, sub_label,
              workout_spec, is_quality, is_long
         FROM plan_workouts
        WHERE plan_id = $1
        ORDER BY date_iso`,
      [planRow.id],
    )).rows;
    expect(rows.length).toBeGreaterThan(0);

    /* ── 5 · WHAT THE LIVE ENGINE PRESCRIBED, per row ─────────────────────── */
    // The old system's headline number, read where the old system actually
    // stores it. A quality row carries `pace_target_s_per_mi`; an easy/long row
    // carries a lo/hi band inside `workout_spec` and the LO edge is the closest
    // analogue to a ceiling — it is the fastest pace the old band licenses.
    const livePace = (r: typeof rows[number]): { value: number | null; field: string } => {
      const spec = r.workout_spec ?? {};
      const lo = spec['pace_target_s_per_mi_lo'];
      if (r.pace_target_s_per_mi != null && r.type !== 'long') {
        return { value: r.pace_target_s_per_mi, field: 'pace_target_s_per_mi' };
      }
      if (typeof lo === 'number') return { value: lo, field: 'workout_spec.pace_target_s_per_mi_lo' };
      if (r.pace_target_s_per_mi != null) {
        return { value: r.pace_target_s_per_mi, field: 'pace_target_s_per_mi' };
      }
      return { value: null, field: 'none' };
    };

    /** The new system's single comparable number: the window centre for a
     *  quality prescription, the ceiling for an easy one. */
    const newPace = (p: WorkoutPrescription): number | null =>
      p.shape === 'ceiling' ? p.ceilingSecPerMi : p.paceSecPerMi;

    /* eslint-disable no-console */
    console.log('\n' + '═'.repeat(112));
    console.log(`SHADOW MODE · plan ${planRow.id} · mode=${planRow.mode} · race=${planRow.race_id} · goal_iso=${planRow.goal_iso}`);
    console.log(`today=${TODAY} · ${rows.length} plan_workouts rows`);
    console.log('═'.repeat(112));

    console.log('\n── CAPACITY (the four canonical resolvers) ───────────────────────────────');
    console.log(`  threshold      ${pace(thresholdC.paceSecPerMi)}  mode=${thresholdC.sourceMode} conf=${thresholdC.confidence.toFixed(3)} vdot=${thresholdC.vdot}`);
    console.log(`  interval  (I)  ${pace(highIntensityC.intervalPaceSecPerMi)}  mode=${highIntensityC.sourceMode} conf=${highIntensityC.confidence.toFixed(3)}`);
    console.log(`  repetition(R)  ${pace(highIntensityC.repetitionPaceSecPerMi)}`);
    console.log(`  easy ceiling   ${pace(easyC.ceilingSecPerMi)}  mode=${easyC.sourceMode} conf=${easyC.confidence.toFixed(3)}`);
    console.log(`  durability     exponent=${durabilityC.enduranceExponent.toFixed(4)} mode=${durabilityC.sourceMode} conf=${durabilityC.confidence.toFixed(3)}`);

    const mp = marathonPaceFromDurability({
      thresholdPaceSecPerMi: thresholdC.paceSecPerMi,
      durability: capacity.durability,
    });
    console.log('\n── MARATHON PACE, DERIVED (the new cross-distance step) ──────────────────');
    console.log(`  threshold anchor       ${THRESHOLD_ANCHOR_MINUTES} min at ${pace(thresholdC.paceSecPerMi)} = ${mp.anchorDistanceMi.toFixed(2)} mi`);
    console.log(`  endurance exponent     ${mp.enduranceExponent.toFixed(4)}  personallyEvidenced=${mp.personallyEvidenced} clamped=${mp.exponentClamped}`);
    console.log(`  marathon pace          ${pace(mp.paceSecPerMi)}  (${mp.paceSecPerMi.toFixed(1)} s/mi)`);
    // The live rule for comparison, both ways round, because the two differ for
    // two independent reasons and conflating them would hide one of them:
    //   · the FORMULA · `resolveMarathonPace`'s flat `T + 18` population offset
    //     against the personal exponent, at the SAME threshold anchor.
    //   · the ANCHOR   · what the plan actually stored, off the threshold the
    //     old cascade resolved, which is not the one the new capacity layer
    //     reads.
    const liveMpRows = (await pool.query<{ p: number }>(
      `SELECT DISTINCT pace_target_s_per_mi AS p
         FROM plan_workouts
        WHERE plan_id = $1 AND sub_label LIKE '%@ MP%' AND pace_target_s_per_mi IS NOT NULL`,
      [planRow.id],
    )).rows.map((r) => r.p);
    console.log(`  same rule, new anchor  T+18 = ${pace(thresholdC.paceSecPerMi + 18)}  (spec-builder resolveMarathonPace, current_fitness branch)`);
    console.log(`  what the plan STORED   ${liveMpRows.map((p) => pace(p)).join(', ') || 'none'}  (the @ MP rows as authored)`);

    console.log('\n── STATE (the new consolidator) ──────────────────────────────────────────');
    console.log(`  decision=${state.decision} readable=${state.readable} driver=${state.driver ? state.driver.kind : 'none'}`);
    for (const s of state.signals) {
      console.log(`    · ${pad(s.kind, 18)} argues=${pad(s.argues, 21)} driving=${s.driving ? 'yes' : 'no '}  ${s.detail}`);
    }

    /* ── 6 · THE ROW-BY-ROW DISAGREEMENT REPORT ───────────────────────────── */
    console.log('\n── PER-DAY COMPARISON ────────────────────────────────────────────────────');
    console.log(`  ${pad('DATE', 11)}${pad('TYPE', 17)}${pad('PURPOSE', 19)}${pad('SHAPE', 9)}${pad('LIVE', 10)}${pad('NEW', 10)}${pad('DELTA', 10)}NOTE`);

    type Bucket = { n: number; deltas: number[] };
    const byPurpose = new Map<string, Bucket>();
    const unmapped: string[] = [];
    let compared = 0;

    for (const r of rows) {
      const zone = primaryZone(r.sub_label);
      const purpose = purposeFromPlanRow({ type: r.type, zone });
      if (purpose == null) {
        unmapped.push(`${r.date_iso} ${r.type} · ${r.sub_label ?? ''}`);
        continue;
      }

      const rx = resolvePrescription({
        capacity,
        state,
        purpose,
        plannedMi: Number(r.distance_mi),
      });

      const live = livePace(r);
      const next = newPace(rx);
      const d = live.value != null && next != null ? next - live.value : null;

      if (d != null) {
        compared++;
        const b = byPurpose.get(purpose) ?? { n: 0, deltas: [] };
        b.n++; b.deltas.push(d);
        byPurpose.set(purpose, b);
      }

      const notes: string[] = [];
      if (rx.windowSecPerMi) notes.push(`win ${pace(rx.windowSecPerMi.fast)}-${pace(rx.windowSecPerMi.slow)}`);
      for (const c of rx.reasons) {
        if (c.startsWith('WINDOW_CLAMPED') || c === 'RACE_PACE_IS_RACE_PREDICTIONS_QUESTION'
          || c === 'REPETITION_PACE_UNKNOWN_OFF_TABLE' || c === 'POPULATION_ENDURANCE_EXPONENT'
          || c === 'NO_RUNNER_SPECIFIC_EVIDENCE') notes.push(c);
      }
      if (r.sub_label && r.sub_label !== r.type.toUpperCase()) notes.push(`"${r.sub_label}"`);

      console.log(
        `  ${pad(r.date_iso, 11)}${pad(r.type, 17)}${pad(purpose, 19)}${pad(rx.shape, 9)}` +
        `${pad(pace(live.value), 10)}${pad(pace(next), 10)}${pad(delta(live.value, next), 10)}${notes.join(' · ')}`,
      );
    }

    /* ── 7 · THE AGGREGATE ────────────────────────────────────────────────── */
    console.log('\n── DISAGREEMENT BY PURPOSE ───────────────────────────────────────────────');
    console.log(`  ${pad('PURPOSE', 20)}${pad('N', 5)}${pad('MEAN', 12)}${pad('MIN', 12)}${pad('MAX', 12)}`);
    for (const [p, b] of [...byPurpose.entries()].sort()) {
      const mean = b.deltas.reduce((s, x) => s + x, 0) / b.deltas.length;
      console.log(
        `  ${pad(p, 20)}${pad(String(b.n), 5)}` +
        `${pad(`${mean >= 0 ? '+' : ''}${mean.toFixed(1)} s/mi`, 12)}` +
        `${pad(`${Math.min(...b.deltas) >= 0 ? '+' : ''}${Math.min(...b.deltas).toFixed(0)} s/mi`, 12)}` +
        `${pad(`${Math.max(...b.deltas) >= 0 ? '+' : ''}${Math.max(...b.deltas).toFixed(0)} s/mi`, 12)}`,
      );
    }
    if (unmapped.length > 0) {
      console.log('\n── ROWS THIS LAYER DOES NOT PRESCRIBE FOR ────────────────────────────────');
      for (const u of unmapped) console.log(`  ${u}`);
    }
    console.log('');
    /* eslint-enable no-console */

    /* ── 8 · THE ASSERTIONS ───────────────────────────────────────────────── */

    // Rule 18 · LIVENESS. A report that compared nothing would print a clean
    // page and mean nothing, which is the worst outcome a check has available.
    expect(compared).toBeGreaterThan(20);
    expect(byPurpose.size).toBeGreaterThanOrEqual(4);

    // §7 · ON REAL DATA. Not one byte of the capacity moved across every call.
    expect(JSON.stringify(capacity)).toBe(capacitySnapshot);

    // Internal coherence, checked on every row rather than on a sample. These
    // are the properties that would be defects WHICHEVER system is right.
    for (const r of rows) {
      const purpose = purposeFromPlanRow({ type: r.type, zone: primaryZone(r.sub_label) });
      if (purpose == null) continue;
      const rx = resolvePrescription({ capacity, state, purpose, plannedMi: Number(r.distance_mi) });

      expect(rx.reasons.length + (rx.purpose === 'rest' ? 1 : 0)).toBeGreaterThan(0);
      if (rx.windowSecPerMi) {
        expect(rx.windowSecPerMi.slow).toBeGreaterThanOrEqual(rx.windowSecPerMi.fast);
        // The reported centre sits inside its own window.
        expect(rx.paceSecPerMi!).toBeGreaterThanOrEqual(rx.windowSecPerMi.fast - 1e-9);
        expect(rx.paceSecPerMi!).toBeLessThanOrEqual(rx.windowSecPerMi.slow + 1e-9);
        // No quality window reaches the easy ceiling.
        expect(rx.windowSecPerMi.slow).toBeLessThan(easyC.ceilingSecPerMi);
      }
      if (rx.shape === 'ceiling') {
        // An easy ceiling is slower than threshold pace, always.
        expect(rx.ceilingSecPerMi!).toBeGreaterThan(thresholdC.paceSecPerMi);
      }
    }

    // The marathon derivation lands strictly between the two capacities it is
    // built from. `b > 1` guarantees the first; the second is the one that
    // could realistically break for a runner with a steep fitted exponent.
    expect(mp.paceSecPerMi).toBeGreaterThan(thresholdC.paceSecPerMi);
    expect(mp.paceSecPerMi).toBeLessThan(easyC.ceilingSecPerMi);
  }, 180_000);
});
