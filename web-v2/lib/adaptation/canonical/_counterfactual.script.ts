/**
 * lib/adaptation/canonical/_counterfactual.script.ts · WHAT READING C ACTUALLY
 * DOES TO THE OWNER'S REAL HISTORY.
 *
 *     npm --prefix web-v2 run counterfactual
 *
 * CLAUDE.md Rule 21 sets the standard this file exists to meet: "Prove it
 * fires, on real history. Compute what the runner would have had to DO to
 * trigger it, then check whether any week they have actually run would have. If
 * none could, the bar is not a bar, it is a wall." A doctrine change to
 * arbitration exercised only against fixtures is a hypothesis.
 *
 * So this replays every weekly boundary of the owner's real training under
 * THREE readings of arbitration rule 1, carrying a SEPARATE belief forward in
 * each, and reports where every proposal the engine has ever made lands:
 *
 *     APPLIED             · survived arbitration and moved the belief
 *     DEFERRED            · suppressed AND queued, with the boundary named
 *     REMAINS SUPPRESSED  · suppressed and NOT queued, with the reason named
 *
 * ── THE SUBSTRATE IS THE SEALED HISTORY, NOT A LIVE READ ───────────────────
 *
 * `scripts/adaptation-real-replay/` already holds what this needs: a read-only
 * export of the owner's production rows (156 canonical runs, 9 plan versions,
 * 570 prescriptions, 11 races), a `buildInputAt` whose no-lookahead filter has
 * been ATTACKED rather than assumed (deleting it produced 537 leaks and 40
 * poison citations, watched and restored), and a walk that carries belief
 * forward. Reusing it rather than writing a second loader is Rule 16: a rival
 * historical loader would be a second account of the same season, and the first
 * draft of this file proved it. It walked the LIVE loader over past dates and
 * produced TWO proposals across nine months, because that loader has no
 * work-duration parser and grades almost every real session INSUFFICIENT.
 *
 * The live database is still read, for one thing only and it is the right one:
 * a FRESHNESS CHECK. The snapshot is a file, and a file is a claim about
 * production that ages. Every run below re-asks production for the owner's
 * canonical run count and date range and prints the drift, so a table generated
 * against a stale snapshot says so rather than looking current.
 *
 * ── READ-ONLY, AND STRUCTURALLY SO ─────────────────────────────────────────
 *
 * The freshness probe goes through
 * `lib/adaptation/canonical-shadow/read-only-db.ts`, which opens its own pool
 * on `DATABASE_URL_RO` (the `faff_readonly` role) and refuses any statement
 * that is not a read BEFORE it reaches the wire. It is the only query this file
 * makes. Nothing here writes anything but a markdown file under `docs/`, and
 * the replay itself touches no database at all.
 *
 * ── WHY THIS IS A `.script.ts` RUN THROUGH VITEST ──────────────────────────
 *
 * It is not a test and must never be swept into `npm test`. It uses vitest
 * purely as the TypeScript runner, because this repo has no `tsx` and the
 * module graph below needs the `@/` alias. That is the construction
 * `_falsify_gates.script.ts` already uses and the reason
 * `vitest.falsify.config.ts` excludes this file by name: it reads production
 * and cannot pass on a clean checkout.
 *
 * ── WHAT THIS HARNESS CANNOT TELL YOU (Rule 22, read it before the table) ───
 *
 * · A WRONG INPUT. Every criticism `build-input.ts` makes of itself applies
 *   here in full: a mis-matched prescription, a mis-segmented watch phase or a
 *   mis-read cutback flag produces a confident, well-formed, wrong row and
 *   nothing here would notice.
 * · WHETHER THE OUTCOME WAS GOOD FOR HIM. It counts where proposals land. It
 *   says nothing about whether the season that followed would have been better,
 *   and it cannot: from the first divergence onward each world is describing a
 *   season he did not have, and every later row is conditional on the earlier
 *   ones being right.
 * · THE PROVISIONAL CEILING. World `C-probe` invents one from his own best
 *   completed non-cutback week so the result's sensitivity to a plausible
 *   ceiling can be seen. It is NOT a demand model, nothing in `lib/` reads it,
 *   and the honest live world is `C-absent`.
 * · SESSION BOUNDARIES. This walks WEEKLY boundaries only, because the contract
 *   arbitrates plan-level change there and a session-boundary proposal is
 *   deferred by the cadence rule under every reading. Including them would add
 *   identical rows to all three columns and hide the arbitration difference in
 *   noise. `scripts/adaptation-real-replay/` walks both and pins that
 *   distribution; this file is about arbitration alone.
 */
