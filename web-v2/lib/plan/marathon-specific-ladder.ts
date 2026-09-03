/**
 * lib/plan/marathon-specific-ladder.ts · S1.1 · THE MARATHON-SPECIFIC LADDER.
 *
 * ONE owner for "which weeks of this block carry marathon-effort work, how
 * much, in what, and why". Before this file the answer was spread across three
 * mechanisms that did not know about each other:
 *
 *   · `longFinishSegment`'s QUALITY warm-in ramp (0.30 / 0.33 / 0.33 of the long
 *     in the last three QUALITY weeks),
 *   · `longFinishSegment`'s RACE-SPECIFIC arm (0.50 of the long, on the
 *     `racePaceLongThisWeek` cadence),
 *   · `taperMpDose` (§9.2's two fixed taper sessions).
 *
 * ── WHAT THAT PRODUCED, MEASURED ────────────────────────────────────────────
 *
 * The owner's own CIM block, composed at the 2026-08-30 authoring instant:
 *
 *   49 days out    4 mi @ MP    inside a 19 mi long
 *   35 days out   11 mi @ MP    inside a 20.5 mi long
 *   19 days out   11 mi @ MP    a standalone 15 mi tempo   ← taper
 *   12 days out    7 mi @ MP    a standalone 10 mi tempo   ← taper
 *
 * 33 marathon-pace miles, 18 of them (55%) in the last three weeks, and the
 * whole of `Research/04` §4.4's own window — "6-10 weeks out from goal
 * marathon", where doctrine asks 10-14 mi at MP every 2-3 weeks — served by
 * FOUR miles in one session. The first marathon-effort running of the block
 * happened seven weeks out and the step from it to the next session was 4 to 11.
 *
 * Three defects, one cause: nothing owned the SEQUENCE.
 *
 *   1 · The warm-in ramp is structurally unreachable. Its arms are keyed to
 *       `weeksToPhaseEnd` 0/1/2, but it is ALSO gated on the cadence walk, which
 *       anchors on the phase's last week and steps back by 2-3. Arms 0 and 1 are
 *       therefore mutually exclusive by construction, and on this block the walk
 *       landed on 0 and then 3 — so exactly ONE of three fired and the "ramp"
 *       was a single point (Rule 15: a mechanism the corpus cannot reach).
 *   2 · Nothing connected a session to the one before it, so a 4-mile dose could
 *       be followed by an 11-mile dose with nothing earning it.
 *   3 · Nothing connected the last rehearsal to race day at all.
 *
 * ── WHOSE SHAPE THIS IS ─────────────────────────────────────────────────────
 *
 * The owner's rulings of 2026-09-02 and 2026-09-03. Every placement rule and
 * every dose band below is one of his sentences, and the citation is on the
 * constant:
 *
 *   "Approximately four meaningful marathon-specific sessions before race week,
 *    roughly 2-3 weeks between the largest demands where the calendar allows."
 *
 *   "For this runner, embedding marathon effort inside long runs is generally
 *    more valuable than adding large standalone marathon-pace tempos. It
 *    develops the identified weakness: sustaining useful effort after
 *    accumulating time on feet."
 *
 *   "Do not target a total MP mileage number. The progression and timing matter
 *    more than reaching 33 or 38.5."
 *
 * So this file returns PLACEMENTS and DOSES, never a total, and a rung's vehicle
 * is the week's long run unless a ruling puts it elsewhere.
 *
 * ── WHAT THIS FILE MAY NOT DO ───────────────────────────────────────────────
 *
 * It does not size long runs, it does not choose paces
 * (`lib/training/marathon-pace-contract.ts` owns those), it does not read the
 * goal, it does not read the database, and it knows nothing about what the
 * runner has recently run. It is a pure function of the block's own calendar,
 * so the same calendar always produces the same ladder
 * (`docs/PLAN_SIMPLIFICATION_DOCTRINE.md`: "Given the same meaningful inputs,
 * the generator should produce the same plan").
 */
import { MARATHON_EFFORT_LADDER_T, type MarathonRehearsalKind } from '@/lib/training/marathon-pace-contract';

/**
 * `Research/04` §4.4 · "Frequency | Every 2–3 weeks during marathon specific
 * phase". The same two numbers `MP_LONG_CADENCE_WEEKS` has always carried;
 * `generate.ts` re-exports that name from here so there is ONE definition
 * (Rule 16).
 */
