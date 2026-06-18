/**
 * Faff design constants · effort palette, mesh themes, planned segments,
 * weekly demo data, season phases. Lifted from the approved Faff Web App
 * prototype (handoff bundle 2026-05-30). Treat as canonical for visuals;
 * real runtime data overrides demo arrays where the backend has it.
 */

export type EffortKey = 'recovery' | 'easy' | 'long' | 'tempo' | 'intervals' | 'rest' | 'race';
export type Mesh = [string, string, string, string, string, string]; // c1, c2, c3, c4, c5, base
export type ViewKey =
  | 'today' | 'train' | 'health' | 'targets' | 'race' | 'activity' | 'profile' | 'spectator';

export const EFF: Record<EffortKey, { mesh: Mesh; dot: string; mark: number; lbl: string }> = {
  // Effort meshes · canonical "Effort Mesh Background" handoff spec
  // (2026-05-31, locked). Luminous values, no brown. Recovery + easy
  // intentionally share the teal mesh; they differ only by the accent
  // dot. Spec: light to deep [c1, c2, c3, c4, c5, base]. Per-day
  // re-theme cross-fades all 6 stops over 0.7s (handled in CSS).
  // Dots resync'd to the LOCKED TEN-COLOR PALETTE (brief v2, AFC fix 2).
  // easy was #48B3B5 here while iPhone shipped #14C08C "per --eff-easy" ·
  // both surfaces now read #14C08C, byte-for-byte with Theme.swift.
  recovery:  { mesh: ['#8FF0E0','#46CFC6','#2FC0E6','#23A98E','#1B8C7C','#0E5A54'], dot: '#27B4E0', mark: 8,  lbl: 'VERY EASY' },
  easy:      { mesh: ['#8FF0E0','#46CFC6','#2FC0E6','#23A98E','#1B8C7C','#0E5A54'], dot: '#3EBD41', mark: 26, lbl: 'EASY' },
  long:      { mesh: ['#FFE7B0','#F8BC4E','#F0A638','#EC8C2A','#D9791C','#A85A14'], dot: '#F3AD38', mark: 54, lbl: 'MODERATE' },
  // 2026-06-03 · tempo + intervals meshes · second iteration.
  //   v1 (#FFD2A4 / #FF9A54 / …) was too bright · washed cards out.
  //   v2 desaturated too aggressively · page went sad/brown.
  // v3 keeps full saturation (warmth = tempo identity) and only takes the
  // brightest mid stops down ~6–8% in lightness. Base stays where v1 had
  // it because the base only fills the void around blobs, not the
  // foreground. Result: still clearly orange-red / pink-red and alive,
  // just the brightest peak isn't blasting through anymore.
  tempo:     { mesh: ['#F5C297','#F18847','#E15F30','#D04525','#C2303E','#8A1E30'], dot: '#D03F3F', mark: 80, lbl: 'HARD' },
  intervals: { mesh: ['#F2C878','#F07A48','#EB4560','#CD2540','#A91A3E','#6D1129'], dot: '#FC4D64', mark: 94, lbl: 'MAX' },
  rest:      { mesh: ['#C4C8D2','#9CA2B0','#787E8E','#58606E','#3E4350','#252935'], dot: '#8A90A0', mark: 4,  lbl: 'OFF' },
  // 2026-06-08 · race effort · the brand's race-orange mesh (same palette as
  // MESH.race / the Targets→race page surface). Dot is the canonical --race
  // accent (#D03F3F). Max effort mark. Wires the long-orphaned race surface:
  // before this, EffortKey had no 'race' and mapType('race') laundered to
  // 'easy', so race morning rendered a cyan EASY hero. See TodayView RaceDayHero.
  race:      { mesh: ['#FFD27A','#D03F3F','#FC4D64','#D6263C','#9E1733','#3A0E12'], dot: '#D03F3F', mark: 100, lbl: 'RACE' },
};

