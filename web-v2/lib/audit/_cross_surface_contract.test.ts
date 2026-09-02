/**
 * lib/audit/_cross_surface_contract.test.ts · STAGE 5 · the cross-surface
 * number contract, resolved on LIVE PRODUCTION DATA.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS FOR
 *
 * Rule 16 says one quantity has one name and one number. The ownership gates
 * this repo already carries — `_race_target_ownership`, `_hr_intensity_
 * ownership`, `_race_projection`, `_pace_zone_provenance` — all check the same
 * thing from the same angle: they scan SOURCE and assert that only the
 * canonical owner computes a quantity. That is necessary and it is not
 * sufficient, and each of them says so in its own Rule 22 section. Quoting
 * `_race_target_ownership.test.ts` verbatim:
 *
 *     · It cannot tell whether `race-outlook`'s answer is CORRECT.
 *     · It cannot see the wrist.
 *     · It cannot prove the refresh RAN. … they do not prove any production
 *       row has been rewritten yet.
 *
 * Every one of those holes is the same hole: **an owner can be consolidated in
 * code while the runner's plan still carries the number the old owner wrote.**
 * A source scan cannot see a stale row. It reports clean, correctly, about
 * source, and the phone and the wrist keep showing two numbers.
 *
 * So this file does not read source. It takes each quantity the runner can see
 * on more than one surface, resolves it through EVERY live path — the canonical
 * resolver, the persisted plan row, the plan's own authored stamp, the iPhone
 * Today wire payload (by calling the route), the iPhone races payload, the
 * watch payload (by calling `buildWatchToday`), the race row's execution blob,
 * the projection snapshot tables, and the targets route — and asserts they are
 * the same number.
 *
 * Both sides of every comparison are REAL PRODUCTION READS. There is not one
 * fixture in this file. That is deliberate: Rule 13 point 2 — "never a sample
 * fixture for a display fix. Fixtures skip the exact code paths that break."
 *
 * ══════════════════════════════════════════════════════════════════════════
 * READ-ONLY, ENFORCED BY THE ROLE
 *
 * Opens `DATABASE_URL_RO` (`faff_readonly`) and asserts `current_user` before
 * it does anything else. It writes nothing and it cannot: the role has no write
 * grant. Skipped entirely when that variable is absent — which is why the
 * registry-hygiene block below runs unconditionally, so this file is never a
 * silent no-op (Rule 18 point 2).
 *
 * Run:
 *   DATABASE_URL_RO=… npx vitest run lib/audit/_cross_surface_contract.test.ts \
 *     --disable-console-intercept
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KNOWN DISAGREEMENTS ARE A RATCHET IN BOTH DIRECTIONS
 *
 * Four live disagreements existed when this file was written and none of them
 * is fixable inside a test file. They are registered in `KNOWN_DISAGREEMENTS`
 * below, each with the two paths, the shape of the divergence, an argued
 * reason, the module that owns the fix, and what closing it looks like.
 *
 * Each registered entry gets its OWN test, and that test fails in BOTH
 * directions (Rule 18 point 1):
 *
 *   · the two paths AGREE      → FAIL, "stale exemption, delete this entry"
 *   · they disagree in a shape
 *     other than the recorded
 *     one                      → FAIL, "the disagreement moved"
 *   · they disagree exactly as
 *     recorded                 → pass, loudly, with the numbers printed
 *
 * The recorded shape is a PREDICATE over the two values, never a hardcoded
 * pair. Pinning "155 vs 164" would go red the morning the runner's LTHR moves,
 * which is normal and correct behaviour, and a gate that cries wolf on normal
 * behaviour is a gate people switch off. Pinning "the persisted target equals
 * the MARATHON row of the same doctrine table while the canonical answer is the
 * THRESHOLD row" survives re-anchoring and still fails the moment either side
 * changes character. The numbers observed on 2026-09-02 are carried as
 * `observed` and printed on failure — evidence, not an assertion.
 *
 * An entry may be DELETED, never added without an argued reason and an owner.
 * `contract()` calls name the entry id they exclude a path under, and a call
 * naming an id the registry does not hold fails — so deleting an entry without
 * re-including its path breaks the build rather than quietly shrinking scope.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * RULE 22 · WHAT THIS SUITE CANNOT FAIL ON — be unflattering
 *
 *  1. **It cannot fail on a wrong number that every surface agrees about.**
 *     This is a COHERENCE check, not a correctness check. If the threshold
 *     resolver returns 700 s/mi tomorrow, every path here returns 700 and this
 *     file is green. Nothing in it reads doctrine. `lib/doctrine/registry.ts`
 *     is where correctness lives; this file is deliberately orthogonal to it.
 *
 *  2. **It cannot see Swift.** `native-v2` renders the payloads asserted here.
 *     A phone build that ignores `paceShape`, rounds differently, or draws a
 *     ceiling as a band passes every assertion in this file. Rule 13 is only
 *     half-satisfied by an API-level check and this is the half it is not.
 *     The watch grader has its own port gate (`_watch_grader_parity.test.ts`);
 *     nothing gates what the iPhone DRAWS from these numbers.
 *
 *  3. **It is ONE runner.** Every reading is `REFERENCE_USER`, the only account
 *     with a real marathon block. A defect that needs a second runner — no
 *     LTHR, no goal race, a coached-mode plan, a plan mid-rebuild — is
 *     unreachable here, and that is the Rule 15 hole this file has. It is not
 *     the hole `_sweep_allusers` has (11,598 archetypes that cannot express a
 *     history); it is the opposite one: one runner with a complete history and
 *     no breadth at all. The two files fail on disjoint things and neither
 *     substitutes for the other.
 *
 *  4. **It is ONE day.** Quantities are resolved for `runnerToday`. A
 *     disagreement that only appears in a taper week, on a race week, on a
 *     rest day, or on a day whose spec is absent is not reached. The row
 *     sweeps below walk every FUTURE row of the active plan, which covers the
 *     taper and the race weeks for the persisted half — but the phone and
 *     watch payload comparisons are sampled on a handful of named dates,
 *     because each is a full route invocation and sweeping ninety-six of them
 *     costs minutes.
 *
 *  5. **It cannot fail on a quantity nobody thought to add.** There is no
 *     mechanism here that discovers new cross-surface numbers. `cadence`,
 *     `fuel_mi`, `readinessScore`, elevation-adjusted pace, the HR-drift band
 *     (which has no server owner at all — see the scorecard's Row 18) are all
 *     shown on more than one surface and none is checked. The list is hand-
 *     written and therefore inherits whatever its author failed to imagine,
 *     which is Rule 22's own point turned on this file.
 *
 *  6. **It cannot prove a job RAN.** Same hole `_race_target_ownership`
 *     declares. It compares what is on the row against what the resolver says
 *     today. It says nothing about whether `plan-drift` or `run-adaptations`
 *     will run tonight, or in what order (Rule 23).
 *
 *  7. **`describe.skipIf(!RO)` means the whole live half vanishes with one
 *     unset variable.** The always-on registry block below is what stops that
 *     from being silent, and it is a much weaker check than the one it guards.
 */
import { describe, it, expect, vi } from 'vitest';

/** The only account with a real marathon block. See Rule 22 note 3. */
const REFERENCE_USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const RO = process.env.DATABASE_URL_RO;

// The Today / races / targets routes are the actual iPhone surfaces and the
// only honest way to read what the phone is sent. They gate on a session; the
// session layer is not what is under test, so it is the one thing stubbed.
// Every number that comes back is still resolved by the real route against
// real production rows.
vi.mock('@/lib/auth/session', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, requireUserId: async () => REFERENCE_USER };
});

