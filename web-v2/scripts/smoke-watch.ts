/**
 * smoke-watch.ts — calls buildWatchToday() against prod DB and prints
 * the phase breakdown so we can verify what reaches the watch.
 *
 * Usage:
 *   npx tsx scripts/smoke-watch.ts                                # today
 *   npx tsx scripts/smoke-watch.ts <user-uuid>                    # today, alt user
 *   npx tsx scripts/smoke-watch.ts <user-uuid> 2026-05-26         # override date
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const l of readFileSync(envPath, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const USER = process.argv[2] ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DATE = process.argv[3]; // optional override

async function main() {
  const { buildWatchToday } = await import('../lib/watch/build-workout');
  const res = await buildWatchToday(USER, DATE);
  if ('message' in res && res.message) {
    console.log('MESSAGE:', res.message);
    return;
  }
  const w = res.workout!;
  if (DATE) console.log('Date override:', DATE);
  console.log('Name:', w.name);
  console.log('Summary:', w.summary);
  console.log('Total est. min:', w.totalEstimatedMinutes);
  console.log('Distance:', w.distanceMi);
  console.log('hrCeilingBpm:', w.hrCeilingBpm);
  console.log(`Phases (${w.phases.length}):`);
  let distSum = 0;
  let workReps = 0;
  let recoveryCount = 0;
  for (let i = 0; i < w.phases.length; i++) {
    const p = w.phases[i];
    const mm = Math.floor(p.durationSec / 60);
    const ss = String(p.durationSec % 60).padStart(2, '0');
    const pace = p.targetPaceSPerMi
      ? `${Math.floor(p.targetPaceSPerMi / 60)}:${String(p.targetPaceSPerMi % 60).padStart(2, '0')}/mi`
      : 'no target';
    const tol = p.tolerancePaceSPerMi ? ` ±${p.tolerancePaceSPerMi}s` : '';
    const dist = p.distanceMi ? `${p.distanceMi}mi` : '';
    if (p.distanceMi) distSum += p.distanceMi;
    if (p.type === 'work' && p.label.startsWith('Rep ')) workReps++;
    if (p.type === 'recovery') recoveryCount++;
    console.log(`  ${i} [${p.type}] ${p.label} · ${mm}:${ss} · ${dist} · ${pace}${tol} · ${p.haptic}`);
  }
  console.log(`Total distance from phases: ${distSum.toFixed(2)} mi (target ${w.distanceMi})`);
  if (workReps > 0) console.log(`Reps detected: ${workReps} · Recoveries: ${recoveryCount}`);
}

main().catch((e) => { console.error(e); process.exit(1); })
      .finally(() => setTimeout(() => process.exit(0), 100));
