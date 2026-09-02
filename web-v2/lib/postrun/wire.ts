/**
 * lib/postrun/wire.ts · the post-run experience as the PHONE reads it.
 *
 * PURE. One mapper, two consumers — `/api/v5/today` (after a run) and
 * `/api/runs/[id]` (run detail). Both send the same object under the same key,
 * from the same composer, so the brief's first P0 ("two post-run compositions
 * can disagree") is answered by construction rather than by two call sites
 * agreeing.
 *
 * ── WHY A SEPARATE WIRE SHAPE ───────────────────────────────────────────────
 *
 * `PostRunExperienceV1` carries reason codes, evidence domains, confidence
 * bands and the full explanation object. None of that is for a runner, and
 * `PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md` is explicit: only surface information
 * that changes what the runner should understand or do next. So the wire is the
 * brief's §4 Layer 1 and Layer 3 and nothing else:
 *
 *   headline   the answer, three to eight words
 *   summary    what happened to the intended workout, one sentence
 *   cost       what it cost, one sentence — NULL when nothing honest can be said
 *   learned    what the run taught the coach
 *   change     the plan's own word for what moved
 *   changes    the lines, when something did
 *   next       only when the plan does not already say it
 *   why        the disclosure body: what was withheld and why
 *
 * `changeState` travels as a CODE, not a colour, because the design contract
 * forbids encoding an outcome only by colour and a phone that switched on a
 * sentence would break the moment the sentence changed.
 */
import type { PostRunExperienceV1 } from './experience';
import { certaintyHedge } from '@/lib/faff/explanation';
import { fmtClock, fmtPaceSlash } from '@/lib/format/run';

export interface PostRunWire {
  version: string;
  runId: string;
  dateISO: string;
  /** Identical on both surfaces for one run. The cross-surface check. */
  decisionVersion: string;
  headline: string;
  summary: string;
  cost: string | null;
  learned: string;
  change: string;
  changeState: string;
  changes: string[];
  next: string | null;
  why: string[];
  accessibilitySummary: string;
  /**
   * THE RECORDING'S OWN HONESTY, and null when there is nothing to say.
   *
   * Rule 11 applied to distance: "we recorded 5.98 miles" and "he ran 5.98
   * miles" are two facts, and every post-run surface used to print the first
   * in a way that could only be read as the second. When the run's own
   * `clockAudit` says the tracker stopped counting, this sentence goes ABOVE
   * the numbers, because a caveat under a total is a caveat nobody reads.
   */
  capture: string | null;
  /**
   * The same reconciliation as numbers, so the phone can lay out three
   * quantities against one total without parsing the sentence.
   *
   * `total` is the run. `structured` is what the phase list accounts for.
   * `overtime` is the difference — real running after the last prescribed
   * piece, belonging to the run and to no phase. `splitCount` is how many rows
   * the mile table can draw. On the 2026-09-02 run these are 6.41, 5.98, 0.43
   * and 5, and a screen that shows any one of them alone is wrong.
   */
  coverage: {
    totalDistanceMi: number | null;
    structuredDistanceMi: number | null;
    overtimeDistanceMi: number | null;
    overtimeDurationSec: number | null;
    splitCount: number | null;
    splitDistanceMi: number | null;
  };
  /**
   * The strides, when the session had them. NULL when it did not, so the phone
   * draws no section rather than an empty one.
   *
   * Sent as ROWS rather than a sentence because the runner's complaint was
   * that they were not shown at all, and six accelerations with their own
   * paces, heart rates and cadences are exactly the thing a summary cannot
   * carry. Nothing here is a verdict — see `readStrides`.
   */
  strides: PostRunStridesWire | null;
}

export interface PostRunStrideWire {
  ordinal: number;
  label: string | null;
  /** "0:20". */
  duration: string | null;
  /** "5:47/mi". Present because a stride HAS a pace; it is never compared to
   *  a target here, and no field on this type can carry one. */
  pace: string | null;
  hr: number | null;
  distanceMi: number | null;
  /* NO CADENCE. `PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md` and the post-run
   * brief's own HIDE-BY-DEFAULT list both name "raw cadence" specifically, and
   * its P2 cleanup says "remove/defer cadence unless interpreted". The strides
   * DO carry a cadence (157-177 spm on 2026-09-02) and it is on the server-side
   * `PostRunStride` for a reader that can interpret it. A column of numbers
   * that changes nothing the runner does next is not that reader. */
}

export interface PostRunStridesWire {
  /** One sentence. Completion, never compliance. */
  summary: string;
  rows: PostRunStrideWire[];
  /** How many walk-backs the wrist recorded between them, and how far they
   *  covered — part of the drill, and part of the distance the mile table
   *  does not describe. */
  recoveryCount: number;
  recoveryDistanceMi: number | null;
}


export function postRunWire(x: PostRunExperienceV1): PostRunWire {
  const hedge = certaintyHedge(x.briefing.certainty);
  return {
    version: x.version,
    runId: x.runId,
    dateISO: x.dateISO,
    decisionVersion: x.decisionVersion,
    headline: x.execution.headline,
    summary: x.execution.summary,
    cost: x.cost.summary,
    learned: x.evidence.runnerSummary,
    change: x.plan.runnerSummary,
    changeState: x.plan.status,
    changes: x.plan.changes,
    next: x.next.summary,
    /* THE "WHY" BODY.
     *
     * What was withheld and why, plus the hedge that belongs to this
     * certainty — and NOT a restatement of the four sentences above it. Rule
     * 17: the runner reads a sentence once, and this disclosure exists to add
     * what the card had no room for, not to repeat it in a longer font. */
    why: [
      ...(x.briefing.whyNot ?? []).map((w) => w.display),
      ...(hedge ? [hedge] : []),
    ],
    accessibilitySummary: x.briefing.accessibilitySummary,
    capture: x.capture.summary,
    coverage: {
      totalDistanceMi: x.capture.totalDistanceMi,
      structuredDistanceMi: x.capture.structuredDistanceMi,
      overtimeDistanceMi: x.capture.overtimeDistanceMi,
      overtimeDurationSec: x.capture.overtimeDurationSec,
      splitCount: x.capture.splitCount,
      splitDistanceMi: x.capture.splitDistanceMi,
    },
    strides: x.strides == null ? null : {
      summary: x.strides.summary,
      rows: x.strides.strides.map((s) => ({
        ordinal: s.ordinal,
        label: s.label,
        duration: fmtClock(s.durationSec),
        pace: fmtPaceSlash(s.paceSecPerMi),
        hr: s.avgHr,
        distanceMi: s.distanceMi,
      })),
      recoveryCount: x.strides.recoveryCount,
      recoveryDistanceMi: x.strides.recoveryDistanceMi,
    },
  };
}