// ── the registry ──────────────────────────────────────────────────────────

interface KnownDisagreement {
  id: string;
  /** The quantity that has two answers. */
  quantity: string;
  /** The canonical path, and the one that disagrees with it. */
  canonicalPath: string;
  divergentPath: string;
  /**
   * The SHAPE of the divergence, as a predicate over the two live values plus
   * whatever context the caller passes. Returns true only for the recorded
   * defect. Anything else — including agreement — fails the entry's test.
   *
   * A predicate rather than a hardcoded pair on purpose: see the header.
   */
  shape: (a: number, b: number, ctx: Record<string, number>) => boolean;
  /** What the two sides read on 2026-09-02. Evidence, printed on failure. */
  observed: string;
  /** Why this is not fixed here. */
  reason: string;
  /** The module that has to change. */
  owner: string;
  /** What closing it looks like. */
  closesWhen: string;
  /**
   * How many rows/surfaces may diverge under this entry. RATCHET — it may
   * shrink, never grow. Without it `shape` alone would wave through a brand
   * new row diverging the same way, which is how an exemption stops meaning
   * anything (Rule 18 point 4). Absent for a single-site entry.
   */
  maxOccurrences?: number;
}

const KNOWN_DISAGREEMENTS: readonly KnownDisagreement[] = [
  {
    id: 'HR-TARGET-ROW-IS-STALE',
    quantity: 'prescribed HR target on a threshold-priced quality row',
    canonicalPath: "zones.prescribedHrTargetBpm({intensity:'threshold', lthr})",
    divergentPath: "plan_workouts.workout_spec.hr_target_bpm (persisted 2026-08-31)",
    // The persisted number is the MARATHON row of the same Friel table, which
    // is what `spec-builder`'s deleted `round(lthr * 0.92)` produced. The fix
    // landed in code on 2026-09-02 (commit 9c5d9ce0); the runner's block was
    // authored 2026-08-31 and no writer rewrites `hr_target_bpm` on an
    // existing row.
    shape: (canonical, persisted, ctx) =>
      persisted !== canonical && persisted === ctx.marathonIntensityTarget,
    observed: 'canonical 164 bpm (Friel Z4 centre, 0.975 × LTHR 168) · persisted 155 bpm (Friel Z3 centre, 0.925 × 168), on rows 2026-09-08 and 2026-09-22, each beside a 430 s/mi threshold pace and a 164 bpm pass rule',
    reason:
      'A row-level data repair, not a code change. B7 (9c5d9ce0) gave the quantity one owner and every future authoring gets it right; nothing rewrites an already-authored spec. The wrist reads the row directly, so the watch ships the 155 too.',
    owner: 'lib/plan/recompute-paces.ts (or a one-off backfill) — the only path that rewrites unsealed future rows',
    closesWhen: 'every future quality row carries prescribedHrTargetBpm of the intensity its pace was prescribed at',
    // 4 future rows carried the stale target on 2026-09-02. Shrinks as dates
    // pass and as any re-author rewrites them; a fifth is a new defect.
    maxOccurrences: 4,
  },
  {
    id: 'RACE-ABORT-ANCHORED-TO-A-REPLACED-SEED',
    quantity: "a race row's pace-adrift abort, against that row's own target",
    canonicalPath: 'distance-doctrine.racePaceAbortRule({distanceMi, targetPaceSecPerMi: row.pace_target_s_per_mi})',
    divergentPath: 'plan_workouts.workout_spec.rules[kind=abort, metric=pace].value (persisted)',
    // Stored abort was struck off the authoring seed (436 s/mi) and the row's
    // pace has since moved. The defect is simply "≠", in either direction —
    // loose on three rows, TIGHT on the marathon.
    shape: (canonical, stored) => stored !== canonical,
    observed:
      'CIM 2026-12-06 target 443 · stored abort 458 · canonical 465 (7 s/mi TIGHT, fires the B-goal switch early) — Santa Monica 2026-09-13 target 416 · stored 466 · canonical 437 (29 s/mi loose, ~12% off, cannot fire) — Malibu 2026-11-08 target 422 · stored 446 · canonical 443. Dodgers 2026-09-26 agrees at 457.',
    reason:
      'Same shape as the entry above: B2 (9c5d9ce0) made both writers call one derivation, and `refreshRaceRowsForPlan` rewrites the rule going forward. The rows on the runner\'s live block were authored before that and still carry the old value. The commit message measured the same four rows and did not repair them.',
    owner: 'lib/race/race-row-refresh.ts#refreshRaceRowsForPlan — it already reprices the rule; it has not been run over this plan since B2 landed',
    closesWhen: 'every race row on an active plan satisfies stored abort === racePaceAbortRule(row target)',
    // 3 of the 4 future race rows. Dodgers already agrees.
    maxOccurrences: 3,
  },
  {
    id: 'AUTHORED-SEED-IS-STILL-AN-UNSTAMPED-SECOND-RECORD',
    quantity: 'the prescribed race target for the goal race',
    canonicalPath: 'race-outlook.execution.paceSecPerMi / .targetSec (and the CIM plan row written from it)',
    divergentPath: 'training_plans.authored_state.prescribed_race_pace.{pace_s_per_mi,target_sec}',
    shape: (canonical, seed) => seed !== canonical,
    observed:
      'row 443 s/mi / 11610 s (3:13:30) · authored_state 436 s/mi / 11430 s (3:10:30) — 7 s/mi and 180 s apart, with the blob\'s own ceiling_vdot 47.1 stale against a live threshold VDOT of 47.8, and NO `authority: "provenance_only"` key, because the stamp B2 added is written at authoring and this plan predates it',
    reason:
      'B2 made `authored_state.prescribed_race_pace` provenance-only and `_race_target_ownership.test.ts` proves in SOURCE that no live module reads its `pace_s_per_mi` back as a value. That gate is real. What it cannot see is that the production blob is still a second, un-stamped, materially different record of the same quantity sitting on the runner\'s active plan.',
    owner: 'lib/plan/generate.ts — the stamp lands on the next authoring; nothing rewrites the existing blob',
    closesWhen: "authored_state.prescribed_race_pace carries authority:'provenance_only' and its pace_s_per_mi equals the race row's",
  },
  {
    id: 'WATCH-CEILING-IS-THE-BAND-MIDPOINT',
    quantity: "the pace ceiling for an easy or long session — what 'do not go faster than' means",
    canonicalPath: "iPhone Today wire · the work step's 'no faster than X /mi' (= workout_spec.pace_target_s_per_mi_lo, the canonical easy ceiling)",
    divergentPath: "watch payload · phases[work].targetPaceSPerMi with paceShape 'ceiling' (= midpoint of the authored band)",
    // The wrist's number is the midpoint of the same authored band whose FAST
    // EDGE the phone prints as the ceiling. `paceShapeFor` labels it 'ceiling'
    // and `phaseToleranceSec`'s own doc says "the GRADER ignores" the
    // tolerance — so the wrist grades against the midpoint.
    shape: (phoneCeiling, watchTarget, ctx) =>
      watchTarget !== phoneCeiling && watchTarget === Math.round((ctx.bandLo + ctx.bandHi) / 2),
    observed:
      "2026-09-02 easy: phone 'no faster than 8:22 /mi' (502) · watch ceiling 522 (8:42) — 20 s/mi. 2026-09-06 long: phone 502 · watch 520 — 18 s/mi. Same session, same word, two numbers: a 8:30/mi easy run is compliant on the phone and too fast on the wrist. Warm-up and cool-down agree at 502 — WU/CD-CEIL-1 fixed those two phase types on 2026-09-01 and left the work phase on the midpoint.",
    reason:
      "Not repairable from a test file: `expandLong`/`expandEasy` in lib/training/expand-spec.ts set the work phase's target to the band midpoint while `paceShapeFor` declares that phase a ceiling. Both surfaces call the same expander; the phone's card layer prints `lo` and the watch ships the phase target. It is one line, and it is a behaviour change to what the wrist grades, which is outside this stage's boundary.",
    owner: 'lib/training/expand-spec.ts#expandEasy / #expandLong (the `mid` used as targetPaceSPerMi on a ceiling-shaped phase)',
    closesWhen: "a ceiling-shaped work phase carries the ceiling, not the band centre — watch target === phone ceiling === pace_target_s_per_mi_lo",
    // Every aerobic day diverges; the test samples the next three, so three is
    // both the observed count and the sample size.
    maxOccurrences: 3,
  },
  {
    id: 'TARGETS-ROUTE-SHOWS-A-SECOND-PROJECTION',
    quantity: 'the projected finish for the goal race',
    canonicalPath: 'race-outlook → raceProjectionFromOutlook (what iPhone v5/races and v5/race render)',
    divergentPath: 'GET /api/targets/projection · projectionSec',
    shape: (canonical, targets) => targets !== canonical,
    observed:
      "canonical 11982 (3:19:42, trajectory basis) · targets route 11902 (3:18:22, raw Daniels equivalence off projection_snapshots.vdot). The same response also carries summaryLine 'Projection 3:15:06' and raceProjections[Marathon] '3:29:17' — four numbers for one race in one payload, three of them labelled 'projection'. goal_projection_snapshots agrees with the canonical 11982; projection_snapshots(race_slug='cim') holds the 11902.",
    reason:
      "Known and demoted rather than closed: the scorecard's §(d) records this route's only Swift callers as v4 views behind `-faffLegacy`, so nothing on the shipping phone renders it. It is still a deployed authenticated route emitting a second 'Projected' for the same race, and the nightly cron still persists the 11902 that `goal-gap.ts#classifyTrend` reads and that can trigger a rebuild.",
    owner: 'app/api/targets/projection/route.ts — the cleanest deletion in the audit (scorecard §26); until then, `_race_projection.test.ts`\'s hardcoded six-file scope cannot see it',
    closesWhen: 'the route is deleted, or it resolves through race-outlook like every other consumer',
  },
];

