/**
 * lib/postrun/matched.ts · PR-15 · THE MATCHED WORKOUT.
 *
 * PURE. The database read is `detail-load.ts`; everything decided here is
 * decided from values, so the whole ranking can be falsified in a test.
 *
 * ── WHAT "MATCHED" MEANS HERE, AND WHAT IT EXPLICITLY DOES NOT ────────────
 *
 * `docs/RUNNER_EXPERIENCE_CONTRACT.md` Q44, verbatim: matched workouts match
 * "by intended coaching stimulus and structure, not activity type or
 * whole-run distance." That single sentence rules out the obvious
 * implementation — nearest run of the same length — and it rules it out for
 * a reason the owner's own data demonstrates.
 *
 * On 2026-09-01 he ran `4×1 mi @ T pace · 1 min jog`, 8.5 miles in total. The
 * nearest run by whole-run distance in the trailing 180 days is a 8.15 mile
 * EASY run. Comparing those two tells him nothing, and the number it would
 * lead with — average pace — is the exact number this surface is forbidden to
 * lead with, because 8.5 miles containing four threshold miles and 4.2 miles
 * of warm-up and cool-down has an average pace that describes no part of the
 * session.
 *
 * The right answer for that run is his previous 4 × 1 mile session. There are
 * four candidates carrying four one-mile reps in the window and one carrying
 * four one-KILOMETRE reps, and the kilometre session is the trap: same rep
 * count, same recovery, same family, 0.62 mile reps. Structure is not rep
 * count alone.
 *
 * ── THE RANKING IS Q44's ORDER, LEXICOGRAPHICALLY, NOT A WEIGHTED SCORE ───
 *
 * `docs/BRAIN_CONSTITUTION.md`: "scores require justification". A weighted sum
 * over these keys would let a strong recency term buy a bad structural match,
 * and there is no defensible set of weights to publish. Q44 does not give
 * weights — it gives an ORDER — so the order is what is implemented:
 *
 *   GATES   (a candidate failing any is not defensible, and is not ranked)
 *     · both sessions have TWO OR MORE work segments
 *     · rep distance within 25 percent            — kills the 1 km session
 *     · work-segment count within one
 *     · the candidate recorded its own intended stimulus
 *     · prescribed intensity within 8 percent
 *
 *   ORDER   (first key that differs decides)
 *     1 · total work distance         bucketed to a quarter mile
 *     2 · work-segment count          exact
 *     3 · prescribed intensity        bucketed to ten seconds per mile
 *     4 · point in the block          bucketed to two weeks, when a goal race
 *                                       is known for both dates
 *     5 · terrain                     bucketed to 40 ft per mile
 *     6 · recency                     most recent first
 *
 * Terrain is a RANKING key and not a gate, and the intent gate is a gate and
 * not a preference. Both of those were the other way round until this was run
 * against the owner's real history; the arguments are at `refuse`.
 *
 * ── WHY THE KEYS ARE BUCKETED (Rule 9) ────────────────────────────────────
 *
 * A lexicographic order over continuous quantities is a cliff generator: two
 * candidates whose work distance differs by a hundredth of a mile would be
 * separated by key 1 and would never reach key 2, so a tenth of a mile of
 * GPS noise could change which session the runner is shown. Bucketing the
 * continuous keys means near-ties fall through to recency, which is discrete,
 * stable and meaningful. The cliff is not relocated, it is removed: inside a
 * bucket the key cannot discriminate at all.
 *
 * ── RULE 8 DOES NOT APPLY, AND HERE IS THE ARGUMENT ───────────────────────
 *
 * Rule 8 filters readers that answer "what does this runner normally do". This
 * is not one. It names ONE prior session and says how it went. A 4 × 1 mile
 * session run during a taper week is still a 4 × 1 mile session and is still
 * the honest comparator for the next one; excluding it would delete a true
 * reading rather than correct a false one. Nothing here is averaged into a
 * habit, a baseline or a ramp. The block-position key is where taper context
 * enters, and it enters as a RANKING preference rather than as an exclusion.
 *
 * ── RULE 14 · THE POPULATION THIS READS ───────────────────────────────────
 *
 * Candidates come from `runs`, canonical rows only, this user by uuid, and
 * their session structure is read from the RUN ROW'S OWN frozen phase array —
 * never from `plan_workouts`. That is not a shortcut, it is the correct
 * source: the owner's active plan carries rows for 2026-09-01 and 2026-09-02
 * and for none of the older sessions, because the plan has been re-authored
 * since. Joining plan rows to find a candidate's intent would either read
 * nothing or read across archived plan versions, which is Rule 14's own
 * named defect. What the session WAS is stamped on the run.
 */