// View meshes · canonical "you" green for personal surfaces (health/profile),
// ember for race/targets, amber for train (build phase default).
export const MESH: Record<Exclude<ViewKey,'today'>, Mesh> = {
  train:     ['#FFE0A0','#F3AD38','#E89B3A','#E07A2A','#C47812','#3E2A0A'],
  activity:  ['#D6BE98','#B2916A','#8A6A48','#5E4630','#45331F','#1C140D'],
  health:    ['#8EF0B0','#34C194','#1F8A8A','#128A64','#137259','#06382E'],
  // 2026-06-04 · Targets-rebuild handoff: page mesh is NEUTRAL CHARCOAL,
  // not race red.  The previous ember mesh fought every on-track-green
  // status surface (green-on-red is the worst contrast pair) · the
  // redesign reserves semantic color for the data (green = on-track,
  // amber = watching, coral = off-track) instead of bathing the whole
  // page in race energy.  Stops are dark grey blobs over near-black base.
  targets:   ['#363B45','#2B2F38','#21242B','#191C22','#121419','#0C0D11'],
  profile:   ['#8EF0B0','#34C194','#1F8A8A','#128A64','#137259','#06382E'],
  spectator: ['#8EF0B0','#34C194','#1F8A8A','#128A64','#137259','#06382E'],
  race:      ['#FFD27A','#D03F3F','#FC4D64','#D6263C','#9E1733','#3A0E12'],
};

export type Segment = { l: string; sub: string; w: number; c: string };
// SEGS prototype constant removed 2026-06-02 per the consolidated brief.
// Every workout's session shape now derives from real plan_workouts.
// workout_spec via components/faff-app/session-shape.ts:deriveSessionSegs.
// David's flag: "every intervals day was rendering 6 × 800m regardless
// of what the engine prescribed."

// 2026-06-10 · fabrication strip (multi-user honesty pass). weather +
// shoe used to carry placeholder DATA ('66° · Calm', 'Novablast 5',
// David-era garage names) that rendered verbatim for any runner whose
// real chain (forecast / day_actions / shoeRecByType) came up empty —
// a brand-new signup saw a shoe they don't own. Real values come from
// per-user sources; these fields are now the ' · ' empty glyph so any
// missed consumer renders an honest blank, never a fake. fuel keeps
// its templates ONLY as the legacy-row fallback (pre-spec plan rows
// where these strings were the actual written fuel plan); coach lines
// are voice copy, not data.
export const KIT: Record<EffortKey, { weather: string; shoe: string; fuel: string; coach: string }> = {
  easy:      { weather: ' · ', shoe: ' · ', fuel: ' · ',             coach: 'Keep it truly easy. Nose-breathing pace the whole way.' },
  intervals: { weather: ' · ', shoe: ' · ', fuel: 'PF 30 pre',       coach: "Full float between reps. Don't bleed the recoveries." },
  tempo:     { weather: ' · ', shoe: ' · ', fuel: 'PF 30 @ mi 5',    coach: 'Sustainable but focused. The back half is the test.' },
  recovery:  { weather: ' · ', shoe: ' · ', fuel: ' · ',             coach: 'Shake the legs out. Slower than feels right is correct.' },
  long:      { weather: ' · ', shoe: ' · ', fuel: 'PF 30 @ 5·10·15', coach: 'Easy early. Squeeze the finish only if the plan says so.' },
  rest:      { weather: ' · ', shoe: ' · ', fuel: ' · ',             coach: 'Rest is training. Sleep, hydrate, mobilize. Let the work land.' },
  race:      { weather: ' · ', shoe: ' · ', fuel: 'Race fuel plan',  coach: 'Trust the work. Settle into goal effort early, hold the line, finish strong.' },
};

// Z1–Z5 ladder = the effort temperature scale (recovery → easy → long →
// tempo → intervals). One zone palette app-wide (AFC fix 2) · replaces the
// old ladder that used the good-state green (#3EBD41) as Z2 and is synced
// byte-for-byte with Theme.swift ZoneSplit + RunDetailModal ZONE_COLORS.
export const ZC = ['#27B4E0','#14C08C','#F3AD38','#D03F3F','#FC4D64'];

