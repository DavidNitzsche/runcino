/**
 * lib/coach/fitness-evidence.ts · the one execution finding wired to the
 * coach's log.
 *
 * Doctrine: `Design/execution-memory-firing.md` Part 1, "Evidence value is
 * separate from completion":
 *
 *   > Partially executed, high evidence — the athlete fails badly at a pace
 *   > previously considered established. Extremely informative.
 *
 * and the pipeline's own worked example, which is this exact shape:
 *
 *   execution: { state: PARTIAL_FAILED, stimulus_completion: 0.61 }
 *   evidence:  { adaptation: negative, fitness: low_confidence, fatigue: meaningful }
 *   coach:     { firing: SURFACE }
 *
 * `lib/execution/interpret.ts#interpretExecution` has computed this reading
 * since 2026-08-17 — `readExecution` (`lib/adaptation/adaptation-model.ts`)
 * scores it into the adaptation verdict — and `lib/execution/load.ts
 * #loadKeySessionExecutions` has resolved it for every key session since the
 * same day. Nothing ever classified it through `lib/coach/firing-policy.ts`
 * or wrote it anywhere the runner could see it: computed, scored, never
 * spoken. This module closes that one gap. It does not attempt the other
 * unwired findings the same audit surfaced (a run of PARTIAL_PRODUCTIVE
 * sessions as a pattern, REPLACED-by-race as its own entry) — one clear
 * wire, not every wire.
 *
 * ── Why this finding, checked against the code rather than assumed ────────
 *
 * The task brief that motivated this module named "PARTIAL_FAILED or
 * PARTIAL_PRODUCTIVE with evidence.fitness === 'high'" as the candidate.
 * Reading `interpretExecution` end to end narrows that: `evidence.fitness`
 * is only ever set to `'high'` via `failedAtKnownPace`, and every branch of
 * `interpretExecution` where `failedAtKnownPace` can be true requires
 * `ctx.effortCollapsed`, which in turn always resolves the branch's `state`
 * to `PARTIAL_FAILED`, never `PARTIAL_PRODUCTIVE` (the one
 * `PARTIAL_PRODUCTIVE` branch that reads `failedAtKnownPace` is reached only
 * when `!ctx.effortCollapsed`, which forces `failedAtKnownPace` false). So
 * "PARTIAL_FAILED with evidence.fitness === 'high'" is not a narrowing of
 * the brief's framing — it is the exhaustive answer, read out of the
 * current code rather than out of the doctrine text alone.
 *
 * A `REPLACED` session also carries `fitness: 'high'` (a race stood in for
 * the workout), but doctrine treats that as its own case — "replacement
 * does not mean equivalence," with its own consequence (recovery cost) —
 * not as fitness evidence about a pace that came apart. A different
 * finding, deliberately out of scope here.
 *
 * ── Why no episode suppression ─────────────────────────────────────────
 *
 * `lib/coach/episode-log.ts` exists for a PATTERN that opens and closes over
 * weeks (easy-discipline's sustained-drift finding, gated on a majority of
 * qualifying runs across several distinct weeks). This finding is not that
 * shape: it is a single dated event, informative the first time it happens,
 * with no "resolved" counterpart to close against — a session that came
 * apart at a known pace does not later un-happen. It is closer in shape to
 * `first_ever` or `week_close`: write once, keyed by date, and the existing
 * (reason, field) idempotency `coach-log.ts` already relies on is the whole
 * suppression mechanism this needs. Forcing `episode-log.ts`'s open/close
 * machine onto an event with no resolve state would be the wrong tool.
 *
 * ── Firing ──────────────────────────────────────────────────────────────
 *
 * Routed through `classifyFinding` (`lib/coach/firing-policy.ts`) by
 * `updateFitnessEvidenceLog` in `coach-log.ts` as:
 *
 *   changed: true                    — a session outcome that did not exist before today
 *   athleteNeedsToKnow: true         — it is evidence about current fitness
 *   usefulOnlyBecauseLooking: true   — surfaced in the log, never pushed
 *   isPositive: false                — a hard-day reading, not praise
 *
 * which resolves to SURFACE under the doctrine's own question order (never
 * INTERRUPT — a workout that already happened cannot qualify for any of the
 * five INTERRUPT categories in Part 3; nothing here is `explanatoryDepth`,
 * so it does not fall to AVAILABLE either). The caller only writes to the
 * log when the classification is SURFACE or louder — see Part 3's "the app
 * should be comfortable doing nothing."
 */

