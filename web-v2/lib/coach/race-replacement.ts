/**
 * lib/coach/race-replacement.ts · the second execution finding wired to the
 * coach's log: a key session read `REPLACED`.
 *
 * Doctrine: `Design/execution-memory-firing.md` Part 1, "Session replaced by
 * a race":
 *
 *   > `REPLACED`, not a miss. The race is evaluated independently and may
 *   > provide better fitness evidence than the workout it replaced — while
 *   > costing more recovery.
 *   > ```
 *   > fitness_evidence = high
 *   > training_stress  = higher_than_planned
 *   > recovery_cost    = higher_than_planned
 *   > ```
 *   > Adjust downstream training rather than marking Saturday green.
 *   > **Replacement does not mean equivalence.**
 *
 * `lib/execution/interpret.ts#interpretExecution`'s own header names this as
 * one of the findings deliberately left unwired by `fitness-evidence.ts`
 * ("It does not attempt the other unwired findings the same audit
 * surfaced ... REPLACED-by-race as its own entry"). This module closes that
 * gap, following `fitness-evidence.ts`'s exact shape: a pure finder, a pure
 * coach-voice composer, and a best-effort DB shell — nothing here reaches
 * back into `lib/execution/*`, `lib/adaptation/*` or `lib/plan/*`.
 *
 * ── One entry, not two ─────────────────────────────────────────────────
 *
 * The doctrine passage names two things worth saying: the race is itself
 * fitness evidence, and downstream training needs to account for its
 * recovery cost. `interpretExecution`'s `REPLACED` branch produces exactly
 * one `EvidenceRead` for the day —
 * `{ execution: 'full', adaptation: 'neutral', fitness: 'high', risk: 'watch' }`
 * — not two separate signals with two separate lifecycles. There is no
 * second detector here that watches for "was the following week actually
 * eased off": that is an adaptation-model question (out of scope — this
 * module does not touch `lib/adaptation/*`), and forcing a second coach-log
 * write to cover ground `fitness_evidence`-style modules do not have data
 * for would manufacture a second event out of one occurrence. So this is
 * one dated, one-shot entry whose body carries both clauses — exactly the
 * shape `interpretExecution`'s own `why` string already uses for this
 * branch ("It carries better fitness evidence than the workout would have,
 * and a higher recovery cost — the rest of the week has to account for
 * it."). The composer below says the same two things in the same coach
 * voice `fitness-evidence.ts` uses, just without an em dash.
 *
 * ── Why the message names the DISPLACED session, not the race's own line ──
 *
 * `KeySessionExecution.actual` may carry a `Stimulus` for the race itself
 * (domain/distance/pace) when a run row matched the date, but it may also be
 * null — a race logged only in `races` with no matching `runs` row still
 * reads as `REPLACED` (see `lib/execution/load.ts`'s `replacedByRace`
 * branch). Rather than build a message that changes shape depending on
 * whether that row happens to exist, this finding reads only
 * `session.planned` — what the plan asked for on that day, which
 * `interpretExecution` always resolves whenever `read` is non-null. That
 * also keeps this module clean of the race-data source-of-truth checklist
 * in CLAUDE.md (races.actual_result vs. strava_activities): it never
 * displays a race RESULT, only that a race stood in for a session.
 *
 * ── isPositive: false ──────────────────────────────────────────────────
 *
 * `fitness: 'high'` reads like good news, but doctrine's own line is
 * "Replacement does not mean equivalence" — the same event costs more
 * recovery than the session it replaced, and marking it positive would be
 * exactly the "marking Saturday green" doctrine warns against. Per Part 3
 * ("Positive messages need the same threshold"), a positive finding also
 * needs `meaningfulPositive` before it can fire; there is no honest
 * `meaningfulPositive` story here, because the fitness evidence and the
 * elevated recovery cost arrive in the same breath, not as an unqualified
 * win. So this is composed and classified exactly like
 * `fitness-evidence.ts`'s hard-day reading: evidence to record, not praise.
 *
 * ── Firing ──────────────────────────────────────────────────────────────
 *
 * Routed through `classifyFinding` (`lib/coach/firing-policy.ts`) by
 * `updateRaceReplacementLog` in `coach-log.ts` as:
 *
 *   changed: true                    — a session outcome that did not exist before today
 *   athleteNeedsToKnow: true         — it is evidence about fitness AND a recovery-cost flag
 *   usefulOnlyBecauseLooking: true   — surfaced in the log, never pushed
 *   isPositive: false                — real cost attached, not a compliment
 *
 * which resolves to SURFACE (never INTERRUPT — a race that already happened
 * cannot qualify for any of Part 3's five INTERRUPT categories; nothing here
 * is `explanatoryDepth`, so it does not fall to AVAILABLE either).
 *
 * ── Why no episode suppression ─────────────────────────────────────────
 *
 * Same reasoning as `fitness-evidence.ts`: `lib/coach/episode-log.ts` exists
 * for a PATTERN that opens and closes over weeks. A single race replacing a
 * single session is a one-shot dated event with no "resolved" counterpart —
 * it does not later un-happen. The existing (reason, field) idempotency
 * `coach-log.ts`'s `writeEntry` already provides is the whole suppression
 * mechanism this needs.
 */

import { pool } from '@/lib/db/pool';
import { loadKeySessionExecutions, type KeySessionExecution } from '@/lib/execution/load';
import type { IntensityDomain } from '@/lib/execution/interpret';

