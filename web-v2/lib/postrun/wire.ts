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
  };
}
