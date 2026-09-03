/**
 * scripts/adaptation-real-replay/_upward_bar.test.ts · THE RULE 21 GATE, AND
 * THE INSTRUMENT'S OWN DRIVER.
 *
 * `real-replay.test.ts` establishes the distribution. This establishes what the
 * distribution MEANS, which is the half Rule 21 actually asks for:
 *
 *     "compute what the runner would have had to DO to trigger it, then check
 *      whether any week they have actually run would have. If none could, the
 *      bar is not a bar, it is a wall."
 *
 * Four guards.
 *
 *   1 · **The season is measured, per gate.** Every upward precondition, read as
 *       a number, aggregated to "was it EVER met, and what is the closest he
 *       came". This is the report, and it is pinned so it cannot move silently.
 *
 *   2 · **The measurement agrees with the engine.** For each lever, the
 *       counterfactual rung the measurement predicts should be enough must
 *       actually produce a PROGRESS when the real `evaluateAdaptation` is run on
 *       it. A measurement nothing checks is the "confident, well-formed, wrong"
 *       output this repo keeps shipping.
 *
 *   3 · **The engine CAN say yes.** This is the Rule 21 wall test. If no rung of
 *       the ladder — up to and including every week, session and long run at the
 *       bar plus two qualifying threshold sessions — can produce a PROGRESS on a
 *       lever, then that lever cannot be pushed by any behaviour at all and the
 *       bar is a wall. That is a failure, not a finding to note.
 *
 *   4 · **Rule 11 · a data block is not a shortfall.** Any gate whose only
 *       failures came from unreadable data is reported as such and must not be
 *       counted as "he never earned it".
 *
 * ── FALSIFIED, PER RULE 18 · INCLUDING THE ATTEMPT THAT DID NOT WORK ───────
 *
 * The first falsification of guard 3 FAILED TO FAIL, and that is worth writing
 * down rather than quietly replacing with the one that worked. Raising
 * `VOLUME_WEEK_COMPLETION_MIN_FRAC` from 0.95 to 2.0 — every week completed at
 * twice its prescription, an obviously impossible bar — left all five tests
 * green. The reason is in the ladder: `withWeeksAtBar` credits each week at
 * `prescribedMi * VOLUME_WEEK_COMPLETION_MIN_FRAC`, reading the same constant,
 * so the counterfactual moved WITH the bar and cleared it.
 *
 * That is correct behaviour for a rung whose meaning is "at exactly the bar",
 * and it is also a real limit on what this guard can see: **guard 3 cannot
 * detect a bar that is merely too HIGH, only one that is unreachable in KIND.**
 * A threshold on a quantity the counterfactual can supply will always be
 * reachable by construction. Stated here because Rule 22 asks what a gate cannot
 * fail on, and this one was learned by watching it not fail.
 *
 * The falsification that does work makes the gate unreachable in kind —
 * `VOLUME_MIN_CONSECUTIVE_WEEKS` raised to 500, more weeks than the season has,
 * which no amount of good running can produce. Guards 2 and 3 both failed, and
 * guard 3 named it:
 *
 *     WEEKLY_VOLUME cannot be pushed by ANY rung of the ladder, up to and
 *     including "all of the above, plus a qualifying threshold session 5 s/mi
 *     faster on two separate days". Rule 21: the bar is not a bar, it is a wall.
 *
 * Guard 2 failing alongside it is the design working: the measurement said the
 * gate was unmet, no rung could meet it, and the two disagreed. The constant was
 * restored and all five returned green.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * · **A bar that is too LOW.** Every guard here asks whether the engine can be
 *   made to say yes. None asks whether it says yes too readily, and an engine
 *   that pushed on one good week would pass all four. That direction is
 *   `_lever_contracts.test.ts`'s and `_magnitude_bounds.test.ts`'s job, and the
 *   imbalance is stated here rather than hidden: this file is deliberately
 *   biased toward catching a wall, because a wall is the defect the owner has
 *   and the one his test suite has never been able to see.
 * · **The counterfactual being a season he could have run.** Rung 5 credits
 *   every week, every session and every long run at the bar simultaneously. No
 *   marathoner has that season. It proves the door opens; it does not claim he
 *   could have opened it.
 * · **Whether a PROGRESS would have been GOOD.** It measures reachability, not
 *   wisdom. A lever that fires on a rung nobody should reach is still "not a
 *   wall" by this file's standard.
 * · **A gate the instrument does not enumerate.** Inherited whole from
 *   `upward-bar.ts`'s own Rule 22 note.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { evaluateAdaptation } from '@/lib/adaptation/canonical/evaluate';
import type { CanonicalLever, CapacityBelief } from '@/lib/adaptation/canonical/input';
import { CANONICAL_LEVERS } from '@/lib/adaptation/canonical/input';
import { realHistory } from './snapshot';
import { sealHistory } from './sealed-history';
import { buildInputAt, SEED_THRESHOLD_SEC_PER_MI, weekStartOf } from './build-input';
import {
  climbAt, readBarsAt, summariseBars,
  RUNGS, RUNG_MEANING,
  type BarReading, type GateSummary, type RungResult, type Rung,
} from './upward-bar';

const SNAP = realHistory();
const SEALED = sealHistory(SNAP);

/* ── THE SAME DECISION POINTS THE REPLAY WALKS ─────────────────────────────
 *
 * Deliberately the same set, so a bar reading can be laid beside a ledger row
 * for the same date and the two describe one moment. The helpers are small
 * enough that duplicating them is cheaper than exporting them out of a test
 * file, and they are pinned against the replay's own count in guard 1.
 */