import { pool } from '@/lib/db/pool';
import { loadKeySessionExecutions, type KeySessionExecution } from '@/lib/execution/load';
import { establishedPaceFor } from '@/lib/execution/reconstruct';
import type { IntensityDomain } from '@/lib/execution/interpret';
import { resolveCurrentVdotSnapshot } from '@/lib/training/projection-snapshots';

/**
 * How far back to look for a not-yet-logged occurrence. Short, because this
 * rides the daily cron and most days only has to see yesterday. Wider than
 * one day purely to tolerate a missed cron tick or a late-syncing watch
 * upload — the (reason, field) idempotency `updateFitnessEvidenceLog` uses
 * means re-checking an older day costs one query, never a duplicate entry.
 * An engineering choice about read freshness, not a claim about physiology
 * — no doctrine registry entry.
 */
export const FITNESS_EVIDENCE_LOOKBACK_DAYS = 4;

export interface FitnessEvidencePartialFinding {
  dateISO: string;
  domain: IntensityDomain;
  /** 0..1 · how much of the intended stimulus landed. */
  stimulusCompletion: number;
  /** The pace this runner has established for the domain, s/mi — the anchor
   *  that makes the failure "at a pace previously considered established"
   *  rather than just a bad day. */
  establishedPaceSPerMi: number;
  /** The mean work pace actually run, s/mi. */
  actualPaceSPerMi: number;
}

/**
 * Pure. Does this one already-interpreted session carry the doctrine's
 * "extremely informative" reading? See the module header for why
 * `state === 'PARTIAL_FAILED' && evidence.fitness === 'high'` is the
 * exhaustive shape of that case in the current `interpretExecution`, not an
 * arbitrary narrowing of it.
 */
export function findPartialFitnessEvidence(
  session: KeySessionExecution,
): FitnessEvidencePartialFinding | null {
  if (!session.readable || !session.read || !session.planned) return null;
  if (session.read.state !== 'PARTIAL_FAILED') return null;
  if (session.read.evidence.fitness !== 'high') return null;

  const domain = session.planned.domain;
  const actualPaceSPerMi = session.actual?.meanWorkPaceSPerMi ?? null;
  /* F-5 · READ, never recomputed.
   *
   * This used to call `establishedPaceFor(domain, vdot)` a second time with
   * its OWN vdot argument, and the comment below already named the hazard:
   * "a different vdot argument than the one load.ts used could theoretically
   * disagree". It is no longer theoretical to avoid — the interpreter's own
   * value rides on the row, so the number in the sentence the runner reads is
   * by construction the number the verdict was computed against (Rule 16).
   *
   * Both are still guaranteed non-null whenever `failedAtKnownPace` set
   * evidence.fitness to 'high' inside `interpretExecution` — that flag itself
   * requires `ctx.establishedPaceSPerMi` and `actual.meanWorkPaceSPerMi` to be
   * non-null. The guard stays because a refused anchor set (Rule 11) is a real
   * state this function must decline rather than describe. */
  const establishedPaceSPerMi = session.establishedPaceSPerMi;
  if (actualPaceSPerMi == null || establishedPaceSPerMi == null) return null;

  return {
    dateISO: session.dateISO,
    domain,
    stimulusCompletion: session.read.stimulusCompletion,
    establishedPaceSPerMi,
    actualPaceSPerMi,
  };
}

/* ═════════════════════════════ Coach voice ══════════════════════════════ */
/* Short, direct, no hype, no exclamation marks, no emoji, no em dashes —
 * matching composeEasyDisciplineEntry / composeWeekCloseEntry exactly. */

