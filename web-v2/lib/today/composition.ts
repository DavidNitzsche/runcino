/**
 * lib/today/composition · what Today holds, and in what order.
 *
 * ── Why this module exists ─────────────────────────────────────────────
 *
 * The morning after his A race David read the page and said: "a huge mess
 * of information and an awful home page." He was right, and the diagnosis
 * was specific:
 *
 *   1. The page never said what to do today. His prescribed easy 4 lived
 *      as 8px text inside the week strip while yesterday's race result
 *      owned 120px of hero.
 *   2. Five stacked cards of near-equal weight, so nothing read.
 *   3. Readiness rendered twice (header ring AND the recovery-read card).
 *      The recovery window was described three separate ways.
 *   4. Tiles that could not say anything true (WEEKLY VOLUME "0 mi" over
 *      a dead block's bars; a 111-day countdown the day after a race).
 *
 * Every one of those is a COMPOSITION failure, not a styling failure. The
 * page was branching inline — `postRaceOwnsPage ? null : …` in the hero
 * slot is literally the line that deleted today's run from the page. So
 * the order lives here instead, as a pure function with a test suite, and
 * the view renders whatever this returns.
 *
 * ── The doctrine, in one sentence ──────────────────────────────────────
 *
 * A coach's first sentence is always "here is today". The app's was "here
 * is what you already did". Beat 1 answers what am I doing today and why,
 * in EVERY state except race morning, when the race itself is the day's
 * work.
 *
 * ── The beat order ─────────────────────────────────────────────────────
 *
 *   alert     something that overrides the day (injury protocol). Rare.
 *   brief     the composed morning paragraph. Above the hero, quieter
 *             than it (deck Decision 8 locked the placement).
 *   work      TODAY'S WORK. The prescription: type, distance, pace band,
 *             HR cap, purpose. On a rest day it says rest with the same
 *             confidence and explains what the rest is doing.
 *   decision  the CoachDecisionCard. Absent when the queue is empty.
 *   missed    yesterday went unlogged and needs a call.
 *   context   where this week sits: phase, window, week strip. One row.
 *   recent    the recent race, demoted to a line once it stops being the
 *             thing you are living through.
 *   tiles     only the tiles that can say something true today.
 *
 * Readiness is NOT a beat. It resolves to exactly one representation, the
 * header ring, and when it modifies today (pull-back, an HR cap) it says
 * so INSIDE beat 1 rather than opening a second card about itself. The
 * `readouts` array is the invariant the test suite holds to length 1.
 *
 * ── What is deliberately not hardcoded ─────────────────────────────────
 *
 * No window length, no rest-vs-running assumption, no day count. Recovery
 * is context-aware as of 52174bcd — David's live block is easy running,
 * not two weeks of rest — so everything about the window arrives as input
 * read off the plan. This module decides ORDER and PRESENCE. It never
 * decides what the plan says.
 *
 * Pure · no React, no fetch, no dates. Tested in composition.test.ts.
 */

/* ── vocabulary ──────────────────────────────────────────────────────── */

/** One beat of the page, in the order the composer emits it. */
export type TodayBeat =
  | 'alert'
  | 'brief'
  | 'race'
  | 'work'
  | 'decision'
  | 'missed'
  | 'context'
  | 'recent'
  | 'tiles';

/**
 * The training state the page is composing for. Mirrors the conditional
 * layouts in the C1 element inventory (BuildResearch, C1 overview and
 * today), plus the two states C1 assumes rather than names: the day the
 * runner navigated back to, and the coached runner whose own coach owns
 * the plan.
 */
export type TodayStateKey =
  | 'other-day'
  | 'race-morning'
  | 'injury'
  | 'post-race'
  | 'recovery'
  | 'race-week'
  | 'taper'
  | 'coached'
  | 'between-blocks'
  | 'no-goal'
  | 'build';

/** Every surface permitted to render the readiness score. Length is 1. */
export type ReadinessReadout = 'header';