const KNOWN_IDS = new Set(KNOWN_DISAGREEMENTS.map((k) => k.id));

// ── the contract machinery ────────────────────────────────────────────────

interface Reading {
  /** How this number was produced. Named precisely enough to grep. */
  path: string;
  value: number | null;
}

interface ContractResult {
  quantity: string;
  readings: Reading[];
  findings: string[];
}

/**
 * One quantity, every path, one number.
 *
 * `minPaths` is the liveness floor (Rule 18 point 2): a contract that resolved
 * one path and reported agreement is the false-clean this file exists to stop.
 * `excluding` names the registry entries whose divergent path is deliberately
 * not in `readings`; an id the registry does not hold is itself a finding, so
 * deleting a KNOWN entry without re-including its path fails here.
 */
function contract(
  quantity: string,
  readings: Reading[],
  minPaths: number,
  excluding: readonly string[] = [],
): ContractResult {
  const findings: string[] = [];
  for (const id of excluding) {
    if (!KNOWN_IDS.has(id)) {
      findings.push(
        `${quantity}: excludes a path under KNOWN id "${id}", which the registry no longer holds. ` +
        `The entry was deleted without putting its path back into this contract.`,
      );
    }
  }
  const live = readings.filter((r) => r.value != null);
  if (live.length < minPaths) {
    findings.push(
      `${quantity}: LIVENESS — resolved ${live.length} of ${readings.length} paths, floor is ${minPaths}. ` +
      `Nulls: ${readings.filter((r) => r.value == null).map((r) => r.path).join(', ') || '(none)'}`,
    );
  }
  const distinct = [...new Set(live.map((r) => r.value))];
  if (distinct.length > 1) {
    findings.push(
      `${quantity}: ${distinct.length} DIFFERENT NUMBERS across ${live.length} paths —\n` +
      live.map((r) => `        ${String(r.value).padStart(7)}  ${r.path}`).join('\n'),
    );
  }
  return { quantity, readings, findings };
}

/**
 * A quantity that is deliberately FROZEN on a row beside the live resolver
 * that produced it — Rule 10's third posture, "freeze with provenance".
 *
 * `workout_spec.race_execution` stamps `resolved_at` beside every number in
 * it, and the outlook it came from is time-varying (days-to-race and build
 * weeks both move the trajectory). So a stamp written at 05:28 and a
 * resolution taken at 07:53 the same day differ by a second or two, and that
 * is the mechanism working, not a second owner.
 *
 * What it must NOT do is drift far. Beyond the bound the stamp was struck
 * against a different anchor — a different VDOT, a different durability
 * exponent, a different goal — and at that point it IS a second answer sitting
 * on the row the phone and the wrist read. The bound is what turns "these
 * differ by 1" from a shrug into a monitored fact.
 */
function stampContract(
  quantity: string, live: number | null, stamped: number | null,
  maxDriftSec: number, why: string,
): ContractResult {
  const findings: string[] = [];
  const readings: Reading[] = [
    { path: `${quantity} · live resolver`, value: live },
    { path: `${quantity} · stamped on the row`, value: stamped },
  ];
  if (live == null || stamped == null) {
    findings.push(`${quantity}: LIVENESS — live=${live} stamped=${stamped}; a stamp comparison needs both sides.`);
  } else if (Math.abs(live - stamped) > maxDriftSec) {
    findings.push(
      `${quantity}: STAMP DRIFT ${Math.abs(live - stamped)}s exceeds the ${maxDriftSec}s bound ` +
      `(live ${live}, stamped ${stamped}). ${why}`,
    );
  }
  return { quantity, readings, findings };
}

/**
 * Two paths that must produce one number, where a registered entry may excuse
 * exactly one divergence. Used where the pair is per-row and the exclusion has
 * to be decided per row rather than per contract.
 */
function pairContract(
  quantity: string, canonical: Reading, other: Reading, knownId: string,
): ContractResult {
  const findings: string[] = [];
  if (!KNOWN_IDS.has(knownId)) {
    findings.push(`${quantity}: names KNOWN id "${knownId}", which the registry no longer holds.`);
  }
  if (canonical.value == null || other.value == null) {
    findings.push(
      `${quantity}: LIVENESS — ${canonical.value == null ? canonical.path : other.path} resolved null. ` +
      `A pair with one side missing checks nothing.`,
    );
  }
  // Divergence is excused ONLY by the registry entry, whose own test asserts
  // the shape of it. Agreement is the normal, expected outcome here.
  return { quantity, readings: [canonical, other], findings };
}

