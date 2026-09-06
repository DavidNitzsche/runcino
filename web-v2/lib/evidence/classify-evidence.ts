/**
 * lib/evidence/classify-evidence.ts · THE canonical evidence classifier.
 *
 * One question, asked once, for every activity: "what KIND of activity is
 * this, and under what circumstances did it happen?" — the owner's overnight
 * priority 5. It answers 19 named facets in one tagged record rather than
 * leaving each surface to re-derive its own subset, which is exactly how
 * this app has repeatedly shipped one fact under two answers (Rule 16).
 *
 * ── THIS FILE COMPOSES. IT DOES NOT RE-DERIVE ───────────────────────────────
 *
 * Every tag below is resolved by calling the ONE existing owner of that
 * question and reading its answer. Nothing here recomputes execution
 * identity, duplicate detection, HR-trace credibility, race authority, terrain
 * grade, or safety state — those all have an owner already, named in each
 * section below, and CLAUDE.md's ownership doctrine (`docs/BRAIN_CONSTITUTION.md`)
 * is explicit that a second computation of an owned question is a side door.
 * Where this file DOES compute something itself (the overrun distance check,
 * the merged/duplicate role, the moved/substituted lookup), that is because no
 * owner exists yet for that specific comparison — each such case says so.
 *
 * ── CAPACITY EVIDENCE AND FATIGUE COST ARE SEPARATE OUTPUTS ─────────────────
 *
 * "A race that's inadmissible for a normal-training capacity read is still
 * real fatigue cost" — the owner's own example, and it is the reason
 * `admissibility` below is two fields, never one. A run can be admissible for
 * fatigue cost and inadmissible for capacity evidence at the same time (a
 * race, a treadmill session, a flatlined-HR interval set), and the reverse
 * never happens in this app's doctrine (`lib/adaptation/canonical/
 * admissibility.ts`'s own header: "Never globally admit or reject an entire
 * activity when different parts remain useful" — fatigue cost is the
 * ALWAYS_GOOD_FOR list; capacity evidence is lever-specific and stricter).
 * This file's `admissibility` block is deliberately COARSE — it answers
 * "may this activity inform anything at all" (false only for a row that lost
 * a duplicate merge, so it is never independently counted). The
 * LEVER-SPECIFIC question — is this admissible for a THRESHOLD_PACE anchor
 * specifically, or for LONG_RUN_DURABILITY — remains owned by
 * `lib/adaptation/canonical/admissibility.ts`, which needs a full `Provenance`
 * this file does not attempt to reconstruct. A caller doing pace-anchor work
 * should build a `Provenance` from THIS record's tags and call that module,
 * not read `admissibility.capacityEvidence` as if it were the lever verdict.
 *
 * ── RULE 11 · THREE FACTS, NEVER COLLAPSED ──────────────────────────────────
 *
 * Every tag is a `TagReading`: `present`, `absent`, or `unknown` — never a
 * boolean. "We looked and it wasn't there" and "we couldn't look" are
 * different facts (a flatlined HR trace and an absent one are the textbook
 * case this file was told to fix: HRFLATLINE-1 in
 * `lib/adaptation/canonical/hr-trace-credibility.ts`). A caller that treats
 * `unknown` as `absent` reintroduces exactly the defect class Rule 11 exists
 * to name; `reading.kind` must be branched on before anything is said about
 * the tag.
 *
 * ── EXECUTION IDENTITY IS THE ONE RESOLVER, NOT A SECOND ONE ────────────────
 *
 * `identity.match` is read verbatim from `lib/execution/day-resolver.ts`'s
 * `classifyDay` (via `resolveDayExecutions`), the resolver
 * `EXECID-SCAN-1` requires every reader to go through. This file adds no
 * second EXACT/LEGACY/SUPPLEMENTAL test on top of it — `moved`/`substituted`
 * are read from `plan_reschedules` (the reschedule contract's own decision
 * record) ONLY once `identity.match` has already confirmed which
 * prescription, if any, this run satisfies.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * It cannot see a physical run recorded as two SEQUENTIAL, non-overlapping
 * files (a GPS drop that starts a fresh recording, an auto-pause that never
 * resumes). `splitRecording` is `unknown` on every activity, always, because
 * no detector for that shape exists anywhere in this codebase —
 * `lib/runs/identity.ts`'s `clusterRuns`/`isSameRun` only merges OVERLAPPING
 * time spans (or, for untrustworthy timestamps, a tight duration+distance
 * match), which by construction cannot see two files that do not overlap.
 * This is a real, named gap, not an oversight papered over with a guess — see
 * this file's own falsification suite and the classifier's report for what
 * would be needed to close it.
 *
 * It also cannot see a `plan_reschedules` row whose `plan_workout_id` no
 * longer matches ANY id this run's matched prescription carries (across plan
 * rebuilds — the same PLAN-VERSION-ALIAS-1 problem `day-resolver.ts` solves
 * for execution identity has not been solved for reschedule lineage). So
 * `moved`/`substituted` are scoped to THIS USER AND THIS CALENDAR DATE
 * (Rule 14: the query names the population it reads) rather than to a
 * specific `plan_workout_id` match, and are reported `unknown` rather than
 * `absent` whenever more than one candidate reschedule row lands on the same
 * date and they disagree, because guessing which one applies would be
 * exactly the "ordering decides association" failure `day-resolver.ts`'s own
 * header was written to stop.
 */