export type PlannedDay = {
  dw: string; dn: number; full: string;
  /** ISO YYYY-MM-DD for the day. Optional during FALLBACK rendering when
   *  the seed loader hasn't resolved real dates yet. */
  iso?: string;
  /** plan_workouts.id · required for POST /api/plan/restore (override
   *  the auto-adapter on this row). Null on off-plan days. */
  planWorkoutId?: string | null;
  /** 2026-06-10 · coached mode v2: the runner's own coach's workout for
   *  this day, read-only, from their pasted ICS calendar feed (Final
   *  Surge Sync URL etc.). Display text only — never a workout_spec. */
  coachWorkout?: { title: string; description: string | null } | null;
  type: EffortKey; name: string;
  /** Raw plan_workouts.sub_label · the canonical workout name from
   *  the plan generator ("Cruise Intervals", "HM Threshold Blocks",
   *  "Long Run · HM Finish"). `name` already mirrors this when
   *  non-null · this field exists separately so other surfaces (e.g.
   *  /today legacy route's StatLine "LABEL") can display the raw
   *  label without re-deriving it. Null when the plan-builder didn't
   *  author a rich name (then `name` falls back to humanName(type, mi)
   *  so the strip never renders empty). */
  subLabel?: string | null;
  dist: string; pace: string; est: string;
  done?: boolean; today?: boolean;
  /** Strava activity / run id when the day has been completed. Drives the
   *  lazy-fetched run-detail in week-row clicks + today's RESULT card. */
  activityId?: string | null;
  /** Planned HR cap (bpm) from workout_spec.hr_cap_bpm. Surfaced on the
   *  PlannedHeroV2 TARGETS row. null when no spec or no HR-band data. */
  hrCap?: number | null;
  /** 2026-06-02 · raw plan_workouts.workout_spec for SESSION grid
   *  derivation. Replaces the hardcoded SEGS prototype constant ·
   *  every "intervals" day was rendering `6 × 800m` regardless of
   *  what the engine prescribed. See components/faff-app/session-
   *  shape.ts:deriveSessionSegs. Null on rest days, off-plan days,
   *  or legacy plans without spec. */
  workoutSpec?: import('@/lib/faff/types').WorkoutSpec | null;
  /** Runner explicitly skipped this day (day_actions.action='skip'). When
   *  true: week-strip card grayscales, hero swaps to SKIPPED state. */
  skipped?: boolean;
  /** Per Research/07 doctrine, the 2 best days each week for an
   *  ad-hoc strength session. Picked client-side from the week shape
   *  (avoid hard-on-hard, prefer easy/recovery, never adjacent to
   *  long-run quality). Surfaces as a "STRENGTH" annotation on the
   *  week strip + a coach hint on TodayView when today matches. */
  strengthSuggested?: boolean;
  /** 2026-06-03 · true when a strength_sessions row exists for this
   *  date (manual log OR Apple Health import via POST /api/strength
   *  source='apple_health'). Read from glance.strengthWeekStatus
   *  confirmed + bonus arrays. Flips the chip to a done-state so
   *  runners see their lift was registered. */
  strengthDone?: boolean;
  /** 2026-06-01 · plan-adapter provenance per day (backend commit
   *  a54c7069). Populated from glance.weekDays[].adaptation. Null on
   *  off-plan days or before backfill landed. When wasAdapted is true
   *  the week-strip chip renders a small downgrade glyph + a "was X"
   *  strikethrough subline; the WorkoutDetail modal renders the full
   *  "How it changed" block with kind + reason + timing. */
  adaptation?: {
    wasAdapted: boolean;
    originalType: string | null;
    originalSubLabel: string | null;
    originalDistanceMi: number | null;
    originalDateIso: string | null;
    reason: string | null;
    adaptedAt: string | null;
    kind: 'downgrade' | 'reschedule' | 'shave' | 'mark_dirty' | 'other' | null;
  } | null;
  /** 2026-06-01 · backend-owned cadence prescription for this workout.
   *  Replaces the frontend's invented "relaxed" / "drive turnover"
   *  fallback strings with a real number range. low=high=0 means rest
   *  day (no target). Personal-baseline-shifted when the runner has
   *  cadence history; canonical otherwise. See lib/coach/cadence-target.ts. */
  cadenceTarget?: {
    low: number;
    high: number;
    copy: string;
  };
  /** 2026-06-01 · web agent brief · live engine re-evaluation. Populated
   *  when the engine, given today's readiness signals, would currently
   *  recommend a different prescription than the active row.
   *  Forward counsel · not a replay of prior adaptation history.
   *  Null when the engine agrees with the active row OR has no opinion.
   *  See lib/coach/standing-recommendation.ts. */
  standingRecommendation?: {
    kind: 'ease_down' | 'shave' | 'reschedule' | 'maintain' | 'push_back';
    copy: string;
    suggestion: {
      proposedType?: string;
      proposedDistanceMi?: number;
      proposedDateIso?: string;
    } | null;
    severity: 'advisory' | 'firm';
  } | null;
};

