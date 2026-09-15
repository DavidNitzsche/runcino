/**
 * lib/execution/max-demonstrated-dose.ts · F097 · THE AGGREGATOR THAT DID NOT
 * EXIST.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `lib/runner-state/ownership.ts`'s `MAX_DEMONSTRATED_DOSE` entry names the
 * defect exactly: *"THE SLOT EXISTS AND IS EMPTY... `athleteEvidenceFor` is
 * built to grade a prescribed dose against a demonstrated maximum, and...
 * `lib/execution/reconstruct.ts#actualStimulus` is the only place actual
 * at-pace work minutes are measured and nothing aggregates a maximum from
 * it."* `reconstruct.ts` computes the per-run shape (`{domain, workMi,
 * workMinutes}`); this file is the missing walk over history that takes a MAX
 * of it, by domain. Without it the plan can never notice a runner has earned
 * a bigger session — a real Rule 21 finding ("the plan must be able to get
 * harder, and the engine must be able to prove it has"), not a Rule 16
 * duplicate-owner one.
 *
 * ── THE TWO QUESTIONS THAT BLOCKED BUILDING THIS, AND WHO ANSWERED THEM ─────
 *
 * The 2026-09-06 verification pass that found this gap correctly declined to
 * guess at either of them (`ownership.ts`'s own comment). Both are now
 * doctrine-settled, not engineering defaults:
 *
 *   `for coaching consult/consult-log/2026-09-14-023-max-demonstrated-dose-design.md`
 *   `for coaching consult/consult-log/2026-09-15-025-delegated-calibration-rulings.md`
 *     (David declined to pick a number himself and delegated the fade-window
 *     figure "per the doctrine and research" — 025 is that ruling, and it
 *     CORRECTS 023's own first answer rather than merely refining it.)
 *
 * 1 · ROLLING WINDOW, NOT LIFETIME, AND 30 DAYS — NOT the 8-week aerobic-
 *     freshness window 023 first reached for by analogy. 025 found the actual
 *     citation sitting in the same research document already governing this
 *     reader's sibling: `Research/00a-distance-running-training.md` states,
 *     three times for emphasis, "An individual run >110% of longest run in
 *     the PRIOR 30 DAYS raises overuse injury risk by ~64%." A demonstrated
 *     maximum is a tissue-tolerance claim, not a pure fitness-magnitude one
 *     (Rule 8's own corollary: filter HABIT, do not filter what the runner
 *     has RECENTLY ABSORBED) — "has he earned a bigger session" is the same
 *     recent-tissue-tolerance question as the spike guard, read as a
 *     permission floor instead of a ceiling. `recentPeakLongMi`
 *     (`lib/plan/generate.ts:1832`) already implements exactly this 30-day
 *     spike-anchor precedent for the sibling question ("how far can he spike
 *     from where he actually is now") and its own `literalMi` half is
 *     documented (`lib/audit/normal-window-registry.ts`) as the worked
 *     example of a reader correctly EXEMPTED from Rule 8's habit filter. 025
 *     is explicit that whoever builds this reader "should check first
 *     whether it can reuse this existing reader's window logic directly,
 *     per-domain, rather than authoring a second 30-day constant" — so this
 *     file reuses `recentPeakLongMi`'s ROLLING-WINDOW CONSTRUCTION (a literal
 *     `today − 30 days` lower bound, recomputed relative to today on every
 *     read, no calendar-anchored range, no representative-day extension) as
 *     a PATTERN rather than an import — `recentPeakLongMi` is `lib/plan/`-
 *     private and untouched, per this session's scope boundary, and Rule 16
 *     is served by the shared NUMBER and the shared SHAPE of the query, not
 *     by a cross-directory import that would point the dependency the wrong
 *     way through the Constitution's §3 flow (`lib/execution` must not
 *     depend on `lib/plan/generate.ts`).
 *
 *     `MAX_DEMONSTRATED_DOSE_WINDOW_DAYS` below is that ONE number. If
 *     `Research/` ever states a dose-tolerance-specific figure distinct from
 *     the spike-guard's, 025 names this as the one place that needs to
 *     change — not a second, silently-drifted constant somewhere else.
 *
 * 2 · TAPER / RACE-WEEK / POST-RACE-RECOVERY DAYS ARE EXCLUDED FROM THE
 *     CANDIDATE POOL — even though 023's own analysis says a taper day is
 *     "structurally immune" to actually WINNING a max comparison (it can't be
 *     the biggest session of its type unless nothing else in the window is
 *     bigger, which is a refusal case, not a max-selection case). The reason
 *     given is narrower than Rule 8 itself: a taper day's `workMinutes` for a
 *     domain it "wasn't really testing" (a shortened tune-up carrying the
 *     same domain label as a full session) must not silently OCCUPY that
 *     domain's slot when a real, harder session sits right next to it in the
 *     window — a correctness safeguard against a false ceiling, not a habit
 *     filter. The mechanism reused for this is `lib/training/
 *     normal-window.ts`'s `loadPrescribedWindows` / `isPrescribedNonNormal` —
 *     the SAME general-purpose taper/race-week/recovery detector already
 *     shared by `lib/safety/load-safety.ts`, `lib/race/
 *     representativeness-inputs.ts` and half a dozen `lib/coach/` readers
 *     (see `normal-window-registry.ts`'s own exemption list) — never a second,
 *     locally-invented predicate. Note this is DELIBERATELY NOT the same
 *     taper mechanism `recentPeakLongMi` itself uses for ITS OWN habit half
 *     (`eligibleDaysBack` + `PrescribedSpan`, `lib/plan/generate.ts`) — that
 *     pair is a `lib/plan/`-private mechanism for a DIFFERENT reader
 *     (`representativeMi`) answering a DIFFERENT question ("what is normal");
 *     `recentPeakLongMi`'s own `literalMi` spike anchor, the actual pattern
 *     item 1 above reuses, is NOT taper-filtered at all. Applying the filter
 *     here is this reader's OWN, additional, doctrine-grounded decision
 *     (023's sub-question 1), layered on top of a borrowed WINDOW shape, not
 *     an inherited behaviour.
 *
 * ── WHERE THE PER-RUN NUMBERS COME FROM ────────────────────────────────────
 *
 * `plannedStimulus` + `actualStimulus` (`./reconstruct.ts`) are reused
 * verbatim — the same pure reconstruction `lib/execution/load.ts`'s
 * `loadKeySessionExecutions` already wraps for the adaptation engine's
 * "key session" (quality-day) population. This reader's population is
 * DELIBERATELY WIDER: `loadKeySessionExecutions` filters to
 * `is_quality = true` alone, which excludes every `type = 'long'` row —
 * including a long run carrying a marathon-pace finish segment
 * (`plan/generate.ts` always authors a long day `isQuality: false`,
 * confirmed by grep). Since `ownership.ts`'s own finding names "a completed
 * marathon-pace maximum" as one of the two quantities `athleteEvidenceFor`
 * has ever been handed, a reader that only saw `is_quality` rows would still
 * be structurally blind to the marathon-pace domain — the exact domain the
 * finding calls out by name. So this file queries `is_quality = true OR
 * is_long = true` directly (mirroring `loadKeySessionExecutions`'s own
 * `ownedDaysSql` CTE shape) rather than widening `load.ts`'s function, which
 * is a heavily depended-on, load-bearing "adaptation model's execution gate"
 * predicate with seven other call sites — changing its WHERE clause for this
 * reader's sake would be an unscoped, unaudited side effect on all of them.
 * This is therefore a NEW reader over the SAME pure reconstruction, not a
 * competing re-implementation of it (Rule 18's warning: a second opinion that
 * agrees with itself proves nothing — this one never re-derives `{domain,
 * workMinutes}`, it only walks history and MAXes what `actualStimulus`
 * already computed).
 *
 * `resolveDateRangeExecutions` (`./day-resolver.ts`) supplies the matched-run
 * identity for every candidate day — never "same date, richest run", for the
 * same EXECUTION-IDENTITY-1 reason `load.ts` insists on it. A day with no
 * matched run contributes nothing: this reader asks what he has "actually
 * completed", and an unmatched prescription is not a completed session of
 * that domain, whatever supplemental mileage exists that day.
 *
 * ── WHY 'EASY' AND 'RECOVERY' NEVER APPEAR IN THE OUTPUT ───────────────────
 *
 * `MaxDoseByDomain`'s whole shape ("the biggest dose of a given workout TYPE
 * he has actually completed") is a claim about a deliberately-dosed session —
 * threshold, interval, marathon-pace, race. Baseline aerobic running is
 * already owned elsewhere (`SUSTAINABLE_WEEKLY_VOLUME`, `LONG_RUN_TOLERANCE`,
 * `RECENT_COMPLETED_VOLUME`), and folding it in here would be exactly the
 * "new belief when it is merely new evidence about an existing one" defect
 * `belief.ts` §1 warns against. A quality or long-run row whose ACTUAL pace
 * fell so far off target that `actualDomain` reclassifies it to `'easy'` is
 * therefore dropped entirely here, not credited to any domain's max — which
 * is correct: a session run at easy effort is not a demonstrated dose of the
 * harder thing it was prescribed as.
 */