import { pool } from '@/lib/db/pool';
import {
  resolveDayExecutions,
  type ExecutionMatch,
  type ResolvedDay,
} from '@/lib/execution/day-resolver';
import {
  asRunData,
  runDaySql,
  runDistanceMi,
  runMovingSec,
  runWatchStatus,
  watchStoppedInsideWork,
  runPhases,
  isMergedAway,
  runIdentityMatchSql,
  runMergedIntoIdSql,
  type RunData,
} from '@/lib/runs/run-shape';
import { isTreadmillRow, resolveRunTerrain, type RunTerrainRow } from '@/lib/terrain/run-terrain';
import { runFacts, MAX_PAUSED_SHARE } from '@/lib/runs/run-facts';
import { workTraceIsCredible } from '@/lib/adaptation/canonical/hr-trace-credibility';
import { heatEffort } from '@/lib/training/heat-model';
import { loadSafetyInputs } from '@/lib/safety/load-safety';
import type { SafetyInputs } from '@/lib/safety/safety-verdict';
import {
  matchRaceForRun,
  normalizeDataWorkoutType,
  type RaceForMatch,
} from '@/lib/runs/log-enrich';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { authorityTier, selectionAuthority } from '@/lib/race/effort-authority';

/* ══════════════════════════════════════════════════════════════════════════
 * THE 19 TAGS, GROUPED, AND THE THREE-STATE READING EVERY ONE OF THEM CARRIES
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Rule 11 as a type rather than a convention: no `unknown`-branch value field,
 * so `reading.detail` is the only thing a caller can print without having
 * decided what `kind` means to it — matching `lib/training/normal-window.ts`'s
 * `NormalReading<T>` and `lib/evidence/activity-evidence.ts`'s `Measured<T>`,
 * the two prior places this codebase made the same call.
 */
export type TagReading =
  | { readonly kind: 'present'; readonly detail: string }
  | { readonly kind: 'absent'; readonly detail: string }
  | { readonly kind: 'unknown'; readonly detail: string };

const present = (detail: string): TagReading => ({ kind: 'present', detail });
const absent = (detail: string): TagReading => ({ kind: 'absent', detail });
const unknown = (detail: string): TagReading => ({ kind: 'unknown', detail });

export interface EvidenceClassification {
  readonly activityId: string;
  readonly dateISO: string;

  /**
   * EXECUTION IDENTITY — mutually exclusive, from `day-resolver.ts`, the ONE
   * resolver. Absent only when this row is not itself a canonical row (a
   * merged-away duplicate) — see `duplication.mergedRecording`.
   */
  readonly identity: {
    /** Verbatim from `ExecutionMatch`, or null when this row never reached
     *  the resolver (merged-away rows are excluded from canonical reads). */
    readonly match: ExecutionMatch | null;
    readonly matchedWorkoutId: string | null;
    readonly moved: TagReading;
    readonly substituted: TagReading;
  };

  readonly duplication: {
    /** A physical duplicate of this run exists somewhere (this row may be
     *  either the survivor or the loser — see `mergedRecording`). */
    readonly duplicate: TagReading;
    /** THIS row is the one that lost the merge and carries `mergedIntoId`.
     *  When present, `identity`/`completion`/etc. above are not meaningful
     *  for this row — read the canonical row named in the detail instead. */
    readonly mergedRecording: TagReading;
    /** Always `unknown` today. See the file header — no detector exists. */
    readonly splitRecording: TagReading;
  };

  readonly completion: {
    readonly partial: TagReading;
    readonly overrun: TagReading;
  };

  readonly race: {
    readonly isRace: TagReading;
    /** Only meaningful when `isRace` is `present`. A race graded below the
     *  doctrine "representative" floor (`lib/race/effort-authority.ts`) — a
     *  tune-up, a hard-workout-with-a-number, an undeclared priority. */
    readonly controlledEffort: TagReading;
  };

  readonly context: {
    readonly treadmill: TagReading;
    readonly heat: TagReading;
    readonly hills: TagReading;
    readonly pauses: TagReading;
    /** Distance, duration or moving-time is fundamentally missing from the
     *  row — there is not enough to say what happened at all. */
    readonly missingTelemetry: TagReading;
    /** HR data is PRESENT but reads as a carried-forward value rather than a
     *  measurement (`hr-trace-credibility.ts`, HRFLATLINE-1). A different
     *  fact from `missingTelemetry` — see the file header. */
    readonly flatlinedTelemetry: TagReading;
  };

