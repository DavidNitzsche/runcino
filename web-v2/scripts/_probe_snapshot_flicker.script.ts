/**
 * scripts/_probe_snapshot_flicker.script.ts · the reviewer's own falsifier for
 * FINISHEST-RELIABILITY-1, kept in the repo so the claim can be re-run.
 *
 * Loads the FULL plan snapshot N times in ONE process against the local
 * scratch substrate and reports, per load, how many of the block's race days
 * carried a "Projected finish" stat. A run whose counts differ from load to
 * load is the Rule 9 discontinuity: identical underlying data, categorically
 * different screen.
 *
 *   FAFF_HARNESS_DB=faff_followup_skipproj bash scripts/probe-snapshot-flicker.sh
 */
import { loadPlanSnapshot } from '@/lib/plan/plan-snapshot';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { pool } from '@/lib/db/pool';

const OWNER = process.env.FAFF_HARNESS_OWNER_UUID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
const N = Number(process.env.PROBE_N ?? 10);

async function main() {
  const today = await runnerToday(OWNER);
  console.log(`[probe] owner=${OWNER} today=${today} loads=${N}`);
  /** One signature per load: the exact `Projected finish` values, in order. */
  const counts: string[] = [];
  for (let i = 1; i <= N; i++) {
    const t0 = Date.now();
    const snap = await loadPlanSnapshot(OWNER, today);
    const ms = Date.now() - t0;
    const raceDays = snap.days.filter((d) => d.is_race);
    // STABILITY IS KEYED ON WHAT THE RUNNER READS, NOT ON STAT PRESENCE.
    //
    // The first version of this counted days carrying a `Projected finish`
    // stat at all — and once FINISHEST-DETERMINISM-1 added the honest
    // "could not find out" state (`text: null`, rendered as a fault-red dash),
    // that counter reported 4/4 for a screen showing four DASHES and 4/4 for
    // a screen showing four finish times. It called the defect STABLE. Rule 18:
    // a check that cannot fail on the thing it exists for is not a check.
    //
    // The signature is now the ordered list of rendered values, so a figure
    // that becomes a dash — or changes — is a flicker by definition.
    const values = raceDays.map((d) => {
      const s = d.stats.find((x) => x.label === 'Projected finish');
      if (!s) return `${d.date_iso}=<no stat>`;
      return `${d.date_iso}=${s.value.text ?? '\u2014'}${s.tone ? `[${s.tone}]` : ''}`;
    });
    const withStat = raceDays.filter((d) =>
      d.stats.some((s) => s.label === 'Projected finish' && s.value.text != null));
    counts.push(values.join(' '));
    const skipped = snap.days.filter((d) => d.skipped).map((d) => d.date_iso);
    console.log(
      `  load ${String(i).padStart(2)} · ${String(ms).padStart(6)}ms · ` +
      `projected ${withStat.length}/${raceDays.length}` +
      `${snap.skip_state_unknown ? ' · skip_state_unknown' : ''}` +
      ` · skipped=${skipped.length}` +
      (values.length ? `  ${values.join(' ')}` : ''),
    );
  }
  const distinct = Array.from(new Set(counts)).sort();
  console.log('[probe] distinct screens across the run:');
  for (const d of distinct) console.log(`   ${counts.filter((c) => c === d).length}x  ${d}`);
  console.log(distinct.length === 1
    ? '[probe] STABLE · every load rendered the identical projected-finish values'
    : `[probe] FLICKER · ${distinct.length} different screens for identical data`);
  await pool.end();
  process.exit(distinct.length === 1 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