import { pool } from '@/lib/db/pool';
import { ownedDaysSql } from '@/lib/plan/owned-days';
import { resolveDateRangeExecutions } from './day-resolver';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import { resolveCurrentVdotSnapshot } from '@/lib/training/projection-snapshots';
import {
  loadPrescribedWindows,
  isPrescribedNonNormal,
} from '@/lib/training/normal-window';
import { plannedStimulus, actualStimulus, type PlannedSession } from './reconstruct';
import type { IntensityDomain } from './interpret';
import type { WorkoutSpec } from '@/lib/plan/spec-builder';
import { roundTo } from '@/lib/format/run';

/**
 * THE ONE NUMBER. See this file's header, item 1: `recentPeakLongMi`'s own
 * literal spike anchor (`lib/plan/generate.ts:1845`, `date >= today - 28`) is
 * NOT this constant's source — that call site is an untouched, independently
 * argued implementation detail this session's scope keeps clear of. This
 * constant is bound to the doctrine citation itself
 * (`Research/00a-distance-running-training.md`, "prior 30 days") per ruling
 * 025, which is also the number `recentPeakLongMi`'s own header cites as
 * "the rule, not an accident of implementation." One citation, one constant,
 * spent here rather than re-typed at each domain.
 */
export const MAX_DEMONSTRATED_DOSE_WINDOW_DAYS = 30;

