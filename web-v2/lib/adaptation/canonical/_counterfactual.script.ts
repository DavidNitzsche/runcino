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
 * So this replays every weekly boundary of the owner's real training under BOTH
 * readings of arbitration rule 1, carrying a SEPARATE belief forward in each,
 * and reports where every proposal the engine has ever made lands:
 *
 *     APPLIED             · survived arbitration and moved the belief
 *     DEFERRED            · suppressed AND queued, with the boundary named,
 *                           and the boundary it came back at once it did
 *     REMAINS SUPPRESSED  · suppressed and NOT queued, with the reason named
 *     REFUSED             · the engine declined to answer for want of
 *                           admissible evidence, which is not a suppression
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
 * · WHETHER THE CEILING IS THE RIGHT NUMBER. World C now uses the REAL demand
 *   model (`lib/plan/adjudication/weekly-demand.ts`, through
 *   `canonical/demand-ceiling.ts`), which is a large improvement on the
 *   provisional probe this file used to carry — but five of that model's
 *   coefficients are labelled POLICY_ASSUMPTION and nobody has calibrated them.
 *   Wiring the model in made the ceiling REAL. It did not make it RIGHT, and
 *   those are different claims.
 * · THE BASIS. When one absorbed week's context cannot be reconstructed the
 *   whole comparison degrades to BASE_ONLY, symmetrically and legally, and the
 *   table below records which basis was used. Nothing here can tell you what a
 *   FULL_CONTEXT comparison would have concluded on the weeks it could not
 *   price.
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
import {
  arbitrate,
  type ArbitrationReading, type ArbitratedVerdict, type DemandCeilingPosture,
} from './arbitration';
import { resolveArbitrationPriority } from './phase-priority';
import { enqueueDeferrals, reconsiderAtBoundary, type QueuedDeferral } from './deferral-queue';
import type { AthleteWeeklyDemandCeiling } from './demand-ceiling';
import {
  absent,
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
  readonly ceiling: (input: CanonicalAdaptationInput) => Measured<AthleteWeeklyDemandCeiling>;
  /** Whether a suppressed proposal survives as a queued deferral. */
  readonly queues: boolean;
}

