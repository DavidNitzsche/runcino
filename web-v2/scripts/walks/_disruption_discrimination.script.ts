/**
 * scripts/walks/_disruption_discrimination.script.ts · READ-ONLY production probe.
 *
 * WHAT IT PROVES, AND WHAT IT CANNOT
 * ----------------------------------
 * It runs the REAL, unmodified chain — `resolveSafety` (lib/safety/load-safety.ts)
 * -> `resolveTrainingSafety` (lib/safety/training-safety.ts) ->
 * `resolveArbitrationPriority` (lib/adaptation/canonical/phase-priority.ts) —
 * against the owner's REAL production rows, over `roQuery`
 * (`DATABASE_URL_RO`, role `faff_readonly`, plus the statement allow-list),
 * for a small set of candidate evaluation dates.
 *
 * It answers one question: does the disruption -> CONSTRAINED -> deferral chain
 * DISCRIMINATE — does it fire on a date where a real running gap existed, and
 * NOT fire on a date where none did.
 *
 * It CANNOT fail on anything downstream of `defersDemandIncrease`. It does not
 * run `runOptionLane`, so it says nothing about what the option lane would
 * have chosen on its own merits; it only shows whether the safety override at
 * `option-lane.ts`'s `stoppedBySafety` line would or would not have been armed.
 * That distinction is the whole point of the negative case and it is stated
 * here rather than implied (Rule 22: write down what the check cannot catch).
 *
 * WHY IT LIVES UNDER `scripts/walks/` AND NOT UNDER `lib/`
 * --------------------------------------------------------
 * The same reason `vitest.organic-push.config.ts` gives for the push walk: it
 * is a verification artifact, not library code. Under `lib/` it is a module
 * nothing imports, which `_generated_content_gate.test.ts` GUARD 5 correctly
 * reads as an orphan. Moving it removes a false positive instead of adding an
 * exemption to a ratchet, which is the posture Rule 18 asks for.
 *
 * It writes nothing. `roQuery` refuses a mutating statement before the wire,
 * and `vitest.setup.ts`'s production write barrier is armed on top of that.
 *
 *   npx vitest run --config vitest.disruption-probe.config.ts --disable-console-intercept
 */
import { describe, expect, it } from 'vitest';

import { roQuery } from '@/lib/adaptation/canonical-shadow/read-only-db';
import { resolveSafety } from '@/lib/safety/load-safety';
import { resolveTrainingSafety } from '@/lib/safety/training-safety';
import {
  phaseFromAuthoredLabel,
  resolveArbitrationPriority,
} from '@/lib/adaptation/canonical/phase-priority';
import { nearestCanonicalDistance } from '@/lib/race/canonical-distance';

const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795'; // dnitch85@me.com

/** The 75-day block the owner genuinely trained under for June/July 2026. */
const PLAN_ID = 'pln_ca91f252bba50c74';

/**
 * The candidates. Each is the EVENING BEFORE an eligible rolling-boundary week
 * start in that plan — the six the historical boundary scan already
 * enumerated. A handful, deliberately, not a sweep.
 */
const CANDIDATES: readonly { readonly todayISO: string; readonly weekStartISO: string }[] = [
  { todayISO: '2026-06-21', weekStartISO: '2026-06-22' },
  { todayISO: '2026-06-28', weekStartISO: '2026-06-29' },
  { todayISO: '2026-07-05', weekStartISO: '2026-07-06' },
  { todayISO: '2026-07-12', weekStartISO: '2026-07-13' },
  { todayISO: '2026-07-19', weekStartISO: '2026-07-20' },
  { todayISO: '2026-07-26', weekStartISO: '2026-07-27' },
];

/** The same SELECT `option-lane.ts#authoredPhaseLabelFor` issues, over the RO
 *  connection instead of the app pool. A read is a read; the statement is
 *  copied verbatim so this cannot answer a different question than production. */