/**
 * How far back to look for a not-yet-logged occurrence. Same rationale and
 * same value as `fitness-evidence.ts`'s `FITNESS_EVIDENCE_LOOKBACK_DAYS`:
 * short, because this rides the daily cron and most days only has to see
 * yesterday; wider than one day purely to tolerate a missed cron tick or a
 * late-syncing race upload. An engineering choice about read freshness, not
 * a claim about physiology — no doctrine registry entry.
 */
export const RACE_REPLACEMENT_LOOKBACK_DAYS = 4;

export interface RaceReplacementFinding {
  dateISO: string;
  /** The domain of the session the race stood in for. */
  displacedDomain: IntensityDomain;
  /** Miles the displaced session called for. Null when the plan basis
   *  carried no distance for that domain. */
  displacedWorkMi: number | null;
}

/**
 * Pure. Does this one already-interpreted session carry doctrine's
 * "session replaced by a race" case? `interpretExecution`'s `replacedByRace`
 * branch is the sole producer of `state === 'REPLACED'`, and it always pairs
 * that state with `evidence.fitness === 'high'` and `evidence.risk ===
 * 'watch'` — there is no other path to either value on this state, so
 * checking `state` alone is exhaustive for this branch (unlike
 * `PARTIAL_FAILED`, which `interpretExecution` also reaches with lower
 * `evidence.fitness`). See `race-replacement.test.ts` for the sweep that
 * locks this against the real function.
 */
export function findRaceReplacement(
  session: KeySessionExecution,
): RaceReplacementFinding | null {
  if (!session.readable || !session.read || !session.planned) return null;
  if (session.read.state !== 'REPLACED') return null;

  return {
    dateISO: session.dateISO,
    displacedDomain: session.planned.domain,
    displacedWorkMi: session.planned.workMi,
  };
}

/* ═════════════════════════════ Coach voice ══════════════════════════════ */
/* Short, direct, no hype, no exclamation marks, no emoji, no em dashes —
 * matching composeFitnessEvidenceEntry / composeEasyDisciplineEntry exactly. */

const DOMAIN_LABEL: Record<IntensityDomain, string> = {
  recovery: 'recovery',
  easy: 'easy',
  marathon: 'marathon-effort',
  threshold: 'threshold',
  interval: 'interval',
  repetition: 'repetition',
  race: 'race',
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The line written to the coach's log. One entry, once, keyed by date.
 *
 * `displacedDomain === 'race'` is a real case, confirmed against prod data
 * (David's own AFC half, 2026-08-16): the plan scheduled the race itself
 * that day, so nothing was actually displaced —
 * `lib/execution/load.ts`'s `replacedByRace` comment documents this is the
 * right read regardless ("it is the right read for a race the plan asked
 * for too"). The generic "stood in for today's race work" phrasing would be
 * redundant there, so that shape gets its own line instead of forcing the
 * displaced-workout template onto a day nothing displaced.
 */
export function composeRaceReplacementEntry(
  f: RaceReplacementFinding,
): { title: string; body: string } {
  if (f.displacedDomain === 'race') {
    return {
      title: 'RACE REPLACED',
      body:
        "Today's race counts as real fitness evidence, likely more informative than a " +
        'normal training day. It also costs more recovery than a normal quality session, ' +
        'so the days ahead should account for that rather than read today as banked training.',
    };
  }
  const label = DOMAIN_LABEL[f.displacedDomain] ?? 'planned';
  const miClause = f.displacedWorkMi != null && f.displacedWorkMi > 0
    ? ` (${round1(f.displacedWorkMi)} mi)`
    : '';
  return {
    title: 'RACE REPLACED',
    body:
      `A race stood in for today's ${label} work${miClause}. That counts as real fitness ` +
      `evidence, likely better than the session it replaced. It also costs more recovery than ` +
      `that session would have, so the days ahead should account for it rather than read today ` +
      `as a normal quality session banked.`,
  };
}

/* ═══════════════════════════ DB shell ═══════════════════════════════════ */
/* Best-effort, never throws, mirrors the house posture in coach-log.ts and
 * fitness-evidence.ts. Everything above is pure and is what the tests lock. */

/** Same read `lib/adaptation/load.ts#currentVdot` uses — the cron-computed
 *  snapshot anchor, not a second opinion recomputed here. Duplicated rather
 *  than imported, same house rule `fitness-evidence.ts` documents: where a
 *  reader exists it is called; where one does not export this shape, each
 *  caller carries its own one-line copy. `loadKeySessionExecutions` requires
 *  a vdot argument even though this module's own finding never reads it. */
async function currentVdot(userUuid: string): Promise<number | null> {
  const r = await pool
    .query<{ vdot: string | null }>(
      `SELECT vdot::text FROM projection_snapshots
        WHERE user_uuid = $1 AND vdot IS NOT NULL
        ORDER BY snapshot_date DESC LIMIT 1`,
      [userUuid],
    )
    .catch(() => ({ rows: [] as Array<{ vdot: string | null }> }));
  const v = r.rows[0]?.vdot;
  return v != null ? Number(v) : null;
}

/**
 * Load every race-replacement finding in the lookback window. Best-effort,
 * never throws — a failed read here means "say nothing today," not a
 * crashed cron.
 */
export async function loadRaceReplacementFindings(
  userUuid: string,
  todayISO: string,
): Promise<RaceReplacementFinding[]> {
  try {
    const fromISO = new Date(
      Date.parse(`${todayISO}T00:00:00Z`) - RACE_REPLACEMENT_LOOKBACK_DAYS * 86_400_000,
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
    const out: RaceReplacementFinding[] = [];
    for (const session of sessions) {
      const finding = findRaceReplacement(session);
      if (finding) out.push(finding);
    }
    return out;
  } catch (e) {
    console.warn('[race-replacement] loadRaceReplacementFindings failed:', e);
    return [];
  }
}