  readonly runnerState: {
    readonly illness: TagReading;
    readonly painInjury: TagReading;
    readonly trainingDisruption: TagReading;
  };

  /** See file header · capacity evidence and fatigue cost are SEPARATE
   *  outputs, deliberately coarse. Lever-specific admissibility is owned by
   *  `lib/adaptation/canonical/admissibility.ts`. */
  readonly admissibility: {
    readonly capacityEvidence: { readonly admissible: boolean; readonly reason: string };
    readonly fatigueCost: { readonly admissible: boolean; readonly reason: string };
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE PURE CORE — no I/O, so every branch above is falsifiable without a
 * database (Rule 18). The async loader below is the only thing that touches
 * `pool`.
 * ═══════════════════════════════════════════════════════════════════════ */

/** One `plan_reschedules` row, the fields this classifier reads. */
export interface RescheduleRow {
  readonly identityKind: 'SAME_INSTANCE' | 'REVISED_VERSION';
  readonly stimulusPreservation: 'FULL' | 'PARTIAL' | 'SUBSTITUTED' | 'LOST';
  readonly decidedAtISO: string;
}

export interface MatchedRaceInfo {
  readonly slug: string;
  readonly priority: string | null;
}

export interface ClassifyEvidenceInput {
  readonly activityId: string;
  readonly dateISO: string;
  readonly data: RunData;
  /** `NOT (data ? 'mergedIntoId')` for THIS row — `CANONICAL_ROW_SQL`. */
  readonly isCanonicalRow: boolean;
  /** How many OTHER same-day rows point `mergedIntoId` at this one. Only
   *  meaningful when `isCanonicalRow` is true. */
  readonly loserSiblingCount: number;
  /** null on a failed read (Rule 11 — never silently "no prescription"). */
  readonly resolvedDay: ResolvedDay | null;
  /** null = the reschedule read failed or the table is not deployed.
   *  [] = read succeeded, nothing landed on this date. */
  readonly rescheduleRows: readonly RescheduleRow[] | null;
  readonly matchedRace: MatchedRaceInfo | null;
  /** Whether the race-match read itself succeeded (Rule 11: a failed read
   *  and "no race" must not collapse). */
  readonly raceReadOk: boolean;
  /** null when `loadSafetyInputs` itself could not be reached at all. In
   *  practice `loadSafetyInputs` never throws (its own doctrine), so this is
   *  a defensive branch rather than an expected one. */
  readonly safety: SafetyInputs | null;
}

/** Distance tolerance for the `overrun` label. Mirrors the ±30% band
 *  `app/api/watch/workouts/complete/route.ts` and `day-resolver.ts`'s own
 *  header already use for "does this distance still look like the
 *  prescription" — not re-derived from doctrine, a labelling convention kept
 *  consistent with the one already in the codebase. */
export const OVERRUN_DISTANCE_TOLERANCE_FRAC = 0.30;

/** A pause worth flagging on the label, distinct from `MAX_PAUSED_SHARE`
 *  (0.5 in `lib/runs/run-shape.ts`), which is the CLOCK-TRUST guard — the
 *  point past which a stored moving time is disbelieved outright. This is a
 *  much lower bar: "did a real stop happen", not "can the clock be trusted".
 *  A labelling threshold, stated so it can be argued with. */
export const PAUSE_NOTICEABLE_SHARE = 0.08;

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * `runWeatherTempFSql`/`runWeatherHumidityPctSql`/`runWeatherConditionsSql`/
 * `runWeatherCloudCoverPctSql` (`lib/runs/run-shape.ts`) exist only as SQL
 * fragments — there is no JS-side accessor to import, and this file needs one
 * to read an already-loaded row rather than re-querying. Mirrors those SQL
 * ladders verbatim (peak-then-mean-then-bare-tempF; enrichment-then-bare) so
 * a future divergence has one obvious place to fix rather than a second
 * un-cross-referenced copy of the same four fields.
 */
function weatherFromRunData(d: RunData): {
  tempF: number | null; humidityPct: number | null; conditions: string | null; cloudCoverPct: number | null;
} {
  const w = (d as Record<string, unknown>).weather;
  const weather = w && typeof w === 'object' ? (w as Record<string, unknown>) : {};
  const tempF = num(weather.temp_f_peak) ?? num(weather.temp_f) ?? num((d as Record<string, unknown>).tempF);
  const humidityPct = num(weather.humidity_pct_peak) ?? num(weather.humidity_pct);
  const conditions = typeof weather.conditions === 'string' ? weather.conditions : null;
  const cloudCoverPct = num(weather.cloud_cover_pct);
  return { tempF, humidityPct, conditions, cloudCoverPct };
}

/** Extract one work phase's raw HR samples in `workTraceIsCredible`'s shape.
 *  Mirrors `lib/adaptation/canonical-shadow/live-input.ts`'s `isHrReliable`
 *  extraction exactly, because that extraction IS the canonical answer to
 *  "how do you get bpm samples out of a raw phase" — reused, not re-typed. */
function workPhaseSamples(d: RunData): ReadonlyArray<{ label: string | null; samples: number[] }> {
  const raw = Array.isArray((d as Record<string, unknown>).phases)
    ? ((d as Record<string, unknown>).phases as unknown[])
    : [];
  return raw
    .filter((p): p is Record<string, unknown> =>
      !!p && typeof p === 'object' && (p as Record<string, unknown>).type === 'work')
    .map((p) => ({
      label: typeof p.label === 'string' ? p.label : null,
      samples: (Array.isArray(p.hrSamples) ? p.hrSamples : [])
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>).bpm : null))
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n)),
    }));
}