async function phaseLabel(planId: string, weekStartISO: string): Promise<string | null> {
  const r = await roQuery<{ label: string | null }>(
    `SELECT pp.label
       FROM plan_weeks pwk
       JOIN plan_phases pp ON pp.id = pwk.phase_id
      WHERE pwk.plan_id = $1 AND pwk.week_start_iso = $2
      LIMIT 1`,
    [planId, weekStartISO],
  );
  return r.rows[0]?.label ?? null;
}

/** Ditto for `option-lane.ts#goalRaceDistanceFor`. */
async function goalRaceDistance(planId: string) {
  const r = await roQuery<{ mi: string | number | null }>(
    `SELECT COALESCE(
              tp.authored_state->>'race_distance_mi',
              r.meta->>'distanceMi'
            ) AS mi
       FROM training_plans tp
       LEFT JOIN races r ON r.slug = tp.race_id AND r.user_uuid = tp.user_uuid
      WHERE tp.id = $1
      LIMIT 1`,
    [planId],
  );
  const raw = r.rows[0]?.mi ?? null;
  if (raw === null) return null;
  const mi = Number(raw);
  if (!Number.isFinite(mi) || mi <= 0) return null;
  return nearestCanonicalDistance(mi);
}

describe('disruption -> CONSTRAINED -> defersDemandIncrease · real production data', () => {
  it('reports the chain for each candidate boundary', async () => {
    const lines: string[] = [];
    let positives = 0;
    let negatives = 0;

    for (const c of CANDIDATES) {
      const res = await resolveSafety(OWNER, { todayISO: c.todayISO, query: roQuery });
      const ts = resolveTrainingSafety(res);
      const label = await phaseLabel(PLAN_ID, c.weekStartISO);
      const dist = await goalRaceDistance(PLAN_ID);
      const phase = phaseFromAuthoredLabel(label);

      const prio = dist === null
        ? null
        : resolveArbitrationPriority({
            phase,
            raceDistance: dist,
            limiter: 'UNKNOWN',
            safety: ts.posture,
            stepsTakenThisCycle: { THRESHOLD_PACE: 0, WEEKLY_VOLUME: 0, LONG_RUN: 0 },
          });

      const disruption = res.known ? res.disruption : null;
      const gap = disruption
        ? `gapDays=${disruption.gapDays} ended=${disruption.gapEndedISO} `
          + `returned=${disruption.returnedOnISO ?? 'not yet'} `
          + `sinceReturn=${disruption.daysSinceReturn} window=${disruption.constraintWindowDays}`
        : 'no disruption signal';

      const defers = prio?.defersDemandIncrease ?? null;
      if (defers === true) positives += 1;
      if (defers === false) negatives += 1;

      lines.push(
        `week ${c.weekStartISO} (evaluated as of ${c.todayISO})\n`
        + `    safety      · ${res.explain}\n`
        + `    disruption  · ${gap}\n`
        + `    posture     · ${ts.posture} (${ts.explain})\n`
        + `    phase/race  · ${label ?? 'null'} -> ${phase} / ${dist ?? 'null'}\n`
        + `    arbitration · defersDemandIncrease=${defers} posture=${prio?.posture ?? 'n/a'} `
        + `declineBasis=${prio?.declineBasis ?? 'none'}\n`
        + `    option lane · a PUSH ranked first here would be ${
          defers ? 'OVERRIDDEN TO HOLD' : 'left to stand on its own merits'}`,
      );
    }

    // eslint-disable-next-line no-console
    console.log(`\n===== disruption discrimination · owner ${OWNER} =====\n\n${lines.join('\n\n')}\n`);

    // LIVENESS (Rule 18). A probe that read nothing must fail, not report clean.
    expect(lines.length).toBe(CANDIDATES.length);
    // DISCRIMINATION. The claim is not "it fires" and not "it never fires" —
    // it is that the same rule does both on real data. Either count being zero
    // falsifies the claim this script exists to make.
    expect(positives, 'at least one candidate where the rule DOES defer').toBeGreaterThan(0);
    expect(negatives, 'at least one candidate where the rule does NOT defer').toBeGreaterThan(0);
  }, 300_000);
});
