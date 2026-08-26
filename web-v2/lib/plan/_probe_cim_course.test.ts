/**
 * _probe_cim_course.test.ts · TEMPORARY AUDIT HARNESS (not a gate).
 *
 * Reads the owner's CIM course through `loadRaceCourseTerrain` and prints what
 * the plan engine now sees. Off by default, same reasoning as its siblings.
 *   FAFF_CIM_PROBE=1 npx vitest run lib/plan/_probe_cim_course.test.ts
 */
import { describe, it, expect } from 'vitest';
import { loadRaceCourseTerrain } from './course-profile';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const RUN = !!process.env.FAFF_CIM_PROBE;

describe.skipIf(!RUN)('what the plan engine sees of the course', () => {
  it('reads CIM and the tune-ups', async () => {
    const out: string[] = [];
    for (const [slug, mi] of [
      ['cim', 26.22], ['run-malibu', 13.1], ['dodgers', 6.21],
      ['santa-monica-10k-2026-09-13', 6.2],
    ] as const) {
      const t0 = Date.now();
      const terrain = await loadRaceCourseTerrain(DAVID, slug, mi);
      out.push(`${slug} (${Date.now() - t0}ms) ${JSON.stringify(terrain)}`);
    }
    require('fs').writeFileSync('/tmp/cim-course.txt', out.join('\n'));
    expect(out.length).toBe(4);
  }, 120_000);
});
