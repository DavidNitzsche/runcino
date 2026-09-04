/**
 * lib/execution/_identity_truth_table.test.ts · EXECUTION-IDENTITY-TRUTH-1
 * (2026-09-04). The named invariants of "which run executed which
 * prescription", stated ONCE as a table rather than as prose scattered
 * across `day-resolver.ts`'s header, `seal.ts`'s header and thirteen
 * individually-worded `it()` blocks.
 *
 * Sibling of `_day_resolver.test.ts`, not a replacement for it. That file
 * narrates the two incidents (WORKOUT-EXECUTION-ID-1, PASSIVE-SYNC-TYPE-
 * CONFIRM-1) case by case; this file asserts the RULE each of those cases is
 * an instance of, and applies six universal conservation invariants to every
 * row at once — the properties no single narrated case checks because each
 * one only looks at its own outcome.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * The audit question it was written to answer: David's 2026-08-31 run
 * resolved as `easy 4.5mi` → run `-41598809443969` (6.18 mi) →
 * `match=legacy_type`. NOT `exact`. Verified against production, 2026-09-04:
 *
 *   • `data.planWorkoutId` is NULL on that row, so the EXACT tier was never
 *     reachable. The row's `activityId` is `wko_F1BC81A2-…`, the slug shape
 *     `/api/ingest/workout` mints — the passive HealthKit path, which has
 *     never stamped `planWorkoutId`. Only `/api/watch/workouts/complete`
 *     writes that key, and only since 2026-09-03. Production carries the
 *     stamp on 2 of 159 canonical rows, so essentially the entire history of
 *     this app resolves through the LEGACY tier, not the EXACT one.
 *   • It reached LEGACY on `source='apple_watch'` + `data.type='easy'`
 *     (PASSIVE-SYNC-TYPE-CONFIRM-1) + `workoutType='easy'` /
 *     `workoutTypeSource='plan'` + a lone easy prescription that day.
 *
 * See `docs/reports/core-closure-2026-09-04/EXECUTION-IDENTITY-AUDIT.md` for
 * the one real defect this audit found (EXECIDENT-1), which is stated below
 * as an `it.fails` rather than being silently characterised as correct.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 * Stated plainly, because a gate that does not say what it is blind to
 * invites exactly the false confidence Rule 22 was locked over:
 *
 *  1. THE WRITE SIDE. Every row here hands the resolver a `data` object
 *     directly. Nothing checks that `/api/ingest/workout` or
 *     `/api/watch/workouts/complete` actually produce these shapes, that the
 *     ±band in `lib/runs/plan-type-stamp.ts` is right, or that a stamp
 *     written months ago still describes today's plan (Rule 10). A resolver
 *     that is perfect on garbage input is still wrong on screen.
 *  2. PROVENANCE OF `data.type`. The resolver receives `runs.data` and never
 *     the `runs.provenance` column, so no row here can distinguish a run's
 *     OWN self-report from a value absorbed off a merged sibling. That is
 *     EXECIDENT-1 and it is why one test below is `it.fails`.
 *  3. DEDUP CORRECTNESS. `getCanonicalRunIds` is mocked. Rows that model the
 *     mirrored-pair and delayed-copy cases assert what the resolver does
 *     with the survivor set it is handed; whether `lib/runs/identity.ts`
 *     picks the right survivor is that module's own gate.
 *  4. CROSS-USER LEAKAGE AT RUNTIME. `pool.query` is mocked, so the
 *     `user_uuid` predicate is asserted as SQL TEXT and bound parameters,
 *     never executed. A Postgres-level mistake (a wrong cast, a NULL uuid
 *     matching) would pass here.
 *  5. RENDERING. Rule 13 is not satisfied by anything in this file. Nothing
 *     here proves what David sees on his phone.
 *  6. GRADING PROSE. This file asserts that a supplemental run never becomes
 *     a prescription's `matchedRun` and never seals it. What
 *     `lib/execution/interpret.ts` then writes about a matched run is that
 *     file's gate (`_interpret.test.ts`), not this one's.
 *
 * ── FALSIFICATION PROTOCOL (Rule 18) ───────────────────────────────────────
 *
 * Every row carries a `falsifiedBy` string naming the exact line in
 * `day-resolver.ts` whose removal makes that row fail. Each was confirmed by
 * deleting that line locally, watching the named row go red, and restoring
 * it — the edits are NOT committed, and `day-resolver.ts` is untouched by
 * this branch (`git diff origin/main -- lib/execution/day-resolver.ts` is
 * empty). The universal invariants at the bottom of `assertDay` are
 * falsified by the same edits: dropping `claimed.add(best.runId)` breaks
 * ONE-RUN-ONE-PRESCRIPTION on the mirrored-pair rows, and dropping the
 * `matchedWorkoutId: null` re-map in the supplemental projection breaks
 * SUPPLEMENTAL-CARRIES-NO-CLAIM everywhere at once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runs/volume', () => ({ getCanonicalRunIds: vi.fn() }));

import { pool } from '@/lib/db/pool';
import { getCanonicalRunIds } from '@/lib/runs/volume';
import {
  resolveDayExecutions,
  type ResolvedDay,
  type ExecutionMatch,
} from './day-resolver';
import { isPrescriptionSealed, isDaySealed } from '@/lib/plan/seal';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const OTHER_USER = 'ffffffff-0000-4000-8000-ffffffffffff';
const DAY = '2026-08-31';

interface Prescription {
  id: string; type: string; distance_mi: string | null; sub_label: string | null;
  is_quality: boolean; is_long: boolean;
}
interface Run { id: string; data: Record<string, unknown> }

/** Every SQL string and parameter list the resolver issued during the last
 *  `wire()`d call — so the population-scope block below can assert Rule 14
 *  (a query names the population it reads) without a live database. */
const seen: { sql: string; params: unknown[] }[] = [];

/**
 * `canonicalIds`, when passed, reproduces the real SQL's
 * `AND r.id::text = ANY($4::text[])` filter: a row present in `runs` but
 * absent from the canonical set never reaches the resolver, exactly as a
 * dedup-losing sibling never reaches it in production. Defaults to every
 * run's own id (nothing pre-excluded).
 */