/* ═══════════════════════════ 1 · the signature ══════════════════════════ */

/** One work or recovery segment, as this module needs it. */
export interface MatchSegment {
  kind: string;
  /** Seconds per mile actually run. */
  paceSecPerMi: number | null;
  distanceMi: number | null;
  durationSec: number | null;
  avgHr: number | null;
  /** The band it was graded against, when it was pace-graded. */
  targetSecPerMi: number | null;
  isStride: boolean;
}

/**
 * THE TWO FIGURES THAT ALREADY HAVE AN OWNER, passed in rather than recomputed.
 *
 * `WorkSummary` on `WorkoutVerdict` is the canonical "duration-weighted mean
 * pace / heart rate across the work phases", and this module reads exactly
 * that quantity. Computing it a second time here would be two answers to one
 * question over one payload (Rule 16) — and the same screen already draws the
 * server's copy in its reading rows, so the two would have been visible side
 * by side and free to disagree.
 *
 * `check-derived-consistency.sh` is what found it: a file holding pace,
 * distance and duration together and doing arithmetic on them is where a
 * second opinion about pace gets born. The arithmetic left in this file —
 * rep spread, fade, recovery pace — computes quantities NOTHING else owns.
 */
export interface WorkReading {
  /** Duration-weighted mean pace across the work phases, s/mi. */
  paceSecPerMi: number | null;
  /** Duration-weighted mean heart rate across the work phases, bpm. */
  hrBpm: number | null;
}

/** Everything the ranking and the comparison read off one run. */
export interface MatchCandidate {
  runId: string;
  dateISO: string;
  segments: MatchSegment[];
  /** From `WorkoutVerdict.work`. Never derived here. */
  work: WorkReading;
  /** `runs.data.distanceMi`. Used for terrain normalisation, NEVER compared. */
  totalDistanceMi: number | null;
  elevGainFt: number | null;
  tempF: number | null;
  /** Weeks from this run's date to the goal race, when one is known. */
  weeksToRace: number | null;
  /** `plan_workouts.type` frozen on the row, when the row carries one. */
  sessionTypeDisplay: string | null;
}

