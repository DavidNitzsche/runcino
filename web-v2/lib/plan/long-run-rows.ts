/**
 * lib/plan/long-run-rows.ts · LONGRUN-ROWS-1 (2026-08-25)
 *
 * `Research/04-workout-vocabulary.md` §4.1 is a five-row table, and the engine
 * modelled it as one number. Every race-pace long run — §4.4's marathon-pace
 * long, §4.5's fast-finish long, §4.6's dress rehearsal — went through a single
 * `{ pct, tag }` "finish segment", sized as a fraction of the long. Three
 * different sessions, one shape.
 *
 * The cost of the collapse was a specific, dated ruling. `longFinishSegment`
 * returns null for TAPER, and the reason recorded beside `TAPER_MP_DOSE` was:
 *
 *   "What is deliberately NOT restored: §9.2's -2 row also asks the long run to
 *    carry 'MP miles late'. `Research/04` §16 "Combinations to avoid" names
 *    "Fast finish long run before goal race | Adds depletion in taper window",
 *    and the two cannot both be honoured."
 *
 * That reasoning is sound for §4.5 and it is not about §4.6. §16 names the FAST
 * FINISH — §4.5's "final 2–6 mi at MP or slightly faster", a hard session
 * ending at race pace or above. §4.6 is a different row with a different
 * purpose ("Final equipment, fueling, and timing rehearsal"), a different dose
 * ("Easy bulk + 2–3 segments at MP (4–8 mi total at MP)"), a placement §16 does
 * not discuss ("3 weeks pre-marathon; before taper begins") and an explicit
 * instruction not to race it ("Not a fitness builder — keep effort
 * controlled"). Because both rows arrived at the engine as the same object, the
 * ruling against one silently took the other with it.
 *
 * The owner overturned that ruling on 2026-08-25. This module is the undoing:
 * each row is its own named thing with its own numbers read out of its own
 * table, so a future ruling about one cannot reach the others by accident.
 *
 * ── THE THREE ROWS ────────────────────────────────────────────────────────
 *
 *   §4.4 marathon-pace long   14–22 mi · 8–16 mi at MP · marathon specific
 *                             phase, every 2–3 weeks. Sized in
 *                             `longFinishSegment` (RACE-SPECIFIC arm).
 *   §4.5 fast-finish long     12–18 mi · final 2–6 mi at MP or faster.
 *                             The half's race-specific long, and the row §16
 *                             forbids in the taper window.
 *   §4.6 dress rehearsal      18–22 mi · easy bulk + 4–8 mi at MP · exactly
 *                             three weeks out · effort controlled. HERE.
 *
 * Nothing in this module knows about phases. §4.6 states its placement in DAYS
 * BEFORE THE RACE, so that is what it is keyed on — which also means it lands
 * in the right place for a runner whose phase boundaries fall differently, and
 * cannot be moved by a phase-length change nobody connected to it.
 */

/**
 * Which `Research/04` §4.1 row a long run's race-pace segment came from.
 *
 * Recorded on the day so a later pass that shortens or removes the segment can
 * say WHICH session it changed, and so the rows stay distinguishable after
 * they have all become miles in a sub_label.
 *
 * `progression` (2026-08-28) is §4.3's progression long run — "First 1/3 to
 * 1/2 at E pace, middle at strong E or M, final 1/4 to 1/3 at M to T", "Every
 * 2–3 weeks in specific phase". The 10K plan's long-run session: `Research/22`
 * §"10K — Intermediate" names "progression LR" in Key workout types and its
 * sample peak week runs "9-10 mi E w/ last 2 mi @ M". The engine expresses it
 * as the modest fixed M-pace tail that sample week states, not §4.4/§4.5's
 * marathon-sized fractions.
 */
/**
 * SEGLONG-2 (2026-08-29) · `modified_block` is §11.1's Variations row, "single
 * longer run with two segments separated by short rest". It is the only member
 * of this union whose quality is DISCONTINUOUS — every other kind runs its
 * marathon-pace work as one block, ending at the finish. That difference is
 * the session: coming back to race pace a second time with the first block
 * already in the legs is what §11.1 calls "trains under-fatigue running".
 */
/**
 * DOWNHILL-2 (2026-08-29) · `downhill_simulation` is the odd one out here, and
 * deliberately so: it is the only kind whose defining property is TERRAIN
 * rather than pace structure. Its marathon-pace shape is an ordinary MP long;
 * what makes it Research/11's session is running it on a descent matching the
 * race's. The kind exists so the note can say that and so the day is
 * identifiable afterwards — without it the session was selectable but authored
 * as a plain MP long, which is the same session with the instruction missing.
 */
export type LongRunKind =
  | 'mp_long' | 'fast_finish' | 'dress_rehearsal' | 'progression' | 'modified_block'
  | 'downhill_simulation';