const fmtPace = (s: number | null | undefined): string =>
  s == null || !Number.isFinite(s) ? 'null'
    : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}/mi (${Math.round(s)}s)`;

/** "7:02-7:18 /mi" → 430 (the centre). "no faster than 8:22 /mi" → 502. */
function paceFromWire(text: string | null | undefined): number | null {
  if (!text) return null;
  const all = [...text.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
  if (all.length === 0) return null;
  if (all.length === 1) return all[0];
  return Math.round((all[0] + all[1]) / 2);
}
/** The FAST edge of whatever the wire printed — a ceiling, or a band's lo. */
function fastEdgeFromWire(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/* eslint-disable no-console */

// ── always-on · the file is never a silent no-op ──────────────────────────

describe('cross-surface contract · registry hygiene (no database)', () => {
  it('every registered disagreement is fully argued', () => {
    expect(KNOWN_DISAGREEMENTS.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const k of KNOWN_DISAGREEMENTS) {
      expect(ids.has(k.id), `duplicate id ${k.id}`).toBe(false);
      ids.add(k.id);
      // Rule 18 point 4 — "we might need it" is not a reason.
      for (const [field, min] of [['reason', 80], ['observed', 40], ['owner', 20], ['closesWhen', 20]] as const) {
        expect(
          (k as unknown as Record<string, string>)[field].length,
          `${k.id}.${field} is too thin to be an argued reason`,
        ).toBeGreaterThan(min);
      }
      expect(k.canonicalPath).not.toBe(k.divergentPath);
    }
  });

  it('says out loud when the live half did not run', () => {
    if (!RO) {
      console.warn(
        '\n[cross-surface] DATABASE_URL_RO is NOT SET. The live half of this suite ' +
        'did not run and NOTHING about cross-surface agreement was checked. ' +
        'This block passing is not evidence.\n',
      );
    }
    expect(true).toBe(true);
  });
});

// ── live · every number, every path ───────────────────────────────────────

describe.skipIf(!RO)('cross-surface contract · LIVE production (read-only)', () => {
  it('the same quantity is the same number on every surface', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    const who = (await pool.query('SELECT current_user')).rows[0].current_user;
    expect(who, 'refusing to run as anything but the read-only role').toBe('faff_readonly');

    const { runnerToday } = await import('@/lib/runtime/runner-tz');
    const { loadActivePlanStrict } = await import('@/lib/plan/lookup');
    const { resolvePrescribedPaceAnchors } = await import('@/lib/training/load-prescription-anchors');
    const { resolveThresholdCapacity } = await import('@/lib/training/capacity-resolver');
    const { resolveRaceOutlookBySlug } = await import('@/lib/race/race-outlook');
    const { raceProjectionFromOutlook } = await import('@/lib/training/race-projection');
    const { buildWatchToday } = await import('@/lib/watch/build-workout');
    const { resolveThresholdHr } = await import('@/lib/training/lthr');
    const { aerobicCeilingBpm, thresholdPassHrBpm, prescribedHrTargetBpm } = await import('@/lib/training/zones');
    const { racePaceAbortRule } = await import('@/lib/race/distance-doctrine');
    const { NextRequest } = await import('next/server');
    const todayRoute = await import('@/app/api/v5/today/route');

    const today = await runnerToday(REFERENCE_USER);
    const plan = await loadActivePlanStrict(REFERENCE_USER);
    expect(plan, 'the reference runner has no active plan — nothing below can be checked').not.toBeNull();
    const planId = plan!.id;
    const goalSlug = plan!.race_id;
    expect(goalSlug, 'the active plan names no goal race').toBeTruthy();

    const anchorRead = await resolvePrescribedPaceAnchors(REFERENCE_USER, today);
    expect(anchorRead.ok, `pace anchors refused: ${JSON.stringify(anchorRead)}`).toBe(true);
    const A = (anchorRead as Extract<typeof anchorRead, { ok: true }>).anchors;

    console.log(`\n[cross-surface] role=${who} user=${REFERENCE_USER} plan=${planId} today=${today}`);
    console.log(`[cross-surface] canonical anchors · T ${fmtPace(A.thresholdSecPerMi)} · M ${fmtPace(A.marathonSecPerMi)} · Eceil ${fmtPace(A.easyCeilingSecPerMi)}`);

    // Every FUTURE row of the ACTIVE plan (Rule 14: scoped by plan_id, which
    // loadActivePlanStrict resolved — not by user_uuid, which reads 47 archived
    // versions).
    interface Row {
      d: string; type: string; pace: number | null; quality: boolean;
      distanceMi: number | null; spec: Record<string, any> | null;
    }
    const rows: Row[] = (await pool.query(
      `SELECT date_iso::text AS d, type, is_quality AS quality,
              pace_target_s_per_mi AS pace, distance_mi AS "distanceMi", workout_spec AS spec
         FROM plan_workouts WHERE plan_id = $1 AND date_iso >= $2
         ORDER BY date_iso ASC`,
      [planId, today],
    )).rows.map((r: any) => ({ ...r, pace: r.pace == null ? null : Number(r.pace) }));
    expect(rows.length, 'no future rows on the active plan — every sweep below would report clean on nothing')
      .toBeGreaterThan(20);

    const planRow = (await pool.query(
      `SELECT authored_state FROM training_plans WHERE id = $1`, [planId],
    )).rows[0];
    const authored = (planRow?.authored_state ?? {}) as Record<string, any>;
    const stamp = authored.pace_recompute?.anchors as Record<string, any> | undefined;
    expect(stamp, 'the active plan carries no authored_state.pace_recompute.anchors stamp').toBeTruthy();

    const results: ContractResult[] = [];

    // ── Q1 · THRESHOLD PACE ────────────────────────────────────────────────
    const thresholdCap = await resolveThresholdCapacity(REFERENCE_USER, today);
    // The persisted half: every threshold/tempo-priced future row that is NOT
    // an @MP block (an `@ MP` tempo is priced at marathon pace on purpose —
    // a different quantity, correctly named, and `marathon_range_s_per_mi` is
    // what says so).
    const thresholdRows = rows.filter(
      (r) => r.spec?.tempo_pace_s_per_mi != null && r.spec?.marathon_range_s_per_mi == null,
    );
    // The watch payload for the next such day.
    const nextThresholdDay = thresholdRows[0]?.d ?? null;
    let watchThreshold: number | null = null;
    let watchThresholdHr: number | null = null;
    let watchThresholdPassHr: number | null = null;
    if (nextThresholdDay) {
      const w: any = await buildWatchToday(REFERENCE_USER, nextThresholdDay);
      const work = (w.workout?.phases ?? []).find((p: any) => p.type === 'work' && p.paceShape === 'window');
      watchThreshold = work?.targetPaceSPerMi ?? null;
      watchThresholdHr = work?.hrTargetBpm ?? null;
      watchThresholdPassHr =
        (w.workout?.rules ?? []).find((x: any) => x.kind === 'pass' && x.metric === 'hr')?.value ?? null;
    }
    // The phone payload for the same day.
    let phoneThreshold: number | null = null;
    if (nextThresholdDay) {
      const res = await todayRoute.GET(
        new NextRequest(`https://faff.run/api/v5/today?date=${nextThresholdDay}`) as never,
      );
      const body: any = await (res as Response).json();
      const workGroup = (body.groups ?? []).find((g: any) => g.isWork);
      phoneThreshold = paceFromWire(workGroup?.steps?.[0]?.sub?.text);
    }
    const raceRows = rows.filter((r) => r.type === 'race');
    results.push(contract('threshold pace (s/mi)', [
      { path: 'capacity-resolver.resolveThresholdCapacity().paceSecPerMi', value: thresholdCap.paceSecPerMi ?? null },
      { path: 'load-prescription-anchors → composePaceAnchors.thresholdSecPerMi', value: A.thresholdSecPerMi },
      { path: 'training_plans.authored_state.pace_recompute.anchors.threshold_s_per_mi', value: Number(stamp!.threshold_s_per_mi) },
      ...thresholdRows.map((r) => ({ path: `plan_workouts ${r.d} .pace_target_s_per_mi`, value: r.pace })),
      ...thresholdRows.map((r) => ({ path: `plan_workouts ${r.d} .workout_spec.tempo_pace_s_per_mi`, value: Number(r.spec!.tempo_pace_s_per_mi) })),
      ...raceRows.map((r) => ({ path: `plan_workouts ${r.d} .workout_spec.race_execution.threshold_s_per_mi`, value: r.spec?.race_execution?.threshold_s_per_mi ?? null })),
      { path: `watch buildWatchToday(${nextThresholdDay}) work phase targetPaceSPerMi`, value: watchThreshold },
      { path: `iPhone GET /api/v5/today?date=${nextThresholdDay} · work step centre`, value: phoneThreshold },
    ], 8));

    // ── Q2 · MARATHON PACE ─────────────────────────────────────────────────
    // The durability anchor's answer, the composed anchor, every persisted MP
    // block, and the goal race's own training prescription.
    const goalOutlook = await resolveRaceOutlookBySlug(REFERENCE_USER, goalSlug!, today);
    expect(goalOutlook, `no outlook for the goal race ${goalSlug}`).not.toBeNull();
    const mpRows = rows.filter((r) => r.spec?.marathon_range_s_per_mi != null);
    const mpFinishRows = rows.filter((r) => r.spec?.finish_label === 'M' && r.spec?.finish_pace_s_per_mi != null);
    const goalRaceRow = raceRows.find((r) => r.spec?.race_execution != null && r.distanceMi != null && r.distanceMi > 20);
    results.push(contract('marathon pace (s/mi)', [
      { path: 'load-prescription-anchors → composePaceAnchors.marathonSecPerMi', value: A.marathonSecPerMi },
      { path: 'race-outlook.trainingPrescription.paceSecPerMi (goal race)', value: goalOutlook!.trainingPrescription.paceSecPerMi },
      ...mpRows.map((r) => ({ path: `plan_workouts ${r.d} .pace_target_s_per_mi (@MP block)`, value: r.pace })),
      ...mpRows.map((r) => ({ path: `plan_workouts ${r.d} .workout_spec.tempo_pace_s_per_mi (@MP block)`, value: Number(r.spec!.tempo_pace_s_per_mi) })),
      ...mpFinishRows.map((r) => ({ path: `plan_workouts ${r.d} .workout_spec.finish_pace_s_per_mi (M finish)`, value: Number(r.spec!.finish_pace_s_per_mi) })),
      { path: `plan_workouts ${goalRaceRow?.d} .workout_spec.race_execution.training_pace_s_per_mi`, value: goalRaceRow?.spec?.race_execution?.training_pace_s_per_mi ?? null },
    ], 6));
    // The band is a quantity too, and it is shown beside the number.
    const mpBand = A.marathonRangeSecPerMi;
    expect(mpBand, 'no marathon range on the canonical anchors').toBeTruthy();
    results.push(contract('marathon pace band · fast edge (s/mi)', [
      { path: 'anchors.marathonRangeSecPerMi[0]', value: mpBand![0] },
      { path: 'race-outlook.trainingPrescription.rangeSecPerMi[0]', value: goalOutlook!.trainingPrescription.rangeSecPerMi?.[0] ?? null },
      ...mpRows.map((r) => ({ path: `plan_workouts ${r.d} .workout_spec.marathon_range_s_per_mi[0]`, value: Number(r.spec!.marathon_range_s_per_mi[0]) })),
      ...mpFinishRows.map((r) => ({ path: `plan_workouts ${r.d} .workout_spec.finish_range_s_per_mi[0]`, value: Number(r.spec!.finish_range_s_per_mi?.[0]) })),
    ], 4));

    // ── Q3 · THE RACE PROJECTION ───────────────────────────────────────────
    const projection = raceProjectionFromOutlook(goalOutlook);
    const gps = (await pool.query(
      `SELECT projected_sec FROM goal_projection_snapshots
        WHERE user_uuid = $1::uuid AND race_slug = $2
        ORDER BY snapshot_date DESC LIMIT 1`,
      [REFERENCE_USER, goalSlug],
    )).rows[0];
    // The three LIVE paths must be one number. The race row's copy is a stamp
    // with its own `resolved_at`, so it is judged by `stampContract` instead —
    // see that function's doc for why that is not a softer assertion.
    const rowExpected = goalRaceRow?.spec?.race_execution?.expected_race_day_sec ?? null;
    results.push(contract(`projected finish · ${goalSlug} (s)`, [
      { path: 'race-outlook.expectedRaceDay.expectedSec', value: goalOutlook!.expectedRaceDay.expectedSec },
      { path: 'race-projection.raceProjectionFromOutlook().projectedSec (what v5/races and v5/race render)', value: projection.projectedSec },
      { path: 'goal_projection_snapshots.projected_sec (latest)', value: gps ? Number(gps.projected_sec) : null },
    ], 3, ['TARGETS-ROUTE-SHOWS-A-SECOND-PROJECTION']));
    results.push(stampContract(
      `projected finish · ${goalSlug} · race_execution.expected_race_day_sec`,
      projection.projectedSec, rowExpected == null ? null : Number(rowExpected), 5,
      'Beyond 5s the stamp was struck against a different anchor, and the row the phone and the wrist read is then a second answer.',
    ));
    // The current-fitness expectation is a DIFFERENT quantity and is named
    // differently everywhere. Checked as its own contract precisely so that a
    // future edit collapsing the two is caught by the file that cares.
    results.push(stampContract(
      `current-fitness expectation · ${goalSlug} · race_execution.current_projection_sec`,
      goalOutlook!.currentProjection.expectedSec,
      goalRaceRow?.spec?.race_execution?.current_projection_sec == null
        ? null : Number(goalRaceRow.spec!.race_execution.current_projection_sec), 5,
      'Same bound, same reason. This is the quantity Rule 16 found live three times under one "projected" label; it must stay distinct from the trajectory above AND agree with its own owner.',
    ));
    // …and the two must not collapse into each other. A single contract that
    // checked each against its own owner would pass an engine that had started
    // returning the same number for both.
    expect(
      projection.projectedSec === goalOutlook!.currentProjection.expectedSec,
      'the trajectory projection and the current-fitness expectation are the SAME number — ' +
      'two quantities Rule 16 separated have collapsed back into one',
    ).toBe(false);

    // ── Q4 · THE HR BAND ───────────────────────────────────────────────────
    const lthrRead = await resolveThresholdHr(REFERENCE_USER);
    expect(lthrRead, 'no LTHR on file — the whole HR half is unreachable').not.toBeNull();
    const lthr = lthrRead!.bpm;
    const aerobicRows = rows.filter((r) => r.spec?.hr_cap_bpm != null);
    // The wrist's ceiling on the next aerobic day.
    const nextAerobicDay = aerobicRows[0]?.d ?? null;
    let watchHrCeiling: number | null = null;
    let phoneHrCeiling: number | null = null;
    if (nextAerobicDay) {
      const w: any = await buildWatchToday(REFERENCE_USER, nextAerobicDay);
      watchHrCeiling = w.hrCeilingBpm ?? w.workout?.hrCeilingBpm ?? null;
      const res = await todayRoute.GET(new NextRequest(`https://faff.run/api/v5/today?date=${nextAerobicDay}`) as never);
      const body: any = await (res as Response).json();
      const stat = (body.panel?.stats ?? []).find((s: any) => /HR ceiling/i.test(s.label));
      phoneHrCeiling = stat ? Number(String(stat.value?.text).replace(/[^\d]/g, '')) : null;
    }
    results.push(contract('aerobic HR ceiling (bpm)', [
      { path: 'zones.aerobicCeilingBpm(profile.lthr)', value: aerobicCeilingBpm(lthr) },
      ...aerobicRows.map((r) => ({ path: `plan_workouts ${r.d} .workout_spec.hr_cap_bpm`, value: Number(r.spec!.hr_cap_bpm) })),
      { path: `watch buildWatchToday(${nextAerobicDay}).hrCeilingBpm`, value: watchHrCeiling },
      { path: `iPhone GET /api/v5/today?date=${nextAerobicDay} · panel "HR ceiling"`, value: phoneHrCeiling },
    ], 5));
    // The pass line a quality session is judged against.
    const passRows = rows.filter(
      (r) => Array.isArray(r.spec?.rules)
        && r.spec!.rules.some((x: any) => x.kind === 'pass' && x.metric === 'hr'),
    );
    results.push(contract('threshold HR pass line (bpm)', [
      { path: 'zones.thresholdPassHrBpm(profile.lthr)', value: thresholdPassHrBpm(lthr) },
      ...passRows.map((r) => ({
        path: `plan_workouts ${r.d} .workout_spec.rules[pass,hr].value`,
        value: Number(r.spec!.rules.find((x: any) => x.kind === 'pass' && x.metric === 'hr').value),
      })),
      { path: `watch buildWatchToday(${nextThresholdDay}) rules[pass,hr].value`, value: watchThresholdPassHr },
    ], 4));
    // The HR TARGET — the half with the live disagreement. The watch is here
    // (it reads the row, so it must equal the row); the row itself is excluded
    // under the registry entry.
    const canonicalThresholdHr = prescribedHrTargetBpm({ intensity: 'threshold', lthr })?.bpm ?? null;
    const targetRows = rows.filter((r) => r.spec?.hr_target_bpm != null);
    results.push(contract('prescribed HR target · threshold intensity (bpm) · row-vs-wrist', [
      ...targetRows.map((r) => ({ path: `plan_workouts ${r.d} .workout_spec.hr_target_bpm`, value: Number(r.spec!.hr_target_bpm) })),
      { path: `watch buildWatchToday(${nextThresholdDay}) work phase hrTargetBpm`, value: watchThresholdHr },
    ], 2, ['HR-TARGET-ROW-IS-STALE']));

    // ── Q5 · THE PRESCRIBED RACE TARGET ────────────────────────────────────
    for (const r of raceRows) {
      const slug = String(r.spec?.race_execution?.slug ?? '');
      const outlookForRow = r.d === goalRaceRow?.d ? goalOutlook : null;
      const targetPace = r.pace;
      const execPace = r.spec?.race_execution?.target_pace_s_per_mi ?? null;
      const bandLo = r.spec?.pace_target_s_per_mi_lo ?? null;
      const bandHi = r.spec?.pace_target_s_per_mi_hi ?? null;
      results.push(contract(`prescribed race pace · row ${r.d}${slug ? ` (${slug})` : ''} (s/mi)`, [
        { path: `plan_workouts ${r.d} .pace_target_s_per_mi`, value: targetPace },
        { path: `plan_workouts ${r.d} .workout_spec.race_execution.target_pace_s_per_mi`, value: execPace == null ? null : Number(execPace) },
        { path: `plan_workouts ${r.d} .workout_spec band centre`, value: bandLo != null && bandHi != null ? Math.round((Number(bandLo) + Number(bandHi)) / 2) : null },
        ...(outlookForRow ? [{ path: 'race-outlook.execution.paceSecPerMi (goal race)', value: outlookForRow.execution.paceSecPerMi }] : []),
      ], 3, ['AUTHORED-SEED-IS-STILL-AN-UNSTAMPED-SECOND-RECORD']));
      // And the abort rule that rides on the same row — the third reader B2
      // named. `pairContract` records both sides and NEVER excuses a
      // divergence on its own; the registry entry's test below is what has to
      // recognise each one, so a row diverging in a NEW way fails there.
      const storedAbort = Array.isArray(r.spec?.rules)
        ? r.spec!.rules.find((x: any) => x.kind === 'abort' && x.metric === 'pace')?.value ?? null
        : null;
      const distanceMi = r.distanceMi == null ? null : Number(r.distanceMi);
      const canonicalAbort = racePaceAbortRule({ distanceMi, targetPaceSecPerMi: targetPace })?.value ?? null;
      results.push(pairContract(
        `race pace-adrift abort · row ${r.d} (s/mi)`,
        { path: `distance-doctrine.racePaceAbortRule(${distanceMi} mi, ${targetPace} s/mi)`, value: canonicalAbort },
        { path: `plan_workouts ${r.d} .workout_spec.rules[abort,pace].value`, value: storedAbort == null ? null : Number(storedAbort) },
        'RACE-ABORT-ANCHORED-TO-A-REPLACED-SEED',
      ));
    }

    // ── Q6 · THE EASY / LONG CEILING — the number the runner is held to ────
    // Doctrine gives easy and long ONE number and it is a ceiling. Five paths
    // draw it; four agree and the wrist does not (see the registry entry).
    // RULE 14 · name the population. `workout_spec.kind` is NOT the row type:
    // a race row carries `kind: 'long'` and a shakeout carries `kind: 'easy'`,
    // and both are priced off a DIFFERENT anchor (the race target, and
    // `shakeoutCeilingSecPerMi`). Reading `kind` here pulled a 430, a 417, a
    // 438 and two 532s into an easy-ceiling contract on the first run — the
    // check catching its own author's scoping mistake, which is the only kind
    // of first-run failure worth having.
    const aerobicTypes = new Set(['easy', 'long', 'recovery']);
    const aerobicBandRows = rows.filter(
      (r) => aerobicTypes.has(r.type) && r.spec?.pace_target_s_per_mi_lo != null,
    );
    const bandRow = aerobicBandRows.find((r) => r.type === 'easy');
    let phoneStepCeiling: number | null = null;
    let phonePanelFastEdge: number | null = null;
    if (bandRow) {
      const res = await todayRoute.GET(new NextRequest(`https://faff.run/api/v5/today?date=${bandRow.d}`) as never);
      const body: any = await (res as Response).json();
      const workGroup = (body.groups ?? []).find((g: any) => g.isWork);
      phoneStepCeiling = fastEdgeFromWire(
        (workGroup?.steps ?? []).find((s: any) => /no faster than/i.test(s?.sub?.text ?? ''))?.sub?.text,
      );
      phonePanelFastEdge = fastEdgeFromWire(
        (body.panel?.stats ?? []).find((s: any) => /pace band/i.test(s.label))?.value?.text,
      );
    }
    results.push(contract('easy / long pace ceiling (s/mi)', [
      { path: 'load-prescription-anchors → composePaceAnchors.easyCeilingSecPerMi', value: A.easyCeilingSecPerMi },
      { path: 'training_plans.authored_state.pace_recompute.anchors.easy_ceiling_s_per_mi', value: Number(stamp!.easy_ceiling_s_per_mi) },
      ...aerobicBandRows.map((r) => ({ path: `plan_workouts ${r.d} (${r.type}) .workout_spec.pace_target_s_per_mi_lo`, value: Number(r.spec!.pace_target_s_per_mi_lo) })),
      { path: `iPhone GET /api/v5/today?date=${bandRow?.d} · work step "no faster than"`, value: phoneStepCeiling },
      { path: `iPhone GET /api/v5/today?date=${bandRow?.d} · panel "Pace band" fast edge`, value: phonePanelFastEdge },
    ], 6, ['WATCH-CEILING-IS-THE-BAND-MIDPOINT']));
    // The shakeout ceiling is a SEPARATE anchor with a separate name, and the
    // rows that carry it must not drift onto the easy one. Asserted here so a
    // future edit collapsing the two fails rather than passing quietly.
    const shakeoutRows = rows.filter((r) => r.type === 'shakeout' && r.spec?.pace_target_s_per_mi_lo != null);
    results.push(contract('shakeout pace ceiling (s/mi)', [
      { path: 'load-prescription-anchors → composePaceAnchors.shakeoutCeilingSecPerMi', value: A.shakeoutCeilingSecPerMi },
      { path: 'training_plans.authored_state.pace_recompute.anchors.shakeout_ceiling_s_per_mi', value: Number(stamp!.shakeout_ceiling_s_per_mi) },
      ...shakeoutRows.map((r) => ({ path: `plan_workouts ${r.d} (shakeout) .workout_spec.pace_target_s_per_mi_lo`, value: Number(r.spec!.pace_target_s_per_mi_lo) })),
    ], 3));
    expect(
      A.shakeoutCeilingSecPerMi === A.easyCeilingSecPerMi,
      'the shakeout ceiling and the easy ceiling are the same number — two anchors have collapsed into one',
    ).toBe(false);

    // ── report ─────────────────────────────────────────────────────────────
    console.log(`\n[cross-surface] ${results.length} contracts, ${results.reduce((n, r) => n + r.readings.filter((x) => x.value != null).length, 0)} live readings`);
    for (const r of results) {
      const live = r.readings.filter((x) => x.value != null);
      console.log(`  ${r.findings.length ? 'FAIL' : ' ok '}  ${String(live[0]?.value ?? '—').padStart(7)}  ${r.quantity}  (${live.length} paths)`);
    }
    const findings = results.flatMap((r) => r.findings);
    if (findings.length) console.error(`\n[cross-surface] FINDINGS\n  · ${findings.join('\n  · ')}\n`);
    expect(findings, 'cross-surface disagreement — see the paths above').toEqual([]);
  }, 600_000);
});

