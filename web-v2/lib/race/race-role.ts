/**
 * lib/race/race-role.ts · how to RUN a tune-up race inside a goal build.
 *
 * Owner ruling (David 2026-08-28): when a tune-up race approaches inside a
 * build, the coach RECOMMENDS how to run it and the runner answers. This is a
 * genuine decision, not an auto-mutation — the card is the gate, the accept is
 * the runner's. The live case: Run Malibu (half, 2026-11-08, priority B) sits
 * exactly 4 weeks before CIM (A marathon, 2026-12-06).
 *
 * The doctrine (Research/REVIEW_NOTES.md addendum A2, recorded 2026-08-28):
 * three docs are individually correct and jointly impossible at exactly 4
 * weeks out —
 *
 *   · Research/02 §12.3: "a half marathon 4–6 weeks before marathon goal,
 *     raced at race effort" is the tune-up sanction, and the highest-accuracy
 *     predictor of the three protocols.
 *   · Research/00b: an A-effort half costs 10–14 total no-quality days.
 *   · Research/08 §9.2: week −3 of the marathon taper carries the final
 *     MP-specific session and the last long run.
 *
 * At 4 weeks the A-effort recovery consumes the week 08 assigns the final MP
 * block. Resolution (A2): at 4 weeks the half must be a B-EFFORT race (00b:
 * "For a B-race half marathon, expect 7–10 days of recovery rather than 14")
 * or be converted into the week −3 MP-specific session itself; an A-effort
 * half is only sanctioned at 5–6 weeks out, where the recovery clears before
 * week −3.
 *
 * Why the coach cares which way it goes: Research/02 §12.3 makes the tune-up
 * the default predictor. Racing it honestly feeds the VDOT anchor and the
 * runner-specific exponent fit (`lib/race/coach-goal.ts#fitPersonalExponent`),
 * so "B effort" is a real cost paid for keeping the build intact, and the
 * recommendation states it rather than hiding it.
 *
 * This module is PURE — no DB, no fetch. The nightly plan-drift cron calls
 * `recommendRaceRole` + `raceRoleCard` to write the card; the accept path
 * (`lib/race/race-role-apply.ts`) applies the answer; `embedMidBlockRaces`
 * (lib/plan/generate.ts) reads the persisted `meta.plannedRole` so a later
 * rebuild preserves the runner's answer.
 *
 * Doctrine gate: RACEROLE.half-tuneup-window and RACEROLE.recovery-scale in
 * lib/doctrine/registry.ts bind the constants below to the cited passages.
 */

export type RaceRole = 'b_effort' | 'race' | 'mp_workout';

/** Tune-up distance categories the recommendation covers. An A race is never
 *  a tune-up and a C race is already decided (it's a fun run / workout sub —
 *  Research/00b §"Recovery by Effort" prices it at 25–50% and 0–3 easy days,
 *  nothing to renegotiate). */
export type TuneUpCategory = 'hm' | '10k' | '5k';

/**
 * Gap bands, in days from tune-up race day to A-race day, for a HALF before
 * an A MARATHON. Research/02 §12.3 sanctions the tune-up half at 4–6 weeks;
 * REVIEW_NOTES A2 partitions that window:
 *
 *   · [26..30]  ~4 weeks · B effort. A-effort recovery (10–14 days, 00b)
 *     would consume week −3's final MP-specific session (08 §9.2).
 *   · [31..42]  5–6 weeks · race it honestly. The 10–14 day recovery clears
 *     before week −3, and the honest result is the best predictor there is.
 *   · < 26     closer than the sanction window · convert the race into the
 *     week −3 MP-specific session itself (a bib on the MP long).
 *   · > 42     clear of the collision entirely · race it honestly.
 */
export const HALF_B_EFFORT_GAP_DAYS: readonly [number, number] = [26, 30];
export const HALF_HONEST_RACE_GAP_DAYS: readonly [number, number] = [31, 42];

/** A 10K (or 5K) mid-build is a race-it by default — it costs 5–7 easy days
 *  (00b by-distance table) and is a high-value anchor — unless it sits inside
 *  the final three weeks, where even a short race's recovery plus the taper
 *  leave no room for a full effort. */
