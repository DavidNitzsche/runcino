/**
 * lib/coach/episode-log.ts · episode suppression, generalised.
 *
 * `lib/coach/easy-discipline.ts` + the `updateEasyDisciplineLog` writer it
 * used to carry inside `coach-log.ts` is the reference implementation
 * (Design/execution-memory-firing.md Part 3, "Episode suppression"): speak
 * once when a pattern establishes, once when it resolves, never in
 * between. This module lifts that mechanism so any other pattern-gated
 * detector can use it without hand-rolling the same two-state machine —
 * `coach-log.ts` now calls THIS module for easy-discipline instead of
 * owning the logic itself, and the behaviour is unchanged: same reason,
 * same field naming (`easy:open:<date>` / `easy:resolved:<episode>`), same
 * (reason, field) idempotency, same single-row-lookback state read. See
 * `coach-log.test.ts` and `easy-discipline.test.ts`, both still green,
 * plus `episode-log.test.ts` below, which locks the generalised state
 * machine directly.
 *
 * ── The shape a detector needs ──────────────────────────────────────────
 *
 * Any finding that looks like `{ state: 'established' | 'quiet', quietReason
 * }` — i.e. any detector built on the same pattern-gate shape as
 * `EasyDisciplineFinding` — can register an `EpisodeDetector` here instead
 * of writing its own open/close bookkeeping. The two-state machine, with no
 * schema change, no new table:
 *
 *   nothing / resolved  + finding says established → write OPEN
 *   open                + finding says resolved     → write CLOSE
 *   anything else                                    → write nothing
 *
 * "Resolved" is deliberately the ONLY quiet reason that closes an episode.
 * A detector typically has several ways to go quiet (not enough evidence,
 * stale, a basis contradiction, no basis at all) and only one of them —
 * the pattern genuinely having broken — is worth telling the runner about.
 * Running out of qualifying data is silence, not good news, and must never
 * be reported as if the runner fixed something. `resolvedReason` on the
 * `EpisodeDetector` names which one.
 *
 * ── What stays with the caller ──────────────────────────────────────────
 *
 * This module does not run the detector, does not know what a "pattern" is
 * for any given finding, and does not compose copy — it only decides
 * whether today's finding constitutes a write, and if so, persists it via
 * the same `coach_intents` idempotency `coach-log.ts` already relies on. A
 * detector still owns: loading its own data, running its own pure gate
 * (mirroring `detectEasyDiscipline`), and composing its own two lines of
 * copy (mirroring `composeEasyDisciplineEntry` /
 * `composeEasyDisciplineResolved`).
 *
 * ── Firing level ─────────────────────────────────────────────────────────
 *
 * Episode suppression answers "has this already been said," which is
 * upstream of `lib/coach/firing-policy.ts`'s "how loud should this be."
 * `updateEpisode`'s return value (0 or 1 rows written) is exactly the
 * `EpisodeContext.alreadyDeliveredThisEpisode` input that classifier
 * expects — a caller that wants to classify a pattern-gated finding should
 * run it through `decideEpisodeWrite` (or `updateEpisode`) first, and feed
 * the result into `classifyFinding` before deciding how to render it.
 */

import { pool } from '@/lib/db/pool';

/**
 * The minimal shape a detector's finding needs to plug into this module.
 * `EasyDisciplineFinding` (and any future detector built the same way)
 * satisfies this structurally — no explicit implements needed.
 */
export interface EpisodeFinding<Q extends string = string> {
  state: 'established' | 'quiet';
  quietReason: Q | null;
}

/** The two composed lines a detector hands back — same shape
 *  `composeEasyDisciplineEntry` / `composeEasyDisciplineResolved` already
 *  return. */
export interface EpisodeEntry {
  title: string;
  body: string;
}

/**
 * One detector's registration. `reason` is the `coach_intents.reason`
 * value this detector's rows live under — it MUST be unique per detector
 * (two detectors sharing a reason would read each other's open/close state
 * and corrupt both episodes), the same constraint `coach-log.ts`'s
 * `REASON_OF_KIND` map already enforces for its own kinds.
 */
export interface EpisodeDetector<F extends EpisodeFinding<Q>, Q extends string = string> {
  /** `coach_intents.reason` for this detector's rows. One reason per
   *  detector, never shared. */
  reason: string;
  /** Prefix on an OPEN row's `field`. easy-discipline uses `'easy:open:'`. */
  openPrefix: string;
  /** Prefix on a CLOSE row's `field`. easy-discipline uses
   *  `'easy:resolved:'`. */
  closePrefix: string;
  /** The one `quietReason` value that means "resolved, worth telling."
   *  Every other quiet reason is silence — an open episode stays open. */
  resolvedReason: Q;
  /** Compose the OPEN entry from an `established` finding. */
  composeOpen: (finding: F) => EpisodeEntry;
  /** Compose the CLOSE entry from a `quiet` finding whose quietReason is
   *  `resolvedReason`. */
  composeClose: (finding: F) => EpisodeEntry;
}