function classifyIdentity(input: ClassifyEvidenceInput): {
  match: ExecutionMatch | null;
  matchedWorkoutId: string | null;
} {
  if (!input.resolvedDay) return { match: null, matchedWorkoutId: null };
  for (const p of input.resolvedDay.prescriptions) {
    if (p.matchedRun?.runId === input.activityId) {
      return { match: p.matchedRun.match, matchedWorkoutId: p.id };
    }
  }
  const supplemental = input.resolvedDay.supplementalRuns.some((r) => r.runId === input.activityId);
  if (supplemental) return { match: 'supplemental', matchedWorkoutId: null };
  // The row is canonical but the resolver's own day query did not return it
  // (e.g. this activity fell outside `getCanonicalRunIds`'s window edge, or
  // the resolver read failed upstream of returning a day at all). Honest
  // refusal rather than a guessed tier.
  return { match: null, matchedWorkoutId: null };
}

function classifyMovedSubstituted(
  input: ClassifyEvidenceInput,
  matchedWorkoutId: string | null,
): { moved: TagReading; substituted: TagReading } {
  if (matchedWorkoutId == null) {
    return {
      moved: absent('No confirmed prescription for this run, so there is no reschedule question to answer.'),
      substituted: absent('No confirmed prescription for this run, so there is no reschedule question to answer.'),
    };
  }
  if (input.rescheduleRows == null) {
    return {
      moved: unknown('The reschedule ledger (plan_reschedules) could not be read.'),
      substituted: unknown('The reschedule ledger (plan_reschedules) could not be read.'),
    };
  }
  if (input.rescheduleRows.length === 0) {
    return {
      moved: absent('No reschedule decision recorded landing on this date.'),
      substituted: absent('No reschedule decision recorded landing on this date.'),
    };
  }
  // Rule 14 · scoped to this user and this date, not to a specific
  // plan_workout_id (see file header on why an id match cannot be trusted
  // across a rebuild). More than one candidate landing on the same date is a
  // genuine ambiguity, not a case to silently resolve by picking one.
  if (input.rescheduleRows.length > 1) {
    return {
      moved: unknown(`${input.rescheduleRows.length} reschedule decisions land on this date; cannot tell which applies without a plan_workout_id that survives a rebuild.`),
      substituted: unknown(`${input.rescheduleRows.length} reschedule decisions land on this date; cannot tell which applies without a plan_workout_id that survives a rebuild.`),
    };
  }
  const row = input.rescheduleRows[0];
  const moved = row.identityKind === 'SAME_INSTANCE'
    ? present('This prescription was moved here from another date, same instance, full stimulus preserved.')
    : absent('The prescription here is a revised version, not a same-instance move.');
  const substituted = row.stimulusPreservation === 'SUBSTITUTED'
    ? present('The rescheduling engine put a different stimulus in this slot rather than preserving the original.')
    : row.stimulusPreservation === 'PARTIAL' || row.stimulusPreservation === 'LOST'
      ? absent(`Stimulus preservation is ${row.stimulusPreservation.toLowerCase()}, not substituted — a reduced session, not a swapped one.`)
      : absent('Stimulus fully preserved; nothing was substituted.');
  return { moved, substituted };
}

function classifyDuplication(input: ClassifyEvidenceInput): {
  duplicate: TagReading;
  mergedRecording: TagReading;
} {
  if (!input.isCanonicalRow) {
    const mergedInto = typeof input.data.mergedIntoId === 'string' ? input.data.mergedIntoId : 'unknown';
    return {
      duplicate: present(`This activity was recorded more than once; this row lost the merge to ${mergedInto}.`),
      mergedRecording: present(`This row carries mergedIntoId and is excluded from canonical reads — read ${mergedInto} instead.`),
    };
  }
  if (input.loserSiblingCount > 0) {
    return {
      duplicate: present(`${input.loserSiblingCount} duplicate recording(s) of this run were merged into this row.`),
      mergedRecording: absent('This is the canonical, surviving row.'),
    };
  }
  return {
    duplicate: absent('No duplicate recording found for this activity.'),
    mergedRecording: absent('This is the canonical, surviving row.'),
  };
}