/** The reduced shape both gates and ranking read. */
export interface SessionSignature {
  workCount: number;
  /** Median work-segment distance, miles. The rep. */
  repDistanceMi: number | null;
  /** Sum of the work segments, miles. The dose. */
  totalWorkMi: number | null;
  /** Median prescribed work pace, s/mi. Null when none was recorded. */
  targetSecPerMi: number | null;
  /** Duration-weighted work pace actually run, s/mi. */
  workPaceSecPerMi: number | null;
  /** Duration-weighted work heart rate, bpm. */
  workHrBpm: number | null;
  /** Spread across the work segments, s/mi. Null with fewer than two. */
  repSpreadSec: number | null;
  /** Last work rep minus first, s/mi. Positive means it faded. */
  fadeSec: number | null;
  /** Median recovery duration, seconds. Null when there were no recoveries. */
  recoverySec: number | null;
  /** Duration-weighted recovery pace, s/mi. */
  recoveryPaceSecPerMi: number | null;
  /** Feet of climb per mile of running. Null when the run measured none. */
  elevPerMi: number | null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Duration-weighted mean, or null when nothing carried both parts. */
function weighted(pairs: Array<[value: number | null, weight: number | null]>): number | null {
  let num = 0;
  let den = 0;
  for (const [v, w] of pairs) {
    if (v == null || w == null || !(w > 0)) continue;
    num += v * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

/**
 * Reduce a run to the numbers the match is decided on.
 *
 * STRIDES ARE NOT WORK. `isStrideSegment` is the canonical grader's marker
 * and doctrine calls a stride "not a workout"; letting six 20-second
 * accelerations count as six work segments would make the owner's 2026-09-02
 * easy day look like a 6 × 0.05 mile rep session and match it against one.
 */
export function signatureOf(segments: MatchSegment[], reading: WorkReading): SessionSignature {
  const work = segments.filter((s) => s.kind === 'work' && !s.isStride);
  const rec = segments.filter((s) => s.kind === 'recovery');
  const workDistances = work.map((s) => s.distanceMi).filter((d): d is number => d != null && d > 0);
  const workPaces = work.map((s) => s.paceSecPerMi).filter((p): p is number => p != null && p > 0);
  const targets = work.map((s) => s.targetSecPerMi).filter((t): t is number => t != null && t > 0);

  return {
    workCount: work.length,
    repDistanceMi: median(workDistances),
    totalWorkMi: workDistances.length > 0
      ? Math.round(workDistances.reduce((a, b) => a + b, 0) * 100) / 100
      : null,
    targetSecPerMi: median(targets),
    /* THE GRADER'S OWN FIGURES, carried straight through. See `WorkReading`. */
    workPaceSecPerMi: reading.paceSecPerMi,
    workHrBpm: reading.hrBpm,
    repSpreadSec: workPaces.length >= 2
      ? Math.round(Math.max(...workPaces) - Math.min(...workPaces))
      : null,
    /* LATE-SESSION DETERIORATION, and only with three or more reps. Across
     * two, "the second was slower than the first" is one comparison and is
     * indistinguishable from noise; Q44 asks about deterioration across a
     * session, which needs a session to have a shape. */
    fadeSec: workPaces.length >= 3
      ? Math.round(workPaces[workPaces.length - 1] - workPaces[0])
      : null,
    recoverySec: median(rec.map((s) => s.durationSec).filter((d): d is number => d != null && d > 0)),
    recoveryPaceSecPerMi: weighted(rec.map((s) => [s.paceSecPerMi, s.durationSec])),
    elevPerMi: null,
  };
}

/** The terrain half, which needs the run row and not just its segments. */
export function elevPerMiOf(c: MatchCandidate): number | null {
  if (c.elevGainFt == null || c.totalDistanceMi == null || !(c.totalDistanceMi > 0)) return null;
  return c.elevGainFt / c.totalDistanceMi;
}

/* ════════════════════════════ 2 · the gates ═════════════════════════════ */

/** Why a candidate was refused. Kept for the test, and for a future log. */
export type MatchRefusal =
  | 'no-work-segments'
  | 'rep-distance-differs'
  | 'segment-count-differs'
  | 'intensity-differs'
  | 'intent-not-recorded';

export const REP_DISTANCE_TOLERANCE = 0.25;
export const INTENSITY_TOLERANCE = 0.08;
export const MAX_SEGMENT_COUNT_DELTA = 1;

/**
 * Is this candidate a defensible comparator?
 *
 * Returns null when it is, and the reason when it is not.
 *
 * A GATE THAT CANNOT BE EVALUATED DOES NOT FIRE. Where one side did not
 * record a target pace or an elevation gain, the intensity and terrain gates
 * abstain rather than refusing — an unknown is not a mismatch (Rule 11). The
 * cost is carried where it belongs: the comparison itself omits any line it
 * cannot compute, and the basis sentence never claims a similarity that was
 * never checked.
 */
export function refuse(a: SessionSignature, b: SessionSignature): MatchRefusal | null {
  /* TWO, on both sides, for the reason argued at `pickMatchedWorkout`: with
   * one work segment every figure below collapses into the run's own average
   * pace, which is the comparison Q44 forbids. */
  if (a.workCount < 2 || b.workCount < 2) return 'no-work-segments';

  if (a.repDistanceMi != null && b.repDistanceMi != null && a.repDistanceMi > 0) {
    const off = Math.abs(b.repDistanceMi - a.repDistanceMi) / a.repDistanceMi;
    if (off > REP_DISTANCE_TOLERANCE) return 'rep-distance-differs';
  }

  if (Math.abs(a.workCount - b.workCount) > MAX_SEGMENT_COUNT_DELTA) return 'segment-count-differs';

  /* ── DATA QUALITY · THE CANDIDATE MUST HAVE RECORDED ITS OWN INTENT ─────
   *
   * Q44's FIRST ranking key is "same session family and intended stimulus",
   * and the brief adds "decline to compare when conditions, structure, DATA
   * QUALITY or purpose are not comparable". A candidate that stored no target
   * pace cannot be matched on the primary key at all — and Rule 11 is exact
   * about this: "no target recorded" and "the same target" are two facts, and
   * an abstaining gate silently spends the first as the second.
   *
   * THIS IS NOT HYPOTHETICAL, AND IT IS WHY THE GATE EXISTS. Run against the
   * owner's real history on 2026-09-03, the 4 × 1 mile session of 2026-09-01
   * matched 2026-07-23 — a row carrying no target, no heart rate at all,
   * three reps reading an identical 389 s/mi and a fourth with no distance or
   * duration. The card it produced read "Work pace 6:29 then, 7:03 now · 34
   * s/mi slower" over a pace no instrument measured, and "Spread across reps
   * 0 s/mi" — perfect consistency — as an artefact of three copies of one
   * number. The right comparator, 2026-06-16, was sitting behind it with real
   * heart rate and four genuinely different rep paces.
   *
   * Only fires when THIS run recorded an intent. A runner comparing two
   * unplanned sessions is comparing what he actually did, and neither side
   * claims a prescription. */
  if (a.targetSecPerMi != null && b.targetSecPerMi == null) return 'intent-not-recorded';

  if (a.targetSecPerMi != null && b.targetSecPerMi != null && a.targetSecPerMi > 0) {
    const off = Math.abs(b.targetSecPerMi - a.targetSecPerMi) / a.targetSecPerMi;
    if (off > INTENSITY_TOLERANCE) return 'intensity-differs';
  }

  /* NO TERRAIN GATE. It was here and it was WRONG in two separate ways, both
   * found by running this against production rather than by reading it.
   *
   * 1 · Q44 lists terrain and conditions as a RANKING key, sixth of seven —
   *     not as an admissibility test. Promoting a ranking key to a gate is a
   *     stricter rule than the specification asks for, and strictness here
   *     costs a true comparison rather than preventing a false one.
   *
   * 2 · IT DEPENDED ON A NUMBER THIS APP DOES NOT TRUST. `elevGainFt` is
   *     exactly the field `lib/runs/elev-sanity.ts` exists to police: one of
   *     the owner's rows claims 2807 feet of climb over 7.78 miles. The gate
   *     read 92 ft/mi for 2026-09-01 against 6 ft/mi for 2026-06-16 and threw
   *     away the single best comparator in six months of training on the
   *     strength of it.
   *
   * Terrain now enters where Q44 puts it, as a low-priority ranking key, where
   * a bad reading costs an ordering preference instead of a whole comparison. */

  return null;
}

/* ═══════════════════════════ 3 · the ranking ════════════════════════════ */

function bucketed(v: number | null, size: number): number | null {
  return v == null ? null : Math.round(v / size);
}

/**
 * Q44's order, first differing key wins. Lower is better on every key.
 *
 * A null key is neutral: it compares equal to everything, so a candidate that
 * did not record a target pace is not punished by key 3 and is not rewarded
 * by it either. It falls through to the keys it CAN answer.
 */
function rankKeys(
  target: SessionSignature,
  c: SessionSignature,
  targetWeeksToRace: number | null,
  cWeeksToRace: number | null,
  targetElev: number | null,
  cElev: number | null,
  daysAgo: number,
): Array<number | null> {
  return [
    bucketed(
      target.totalWorkMi != null && c.totalWorkMi != null
        ? Math.abs(c.totalWorkMi - target.totalWorkMi) : null,
      0.25,
    ),
    Math.abs(c.workCount - target.workCount),
    bucketed(
      target.targetSecPerMi != null && c.targetSecPerMi != null
        ? Math.abs(c.targetSecPerMi - target.targetSecPerMi) : null,
      10,
    ),
    bucketed(
      targetWeeksToRace != null && cWeeksToRace != null
        ? Math.abs(cWeeksToRace - targetWeeksToRace) : null,
      2,
    ),
    /* TERRAIN · Q44's sixth key, and BLUNTLY bucketed at 40 ft per mile
     * because `elevGainFt` is not a number this app trusts finely — see the
     * argument in `refuse`. At this width it separates a hill session from a
     * flat one and says nothing at all about smaller differences, which is
     * exactly as much as the measurement supports. */
    bucketed(
      targetElev != null && cElev != null ? Math.abs(cElev - targetElev) : null,
      40,
    ),
    daysAgo,
  ];
}

function compareKeys(a: Array<number | null>, b: Array<number | null>): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x == null || y == null) continue;
    if (x !== y) return x - y;
  }
  return 0;
}