export type EpisodeWrite = 'open' | 'close' | 'none';

export interface EpisodeDecision {
  write: EpisodeWrite;
  /** The `field` to write/check under. Empty string when write === 'none'
   *  (nothing is written, so the field is never read). */
  field: string;
  entry?: EpisodeEntry;
}

/**
 * The pure decision. No DB, no async — exactly the part `easy-discipline`
 * keeps pure and `easy-discipline.test.ts` locks directly, generalised to
 * any `EpisodeDetector`. `lastRowField` is the `field` column of the newest
 * `coach_intents` row for this detector's `reason` (or null when none
 * exists yet); the caller (`updateEpisode` below, or a test) supplies it so
 * this function never touches a pool.
 */
export function decideEpisodeWrite<F extends EpisodeFinding<Q>, Q extends string = string>(
  detector: Pick<
    EpisodeDetector<F, Q>,
    'openPrefix' | 'closePrefix' | 'resolvedReason' | 'composeOpen' | 'composeClose'
  >,
  lastRowField: string | null,
  finding: F,
  todayISO: string,
): EpisodeDecision {
  const openEpisodeId =
    lastRowField != null && lastRowField.startsWith(detector.openPrefix)
      ? lastRowField.slice(detector.openPrefix.length)
      : null;

  if (openEpisodeId == null) {
    // No open episode. The only write worth making is starting one, and
    // only when the pattern has genuinely established.
    if (finding.state !== 'established') return { write: 'none', field: '' };
    return {
      write: 'open',
      field: `${detector.openPrefix}${todayISO}`,
      entry: detector.composeOpen(finding),
    };
  }

  // An episode is open. Only a genuine resolve closes it.
  if (finding.state !== 'quiet' || finding.quietReason !== detector.resolvedReason) {
    return { write: 'none', field: '' };
  }
  return {
    write: 'close',
    field: `${detector.closePrefix}${openEpisodeId}`,
    entry: detector.composeClose(finding),
  };
}

/**
 * The DB shell. Reads the newest row for this detector's `reason`, asks
 * `decideEpisodeWrite` what (if anything) to do, and writes it — idempotent
 * on (reason, field), same as `coach-log.ts`'s `writeEntry`. Returns the
 * number of rows written (0 or 1), which doubles as the
 * `alreadyDeliveredThisEpisode` signal for `lib/coach/firing-policy.ts`:
 * a caller that gets 0 back and already had an open episode knows nothing
 * new was said.
 *
 * Never throws — matches the house posture in `coach-log.ts` and
 * `easy-discipline.ts`: a failed read/write here means "say nothing today,"
 * not a crashed cron.
 */
export async function updateEpisode<F extends EpisodeFinding<Q>, Q extends string = string>(
  userId: string,
  detector: EpisodeDetector<F, Q>,
  finding: F,
  todayISO: string,
  meta: (finding: F, state: 'established' | 'resolved') => Record<string, unknown>,
): Promise<number> {
  try {
    const last = await pool
      .query<{ field: string }>(
        `SELECT field FROM coach_intents
          WHERE COALESCE(user_uuid, user_id) = $1 AND reason = $2
          ORDER BY ts DESC LIMIT 1`,
        [userId, detector.reason],
      )
      .catch(() => ({ rows: [] as Array<{ field: string }> }));

    const decision = decideEpisodeWrite(detector, last.rows[0]?.field ?? null, finding, todayISO);
    if (decision.write === 'none' || !decision.entry) return 0;

    const exists = await pool
      .query(
        `SELECT 1 FROM coach_intents
          WHERE COALESCE(user_uuid, user_id) = $1 AND reason = $2 AND field = $3
          LIMIT 1`,
        [userId, detector.reason, decision.field],
      )
      .catch(() => ({ rows: [] as unknown[] }));
    if (exists.rows.length > 0) return 0;

    await pool.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value, acknowledged_at)
       VALUES ($1, $1, $2, $3, $4, NOW())`,
      [
        userId,
        detector.reason,
        decision.field,
        JSON.stringify({
          title: decision.entry.title,
          body: decision.entry.body,
          dateISO: todayISO,
          meta: meta(finding, decision.write === 'open' ? 'established' : 'resolved'),
        }),
      ],
    );
    return 1;
  } catch (e) {
    console.warn(`[episode-log] updateEpisode failed (reason=${detector.reason}):`, e);
    return 0;
  }
}
