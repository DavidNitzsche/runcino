/**
 * lib/coach/threshold-pattern.ts · the repeated-pattern case
 * `lib/coach/memory.ts` was built for.
 *
 * Doctrine: `Design/execution-memory-firing.md` Part 2, "What earns memory":
 *
 *   > Meaningful patterns — easy runs drift fast when fresh; threshold falls
 *   > apart after 30 minutes; handles mileage well but not two quality days
 *   > close together. Patterns are far more valuable than isolated events,
 *   > and memory should generally require repeated evidence before forming.
 *
 * and the pipeline's own worked example:
 *
 *   execution: { state: PARTIAL_FAILED, stimulus_completion: 0.61 }
 *   evidence:  { adaptation: negative, fitness: low_confidence, fatigue: meaningful }
 *   memory:    { create: false, pattern_counter: threshold_failure +1 }
 *   coach:     { firing: SURFACE }
 *
 *   On the third repeated failure:
 *   memory: { create: true, pattern: threshold durability issue }
 *   coach:  { firing: SURFACE, importance: high }
 *
 * `lib/coach/fitness-evidence.ts` wired the doctrine's MIDDLE example
 * (2026-08-18) — one dated PARTIAL_FAILED-at-a-known-pace session, through
 * `classifyFinding`, into a one-shot coach-log entry. `lib/coach/memory.ts`
 * had zero callers as of that same morning. This module is the missing
 * piece: it walks the SAME `PARTIAL_FAILED` readings, accumulates them
 * through `recordEvidence` until the promotion bar clears, and only then
 * writes a coach-log entry — the third-repeated-failure branch of the
 * pipeline above, not the middle one.
 *
 * ── The finding, checked against the code rather than assumed ─────────────
 *
 * `interpretExecution` (`lib/execution/interpret.ts`) resolves
 * `PARTIAL_FAILED` whenever `ctx.effortCollapsed` is true and the delivered
 * work fell short of the session, independent of `evidence.fitness` — that
 * field only distinguishes a collapse at a pace already established as
 * achievable (`fitness-evidence.ts`'s narrower `'high'` case) from an
 * ordinary hard-day collapse (`'moderate'` or `'low'`). The doctrine
 * pipeline's own repeated-pattern example carries `fitness: low_confidence`
 * — not the narrow high-confidence shape `fitness-evidence.ts` already owns
 * — so this module deliberately does NOT filter on `evidence.fitness`. It
 * counts every `PARTIAL_FAILED` reading in the threshold domain, because the
 * question being asked is "does threshold work keep coming apart," not
 * "does it keep coming apart at a pace we can already vouch for."
 *
 * A session this module counts may ALSO have already produced its own
 * one-shot `fitness_evidence` entry (when `evidence.fitness === 'high'`).
 * That is not duplicate coaching — it is doctrine's own two-stage
 * escalation: the individual event surfaces once, on its own date, as one
 * piece of evidence; the accumulating PATTERN separately promotes to memory
 * and surfaces again, louder, only once repetition earns it. Rule 13:
 * "repetition should increase significance, not message frequency" — the
 * pattern-level entry is a higher-significance message about a DIFFERENT
 * claim (durability across repeated sessions), not a re-announcement of the
 * same one.
 *
 * ── Why threshold, not every domain ────────────────────────────────────────
 *
 * Doctrine's own worked example names "threshold durability issue" — a
 * runner who keeps coming apart at threshold SPECIFICALLY, not randomly
 * across domains. Generalizing to "PARTIAL_FAILED in any domain, pooled"
 * would conflate an interval day that fell apart with a threshold day that
 * fell apart into one counter, which is a murkier claim doctrine did not
 * make. This module stays scoped to `domain === 'threshold'`, matching the
 * named example exactly — the same discipline `fitness-evidence.ts` used to
 * stay scoped to its one shape ("one clear wire, not every wire"). A future
 * module could do the same for another domain by copying this shape with a
 * different `field` key; that generalization is explicitly out of scope
 * here.
 *
 * ── Memory category and tier ────────────────────────────────────────────
 *
 * `category: 'pattern'` (Part 2's own bucket for "threshold falls apart
 * after 30 minutes"). `tier: 'medium'` — Part 2's decay table: "current
 * limiter ... expire or revalidate over weeks." A threshold durability
 * issue is exactly a current limiter, not a permanent identity (a runner
 * who resolves it should not carry the label forever) and not a
 * short-lived artifact of one bad week — `MEDIUM_TIER_DAYS` (56, two
 * load-cutback cycles per `memory.ts`'s own header) is the right shelf
 * life. This is a UX/product-convention constant, same posture as
 * `memory.ts`'s own thresholds and `fitness-evidence.ts`'s lookback window
 * — no doctrine-registry citation, per Rule 7's own carve-out for
 * engineering choices that are not claims about physiology.
 *
 * ── The distinct-period key ─────────────────────────────────────────────
 *
 * `periodKey` is `weekKeyOf(finding.dateISO)`, reusing the exact
 * Sunday-anchored ISO-week grouping `easy-discipline.ts` already uses and
 * tests (`weekKeyOf`) — not a second definition of "week" that could drift
 * from the one the codebase already trusts. Read-only import; the module
 * itself is untouched.
 *
 * ── Why no episode-log.ts open/close machine here ──────────────────────────
 *
 * `episode-log.ts` generalises "speak once when established, once when
 * resolved" for a detector that RE-EVALUATES the whole pattern fresh every
 * day from a rolling window — easy-discipline re-scans 90 days of runs on
 * every call and can genuinely flip back from `established` to `quiet`,
 * which is the shape `episode-log.ts`'s `{state, quietReason}` contract
 * expects. This module's evidence is a different shape: `recordEvidence`
 * already IS a decaying, cumulative state machine. A memory that stops
 * collecting evidence simply stops being refreshed and expires on its own
 * via `isExpired` (56 days, `memory.ts`'s medium tier) without anything
 * having to notice a "resolve" event or compose a second message. Bolting
 * `episode-log.ts` on top would mean answering "has this resolved" twice,
 * by two independently-clocked mechanisms, and risking them disagreeing —
 * decay already produces the honest "this stopped mattering" signal
 * doctrine asks for ("expire or revalidate over weeks"), so a second,
 * daily-re-evaluated resolve path would be redundant machinery answering a
 * question decay already answers. If a future need arises to also SPEAK an
 * explicit "you fixed it" line, the natural seam is `supersedeMemory` plus
 * a dedicated composer — not `episode-log.ts`, whose `quietReason` contract
 * does not fit a cumulative counter with no daily fresh re-evaluation.
 *
 * ── Promotion write vs. refresh write ──────────────────────────────────────
 *
 * `recordEvidence`'s actual contract, read from the source rather than
 * assumed: once a memory is `'active'`, EVERY subsequent call returns the
 * record again (non-null) — `promoted = existing.status === 'active' ||
 * shouldPromote(...)`. So "returns non-null" alone cannot distinguish "just
 * promoted today" from "already active, just refreshed." This module tells
 * the two apart itself: `recordThresholdPatternEvidence` checks
 * `loadActiveMemory` for this key BEFORE calling `recordEvidence`, and
 * `decideThresholdPatternWrite` (pure, tested directly) turns
 * (`wasActiveBefore`, `recordEvidence`'s result) into `'promote'` /
 * `'refresh'` / `'skip'`. Only `'promote'` — genuinely crossing
 * candidate → active — is handed back to the caller to classify and log.
 * An already-active memory still gets its evidence recorded (keeps
 * `lastObservedISO` fresh, delaying decay) but produces no further log
 * entry, so a runner who keeps failing the same domain does not get
 * re-told about the pattern every time it recurs — exactly the duplicate-
 * coaching failure Part 3 rules out.
 */

