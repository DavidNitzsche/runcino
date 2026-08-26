/**
 * Progression levers and the challenge zone.
 *
 * Systems C of the three-model split, rules §2 (progression is not pace
 * progression) and §4 (the challenge zone) of
 * `Design/adaptive-progression-engine.md`.
 *
 * ## The defect this closes
 *
 * Before this module, every week-to-week change in a faff plan that was not a
 * volume change was a PACE change. Prescription text resolved once per
 * (distance category, phase, level) and repeated verbatim for every week of
 * that phase — no week index ever reached the rep or duration path — while
 * `blendedTPaceForWeek` walked the pace toward goal pace on the calendar. So
 * "progression" meant "run the same session faster because time passed", which
 * is both of the doctrine's first two violations at once.
 *
 * A coach does not progress an athlete that way. The canonical threshold
 * progression in the doctrine is:
 *
 *     W1  3 x 8 min  @ current threshold effort   (24 min)
 *     W2  3 x 10 min @ same effort                (30 min)
 *     W3  2 x 15 min @ same effort                (30 min, higher continuity)
 *     W4  recovery
 *     W5  3 x 10 min slightly faster
 *
 * Four weeks of real progression before the pace moves once. Volume rises,
 * then continuity rises at constant volume, and only then does pace change —
 * and only with evidence behind it.
 *
 * ## The two ideas
 *
 * **Levers.** Progression has eleven knobs, ordered cheapest-adaptation-first.
 * Pace sits ninth. The limiter says which family of levers to reach for; the
 * adaptation model says whether to reach at all; this module says which
 * specific knob and by how much.
 *
 * **Zones.** Every prescribed effort carries an intent. ESTABLISHED work
 * accumulates adaptation at a known-manageable stimulus. PROGRESSIVE work adds
 * slight overload. PROBE work reaches past demonstrated capability under
 * control, to generate evidence. A successful probe is not new fitness — it is
 * one observation. Repeated successful probes are what move the fitness model.
 *
 * ## Doctrine bounds
 *
 * Every cap here is Daniels via `Research/04-workout-vocabulary.md`, not
 * invention. Threshold volume caps at 10% of weekly mileage (`:187`), cruise
 * recovery runs one minute per mile of work (`:160`), VO2 reps run 3-5 min with
 * recovery roughly equal to the rep and total at-pace volume capped at 8%
 * (`:227`), and R-pace work caps at 5% (`:326`). The ladder may not step past
 * these no matter what the adaptation model says — a strong athlete earns a
 * bigger step, not an unbounded one.
 */

import type { AdaptationBand, AdaptationVerdict } from '@/lib/adaptation/adaptation-model';

/* ------------------------------------------------------------------ zones */

/**
 * The intent behind a prescribed effort. Doctrine §4.
 *
 * This is NOT a difficulty rating. It is a statement about what the session is
 * for, and it determines how the result should be read afterwards: an
 * ESTABLISHED session missing its target is a warning, whereas a PROBE missing
 * its target is the probe doing its job.
 */
export type ChallengeZone = 'ESTABLISHED' | 'PROGRESSIVE' | 'PROBE';

export const ZONE_PURPOSE: Record<ChallengeZone, string> = {
  ESTABLISHED: 'accumulate adaptation',
  PROGRESSIVE: 'create additional stimulus',
  PROBE: 'test readiness and gather evidence',
};

/* ----------------------------------------------------------------- levers */

export type ProgressionLever =
  | 'weekly_volume'
  | 'run_frequency'
  | 'long_run_duration'
  | 'quality_duration'
  | 'interval_duration'
  | 'rep_count'
  | 'recovery_duration'
  | 'work_density'
  | 'pace'
  | 'race_specificity'
  | 'goal_pace_exposure';

/**
 * Cheapest-adaptation-first. The ordering is the doctrine's, and the position
 * of `pace` is the whole point: eight levers are tried before the engine makes
 * the runner go faster, and two more sit after it.
 *
 * "Cheapest" means lowest injury and fatigue cost per unit of adaptation
 * gained, not easiest. More minutes at an effort the runner already holds is a
 * far safer way to add stimulus than the same minutes at a pace they have
 * never held.
 */
export const LEVER_ORDER: readonly ProgressionLever[] = [
  'quality_duration',
  'interval_duration',
  'rep_count',
  'long_run_duration',
  'weekly_volume',
  'run_frequency',
  'recovery_duration',
  'work_density',
  'pace',
  'race_specificity',
  'goal_pace_exposure',
] as const;