const WORLDS: readonly World[] = [
  {
    id: 'A',
    label: 'today · a load HOLD suppresses a material increase, and nothing is queued',
    reading: 'LEGACY_HOLD_PRESENCE',
    ceiling: () => absent('the legacy reading never consulted a ceiling'),
    queues: false,
  },
  {
    id: 'C',
    label: 'reading C · the REAL weekly demand model, and a queue that carries deferrals',
    reading: 'WEEK_DEMAND_CEILING',
    // The loader's own ceiling, resolved by `resolveAthleteWeeklyDemandCeiling`
    // out of `lib/plan/adjudication/weekly-demand.ts` against his own absorbed
    // weeks. NOT a probe, not a stand-in, and not invented here — the same
    // function and the same code path the live loader calls.
    ceiling: (i) => i.athleteCeilingWeeklyDemand,
    queues: true,
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * ONE WORLD'S WALK
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Where a proposal landed. `REFUSED` is a fourth bucket and is NOT a kind of
 * suppression: it is the engine declining to answer for want of admissible
 * evidence, which the contract treats as a successful evaluation.
 */
type Bucket = 'APPLIED' | 'DEFERRED' | 'REMAINS SUPPRESSED' | 'REFUSED';

interface Landing {
  readonly asOfISO: string;
  readonly lever: CanonicalLever;
  readonly decision: string;
  readonly beforeValue: number;
  readonly proposedAfterValue: number;
  readonly magnitude: string;
  readonly bucket: Bucket;
  readonly detail: string;
  /** The sessions that justified it, and how many were excluded. */
  readonly evidence: string;
  /** The demand arithmetic rule 1 actually did, or why it could not. */
  readonly demand: string;
  /** The belief AFTER this boundary, so a reader can follow the trajectory.
   *  Filled in once the whole boundary has been applied — a per-row snapshot
   *  taken mid-loop would show a belief that never existed. */
  beliefAfter: string;
  /**
   * For a DEFERRED proposal, the boundary at which the queue re-offered it and
   * what happened there. Filled in on a second pass, once the walk knows.
   */
  returned: string;
  /** One sentence the runner could actually be shown. */
  readonly runnerSentence: string;
}

interface WorldResult {
  readonly landings: readonly Landing[];
  readonly beliefTrail: ReadonlyArray<{ date: string; threshold: number; weekly: number; long: number }>;
  readonly anchorStart: number;
  readonly anchorEnd: number;
  /** Every ceiling posture the walk saw, counted. Rule 11 made visible. */
  readonly ceilingPostures: Record<string, number>;
  /** What the queue did across the whole walk. */
  readonly queueEvents: readonly string[];
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

/** The evidence behind one proposal, in one cell. */
function evidenceCell(r: CanonicalDecisionRecord): string {
  const dates = [...r.evidenceIncluded].map((e) => e.dateISO).sort();
  const span = dates.length === 0 ? 'none' : `${dates[0]} to ${dates[dates.length - 1]}`;
  const excluded = r.evidenceExcluded.length;
  return `${r.evidenceIncluded.length} admitted (${span}), ${excluded} excluded, `
    + `${r.windowDays}-day window, confidence ${r.confidence.supportingCount} supporting`;
}

/**
 * The demand arithmetic rule 1 actually did, or the honest reason it could not.
 *
 * Rule 11 · the three postures produce three different sentences here, so a
 * reader of the table can tell "the week had room" from "nobody knew what the
 * week's ceiling was". Collapsing them into one dash is the whole defect.
 */
function demandCell(
  posture: DemandCeilingPosture,
  a: ArbitratedVerdict,
  base: number,
  projected: number,
): string {
  if (!posture.rule1CanFire) {
    return `${posture.kind} · rule 1 did not run. ${posture.detail.slice(0, 120)}`;
  }
  const head = `week ${base.toFixed(1)} to ${projected.toFixed(1)} EEM against a ceiling of `
    + `${posture.value.toFixed(1)} on ${posture.basis}`;
  const share = `${(a.demandShare * 100).toFixed(2)}% of the week`;
  const over = projected > posture.value;
  return `${head} · this proposal moves ${share} · ${over ? 'OVER' : 'within'}`;
}

/**
 * The sentence a runner could actually be shown for this landing.
 *
 * The contract's acceptance test is one of these, verbatim, and the others are
 * written in the same voice: short, no hype, no exclamation, states the
 * evidence and the consequence and nothing else (CLAUDE.md's coach-voice rule).
 */
function runnerSentence(
  bucket: Bucket,
  r: CanonicalDecisionRecord,
  a: ArbitratedVerdict,
): string {
  const what = r.lever === 'THRESHOLD_PACE'
    ? 'threshold pace'
    : r.lever === 'WEEKLY_VOLUME' ? 'weekly volume' : 'long run';
  if (bucket === 'APPLIED') {
    return `Your ${what} evidence supports this change, and the week has room for it, so it is made now.`;
  }
  if (bucket === 'REFUSED') {
    return `There is not enough admissible evidence to move your ${what} yet. ${r.whatWouldChangeIt[0] ?? ''}`.trim();
  }
  if (a.suppressedBy?.rule === 'ONE_MATERIAL_LEVER_PER_CYCLE') {
    return `Your ${what} evidence supports this change, but another change is already being `
      + 'made this cycle, so it waits until the next appropriate boundary.';
  }
  if (a.suppressedBy?.rule === 'WEEK_AT_DEMAND_CEILING') {
    return `Your ${what} evidence supports a change, but this week already contains enough `
      + 'total demand, so the change is deferred until the next appropriate boundary.';
  }
  return `Your ${what} evidence supports this change. ${a.suppressedBy?.detail ?? ''}`.trim();
}

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
    detail: `${a.suppressedBy.rule} · due ${queued[0].nextBoundaryISO ?? 'at the next boundary'}`,
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
  const ceilingPostures: Record<string, number> = {};
  const queueEvents: string[] = [];

  /**
   * THE DURABLE QUEUE, WALKED FOR REAL.
   *
   * The earlier draft of this script offered each suppression to
   * `enqueueDeferrals([])` — an EMPTY queue, one boundary at a time — which
   * proved a record was queueABLE and nothing else. This carries the queue
   * across boundaries exactly as `run-live-shadow-evaluation.ts` does, so the
   * table can answer the question the owner asked: when did a deferred
   * proposal actually come back, and what happened to it.
   */
  let queue: readonly QueuedDeferral[] = [];
  /** queueId → the landing row that queued it, so `returned` can be filled in. */
  const queuedBy = new Map<string, Landing>();

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
    const result = arbitrate({
      verdicts: records.map(verdictOf),
      // The counterfactual compares two READINGS of rule 1, not two lever
      // orderings, so both sides get the priority the live engine resolved for
      // this same input. `arbitrate` uses the phase-neutral order for
      // LEGACY_HOLD_PRESENCE regardless, which is what the pre-2026-09-04
      // engine had.
      priority: resolveArbitrationPriority({
        phase: input.phaseContext.phase,
        raceDistance: input.race.raceDistance,
        limiter: input.phaseContext.limiter,
        safety: input.phaseContext.safety,
        stepsTakenThisCycle: input.plan.stepsTakenThisCycle,
      }),
      baseWeekStartISO: input.plan.nextWeekStartISO,
      baseWeeklyMi: input.plan.nextWeekPrescribedMi,
      baseLongRunMi: input.plan.nextWeekLongRunMi,
      baseQualityMinutes: input.plan.nextWeekQualityMinutes,
      athleteCeilingWeeklyDemand: world.ceiling(input),
      nextBoundaryISO: input.plan.nextCutbackBoundaryISO ?? input.plan.nextWeekStartISO,
      reading: world.reading,
    });
    const arbitrated = result.arbitrated;
    ceilingPostures[result.demandCeiling.kind] = (ceilingPostures[result.demandCeiling.kind] ?? 0) + 1;

    /* ── The queue, BEFORE this boundary's proposals are added to it ────────
     *
     * Reconsider first, so a queued item is judged against the fresh records
     * this boundary just produced. That is the order the live caller uses and
     * the reason it matters: an item superseded by a fresh proposal must hand
     * over to it rather than compete with it. */
    if (world.queues && queue.length > 0) {
      const outcome = reconsiderAtBoundary({
        queue,
        atISO: asOfISO,
        freshRecords: records,
        currentPlanVersion: input.planVersion,
        blockEndedISO: input.race.raceDateISO < asOfISO ? input.race.raceDateISO : null,
      });
      for (const ex of outcome.expired) {
        const origin = queuedBy.get(ex.item.queueId);
        if (origin) origin.returned = `${asOfISO} · ${ex.expiry}`;
        queueEvents.push(`${asOfISO} · ${ex.item.lever} left the queue · ${ex.expiry}`);
      }
      for (const it of outcome.reconsidered) {
        if (outcome.carried.some((c) => c.queueId === it.queueId)) {
          const origin = queuedBy.get(it.queueId);
          if (origin) origin.returned = `${asOfISO} · re-offered, still queued`;
          queueEvents.push(`${asOfISO} · ${it.lever} was re-offered and stays queued`);
        }
      }
      queue = outcome.carried;
    }

    const thisBoundary: Landing[] = [];

    for (const a of arbitrated) {
      const record = records.find((r) => r.lever === a.verdict.lever);
      if (record === undefined) continue;

      const moves = !NON_MOVING_DECISIONS.has(record.decision)
        && record.proposedAfterValue !== null && record.magnitude !== null;

      // REFUSE is reported, not dropped. A boundary where the engine could not
      // answer is a different fact from one where it said no, and a table that
      // shows only proposals hides the refusals entirely (Rule 11).
      if (!moves) {
        if (record.decision !== 'REFUSE') continue;
        thisBoundary.push({
          asOfISO, lever: record.lever, decision: record.decision,
          beforeValue: record.beforeValue, proposedAfterValue: record.beforeValue,
          magnitude: 'none',
          bucket: 'REFUSED',
          detail: record.reason.slice(0, 160),
          evidence: evidenceCell(record),
          demand: demandCell(result.demandCeiling, a, result.baseLoad.demandIndex, result.baseLoad.demandIndex),
          beliefAfter: '',
          returned: 'n/a',
          runnerSentence: runnerSentence('REFUSED', record, a),
        });
        continue;
      }

      const { bucket, detail } = landingFor(world, a, record);
      const projected = result.baseLoad.demandIndex * (1 + a.demandShare);
      const landing: Landing = {
        asOfISO,
        lever: record.lever,
        decision: record.decision,
        beforeValue: record.beforeValue,
        proposedAfterValue: record.proposedAfterValue!,
        magnitude: `${record.magnitude!.value > 0 ? '+' : ''}${record.magnitude!.value} ${record.magnitude!.unit}`,
        bucket,
        detail,
        evidence: evidenceCell(record),
        demand: demandCell(result.demandCeiling, a, result.baseLoad.demandIndex, projected),
        beliefAfter: '',
        returned: bucket === 'DEFERRED' ? 'not yet' : 'n/a',
        runnerSentence: runnerSentence(bucket, record, a),
      };
      thisBoundary.push(landing);

      if (bucket === 'DEFERRED' && world.queues) {
        const added = enqueueDeferrals(queue, [{ ...record, suppressedBy: a.suppressedBy }]);
        for (const q of added) if (!queuedBy.has(q.queueId)) queuedBy.set(q.queueId, landing);
        queue = added;
      }

      if (bucket !== 'APPLIED') continue;

      // Applied exactly as a deployment would apply it.
      if (record.lever === 'THRESHOLD_PACE') {
        belief.thresholdPaceSecPerMi = record.proposedAfterValue!;
        anchorMovedOn = asOfISO;
        steps.THRESHOLD_PACE += 1;
      } else if (record.lever === 'WEEKLY_VOLUME') {
        belief.weeklyVolumeMi = record.proposedAfterValue!;
        steps.WEEKLY_VOLUME += 1;
      } else {
        belief.longRunMi = record.proposedAfterValue!;
        steps.LONG_RUN += 1;
      }
      belief.supportingSessionCount = record.confidence.supportingCount;
      belief.oldestSupportingDateISO =
        [...record.evidenceIncluded].map((e) => e.dateISO).sort()[0]
        ?? belief.oldestSupportingDateISO;
    }

    // The resulting belief, stamped on every row of this boundary AFTER the
    // whole boundary has been applied — because two levers can both land here
    // and a per-row snapshot taken mid-loop would show a belief that never
    // existed.
    const after = `T ${paceText(belief.thresholdPaceSecPerMi)} · `
      + `${belief.weeklyVolumeMi} mi/wk · ${belief.longRunMi} mi long`;
    for (const l of thisBoundary) { l.beliefAfter = after; landings.push(l); }

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
    ceilingPostures,
    queueEvents,
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
  p('## The two worlds');
  p();
  p('| id | rule 1 | ceiling | deferrals queued |');
  p('|---|---|---|---|');
  for (const w of WORLDS) {
    const ceil = w.reading === 'LEGACY_HOLD_PRESENCE'
      ? 'not consulted'
      : 'the real demand model';
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
  p('| world | proposals | APPLIED | DEFERRED | REMAINS SUPPRESSED | REFUSED | threshold anchor |');
  p('|---|---:|---:|---:|---:|---:|---|');
  for (const id of worldIds) {
    const r = results.get(id);
    if (r === undefined) continue;
    const c = { APPLIED: 0, DEFERRED: 0, 'REMAINS SUPPRESSED': 0, REFUSED: 0 } as Record<Bucket, number>;
    for (const l of r.landings) c[l.bucket] += 1;
    const moved = r.anchorStart - r.anchorEnd;
    p(`| ${id} | ${r.landings.length} | ${c.APPLIED} | ${c.DEFERRED} | ${c['REMAINS SUPPRESSED']} | ${c.REFUSED} `
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
    p('Every column the owner asked for: the evidence behind the proposal, the');
    p('demand arithmetic that judged it, where it landed, the belief that');
    p('resulted, when a deferred proposal came back, and the sentence the');
    p('runner would read.');
    p();
    p('| boundary | lever | move | evidence | demand | landed | belief after | returned | what the runner reads |');
    p('|---|---|---|---|---|---|---|---|---|');
    for (const l of r.landings) {
      const move = l.lever === 'THRESHOLD_PACE'
        ? `${paceText(l.beforeValue)} to ${paceText(l.proposedAfterValue)} (${l.magnitude})`
        : `${l.beforeValue} to ${l.proposedAfterValue} (${l.magnitude})`;
      p(
        `| ${l.asOfISO} | ${l.lever} | ${move} | ${l.evidence} | ${l.demand} `
        + `| **${l.bucket}** · ${l.detail} | ${l.beliefAfter} | ${l.returned} `
        + `| ${l.runnerSentence} |`,
      );
    }
    if (r.landings.length === 0) p('| _no proposal at any boundary_ | | | | | | | | |');
    p();
    p(`**Ceiling postures across the walk.** ${
      Object.entries(r.ceilingPostures).map(([k, n]) => `${k} x${n}`).join(', ') || 'none'
    }. A posture of ABSENT means rule 1 could not run at that boundary and `
      + 'suppressed nothing, which is not the same as a week with room.');
    p();
    if (r.queueEvents.length > 0) {
      p('**What the queue did.**');
      p();
      for (const e of r.queueEvents) p(`- ${e}`);
      p();
    } else if (w.queues) {
      p('**What the queue did.** Nothing left it and nothing was re-offered across');
      p('the whole walk.');
      p();
    }
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
  p('- The ceiling is the real demand model, and its five POLICY_ASSUMPTION');
  p('  coefficients are uncalibrated. Real is not the same as right.');
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
  it('replays every weekly boundary under both readings', async () => {
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
