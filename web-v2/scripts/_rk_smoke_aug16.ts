/**
 * 2026-06-09 · race-killer smoke — build the REAL Aug 16 watch payload
 * through the production code path (buildWatchToday) against prod data,
 * read-only (run with DATABASE_URL pointed at DATABASE_URL_RO).
 *
 *   DATABASE_URL=$DATABASE_URL_RO npx tsx scripts/_rk_smoke_aug16.ts
 */
import { buildWatchToday } from '../lib/watch/build-workout';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const fmtPace = (s: number | null | undefined) =>
  s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}/mi`;

async function main() {
  const res = await buildWatchToday(DAVID, '2026-08-16');
  if (!('workout' in res) || !res.workout) {
    console.log('NO WORKOUT:', res);
    process.exit(1);
  }
  const w = res.workout;
  console.log(`name=${w.name} isRace=${w.isRace} dist=${w.distanceMi} estMin=${w.totalEstimatedMinutes}`);
  console.log(`goalSec=${w.goalSec} (${w.goalSec ? Math.floor(w.goalSec / 60) + 'min' : '—'})  gelsMi=${JSON.stringify(w.gelsMi)}`);
  console.log(`expiresAt=${w.expiresAt}  hrCeiling=${w.hrCeilingBpm}  displayHint=${w.displayHint}`);
  console.log('phases:');
  for (const p of w.phases) {
    console.log(`  [${p.type}] ${p.label.padEnd(20)} ${String(p.distanceMi ?? '—').padStart(5)}mi  target=${fmtPace(p.targetPaceSPerMi)} ±${p.tolerancePaceSPerMi}s  dur=${Math.round(p.durationSec / 60)}min  haptic=${p.haptic}`);
  }
  const total = w.phases.reduce((s, p) => s + p.durationSec, 0);
  console.log(`phase-sum=${total}s = ${Math.floor(total / 3600)}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')} (goal 1:30:00 = 5400s)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
