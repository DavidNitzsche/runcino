/**
 * split-coverage.ts · whole-run split reliability check.
 *
 * Replaces the old "|split-time-sum − total-duration| > 5s → drop ALL
 * splits" guard, which discarded perfectly good per-mile splits on nearly
 * every run that ends mid-mile. deriveSplitsFromPaceSamples only emits a
 * split when cumulative distance crosses a WHOLE mile, so a 5.85 mi run
 * yields 5 splits covering 5.0 mi — their times sum ~1 cool-down-mile
 * short of the full duration, and the old check read that legitimate
 * shortfall as "broken" and threw the splits away. The bad downstream
 * effect (observed on David's 2026-07-09 tempo): the run's clean watch
 * splits were dropped, so the iPhone's GPS-route splits (which over-count
 * distance and produced a fake 5:44 mile) were absorbed in their place.
 *
 * The correct signal: splits are unreliable only when their times
 *   · OVER-claim the run — sum exceeds total duration (impossible; a
 *     timing/GPS error), or
 *   · fall SHORT by more than one mile's worth of time — meaning a WHOLE
 *     mile is missing, not just the final fractional remainder.
 * Falling short by up to ~1 mile is the expected, benign case (the run
 * ended partway through the next mile), so those splits are kept.
 */
export function splitTimesReliable(
  splitsSumSec: number,
  totalSec: number,
  totalDistanceMi: number,
): boolean {
  if (!(totalSec > 0) || !(splitsSumSec > 0)) return false;
  const avgMileSec = totalDistanceMi > 0 ? totalSec / totalDistanceMi : totalSec;
  const overclaim = splitsSumSec - totalSec;   // >0 → splits claim more time than the run: impossible
  const shortfall = totalSec - splitsSumSec;   // >0 → uncounted tail; benign up to ~1 mile
  if (overclaim > 5) return false;
  // Allow the split times to fall short by up to one average mile (+30 s
  // slack for a slow final partial), which is exactly the un-split tail.
  return shortfall <= avgMileSec * 1.1 + 30;
}

/** Sum of split times in seconds: paceSecPerMi × distanceMi per split,
 *  parsing the "M:SS" pace string when the numeric field is absent. */
export function splitsSumSeconds(
  splits: Array<{ paceSecPerMi?: number | null; pace?: string | null; distanceMi?: number }>,
): number {
  let sum = 0;
  for (const s of splits) {
    const distMi = typeof s.distanceMi === 'number' ? s.distanceMi : 1;
    let sec = typeof s.paceSecPerMi === 'number' ? s.paceSecPerMi : null;
    if (sec == null && typeof s.pace === 'string') {
      const m = s.pace.match(/^(\d+):(\d{2})$/);
      if (m) sec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }
    if (sec != null && sec > 0) sum += sec * distMi;
  }
  return sum;
}