/** How much of the page the most recent race is entitled to. */
export type RecentTreatment = 'hero' | 'line' | 'none';

/** Which strip the context beat carries. */
export type StripKind = 'week' | 'recovery' | 'none';

/** What the plan says about today, before anything is rendered. */
export type Prescription = 'run' | 'rest' | 'none';

/* ── input ───────────────────────────────────────────────────────────── */

export type TodayCompositionInput = {
  /** False when the runner tapped back to another day in the week strip. */
  isTodayCard: boolean;
  /** Goal race is today, the selected day is the race, and it is unlogged. */
  isRaceDay: boolean;
  /** The selected day has a completed run against it. */
  dayDone: boolean;
  /**
   * What the plan prescribes for the selected day. 'rest' is a real
   * prescription and gets the hero; 'none' means there is no plan row at
   * all, which is the only case where the day has no work to lead with.
   */
  prescribed: Prescription;
  /** The runner's own coach owns the plan; Faff prescribes nothing. */
  coachedExternally: boolean;
  /** The server composed a morning paragraph for this day. */
  hasMorningBrief: boolean;
  /** Items in the unified coach decision queue. Zero renders nothing. */
  decisionCount: number;
  /** Yesterday was planned, not rest, not done, not skipped. */
  missedYesterday: boolean;
  /** An injury protocol is active. Overrides the top of the page. */
  injuryActive: boolean;
  /** readinessBrief.band, or null when there is no signal. */
  readinessBand: string | null;

  /* the race that just happened */
  /** Composed post-race state is live (purpose says post_race, or the
   *  calendar puts the race inside the window). */
  postRaceActive: boolean;
  /** Days since that race. 0 is race day itself. Null when there isn't one. */
  daysSinceRace: number | null;
  /** A race row was resolved and can actually be rendered. */
  hasRecentRace: boolean;
  /** The finish time is a locked chip time, not a provisional watch time. */
  raceResultAcknowledged: boolean;

  /* where the plan puts today */
  /** Today sits inside a recovery block per the plan's own phase span. */
  inRecoveryWindow: boolean;
  /** selectRecoveryWindow returned a window with days to render. */
  recoveryWindowAvailable: boolean;
  /** lib/faff/block-state says the runner is between training blocks. */
  betweenBlocks: boolean;
  hasGoalRace: boolean;
  /** Days to the goal race. Null when there is no goal. */
  daysToGoalRace: number | null;

  /* what the tiles would say if they rendered */
  /** Miles the plan prescribes across the current training week. */
  weekPlannedMi: number;
  /** Miles actually logged so far in the current training week. */
  weekLoggedMi: number;
  /** seed.form.label · OVERREACH / LOADED / PRODUCTIVE / … */
  formLabel: string | null;
};

/* ── output ──────────────────────────────────────────────────────────── */

export type TodayComposition = {
  state: TodayStateKey;
  /** The page, in order. The view renders exactly this and nothing else. */
  beats: TodayBeat[];
  /** The first content beat. Whatever owns the top of the viewport. */
  hero: 'work' | 'race' | 'recent';
  readiness: {
    /** Invariant: exactly one. The header ring is the single readout. */
    readouts: ReadinessReadout[];
    /** True when readiness changes today. Beat 1 carries the sentence. */
    modifiesWork: boolean;
  };
  recent: {
    treatment: RecentTreatment;
    /** The line carries CONFIRM RESULT because the time is provisional. */
    needsConfirm: boolean;
  };
  context: {
    show: boolean;
    strip: StripKind;
    /**
     * The week's volume as a sentence, for when the VOLUME tile is
     * suppressed but the number is still true. Null when there is no
     * honest number to state.
     */
    volumeLine: string | null;
  };
  tiles: {
    show: boolean;
    gap: boolean;
    raceDay: boolean;
    volume: boolean;
    form: boolean;
    count: number;
  };
};

/* ── helpers ─────────────────────────────────────────────────────────── */