function classifyCompletion(
  input: ClassifyEvidenceInput,
  matchedDistanceMi: number | null,
): { partial: TagReading; overrun: TagReading } {
  const phases = runPhases(input.data);
  const watchStatus = runWatchStatus(input.data);
  const stoppedInsideWork = watchStoppedInsideWork(phases);
  let partial: TagReading;
  if (watchStatus === 'partial' || stoppedInsideWork === true) {
    partial = present('The watch recorded this session as stopping inside the prescribed work.');
  } else if (watchStatus === 'completed' || stoppedInsideWork === false) {
    partial = absent('The watch recorded this session as completed through its prescribed work.');
  } else {
    partial = unknown('No watch completion payload to judge completion against.');
  }

  const actualDistanceMi = runDistanceMi(input.data);
  let overrun: TagReading;
  if (matchedDistanceMi == null) {
    overrun = absent('No prescribed distance to compare against (unmatched or distance-less prescription).');
  } else if (actualDistanceMi == null) {
    overrun = unknown('This activity carries no recorded distance to compare.');
  } else if (matchedDistanceMi > 0 && actualDistanceMi > matchedDistanceMi * (1 + OVERRUN_DISTANCE_TOLERANCE_FRAC)) {
    overrun = present(`Ran ${actualDistanceMi.toFixed(2)} mi against a ${matchedDistanceMi.toFixed(2)} mi prescription — more than ${Math.round(OVERRUN_DISTANCE_TOLERANCE_FRAC * 100)}% over.`);
  } else {
    overrun = absent(`Ran ${actualDistanceMi.toFixed(2)} mi against a ${matchedDistanceMi.toFixed(2)} mi prescription — within tolerance.`);
  }
  return { partial, overrun };
}

function classifyRace(input: ClassifyEvidenceInput): {
  isRace: TagReading;
  controlledEffort: TagReading;
} {
  if (!input.raceReadOk) {
    return {
      isRace: unknown('The races table could not be read for this date.'),
      controlledEffort: unknown('Race match could not be confirmed, so effort class cannot be graded.'),
    };
  }
  if (!input.matchedRace) {
    return {
      isRace: absent('No matching race recorded for this date and distance.'),
      controlledEffort: absent('Not a race.'),
    };
  }
  const authority = selectionAuthority(input.matchedRace.priority);
  const tier = authorityTier(authority);
  const isRace = present(`Matched race ${input.matchedRace.slug}.`);
  const controlledEffort = tier === 'representative'
    ? absent(`Declared priority ${input.matchedRace.priority ?? '(none)'} grades as a full, representative race effort.`)
    : present(`Declared priority ${input.matchedRace.priority ?? '(ungraded, treated as C)'} grades as ${tier} — a controlled effort with a number on it, not a full race.`);
  return { isRace, controlledEffort };
}