import { pool } from '@/lib/db/pool';
import { loadKeySessionExecutions, type KeySessionExecution } from '@/lib/execution/load';
import { recordEvidence, loadActiveMemory, type MemoryRecord } from '@/lib/coach/memory';
import { weekKeyOf } from '@/lib/coach/easy-discipline';
import { resolveCurrentVdotSnapshot } from '@/lib/training/projection-snapshots';

/**
 * How far back to look for a not-yet-reported occurrence. Short, mirroring
 * `fitness-evidence.ts`'s `FITNESS_EVIDENCE_LOOKBACK_DAYS` — this rides the
 * same daily cron and only has to see recent days; `recordEvidence` itself
 * (not this window) is what accumulates evidence ACROSS the weeks a pattern
 * actually takes to establish. Wider than one day purely to tolerate a
 * missed cron tick or a late-syncing watch upload. Engineering choice about
 * read freshness, not physiology — no doctrine registry entry.
 */
export const THRESHOLD_PATTERN_LOOKBACK_DAYS = 4;

/** The stable `memory.ts` field key every occurrence of this pattern
 *  accumulates against. Must stay unique per detector, same constraint
 *  `episode-log.ts`'s `EpisodeDetector.reason` documents for its own
 *  mechanism. */
export const THRESHOLD_PATTERN_FIELD = 'pattern:threshold_durability';

export interface ThresholdPartialFailureFinding {
  dateISO: string;
  /** 0..1 · how much of the intended stimulus landed. */
  stimulusCompletion: number;
  /** `interpretExecution`'s own one-line reading, carried through for audit
   *  trails and future composers — not currently spoken verbatim. */
  why: string;
}

/**
 * Pure. Does this one already-interpreted session carry the doctrine's
 * "threshold durability" evidence — a threshold session that came apart
 * before finishing? See the module header for why `evidence.fitness` is
 * deliberately NOT part of this predicate.
 */
export function findThresholdPartialFailure(
  session: KeySessionExecution,
): ThresholdPartialFailureFinding | null {
  if (!session.readable || !session.read || !session.planned) return null;
  if (session.read.state !== 'PARTIAL_FAILED') return null;
  if (session.planned.domain !== 'threshold') return null;
  return {
    dateISO: session.dateISO,
    stimulusCompletion: session.read.stimulusCompletion,
    why: session.read.why,
  };
}