/* ------------------------------------------------------------- work shape */

/** The quality-session geometry the levers operate on. */
export interface WorkShape {
  /** Number of work repetitions. 1 means a continuous effort. */
  reps: number;
  /** Minutes per repetition. */
  repMinutes: number;
  /** Minutes of jog recovery between repetitions. 0 for continuous. */
  recoveryMinutes: number;
  /** Work pace, seconds per mile. */
  paceSPerMi: number;
  zone: ChallengeZone;
}

export function totalWorkMinutes(s: WorkShape): number {
  return s.reps * s.repMinutes;
}

/* -------------------------------------------------------------- doctrine */

/** Daniels' at-pace volume caps as a share of weekly mileage.
 *  `Research/04-workout-vocabulary.md:187` (T), `:227` (I), `:326` (R).
 *
 *  These bound ONE session, not the week. The doc states each of them in a
 *  workout's own field table — §5.3's cell reads "Total volume at pace | 4-8 mi
 *  (Daniels: cap T-pace at 10% of weekly mileage)", which is the volume of that
 *  cruise-interval session — so a week carrying a tempo and a cruise session
 *  does not halve either one. */
export const AT_PACE_WEEKLY_SHARE_CAP = {
  threshold: 0.10,
  interval: 0.08,
  repetition: 0.05,
} as const;

/**
 * The at-pace volume ONE session carries, in miles, straight out of the
 * doctrine's family-overview tables: §5.1 gives cruise intervals "4-8 mi" and
 * §6.1 gives mile repeats "3-6 mi".
 *
 * The share cap and this band answer different questions and BOTH bind. The
 * share cap asks what the runner's weekly volume can absorb — it is the number
 * that stops a 30 mi/wk runner being given a 5-mile tempo. This band asks what
 * the session IS: past eight miles at threshold the workout has stopped being
 * cruise intervals whoever is running it, and a 100 mi/wk runner is not owed a
 * ten-mile T session merely because ten is under their ten percent.
 *
 * `min` is not a floor. A small week buys a small session; doctrine's lower
 * bound describes the runner who can afford the whole dose, and flooring a 20
 * mi/wk runner at four threshold miles would be the share cap read backwards.
 *
 * ZONE-R-1 (2026-08-19) · the R row is read out of two documents, because
 * `Research/04` §7.1's family-overview table states rep COUNTS where §5.1 and
 * §6.1 state at-pace volumes, and no §7 table gives a family-wide mileage band.
 *
 *   · `max` · `Research/01` §"Dosing rules — Daniels' caps", R row, whose
 *     single-workout cell is two caps sharing a sentence: "5% of weekly mi
 *     (max 8K cumulative)". The percentage half is already
 *     `AT_PACE_WEEKLY_SHARE_CAP.repetition`; the absolute half is this, and
 *     8 km is 4.97 mi.
 *   · `min` · `Research/04` §7.4's own "Total | 1.6–2.4 K at R", which is
 *     0.99 mi. `min` is the reference `warmupCooldownMi` scales the easy legs
 *     against, and §7.4 is the section that states BOTH numbers — its at-pace
 *     total and the warm-up quoted beside it — so reading one without the other
 *     is what would make this a borrowed value rather than a read one.
 *
 * Bound by `DOSING.repetition-session-band`.
 */
export const AT_PACE_SESSION_MI = {
  threshold: { min: 4, max: 8 },
  interval: { min: 3, max: 6 },
  repetition: { min: 0.99, max: 4.97 },
} as const;

/** The at-pace mileage one session of `family` may carry on a `weeklyMi` week:
 *  the share cap and the session band, whichever binds first. */
export function atPaceSessionCapMi(
  weeklyMi: number,
  family: keyof typeof AT_PACE_SESSION_MI,
): number {
  return Math.min(weeklyMi * AT_PACE_WEEKLY_SHARE_CAP[family], AT_PACE_SESSION_MI[family].max);
}

/** VO2 repetitions run 3-5 minutes. `Research/04-workout-vocabulary.md:227`. */
export const INTERVAL_REP_MINUTES = { min: 3, max: 5 } as const;

