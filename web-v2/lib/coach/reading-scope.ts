/**
 * lib/coach/reading-scope.ts · WHICH WHOLE-RUN NUMBERS ARE ALLOWED TO APPEAR.
 *
 * The defect this closes, in one example. David's 2026-08-11 session stores
 * nine phases — a warm-up, four 1 km reps at 6:52-ish, three jogs and a
 * cool-down. Its stored whole-run `avgHr` is 153. The four reps averaged
 * 164 / 169 / 168 / 160. **Nothing on that run happened at 153 bpm.** It is the
 * mean of hard kilometres and slow jogs, and every surface in the app printed
 * it as "Heart rate, avg" with nothing to say what interval it was the average
 * of. Same for cadence: 174 on the reps, 115 on a jog, one number on screen.
 *
 * The rule this file enforces, which is the whole post-run spec in one line:
 *
 *   AN AVERAGE IS HONEST ONLY OVER AN INTERVAL OF CONSTANT INTENT.
 *
 * A whole-run mean is a fair summary of an easy run because an easy run has one
 * intent from end to end. Over warm-up + reps + jogs + cool-down it is a number
 * with no referent, and the fix is not a better average — it is a SCOPE. Every
 * reading this returns either names the interval it covers or is refused.
 *
 * ── Why this keys on STRUCTURE, not on workout type ────────────────────────
 *
 * Because the type is not there. Of 143 live runs in production, 36 carry a
 * semantic `workoutType`; the other 107 are null or a Strava integer, and the
 * column mixes two vocabularies. Keying on type would leave three quarters of
 * his history on the old, wrong behaviour.
 *
 * `phases` is the honest key. It is present on every watch and treadmill run
 * from 2026-06 onward, it carries the work/recovery labels the type does not,
 * and — the point — a run WITH work phases is exactly a run whose whole-run
 * mean spans more than one intent. A run without them is exactly a run whose
 * mean is fine. The structure IS the question.
 *
 * ── Doctrine ───────────────────────────────────────────────────────────────
 *
 * `Research/03-heart-rate-zones.md` §13 "Implications by Rep Duration" gives HR
 * a floor below which it is not measuring the rep, it is measuring its own lag:
 * "HR rises with a half-time of ~30 s on intensity step-up, plateauing at
 * 90–180 s." §14's decision table then states the consequence as an
 * instruction — `| Reps / R-pace (<2 min) | Pace | RPE | Ignore HR |`.
 *
 * The corollary the app had never drawn: if HR must be ignored DURING reps that
 * short, an HR verdict AFTER them is the same claim made later. So a rep set
 * under the floor gets no HR reading at all — not a scoped one.
 *
 * Bound by `HR.rep-kinetics-floor` in lib/doctrine/registry.ts, which reads the
 * two-minute figure out of §14's own row label rather than trusting this file.
 */

/** The subset of a phase this module needs. Structural, so both the server's
 *  `PhaseBreakdown` and any test fixture satisfy it without a cast. */
export interface ScopePhase {
  type: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'unknown' | string;
  actual_duration_sec?: number | null;
  avg_hr?: number | null;
  avg_cadence?: number | null;
}

/**
 * `whole` · the run had one intent; the whole-run mean describes it.
 * `work`  · the mean is over the work phases only, and must be labelled so.
 * `none`  · no honest mean exists. Show nothing. This is a finding, not a gap.
 */
export type ReadingScope = 'whole' | 'work' | 'none';

export interface ScopedReading {
  scope: ReadingScope;
  /** The value at that scope · null whenever `scope` is 'none', and also when
   *  the scope is right but the source carried no number. */
  value: number | null;
  /** Why the scope is what it is, in runner-English. Null on 'whole', where
   *  there is nothing to explain. Never shown as a caveat — it is the row's
   *  own label ("across the four reps"). */
  note: string | null;
}