import { describe, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { evaluateAdaptation } from './evaluate';
import { arbitrate, type ArbitrationReading, type ArbitratedVerdict } from './arbitration';
import { demandCeilingForWeek } from './plan-load';
import { enqueueDeferrals } from './deferral-queue';
import {
  measured, absent,
  type CanonicalAdaptationInput, type CanonicalLever, type CapacityBelief, type Measured,
} from './input';
import type { CanonicalDecisionRecord } from './decision-record';
import { NON_MOVING_DECISIONS } from './decision-record';
import type { LeverVerdict } from './levers/shared';
import { runDaySql, runNotMergedSql } from '@/lib/runs/run-shape';
import { roQuery, readOnlyConnectionConfigured } from '@/lib/adaptation/canonical-shadow/read-only-db';
import {
  buildInputAt, SEED_THRESHOLD_SEC_PER_MI, weekStartOf, ATHLETE_ID,
} from '../../../../scripts/adaptation-real-replay/build-input';
import { sealedHistory } from '../../../../scripts/adaptation-real-replay/sealed-history';

const OUT_PATH = path.resolve(
  __dirname, '..', '..', '..', '..',
  'docs/reports/core-closure-2026-09-04/COUNTERFACTUAL.md',
);

const SEALED = sealedHistory();

/** The walk, matching `real-replay.test.ts`'s own weekly range. */
const FIRST_BOUNDARY = '2026-06-08';
const LAST_BOUNDARY = '2026-09-03';

/** His plan's own opening numbers, taken once. Same seed as the replay. */
const SEED_WEEKLY_MI = 43.5;
const SEED_LONG_MI = 12;

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

function mondays(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  let d = weekStartOf(fromISO);
  while (d <= toISO) { out.push(d); d = addDays(d, 7); }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE THREE WORLDS
 * ═══════════════════════════════════════════════════════════════════════ */

interface World {
  readonly id: string;
  readonly label: string;
  readonly reading: ArbitrationReading;
  readonly ceiling: (input: CanonicalAdaptationInput) => Measured<number>;
  /** Whether a suppressed proposal survives as a queued deferral. */
  readonly queues: boolean;
}

/**
 * A PROVISIONAL stand-in for a demand ceiling, used by world `C-probe` only.
 *
 * His own best completed week in the evidence window, priced with the long run
 * and quality minutes the coming week already carries. It is NOT a demand
 * model, it is not doctrine, and nothing in `lib/` reads it: it exists so the
 * table can show how the result moves if a ceiling of a plausible size exists
 * at all, rather than only showing "no ceiling" against "the old rule".
 *
 * Rule 8 as far as this input allows: weeks the plan itself authored as a
 * cutback, a recovery block or a taper are excluded, because a peak measured
 * across a taper is not this runner's ceiling.
 */
function provisionalCeiling(input: CanonicalAdaptationInput): Measured<number> {
  let best = 0;
  for (const w of input.weeks) {
    if (w.isCutback) continue;
    if (w.authoredPlanMode === 'RECOVERY' || w.authoredPlanMode === 'TAPER') continue;
    if (!w.completedMi.ok) continue;
    if (w.completedMi.value > best) best = w.completedMi.value;
  }
  if (best <= 0) {
    return absent('no representative completed week to price a provisional ceiling from');
  }
  return measured(demandCeilingForWeek({
    weeklyMi: best,
    longRunMi: input.plan.nextWeekLongRunMi,
    qualityMinutes: input.plan.nextWeekQualityMinutes,
  }));
}

const WORLDS: readonly World[] = [
  {
    id: 'A',
    label: 'today · a load HOLD suppresses a material increase',
    reading: 'LEGACY_HOLD_PRESENCE',
    ceiling: () => absent('the legacy reading never consulted a ceiling'),
    queues: false,
  },
  {
    id: 'C-absent',
    label: 'reading C, live posture · no demand model, so rule 1 cannot fire',
    reading: 'WEEK_DEMAND_CEILING',
    ceiling: (i) => i.athleteCeilingWeeklyDemand,
    queues: true,
  },
  {
    id: 'C-probe',
    label: 'reading C, sensitivity probe · a provisional ceiling from his own peak week',
    reading: 'WEEK_DEMAND_CEILING',
    ceiling: provisionalCeiling,
    queues: true,
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * ONE WORLD'S WALK
 * ═══════════════════════════════════════════════════════════════════════ */

type Bucket = 'APPLIED' | 'DEFERRED' | 'REMAINS SUPPRESSED';

interface Landing {
  readonly asOfISO: string;
  readonly lever: CanonicalLever;
  readonly decision: string;
  readonly beforeValue: number;
  readonly proposedAfterValue: number;
  readonly magnitude: string;
  readonly bucket: Bucket;
  readonly detail: string;
}

interface WorldResult {
  readonly landings: readonly Landing[];
  readonly beliefTrail: ReadonlyArray<{ date: string; threshold: number; weekly: number; long: number }>;
  readonly anchorStart: number;
  readonly anchorEnd: number;
}

/**
 * `LeverVerdict` back out of a decision record.
 *
 * Every field `arbitrate` reads is carried on the record verbatim, so this is a
 * projection, not a reconstruction. Evaluating the levers ONCE per boundary and
 * arbitrating the identical verdicts three ways is what makes the comparison
 * mean anything: the worlds differ in arbitration and in nothing else.
 */
const verdictOf = (r: CanonicalDecisionRecord): LeverVerdict => ({
  lever: r.lever,
  decision: r.decision,
  beforeValue: r.beforeValue,
  proposedAfterValue: r.proposedAfterValue,
  magnitude: r.magnitude,
  included: r.evidenceIncluded,
  excluded: r.evidenceExcluded,
  contradictory: r.contradictory,
  windowDays: r.windowDays,
  confidence: r.confidence,
  reason: r.reason,
  whatWouldChangeIt: r.whatWouldChangeIt,
});

function landingFor(
  world: World,
  a: ArbitratedVerdict,
  record: CanonicalDecisionRecord,
): { bucket: Bucket; detail: string } {
  if (a.suppressedBy === null) return { bucket: 'APPLIED', detail: 'survived arbitration' };

  if (!world.queues) {
    // The legacy world's own words. `SuppressionNote.rule` is a LIVE-ENGINE
    // vocabulary and its only week-level code is `WEEK_AT_DEMAND_CEILING`,
    // which the legacy rule never asked about: it suppressed on the PRESENCE of
    // a load HOLD. Printing that code here would put a sentence about a ceiling
    // over a decision no ceiling was consulted for, which is the Rule 16 defect
    // this whole change exists to fix, reappearing in the report about it.
    const by = a.suppressedBy.by;
    const detail = a.suppressedBy.rule === 'ONE_MATERIAL_LEVER_PER_CYCLE'
      ? 'another lever was already making a material change this cycle, and nothing carried it forward'
      : `a ${by} HOLD suppressed a material increase, and nothing carried it forward`;
    return { bucket: 'REMAINS SUPPRESSED', detail };
  }

  // Under reading C the suppression is offered to the queue, and whether it
  // survives is the queue's answer rather than this file's opinion.
  const queued = enqueueDeferrals([], [{ ...record, suppressedBy: a.suppressedBy }]);
  if (queued.length === 0) {
    return {
      bucket: 'REMAINS SUPPRESSED',
      detail: `${a.suppressedBy.rule}, which is not a queueable deferral`,
    };
  }
  return {
    bucket: 'DEFERRED',
    detail: `${a.suppressedBy.rule} · reconsidered ${queued[0].nextBoundaryISO ?? 'at the next boundary'}`,
  };
}

function walkWorld(world: World, boundaries: readonly string[]): WorldResult {
  const belief: { -readonly [K in keyof CapacityBelief]: CapacityBelief[K] } = {
    thresholdPaceSecPerMi: SEED_THRESHOLD_SEC_PER_MI,
    weeklyVolumeMi: SEED_WEEKLY_MI,
    longRunMi: SEED_LONG_MI,
    supportingSessionCount: 0,
    oldestSupportingDateISO: null,
  };
  const steps: Record<CanonicalLever, number> = {
    THRESHOLD_PACE: 0, WEEKLY_VOLUME: 0, LONG_RUN: 0,
  };
  let lastCutbackSeen: string | null = null;
  let anchorMovedOn: string | null = null;

  const landings: Landing[] = [];
  const beliefTrail: Array<{ date: string; threshold: number; weekly: number; long: number }> = [];

  for (const asOfISO of boundaries) {
    const { input } = buildInputAt({
      asOfISO,
      boundary: 'WEEKLY_BOUNDARY',
      belief: { ...belief },
      stepsTakenThisCycle: steps,
      anchorMovedTodayForLever: { THRESHOLD_PACE: anchorMovedOn === asOfISO },
    }, SEALED);

    // "One step per cutback cycle" means the counters reset at a cutback.
    const cutback = [...input.weeks].reverse().find((w) => w.isCutback)?.weekStartISO ?? null;
    if (cutback !== null && cutback !== lastCutbackSeen) {
      lastCutbackSeen = cutback;
      steps.THRESHOLD_PACE = 0; steps.WEEKLY_VOLUME = 0; steps.LONG_RUN = 0;
    }

    const records = evaluateAdaptation(input).records;
    const arbitrated = arbitrate({
      verdicts: records.map(verdictOf),
      baseWeeklyMi: input.plan.nextWeekPrescribedMi,
      baseLongRunMi: input.plan.nextWeekLongRunMi,
      baseQualityMinutes: input.plan.nextWeekQualityMinutes,
      athleteCeilingWeeklyDemand: world.ceiling(input),
      nextBoundaryISO: input.plan.nextCutbackBoundaryISO ?? input.plan.nextWeekStartISO,
      reading: world.reading,
    }).arbitrated;

    for (const a of arbitrated) {
      const record = records.find((r) => r.lever === a.verdict.lever);
      if (record === undefined) continue;
      if (NON_MOVING_DECISIONS.has(record.decision)) continue;
      if (record.proposedAfterValue === null || record.magnitude === null) continue;

      const { bucket, detail } = landingFor(world, a, record);
      landings.push({
        asOfISO,
        lever: record.lever,
        decision: record.decision,
        beforeValue: record.beforeValue,
        proposedAfterValue: record.proposedAfterValue,
        magnitude: `${record.magnitude.value > 0 ? '+' : ''}${record.magnitude.value} ${record.magnitude.unit}`,
        bucket,
        detail,
      });

      if (bucket !== 'APPLIED') continue;

      // Applied exactly as a deployment would apply it.
      if (record.lever === 'THRESHOLD_PACE') {
        belief.thresholdPaceSecPerMi = record.proposedAfterValue;
        anchorMovedOn = asOfISO;
        steps.THRESHOLD_PACE += 1;
      } else if (record.lever === 'WEEKLY_VOLUME') {
        belief.weeklyVolumeMi = record.proposedAfterValue;
        steps.WEEKLY_VOLUME += 1;
      } else {
        belief.longRunMi = record.proposedAfterValue;
        steps.LONG_RUN += 1;
      }
      belief.supportingSessionCount = record.confidence.supportingCount;
      belief.oldestSupportingDateISO =
        [...record.evidenceIncluded].map((e) => e.dateISO).sort()[0]
        ?? belief.oldestSupportingDateISO;
    }

    beliefTrail.push({
      date: asOfISO,
      threshold: belief.thresholdPaceSecPerMi,
      weekly: belief.weeklyVolumeMi,
      long: belief.longRunMi,
    });
  }

  return {
    landings,
    beliefTrail,
    anchorStart: SEED_THRESHOLD_SEC_PER_MI,
    anchorEnd: belief.thresholdPaceSecPerMi,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * FRESHNESS · is the sealed snapshot still what production holds
 * ═══════════════════════════════════════════════════════════════════════ */

interface Freshness {
  readonly checked: boolean;
  readonly detail: string;
}

async function checkFreshness(): Promise<Freshness> {
  if (!readOnlyConnectionConfigured()) {
    return {
      checked: false,
      detail:
        'DATABASE_URL_RO is not set, so the snapshot could not be checked against production. '
        + 'The table below is still a faithful replay of the sealed history; whether that '
        + 'history is current is UNKNOWN, which is not the same as current.',
    };
  }
  try {
    // Rule 14 · the population is named: this athlete by uuid, canonical rows
    // only, through the ONE absorption predicate rather than a re-typed copy.
    const r = await roQuery<{ first: string | null; last: string | null; n: string }>(
      `SELECT MIN(${runDaySql()}) AS first,
              MAX(${runDaySql()}) AS last,
              COUNT(*)::text AS n
         FROM runs
        WHERE user_uuid = $1::uuid
          AND ${runNotMergedSql()}
          AND ${runDaySql()} IS NOT NULL`,
      [ATHLETE_ID],
    );
    const row = r.rows[0];
    if (!row) return { checked: false, detail: 'The freshness probe returned no rows.' };
    const snapCount = SEALED.runs.total;
    const live = Number(row.n);
    const drift = live - snapCount;
    return {
      checked: true,
      detail:
        `Production holds ${live} canonical runs for this athlete, ${row.first} to ${row.last}. `
        + `The sealed snapshot holds ${snapCount}, extracted ${SEALED.extractedAtISO}. `
        + (drift === 0
          ? 'No drift.'
          : `DRIFT of ${drift} run(s): the table below replays the snapshot, not today's rows.`),
    };
  } catch (e) {
    return {
      checked: false,
      detail:
        'The freshness probe against production FAILED: '
        + `${e instanceof Error ? e.message : String(e)}. That is not the same as "no drift".`,
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE REPORT
 * ═══════════════════════════════════════════════════════════════════════ */

const paceText = (secPerMi: number): string => {
  const m = Math.floor(secPerMi / 60);
  const s = Math.round(secPerMi - m * 60);
  return `${m}:${String(s).padStart(2, '0')}/mi`;
};

function render(
  results: ReadonlyMap<string, WorldResult>,
  boundaries: readonly string[],
  freshness: Freshness,
): string {
  const L: string[] = [];
  const p = (s = '') => L.push(s);
  const worldIds = WORLDS.map((w) => w.id);

  p("# Counterfactual · arbitration reading C against the owner's real history");
  p();
  p('Generated by `web-v2/lib/adaptation/canonical/_counterfactual.script.ts`');
  p('(`npm --prefix web-v2 run counterfactual`).');
  p();
  p('## What was replayed');
  p();
  p('| | |');
  p('|---|---|');
  p(`| athlete | \`${ATHLETE_ID}\` |`);
  p(`| substrate | \`scripts/adaptation-real-replay/real-history.snapshot.json\` |`);
  p(`| runs in the snapshot | ${SEALED.runs.total} |`);
  p(`| prescriptions | ${SEALED.planWorkouts.total} |`);
  p(`| weekly boundaries walked | ${boundaries.length} (${boundaries[0]} to ${boundaries[boundaries.length - 1]}) |`);
  p(`| belief seed | threshold ${paceText(SEED_THRESHOLD_SEC_PER_MI)}, ${SEED_WEEKLY_MI} mi/wk, ${SEED_LONG_MI} mi long |`);
  p();
  p('**Freshness against production.** ' + freshness.detail);
  p();
  p('## The three worlds');
  p();
  p('| id | rule 1 | ceiling | deferrals queued |');
  p('|---|---|---|---|');
  for (const w of WORLDS) {
    const ceil = w.reading === 'LEGACY_HOLD_PRESENCE'
      ? 'not consulted'
      : w.id === 'C-absent' ? 'absent, as live' : 'provisional probe';
    p(`| **${w.id}** | ${w.label} | ${ceil} | ${w.queues ? 'yes' : 'no'} |`);
  }
  p();
  p('Each world carries its OWN belief forward, so from the first divergence');
  p('onward they are describing different seasons. That is what a counterfactual');
  p('is, and it is also its main limitation: every later row is conditional on');
  p('the earlier ones.');
  p();

  /* ── Headline ──────────────────────────────────────────────────────────── */

  p('## Headline');
  p();
  p('| world | proposals | APPLIED | DEFERRED | REMAINS SUPPRESSED | threshold anchor |');
  p('|---|---:|---:|---:|---:|---|');
  for (const id of worldIds) {
    const r = results.get(id);
    if (r === undefined) continue;
    const c = { APPLIED: 0, DEFERRED: 0, 'REMAINS SUPPRESSED': 0 } as Record<Bucket, number>;
    for (const l of r.landings) c[l.bucket] += 1;
    const moved = r.anchorStart - r.anchorEnd;
    p(`| ${id} | ${r.landings.length} | ${c.APPLIED} | ${c.DEFERRED} | ${c['REMAINS SUPPRESSED']} `
      + `| ${paceText(r.anchorStart)} to ${paceText(r.anchorEnd)} (${moved > 0 ? '-' : '+'}${Math.abs(moved)} s/mi) |`);
  }
  p();

  p('### By lever');
  p();
  p(`| lever | ${worldIds.map((id) => `${id} applied`).join(' | ')} |`);
  p(`|---|${worldIds.map(() => '---:').join('|')}|`);
  for (const lever of ['WEEKLY_VOLUME', 'LONG_RUN', 'THRESHOLD_PACE'] as const) {
    const cells = worldIds.map((id) => {
      const r = results.get(id);
      if (r === undefined) return '0';
      const mine = r.landings.filter((l) => l.lever === lever);
      return `${mine.filter((l) => l.bucket === 'APPLIED').length} of ${mine.length}`;
    });
    p(`| ${lever} | ${cells.join(' | ')} |`);
  }
  p();

  /* ── Every proposal, per world ─────────────────────────────────────────── */

  p('## Every proposal each world made, and where it landed');
  p();
  p('The worlds are listed separately rather than side by side, because they');
  p('carry different beliefs: after the first divergence they are not making the');
  p('same proposals about the same numbers, and a shared row would imply they');
  p('were.');
  p();
  for (const w of WORLDS) {
    const r = results.get(w.id);
    if (r === undefined) continue;
    p(`### World ${w.id} · ${w.label}`);
    p();
    p('| boundary | lever | decision | move | landed | why |');
    p('|---|---|---|---|---|---|');
    for (const l of r.landings) {
      const move = l.lever === 'THRESHOLD_PACE'
        ? `${paceText(l.beforeValue)} to ${paceText(l.proposedAfterValue)} (${l.magnitude})`
        : `${l.beforeValue} to ${l.proposedAfterValue} (${l.magnitude})`;
      p(`| ${l.asOfISO} | ${l.lever} | ${l.decision} | ${move} | **${l.bucket}** | ${l.detail} |`);
    }
    if (r.landings.length === 0) p('| _no proposal at any boundary_ | | | | | |');
    p();
  }

  /* ── Belief trails ─────────────────────────────────────────────────────── */

  p('## Where the belief ended up');
  p();
  p(`| boundary | ${worldIds.map((id) => `${id} anchor`).join(' | ')} |`);
  p(`|---|${worldIds.map(() => '---').join('|')}|`);
  for (let i = 0; i < boundaries.length; i += 1) {
    const cells = worldIds.map((id) => {
      const t = results.get(id)?.beliefTrail[i];
      return t === undefined ? 'n/a' : paceText(t.threshold);
    });
    p(`| ${boundaries[i]} | ${cells.join(' | ')} |`);
  }
  p();

  p('## What this cannot tell you');
  p();
  p("Reproduced from the script's own header so the table is never read without it:");
  p();
  p('- A wrong input produces a confident, well-formed, wrong row, and nothing here');
  p('  would notice. Every criticism `build-input.ts` makes of itself applies.');
  p('- It counts where proposals land. It says nothing about whether the season that');
  p('  followed would have been better for him.');
  p('- The provisional ceiling is a sensitivity probe, not a demand model.');
  p('- Weekly boundaries only. A session-boundary proposal is deferred by the cadence');
  p('  rule under every reading, so including them would add identical rows to every');
  p('  column.');
  p();
  return L.join('\n');
}

/* ══════════════════════════════════════════════════════════════════════════
 * ENTRY
 * ═══════════════════════════════════════════════════════════════════════ */

describe('counterfactual · reading C against real history', () => {
  it('replays every weekly boundary under all three readings', async () => {
    const boundaries = mondays(FIRST_BOUNDARY, LAST_BOUNDARY);
    const freshness = await checkFreshness();

    const results = new Map<string, WorldResult>();
    for (const w of WORLDS) results.set(w.id, walkWorld(w, boundaries));

    const md = render(results, boundaries, freshness);
    const dir = path.dirname(OUT_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(OUT_PATH, md, 'utf8');

    // Printed as well as written, so a run that cannot reach the filesystem
    // still tells the operator what it found.
    // eslint-disable-next-line no-console
    console.log(md.split('\n').slice(0, 46).join('\n'));
    // eslint-disable-next-line no-console
    console.log(`\n[counterfactual] wrote ${OUT_PATH}`);
  }, 600_000);
});