function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(`${aISO}T00:00:00Z`);
  const b = Date.parse(`${bISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.MAX_SAFE_INTEGER;
  return Math.round(Math.abs(a - b) / 86_400_000);
}

/* ═══════════════════════ 4 · the composed comparison ════════════════════ */

/** One line of the comparison. Present only when BOTH sides had the number. */
export interface MatchLine {
  /** What is being compared. Two to four words. */
  label: string;
  /** This run's figure, already formatted. */
  now: string;
  /** The matched run's figure, already formatted. */
  then: string;
  /**
   * The difference, as a sentence fragment, or null when a difference is not
   * a thing worth stating. Never a verdict word: this surface reports facts
   * and the coach card above it holds the judgement (Rule 17).
   */
  delta: string | null;
}

export interface MatchedWorkout {
  runId: string;
  dateISO: string;
  /**
   * THE BASIS, ALWAYS STATED. Q44: "never merely 'matched run'."
   *
   * It names the structure the match was made on and how long ago it was, so
   * the runner can see WHY these two sessions were put side by side and can
   * disagree.
   */
  basis: string;
  lines: MatchLine[];
  /**
   * What could not be compared and why. Empty when everything was available.
   * A comparison that silently drops its heart-rate line looks identical to
   * one over a run that had no strap (Rule 11).
   */
  withheld: string[];
  /* NO `accessibilitySummary`. There was one, and the card turned out to have
   * no use for it: a combined VoiceOver label REPLACES the children it
   * summarises, so the comparison would have been read as a single sentence
   * with none of its seven figures in it. The rows are labelled text in a
   * sensible reading order and read better as themselves.
   *
   * Deleted rather than kept behind an exemption. A field composed,
   * documented and read by no screen is exactly the `coverage` failure the
   * post-run wire gate was written for, and "we might need it" is not a
   * reason. `PostRunAnalysis` keeps its summary, where the content really is
   * a drawing and a screen reader has nothing else to go on. */
}

function fmtPace(sec: number | null): string | null {
  if (sec == null || !(sec > 0)) return null;
  const r = Math.round(sec);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}/mi`;
}