export interface ReadingScopes {
  hr: ScopedReading;
  cadence: ScopedReading;
  /**
   * Pace, in seconds per mile.
   *
   * Never `none` — unlike HR, a pace always has a true whole-run value, and the
   * distance and the clock are on the poster regardless. What changes is what
   * it may be CALLED: on a session with a warm-up and a cool-down, "average
   * pace" invites the reader to compare it with the rep target it is nowhere
   * near. His 2026-08-11 session averaged 7:18 across nine phases while its
   * reps ran 6:2x — a 50-second gap between the number on screen and the number
   * the session was about.
   */
  pace: ScopedReading;
  /**
   * False when the session was run in reps and a per-mile chart would cut
   * across them. `Research/01-pace-zones-vdot.md` §"Pace zone width and
   * lock-in rules": `| I | ±3 sec per rep | Yes — by interval time, not by
   * per-mile pace |`. Mile 2 of a 4×1km is the back of rep 1, a jog and the
   * front of rep 2 averaged into one bar; on his 2026-07-16 rep session the
   * mile splits read 7:33 and 8:34 for work that was run at 6:2x.
   */
  splitsMeaningful: boolean;
  /**
   * False on a rep set. A time-in-zone bar over warm-up + reps + jogs is
   * dominated by the jogs and by HR's own rise time, and the zone the session
   * asked for is unreachable by construction — the bar can only ever say the
   * runner missed it.
   */
  zoneBarMeaningful: boolean;
  /** True when this run is a rep set (two or more work phases). The one input
   *  the two booleans above are derived from, exported so renderers can order
   *  their sections by it without re-deriving. */
  isRepSet: boolean;
}

/**
 * The HR kinetics floor, in seconds.
 *
 * `Research/03` §14: `| Reps / R-pace (<2 min) | Pace | RPE | Ignore HR |`.
 * Reps shorter than this never reach their HR band, so the HR they did reach is
 * the lag, not the effort. The registry claim parses "<2 min" out of that row
 * rather than trusting this constant.
 */
export const HR_REP_KINETICS_FLOOR_SEC = 120;

/** Two or more work phases is a rep SET. One is a block — a tempo, an MP
 *  segment, a race — whose miles are at least all one intent inside it. */
const REP_SET_MIN_WORK_PHASES = 2;

const isWork = (p: ScopePhase) => p.type === 'work';

/** Duration-weighted mean, ignoring phases that carry no value or no duration.
 *  Weighted rather than plain because a 25-second rep and a 250-second rep are
 *  not two equal observations of the same thing. */
function weightedMean(
  phases: ScopePhase[],
  pick: (p: ScopePhase) => number | null | undefined,
): number | null {
  let num = 0;
  let den = 0;
  for (const p of phases) {
    const v = pick(p);
    const w = p.actual_duration_sec;
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    if (w == null || !Number.isFinite(w) || w <= 0) continue;
    num += v * w;
    den += w;
  }
  return den > 0 ? Math.round(num / den) : null;
}

/** The median work-phase duration, or null when none of them recorded one.
 *  Median rather than mean so one long over-run rep does not lift a set of
 *  short ones over the kinetics floor. */
export function medianWorkDurationSec(phases: ScopePhase[]): number | null {
  const d = phases
    .filter(isWork)
    .map((p) => p.actual_duration_sec)
    .filter((s): s is number => s != null && Number.isFinite(s) && s > 0)
    .sort((a, b) => a - b);
  if (d.length === 0) return null;
  const mid = Math.floor(d.length / 2);
  return d.length % 2 === 1 ? d[mid] : Math.round((d[mid - 1] + d[mid]) / 2);
}

/** Plain-English name for the work, sized to how much of it there was. */
function workLabel(n: number): string {
  if (n === 1) return 'on the work';
  if (n === 2) return 'across both reps';
  return `across the ${n} reps`;
}