/**
 * SLOT-ROTATE-3 (2026-08-19) · A VO2max SESSION IS A REP SET, AND NEVER ONE BLOCK.
 *
 * `Research/04-workout-vocabulary.md` §6.1's "VO2max family overview" gives
 * every §6 workout a rep-count band, and the smallest lower bound in the whole
 * column is three — mile repeats "3–6 × 1 mi", 1200s "4–6", 1000s "5–8", 800s
 * "6–10", 600s "8–12", 400s "8–16", Yasso "4–10". §6's own lead states why:
 * "each interval should be 3–5 min long", which is a description of
 * INTERMITTENT work. There is no continuous form of a VO2max session in the
 * document.
 *
 * The engine has enforced the DURATION half since the progression engine landed
 * and never the COUNT half, and `work_density` — "fewer, longer reps at
 * constant total volume" — is the lever that walks straight through the gap. It
 * guards `CONTINUOUS_TEMPO_MINUTES.max` when a THRESHOLD set collapses to one
 * block, because a continuous tempo is a real §5.2 session; the interval arm
 * had no equivalent guard, because a continuous VO2max block is not a session
 * at all. Applied twice it took a 3×7 min rep set to 1×21, and a third time to
 * 1×24 — a single twenty-four-minute block labelled as intervals.
 *
 * It was latent rather than harmless: the ladder only stepped on weeks the
 * generic string was prescribed, which on a marathon build was four or five,
 * and it ran out of weeks before it ran out of reps. SLOT-ROTATE-2 steps the
 * dose ladder every week — that is what keeps a rotating vocabulary climbing —
 * and surfaced it immediately.
 *
 * Bound by `PROGRESSION.interval-rep-count-floor`.
 */
export const INTERVAL_MIN_REPS = 3;

/**
 * ZONE-R-1 · an R repetition is 200-600 m and never longer than two minutes.
 *
 * `Research/01-pace-zones-vdot.md` §"Dosing rules — Daniels' caps", R row,
 * "Rep length range" column: "200–600m, ≤2 min".
 *
 * Both halves are load-bearing and they are stated in different units on
 * purpose. The METRES are what `clampToAtPaceMinutes` floors on — an R rep
 * shortened below two hundred metres has stopped being the workout — and the
 * two MINUTES is what caps the duration lever, which without it would walk an R
 * set toward the continuous-tempo ceiling and call the result speed work.
 *
 * Bound by `PROGRESSION.repetition-rep-window`.
 */
export const REPETITION_REP_METRES = { min: 200, max: 600 } as const;
export const REPETITION_REP_MINUTES_MAX = 2;

/**
 * The shortest a rep of `family` may be cut to, in minutes, at a given work
 * pace. Doctrine states the T/I floor in minutes and the R floor in metres, so
 * the R arm converts at the session's own pace rather than carrying a second
 * number that would drift from the first.
 */
export function minRepMinutes(
  family: keyof typeof AT_PACE_WEEKLY_SHARE_CAP,
  paceSPerMi: number,
): number {
  if (family !== 'repetition') return INTERVAL_REP_MINUTES.min;
  const mi = REPETITION_REP_METRES.min / 1609.344;
  return paceSPerMi > 0 ? (mi * paceSPerMi) / 60 : INTERVAL_REP_MINUTES.min;
}

/** Continuous tempo runs 20-40 minutes. `Research/04-workout-vocabulary.md:159`. */
export const CONTINUOUS_TEMPO_MINUTES = { min: 20, max: 40 } as const;

/** Cruise recovery is one minute per mile of work.
 *  `Research/04-workout-vocabulary.md:160`. */
export const CRUISE_RECOVERY_MIN_PER_WORK_MI = 1;

/**
 * The single pace step, seconds per mile, when the pace lever is finally
 * pulled. Deliberately small: this is "slightly faster" in the doctrine's
 * threshold progression, not a re-anchor. The re-anchor path is the fitness
 * model's job and runs on race evidence.
 */
export const PACE_STEP_S_PER_MI = 5;

/**
 * How much faster a probe's terminal repetition runs. Larger than a pace step
 * because a probe is deliberately reaching past demonstrated capability — but
 * bounded, because an uncontrolled probe generates no usable evidence.
 */
export const PROBE_STEP_S_PER_MI = 12;

/* ------------------------------------------------------- lever selection */

export interface LeverSelection {
  lever: ProgressionLever;
  /** Why this lever and not the next one down the ladder. */
  rationale: string;
  /** Levers deliberately skipped, and why — so the choice is auditable. */
  skipped: Array<{ lever: ProgressionLever; reason: string }>;
}