export const MP_LADDER_MIN_GAP_WEEKS = 2;
export const MP_LADDER_MAX_GAP_WEEKS = 3;

/**
 * `Research/04` §4.4 · "When in cycle | 6–10 weeks out from goal marathon", in
 * DAYS from the session to race day. It governs §4.4's OWN dose (the 10-14 mi
 * marathon-pace long). A smaller marathon-effort touch is §4.5's row ("final
 * 2-6 mi at MP"), which `Research/22`'s marathon rows list among the BUILD
 * phase's key workout types ("LR with M segments"), so it is not bound by it.
 */
export const MP_LONG_WINDOW_DAYS: readonly [number, number] = [42, 70];

/** `Research/04` §4.5 · "final 2-6 mi at MP or slightly faster". */
export const MP_FAST_FINISH_MAX_MI = 6;

/**
 * The window the block's largest marathon-specific demand sits in, in days.
 *
 * The owner: "4-5 weeks out: a major stimulus — either the Run Malibu half OR a
 * 19-21 mi run with ~8-10 marathon-effort miles." Widened to 24-42 days so a
 * calendar whose deloads fall awkwardly still has somewhere to put it; the
 * preferred 28-35 is inside it.
 */
export const MP_PEAK_STIMULUS_WINDOW_DAYS: readonly [number, number] = [24, 42];

/**
 * The taper's sharpening window, in days.
 *
 * `PROGRESSIVE_BASELINE_DOCTRINE.md` Q18: "the final major long or
 * marathon-specific rehearsal happens ~3 weeks out; after that the purpose is
 * shedding fatigue while preserving rhythm. The two-weeks-out run may carry a
 * small controlled marathon-effort component if earlier development supports
 * it, but must not function as another peak workout." The lower edge keeps it
 * out of race week, whose session is `Research/08` §9.2's 5K-pace primer.
 */
export const MP_SHARPEN_WINDOW_DAYS: readonly [number, number] = [10, 17];

/** The earliest a marathon-effort touch is worth authoring, in days. */
export const MP_LADDER_FIRST_DAYS = 84;

/**
 * How much larger one rung's dose may be than the largest already authored.
 *
 * NOT a free parameter: it is the width of `Research/04` §4.4's own dose band
 * ("Common dose | 14–18 mi total with 10–14 mi at MP" → 4 miles), the span
 * doctrine itself treats as one session's worth of variation.
 *
 * It exists because of the owner's ruling on the 11-mile block 19 days out:
 * "not automatically excessive, but inappropriate if earlier progression has
 * not earned it." With adaptation disabled there is no execution to consult, so
 * "earned" is answered from what the BLOCK ITSELF has already authored, which
 * is the only honest reading available at authoring time.
 */
export const MP_EARNED_STEP_MI = 4;

/**
 * A long run carrying at least this many marathon-effort miles IS a quality
 * session. `PROGRESSIVE_BASELINE_DOCTRINE.md` Q14: "When a long run carries
 * ≥~6 meaningful marathon-effort miles, it IS a quality session — schedule only
 * one additional midweek quality workout."
 */
export const MP_LONG_COUNTS_AS_QUALITY_MI = 6;

/** What a rung is FOR. Each maps to one row of the owner's stated sequence. */
export type MarathonSpecificRole =
  | 'introduction'
  | 'development'
  | 'peak_stimulus'
  | 'consolidation'
  | 'sharpening';

/** Where the marathon-effort miles live. */
export type MarathonSpecificVehicle = 'long_run' | 'tune_up_race' | 'easy_run_touch';

/**
 * Dose bands per role, in miles at marathon effort. Each is the owner's stated
 * figure, and each sits inside the doctrine row named beside it.
 */
export const MP_ROLE_DOSE_MI: Record<MarathonSpecificRole, readonly [number, number]> = {
  /** "8-9 weeks out: ~4-5 mi at current marathon effort" · Research/04 §4.5. */
  introduction: [4, 5],
  /** "6-7 weeks out: ~6-8 marathon-effort miles" · Research/04 §4.4's session. */
  development: [6, 8],
  /** "~8-10 marathon-effort miles" when no tune-up race takes this rung. */
  peak_stimulus: [8, 10],
  /**
   * Q16 · the week after the tune-up race: "~3 miles at currently supported
   * marathon effort, embedded in an otherwise easy run". A touch, not a session.
   */
  consolidation: [3, 3],
  /** Q18 · "a small controlled marathon-effort component… not another peak workout." */
  sharpening: [3, 4],
};