function fmtDelta(deltaSec: number, fasterWord = 'faster', slowerWord = 'slower'): string | null {
  const d = Math.round(deltaSec);
  /* A SECOND PER MILE IS NOT A FINDING. GPS on a one-mile rep does not
   * resolve it, and printing "1 s/mi faster" invites a runner to read noise
   * as progress. Below the threshold the line still draws — both figures are
   * real — and simply carries no delta. */
  if (Math.abs(d) < 2) return null;
  return d < 0 ? `${Math.abs(d)} s/mi ${fasterWord}` : `${d} s/mi ${slowerWord}`;
}

function weeksWord(days: number): string {
  if (days < 10) return `${days} days ago`;
  const w = Math.round(days / 7);
  return w === 1 ? 'a week ago' : `${w} weeks ago`;
}

/** "4 × 1 mi", or "4 × 1.2 mi", or null when the reps had no stated length. */
function structureWord(sig: SessionSignature): string | null {
  if (sig.workCount === 0) return null;
  if (sig.repDistanceMi == null) return null;
  const d = sig.repDistanceMi;
  const dist = Math.abs(d - Math.round(d)) < 0.05
    ? `${Math.round(d)} mi`
    : `${d.toFixed(1)} mi`;
  return sig.workCount === 1 ? dist : `${sig.workCount} × ${dist}`;
}