/** Domains a "demonstrated dose" claim is never made about. See this file's
 *  header, last section. */
const EXCLUDED_DOMAINS: ReadonlySet<IntensityDomain> = new Set(['easy', 'recovery']);

/** One user-scoped, per-domain read. `windowDescribed` states the window a
 *  reader can print without recomputing it (Rule 14's own discipline: state
 *  the window a number was read over, do not make a caller guess). */
export interface MaxDemonstratedDoseRead {
  readonly atPaceMinutesByDomain: Readonly<Record<string, number>>;
  readonly windowDescribed: string;
}

interface OwnedDoseRow {
  id: string;
  date_iso: string;
  type: string | null;
  is_quality: boolean | null;
  is_long: boolean | null;
  distance_mi: string | null;
  pace_target_s_per_mi: number | null;
  workout_spec: unknown;
}

/**
 * The biggest COMPLETED session of each domain in the rolling 30-day window,
 * taper/race-week/post-race-recovery days excluded from the candidate pool.
 *
 * Self-contained on purpose (`userUuid` + `todayISO` only, no injected pace
 * anchors or vdot) — matching every other `RunnerBeliefInput` owner in
 * `lib/runner-state/store/loaders.ts` (`resolveThresholdCapacity(userUuid,
 * todayISO)` and siblings), so the loader that calls this needs nothing else
 * threaded through it.
 */