/** Why a rung exists, in the runner's own terms. Persisted per session. */
export interface MarathonSpecificRationale {
  purpose: string;
  whyThisWeek: string;
  supportedBy: string;
  prepares: string;
  rehearses: MarathonRehearsalKind;
}

export interface MarathonSpecificRung {
  weekIdx: number;
  /** ISO date of the session — the week's long-run day, or the race day. */
  dateISO: string;
  daysToRace: number;
  role: MarathonSpecificRole;
  vehicle: MarathonSpecificVehicle;
  /** Miles at marathon effort. Zero for a tune-up race, which is raced. */
  mpMi: number;
  /**
   * Where this rung sits on Q8's pace ladder: 0 = today's supported effort,
   * 1 = the fast edge of the runner's own published band.
   * `marathon-pace-contract.ts` turns it into seconds.
   */
  ladderT: number;
  /** Q14 · does this session make the week's long run a quality day? */
  countsAsQuality: boolean;
  rationale: MarathonSpecificRationale;
}

export interface MarathonSpecificLadder {
  rungs: readonly MarathonSpecificRung[];
  byWeek: ReadonlyMap<number, MarathonSpecificRung>;
  /**
   * Weeks the walk wanted but could not use, with the reason. Rule 11: a ladder
   * with three rungs because the calendar allowed three, and one with three
   * because a bug ate two, are different facts — this is what tells them apart,
   * and it is persisted rather than logged.
   */
  skipped: readonly { weekIdx: number; reason: string }[];
  /** The largest marathon-effort dose the block authors. Never a target. */
  largestDoseMi: number;
}

export interface MarathonSpecificLadderInput {
  totalWeeks: number;
  /** ISO date of each week's long run, index-aligned to the week. */
  longRunISOByWeek: readonly string[];
  raceDateISO: string;
  /** True for a week the volume curve authored as a deload. */
  isDeloadWeek: (weekIdx: number) => boolean;
  /** True when the week's long-run slot is occupied by a tune-up race. */
  isTuneUpRaceWeek: (weekIdx: number) => boolean;
  /**
   * True when the week's long run is the second half of a designed
   * race-plus-long-run weekend. The owner's Q6 ruling makes that Sunday easy,
   * with no marathon-pace or progression finish.
   */
  isDesignedWeekendLong: (weekIdx: number) => boolean;
  /**
   * True when the week sits inside a tune-up race's post-race no-quality window
   * (`Research/00b` §"Recovery by Distance"). The composer strips quality there
   * independently; a rung it plans knowing it will be removed is exactly the
   * "wired, tested and inert" failure this codebase keeps shipping.
   *
   * Q16's post-race TOUCH is deliberately exempt: the owner authored that one
   * session into that week by name, and it is an easy run with three miles at
   * an already-supported effort, not a quality workout.
   */
  isInsidePostRaceWindow: (weekIdx: number) => boolean;
  /**
   * The tune-up race the ladder treats as its peak stimulus, when one exists.
   * The owner: Run Malibu "stays as a B race and major checkpoint… It replaces
   * a major quality session and the long run that week." Null when none.
   */
  peakStimulusRaceWeekIdx: number | null;
}

const DAY_MS = 86_400_000;
function daysBetweenISO(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);
}

/**
 * Resolve the block's marathon-specific ladder.
 *
 * Deterministic and total: the same calendar always produces the same ladder,
 * and an impossible calendar produces an empty one with stated reasons rather
 * than an exception.
 *
 * The construction is deliberately EXPLICIT rather than one generic walk. Each
 * of the four steps is one of the owner's rulings, so a reader can check the
 * code against the ruling line by line, and a future change to one ruling
 * touches one step.
 */