function wire(
  prescriptions: Prescription[],
  runs: Run[],
  opts: { day?: string; canonicalIds?: string[] } = {},
) {
  const day = opts.day ?? DAY;
  const canonicalIds = opts.canonicalIds ?? runs.map((r) => r.id);
  seen.length = 0;
  (getCanonicalRunIds as any).mockResolvedValue(canonicalIds);
  (pool.query as any).mockImplementation((sql: string, params: unknown[]) => {
    seen.push({ sql, params });
    if (sql.includes('FROM plan_workouts')) {
      return Promise.resolve({ rows: prescriptions.map((p) => ({ ...p, date_iso: day })) });
    }
    if (sql.includes('FROM runs')) {
      const survivors = runs.filter((r) => canonicalIds.includes(r.id));
      return Promise.resolve({ rows: survivors.map((r) => ({ ...r, day, shoe_id: null })) });
    }
    return Promise.resolve({ rows: [] });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * The prescriptions the table draws on. Real shapes: `EASY` is David's
 * 2026-08-31 row verbatim (4.5 mi, strides sub-label), `INTERVALS` is the
 * 2026-09-03 hill session the friend's run was rendered over.
 * ══════════════════════════════════════════════════════════════════════════ */
const EASY: Prescription = {
  id: 'pw_easy', type: 'easy', distance_mi: '4.5',
  sub_label: 'EASY · 6×20s strides', is_quality: false, is_long: false,
};
const EASY_2: Prescription = { ...EASY, id: 'pw_easy_2', distance_mi: '3', sub_label: 'Shakeout' };
const INTERVALS: Prescription = {
  id: 'pw_int', type: 'intervals', distance_mi: '6',
  sub_label: '10×60s hills', is_quality: true, is_long: false,
};
const LONG: Prescription = {
  id: 'pw_long', type: 'long', distance_mi: '16',
  sub_label: 'Long run', is_quality: false, is_long: true,
};
const TUNEUP: Prescription = {
  id: 'pw_tuneup', type: 'race_week_tuneup', distance_mi: '5',
  sub_label: 'Race-week tune-up', is_quality: true, is_long: false,
};

/** A run that satisfies every LEGACY condition except the one under test —
 *  so a row that comes out supplemental proves the named field is what
 *  refused it, not some other missing precondition. */
function qualifying(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    distanceMi: 4.5, source: 'apple_watch', type: 'easy',
    workoutType: 'easy', workoutTypeSource: 'plan', ...over,
  };
}

interface Row {
  /** The named invariant this row is an instance of. */
  invariant: string;
  name: string;
  prescriptions: Prescription[];
  runs: Run[];
  canonicalIds?: string[];
  /** prescription id → the run that satisfies it, or null for "nothing does". */
  matched: Record<string, { runId: string; match: ExecutionMatch } | null>;
  /** run ids expected in `supplementalRuns`, in resolver order. */
  supplemental: string[];
  /** Rule 18 · the exact guard whose removal turns this row red. */
  falsifiedBy: string;
}

const TABLE: Row[] = [
  /* ── SUPPLEMENTAL NEVER COMPLETES ─────────────────────────────────────── */
  {
    invariant: 'SUPPLEMENTAL-NEVER-COMPLETES',
    name: 'the only run of the day, unstamped, leaves the prescription unmatched and keeps its mileage',
    prescriptions: [INTERVALS],
    runs: [{ id: 'r_friend', data: { distanceMi: 4.48, source: 'apple_watch' } }],
    matched: { pw_int: null },
    supplemental: ['r_friend'],
    falsifiedBy: 'pass 2 · `if (r.data.workoutTypeSource !== \'plan\') return false`, and behind '
      + 'it the source/own-type gate. FALSIFIED by replacing the whole `legacyRuns` predicate '
      + 'with the pre-fix rule (`return !claimed.has(r.runId)` — any unclaimed run of the day): '
      + 'the day\'s only run completes the hill session, which is the live '
      + 'WORKOUT-EXECUTION-ID-1 defect exactly. That single edit turns 28 of this file\'s 59 '
      + 'tests red, which is the measurement of what the fix is worth.',
  },
  {
    invariant: 'SUPPLEMENTAL-NEVER-COMPLETES',
    name: 'three unstamped runs on a prescribed day are three supplemental runs, not one completion',
    prescriptions: [INTERVALS],
    runs: [
      { id: 'r_a', data: { distanceMi: 2.0, source: 'apple_watch' } },
      { id: 'r_b', data: { distanceMi: 6.1, source: 'apple_health' } },
      { id: 'r_c', data: { distanceMi: 1.2, source: 'strava' } },
    ],
    matched: { pw_int: null },
    supplemental: ['r_a', 'r_b', 'r_c'],
    falsifiedBy: 'the same pass-2 predicate (falsified by the pre-fix-rule edit above), plus '
      + '`pickRichest` — a "biggest run of the day wins" rule hands r_b the prescription; '
      + 'David\'s ruling names largest-run-of-the-day EXPLICITLY INSUFFICIENT.',
  },

  /* ── DATE COINCIDENCE IS INSUFFICIENT ─────────────────────────────────── */
  {
    invariant: 'DATE-COINCIDENCE-INSUFFICIENT',
    name: 'same calendar date, only run of the day, generic label — still supplemental',
    prescriptions: [INTERVALS],
    runs: [{ id: 'r_same_date', data: { distanceMi: 6.0, source: 'apple_watch', type: 'Run' } }],
    matched: { pw_int: null },
    supplemental: ['r_same_date'],
    falsifiedBy: 'the whole of pass 2 — the pre-fix predicate was "a prescription exists on this '
      + 'date and a run exists on this date", which matches this row on sight. Confirmed red '
      + 'under the pre-fix-rule edit; nothing weaker than that edit reaches it, because the '
      + 'row carries no stamp for any narrower guard to reject.',
  },

  /* ── WORKOUT-NAME SIMILARITY IS INSUFFICIENT ──────────────────────────── */
  {
    invariant: 'NAME-SIMILARITY-INSUFFICIENT',
    name: 'a run whose title is the prescription\'s sub_label verbatim is still supplemental',
    prescriptions: [INTERVALS],
    runs: [{
      id: 'r_named', data: {
        distanceMi: 6.0, source: 'apple_watch', type: 'Run',
        name: '10×60s hills', // byte-identical to INTERVALS.sub_label
      },
    }],
    matched: { pw_int: null },
    supplemental: ['r_named'],
    falsifiedBy: 'nothing in day-resolver.ts reads `data.name` or `sub_label` at all — this row '
      + 'goes red the moment any name/label similarity tier is introduced, which is its purpose. '
      + 'Strava titles are runner-authored free text and can be copied, shared, or auto-filled.',
  },
  {
    invariant: 'NAME-SIMILARITY-INSUFFICIENT',
    name: 'a run titled "Easy" on an easy day, with no stamp, is still supplemental',
    prescriptions: [EASY],
    runs: [{ id: 'r_titled_easy', data: { distanceMi: 4.5, source: 'apple_watch', name: 'Easy' } }],
    matched: { pw_easy: null },
    supplemental: ['r_titled_easy'],
    falsifiedBy: 'same — `data.name` is never read. Note this row also has the exact prescribed '
      + 'distance, so it falsifies a name-OR-distance tier equally.',
  },

  /* ── DISTANCE PROXIMITY IS INSUFFICIENT ───────────────────────────────── */
  {
    invariant: 'DISTANCE-PROXIMITY-INSUFFICIENT',
    name: 'a run at exactly the prescribed distance, unstamped, is still supplemental',
    prescriptions: [INTERVALS],
    runs: [{ id: 'r_exact_dist', data: { distanceMi: 6.0, source: 'apple_watch' } }],
    matched: { pw_int: null },
    supplemental: ['r_exact_dist'],
    falsifiedBy: 'add any `Math.abs(distanceMi - p.distanceMi) < eps` tier to pass 2 and this '
      + 'row matches on a zero-error fit. Distance is a property of the effort, not of its '
      + 'identity: two runners on the same road cover the same 6 miles.',
  },
  {
    invariant: 'DISTANCE-PROXIMITY-INSUFFICIENT',
    name: 'perfect distance AND perfect type AND a plan stamp cannot beat a disallowed source',
    prescriptions: [EASY],
    runs: [{ id: 'r_strava_perfect', data: qualifying({ source: 'strava' }) }],
    matched: { pw_easy: null },
    supplemental: ['r_strava_perfect'],
    falsifiedBy: 'pass 2 · `if (!LIVE_TRACKED_SOURCES.has(source) && !isConfirmedAppleWatchSync) '
      + 'return false` — every other signal on this row is a perfect fit, so the source gate is '
      + 'demonstrably the only thing refusing it.',
  },

  /* ── A MIRRORED PAIR IS ONE EXECUTION ─────────────────────────────────── */
  {
    invariant: 'MIRRORED-PAIR-IS-ONE-EXECUTION',
    name: 'phone + Watch mirror, dedup already collapsed them — one exact execution, no supplemental ghost',
    prescriptions: [INTERVALS],
    runs: [
      { id: 'r_phone', data: { distanceMi: 6.0, source: 'phone', planWorkoutId: 'pw_int' } },
      { id: 'r_watch_mirror', data: { distanceMi: 6.02, source: 'watch', planWorkoutId: 'pw_int' } },
    ],
    canonicalIds: ['r_phone'],
    matched: { pw_int: { runId: 'r_phone', match: 'exact' } },
    supplemental: [],
    falsifiedBy: 'the run query\'s `AND r.id::text = ANY($4::text[])` — drop the canonical filter '
      + 'and the mirror reappears as a phantom supplemental run, inflating the day\'s mileage by '
      + 'a full duplicate of the same physical effort.',
  },
  {
    invariant: 'MIRRORED-PAIR-IS-ONE-EXECUTION',
    name: 'both halves of the mirror survived dedup — exactly ONE completes, never two, never a duplicate grade',
    prescriptions: [INTERVALS],
    runs: [
      // Same physical run, both stamped against the same prescription. The
      // richer row (it carries phases) is the one the resolver must keep.
      { id: 'r_watch_rich', data: { distanceMi: 6.0, source: 'watch', planWorkoutId: 'pw_int', phases: [{}, {}] } },
      { id: 'r_phone_thin', data: { distanceMi: 6.0, source: 'phone', planWorkoutId: 'pw_int' } },
    ],
    matched: { pw_int: { runId: 'r_watch_rich', match: 'exact' } },
    supplemental: ['r_phone_thin'],
    falsifiedBy: 'pass 1 · `pickRichest(exactRuns)` + `claimed.add(best.runId)`. Without the '
      + 'single-winner reduce the prescription would carry two executions; without `claimed` the '
      + 'loser could go on to satisfy a second prescription. This is the only row in the table '
      + 'where two rows legitimately hold the same planWorkoutId.',
  },

  /* ── TREADMILL COMPLETION + DELAYED COPY IS ONE EXECUTION ─────────────── */
  {
    invariant: 'TREADMILL-PLUS-DELAYED-COPY-IS-ONE-EXECUTION',
    name: 'treadmill completion, later HealthKit copy removed by dedup — one execution',
    prescriptions: [EASY],
    runs: [
      { id: 'r_treadmill', data: { distanceMi: 4.5, source: 'treadmill', planWorkoutId: 'pw_easy', indoor: true } },
      { id: 'r_hk_copy', data: { distanceMi: 4.48, source: 'apple_health', type: 'easy' } },
    ],
    canonicalIds: ['r_treadmill'],
    matched: { pw_easy: { runId: 'r_treadmill', match: 'exact' } },
    supplemental: [],
    falsifiedBy: 'the canonical filter again — and note the HK copy carries a confirming own '
      + 'type, so if it DID reach the resolver on a day whose treadmill row lacked a '
      + 'planWorkoutId, only the source gate would stand between it and a second claim.',
  },
  {
    invariant: 'TREADMILL-PLUS-DELAYED-COPY-IS-ONE-EXECUTION',
    name: 'the delayed Strava copy survived dedup — the treadmill row still owns the prescription, the copy is supplemental',
    prescriptions: [EASY],
    runs: [
      { id: 'r_treadmill', data: { distanceMi: 4.5, source: 'treadmill', planWorkoutId: 'pw_easy' } },
      { id: 'r_strava_copy', data: qualifying({ source: 'strava', distanceMi: 4.5 }) },
    ],
    matched: { pw_easy: { runId: 'r_treadmill', match: 'exact' } },
    supplemental: ['r_strava_copy'],
    falsifiedBy: 'pass 1 running BEFORE pass 2, plus `claimed`. Reverse the two passes and the '
      + 'Strava copy — which is a perfect legacy fit apart from its source — would be competing '
      + 'for a prescription that already has a durable owner.',
  },
  {
    invariant: 'TREADMILL-PLUS-DELAYED-COPY-IS-ONE-EXECUTION',
    name: 'a pre-2026-09-03 treadmill completion with no planWorkoutId still completes via LEGACY',
    prescriptions: [EASY],
    runs: [{ id: 'r_trd_legacy', data: { distanceMi: 4.5, source: 'treadmill', workoutType: 'easy', workoutTypeSource: 'plan' } }],
    matched: { pw_easy: { runId: 'r_trd_legacy', match: 'legacy_type' } },
    supplemental: [],
    falsifiedBy: 'pass 2 · `LIVE_TRACKED_SOURCES` containing "treadmill". Remove it and every '
      + 'treadmill session predating the planWorkoutId stamp — 157 of this account\'s 159 '
      + 'canonical rows have no stamp — silently stops completing anything.',
  },

  /* ── A GENUINE OVERRUN STILL MATCHES ──────────────────────────────────── */
  {
    invariant: 'OVERRUN-STILL-MATCHES',
    name: 'the live 2026-08-31 row: easy 4.5 mi prescribed, 6.18 mi run (+37%), apple_watch, own type easy → legacy_type',
    prescriptions: [EASY],
    runs: [{
      // Production row `-41598809443969`, field for field.
      id: '-41598809443969',
      data: {
        distanceMi: 6.18, source: 'apple_watch', type: 'easy',
        workoutType: 'easy', workoutTypeSource: 'plan',
        name: 'Run', sportType: 'Run',
      },
    }],
    matched: { pw_easy: { runId: '-41598809443969', match: 'legacy_type' } },
    supplemental: [],
    falsifiedBy: 'OVERRUN-MATCH-1 · `PLANNED_DISTANCE_CEILING_MULT` in lib/runs/plan-type-stamp.ts. '
      + 'Restore the old symmetric 1.3 and the ingest route never writes the workoutType stamp at '
      + 'all, so this row arrives here bare and files as supplemental — a stranger to its own '
      + 'session. David, live: "Mondays run did match it just went longer."',
  },
  {
    invariant: 'OVERRUN-STILL-MATCHES',
    name: 'an exact link survives any overrun — 20.4 mi against a 16 mi long run is still exact',
    prescriptions: [LONG],
    runs: [{ id: 'r_long_over', data: { distanceMi: 20.4, source: 'watch', planWorkoutId: 'pw_long' } }],
    matched: { pw_long: { runId: 'r_long_over', match: 'exact' } },
    supplemental: [],
    falsifiedBy: 'pass 1 · `r.matchedWorkoutId === p.id`. Add any distance sanity band to the '
      + 'EXACT tier and this row breaks. The EXACT tier is deliberately distance-blind: a '
      + 'row-to-row link the app itself wrote is stronger evidence than any distance heuristic.',
  },
  {
    invariant: 'RESOLVER-APPLIES-NO-DISTANCE-BOUND',
    name: 'boundary statement, not an endorsement · the LEGACY tier has no distance check of its own',
    prescriptions: [EASY],
    runs: [{ id: 'r_way_long', data: qualifying({ distanceMi: 22.0 }) }],
    matched: { pw_easy: { runId: 'r_way_long', match: 'legacy_type' } },
    supplemental: [],
    falsifiedBy: 'nothing in pass 2 compares distances. Stated as a row so the fact is VISIBLE: '
      + 'the only distance bound protecting the LEGACY tier is [0.7×, 2.0×] frozen into '
      + '`data.workoutType` at ingest time by lib/runs/plan-type-stamp.ts. Per Rule 10 that is a '
      + 'persisted derived value read back without its anchor — if the prescription\'s distance '
      + 'later changes, nothing re-derives the stamp. See the audit report §4.',
  },

  /* ── AMBIGUITY STAYS EXPLICIT ─────────────────────────────────────────── */
  {
    invariant: 'AMBIGUITY-REFUSES',
    name: 'two easy prescriptions, one qualifying run — the resolver refuses both rather than guessing',
    prescriptions: [EASY, EASY_2],
    runs: [{ id: 'r_easy', data: qualifying() }],
    matched: { pw_easy: null, pw_easy_2: null },
    supplemental: ['r_easy'],
    falsifiedBy: 'pass 2 · `if ((typeCounts.get(t) ?? 0) !== 1) continue`. Remove it and the '
      + 'FIRST-DECLARED prescription silently wins — ordering deciding association, which is '
      + 'precisely what David\'s ruling forbids. Rule 11: a refusal is a third fact, not a zero.',
  },
  {
    invariant: 'AMBIGUITY-REFUSES',
    name: 'two easy prescriptions, two qualifying runs — refusal is not "pair them up in order"',
    prescriptions: [EASY, EASY_2],
    runs: [
      { id: 'r_first', data: qualifying({ distanceMi: 4.5 }) },
      { id: 'r_second', data: qualifying({ distanceMi: 3.0 }) },
    ],
    matched: { pw_easy: null, pw_easy_2: null },
    supplemental: ['r_first', 'r_second'],
    falsifiedBy: 'the same `typeCounts` guard. Note the distances pair off perfectly (4.5↔4.5, '
      + '3.0↔3.0), so a "greedy nearest distance" repair of the ambiguity would look convincing '
      + 'and be unfounded — the two-a-day is exactly where a wrong pairing grades the shakeout '
      + 'as the session.',
  },
  {
    invariant: 'AMBIGUITY-REFUSES',
    name: 'ambiguity is per TYPE, not per day — an easy + intervals day still resolves the easy one',
    prescriptions: [EASY, INTERVALS],
    runs: [{ id: 'r_easy', data: qualifying() }],
    matched: { pw_easy: { runId: 'r_easy', match: 'legacy_type' }, pw_int: null },
    supplemental: [],
    falsifiedBy: 'the `typeCounts` map being keyed on normType(p.type) rather than counting the '
      + 'day\'s prescriptions. Key it on the day and a legitimate two-a-day would refuse both, '
      + 'which is the over-correction this row guards against.',
  },

  /* ── A FOREIGN OR STALE LINK NEVER MATCHES ────────────────────────────── */
  {
    invariant: 'FOREIGN-LINK-NEVER-MATCHES',
    name: 'a run stamped against another plan version\'s workout id is supplemental, and its claim is cleared',
    prescriptions: [EASY],
    runs: [{ id: 'r_stale', data: qualifying({ planWorkoutId: 'pw_from_a_rebuilt_plan' }) }],
    matched: { pw_easy: null },
    supplemental: ['r_stale'],
    falsifiedBy: 'TWO guards at once. Pass 1 · `r.matchedWorkoutId === p.id` (an id must name a '
      + 'prescription that exists TODAY — Rule 10). Pass 2 · `if (r.matchedWorkoutId) return '
      + 'false` (a run that already declared WHICH prescription it executed does not fall back '
      + 'to a type guess naming a DIFFERENT one). Delete either and this row goes red; delete '
      + 'the second and a run stamped for yesterday\'s tempo completes today\'s easy day.',
  },
  {
    invariant: 'FOREIGN-LINK-NEVER-MATCHES',
    name: 'a run carrying an empty-string planWorkoutId is treated as unstamped, not as a match',
    prescriptions: [EASY],
    runs: [{ id: 'r_empty_id', data: qualifying({ planWorkoutId: '' }) }],
    matched: { pw_easy: { runId: 'r_empty_id', match: 'legacy_type' } },
    supplemental: [],
    falsifiedBy: 'the classify step · `data.planWorkoutId !== \'\'`. Without the empty check the '
      + 'row would carry a falsy-but-present claim, be excluded from pass 2 by '
      + '`if (r.matchedWorkoutId)`, and match nothing — Rule 11 again, "" is absent, not a value.',
  },

  /* ── THE GENERIC LABEL CONFIRMS NOTHING ───────────────────────────────── */
  ...([
    ['Run', 'Strava\'s activity type, on 68% of rows'],
    ['run', 'lower case'],
    ['  RUN  ', 'padded and upper case — normalisation must not create a confirmation'],
    ['', 'empty string'],
  ] as const).map(([label, why]): Row => ({
    invariant: 'GENERIC-LABEL-CONFIRMS-NOTHING',
    name: `own type ${JSON.stringify(label)} (${why}) confirms nothing — supplemental`,
    prescriptions: [EASY],
    runs: [{ id: 'r_generic', data: qualifying({ type: label }) }],
    matched: { pw_easy: null },
    supplemental: ['r_generic'],
    falsifiedBy: 'ownTypeConfirms, where TWO guards each independently refuse this row: the '
      + 'early `if (norm === \'\' || norm === \'run\') return false` and the closing '
      + '`return norm === normType(prescribedType).toLowerCase()`. Measured: removing either '
      + 'alone leaves the row green (no prescription type in production is \'run\' or \'\', so '
      + 'the equality check covers the same ground); removing BOTH turns all four green — i.e. '
      + 'lets them match. The redundancy is real and is recorded in the audit report §5, since '
      + 'the header presents the early return as the load-bearing guard and it is not.',
  })),
  {
    invariant: 'GENERIC-LABEL-CONFIRMS-NOTHING',
    name: 'a missing own type confirms nothing — the original friend\'s-run shape',
    prescriptions: [EASY],
    runs: [{ id: 'r_no_type', data: { distanceMi: 4.5, source: 'apple_watch', workoutType: 'easy', workoutTypeSource: 'plan' } }],
    matched: { pw_easy: null },
    supplemental: ['r_no_type'],
    falsifiedBy: 'ownTypeConfirms · `if (typeof ownType !== \'string\') return false`. This is '
      + 'the shape /api/ingest/workout writes today — it puts NO `type` key on the payload at '
      + 'all — so an un-merged passive sync always lands here.',
  },
  {
    invariant: 'GENERIC-LABEL-CONFIRMS-NOTHING',
    name: 'a non-string own type confirms nothing',
    prescriptions: [EASY],
    runs: [{ id: 'r_num_type', data: qualifying({ type: 3 }) }],
    matched: { pw_easy: null },
    supplemental: ['r_num_type'],
    falsifiedBy: 'the same typeof guard. Strava\'s own `workout_type` IS a numeric enum '
      + '(0/1/2/3), so a numeric value landing in this key is a real shape, not a hypothetical.',
  },
  {
    invariant: 'GENERIC-LABEL-CONFIRMS-NOTHING',
    name: 'an own type that DISAGREES with the prescription refuses, however perfect the stamp',
    prescriptions: [EASY],
    runs: [{ id: 'r_disagree', data: qualifying({ type: 'tempo' }) }],
    matched: { pw_easy: null },
    supplemental: ['r_disagree'],
    falsifiedBy: 'ownTypeConfirms · `return norm === normType(prescribedType).toLowerCase()`. '
      + 'Weaken it to a truthiness check and any non-generic label confirms any prescription.',
  },

  /* ── SOURCE SCOPE ─────────────────────────────────────────────────────── */
  ...([
    'strava', 'strava_webhook', 'apple_health', 'healthkit', 'manual', 'garmin', 'import', '',
  ]).map((source): Row => ({
    invariant: 'PASSIVE-PATH-IS-APPLE-WATCH-ONLY',
    name: `source ${JSON.stringify(source)} never qualifies for the passive path, however well its own type agrees`,
    prescriptions: [EASY],
    runs: [{ id: 'r_src', data: qualifying({ source }) }],
    matched: { pw_easy: null },
    supplemental: ['r_src'],
    falsifiedBy: 'pass 2 · `source === \'apple_watch\' && ownTypeConfirms(...)`. Widen the '
      + 'comparison to "any passive sync with a confirming own type" and every row in this group '
      + 'goes green — which would re-admit Strava\'s freeform, third-party categorisation as '
      + 'identity evidence.',
  })),
  {
    invariant: 'PASSIVE-PATH-IS-APPLE-WATCH-ONLY',
    name: 'a run with no source at all never qualifies',
    prescriptions: [EASY],
    runs: [{ id: 'r_no_src', data: { distanceMi: 4.5, type: 'easy', workoutType: 'easy', workoutTypeSource: 'plan' } }],
    matched: { pw_easy: null },
    supplemental: ['r_no_src'],
    falsifiedBy: 'pass 2 · `if (source == null) return false`. 70 canonical rows in production '
      + 'carry a NULL source; without this line their behaviour would depend on whether '
      + '`LIVE_TRACKED_SOURCES.has(null)` happens to be false, which is coincidence, not a guard.',
  },
  ...(['watch', 'phone', 'treadmill']).map((source): Row => ({
    invariant: 'LIVE-TRACKED-SOURCES-TRUSTED-UNCONDITIONALLY',
    name: `source ${JSON.stringify(source)} completes on the stamp alone, with no own type — starting the session in the app IS the declaration of intent`,
    prescriptions: [EASY],
    runs: [{ id: 'r_live', data: { distanceMi: 4.5, source, workoutType: 'easy', workoutTypeSource: 'plan' } }],
    matched: { pw_easy: { runId: 'r_live', match: 'legacy_type' } },
    supplemental: [],
    falsifiedBy: 'pass 2 · `LIVE_TRACKED_SOURCES.has(source)`. Removing a member silently stops '
      + 'that recorder from ever completing a pre-stamp prescription. Stated as a row per Rule 22 '
      + 'because the DOWNWARD guards in this file outnumber the upward permissions and only these '
      + 'three rows assert that anything is allowed to complete on legacy evidence.',
  })),

  /* ── STAMP NORMALISATION AGREES WITH THE WRITERS ──────────────────────── */
  {
    invariant: 'NORMALISATION-AGREES-WITH-THE-WRITERS',
    name: 'a race-week tune-up is matched by a threshold stamp — the reader normalises the way both writers do',
    prescriptions: [TUNEUP],
    runs: [{ id: 'r_tuneup', data: qualifying({ distanceMi: 5, type: 'threshold', workoutType: 'threshold' }) }],
    matched: { pw_tuneup: { runId: 'r_tuneup', match: 'legacy_type' } },
    supplemental: [],
    falsifiedBy: 'normType · `t === \'race_week_tuneup\' ? \'threshold\' : t`. Both write paths '
      + '(/api/ingest/workout and /api/watch/workouts/complete) already collapse the tune-up to '
      + '"threshold" before stamping, so a reader that did not would never match a tune-up at '
      + 'all — the two sides must normalise identically or the tier is dead for that type.',
  },

  /* ── NOTHING PRESCRIBED ───────────────────────────────────────────────── */
  {
    invariant: 'NO-PRESCRIPTION-GRADES-NOTHING',
    name: 'a rest day with a run on it grades nothing and loses no mileage',
    prescriptions: [],
    runs: [{ id: 'r_rest_day', data: qualifying({ distanceMi: 3.2 }) }],
    matched: {},
    supplemental: ['r_rest_day'],
    falsifiedBy: 'the resolver iterating `prescribedRows` — with none, both passes are no-ops. '
      + 'A rest day is filtered upstream by `WHERE owned.type <> \'rest\'`; this row states that '
      + 'the empty case is a real answer, not an error.',
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * The universal invariants. These hold for EVERY row above, not just the one
 * whose name mentions them — which is the property no individually-narrated
 * test in `_day_resolver.test.ts` can assert, because each of those only
 * inspects its own expected outcome.
 * ══════════════════════════════════════════════════════════════════════════ */
function assertUniversalInvariants(day: ResolvedDay, inputRunIds: string[]) {
  // SUPPLEMENTAL-CARRIES-NO-CLAIM · a supplemental run is never holding a
  // prescription id, even when the underlying row carried a stale one.
  for (const r of day.supplementalRuns) {
    expect(r.match).toBe('supplemental');
    expect(r.matchedWorkoutId).toBeNull();
  }

  // MATCH-IS-SELF-CONSISTENT · a matched run names the prescription that
  // holds it, and never claims to be supplemental.
  for (const p of day.prescriptions) {
    if (!p.matchedRun) continue;
    expect(p.matchedRun.matchedWorkoutId).toBe(p.id);
    expect(p.matchedRun.match).not.toBe('supplemental');
  }

  // ONE-RUN-ONE-PRESCRIPTION · no physical run satisfies two prescriptions.
  const matchedIds = day.prescriptions
    .map((p) => p.matchedRun?.runId)
    .filter((x): x is string => typeof x === 'string');
  expect(new Set(matchedIds).size).toBe(matchedIds.length);

  // DISJOINT · matched and supplemental never overlap.
  const suppIds = day.supplementalRuns.map((r) => r.runId);
  for (const id of matchedIds) expect(suppIds).not.toContain(id);

  // CONSERVATION · every canonical run the resolver was handed appears
  // exactly once, matched or supplemental. Nothing is invented and — the
  // half that matters for Rule 8's absorbed-load readers — nothing is lost.
  const accounted = [...matchedIds, ...suppIds].sort();
  expect(accounted).toEqual([...inputRunIds].sort());

  // NO-PHANTOM-PRESCRIPTION · the resolver never invents a prescription.
  expect(new Set(day.prescriptions.map((p) => p.id)).size).toBe(day.prescriptions.length);
}

describe('EXECUTION-IDENTITY-TRUTH-1 · the truth table', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(TABLE.map((row) => [`${row.invariant} · ${row.name}`, row] as const))(
    '%s',
    async (_title, row) => {
      wire(row.prescriptions, row.runs, { canonicalIds: row.canonicalIds });
      const day = await resolveDayExecutions(USER, DAY);

      for (const [pid, expected] of Object.entries(row.matched)) {
        const p = day.prescriptions.find((x) => x.id === pid);
        expect(p, `prescription ${pid} missing from the resolved day`).toBeDefined();
        if (expected === null) {
          expect(p!.matchedRun, `${pid} must stay unmatched`).toBeNull();
        } else {
          expect(p!.matchedRun?.runId, `${pid} matched the wrong run`).toBe(expected.runId);
          expect(p!.matchedRun?.match, `${pid} matched at the wrong tier`).toBe(expected.match);
        }
      }
      expect(day.prescriptions.map((p) => p.id).sort())
        .toEqual(Object.keys(row.matched).sort());
      expect(day.supplementalRuns.map((r) => r.runId)).toEqual(row.supplemental);

      const visible = row.canonicalIds ?? row.runs.map((r) => r.id);
      assertUniversalInvariants(day, visible);
    },
  );

  it('every row in the table names the guard that falsifies it (Rule 18)', () => {
    expect(TABLE.length).toBeGreaterThan(30);
    for (const row of TABLE) {
      expect(row.falsifiedBy.length, `${row.invariant} · ${row.name}`).toBeGreaterThan(60);
    }
    // Liveness · every named invariant is actually exercised by at least one
    // row. A truth table that silently loses a group reports clean while
    // testing nothing, which is the Rule 18 failure this project has shipped.
    const covered = new Set(TABLE.map((r) => r.invariant));
    expect([...covered].sort()).toEqual([
      'AMBIGUITY-REFUSES',
      'DATE-COINCIDENCE-INSUFFICIENT',
      'DISTANCE-PROXIMITY-INSUFFICIENT',
      'FOREIGN-LINK-NEVER-MATCHES',
      'GENERIC-LABEL-CONFIRMS-NOTHING',
      'LIVE-TRACKED-SOURCES-TRUSTED-UNCONDITIONALLY',
      'MIRRORED-PAIR-IS-ONE-EXECUTION',
      'NAME-SIMILARITY-INSUFFICIENT',
      'NO-PRESCRIPTION-GRADES-NOTHING',
      'NORMALISATION-AGREES-WITH-THE-WRITERS',
      'OVERRUN-STILL-MATCHES',
      'PASSIVE-PATH-IS-APPLE-WATCH-ONLY',
      'RESOLVER-APPLIES-NO-DISTANCE-BOUND',
      'SUPPLEMENTAL-NEVER-COMPLETES',
      'TREADMILL-PLUS-DELAYED-COPY-IS-ONE-EXECUTION',
    ]);
  });

  it('the table is not lopsided — it asserts what MAY complete, not only what may not (Rule 22)', () => {
    const completes = TABLE.filter((r) => Object.values(r.matched).some((m) => m !== null));
    const refuses = TABLE.filter((r) => Object.values(r.matched).every((m) => m === null));
    // Refusals legitimately outnumber permissions here — identity is a
    // conservative question and David's ruling names six insufficient
    // signals by hand. But the permitting side must not be decoration: it
    // covers every tier (exact + legacy) and every trusted source.
    expect(completes.length).toBeGreaterThanOrEqual(9);
    expect(refuses.length).toBeGreaterThan(completes.length);
    const tiers = new Set(
      completes.flatMap((r) => Object.values(r.matched).filter(Boolean).map((m) => m!.match)),
    );
    expect([...tiers].sort()).toEqual(['exact', 'legacy_type']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SEALING · the same table read through lib/plan/seal.ts, because "never
 * completes" and "never seals" are two claims and only the resolver's own
 * tests covered the first. seal.ts delegates to this resolver and owns no
 * second definition, so these rows are the proof of that delegation.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('EXECUTION-IDENTITY-TRUTH-1 · supplemental activity never seals', () => {
  beforeEach(() => vi.clearAllMocks());

  const SEAL_TABLE: {
    name: string;
    prescriptions: Prescription[];
    runs: Run[];
    sealedIds: string[];
    daySealed: boolean;
  }[] = [
    {
      name: 'a supplemental-only day seals nothing',
      prescriptions: [INTERVALS],
      runs: [{ id: 'r_friend', data: { distanceMi: 4.48, source: 'apple_watch' } }],
      sealedIds: [], daySealed: false,
    },
    {
      name: 'many supplemental runs still seal nothing — quantity is not identity',
      prescriptions: [INTERVALS],
      runs: [
        { id: 'r_a', data: { distanceMi: 6.4, source: 'apple_watch', type: 'Run' } },
        { id: 'r_b', data: { distanceMi: 3.0, source: 'strava', type: 'easy' } },
      ],
      sealedIds: [], daySealed: false,
    },
    {
      name: 'an EXACT match seals its own prescription',
      prescriptions: [INTERVALS],
      runs: [{ id: 'r_hills', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'pw_int' } }],
      sealedIds: ['pw_int'], daySealed: true,
    },
    {
      name: 'an accepted LEGACY match seals too — the 2026-08-31 row',
      prescriptions: [EASY],
      runs: [{ id: '-41598809443969', data: qualifying({ distanceMi: 6.18 }) }],
      sealedIds: ['pw_easy'], daySealed: true,
    },
    {
      name: 'an AMBIGUOUS day seals neither prescription — a refusal leaves the plan mutable',
      prescriptions: [EASY, EASY_2],
      runs: [{ id: 'r_easy', data: qualifying() }],
      sealedIds: [], daySealed: false,
    },
    {
      name: 'a two-a-day seals ONLY the prescription that was actually executed',
      prescriptions: [EASY, INTERVALS],
      runs: [{ id: 'r_hills', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'pw_int' } }],
      sealedIds: ['pw_int'], daySealed: true,
    },
    {
      name: 'a stale foreign link seals nothing',
      prescriptions: [EASY],
      runs: [{ id: 'r_stale', data: qualifying({ planWorkoutId: 'pw_from_a_rebuilt_plan' }) }],
      sealedIds: [], daySealed: false,
    },
  ];

  it.each(SEAL_TABLE.map((r) => [r.name, r] as const))('%s', async (_n, row) => {
    for (const p of row.prescriptions) {
      wire(row.prescriptions, row.runs);
      const sealed = await isPrescriptionSealed(USER, DAY, p.id);
      expect(sealed, `${p.id} sealing verdict`).toBe(row.sealedIds.includes(p.id));
    }
    wire(row.prescriptions, row.runs);
    expect(await isDaySealed(USER, DAY)).toBe(row.daySealed);
  });

  it('a prescription the resolver does not know about is NOT sealed — a rescheduled workout leaves its old date mutable', async () => {
    wire([EASY], [{ id: 'r_easy', data: qualifying() }]);
    expect(await isPrescriptionSealed(USER, DAY, 'pw_moved_away')).toBe(false);
  });

  it('a resolver FAILURE seals conservatively — refusing to write is recoverable, overwriting a completed session is not (Rule 11: a failed read is not a zero)', async () => {
    (getCanonicalRunIds as any).mockResolvedValue([]);
    (pool.query as any).mockRejectedValue(new Error('connection terminated'));
    expect(await isPrescriptionSealed(USER, DAY, 'pw_easy')).toBe(true);
    (pool.query as any).mockRejectedValue(new Error('connection terminated'));
    expect(await isDaySealed(USER, DAY)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * POPULATION SCOPE (Rule 14) · another runner's activity can never match,
 * because the resolver never READS one. Asserted on the SQL text and the
 * bound parameters, since `pool.query` is mocked — see blind spot 4 in the
 * header for what this consequently cannot prove.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('EXECUTION-IDENTITY-TRUTH-1 · another runner\'s activity can never match', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the run query is scoped by user_uuid, not by date alone, and binds the caller\'s uuid first', async () => {
    wire([EASY], [{ id: 'r_easy', data: qualifying() }]);
    await resolveDayExecutions(USER, DAY);
    const runQuery = seen.find((q) => q.sql.includes('FROM runs'));
    expect(runQuery, 'the resolver never queried runs').toBeDefined();
    expect(runQuery!.sql).toMatch(/r\.user_uuid\s*=\s*\$1/);
    expect(runQuery!.params[0]).toBe(USER);
    // And it is the CANONICAL row predicate, not the absorption stamp —
    // Rule 14's third incident, where filtering on the stamp zeroed 63 miles.
    expect(runQuery!.sql).toContain('mergedIntoId');
  });

  it('the prescription query binds the caller\'s uuid first — plan_workouts holds every runner and every plan version', async () => {
    wire([EASY], [{ id: 'r_easy', data: qualifying() }]);
    await resolveDayExecutions(USER, DAY);
    const planQuery = seen.find((q) => q.sql.includes('FROM plan_workouts'));
    expect(planQuery, 'the resolver never queried plan_workouts').toBeDefined();
    expect(planQuery!.sql).toMatch(/user_uuid\s*=\s*\$1/);
    expect(planQuery!.params[0]).toBe(USER);
  });

  it('the canonical-id gate is asked for THIS runner, not for the date globally', async () => {
    wire([EASY], [{ id: 'r_easy', data: qualifying() }]);
    await resolveDayExecutions(USER, DAY);
    expect(getCanonicalRunIds).toHaveBeenCalledWith(USER, DAY, '2026-09-01');
  });

  it('resolving for a different runner passes THAT runner\'s uuid through every read — no shared sentinel, no user_id = \'me\'', async () => {
    wire([EASY], [{ id: 'r_easy', data: qualifying() }]);
    await resolveDayExecutions(OTHER_USER, DAY);
    for (const q of seen) expect(q.params[0]).toBe(OTHER_USER);
    expect(getCanonicalRunIds).toHaveBeenCalledWith(OTHER_USER, DAY, '2026-09-01');
    for (const q of seen) expect(JSON.stringify(q.params)).not.toContain('"me"');
  });

  it('a foreign prescription id on a run is inert even when every other signal is a perfect fit', async () => {
    // The defence in depth behind the SQL scope: were a foreign row ever to
    // leak past the user predicate, its plan link names a prescription that
    // does not exist here, and pass 2 refuses to re-guess for a run that has
    // already declared what it executed.
    wire([EASY], [{ id: 'r_foreign', data: qualifying({ planWorkoutId: 'pw_someone_elses' }) }]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(day.prescriptions[0].matchedRun).toBeNull();
    expect(day.supplementalRuns[0].matchedWorkoutId).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE ONE OPEN DEFECT · EXECIDENT-1.
 *
 * Marked `it.fails` rather than deleted, so the gap is IN the suite and goes
 * green the day it is closed, instead of living only in a report nobody
 * re-reads. `day-resolver.ts` is owned by another workstream on this branch
 * and is deliberately not edited here.
 *
 * The finding, verified against production on 2026-09-04. David's 2026-08-31
 * run qualified for the passive path on `data.type === 'easy'`, which the
 * resolver's own comment calls the run's "OWN self-reported type … not the
 * borrowed workoutType stamp". It is not. That row's `runs.provenance` column
 * reads `{"type": "strava_webhook", …}` — the value was absorbed off the
 * merged Strava sibling (19981296070) by
 * `lib/runs/canonical.ts:absorbFieldsIntoCanonical`, which copies every key
 * not in `NEVER_COPY`. `source` IS in that set; `type` is not. And Strava's
 * side of it is `stravaTypeToFaff`, which returns the literal string 'easy'
 * for `workout_type === 0` — Strava's DEFAULT, i.e. the runner labelled
 * nothing at all.
 *
 * So the confirming evidence is (a) Strava's, on a path whose own tests
 * assert "a Strava-sourced sync never qualifies here, own type or not", and
 * (b) an absence rendered as an assertion, which is the Rule 11 collapse.
 * The anchor is already recorded in `runs.provenance` and the resolver does
 * not select the column, so it cannot tell the two apart (Rule 10).
 *
 * Full write-up: docs/reports/core-closure-2026-09-04/EXECUTION-IDENTITY-AUDIT.md
 * ══════════════════════════════════════════════════════════════════════════ */
describe('EXECIDENT-1 · the passive path cannot see where `data.type` came from', () => {
  beforeEach(() => vi.clearAllMocks());

  it.fails(
    'OPEN DEFECT · the run query does not select runs.provenance, so an absorbed Strava `type` is indistinguishable from the row\'s own self-report',
    async () => {
      wire([EASY], [{ id: '-41598809443969', data: qualifying({ distanceMi: 6.18 }) }]);
      await resolveDayExecutions(USER, DAY);
      const runQuery = seen.find((q) => q.sql.includes('FROM runs'))!;
      // Falsification (Rule 18): add `r.provenance` to the SELECT list in
      // `resolveDateRangeExecutions` and this assertion passes immediately,
      // at which point `it.fails` itself goes red and must be promoted to a
      // plain `it` asserting the gate that now reads it.
      expect(runQuery.sql).toContain('provenance');
    },
  );

  it('the shape the defect makes possible, stated so it is not mistaken for correct behaviour', async () => {
    // Identical inputs to the OVERRUN row above — because they ARE identical
    // as far as the resolver can see. The only difference between "David's
    // own easy run" and "an unrelated easy run that merged with a Strava
    // sibling carrying workout_type 0" lives in a column this query never
    // reads. This test asserts TODAY'S behaviour so the audit report has a
    // falsifiable anchor; it is not an endorsement, and it should be
    // rewritten the moment EXECIDENT-1 is closed.
    wire([EASY], [{ id: 'r_absorbed_type', data: qualifying({ distanceMi: 6.18 }) }]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(day.prescriptions[0].matchedRun?.match).toBe('legacy_type');
  });
});