/**
 * Levers that act on the WEEK rather than on one session's geometry.
 *
 * `advanceShape` returns the shape untouched for these — mileage, frequency,
 * long-run length and race specificity are the volume curve's and the
 * periodiser's to move, not a rep set's. A caller walking a single session's
 * shape passes them as `unavailable` so the selector spends its cycle on a
 * lever that can actually change the prescription, rather than reporting a
 * change that never happened.
 */
export const WEEK_LEVEL_LEVERS: readonly ProgressionLever[] = [
  'weekly_volume',
  'run_frequency',
  'long_run_duration',
  'race_specificity',
  'goal_pace_exposure',
] as const;

/** What the limiter diagnosis says to reach for. Doctrine §11. */
export const LIMITER_LEVERS: Record<string, readonly ProgressionLever[]> = {
  threshold: ['quality_duration', 'work_density', 'pace'],
  endurance: ['long_run_duration', 'weekly_volume', 'quality_duration', 'race_specificity'],
  speed_reserve: ['interval_duration', 'rep_count', 'pace'],
  training_volume: ['run_frequency', 'weekly_volume', 'long_run_duration'],
  aerobic_capacity: ['interval_duration', 'rep_count', 'work_density'],
  durability: ['long_run_duration', 'race_specificity', 'goal_pace_exposure'],
  recovery_capacity: ['recovery_duration', 'run_frequency'],
};

/**
 * Choose the ONE lever to advance this cycle.
 *
 * Doctrine §12: "Only change one or a small number of major variables at once.
 * Do not turn strong adaptation into simultaneous more mileage, faster
 * threshold, longer long run and more intervals. The point is productive
 * overload, not maximal overload."
 *
 * Returns null when nothing should advance — the caller holds the current
 * stimulus rather than substituting a different lever.
 */
export function selectLever(args: {
  /** From `diagnoseLimiter`. Null falls back to the generic ladder. */
  limiter: string | null;
  adaptation: AdaptationVerdict;
  /** Levers pulled in recent cycles, newest last. Prevents pulling the same
   *  knob forever once it has run out of cheap room. */
  recentLevers: ProgressionLever[];
  /** Levers currently at their doctrine cap and therefore unavailable. */
  exhausted: ProgressionLever[];
  /**
   * A ladder to walk ahead of the generic one when no limiter has been
   * diagnosed. The limiter is the RUNNER's constraint and outranks this; this
   * is for callers that know something narrower — a threshold session's own
   * energy system, say — without claiming to know why the runner is slow.
   * Ignored when `limiter` resolves to a known ladder.
   */
  preferred?: readonly ProgressionLever[];
  /** The one-line reason `preferred` is the right ladder. Surfaces in
   *  `rationale`, so it must read as a true statement on its own. */
  preferredReason?: string;
  /**
   * Levers this caller cannot pull at all — not capped, out of scope. A
   * session-shape walker passes `WEEK_LEVEL_LEVERS`: those knobs are real and
   * are moved elsewhere in the engine, so calling them "exhausted" would put a
   * false line in the audit trail.
   */
  unavailable?: readonly ProgressionLever[];
}): LeverSelection | null {
  const { limiter, adaptation, recentLevers, exhausted } = args;
  const unavailable = args.unavailable ?? [];

  if (adaptation.stepMultiplier <= 0) return null;

  const skipped: LeverSelection['skipped'] = [];
  const diagnosed = limiter ? LIMITER_LEVERS[limiter] : undefined;
  const preferred = diagnosed ?? args.preferred ?? LEVER_ORDER;

  // Walk the preferred ladder, then the generic one, taking the first lever
  // that is neither exhausted nor freshly pulled.
  const candidates = [...preferred, ...LEVER_ORDER.filter((l) => !preferred.includes(l))]
    .filter((l) => !unavailable.includes(l));

  for (const lever of candidates) {
    if (exhausted.includes(lever)) {
      skipped.push({ lever, reason: 'at its doctrine cap' });
      continue;
    }
    // Pace is gated hard: it is never the answer while a cheaper lever has
    // room, and never on anything short of a full planned step.
    if (lever === 'pace') {
      const cheaperAvailable = candidates
        .slice(0, candidates.indexOf('pace'))
        .some((l) => !exhausted.includes(l));
      if (cheaperAvailable) {
        skipped.push({ lever, reason: 'cheaper levers still have room' });
        continue;
      }
      if (adaptation.band !== 'strong') {
        skipped.push({ lever, reason: 'pace needs strong adaptation behind it' });
        continue;
      }
    }
    // Do not pull the same lever two cycles running unless nothing else is
    // available — alternating levers is how a block stays balanced.
    if (recentLevers[recentLevers.length - 1] === lever) {
      const alternative = candidates.find(
        (l) => l !== lever && !exhausted.includes(l) && !(l === 'pace' && adaptation.band !== 'strong'),
      );
      if (alternative) {
        skipped.push({ lever, reason: 'pulled last cycle' });
        continue;
      }
    }
    return {
      lever,
      rationale: diagnosed
        ? `${limiter!.replace(/_/g, ' ')} is the limiter, and this is the cheapest lever it responds to that still has room`
        : args.preferred && args.preferredReason
          ? `${args.preferredReason} — and this is the cheapest lever on it that still has room`
          : 'cheapest lever with room on the generic ladder',
      skipped,
    };
  }

  return null;
}