function classifyContext(input: ClassifyEvidenceInput): EvidenceClassification['context'] {
  // Hoisted to the top of this function: `runFacts` is THE coherent
  // moving/elapsed/pace triple (lib/runs/run-facts.ts), and this function
  // used to call raw `runMovingSec` separately below for the heat-effort
  // duration, then compute `runFacts` again further down for pause
  // detection — two reads of the `clock.moving-disproved` family in one
  // file, caught by `check-derived-consistency.sh`. One call, reused
  // throughout.
  const facts = runFacts(input.data, { basis: 'moving' });

  const terrainRow: RunTerrainRow = input.data as unknown as RunTerrainRow;
  const treadmillOn = isTreadmillRow(terrainRow);
  const treadmill = treadmillOn
    ? present('Indoor/treadmill session.')
    : absent('Outdoor session.');

  const terrain = resolveRunTerrain(terrainRow);
  const hills = terrain.surface === 'treadmill'
    ? absent('Treadmill session — outdoor terrain does not apply; see the treadmill tag.')
    : terrain.material
      ? present(terrain.note ?? `Terrain adjustment ${terrain.deltaSPerMi.toFixed(0)} s/mi, basis ${terrain.basis}.`)
      : absent('No material terrain adjustment for this run.');

  const weather = weatherFromRunData(input.data);
  let heat: TagReading;
  if (weather.tempF == null) {
    heat = unknown('No temperature recorded for this activity.');
  } else {
    const durationS = facts.timeSec;
    const effort = heatEffort({
      tempF: weather.tempF,
      humidityPct: weather.humidityPct,
      conditions: weather.conditions,
      cloudCoverPct: weather.cloudCoverPct,
      durationS,
      // Deliberately no VDOT — same posture as
      // `lib/evidence/activity-evidence.ts`'s header: a capacity belief must
      // never feed the read that could inform it. mid_pack (heatEffort's own
      // default) is the honest population default for a LABEL, not a
      // capacity-grading input.
    });
    if (!effort) {
      heat = unknown('Heat effort could not be computed from the recorded weather.');
    } else if (effort.slowdownPct >= 1) {
      heat = present(`Estimated heat cost ${effort.slowdownPct.toFixed(1)}% at ${weather.tempF}°F effective ${effort.effectiveTempF.toFixed(0)}°F.`);
    } else {
      heat = absent(`Estimated heat cost ${effort.slowdownPct.toFixed(1)}% — not material.`);
    }
  }

  // `refused` is non-empty when `reconcileRun` already disbelieved a stored
  // moving time because the implied pause exceeded MAX_PAUSED_SHARE (0.5) —
  // the strongest possible pause signal, and one a plain ratio would silently
  // lose the moment the clock fell back to elapsed (pausedShare 0).
  let pauses: TagReading;
  if (facts.refused.length > 0) {
    pauses = present(`The stored moving time implied a pause exceeding ${Math.round(MAX_PAUSED_SHARE * 100)}% of the run and was discounted (${facts.refused.join(', ')}).`);
  } else if (facts.elapsedSec == null || facts.timeSec == null || facts.elapsedSec <= 0 || facts.basis !== 'moving') {
    pauses = unknown('No independent elapsed and moving clocks to compare.');
  } else {
    const pausedShare = 1 - facts.timeSec / facts.elapsedSec;
    if (pausedShare >= PAUSE_NOTICEABLE_SHARE) {
      pauses = present(`Moving time is ${Math.round(pausedShare * 100)}% below elapsed time.`);
    } else {
      pauses = absent(`Moving and elapsed clocks agree within ${Math.round(PAUSE_NOTICEABLE_SHARE * 100)}%.`);
    }
  }

  const distanceMi = runDistanceMi(input.data);
  // Reuse `facts.timeSec` — already the reconciled moving time via
  // `runFacts` above — rather than a second raw `runMovingSec` read.
  // `check-derived-consistency.sh` caught the raw call: this file held both
  // the reconciled and the unreconciled member of the `clock.moving-disproved`
  // family, which is one row answering one question two ways.
  const movingSec = facts.timeSec;
  const missingTelemetry = distanceMi == null || movingSec == null
    ? present(`Missing ${distanceMi == null ? 'distance' : 'duration'} — not enough to say what this activity was.`)
    : absent('Distance and duration both recorded.');

  const work = workPhaseSamples(input.data);
  const hrCapableWork = work.filter((p) => p.samples.length > 0);
  let flatlinedTelemetry: TagReading;
  if (hrCapableWork.length === 0) {
    flatlinedTelemetry = unknown('No per-phase heart-rate samples recorded to test for a carried-forward value.');
  } else {
    const verdict = workTraceIsCredible(hrCapableWork);
    flatlinedTelemetry = verdict.credible
      ? absent('Heart-rate samples vary as expected across work phases.')
      : present(verdict.why ?? 'A work phase’s heart-rate samples are a carried-forward value, not a measurement.');
  }

  return { treadmill, heat, hills, pauses, missingTelemetry, flatlinedTelemetry };
}

/**
 * CLASSIFYCTXWIRE-1 (2026-09-06) · a public, data-only door into
 * `classifyContext` for a caller that has a `RunData` but none of the other
 * `ClassifyEvidenceInput` fields (identity/race/safety), and does not need
 * them — `classifyContext` above reads nothing from `input` except
 * `input.data`, so every other field below is an inert placeholder, never
 * read. This is NOT a second derivation: it is the same function, the same
 * owners (`resolveRunTerrain`, `heatEffort`, `workTraceIsCredible`,
 * `runFacts`), called through the one seam that already composes them.
 *
 * First (and, as of this change, only) caller:
 * `lib/adaptation/canonical-shadow/live-input.ts#provenanceFor`, whose own
 * header names the exact gap this closes — it built a live `Provenance` for
 * the canonical adaptation engine's `admissibleForPaceAnchor` with ONLY the
 * treadmill flag ever set, "never a guess at hills/wind/heat/altitude — an
 * unclaimed flag is not evidence the session was clean". This function lets
 * that caller ask the two of those four questions this codebase actually has
 * a real, composed owner for (hills via terrain grade, heat via
 * `heat-model.ts`) without duplicating either owner's logic inline.
 */
export function classifyRunContext(data: RunData): EvidenceClassification['context'] {
  return classifyContext({
    activityId: '',
    dateISO: '',
    data,
    isCanonicalRow: true,
    loserSiblingCount: 0,
    resolvedDay: null,
    rescheduleRows: null,
    matchedRace: null,
    raceReadOk: false,
    safety: null,
  });
}