export const PLAN_CUES: Record<EffortKey, { fuel: [string,string][]; cues: string[] }> = {
  tempo: {
    fuel: [['Before','16 oz + electrolytes'],['Carry','SkyFlask · PF 60'],['During','PF 30 gel @ mi 5']],
    cues: ['Settle the first threshold mile. Don’t sprint in.','Hold effort if HR climbs; let pace drift.','Finish the last mile strongest, not fastest.'],
  },
  recovery: {
    fuel: [['Before','Water'],['Carry','Nothing'],['During',' · ']],
    cues: ['Keep it conversational the whole way.','Slower than feels right is correct.','Stop if anything tweaks. It’s recovery.'],
  },
  long: {
    fuel: [['Before','24 oz + carbs'],['Carry','2 flasks PF 60'],['During','Gel @ 5 / 10 / 15']],
    cues: ['Easy first 10. Bank patience, not pace.','Squeeze the last 4 to marathon pace.','Practice race-day fueling on the move.'],
  },
  easy: {
    fuel: [['Before','Water'],['Carry','Nothing'],['During',' · ']],
    cues: ['Nose-breathing pace the whole way.','Relax shoulders, quick light cadence.','Recovery in disguise. Keep it gentle.'],
  },
  intervals: {
    fuel: [['Before','PF 30 pre'],['Carry','Water'],['During','Sip on floats']],
    cues: ['Full float between reps. Protect recoveries.','Hit goal pace, not faster, on rep 1.','Hold form when it bites on the last two.'],
  },
  rest: {
    fuel: [['Before',' · '],['Carry',' · '],['During',' · ']],
    cues: ['Sleep is the goal.','Hydrate, mobilize, eat well.','An easy 20-min walk is fine. Not a session.'],
  },
  race: {
    fuel: [['Before','Race-morning carbs + fluid'],['Carry','Gels per plan'],['During','Fuel early, fuel often']],
    cues: ['Settle into goal effort. Don’t chase the start.','Hold your line through the middle miles.','Empty the tank over the final stretch.'],
  },
};

export type CompletedRun = {
  win: string; winx: string;
  time: string; apace: string; hr: number; peak: number;
  zones: [number,number,number,number,number];
  weather: string; shoe: string; fuel?: string; cal: number; gain: number;
  splits: Array<[string, number, string, string]>; // mile, fill%, pace, color
  recap: string;
};

// SHOES_DEFAULT removed 2026-06-10 · dead constant (zero consumers) and
// it was David's literal garage hardcoded — the shoes table (user-scoped
// via user_uuid) is the only shoe source.

// Per the locked palette, RACE and TEMPO share #D03F3F (one semantic slot).
// Shoe chips for the two roles are now color-identical · differentiated by
// their text label. Flagged in the AFC recap for David's review.
export const ROLECOL: Record<string,string> = {
  RACE: '#D03F3F', TEMPO: '#D03F3F', LONG: '#F3AD38', EASY: '#14C08C', RECOVERY: '#27B4E0',
  INTERVALS: '#FC4D64',
};