// ── live · each registered disagreement, ratcheted both ways ──────────────

describe.skipIf(!RO)('cross-surface contract · registered disagreements (LIVE)', () => {
  /** Fails if the two sides agree (stale entry) or diverge differently. */
  function judge(k: KnownDisagreement, canonical: number, divergent: number, ctx: Record<string, number>): void {
    const evidence =
      `\n  id          ${k.id}` +
      `\n  quantity    ${k.quantity}` +
      `\n  canonical   ${canonical}  ${k.canonicalPath}` +
      `\n  divergent   ${divergent}  ${k.divergentPath}` +
      `\n  ctx         ${JSON.stringify(ctx)}` +
      `\n  recorded    ${k.observed}` +
      `\n  owner       ${k.owner}` +
      `\n  closes when ${k.closesWhen}\n`;
    if (canonical === divergent) {
      throw new Error(
        `STALE EXEMPTION — ${k.id} now AGREES (${canonical}). ` +
        `Delete the registry entry and put the path back into its contract.${evidence}`,
      );
    }
    if (!k.shape(canonical, divergent, ctx)) {
      throw new Error(
        `THE DISAGREEMENT MOVED — ${k.id} still diverges but no longer in the recorded shape. ` +
        `A different defect is now producing this gap and it has not been argued.${evidence}`,
      );
    }
    console.warn(`[cross-surface] KNOWN ${k.id}: canonical ${canonical} vs ${divergent} — ${k.closesWhen}`);
  }
  const entry = (id: string): KnownDisagreement => {
    const k = KNOWN_DISAGREEMENTS.find((x) => x.id === id);
    if (!k) throw new Error(`registry entry ${id} is gone; this test must go with it`);
    return k;
  };
  /**
   * The ratchet. Zero occurrences means the entry is stale and must be
   * deleted; more than `maxOccurrences` means the divergence SPREAD to a site
   * nobody argued for, which `shape` alone cannot see.
   */
  function judgeCount(k: KnownDisagreement, seen: number, ofHowMany: number): void {
    if (seen === 0) {
      throw new Error(
        `STALE EXEMPTION — ${k.id}: all ${ofHowMany} candidate sites now AGREE. ` +
        `Delete the registry entry and drop the exclusion from its contract. (${k.closesWhen})`,
      );
    }
    const cap = k.maxOccurrences;
    if (cap != null && seen > cap) {
      throw new Error(
        `THE DISAGREEMENT SPREAD — ${k.id}: ${seen} sites diverge, the ratchet allows ${cap}. ` +
        `Either a new site started producing the old number, or the cap was never lowered ` +
        `after the last repair. The ratchet may shrink, never grow.\n  recorded: ${k.observed}`,
      );
    }
    console.warn(`[cross-surface] KNOWN ${k.id}: ${seen}/${ofHowMany} sites diverge (cap ${cap ?? 'n/a'})`);
  }

  it('HR-TARGET-ROW-IS-STALE · the persisted target is the marathon row of the threshold table', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    expect((await pool.query('SELECT current_user')).rows[0].current_user).toBe('faff_readonly');
    const { runnerToday } = await import('@/lib/runtime/runner-tz');
    const { loadActivePlanStrict } = await import('@/lib/plan/lookup');
    const { resolveThresholdHr } = await import('@/lib/training/lthr');
    const { prescribedHrTargetBpm } = await import('@/lib/training/zones');
    const today = await runnerToday(REFERENCE_USER);
    const plan = (await loadActivePlanStrict(REFERENCE_USER))!;
    const lthr = (await resolveThresholdHr(REFERENCE_USER))!.bpm;
    const rows = (await pool.query(
      `SELECT date_iso::text AS d, workout_spec AS spec FROM plan_workouts
        WHERE plan_id = $1 AND date_iso >= $2
          AND workout_spec ? 'hr_target_bpm'
          AND workout_spec->>'hr_target_bpm' IS NOT NULL
        ORDER BY date_iso`, [plan.id, today],
    )).rows;
    expect(rows.length, 'no future row carries an hr_target_bpm — this entry is unreachable, not clean')
      .toBeGreaterThan(0);
    const canonical = prescribedHrTargetBpm({ intensity: 'threshold', lthr })!.bpm;
    const marathonIntensityTarget = prescribedHrTargetBpm({ intensity: 'marathon', lthr })!.bpm;
    const k = entry('HR-TARGET-ROW-IS-STALE');
    let seen = 0; let candidates = 0;
    for (const r of rows) {
      // Only rows whose PACE was prescribed at threshold. An `@ MP` block is
      // priced at marathon pace and correctly carries no HR target at all.
      if (r.spec?.marathon_range_s_per_mi != null) continue;
      candidates += 1;
      if (Number(r.spec.hr_target_bpm) === canonical) continue;
      seen += 1;
      judge(k, canonical, Number(r.spec.hr_target_bpm), {
        marathonIntensityTarget, lthr, rowPaceSecPerMi: Number(r.spec.tempo_pace_s_per_mi ?? 0),
      });
    }
    judgeCount(k, seen, candidates);
  }, 300_000);

  it('RACE-ABORT-ANCHORED-TO-A-REPLACED-SEED · the stored abort is not 1.05 × the row\'s own target', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    const { runnerToday } = await import('@/lib/runtime/runner-tz');
    const { loadActivePlanStrict } = await import('@/lib/plan/lookup');
    const { racePaceAbortRule } = await import('@/lib/race/distance-doctrine');
    const today = await runnerToday(REFERENCE_USER);
    const plan = (await loadActivePlanStrict(REFERENCE_USER))!;
    const rows = (await pool.query(
      `SELECT date_iso::text AS d, distance_mi AS mi, pace_target_s_per_mi AS pace, workout_spec AS spec
         FROM plan_workouts WHERE plan_id = $1 AND date_iso >= $2 AND type = 'race'
         ORDER BY date_iso`, [plan.id, today],
    )).rows;
    expect(rows.length, 'no future race row — this entry is unreachable, not clean').toBeGreaterThan(0);
    let diverged = 0;
    for (const r of rows) {
      const stored = Array.isArray(r.spec?.rules)
        ? r.spec.rules.find((x: any) => x.kind === 'abort' && x.metric === 'pace')?.value ?? null : null;
      const canonical = racePaceAbortRule({
        distanceMi: r.mi == null ? null : Number(r.mi),
        targetPaceSecPerMi: r.pace == null ? null : Number(r.pace),
      })?.value ?? null;
      if (stored == null || canonical == null) continue;
      if (Number(stored) === canonical) continue; // rows that agree are fine
      diverged += 1;
      judge(entry('RACE-ABORT-ANCHORED-TO-A-REPLACED-SEED'), canonical, Number(stored), {
        rowTarget: Number(r.pace), distanceMi: Number(r.mi),
      });
    }
    judgeCount(entry('RACE-ABORT-ANCHORED-TO-A-REPLACED-SEED'), diverged, rows.length);
  }, 300_000);

  it('AUTHORED-SEED-IS-STILL-AN-UNSTAMPED-SECOND-RECORD · the plan holds a second race target', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    const { loadActivePlanStrict } = await import('@/lib/plan/lookup');
    const { runnerToday } = await import('@/lib/runtime/runner-tz');
    const today = await runnerToday(REFERENCE_USER);
    const plan = (await loadActivePlanStrict(REFERENCE_USER))!;
    const st = (await pool.query(`SELECT authored_state FROM training_plans WHERE id = $1`, [plan.id]))
      .rows[0]?.authored_state as Record<string, any> | null;
    const seed = st?.prescribed_race_pace as Record<string, any> | undefined;
    expect(seed, 'the plan carries no prescribed_race_pace blob — this entry is unreachable, not clean').toBeTruthy();
    const row = (await pool.query(
      `SELECT pace_target_s_per_mi AS pace FROM plan_workouts
        WHERE plan_id = $1 AND type = 'race' AND date_iso >= $2 AND distance_mi > 20
        ORDER BY date_iso LIMIT 1`, [plan.id, today],
    )).rows[0];
    expect(row, 'no future marathon race row to compare the seed against').toBeTruthy();
    // A blob stamped provenance-only is not a second record even if its number
    // is old — that is exactly what the stamp says. Unstamped, it is.
    if (seed!.authority === 'provenance_only') {
      throw new Error(
        `STALE EXEMPTION — AUTHORED-SEED-IS-STILL-AN-UNSTAMPED-SECOND-RECORD: the blob now carries ` +
        `authority:'provenance_only'. Delete the registry entry.`,
      );
    }
    judge(entry('AUTHORED-SEED-IS-STILL-AN-UNSTAMPED-SECOND-RECORD'),
      Number(row.pace), Number(seed!.pace_s_per_mi), { seedTargetSec: Number(seed!.target_sec) });
  }, 300_000);

  it('WATCH-CEILING-IS-THE-BAND-MIDPOINT · the wrist calls the band centre a ceiling', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    const { runnerToday } = await import('@/lib/runtime/runner-tz');
    const { loadActivePlanStrict } = await import('@/lib/plan/lookup');
    const { buildWatchToday } = await import('@/lib/watch/build-workout');
    const { NextRequest } = await import('next/server');
    const todayRoute = await import('@/app/api/v5/today/route');
    const today = await runnerToday(REFERENCE_USER);
    const plan = (await loadActivePlanStrict(REFERENCE_USER))!;
    const rows = (await pool.query(
      `SELECT date_iso::text AS d, workout_spec AS spec FROM plan_workouts
        WHERE plan_id = $1 AND date_iso >= $2
          AND workout_spec->>'kind' IN ('easy','long')
          AND workout_spec->>'pace_target_s_per_mi_lo' IS NOT NULL
        ORDER BY date_iso LIMIT 3`, [plan.id, today],
    )).rows;
    expect(rows.length, 'no future easy/long row with an authored band — unreachable, not clean').toBeGreaterThan(0);
    let seen = 0; let candidates = 0;
    for (const r of rows) {
      const bandLo = Number(r.spec.pace_target_s_per_mi_lo);
      const bandHi = Number(r.spec.pace_target_s_per_mi_hi);
      const w: any = await buildWatchToday(REFERENCE_USER, r.d);
      const work = (w.workout?.phases ?? []).find(
        (p: any) => p.type === 'work' && p.paceShape === 'ceiling' && p.targetPaceSPerMi != null,
      );
      if (!work) continue;
      const res = await todayRoute.GET(new NextRequest(`https://faff.run/api/v5/today?date=${r.d}`) as never);
      const body: any = await (res as Response).json();
      const workGroup = (body.groups ?? []).find((g: any) => g.isWork);
      const step = (workGroup?.steps ?? []).find((s: any) => /no faster than/i.test(s?.sub?.text ?? ''));
      const phoneCeiling = fastEdgeFromWire(step?.sub?.text);
      if (phoneCeiling == null) continue;
      candidates += 1;
      if (Number(work.targetPaceSPerMi) === phoneCeiling) continue;
      seen += 1;
      judge(entry('WATCH-CEILING-IS-THE-BAND-MIDPOINT'),
        phoneCeiling, Number(work.targetPaceSPerMi), { bandLo, bandHi });
    }
    judgeCount(entry('WATCH-CEILING-IS-THE-BAND-MIDPOINT'), seen, candidates);
  }, 600_000);

  it('TARGETS-ROUTE-SHOWS-A-SECOND-PROJECTION · /api/targets/projection does not resolve the owner', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    expect((await pool.query('SELECT current_user')).rows[0].current_user).toBe('faff_readonly');
    const { runnerToday } = await import('@/lib/runtime/runner-tz');
    const { loadActivePlanStrict } = await import('@/lib/plan/lookup');
    const { resolveRaceOutlookBySlug } = await import('@/lib/race/race-outlook');
    const { raceProjectionFromOutlook } = await import('@/lib/training/race-projection');
    const { NextRequest } = await import('next/server');
    const targets = await import('@/app/api/targets/projection/route');
    const today = await runnerToday(REFERENCE_USER);
    const plan = (await loadActivePlanStrict(REFERENCE_USER))!;
    const outlook = await resolveRaceOutlookBySlug(REFERENCE_USER, plan.race_id!, today);
    const canonical = raceProjectionFromOutlook(outlook).projectedSec;
    expect(canonical, 'the canonical projection is unavailable — this entry is unreachable, not clean').not.toBeNull();
    const res = await targets.GET(new NextRequest('https://faff.run/api/targets/projection') as never);
    const body: any = await (res as Response).json();
    expect(body.raceSlug, 'the targets route is answering about a different race').toBe(plan.race_id);
    judge(entry('TARGETS-ROUTE-SHOWS-A-SECOND-PROJECTION'), canonical!, Number(body.projectionSec), {
      routeVdot: Number(body.vdot), goalSec: Number(body.goalSec),
    });
    // The same payload's OTHER two numbers for the same race, printed as
    // evidence rather than asserted — each has a different provenance and
    // naming them is what makes "four numbers, one race" a checkable claim.
    console.warn(
      `[cross-surface] targets payload also carries summaryLine="${String(body.summaryLine).slice(0, 80)}" ` +
      `and raceProjections=${JSON.stringify(body.raceProjections)}`,
    );
  }, 300_000);
});