export function resolveMarathonSpecificLadder(
  input: MarathonSpecificLadderInput,
): MarathonSpecificLadder {
  const skipped: { weekIdx: number; reason: string }[] = [];
  const raceWeekIdx = input.totalWeeks - 1;
  const note = (weekIdx: number, reason: string) => { skipped.push({ weekIdx, reason }); };

  const daysOut = (wi: number): number | null => {
    const iso = input.longRunISOByWeek[wi];
    return iso ? daysBetweenISO(iso, input.raceDateISO) : null;
  };

  /** Why this week cannot carry a LONG-RUN rung, or null when it can. */
  const blockedBecause = (wi: number): string | null => {
    if (wi < 0 || wi >= raceWeekIdx) return 'race week or outside the block · Research/08 §9.2 runs a 5K-pace primer in race week';
    const d = daysOut(wi);
    if (d == null) return 'no long-run date for this week';
    if (d > MP_LADDER_FIRST_DAYS) return `${d} days out · earlier than marathon-specific work is worth authoring`;
    if (input.isTuneUpRaceWeek(wi)) return 'the long-run slot is a tune-up race, so there is no long run to carry the session';
    if (input.isDeloadWeek(wi)) return 'planned cutback week · Research/04 §4.4 keeps the session off a deload';
    if (input.isDesignedWeekendLong(wi)) return 'the long run is the second half of a designed race weekend and stays easy';
    if (input.isInsidePostRaceWindow(wi)) return 'inside a tune-up race’s post-race no-quality window · Research/00b';
    return null;
  };

  const rungs: MarathonSpecificRung[] = [];
  const claimed = new Set<number>();

  // ── STEP A · the peak stimulus ────────────────────────────────────────────
  // "4-5 weeks out: a major stimulus — either the Run Malibu half OR a 19-21 mi
  // run with ~8-10 marathon-effort miles." A tune-up race takes the rung when
  // the calendar has one; otherwise the ladder authors the long run version.
  let peakWeekIdx: number | null = null;
  let peakIsRace = false;
  if (input.peakStimulusRaceWeekIdx != null && input.peakStimulusRaceWeekIdx < raceWeekIdx) {
    peakWeekIdx = input.peakStimulusRaceWeekIdx;
    peakIsRace = true;
  } else {
    for (let wi = raceWeekIdx - 1; wi >= 0; wi--) {
      const d = daysOut(wi);
      if (d == null || d < MP_PEAK_STIMULUS_WINDOW_DAYS[0]) continue;
      if (d > MP_PEAK_STIMULUS_WINDOW_DAYS[1]) break;
      const why = blockedBecause(wi);
      if (why == null) { peakWeekIdx = wi; break; }
      note(wi, why);
    }
  }

  // ── STEP B · the build rungs, walking back from the peak ──────────────────
  // "Roughly 2-3 weeks between the largest demands where the calendar allows."
  // At most two, because the owner asked for "approximately four meaningful
  // marathon-specific sessions before race week" and the peak, the post-race
  // touch and the sharpening rung account for the rest.
  const build: number[] = [];
  if (peakWeekIdx != null) {
    let cursor = peakWeekIdx;
    while (build.length < 2) {
      // Try the cadence band first, then keep descending. The gap STRETCHES
      // past three weeks only when every week inside the band is unavailable —
      // which is the same latitude `racePaceLongThisWeek` already took, and the
      // alternative is dropping the session entirely. On the reference block
      // weeks 5 (deload) and 4 (designed race weekend) are both unusable, so
      // the introduction rung lands four weeks back rather than not at all.
      let found: number | null = null;
      for (let cand = cursor - MP_LADDER_MIN_GAP_WEEKS; cand >= 0; cand--) {
        const why = blockedBecause(cand);
        if (why == null) { found = cand; break; }
        note(cand, why);
        const d = daysOut(cand);
        if (d != null && d > MP_LADDER_FIRST_DAYS) break;   // out of the window
      }
      if (found == null) break;
      build.push(found);
      cursor = found;
    }
  }
  build.reverse();  // calendar order · earliest first

  // ── STEP C · the post-race touch ──────────────────────────────────────────
  // Q16, verbatim: "Thursday or Friday · ~3 miles at currently supported
  // marathon effort · embedded in an otherwise easy run · comfortable warm-up
  // and cool-down · no threshold finish · no attempt to prove new fitness."
  // Only after a tune-up race, because that is the week the ruling is about.
  const touchWeekIdx = peakIsRace && peakWeekIdx != null && peakWeekIdx + 1 < raceWeekIdx
    ? peakWeekIdx + 1 : null;

  // ── STEP D · the sharpening rung ──────────────────────────────────────────
  // Q18 · the two-weeks-out long "may carry a small controlled marathon-effort
  // component if earlier development supports it". "If earlier development
  // supports it" is checked, not assumed: with no build rung there is nothing
  // to preserve and the taper long stays easy.
  let sharpenWeekIdx: number | null = null;
  if (build.length > 0 || peakWeekIdx != null) {
    for (let wi = raceWeekIdx - 1; wi >= 0; wi--) {
      const d = daysOut(wi);
      if (d == null || d < MP_SHARPEN_WINDOW_DAYS[0]) continue;
      if (d > MP_SHARPEN_WINDOW_DAYS[1]) break;
      if (input.isTuneUpRaceWeek(wi)) { note(wi, 'the long-run slot is a tune-up race'); continue; }
      if (input.isDesignedWeekendLong(wi)) { note(wi, 'designed race weekend long, stays easy'); continue; }
      if (input.isInsidePostRaceWindow(wi)) { note(wi, 'inside a post-race no-quality window · Research/00b'); continue; }
      sharpenWeekIdx = wi; break;
    }
  }

  // ── assemble, in calendar order, applying the earned cap ──────────────────
  const plan: { wi: number; role: MarathonSpecificRole; vehicle: MarathonSpecificVehicle }[] = [];
  for (const [k, wi] of build.entries()) {
    // Calendar order: the earliest build rung is the introduction, anything
    // after it is development. There are at most two.
    plan.push({ wi, role: k === 0 ? 'introduction' : 'development', vehicle: 'long_run' });
  }
  if (peakWeekIdx != null) plan.push({ wi: peakWeekIdx, role: 'peak_stimulus', vehicle: peakIsRace ? 'tune_up_race' : 'long_run' });
  if (touchWeekIdx != null) plan.push({ wi: touchWeekIdx, role: 'consolidation', vehicle: 'easy_run_touch' });
  if (sharpenWeekIdx != null) plan.push({ wi: sharpenWeekIdx, role: 'sharpening', vehicle: 'long_run' });
  plan.sort((a, b) => a.wi - b.wi);

  let largest = 0;
  /** Q8 · the most recently SUPPORTED position on the pace ladder. */
  let supportedT: number = MARATHON_EFFORT_LADDER_T.early;
  let developmentSeen = false;
  for (const step of plan) {
    if (claimed.has(step.wi)) continue;
    claimed.add(step.wi);
    const iso = input.longRunISOByWeek[step.wi];
    if (!iso) continue;
    const d = daysBetweenISO(iso, input.raceDateISO);
    const band = MP_ROLE_DOSE_MI[step.role];
    let mpMi = 0;
    let ladderT = supportedT;
    if (step.vehicle === 'tune_up_race') {
      // A raced half is a larger race-specific demand than any authored MP
      // block, and it is what the next rung may step from.
      largest = Math.max(largest, MP_ROLE_DOSE_MI.peak_stimulus[1]);
      ladderT = supportedT;
    } else {
      // The band's top, unless the block has not earned it yet. `largest` is
      // what THIS PLAN has already authored, never what the runner has run —
      // authoring has no execution to read (adaptation is disabled) and
      // pretending otherwise would be a second brain.
      mpMi = Math.max(band[0], Math.min(band[1], Math.max(band[0], largest + MP_EARNED_STEP_MI)));
      // §4.4's larger dose belongs in §4.4's window; outside it the session is
      // trimmed to §4.5's fast-finish size rather than dropped, so the rung
      // still happens.
      if (mpMi > MP_FAST_FINISH_MAX_MI && (d < MP_LONG_WINDOW_DAYS[0] || d > MP_LONG_WINDOW_DAYS[1])) {
        mpMi = MP_FAST_FINISH_MAX_MI;
      }
      largest = Math.max(largest, mpMi);
      // Q8's pace ladder. Duration is the primary early lever, so the pace steps
      // ONCE across the build and then holds: "Taper rehearsal · preserve the
      // most recently supported effort; no large new pace jump", and Q16's
      // touch is at "currently supported marathon effort" by name.
      if (step.role === 'introduction') ladderT = MARATHON_EFFORT_LADDER_T.early;
      else if (step.role === 'development') { ladderT = MARATHON_EFFORT_LADDER_T.middle; developmentSeen = true; }
      else if (step.role === 'peak_stimulus') {
        // "Later peak-specific work · only after preceding development."
        ladderT = developmentSeen ? MARATHON_EFFORT_LADDER_T.later : MARATHON_EFFORT_LADDER_T.middle;
      } else ladderT = supportedT;   // consolidation and sharpening HOLD
      supportedT = Math.max(supportedT, ladderT);
    }
    rungs.push({
      weekIdx: step.wi, dateISO: iso, daysToRace: d, role: step.role, vehicle: step.vehicle,
      mpMi, ladderT,
      countsAsQuality: step.vehicle === 'long_run' && mpMi >= MP_LONG_COUNTS_AS_QUALITY_MI,
      rationale: rationaleFor({ role: step.role, vehicle: step.vehicle, mpMi, daysToRace: d, prev: rungs[rungs.length - 1] ?? null, ladderT }),
    });
  }

  return {
    rungs,
    byWeek: new Map(rungs.map((r) => [r.weekIdx, r])),
    skipped,
    largestDoseMi: rungs.reduce((m, r) => Math.max(m, r.mpMi), 0),
  };
}