/**
 * Build the side-by-side.
 *
 * WHAT IS COMPARED, from Q44: work-segment pace, the heart-rate/pace
 * relationship, rep consistency, recovery behaviour, late-session
 * deterioration, total intended work.
 *
 * WHAT IS NOT, from Q44 and from the rule at the top of this surface: the
 * whole run's average pace. It is not computed here, there is no field on
 * `MatchLine` it could occupy, and `MatchCandidate.totalDistanceMi` is
 * carried only to normalise elevation. Making it structurally absent rather
 * than conventionally avoided is the point — a later edit cannot add it back
 * without adding a field and answering for it.
 */
export function composeMatchedWorkout(
  now: { dateISO: string; sig: SessionSignature; sessionTypeDisplay: string | null },
  then: { runId: string; dateISO: string; sig: SessionSignature; sessionTypeDisplay: string | null },
): MatchedWorkout {
  const lines: MatchLine[] = [];
  const withheld: string[] = [];
  const days = daysBetween(now.dateISO, then.dateISO);

  /* 1 · WORK-SEGMENT PACE. The headline, and the only pace either side of
   *     this comparison is allowed to lead with. */
  const nowPace = fmtPace(now.sig.workPaceSecPerMi);
  const thenPace = fmtPace(then.sig.workPaceSecPerMi);
  if (nowPace && thenPace && now.sig.workPaceSecPerMi != null && then.sig.workPaceSecPerMi != null) {
    lines.push({
      label: 'Work pace',
      now: nowPace,
      then: thenPace,
      delta: fmtDelta(now.sig.workPaceSecPerMi - then.sig.workPaceSecPerMi),
    });
  } else {
    withheld.push('Work pace was not recorded on both sessions.');
  }

  /* 1b · WHAT EACH SESSION ASKED FOR.
   *
   * Without this line the pace comparison is unreadable, and it took real
   * data to see it. On 2026-09-01 the plan asked for 7:10 per mile; the
   * comparator of 2026-06-16 asked for 6:43. He ran 7:03 and 7:05. A card
   * showing only "18 s/mi slower" describes a runner who has gone backwards;
   * the two targets show a runner who hit both prescriptions, given two
   * different prescriptions.
   *
   * The gate has already established the two intensities are within eight
   * percent of each other, so this line is never a comparison between
   * unrelated sessions. It is the context that stops a true number being read
   * as the wrong story. */
  if (now.sig.targetSecPerMi != null && then.sig.targetSecPerMi != null) {
    lines.push({
      label: 'Asked for',
      now: fmtPace(now.sig.targetSecPerMi) ?? '',
      then: fmtPace(then.sig.targetSecPerMi) ?? '',
      delta: null,
    });
  }

  /* 2 · THE HEART-RATE / PACE RELATIONSHIP, and it is ONE line rather than
   *     two, because the fact worth having is the pair. Same pace at a lower
   *     heart rate is the thing a threshold session exists to produce, and
   *     either number alone says nothing about it. */
  if (now.sig.workHrBpm != null && then.sig.workHrBpm != null) {
    const d = Math.round(now.sig.workHrBpm - then.sig.workHrBpm);
    lines.push({
      label: 'Work heart rate',
      now: `${Math.round(now.sig.workHrBpm)} bpm`,
      then: `${Math.round(then.sig.workHrBpm)} bpm`,
      delta: Math.abs(d) < 2 ? null : d < 0 ? `${Math.abs(d)} bpm lower` : `${d} bpm higher`,
    });
  } else {
    withheld.push('Heart rate was not recorded on both sessions.');
  }

  /* 3 · REP CONSISTENCY. The spread across the reps, which is a different
   *     question from whether they were fast. */
  if (now.sig.repSpreadSec != null && then.sig.repSpreadSec != null) {
    const d = now.sig.repSpreadSec - then.sig.repSpreadSec;
    lines.push({
      label: 'Spread across reps',
      now: `${now.sig.repSpreadSec} s/mi`,
      then: `${then.sig.repSpreadSec} s/mi`,
      delta: Math.abs(d) < 2 ? null : d < 0 ? `${Math.abs(d)} s/mi tighter` : `${d} s/mi wider`,
    });
  }

  /* 4 · LATE-SESSION DETERIORATION. */
  if (now.sig.fadeSec != null && then.sig.fadeSec != null) {
    const word = (v: number) => (v > 1 ? `${v} s/mi slower by the last rep`
      : v < -1 ? `${Math.abs(v)} s/mi faster by the last rep`
      : 'held to the last rep');
    lines.push({
      label: 'First rep to last',
      now: word(now.sig.fadeSec),
      then: word(then.sig.fadeSec),
      delta: null,
    });
  }

  /* 5 · RECOVERY BEHAVIOUR. */
  if (now.sig.recoveryPaceSecPerMi != null && then.sig.recoveryPaceSecPerMi != null) {
    const d = now.sig.recoveryPaceSecPerMi - then.sig.recoveryPaceSecPerMi;
    lines.push({
      label: 'Recovery pace',
      now: fmtPace(now.sig.recoveryPaceSecPerMi) ?? '',
      then: fmtPace(then.sig.recoveryPaceSecPerMi) ?? '',
      delta: fmtDelta(d, 'quicker', 'easier'),
    });
  }

  /* 6 · TOTAL INTENDED WORK. Not the run's distance. The dose. */
  if (now.sig.totalWorkMi != null && then.sig.totalWorkMi != null) {
    lines.push({
      label: 'Work covered',
      now: `${now.sig.totalWorkMi} mi`,
      then: `${then.sig.totalWorkMi} mi`,
      delta: null,
    });
  }

  const structure = structureWord(now.sig);
  const family = now.sessionTypeDisplay ?? then.sessionTypeDisplay;
  const named = [structure, family?.toLowerCase()].filter(Boolean).join(' ');
  const basis = named
    ? `Compared with your previous ${named} session, ${weeksWord(days)}.`
    : `Compared with your previous session of the same structure, ${weeksWord(days)}.`;

  return {
    runId: then.runId,
    dateISO: then.dateISO,
    basis,
    lines,
    withheld,
  };
}