const DOMAIN_LABEL: Record<IntensityDomain, string> = {
  recovery: 'Recovery',
  easy: 'Easy',
  marathon: 'Marathon-effort',
  threshold: 'Threshold',
  interval: 'Interval',
  repetition: 'Repetition',
  race: 'Race-effort',
};

function fmtPace(s: number): string {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** The line written to the coach's log. One entry, once, keyed by date. */
export function composeFitnessEvidenceEntry(
  f: FitnessEvidencePartialFinding,
): { title: string; body: string } {
  const label = DOMAIN_LABEL[f.domain] ?? 'Session';
  const pct = Math.round(Math.min(1, Math.max(0, f.stimulusCompletion)) * 100);
  const established = fmtPace(f.establishedPaceSPerMi);
  const actual = fmtPace(f.actualPaceSPerMi);
  return {
    title: 'FITNESS SIGNAL',
    body:
      `${label} work came apart at ${actual}/mi. That pace has been comfortable ` +
      `before, at ${established}/mi. Only ${pct}% of the session landed, but stopping ` +
      `at a known pace says more about fitness than the miles that were missed.`,
  };
}

/* ═══════════════════════════ DB shell ═══════════════════════════════════ */
/* Best-effort, never throws, mirrors the house posture in coach-log.ts and
 * easy-discipline.ts. Everything above is pure and is what the tests lock. */

/**
 * THE current-VDOT read, from THE owner
 * (`lib/training/projection-snapshots.ts#resolveCurrentVdotSnapshot`).
 *
 * F-6 (2026-09-01) · this file used to carry its OWN copy of the query, and
 * justified it in a header comment citing a "house rule" — "where a reader
 * does not exist, each caller carries its own one-line copy". Four files did
 * exactly that, byte for byte, and a reader DID exist in
 * `projection-snapshots.ts`; nobody called it. Three of the four wrapped the
 * query in `.catch(() => ({ rows: [] }))`, so a FAILED READ became "no VDOT",
 * which became `establishedPaceFor → null`, which suppressed the finding
 * entirely. A guard that switches itself off when its input fails is Rule 11's
 * defining shape.
 *
 * The resolver also closes two things no copy had: a total ORDER BY (Rule 14 —
 * production holds three rows per user per snapshot_date and the tie-break was
 * the planner's choice) and a staleness bound (a snapshot was faded as of its
 * own date and never again, so an N-day-old row is under-faded by N days).
 *
 * `null` here still means "do not spend a VDOT", which is what every caller
 * already did with it — but the REASON is now distinguishable upstream, and a
 * stale or failed read is a refusal rather than a silent zero.
 */
async function currentVdot(userUuid: string): Promise<number | null> {
  const read = await resolveCurrentVdotSnapshot(userUuid);
  return read.ok ? read.vdot : null;
}

/**
 * Load every partial-fitness-evidence finding in the lookback window.
 * Best-effort, never throws — a failed read here means "say nothing today,"
 * not a crashed cron.
 */
export async function loadPartialFitnessEvidenceFindings(
  userUuid: string,
  todayISO: string,
): Promise<FitnessEvidencePartialFinding[]> {
  try {
    const fromISO = new Date(
      Date.parse(`${todayISO}T00:00:00Z`) - FITNESS_EVIDENCE_LOOKBACK_DAYS * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    const vdot = await currentVdot(userUuid);
    const sessions: KeySessionExecution[] = await loadKeySessionExecutions(
      userUuid,
      fromISO,
      todayISO,
      vdot,
    );
    const out: FitnessEvidencePartialFinding[] = [];
    for (const session of sessions) {
      const finding = findPartialFitnessEvidence(session);
      if (finding) out.push(finding);
    }
    return out;
  } catch (e) {
    console.warn('[fitness-evidence] loadPartialFitnessEvidenceFindings failed:', e);
    return [];
  }
}