/* ----------------------------------------------------------- lever action */

export interface AdvanceResult {
  shape: WorkShape;
  /** What actually changed, in one line. */
  change: string;
  /** True when the lever hit its doctrine cap and could not move. */
  capped: boolean;
}

/**
 * Apply one lever to a work shape.
 *
 * `stepMultiplier` comes from the adaptation model: 1.0 takes the planned
 * step, 1.25 lets a strongly-adapting runner take a slightly bigger one. Caps
 * are absolute — a strong athlete earns a bigger step, never an unbounded one.
 */
export function advanceShape(args: {
  shape: WorkShape;
  lever: ProgressionLever;
  stepMultiplier: number;
  /** Weekly mileage, for the at-pace volume caps. */
  weeklyMi: number;
  /** Which cap family this session falls under. */
  family: keyof typeof AT_PACE_WEEKLY_SHARE_CAP;
}): AdvanceResult {
  const { shape, lever, stepMultiplier, weeklyMi, family } = args;
  const next: WorkShape = { ...shape };
  const step = Math.max(1, Math.round(2 * stepMultiplier));

  // The volume ceiling in minutes, from the mileage cap and the work pace.
  // Both doctrine bounds apply: the share of the week the runner can absorb,
  // and the session band that says what the workout is. Without the second, the
  // ladder walks a high-mileage runner to a twelve-mile "cruise interval"
  // session — inside their ten percent, and four miles past anything §5.1
  // describes.
  // ZONE-R-1 · repetition used to bypass the session band because there was no
  // R row in `AT_PACE_SESSION_MI` to consult. There is now — `Research/01`'s R
  // cell states both halves — so all three families read the same expression.
  const capMi = atPaceSessionCapMi(weeklyMi, family);
  const capMinutes = (capMi * shape.paceSPerMi) / 60;

  switch (lever) {
    case 'quality_duration':
    case 'interval_duration': {
      // The continuous-tempo ceiling binds on the DURATION lever as well as on
      // the density lever. Once the density lever has collapsed a rep set to a
      // single block, "lengthen the rep" and "lengthen the tempo" are the same
      // instruction, and `Research/04-workout-vocabulary.md` §5.1 stops a
      // continuous tempo at 40 minutes either way. Without this the ladder
      // walks 1x30 to 1x50 under the volume cap alone and calls it a tempo.
      // ZONE-R-1 · and `Research/01`'s R row stops a repetition at two minutes
      // either way. Without this arm the R family would fall through to the
      // threshold reading below — `Infinity` while the set has more than one
      // rep — and the duration lever would walk 8×200 m toward 8×2 mi under the
      // volume cap alone, which is a threshold session wearing R's label.
      const maxRep = family === 'interval'
        ? INTERVAL_REP_MINUTES.max
        : family === 'repetition'
        ? REPETITION_REP_MINUTES_MAX
        : (shape.reps <= 1 ? CONTINUOUS_TEMPO_MINUTES.max : Infinity);
      const wanted = Math.min(shape.repMinutes + step, maxRep);
      if (wanted <= shape.repMinutes || wanted * shape.reps > capMinutes) {
        return { shape, change: 'rep duration is at its cap', capped: true };
      }
      next.repMinutes = wanted;
      // Cruise recovery tracks work length: one minute per mile of work.
      if (next.reps > 1 && family === 'threshold') {
        next.recoveryMinutes = Math.max(
          1,
          Math.round((next.repMinutes * 60) / next.paceSPerMi) * CRUISE_RECOVERY_MIN_PER_WORK_MI,
        );
      }
      return {
        shape: next,
        change: `${shape.reps} x ${shape.repMinutes} min becomes ${next.reps} x ${next.repMinutes} min at the same effort`,
        capped: false,
      };
    }

    case 'rep_count': {
      const wanted = shape.reps + 1;
      if (wanted * shape.repMinutes > capMinutes) {
        return { shape, change: 'rep count is at its volume cap', capped: true };
      }
      next.reps = wanted;
      return {
        shape: next,
        change: `${shape.reps} reps becomes ${next.reps} at the same effort`,
        capped: false,
      };
    }

    case 'work_density': {
      // Fewer, longer reps at constant total volume — the W2 to W3 step in the
      // doctrine's canonical progression. Continuity rises, total does not.
      if (shape.reps <= 1) {
        return { shape, change: 'already continuous', capped: true };
      }
      // SLOT-ROTATE-3 · §6.1's rep-count bands bottom out at three, and §6 has
      // no continuous form. Merging reps past that floor is not a denser
      // version of the session; it is a different session with the wrong label.
      if (family === 'interval' && shape.reps - 1 < INTERVAL_MIN_REPS) {
        return { shape, change: 'a VO2max session is a rep set — §6.1 bottoms out at three reps', capped: true };
      }
      const total = totalWorkMinutes(shape);
      next.reps = shape.reps - 1;
      next.repMinutes = Math.round(total / next.reps);
      if (family === 'threshold' && next.reps === 1 && next.repMinutes > CONTINUOUS_TEMPO_MINUTES.max) {
        return { shape, change: 'continuous tempo would exceed 40 minutes', capped: true };
      }
      // REP-LENGTH-CEILING-1 (2026-08-25) · THE OTHER HALF OF SLOT-ROTATE-3.
      //
      // SLOT-ROTATE-3 stopped this lever merging a VO2max set below §6.1's
      // three-rep floor, and left the rep LENGTH unbounded. So the runaway
      // simply changed direction: with the count pinned at three, every further
      // application poured the whole set into longer and longer repetitions,
      // and a marathon's race-specific weeks shipped `3×7 min` and then
      // `3×10 min @ I`. `Research/04-workout-vocabulary.md` §6's own lead is
      // "each interval should be 3–5 min long" and `Research/01`'s I row states
      // the window as "3–5 min (max 11 min)"; `Research/00a` says why — "Long
      // intervals (3–5 min) accrue more time at >90% VO2max than short,
      // intensified intervals", which stops being true once the repetition is
      // long enough that the runner is holding it at threshold instead.
      //
      // The `duration` lever above has guarded this since it was written
      // (`maxRep = INTERVAL_REP_MINUTES.max`, and `REPETITION_REP_MINUTES_MAX`
      // for R). Density and duration are two routes to the same number and
      // only one of them was fenced. This is the same fence, on the other route.
      const maxMergedRep = family === 'interval'
        ? INTERVAL_REP_MINUTES.max
        : family === 'repetition'
        ? REPETITION_REP_MINUTES_MAX
        : Infinity;
      if (next.repMinutes > maxMergedRep) {
        return {
          shape,
          change: family === 'interval'
            ? '§6 puts a VO2max repetition at 3-5 minutes; merging would run past it'
            : 'an R repetition stops at two minutes; merging would run past it',
          capped: true,
        };
      }
      return {
        shape: next,
        change: `${shape.reps} x ${shape.repMinutes} min becomes ${next.reps} x ${next.repMinutes} min — same volume, less rest`,
        capped: false,
      };
    }

    case 'recovery_duration': {
      // ZONE-R-1 · doctrine forbids this lever on R work in as many words.
      // `Research/04` §7.4's contraindication row reads "Cap at 5% weekly
      // mileage; don't shorten the rest", and §7.1's family table gives every R
      // session a FULL recovery ("Full walk/jog", "200m jog (full recovery)").
      // Tightening it turns speed work into an anaerobic session, which is a
      // different workout with a different cost.
      if (family === 'repetition') {
        return { shape, change: 'doctrine does not shorten the rest on R work', capped: true };
      }
      const wanted = Math.max(1, shape.recoveryMinutes - 1);
      if (wanted >= shape.recoveryMinutes) {
        return { shape, change: 'recovery is already minimal', capped: true };
      }
      next.recoveryMinutes = wanted;
      return {
        shape: next,
        change: `recovery tightens to ${wanted} min between reps`,
        capped: false,
      };
    }

    case 'pace': {
      next.paceSPerMi = shape.paceSPerMi - PACE_STEP_S_PER_MI;
      return {
        shape: next,
        change: `work pace moves ${PACE_STEP_S_PER_MI} s/mi faster`,
        capped: false,
      };
    }

    default:
      // Volume, frequency, long-run and specificity levers act on the week,
      // not on one session's geometry. The caller owns those.
      return { shape, change: `${lever} is a week-level lever`, capped: false };
  }
}