/* ═══════════════════════════ 5 · the entry point ════════════════════════ */

export interface MatchResult {
  matched: MatchedWorkout | null;
  /**
   * WHY THERE IS NO MATCH, when there is none.
   *
   * Q44: "If no defensible match exists, say so rather than forcing one." A
   * null with no sentence beside it is indistinguishable on screen from a
   * feature that failed to load, and Rule 11 says those are two facts.
   */
  refusal: string | null;
}

/** How far back a comparator may be drawn from. Q44's "~180 days". */
export const MATCH_WINDOW_DAYS = 180;

export function pickMatchedWorkout(
  current: MatchCandidate,
  candidates: MatchCandidate[],
): MatchResult {
  const nowSig = signatureOf(current.segments, current.work);
  const nowElev = elevPerMiOf(current);

  /* ── WHY THE BAR IS *TWO* WORK SEGMENTS, AND NOT ONE ────────────────────
   *
   * This is the gate that keeps Q44's central prohibition structural rather
   * than conventional. "Do not compare whole-run average pace."
   *
   * A steady run recorded by the faff watch is ONE phase, and its type is
   * `work`: the owner's 2026-09-02 easy day is a single 5.00 mile phase
   * labelled "5.0 mi easy", plus strides and walk-backs. Admit that at
   * `workCount >= 1` and `signatureOf` dutifully reports a "work pace" for
   * it — and that number is the easy run's own average pace under a
   * different name. The comparison card would then lead with exactly the
   * quantity the contract forbids, while every line of code in this file
   * still said "work".
   *
   * At two or more work segments, every figure this module computes is a
   * property of a SUBSET of the run — the reps — and none of them can be the
   * whole-run average, because the warm-up, the recoveries and the cool-down
   * are excluded by construction rather than by care.
   *
   * WHAT THIS COSTS, STATED PLAINLY: a long run gets no comparator here, and
   * the brief does list "same long-run structure" as a valid matching key.
   * That case needs comparison lines that are honest for a steady effort —
   * late-session drift, the heart-rate/pace relationship across thirds — and
   * those are a different set of lines, not a loosened gate on these ones.
   * It is left undone rather than done wrongly.
   *
   * NOT A REFUSAL WORTH PRINTING. An easy run has no segmented comparator and
   * never will, so the section is simply absent. Printing "no comparable
   * session" under every easy run is furniture, and the UX doctrine's test is
   * whether a line changes what the runner understands or does next. */
  if (nowSig.workCount < 2) return { matched: null, refusal: null };

  const ranked = candidates
    .filter((c) => c.runId !== current.runId)
    .filter((c) => c.dateISO < current.dateISO)
    .filter((c) => daysBetween(current.dateISO, c.dateISO) <= MATCH_WINDOW_DAYS)
    .map((c) => ({ c, sig: signatureOf(c.segments, c.work), elev: elevPerMiOf(c) }))
    .filter((x) => refuse(nowSig, x.sig) == null)
    .sort((p, q) => compareKeys(
      rankKeys(nowSig, p.sig, current.weeksToRace, p.c.weeksToRace,
        nowElev, p.elev, daysBetween(current.dateISO, p.c.dateISO)),
      rankKeys(nowSig, q.sig, current.weeksToRace, q.c.weeksToRace,
        nowElev, q.elev, daysBetween(current.dateISO, q.c.dateISO)),
    ));

  const best = ranked[0];
  if (!best) {
    const structure = structureWord(nowSig);
    return {
      matched: null,
      refusal: structure
        ? `No comparable ${structure} session in the last six months.`
        : 'No comparable session in the last six months.',
    };
  }

  const matched = composeMatchedWorkout(
    { dateISO: current.dateISO, sig: nowSig, sessionTypeDisplay: current.sessionTypeDisplay },
    {
      runId: best.c.runId,
      dateISO: best.c.dateISO,
      sig: best.sig,
      sessionTypeDisplay: best.c.sessionTypeDisplay,
    },
  );

  /* A MATCH THAT CAN COMPARE NOTHING IS NOT A MATCH. Two sessions of
   * identical structure, neither of which recorded a pace, produce a card
   * with a basis sentence and no rows. That is furniture. */
  if (matched.lines.length === 0) {
    return { matched: null, refusal: 'The comparable session recorded too little to compare.' };
  }

  return { matched, refusal: null };
}