/* ═════════════════════════════ Coach voice ══════════════════════════════ */
/* Short, direct, no hype, no exclamation marks, no emoji, no em dashes —
 * matching composeFitnessEvidenceEntry / composeEasyDisciplineEntry exactly.
 * `memory.ts`'s own doc comment: the statement is recomputed fresh on every
 * `recordEvidence` call so its wording can improve as more evidence comes
 * in — this function is written to read sensibly whichever occurrence
 * triggers it, not just the promoting one. */

/** The statement written into the `MemoryRecord` (and, on promotion, spoken
 *  as the coach-log body) — one line, in coach voice. */
export function composeThresholdPatternStatement(f: ThresholdPartialFailureFinding): string {
  const pct = Math.round(Math.min(1, Math.max(0, f.stimulusCompletion)) * 100);
  return (
    'Threshold work keeps coming apart before it finishes. The most recent attempt ' +
    `landed only ${pct}% of the session. Treat this as a durability limiter, not a bad day.`
  );
}

/** The line written to the coach's log on promotion. */
export function composeThresholdPatternEntry(
  f: ThresholdPartialFailureFinding,
): { title: string; body: string } {
  return { title: 'PATTERN', body: composeThresholdPatternStatement(f) };
}

/* ═══════════════════════ Promotion-vs-refresh decision ═══════════════════ */

export type ThresholdPatternWrite = 'promote' | 'refresh' | 'skip';

/**
 * Pure. Turns (was this memory already active before today's evidence
 * report, `recordEvidence`'s result) into what this caller should do. See
 * the module header, "Promotion write vs. refresh write," for why
 * `recordEvidence`'s return value alone cannot answer this — an
 * already-active memory returns its record again on every call, not just
 * the first time it promotes.
 */
export function decideThresholdPatternWrite(
  wasActiveBefore: boolean,
  recordEvidenceResult: MemoryRecord | null,
): ThresholdPatternWrite {
  if (!recordEvidenceResult) return 'skip'; // still below the promotion bar
  if (wasActiveBefore) return 'refresh'; // already active — nothing new to say
  return 'promote'; // genuinely just crossed candidate -> active
}

/* ═══════════════════════════ DB shell ═══════════════════════════════════ */
/* Best-effort, never throws, mirrors the house posture in coach-log.ts,
 * easy-discipline.ts and fitness-evidence.ts. Everything above is pure and
 * is what the tests lock; the DB shell is exercised in prod, matching the
 * house policy already used for loadEasyDiscipline / updateEpisode. */

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
 * Load every not-yet-reported threshold-durability occurrence in the
 * lookback window. Best-effort, never throws — a failed read here means
 * "say nothing today," not a crashed cron.
 */
export async function loadThresholdPartialFailureFindings(
  userUuid: string,
  todayISO: string,
): Promise<ThresholdPartialFailureFinding[]> {
  try {
    const fromISO = new Date(
      Date.parse(`${todayISO}T00:00:00Z`) - THRESHOLD_PATTERN_LOOKBACK_DAYS * 86_400_000,
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
    const out: ThresholdPartialFailureFinding[] = [];
    for (const session of sessions) {
      const finding = findThresholdPartialFailure(session);
      if (finding) out.push(finding);
    }
    return out;
  } catch (e) {
    console.warn('[threshold-pattern] loadThresholdPartialFailureFindings failed:', e);
    return [];
  }
}

export interface ThresholdPatternPromotion {
  record: MemoryRecord;
  finding: ThresholdPartialFailureFinding;
}

/**
 * Report one threshold-durability occurrence to the shared memory
 * primitive (`lib/coach/memory.ts#recordEvidence`). Returns the promotion
 * ONLY on the genuine candidate → active transition — see
 * `decideThresholdPatternWrite` above. An already-active memory still has
 * its evidence recorded (keeps it fresh, delays decay) but this returns
 * null, so the caller writes no further coach-log entry for it.
 */
export async function recordThresholdPatternEvidence(
  userUuid: string,
  finding: ThresholdPartialFailureFinding,
  todayISO: string,
): Promise<ThresholdPatternPromotion | null> {
  try {
    const active = await loadActiveMemory(userUuid, todayISO, ['pattern']);
    const wasActiveBefore = active.some((m) => m.field === THRESHOLD_PATTERN_FIELD);

    const result = await recordEvidence({
      userId: userUuid,
      category: 'pattern',
      field: THRESHOLD_PATTERN_FIELD,
      tier: 'medium',
      periodKey: weekKeyOf(finding.dateISO),
      observedISO: finding.dateISO,
      statement: composeThresholdPatternStatement(finding),
      detail: {
        domain: 'threshold',
        lastStimulusCompletion:
          Math.round(Math.min(1, Math.max(0, finding.stimulusCompletion)) * 100) / 100,
      },
    });

    if (decideThresholdPatternWrite(wasActiveBefore, result) !== 'promote' || !result) return null;
    return { record: result, finding };
  } catch (e) {
    console.warn('[threshold-pattern] recordThresholdPatternEvidence failed:', e);
    return null;
  }
}
