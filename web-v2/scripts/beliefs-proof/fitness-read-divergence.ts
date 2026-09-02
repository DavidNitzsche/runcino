/**
 * scripts/beliefs-proof/fitness-read-divergence.ts · READ-ONLY probe.
 *
 * Today's "Where you are" prints a race-equivalence RANGE ("Half fitness")
 * from `lib/fitness/fitness-model.ts#resolveFitness`, which is fed straight
 * from `bestRecentVdot` — NOT from `resolveThresholdCapacity` (the Runner
 * Model, Constitution §C) and NOT from `lib/race/race-outlook.ts` (Race
 * Prediction, §J). This prints all three for the owner so the Rule 16
 * question ("do two surfaces show the same label over different numbers")
 * is answered from output.
 *
 * Run (read-only role, from web-v2):
 *   DATABASE_URL=$DATABASE_URL_RO npx tsx --tsconfig tsconfig.json scripts/beliefs-proof/fitness-read-divergence.ts
 */
import { pool } from '@/lib/db/pool';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
import { bestRecentVdot } from '@/lib/training/vdot';
import { resolveFitness } from '@/lib/fitness/fitness-model';
import { resolveThresholdCapacity } from '@/lib/training/capacity-resolver';

const OWNER = process.env.OWNER_UUID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = process.env.TODAY_ISO ?? '2026-09-02';

const hms = (s: number | null | undefined): string => {
  if (s == null || !Number.isFinite(s)) return '—';
  const t = Math.round(s);
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!/ro|readonly|read_only/i.test(url) && !process.env.ALLOW_NON_RO) {
    throw new Error('refusing: DATABASE_URL does not look like the read-only role (set ALLOW_NON_RO=1 to override)');
  }

  const capacity = await resolveThresholdCapacity(OWNER, TODAY);
  console.log(`\n══ RUNNER MODEL · resolveThresholdCapacity (Constitution §C) ══`);
  console.log(`  T pace ${capacity.paceSecPerMi} s/mi · VDOT ${capacity.vdot} · ${capacity.sourceMode} · confidence ${capacity.confidence.toFixed(3)}`);
  console.log(`  evidenceIds=${JSON.stringify(capacity.evidenceIds)}`);

  const inputs = await loadVdotInputs(OWNER, TODAY);
  const { best, considered } = bestRecentVdot(
    inputs.raceCandidates, TODAY, undefined, inputs.runCandidates, inputs.runFloorMi,
  );
  const estimate = resolveFitness({ best, considered });
  console.log(`\n══ TODAY "Where you are" · lib/fitness/fitness-model.ts#resolveFitness ══`);
  console.log(`  anchor VDOT ${best?.vdot ?? 'none'} (source ${best?.source ?? '—'}, date ${best?.date ?? '—'}, runFloorMi ${inputs.runFloorMi})`);
  console.log(`  confidence tier ${estimate?.confidence ?? '—'}`);
  if (estimate) {
    for (const [k, v] of Object.entries(estimate.races ?? {})) {
      const r = v as { loSec?: number; hiSec?: number } | null;
      if (r) console.log(`    ${k.padEnd(10)} ${hms(r.loSec)} – ${hms(r.hiSec)}`);
    }
  }

  console.log(`\n══ DIVERGENCE ══`);
  const capV = capacity.vdot;
  const fitV = best?.vdot ?? null;
  console.log(`  Runner Model VDOT ${capV} vs Today's fitness-read anchor VDOT ${fitV}`
    + (capV != null && fitV != null ? ` · Δ ${(fitV - capV).toFixed(2)}` : ''));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
