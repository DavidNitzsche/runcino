/**
 * lib/postrun/_render_fixture.audit.test.ts · write the REAL run-detail payload
 * to a file, so the phone can be made to draw it.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT A FIXTURE IN RULE 13's SENSE ─────────
 *
 * Rule 13 requires a runner-facing change to be verified by RENDERING it with
 * real data, and clause 2 forbids substituting a sample fixture, because
 * "fixtures skip the exact code paths that break".
 *
 * On this branch the phone cannot reach the server. It holds no session, and
 * minting one is a WRITE to the production `sessions` table — which this task
 * forbids outright and which `lib/verify/install-barrier` is built to make
 * structurally impossible for verification tooling. Both of those are correct
 * and neither should be worked around.
 *
 * So the payload comes the other way. This writes the EXACT object
 * `app/api/runs/[id]/route.ts` returns — the same two loaders, over the same
 * production rows, in the same shape — to a file, and `-faffRunDetail` makes
 * the app decode and draw it. What is exercised is the real decoder and the
 * real views over real production data. What is NOT exercised is the network
 * hop and the auth layer, and the report says so rather than implying a
 * verification that did not happen.
 *
 * This is the opposite of the failure Rule 13 names. That failure was a
 * SYNTHETIC fixture standing in for real data and skipping the gradient path
 * entirely. This is real data reaching the real drawing code by a different
 * road.
 *
 * READ-ONLY, and the write barrier is armed for the whole run.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *
 *   · IT ASSERTS ALMOST NOTHING. It is a capture tool with a liveness check.
 *     The assertions that matter are in `_detail_live.audit.test.ts`.
 *   · IT CANNOT PROVE THE ROUTE SHAPE. It reproduces the route's composition
 *     by calling the same loaders; if the route later adds a key, this file
 *     does not learn about it. `_detail_wire_consumed.audit.test.ts` watches
 *     that edge.
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadRunDetail } from '@/lib/coach/run-state';
import { loadPostRunExperience } from './load';
import { postRunWire } from './wire';
import { loadPostRunDetailExtras } from './detail-load';

const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const RO = process.env.DATABASE_URL_RO ?? process.env.DATABASE_URL;
/** Where to write. Set by the harness; absent in CI, and the file skips. */
const OUT_DIR = process.env.FAFF_RENDER_FIXTURE_DIR;

const RUNS: Record<string, string> = {
  // The 4 x 1 mile threshold session — charts, bands, and a matched workout.
  'run-0901.json': '-258355938987883',
  // The easy-plus-strides session — charts, stride bands, and NO comparator.
  'run-0902.json': '-145861381014809',
  /* THE ELEVATION CASE. Eleven of the owner's last fourteen runs record no
   * per-mile elevation at all, so neither run above draws that layer and
   * PR-10 could not be rendered from them. This one's splits carry `elev_ft`,
   * which is what the layer is built from. Kept in the list precisely because
   * a feature that only ever renders on rows nobody has is a feature nobody
   * has seen. */
  'run-0823.json': '-55341764239083',
};

describe.skipIf(!RO || !OUT_DIR)('capture the run-detail payload for rendering', () => {
  for (const [name, id] of Object.entries(RUNS)) {
    it(`writes ${name}`, async () => {
      const detail = await loadRunDetail(OWNER, id);
      expect(detail, `no run ${id}`).not.toBeNull();

      const x = await loadPostRunExperience(OWNER, { runId: id });
      const extras = await loadPostRunDetailExtras(OWNER, id);

      // THE ROUTE'S OWN COMPOSITION, key for key.
      const body = {
        ...detail,
        postRun: x ? postRunWire(x) : null,
        analysis: extras?.analysis ?? null,
        matchedWorkout: extras?.match.matched ?? null,
        matchedRefusal: extras?.match.refusal ?? null,
      };

      // LIVENESS. A capture tool that writes an empty object and reports
      // success is the worst outcome available, because the screenshot that
      // follows would look like a feature that draws nothing.
      expect(body.analysis, 'no analysis composed').not.toBeNull();
      expect(body.analysis!.points.length).toBeGreaterThan(10);

      const path = `${OUT_DIR}/${name}`;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(body));
      console.warn(`[render-fixture] wrote ${path}`);
    }, 90_000);
  }
});