export async function maxDemonstratedDoseByDomain(
  userUuid: string,
  todayISO: string,
): Promise<MaxDemonstratedDoseRead> {
  const fromISO = shiftISODate(todayISO, -MAX_DEMONSTRATED_DOSE_WINDOW_DAYS);
  // ownedDaysSql's upper bound is EXCLUSIVE (its own header: "passing today as
  // `to` therefore excludes today"). Shifting one day forward is how every
  // existing caller includes today itself, and this reader wants today
  // included — a session finished this morning is real evidence right now.
  const toISOExclusive = shiftISODate(todayISO, 1);
  const windowDescribed = `${fromISO} to ${todayISO} (rolling ${MAX_DEMONSTRATED_DOSE_WINDOW_DAYS}d, `
    + 'taper/race-week/post-race-recovery excluded)';

  const [ownedRows, windows, tPaceSecPerMi, vdot] = await Promise.all([
    pool.query<OwnedDoseRow>(
      `WITH owned AS (${ownedDaysSql({
        columns: 'pw.id, pw.date_iso, pw.type, pw.is_quality, pw.is_long, pw.distance_mi, '
          + 'pw.pace_target_s_per_mi, pw.workout_spec',
      })})
       SELECT * FROM owned WHERE owned.is_quality = true OR owned.is_long = true
       ORDER BY owned.date_iso`,
      [userUuid, fromISO, toISOExclusive],
    ).then((r) => r.rows),
    loadPrescribedWindows(userUuid, todayISO),
    readCanonicalThreshold(userUuid, todayISO),
    readVdot(userUuid, todayISO),
  ]);

  // Item 2 of this file's header: drop candidate days sitting inside a
  // taper, race week, or post-race recovery window BEFORE any domain ever
  // sees them, so a shortened tune-up can never occupy a domain's slot.
  const candidates = ownedRows.filter((r) => !isPrescribedNonNormal(r.date_iso, windows));
  if (candidates.length === 0) return { atPaceMinutesByDomain: {}, windowDescribed };

  const resolvedDays = await resolveDateRangeExecutions(
    userUuid,
    fromISO,
    toISOExclusive,
  );

  const maxByDomain = new Map<IntensityDomain, number>();
  for (const row of candidates) {
    const session: PlannedSession = {
      dateISO: row.date_iso,
      type: row.type,
      isQuality: row.is_quality === true,
      isLong: row.is_long === true,
      distanceMi: row.distance_mi == null ? null : Number(row.distance_mi),
      paceTargetSPerMi: row.pace_target_s_per_mi == null ? null : Number(row.pace_target_s_per_mi),
      spec: (row.workout_spec ?? null) as WorkoutSpec,
    };
    const planned = plannedStimulus(session, { tPaceSecPerMi });
    if (planned == null) continue;

    const matchedRun = resolvedDays.get(row.date_iso)?.prescriptions
      .find((p) => p.id === row.id)?.matchedRun ?? null;
    if (matchedRun == null) continue; // not completed — no dose to credit

    const actual = actualStimulus(matchedRun.data, planned, session, { vdot, tPaceSecPerMi });
    if (actual == null) continue; // a run exists but no basis could read it

    const { domain, workMinutes } = actual.stimulus;
    if (EXCLUDED_DOMAINS.has(domain) || !(workMinutes > 0)) continue;

    const current = maxByDomain.get(domain) ?? 0;
    if (workMinutes > current) maxByDomain.set(domain, workMinutes);
  }

  // `roundTo` (`lib/format/run.ts`), never a hand-rolled `Math.round(x*10)/10`
  // — `_format_lint.test.ts` (FORMAT-1) polices exactly this rounding rule
  // against a second, independently-invented one drifting from it.
  const atPaceMinutesByDomain: Record<string, number> = {};
  for (const [domain, minutes] of maxByDomain) {
    atPaceMinutesByDomain[domain] = roundTo(minutes, 1);
  }
  return { atPaceMinutesByDomain, windowDescribed };
}

/**
 * A thrown pace-anchor read and a REFUSED one both mean "nobody knows this
 * runner's established threshold today", and both must produce the same
 * downstream behaviour: `tPaceSecPerMi` null, no domain reclassification.
 * Written as try/catch rather than `resolvePrescribedPaceAnchors(...)
 * .catch(() => null)` — the SAME choice `lib/execution/load.ts` makes for the
 * identical read, and for the same stated reason (that file's own comment):
 * "the coercion scanner cannot see that a later `if (anchors == null)` branch
 * makes the collapse harmless, and a reader cannot either." A blind
 * `.catch(() => null)` attached to an awaited call is exactly the shape
 * `lib/audit/coercion-scan.ts#findBlindIndirect` polices (COERCION-1) —
 * confirmed by running the scan, which is how this function came to be
 * written this way rather than the shorter form.
 */
async function readCanonicalThreshold(userUuid: string, todayISO: string): Promise<number | null> {
  try {
    const read = await resolvePrescribedPaceAnchors(userUuid, todayISO);
    return read.ok ? read.anchors.thresholdSecPerMi : null;
  } catch {
    return null;
  }
}

/** Same reasoning as `readCanonicalThreshold` immediately above, for the
 *  second read this function needs. A failed or absent VDOT snapshot only
 *  affects `expandPlanned`'s easy-band pricing fallback (rung 2 of
 *  `plannedStimulus`) — never whether a domain is credited at all. */
async function readVdot(userUuid: string, todayISO: string): Promise<number | null> {
  try {
    const read = await resolveCurrentVdotSnapshot(userUuid, todayISO);
    return read.ok ? read.vdot : null;
  } catch {
    return null;
  }
}

/** ISO date `days` after `isoDate` (noon-anchored → DST-safe). The SAME
 *  construction `lib/training/normal-window.ts`'s own private `isoShift`
 *  uses — copied rather than imported because it is not exported there (and
 *  every other reader in this codebase that needs one, from `lib/plan/
 *  generate.ts#addDays` to a dozen test fixtures, re-states the same handful
 *  of lines locally rather than the app growing a shared date-math module
 *  nobody has asked for). This is date ARITHMETIC, not the window-
 *  construction MECHANISM item 1 of this file's header refuses to duplicate —
 *  the mechanism is "roll the lower bound `N` days back from today, recompute
 *  on every read", which this function's ONE call site above implements. */
function shiftISODate(isoDate: string, days: number): string {
  const DAY_MS = 86400000;
  return new Date(Date.parse(`${isoDate}T12:00:00Z`) + days * DAY_MS)
    .toISOString().slice(0, 10);
}