export const SHORT_TUNEUP_MIN_HONEST_GAP_DAYS = 21;

/** A half before a NON-marathon A race has no week −3 MP session to protect,
 *  but its B-effort recovery (7–10 days, 00b) still collides with a taper
 *  inside four weeks. Inside that, B effort; outside, race it. */
export const HALF_NONMARATHON_MIN_HONEST_GAP_DAYS = 28;

/**
 * Days of no quality the plan owes AFTER the tune-up, per category and
 * answered role. Read against Research/00b:
 *
 *   · role 'race' is an HONEST (maximum) effort, so it takes the by-distance
 *     A-effort table's floor: half 10–14 → 10 · 10K 5–7 → 5 · 5K 3–5 → 4.
 *     (00b §"Recovery by Effort" keys recovery on EFFORT GIVEN, not the
 *     calendar letter — a B-priority race run all-out recovers like an A.)
 *   · role 'b_effort' takes the B scale (60–70% of A duration; stated in
 *     days for the half: "expect 7–10 days of recovery rather than 14"):
 *     half → 7 · 10K → 4 · 5K → 3.
 *
 * `mp_workout` carries no entry: the race day becomes a hard long run and
 * takes ordinary hard-day spacing, not a race-recovery window.
 */
export const ROLE_POST_QUALITY_FREE_DAYS: Record<
  TuneUpCategory,
  Record<'race' | 'b_effort', number>
> = {
  hm: { race: 10, b_effort: 7 },
  '10k': { race: 5, b_effort: 4 },
  '5k': { race: 4, b_effort: 3 },
};

/** The nightly cron fires the card when the tune-up race is this many days
 *  out. A band, not a point, so one missed cron night cannot skip it: any
 *  night with the race 12–15 days ahead writes the card (once — the dedupe
 *  is per race slug). ~14 days gives the runner the decision with the whole
 *  mini-taper still ahead of it. */
export const RACE_ROLE_FIRE_WINDOW_DAYS: readonly [number, number] = [12, 15];

export interface RaceRoleInput {
  /** Tune-up distance category, or null when unresolvable. */
  category: TuneUpCategory | string | null;
  /** The tune-up race's stated priority. Only 'B' gets a recommendation. */
  priority: string | null;
  /** Days from the tune-up race to the A race. Null → no target to protect. */
  gapToADays: number | null;
  /** Whether the build's target race is a marathon (the collision doctrine
   *  is marathon-specific: week −3's MP session is what 4 weeks threatens). */
  aRaceIsMarathon: boolean;
}

export interface RaceRoleRecommendation {
  role: RaceRole;
  /** One-line internal rationale (audit trail, not card copy). */
  why: string;
  citation: string;
}

/**
 * The recommendation matrix. Returns null when there is nothing to recommend:
 * C races (decided), A races (not tune-ups), unresolvable distances, and
 * tune-ups with no A race behind them.
 */