/**
 * §4.6's own table, as numbers.
 *
 *   | Purpose       | Final equipment, fueling, and timing rehearsal |
 *   | Distance      | 18–22 mi (marathon); 12–14 mi (HM) |
 *   | Pace          | Easy bulk + 2–3 segments at MP (4–8 mi total at MP) |
 *   | When in cycle | 3 weeks pre-marathon; before taper begins |
 *   | Contraindications | Not a fitness builder — keep effort controlled |
 *
 * The Distance row states TWO bands, one per race, and until 2026-08-28 the
 * engine carried only the marathon's: `authorDressRehearsal` returned early
 * for every non-marathon plan, so a half build had no rehearsal at all — the
 * fueling/kit/timing run the doc prescribes for it at 12–14 mi. `hmTotalMiBand`
 * is the row's second half; the Pace row's MP band is stated once for the
 * session and applies to both (`dressRehearsalDose` scales it against the
 * band the caller passes, so a 13-mile HM rehearsal lands mid-band exactly as
 * a 20-mile marathon one does). The segments are at MP for BOTH races — the
 * row says "segments at MP", and for a half that is the controlled effort the
 * Contraindications row demands, comfortably below HM race pace.
 *
 * Bound by `LONGRUN.dress-rehearsal` in lib/doctrine/registry.ts, which reads
 * all the rows out of the table rather than trusting these copies.
 */
export const DRESS_REHEARSAL = {
  /** "3 weeks pre-marathon". */
  daysBeforeRace: 21,
  /** Marathon distance band, miles. */
  totalMiBand: [18, 22] as [number, number],
  /** Half-marathon distance band, miles — "12–14 mi (HM)". */
  hmTotalMiBand: [12, 14] as [number, number],
  /** "4–8 mi total at MP". */
  mpMiBand: [4, 8] as [number, number],
} as const;

/**
 * How far either side of exactly three weeks a long run still counts as the
 * rehearsal.
 *
 * CONVENTION, not doctrine. §4.6 says "3 weeks pre-marathon" and states no
 * tolerance. A long run is weekly, so the window has to be seven days wide or
 * it selects either none or two; ±3 days centred on 21 is the only seven-day
 * window that keeps 21 in the middle. Widening it would let the rehearsal drift
 * into §16's taper window, which is the boundary this module exists to respect.
 */
export const DRESS_REHEARSAL_WINDOW_DAYS = 3;

/** Is `daysToRace` the three-weeks-out slot §4.6 names? */
export function isDressRehearsalSlot(daysToRace: number): boolean {
  return Math.abs(daysToRace - DRESS_REHEARSAL.daysBeforeRace) <= DRESS_REHEARSAL_WINDOW_DAYS;
}

export interface DressRehearsalDose {
  /** Miles at marathon pace inside the long run. */
  mpMi: number;
  /** Miles of easy running before them. */
  easyMi: number;
}

/**
 * §4.6's marathon-pace dose for a long run of `longMi`, or null when this long
 * run is not big enough to be the session doctrine describes.
 *
 * SCALED, not clamped. §4.6's 4–8 mi band describes the runner whose week −3
 * long is 18–22 mi; a runner whose long is 14 gets the same FRACTION of it, in
 * the same way `taperMpDose` scales §9.2's bands to a week that cannot afford
 * their midpoints. Flooring a smaller runner at 4 would be the share cap read
 * backwards — the mistake `select.ts` names in its own header.
 *
 * `budgetMi` is what the week may still spend at marathon pace (Daniels' "the
 * lesser of 18 mi or 20% of weekly mi", via `weeklyDoseBudgetMi`). The dose
 * never exceeds it.
 *
 * Refuses below `minMpMi`, for the reason `taperMpDose` refuses below three:
 * a rehearsal is a rehearsal because it is long enough to rehearse something.
 * Below the floor the long runs easy and the runner is not handed a mile of
 * race pace under a label promising a dress rehearsal.
 */
export function dressRehearsalDose(
  longMi: number,
  budgetMi: number,
  minMpMi: number,
  /**
   * True when this long run falls inside a tune-up's post-race no-quality
   * window. `Research/00b` §"Recovery by Effort" is about a B race costing less
   * recovery than an A race, not none, so the rehearsal still happens — at the
   * SLOW edge of §4.6's own band rather than at the dose the long run's size
   * would otherwise buy. Doctrine gives the band and gives the instruction
   * ("keep effort controlled"); this is what the two say together when the legs
   * are seven days off a raced half.
   */
  insidePostRaceWindow = false,
  /**
   * The §4.6 Distance band this plan's race reads from — the marathon's
   * 18–22 by default, the half's 12–14 when `authorDressRehearsal` passes it.
   * The MP dose scales against this band's midpoint, so a rehearsal in the
   * middle of ITS OWN distance band always lands in the middle of the one MP
   * band the Pace row states for the session.
   */
  totalMiBand: readonly [number, number] = DRESS_REHEARSAL.totalMiBand,
): DressRehearsalDose | null {
  if (!(longMi > 0) || !(budgetMi > 0)) return null;
  const [bandLo, bandHi] = totalMiBand;
  const [mpLo, mpHi] = DRESS_REHEARSAL.mpMiBand;
  // Midpoint of the MP band at the midpoint of the distance band, scaled by how
  // this long compares to that reference. Capped at the band's own top: a
  // 26-mile long run does not buy more race pace than §4.6 prescribes.
  const refLongMi = (bandLo + bandHi) / 2;
  const refMpMi = (mpLo + mpHi) / 2;
  const ceilingMi = insidePostRaceWindow ? mpLo : mpHi;
  const scaled = Math.min(ceilingMi, (refMpMi * longMi) / refLongMi);
  const mpMi = Math.floor(Math.min(scaled, budgetMi) * 2) / 2;
  if (mpMi < minMpMi) return null;
  // The rehearsal is easy bulk THEN race pace; a long run that is mostly race
  // pace is §4.4's session wearing §4.6's name.
  if (mpMi >= longMi * 0.5) return null;
  return { mpMi, easyMi: Math.round((longMi - mpMi) * 10) / 10 };
}