/* ------------------------------------------------------------------ zones */

/**
 * Assign the intent of a session.
 *
 * A probe is only offered when the runner has earned it: strong adaptation,
 * and the pace lever has actually come up as the selected lever. Probing on
 * marginal adaptation produces a failed session and no usable evidence, which
 * is the worst of both.
 */
export function assignZone(args: {
  adaptation: AdaptationBand;
  lever: ProgressionLever | null;
  /** Cycles since the last probe. Probes are occasional by design. */
  cyclesSinceProbe: number;
  /** Minimum spacing between probes. */
  probeSpacing?: number;
}): ChallengeZone {
  const { adaptation, lever, cyclesSinceProbe, probeSpacing = 3 } = args;

  if (adaptation === 'poor' || adaptation === 'marginal') return 'ESTABLISHED';
  if (lever == null) return 'ESTABLISHED';

  if (adaptation === 'strong' && lever === 'pace' && cyclesSinceProbe >= probeSpacing) {
    return 'PROBE';
  }
  return 'PROGRESSIVE';
}

/**
 * Shape a probe: the early repetitions sit at established effort, the terminal
 * repetition reaches. "Rep 1-2 at 7:05-7:10, final rep at 6:55-7:00 if
 * controlled" — the conditional is load-bearing. A probe the runner has to
 * fight for is a failed probe, and the prescription says so out loud.
 */