export function recommendRaceRole(input: RaceRoleInput): RaceRoleRecommendation | null {
  if (input.priority !== 'B') return null;
  const cat = input.category;
  if (cat !== 'hm' && cat !== '10k' && cat !== '5k') return null;
  const gap = input.gapToADays;
  if (gap == null || !Number.isFinite(gap) || gap <= 0) return null;

  if (cat === 'hm' && input.aRaceIsMarathon) {
    if (gap < HALF_B_EFFORT_GAP_DAYS[0]) {
      return {
        role: 'mp_workout',
        why: `half ${gap}d before the marathon is inside the 4-week sanction floor · convert to the week -3 MP session`,
        citation: 'Research/REVIEW_NOTES.md A2 · Research/08 §9.2',
      };
    }
    if (gap <= HALF_B_EFFORT_GAP_DAYS[1]) {
      return {
        role: 'b_effort',
        why: `half ${gap}d (~4 weeks) before the marathon · A-effort recovery (10-14d) would consume week -3's MP session`,
        citation: 'Research/REVIEW_NOTES.md A2 · Research/00b §"Recovery by Effort" · Research/08 §9.2',
      };
    }
    return {
      role: 'race',
      why: `half ${gap}d (5+ weeks) before the marathon · recovery clears before week -3, honest race is the best predictor`,
      citation: 'Research/02 §12.3 · Research/REVIEW_NOTES.md A2',
    };
  }

  if (cat === 'hm') {
    return gap < HALF_NONMARATHON_MIN_HONEST_GAP_DAYS
      ? {
          role: 'b_effort',
          why: `half ${gap}d before the goal race · B-effort recovery (7-10d) is all the runway allows`,
          citation: 'Research/00b §"Recovery by Effort"',
        }
      : {
          role: 'race',
          why: `half ${gap}d out · recovery clears with room to spare`,
          citation: 'Research/02 §12.3',
        };
  }

  // 10K / 5K.
  return gap < SHORT_TUNEUP_MIN_HONEST_GAP_DAYS
    ? {
        role: 'b_effort',
        why: `${cat} ${gap}d before the goal race · inside the final 3 weeks a full effort cuts into the taper`,
        citation: 'Research/00b §"Recovery by Effort" · Research/08 §9',
      }
    : {
        role: 'race',
        why: `${cat} ${gap}d out · costs 5-7 easy days and is a high-value anchor`,
        citation: 'Research/02 §12.3 · Research/00b (10K recovery 5-7 days)',
      };
}

/* ── card copy · coach voice ─────────────────────────────────────────────
   Short, direct. No hype, no exclamation marks, no emoji, no em dashes.
   Every body ends by saying what standing pat means, because the card
   expires unanswered after 14 days and the default composition stands. */

export interface RaceRoleCardInput {
  raceName: string;
  aRaceName: string;
  gapToADays: number;
  recommendation: RaceRoleRecommendation;
  category: TuneUpCategory;
}

export interface RaceRoleCard {
  /** Card headline, e.g. "Run Malibu, four weeks out". */
  title: string;
  /** Card body. States the call, the cost, and what standing pat means. */
  body: string;
  /** ACCEPT verb per role · rendered as "ACCEPT · <verb>". */
  acceptVerb: string;
}

const WEEK_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

/** "four weeks" for 26-30 days, "three weeks" for 19-25, etc. */
export function weeksPhrase(days: number): string {
  const w = Math.round(days / 7);
  const word = WEEK_WORDS[w] ?? String(w);
  return w === 1 ? 'one week' : `${word} weeks`;
}

export function raceRoleCard(input: RaceRoleCardInput): RaceRoleCard {
  const { raceName, aRaceName, recommendation } = input;
  const weeks = weeksPhrase(input.gapToADays);
  const title = `${raceName}, ${weeks} out`;
  const standingPat =
    'Leave this and the plan stands as authored, mini taper and recovery days included.';

  if (recommendation.role === 'b_effort') {
    const cost = input.category === 'hm' ? '10 to 14 days' : 'recovery days';
    return {
      title,
      body:
        `Race it at B effort. Hard, not all out. It feeds your ${aRaceName} pacing ` +
        `and leaves the last big week intact. All out costs ${cost} you do not have. ` +
        standingPat,
      acceptVerb: 'RUN IT AT B EFFORT',
    };
  }
  if (recommendation.role === 'mp_workout') {
    return {
      title,
      body:
        `Too close to ${aRaceName} to race it. Run it as the marathon pace long. ` +
        `Warm up, then marathon pace to the line. You keep the key week and still get ` +
        `the bib. A full effort costs recovery that runs into your taper. ` +
        `Accepting makes race day the week's MP long. ` +
        standingPat,
      acceptVerb: 'MAKE IT THE MP LONG',
    };
  }
  return {
    title,
    body:
      `Race it. At ${weeks} out the recovery clears before your last big week, ` +
      `and an honest result is the sharpest read on your ${aRaceName} pacing. ` +
      `Accepting builds the full recovery in after it. ` +
      standingPat,
    acceptVerb: 'RACE IT HONESTLY',
  };
}

/** True when `plannedRole` is a value this module owns. Guards the meta
 *  read in the plan generator against arbitrary strings in jsonb. */
export function isRaceRole(v: unknown): v is RaceRole {
  return v === 'b_effort' || v === 'race' || v === 'mp_workout';
}