function miles(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r % 1 === 0 ? r.toFixed(0) : r.toFixed(1);
}

/**
 * Race week is the seven days up to and including race day. Taper is the
 * two weeks before that. Both are read off the real countdown, never off a
 * phase label, because a label can lag a moved race date.
 */
const RACE_WEEK_DAYS = 6;
const TAPER_DAYS = 21;

/**
 * The form states that change what the runner does today. Everything else
 * is a trend, and a trend belongs on Health.
 *
 * OVERREACH says pull back; DETRAINING says build back up. Both are
 * instructions. PRODUCTIVE, LOADED, RACE-READY and BUILDING are status —
 * true, useful, and not a reason to look at Today.
 */
const ACTIONABLE_FORM = new Set(['OVERREACH', 'DETRAINING']);

/* ── the selector ────────────────────────────────────────────────────── */

export function selectTodayState(i: TodayCompositionInput): TodayStateKey {
  if (!i.isTodayCard) return 'other-day';
  if (i.isRaceDay) return 'race-morning';
  if (i.injuryActive) return 'injury';
  if (i.postRaceActive) return 'post-race';
  if (i.inRecoveryWindow) return 'recovery';
  if (i.coachedExternally) return 'coached';
  if (i.daysToGoalRace != null && i.daysToGoalRace >= 0 && i.daysToGoalRace <= RACE_WEEK_DAYS) {
    return 'race-week';
  }
  if (i.daysToGoalRace != null && i.daysToGoalRace > RACE_WEEK_DAYS && i.daysToGoalRace <= TAPER_DAYS) {
    return 'taper';
  }
  if (i.betweenBlocks) return 'between-blocks';
  if (!i.hasGoalRace) return 'no-goal';
  return 'build';
}

/**
 * How much of the page the recent race gets.
 *
 * The rule David set: "It earns the hero only ON race day and the day
 * immediately after, and even then beat 1 outranks it if a session is
 * prescribed." A rest day inside a recovery block IS a prescribed session
 * — the plan wrote it deliberately and the hero says so with the same
 * confidence as a run. So the race takes the top of the page only on the
 * day itself, or when there is genuinely no plan row to lead with.
 *
 * From day 1 onward, with any prescription at all, today outranks it. The
 * result still renders in full on the line, with CONFIRM when the time is
 * a provisional watch time, so nothing is lost — it just stops owning the
 * viewport it was owning the morning David complained.
 */
export function selectRecentTreatment(i: TodayCompositionInput): RecentTreatment {
  if (!i.isTodayCard || !i.hasRecentRace || !i.postRaceActive) return 'none';
  const since = i.daysSinceRace;
  if (since == null) return 'line';
  if (since === 0) return 'hero';
  if (since === 1 && i.prescribed === 'none') return 'hero';
  return 'line';
}