export interface ReadingScopeInput {
  phases: ScopePhase[];
  /** Whole-run stored average heart rate, bpm. */
  wholeHrBpm?: number | null;
  /** Whole-run stored average cadence, spm. */
  wholeCadenceSpm?: number | null;
  /** Server-computed work-only average HR (`RunDetail.hr_avg_work`), when it
   *  is already available. Preferred over re-deriving from phases so the two
   *  numbers can never disagree; falls back to the weighted mean here. */
  workHrBpm?: number | null;
  /** Same, for cadence (`RunDetail.cadence_avg_work`). */
  workCadenceSpm?: number | null;
  /** Whole-run average pace, seconds per mile. */
  wholePaceSPerMi?: number | null;
  /** Work-only average pace (`RunDetail.pace_work_s_per_mi`). */
  workPaceSPerMi?: number | null;
}

/**
 * Decide what this run is allowed to say about itself.
 *
 * Pure. No DB, no clock, no config. Every branch is reachable from a fixture,
 * which is the point — the rule is testable rather than remembered.
 */
export function deriveReadingScopes(input: ReadingScopeInput): ReadingScopes {
  const phases = Array.isArray(input.phases) ? input.phases : [];
  const work = phases.filter(isWork);
  const isRepSet = work.length >= REP_SET_MIN_WORK_PHASES;

  // NO STRUCTURE, NO PROBLEM. An easy run, a long run, a race, and every
  // pre-2026-06 Strava row land here. One intent end to end, so the whole-run
  // mean is exactly what it claims to be and nothing is scoped or withheld.
  if (work.length === 0) {
    return {
      hr: { scope: 'whole', value: input.wholeHrBpm ?? null, note: null },
      cadence: { scope: 'whole', value: input.wholeCadenceSpm ?? null, note: null },
      pace: { scope: 'whole', value: input.wholePaceSPerMi ?? null, note: null },
      splitsMeaningful: true,
      zoneBarMeaningful: true,
      isRepSet: false,
    };
  }

  const medianWork = medianWorkDurationSec(phases);

  // THE KINETICS FLOOR, AND THE ONE PLACE THIS FILE REFUSES RATHER THAN
  // SCOPES. Below two minutes a rep's heart rate is its own rise time. There is
  // no interval over which an HR average would be true, so there is no scope
  // that rescues it — the answer is that this session has no heart-rate reading
  // and saying so is more use than a number that means the lag.
  const hrBelowFloor = medianWork != null && medianWork < HR_REP_KINETICS_FLOOR_SEC;

  const hr: ScopedReading = hrBelowFloor
    ? {
        scope: 'none',
        value: null,
        note: 'Reps this short never reach their heart-rate band.',
      }
    : (() => {
        const v = input.workHrBpm ?? weightedMean(work, (p) => p.avg_hr);
        // No phase carried an HR. Refuse rather than fall back to the
        // whole-run figure — falling back is the bug, wearing a scope label.
        if (v == null) {
          return { scope: 'none' as const, value: null, note: null };
        }
        return { scope: 'work' as const, value: v, note: workLabel(work.length) };
      })();

  const cadence: ScopedReading = (() => {
    const v = input.workCadenceSpm ?? weightedMean(work, (p) => p.avg_cadence);
    if (v == null) return { scope: 'none' as const, value: null, note: null };
    return { scope: 'work' as const, value: v, note: workLabel(work.length) };
  })();

  // PACE FALLS BACK RATHER THAN REFUSING. If the work phases carried no pace
  // the whole-run figure is still a true statement about the run — it is only
  // its LABEL that would have been misleading, and an unlabelled fallback here
  // is correct because there is no work pace for it to be confused with.
  const pace: ScopedReading = (() => {
    const w = input.workPaceSPerMi;
    if (w != null && Number.isFinite(w) && w > 0) {
      return { scope: 'work' as const, value: Math.round(w), note: workLabel(work.length) };
    }
    return { scope: 'whole' as const, value: input.wholePaceSPerMi ?? null, note: null };
  })();

  return {
    hr,
    cadence,
    pace,
    splitsMeaningful: !isRepSet,
    zoneBarMeaningful: !isRepSet,
    isRepSet,
  };
}
