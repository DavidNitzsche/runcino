/**
 * Rule 8 live check · does the habit reader exclude the runner's taper and
 * post-race recovery, or does it report them as his normal?
 *
 * Raw 28-day canonical mileage for the owner on 2026-09-02 is 124.3 mi, i.e.
 * 31.1 mi/wk. That window is almost entirely the post-AFC recovery block, and
 * Rule 8's own table records his sustained figure as 43.5. A habit reader that
 * answers anywhere near 31 has measured him during a period the engine itself
 * told him to go easy. Read-only.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import {
  normalWeeklyMileageDetail, normalTrainingWindow, isRefusal,
} from '@/lib/training/normal-window';

const UUID = process.env.PROBE_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';

async function main() {
  const todayISO = await runnerToday(UUID);
  console.log('today (runner tz):', todayISO);

  const win = await normalTrainingWindow(UUID, todayISO, 28);
  console.log('\n=== normalTrainingWindow ===');
  console.log(JSON.stringify(win, null, 2).slice(0, 2500));

  const detail = await normalWeeklyMileageDetail(UUID, todayISO);
  console.log('\n=== normalWeeklyMileageDetail ===');
  console.log(JSON.stringify(detail, null, 2).slice(0, 2500));

  // Rule 11 · a refusal is a distinct answer and must be reported as one.
  if (isRefusal(detail as never)) {
    console.log('\nVERDICT: the reader REFUSED. That is a correct answer.');
  } else {
    const v = (detail as { value?: unknown }).value;
    console.log('\nVERDICT: reader returned a value:', JSON.stringify(v));
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