function classifyRunnerState(input: ClassifyEvidenceInput): EvidenceClassification['runnerState'] {
  if (!input.safety) {
    const u = unknown('Safety signals (illness/injury/disruption) could not be read.');
    return { illness: u, painInjury: u, trainingDisruption: u };
  }
  const s = input.safety;

  const illness = !s.illness.ok
    ? unknown(`Illness signal unreadable (${s.illness.failure}).`)
    : s.illness.value != null
      ? present(`Uncleared illness logged ${s.illness.value.daysActive} day(s) active.`)
      : absent('No uncleared illness logged.');

  const injuryUnreadable = !s.injury.ok;
  const niggleUnreadable = !s.niggle.ok;
  let painInjury: TagReading;
  if (injuryUnreadable || niggleUnreadable) {
    painInjury = unknown('Injury or niggle signal unreadable.');
  } else if (s.injury.value != null) {
    painInjury = present(`Open injury: ${s.injury.value.site} (${s.injury.value.severity}).`);
  } else if (s.niggle.value != null) {
    painInjury = present(`Uncleared niggle: ${s.niggle.value.bodyPart}, severity ${s.niggle.value.severity}${s.niggle.value.escalating ? ', escalating' : ''}.`);
  } else {
    painInjury = absent('No open injury or uncleared niggle logged.');
  }

  const trainingDisruption = !s.disruption.ok
    ? unknown(`Disruption signal unreadable (${s.disruption.failure}).`)
    : s.disruption.value != null
      ? present(`${s.disruption.value.gapDays}-day gap in running ending ${s.disruption.value.gapEndedISO}; reduced-load window ${s.disruption.value.constraintWindowDays} days.`)
      : absent('No recent unplanned training gap.');

  return { illness, painInjury, trainingDisruption };
}

/** THE PURE CORE. No I/O — every branch here is unit-testable without a
 *  database, which is what makes this file's falsification suite possible. */