export function composeToday(i: TodayCompositionInput): TodayComposition {
  const state = selectTodayState(i);
  const raceMorning = state === 'race-morning';

  /* ── recent ───────────────────────────────────────────────────────── */
  const treatment: RecentTreatment = raceMorning ? 'none' : selectRecentTreatment(i);

  /* ── readiness · exactly one readout, always ──────────────────────── */
  // The ring in the header is the single representation. When readiness
  // pulls today back, the consequence (run to the HR cap, not the pace)
  // is stated inside the work hero. It never opens a card about itself,
  // which is what "Readiness 68" rendering twice actually was.
  const modifiesWork =
    i.isTodayCard &&
    !i.dayDone &&
    !raceMorning &&
    i.readinessBand === 'pull-back' &&
    i.prescribed === 'run';

  /* ── context ──────────────────────────────────────────────────────── */
  // Race morning hides secondary context entirely (brief v2 §6: the race
  // takes the page). Everywhere else the context beat carries one strip.
  const strip: StripKind = raceMorning
    ? 'none'
    : (i.postRaceActive || i.inRecoveryWindow) && i.recoveryWindowAvailable
      ? 'recovery'
      : 'week';

  /* ── tiles · each has to be able to say something true ────────────── */
  // A projection and a countdown say nothing the week the body is
  // absorbing a race, and nothing at all while the runner is between
  // blocks with no goal on the calendar.
  const goalTilesEarnTheirPlace =
    i.isTodayCard &&
    i.hasGoalRace &&
    !raceMorning &&
    !i.postRaceActive &&
    !i.inRecoveryWindow;

  // The bug David caught: WEEKLY VOLUME rendering "0 mi" over bars from a
  // block that is already finished. The tile may only render when there is
  // a live target to measure against or miles actually logged this week.
  const volumeHasTruth = i.weekPlannedMi > 0 || i.weekLoggedMi > 0;
  // During recovery the number is true but it is one fact, not a tile with
  // eight weeks of dead bars behind it. It moves into the context row.
  const volumeAsTile =
    volumeHasTruth && !raceMorning && !i.postRaceActive && !i.inRecoveryWindow;

  const formTile =
    !raceMorning &&
    i.isTodayCard &&
    !i.postRaceActive &&
    !i.inRecoveryWindow &&
    !!i.formLabel &&
    ACTIONABLE_FORM.has(i.formLabel);

  const tiles = {
    show: goalTilesEarnTheirPlace || volumeAsTile || formTile,
    gap: goalTilesEarnTheirPlace,
    raceDay: goalTilesEarnTheirPlace && !raceMorning,
    volume: volumeAsTile,
    form: formTile,
    count: 0,
  };
  tiles.count =
    (tiles.gap ? 1 : 0) + (tiles.raceDay ? 1 : 0) +
    (tiles.volume ? 1 : 0) + (tiles.form ? 1 : 0);
  tiles.show = tiles.count > 0;

  // The recovery strip already states what the week prescribes ("4 running
  // days · 17 mi easy"), so repeating the target here would be the fourth
  // way of saying the same thing. In that state the line carries progress
  // only, and the strip joins the two into one sentence.
  const volumeLine =
    volumeAsTile || raceMorning || !volumeHasTruth
      ? null
      : strip === 'recovery'
        ? `${miles(i.weekLoggedMi)} mi logged so far`
        : i.weekPlannedMi > 0
          ? `${miles(i.weekLoggedMi)} of ${miles(i.weekPlannedMi)} mi this week`
          : `${miles(i.weekLoggedMi)} mi logged this week`;

  const contextShow = strip !== 'none' || volumeLine != null;

  /* ── the order ────────────────────────────────────────────────────── */
  const beats: TodayBeat[] = [];

  // An injury protocol changes what the whole page means, so it goes
  // first even on race morning, where nothing else does.
  if (i.injuryActive) beats.push('alert');

  if (raceMorning) {
    beats.push('race');
    return {
      state,
      beats,
      hero: 'race',
      readiness: { readouts: ['header'], modifiesWork: false },
      recent: { treatment: 'none', needsConfirm: false },
      context: { show: false, strip: 'none', volumeLine: null },
      tiles: { show: false, gap: false, raceDay: false, volume: false, form: false, count: 0 },
    };
  }

  if (i.isTodayCard && !i.dayDone && i.hasMorningBrief) beats.push('brief');

  if (treatment === 'hero') {
    beats.push('recent');
    beats.push('work');
  } else {
    beats.push('work');
  }

  if (i.decisionCount > 0) beats.push('decision');
  if (i.isTodayCard && i.missedYesterday) beats.push('missed');
  if (contextShow) beats.push('context');
  if (treatment === 'line') beats.push('recent');
  if (tiles.show) beats.push('tiles');

  return {
    state,
    beats,
    hero: treatment === 'hero' ? 'recent' : 'work',
    readiness: { readouts: ['header'], modifiesWork },
    recent: {
      treatment,
      needsConfirm: treatment !== 'none' && !i.raceResultAcknowledged,
    },
    context: { show: contextShow, strip, volumeLine },
    tiles,
  };
}
