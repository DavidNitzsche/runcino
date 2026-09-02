/**
 * Day-by-day replay of the owner's threshold capacity belief. Read-only.
 * Usage: DATABASE_URL=<RO> npx tsx --tsconfig tsconfig.json <this> <from> <to> <label>
 */
import { resolveThresholdCapacity } from '@/lib/training/capacity-resolver';
const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const from = process.argv[2] ?? '2026-06-01';
const to = process.argv[3] ?? '2026-09-01';
const label = process.argv[4] ?? 'replay';
function addDays(iso: string, n: number): string { return new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
async function main() {
  const rows: any[] = [];
  let prev: any = null;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const est: any = await resolveThresholdCapacity(USER, d);
    const ev = est.evidence ?? null;
    const rec = {
      day: d, pace: est.paceSecPerMi, vdot: est.vdot, conf: Number(est.confidence.toFixed(4)), mode: est.sourceMode,
      ids: est.evidenceIds, reasons: est.reasons,
      supporting: ev ? ev.supporting.map((o: any) => ({ id: o.id, date: o.date, pace: Math.round(o.paceSecPerMi), w: Number((o.weight ?? 1).toFixed(3)), rep: o.representative, hr: o.authority?.hr, ee: o.authority?.evidenceKind })) : null,
      excluded: ev ? ev.excluded.map((e: any) => ({ id: e.id, date: e.date, reason: e.reason })) : null,
      moveCap: ev?.moveCap ?? null,
      changed: prev ? est.paceSecPerMi !== prev.paceSecPerMi : true,
    };
    rows.push(rec);
    const flag = rec.changed ? '*' : ' ';
    console.log(`${flag} ${d}  T=${est.paceSecPerMi}s/mi (${Math.floor(est.paceSecPerMi/60)}:${String(est.paceSecPerMi%60).padStart(2,'0')})  vdot=${est.vdot}  conf=${rec.conf}  ${est.sourceMode}  ids=[${est.evidenceIds.join(',')}]${rec.moveCap?.applied ? '  CAPPED(prior ' + rec.moveCap.priorSecPerMi + ', uncapped ' + rec.moveCap.uncappedSecPerMi + ')' : ''}`);
    if (rec.changed && prev) {
      console.log(`    Δ ${est.paceSecPerMi - prev.paceSecPerMi}s/mi from ${prev.paceSecPerMi} · reasons=${est.reasons.join(',')}`);
      if (rec.supporting) console.log(`    supporting: ${JSON.stringify(rec.supporting)}`);
      if (rec.excluded) console.log(`    excluded: ${JSON.stringify(rec.excluded)}`);
    }
    prev = est;
  }
  const fs = await import('node:fs');
  fs.writeFileSync(`${process.env.REPLAY_OUT ?? '.'}/threshold-replay-${label}.json`, JSON.stringify(rows, null, 1));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