export function buildEvidenceClassification(input: ClassifyEvidenceInput): EvidenceClassification {
  const { match, matchedWorkoutId } = classifyIdentity(input);
  const { moved, substituted } = classifyMovedSubstituted(input, matchedWorkoutId);
  const { duplicate, mergedRecording } = classifyDuplication(input);

  const matchedDistanceMi = input.resolvedDay
    ? input.resolvedDay.prescriptions.find((p) => p.matchedRun?.runId === input.activityId)?.distanceMi ?? null
    : null;
  const completion = classifyCompletion(input, matchedDistanceMi);
  const race = classifyRace(input);
  const context = classifyContext(input);
  const runnerState = classifyRunnerState(input);

  // A merged-away row is never counted independently for anything — that is
  // exactly the double-count this classifier exists to prevent (Rule 14: the
  // canonical predicate names the population; a loser row is not in it).
  const admissibility = !input.isCanonicalRow
    ? {
        capacityEvidence: {
          admissible: false,
          reason: 'This row lost a duplicate merge. Read the canonical row instead of counting this one.',
        },
        fatigueCost: {
          admissible: false,
          reason: 'This row lost a duplicate merge. Counting it would double-count the same physical run’s load.',
        },
      }
    : {
        capacityEvidence: {
          admissible: true,
          reason: 'Structurally admissible (canonical row, not double-counted). Lever-specific admissibility (pace anchor, weekly load, long-run durability) is owned by lib/adaptation/canonical/admissibility.ts and must be resolved there.',
        },
        fatigueCost: {
          admissible: true,
          reason: 'A canonical row always counts toward fatigue cost/training load, whatever is wrong with its pace — a race, a treadmill session or a heat-impaired run still cost the body something real.',
        },
      };

  return {
    activityId: input.activityId,
    dateISO: input.dateISO,
    identity: { match, matchedWorkoutId, moved, substituted },
    duplication: {
      duplicate,
      mergedRecording,
      splitRecording: unknown(
        'No detector exists for two sequential, non-overlapping recordings of one physical run. '
        + 'lib/runs/identity.ts only merges OVERLAPPING time spans (or, for untrustworthy '
        + 'timestamps, a tight duration+distance match) — see this file’s header.',
      ),
    },
    completion,
    race,
    context,
    runnerState,
    admissibility,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE DATABASE SHELL — every `pool` read lives here, nowhere else in this
 * file. Mirrors `lib/postrun/load.ts`'s split of a pure composer from its
 * loader.
 * ═══════════════════════════════════════════════════════════════════════ */

interface RunRow { id: string; data: Record<string, unknown> }

/**
 * Classify one activity by id, for this runner.
 *
 * Returns null ONLY when no such row exists for this user at all (not even as
 * a merged-away loser) — every other outcome, including a merged-away row, a
 * failed sub-read, or an unmatched supplemental run, is expressed inside the
 * returned record (Rule 11: a caller must be able to tell "nothing here" from
 * "something here, but we could not read all of it").
 */
export async function classifyEvidence(
  userUuid: string,
  activityId: string,
): Promise<EvidenceClassification | null> {
  const runRes = await pool.query<RunRow>(
    `SELECT id::text AS id, data
       FROM runs
      WHERE user_uuid = $1
        AND ${runIdentityMatchSql('$2')}
      LIMIT 1`,
    [userUuid, activityId],
  );
  const runRow = runRes.rows[0];
  if (!runRow) return null;

  const data = asRunData(runRow.data);
  const dateISO = String(data.date ?? String(data.startLocal ?? '').slice(0, 10));
  const isCanonicalRow = !isMergedAway(data);

  const [
    loserSiblingCount,
    resolvedDay,
    rescheduleRows,
    raceResult,
    safety,
  ] = await Promise.all([
    isCanonicalRow ? countLoserSiblings(userUuid, dateISO, runRow.id) : Promise.resolve(0),
    resolveDayExecutions(userUuid, dateISO).catch((err: unknown) => {
      console.warn('[classify-evidence] day resolver unreadable:',
        err instanceof Error ? err.message : err);
      return null;
    }),
    loadRescheduleRows(userUuid, dateISO).catch((err: unknown) => {
      console.warn('[classify-evidence] plan_reschedules unreadable:',
        err instanceof Error ? err.message : err);
      return null;
    }),
    loadMatchedRace(userUuid, dateISO, data).catch((err: unknown) => {
      console.warn('[classify-evidence] race match unreadable:',
        err instanceof Error ? err.message : err);
      return { matchedRace: null, ok: false } as const;
    }),
    loadSafetyInputs(userUuid, { todayISO: dateISO }).catch((err: unknown) => {
      console.warn('[classify-evidence] safety inputs unreadable:',
        err instanceof Error ? err.message : err);
      return null;
    }),
  ]);

  return buildEvidenceClassification({
    activityId: runRow.id,
    dateISO,
    data,
    isCanonicalRow,
    loserSiblingCount,
    resolvedDay,
    rescheduleRows,
    matchedRace: raceResult.matchedRace,
    raceReadOk: raceResult.ok,
    safety,
  });
}

async function countLoserSiblings(userUuid: string, dateISO: string, runId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM runs
      WHERE user_uuid = $1
        AND ${runDaySql()} = $2
        AND ${runMergedIntoIdSql()} = $3`,
    [userUuid, dateISO, runId],
  );
  return Number(r.rows[0]?.n ?? '0');
}

async function loadRescheduleRows(userUuid: string, dateISO: string): Promise<RescheduleRow[] | null> {
  try {
    const r = await pool.query<{
      identity_kind: string; stimulus_preservation: string; decided_at: string;
    }>(
      `SELECT identity_kind, stimulus_preservation, decided_at::text
         FROM plan_reschedules
        WHERE user_uuid = $1::uuid AND new_date_iso = $2 AND undone_at IS NULL
        ORDER BY decided_at DESC`,
      [userUuid, dateISO],
    );
    return r.rows.map((row) => ({
      identityKind: row.identity_kind as RescheduleRow['identityKind'],
      stimulusPreservation: row.stimulus_preservation as RescheduleRow['stimulusPreservation'],
      decidedAtISO: row.decided_at,
    }));
  } catch (e) {
    // NOT_DEPLOYED (relation does not exist) reads the same as any other
    // failed read here — `moved`/`substituted` report `unknown`, never
    // `absent`, on a table that might simply not exist in this deployment
    // yet (Rule 11: an undeployed table is not evidence nothing moved).
    if (/relation .*plan_reschedules.* does not exist/i.test(String((e as Error)?.message ?? ''))) {
      return null;
    }
    throw e;
  }
}

async function loadMatchedRace(
  userUuid: string,
  dateISO: string,
  data: RunData,
): Promise<{ matchedRace: MatchedRaceInfo | null; ok: true }> {
  const distanceMi = runDistanceMi(data) ?? 0;
  const raceRows = await pool.query<{ slug: string; meta: Record<string, unknown> }>(
    `SELECT slug, meta FROM races WHERE user_uuid = $1 AND meta->>'date' LIKE $2 || '%'`,
    [userUuid, dateISO],
  );
  const racesForMatch: RaceForMatch[] = raceRows.rows.map((raw) => {
    const meta = (raw.meta ?? {}) as Record<string, unknown>;
    const explicit = meta.distanceMi != null ? Number(meta.distanceMi) : null;
    return {
      slug: String(raw.slug),
      name: meta.name != null ? String(meta.name) : null,
      date: meta.date != null ? String(meta.date).slice(0, 10) : null,
      distanceMi: explicit != null && isFinite(explicit) && explicit > 0
        ? explicit
        : distanceMiFromLabel((meta.distanceLabel as string | null) ?? null),
    };
  });
  const workoutTypeHint = normalizeDataWorkoutType((data as Record<string, unknown>).workoutType)
    ?? normalizeDataWorkoutType((data as Record<string, unknown>).type)
    ?? null;
  const matched = matchRaceForRun({ date: dateISO, distanceMi, workoutTypeHint }, racesForMatch);
  if (!matched) return { matchedRace: null, ok: true };
  const meta = (raceRows.rows.find((r) => r.slug === matched.slug)?.meta ?? {}) as Record<string, unknown>;
  const priority = typeof meta.priority === 'string' ? meta.priority : null;
  return { matchedRace: { slug: matched.slug, priority }, ok: true };
}