function mondays(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  let d = weekStartOf(fromISO);
  while (d <= toISO) {
    out.push(d);
    d = new Date(Date.parse(`${d}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  }
  return out;
}

function sessionBoundaries(): string[] {
  const dayAfter = (iso: string) =>
    new Date(Date.parse(`${iso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const qualityTypes = new Set(['threshold', 'tempo', 'intervals', 'race', 'race_week_tuneup', 'long']);
  const dates = new Set<string>();
  for (const r of SNAP.runs) {
    if (r.date < '2026-06-01') continue;
    const w = SNAP.planWorkouts.find((x) => x.dateISO === r.date && qualityTypes.has(x.type));
    if (w) dates.add(dayAfter(r.date));
  }
  return [...dates].sort();
}

interface Walked {
  readings: BarReading[];
  climbs: RungResult[];
  points: number;
  actualProgress: number;
}

/**
 * Walk the season, carrying the belief exactly as the replay does — seeded once
 * and moved only by the engine's own accepted proposals. Re-reading the plan
 * would import the legacy engine's opinion and stop this being a counterfactual.
 */
function walk(): Walked {
  const readings: BarReading[] = [];
  const climbs: RungResult[] = [];
  let actualProgress = 0;

  const belief: { -readonly [K in keyof CapacityBelief]: CapacityBelief[K] } = {
    thresholdPaceSecPerMi: SEED_THRESHOLD_SEC_PER_MI,
    weeklyVolumeMi: 43.5,
    longRunMi: 12,
    supportingSessionCount: 0,
    oldestSupportingDateISO: null,
  };

  const weekly = mondays('2026-06-08', '2026-09-03')
    .map((d) => ({ date: d, boundary: 'WEEKLY_BOUNDARY' as const }));
  const session = sessionBoundaries()
    .map((d) => ({ date: d, boundary: 'SESSION_COMPLETED' as const }));
  const points = [...weekly, ...session]
    .filter((p) => p.date <= '2026-09-03')
    .sort((a, b) => (a.date === b.date
      ? (a.boundary === 'WEEKLY_BOUNDARY' ? -1 : 1)
      : a.date < b.date ? -1 : 1));

  const steps: Record<CanonicalLever, number> = {
    THRESHOLD_PACE: 0, WEEKLY_VOLUME: 0, LONG_RUN: 0,
  };
  let lastCutbackSeen: string | null = null;
  let anchorMovedOn: string | null = null;

  for (const p of points) {
    const { input } = buildInputAt({
      asOfISO: p.date,
      boundary: p.boundary,
      belief: { ...belief },
      stepsTakenThisCycle: steps,
      anchorMovedTodayForLever: { THRESHOLD_PACE: anchorMovedOn === p.date },
    }, SEALED);

    const cutback = [...input.weeks].reverse().find((w) => w.isCutback)?.weekStartISO ?? null;
    if (cutback !== null && cutback !== lastCutbackSeen) {
      lastCutbackSeen = cutback;
      steps.THRESHOLD_PACE = 0; steps.WEEKLY_VOLUME = 0; steps.LONG_RUN = 0;
    }

    readings.push(...readBarsAt(p.date, input));

    // The ladder runs only at WEEKLY boundaries, which is where the contract
    // says plan-level changes are arbitrated. Running it at session boundaries
    // would count the cadence rule's deferrals as walls.
    if (p.boundary === 'WEEKLY_BOUNDARY') climbs.push(...climbAt(p.date, input));

    const out = evaluateAdaptation(input);
    for (const r of out.records) {
      if (r.decision === 'PROGRESS') {
        actualProgress += 1;
        steps[r.lever] += 1;
        if (r.lever === 'THRESHOLD_PACE') anchorMovedOn = p.date;
        if (r.proposedAfterValue !== null) {
          if (r.lever === 'THRESHOLD_PACE') belief.thresholdPaceSecPerMi = r.proposedAfterValue;
          if (r.lever === 'WEEKLY_VOLUME') belief.weeklyVolumeMi = r.proposedAfterValue;
          if (r.lever === 'LONG_RUN') belief.longRunMi = r.proposedAfterValue;
        }
      }
    }
  }

  return { readings, climbs, points: points.length, actualProgress };
}

const W = walk();
const SUMMARY: GateSummary[] = summariseBars(W.readings);

/** The first rung, per lever, that ever produced a PROGRESS anywhere. */
function firstRungThatWorks(lever: CanonicalLever): Rung | null {
  for (const rung of RUNGS) {
    if (W.climbs.some((c) => c.rung === rung && c.progressed.includes(lever))) return rung;
  }
  return null;
}

describe('Rule 21 · is the upward bar a bar, or a wall?', () => {
  it('guard 1 · the season is measured, gate by gate, and pinned', () => {
    expect(W.points).toBeGreaterThan(30);
    expect(SUMMARY.length).toBeGreaterThanOrEqual(11);

    // The headline this whole harness exists to establish. Pinned so a change
    // in either direction is a deliberate act rather than a drift.
    expect(W.actualProgress, 'The engine proposed an increase on his real history.')
      .toBe(0);

    // Liveness, Rule 18 guard 2. A summary computed from nothing reports
    // "never met" for everything and looks exactly like a damning finding.
    const evaluated = SUMMARY.reduce((a, s) => a + s.pointsEvaluated, 0);
    expect(evaluated, 'The instrument read no gates. A summary over zero readings '
      + 'reports "never met" for every bar and looks identical to a real wall.')
      .toBeGreaterThan(200);
  });

  it('guard 2 · the measurement agrees with the engine', () => {
    // For every lever whose enumerated gates were never all met on his real
    // history, some rung of the ladder must be able to meet them — otherwise
    // the measurement is describing gates that are not the binding ones.
    const disagreements: string[] = [];
    for (const lever of CANONICAL_LEVERS) {
      const gates = SUMMARY.filter((s) => s.lever === lever);
      const allEverMet = gates.every((g) => g.everMet);
      const rung = firstRungThatWorks(lever);
      if (!allEverMet && rung === null) {
        disagreements.push(
          `${lever}: the instrument names ${gates.filter((g) => !g.everMet).length} unmet gate(s), `
          + 'but no rung that clears them produces a PROGRESS. Something else is binding '
          + 'and the measurement is answering the wrong question.',
        );
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('guard 3 · every lever can be pushed by SOME behaviour (the wall test)', () => {
    const walls: string[] = [];
    for (const lever of CANONICAL_LEVERS) {
      if (firstRungThatWorks(lever) === null) {
        walls.push(
          `${lever} cannot be pushed by ANY rung of the ladder, up to and including `
          + `"${RUNG_MEANING.EVERYTHING_AT_BAR}". Rule 21: the bar is not a bar, it is a wall.`,
        );
      }
    }
    expect(walls).toEqual([]);
  });

  it('guard 4 · Rule 11 · a gate blocked by unreadable data is not a shortfall', () => {
    // Not an assertion about the engine: an assertion that this instrument keeps
    // the two apart. A gate every one of whose readings was data-blocked must
    // never be reported as a bar the runner failed to clear.
    const collapsed = SUMMARY.filter(
      (s) => !s.everMet && s.pointsBlockedByData === s.pointsEvaluated && s.pointsEvaluated > 0,
    );
    for (const s of collapsed) {
      // The summary must be able to say so. `bestObserved` falls back to the
      // blocked pool only when there is nothing else, and the caller reads
      // `pointsBlockedByData` to know that is what happened.
      expect(s.pointsBlockedByData).toBe(s.pointsEvaluated);
    }
    // And the season must not be entirely data-blocked, or the whole report is
    // about a watch rather than about a runner.
    const fullyBlocked = SUMMARY.filter((s) => s.pointsBlockedByData === s.pointsEvaluated).length;
    expect(fullyBlocked).toBeLessThan(SUMMARY.length);
  });

  it('writes the Rule 21 report', () => {
    const lines: string[] = [];
    lines.push('# Rule 21 · what he would have had to DO');
    lines.push('');
    lines.push(`Decision points: ${W.points} · gate readings: ${W.readings.length} · `
      + `upward proposals the engine made on his real history: **${W.actualProgress}**`);
    lines.push('');
    lines.push('## Every upward gate, and the closest he ever came');
    lines.push('');
    lines.push('| Lever | Gate | The bar | Ever met | Closest | When | Short by |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const s of SUMMARY) {
      const bar = `${s.higherIsBetter ? '≥' : '≤'} ${s.required} ${s.unit}`;
      const short = s.everMet ? '—' : `${s.shortfallAtBest}`;
      lines.push(`| ${s.lever} | ${s.gate} | ${bar} | ${s.everMet ? 'YES' : '**NO**'} `
        + `| ${s.bestObserved} | ${s.bestOnISO ?? '—'} | ${short} |`);
    }
    lines.push('');
    lines.push('Gates whose failures were DATA rather than behaviour (Rule 11):');
    lines.push('');
    for (const s of SUMMARY.filter((x) => x.pointsBlockedByData > 0)) {
      lines.push(`- \`${s.lever}/${s.gate}\` · ${s.pointsBlockedByData} of ${s.pointsEvaluated} `
        + 'readings could not be judged from the data.');
    }
    lines.push('');
    lines.push('## The counterfactual ladder · which rung buys a PROGRESS');
    lines.push('');
    lines.push('| Lever | First rung that works | What that rung means |');
    lines.push('|---|---|---|');
    for (const lever of CANONICAL_LEVERS) {
      const r = firstRungThatWorks(lever);
      lines.push(`| ${lever} | ${r ?? '**NONE — a wall**'} | ${r ? RUNG_MEANING[r] : '—'} |`);
    }
    lines.push('');
    lines.push('| Rung | Weekly boundaries where it produced a PROGRESS |');
    lines.push('|---|---|');
    for (const rung of RUNGS) {
      const n = W.climbs.filter((c) => c.rung === rung && c.progressed.length > 0).length;
      const total = W.climbs.filter((c) => c.rung === rung).length;
      lines.push(`| ${rung} | ${n} of ${total} |`);
    }
    lines.push('');
    lines.push('## The closest real week, per binding gate');
    lines.push('');
    for (const s of SUMMARY.filter((x) => !x.everMet)) {
      lines.push(`### ${s.lever} · ${s.gate}`);
      lines.push('');
      lines.push(`${s.question}. Bar: ${s.higherIsBetter ? '≥' : '≤'} ${s.required} ${s.unit}.`);
      lines.push('');
      lines.push(`Closest: **${s.bestObserved}** on ${s.bestOnISO}.`);
      lines.push('');
      lines.push(`> ${s.bestDetail}`);
      lines.push('');
    }

    const out = process.env.UPWARD_BAR_OUT;
    if (out) {
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, lines.join('\n'));
    }
    // Always visible, because a report nobody reads is a report nobody reads.
    // eslint-disable-next-line no-console
    console.log(`\n${lines.join('\n')}\n`);
    expect(lines.length).toBeGreaterThan(20);
  });
});