export function probeShape(base: WorkShape): {
  shape: WorkShape;
  terminalPaceSPerMi: number;
  instruction: string;
} {
  const terminal = base.paceSPerMi - PROBE_STEP_S_PER_MI;
  return {
    shape: { ...base, zone: 'PROBE' },
    terminalPaceSPerMi: terminal,
    instruction:
      'Hold the first reps at the usual effort. Take the last one faster only if it stays controlled. ' +
      'If it turns into a fight, back off and finish at the earlier pace — that is a complete session, not a failed one.',
  };
}

/* -------------------------------------------------------- probe evidence */

/**
 * What a completed probe contributes.
 *
 * Doctrine §4: "A successful probe does not immediately become new
 * demonstrated fitness. Repeated successful evidence can move the Fitness
 * Model." So a probe emits an observation with a weight, and the fitness model
 * decides — it never writes fitness itself.
 */
export interface ProbeObservation {
  dateISO: string;
  /** The pace actually held on the terminal repetition. */
  achievedPaceSPerMi: number;
  /** The pace the probe reached for. */
  targetPaceSPerMi: number;
  /** Held at an appropriate internal cost — HR and RPE within band. */
  controlled: boolean;
  succeeded: boolean;
}

/** Successful, controlled probes needed before the fitness model may move on
 *  probe evidence alone. One good session is one observation. */
export const PROBES_FOR_FITNESS_EVIDENCE = 3;

/**
 * Whether accumulated probes amount to fitness evidence. Deliberately strict:
 * probes must be recent, controlled, and repeated. This never moves fitness on
 * its own — it reports that the fitness model now has grounds to look.
 */
export function probesSupportFitnessMove(probes: ProbeObservation[]): {
  supported: boolean;
  reason: string;
} {
  const good = probes.filter((p) => p.succeeded && p.controlled);
  if (good.length < PROBES_FOR_FITNESS_EVIDENCE) {
    return {
      supported: false,
      reason: `${good.length} of ${PROBES_FOR_FITNESS_EVIDENCE} controlled probes — not yet a pattern`,
    };
  }
  return {
    supported: true,
    reason: `${good.length} controlled probes at the reached pace — repeated evidence, not one good day`,
  };
}