export type PhaseKey = 'base'|'build'|'peak'|'taper'|'race'|'maintenance'|'recovery';
export const PHASE: Record<PhaseKey, { lab: string; name: string; sub: string; focus: string; mesh: Mesh }> = {
  base:  { lab: 'PHASE 01 · WEEKS 1–8',  name: 'BASE',     sub: 'Aerobic foundation',
    focus: 'Build the aerobic engine with easy volume and durability. The patient work that pays off in the fall.',
    mesh: MESH.health },
  build: { lab: 'PHASE 02 · WEEKS 9–16', name: 'BUILD',    sub: 'Threshold & marathon-pace volume',
    focus: 'Sharpen threshold and layer in marathon pace. The two-quality-day weeks where a sub-3 gets built.',
    mesh: MESH.train },
  peak:  { lab: 'PHASE 03 · WEEKS 17–22', name: 'PEAK',    sub: 'Max volume & race simulation',
    focus: 'Your highest weekly load of the block. Top-end fitness and full race-day rehearsals before the taper.',
    mesh: ['#FFA566','#FC4D64','#EC2F54','#C01D48','#A8163F','#4E0A22'] },
  taper: { lab: 'PHASE 04 · WEEKS 23–26', name: 'TAPER',   sub: 'Freshen, sharpen, arrive primed',
    focus: 'Cut the volume, hold the intensity sharp, and roll into Sacramento rested, fresh, and hungry to race.',
    mesh: ['#8EF0B0','#34C194','#1F8A68','#128A64','#137259','#06382E'] },
  race:  { lab: 'FINISH · DEC 6, 2026', name: 'RACE DAY', sub: 'California International Marathon',
    focus: 'Race day. 26.2 miles. Everything you built is on the line. Hold 6:51/mi and don’t bank time early.',
    mesh: MESH.race },
  // 2026-06-03 · Rule 12 · maintenance mode. No race in build window ·
  // holding aerobic fitness + leg turnover. 1 quality/wk, no intervals.
  maintenance: { lab: 'MAINTENANCE', name: 'MAINTENANCE', sub: 'Holding pattern · aerobic base',
    focus: 'No race in the build window yet. Hold the engine warm with steady volume, one weekly threshold, and the long run. We flip into BUILD when the next race gets close.',
    mesh: MESH.health },
  // 2026-06-03 · Rule 13 · post-race recovery. 1-2 weeks low-volume easy.
  recovery: { lab: 'RECOVERY', name: 'RECOVERY', sub: 'Post-race · let the body absorb',
    focus: 'You just raced. Volume drops sharply. Easy running only · no quality. The plan rebuilds as soon as the recovery window closes.',
    mesh: ['#8EF0B0','#34C194','#1F8A68','#128A64','#137259','#06382E'] },
};

export type SeasonType = 'easy'|'recovery'|'intervals'|'tempo'|'mp'|'long'|'vo2'|'sharp'|'rest';
export const SEASON_TYPE_COLOR: Record<SeasonType, string | null> = {
  easy: '#14C08C', recovery: '#27B4E0', intervals: '#FC4D64', tempo: '#D03F3F',
  mp: '#F3AD38',   long: '#F3AD38',     vo2: '#FC4D64',       sharp: '#3EBD41',
  rest: null,
};
export const SEASON_TYPE_NAME: Record<SeasonType, [string,string]> = {
  easy: ['Easy Aerobic','8:45'], recovery: ['Recovery Jog','9:30'],
  intervals: ['Track Intervals','6:05'], tempo: ['Tempo Run','6:38'],
  mp: ['Marathon Pace','6:51'], long: ['Long Run','7:40'],
  vo2: ['VO2 Intervals','5:55'], sharp: ['Sharpener','6:20'],
  rest: ['Rest Day','full recovery'],
};

export const PHASE_TPL: Record<Exclude<PhaseKey,'race'>, [string, SeasonType, number][]> = {
  base:  [['M','easy',.15],['T','easy',.16],['W','easy',.15],['T','rest',0],['F','easy',.12],['S','long',.28],['S','recovery',.14]],
  build: [['M','easy',.13],['T','intervals',.15],['W','tempo',.17],['T','recovery',.10],['F','rest',0],['S','long',.33],['S','easy',.12]],
  peak:  [['M','easy',.12],['T','vo2',.15],['W','mp',.18],['T','recovery',.10],['F','rest',0],['S','long',.33],['S','easy',.12]],
  taper: [['M','easy',.20],['T','tempo',.18],['W','rest',0],['T','recovery',.16],['F','rest',0],['S','sharp',.16],['S','easy',.30]],
  // 2026-06-03 · Rule 12 · maintenance · 1 quality (tempo · NO intervals),
  // 1 long, easies otherwise. Holds aerobic base · no race-specific stress.
  maintenance: [['M','easy',.18],['T','tempo',.16],['W','easy',.18],['T','easy',.14],['F','rest',0],['S','long',.22],['S','recovery',.12]],
  // 2026-06-03 · Rule 13 · recovery · post-race · easy + rest only, no
  // quality, no long. Volume falls sharply.
  recovery: [['M','rest',0],['T','recovery',.16],['W','easy',.20],['T','rest',0],['F','recovery',.14],['S','easy',.24],['S','easy',.26]],
};

export function hexA(hex: string, a: number): string {
  const h = hex.replace('#','');
  const r = parseInt(h.substr(0,2),16), g = parseInt(h.substr(2,2),16), b = parseInt(h.substr(4,2),16);
  return `rgba(${r},${g},${b},${a})`;
}