/**
 * The persisted "why" for one rung. Rule 17: each sentence is said once, in the
 * place it is useful, and it names THIS session rather than restating the
 * block's standing instruction on every row.
 */
function rationaleFor(a: {
  role: MarathonSpecificRole;
  vehicle: MarathonSpecificVehicle;
  mpMi: number;
  daysToRace: number;
  ladderT: number;
  prev: MarathonSpecificRung | null;
}): MarathonSpecificRationale {
  const weeksOut = Math.round(a.daysToRace / 7);
  const rehearses: MarathonRehearsalKind = a.ladderT > 0 ? 'forecast_development' : 'current_capability';
  const gapWeeks = a.prev ? Math.round((a.prev.daysToRace - a.daysToRace) / 7) : 0;
  const supportedBy = a.prev == null
    ? 'The block’s aerobic base so far. Nothing at marathon effort yet, which is why this one is small.'
    : a.prev.vehicle === 'tune_up_race'
      ? `The tune-up race ${gapWeeks} week${gapWeeks === 1 ? '' : 's'} ago, run controlled.`
      : `${a.prev.mpMi} marathon-effort miles ${gapWeeks} week${gapWeeks === 1 ? '' : 's'} ago.`;
  switch (a.role) {
    case 'introduction':
      return {
        purpose: `${a.mpMi} miles at marathon effort at the end of the long run. First controlled marathon-effort running of the block: learn the effort on tired legs before the dose grows.`,
        whyThisWeek: `${weeksOut} weeks out, on a long run that is not a deload and not attached to a race.`,
        supportedBy,
        prepares: 'The larger marathon-effort block in the specific phase.',
        rehearses,
      };
    case 'development':
      return {
        purpose: `${a.mpMi} miles at marathon effort inside the long run. This is the session that builds holding the effort after time on feet, which is the gap between your half and your marathon.`,
        whyThisWeek: `${weeksOut} weeks out, inside Research/04 §4.4's own window for marathon-pace long runs.`,
        supportedBy,
        prepares: 'The block’s largest race-specific demand.',
        rehearses,
      };
    case 'peak_stimulus':
      return {
        purpose: a.vehicle === 'tune_up_race'
          ? 'The block’s largest race-specific demand. It replaces the long run and a quality session rather than sitting on top of them.'
          : `${a.mpMi} miles at marathon effort — the block’s largest marathon-specific session.`,
        whyThisWeek: `${weeksOut} weeks out: far enough back that the block can absorb it, close enough that it still counts.`,
        supportedBy,
        prepares: 'The consolidation touch and the sharpening session that carry it into race week.',
        rehearses,
      };
    case 'consolidation':
      return {
        purpose: `${a.mpMi} miles at the marathon effort you have already supported, inside an otherwise easy run. Keeps the rhythm without asking for anything new.`,
        whyThisWeek: `${weeksOut} weeks out, the week after the race. The race was the stimulus; this week absorbs it.`,
        supportedBy,
        prepares: 'The final sharpening session before race week.',
        rehearses,
      };
    case 'sharpening':
      return {
        purpose: `${a.mpMi} miles at marathon effort at reduced volume. Research/08 §9.1: the largest cut is to easy mileage, intensity is preserved.`,
        whyThisWeek: `${weeksOut} weeks out. The last marathon-effort running before race day, and it is not another peak workout.`,
        supportedBy,
        prepares: 'Race day. This is the effort the target is built on.',
        rehearses,
      };
  }
}
