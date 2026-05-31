/**
 * Faff design constants · effort palette, mesh themes, planned segments,
 * weekly demo data, season phases. Lifted from the approved Faff Web App
 * prototype (handoff bundle 2026-05-30). Treat as canonical for visuals;
 * real runtime data overrides demo arrays where the backend has it.
 */

export type EffortKey = 'recovery' | 'easy' | 'long' | 'tempo' | 'intervals' | 'rest';
export type Mesh = [string, string, string, string, string, string]; // c1, c2, c3, c4, c5, base
export type ViewKey =
  | 'today' | 'train' | 'health' | 'targets' | 'race' | 'activity' | 'profile' | 'spectator';

export const EFF: Record<EffortKey, { mesh: Mesh; dot: string; mark: number; lbl: string }> = {
  // Effort meshes · canonical "Effort Mesh Background" handoff spec
  // (2026-05-31, locked). Luminous values, no brown. Recovery + easy
  // intentionally share the teal mesh; they differ only by the accent
  // dot. Spec: light to deep [c1, c2, c3, c4, c5, base]. Per-day
  // re-theme cross-fades all 6 stops over 0.7s (handled in CSS).
  recovery:  { mesh: ['#8FF0E0','#46CFC6','#2FC0E6','#23A98E','#1B8C7C','#0E5A54'], dot: '#27B4E0', mark: 8,  lbl: 'VERY EASY' },
  easy:      { mesh: ['#8FF0E0','#46CFC6','#2FC0E6','#23A98E','#1B8C7C','#0E5A54'], dot: '#48B3B5', mark: 26, lbl: 'EASY' },
  long:      { mesh: ['#FFE7B0','#F8BC4E','#F0A638','#EC8C2A','#D9791C','#A85A14'], dot: '#F3AD38', mark: 54, lbl: 'MODERATE' },
  tempo:     { mesh: ['#FFD2A4','#FF9A54','#FB6E3C','#F4502F','#E23A47','#9E2438'], dot: '#FF8847', mark: 80, lbl: 'HARD' },
  intervals: { mesh: ['#FFDA84','#FF8A54','#FF526C','#E82B49','#C61E46','#7E1432'], dot: '#FC4D64', mark: 94, lbl: 'MAX' },
  rest:      { mesh: ['#C4C8D2','#9CA2B0','#787E8E','#58606E','#3E4350','#252935'], dot: '#8A90A0', mark: 4,  lbl: 'OFF' },
};

// View meshes · canonical "you" green for personal surfaces (health/profile),
// ember for race/targets, amber for train (build phase default).
export const MESH: Record<Exclude<ViewKey,'today'>, Mesh> = {
  train:     ['#FFE0A0','#F3AD38','#E89B3A','#E07A2A','#C47812','#3E2A0A'],
  activity:  ['#D6BE98','#B2916A','#8A6A48','#5E4630','#45331F','#1C140D'],
  health:    ['#8EF0B0','#34C194','#1F8A8A','#128A64','#137259','#06382E'],
  targets:   ['#FFD27A','#FF7A45','#FC4D64','#D6263C','#9E1733','#3A0E12'],
  profile:   ['#8EF0B0','#34C194','#1F8A8A','#128A64','#137259','#06382E'],
  spectator: ['#8EF0B0','#34C194','#1F8A8A','#128A64','#137259','#06382E'],
  race:      ['#FFD27A','#FF7A45','#FC4D64','#D6263C','#9E1733','#3A0E12'],
};

export type Segment = { l: string; sub: string; w: number; c: string };
export const SEGS: Record<EffortKey, Segment[]> = {
  easy:      [{ l: 'Easy aerobic',   sub: '6.0 mi · 8:45/mi',     w: 100, c: '#14C08C' }],
  intervals: [
    { l: 'Warm-up',     sub: '1.5 mi easy',         w: 18, c: '#14C08C' },
    { l: '6 × 800 m',   sub: '@ 2:55 · 400m float', w: 64, c: '#FC4D64' },
    { l: 'Cool-down',   sub: '1.5 mi easy',         w: 18, c: '#14C08C' },
  ],
  tempo:     [
    { l: 'Warm-up',     sub: '1.5 mi easy',         w: 19, c: '#14C08C' },
    { l: 'Tempo block', sub: '5.0 mi @ 6:38',       w: 62, c: '#FF8847' },
    { l: 'Cool-down',   sub: '1.5 mi easy',         w: 19, c: '#14C08C' },
  ],
  recovery:  [{ l: 'Recovery jog',  sub: '4.0 mi · 9:30/mi',     w: 100, c: '#27B4E0' }],
  long:      [
    { l: 'Steady',      sub: '14 mi @ 7:40',        w: 78, c: '#F3AD38' },
    { l: 'MP finish',   sub: '4 mi @ 6:50',         w: 22, c: '#FF8847' },
  ],
  rest:      [{ l: 'Rest day',      sub: 'Full recovery, no run', w: 100, c: '#8A90A0' }],
};

export const KIT: Record<EffortKey, { weather: string; shoe: string; fuel: string; coach: string }> = {
  easy:      { weather: '66° · Calm', shoe: 'Novablast 5',   fuel: ' · ',            coach: 'Keep it truly easy. Nose-breathing pace the whole way.' },
  intervals: { weather: '63° · Calm', shoe: 'SC Trainer v3', fuel: 'PF 30 pre',      coach: "Full float between reps. Don't bleed the recoveries." },
  tempo:     { weather: '67° · Calm', shoe: 'Zoom Fly 6',    fuel: 'PF 30 @ mi 5',   coach: 'Hold 6:38. Sustainable but focused. The back half is the test.' },
  recovery:  { weather: '66° · Calm', shoe: 'Vomero Plus',   fuel: ' · ',            coach: 'Shake the legs out. Slower than feels right is correct.' },
  long:      { weather: '64° · Calm', shoe: 'Superblast 3',  fuel: 'PF 30 @ 5·10·15',coach: 'Easy first 10, then squeeze the last 4 to marathon pace.' },
  rest:      { weather: ' · ',        shoe: ' · ',           fuel: ' · ',            coach: 'Rest is training. Sleep, hydrate, mobilize. Let the work land.' },
};

export const ZC = ['#14C08C','#3EBD41','#F3AD38','#FF8847','#FC4D64'];

export type PlannedDay = {
  dw: string; dn: number; full: string;
  /** ISO YYYY-MM-DD for the day. Optional during FALLBACK rendering when
   *  the seed loader hasn't resolved real dates yet. */
  iso?: string;
  type: EffortKey; name: string;
  dist: string; pace: string; est: string;
  done?: boolean; today?: boolean;
  /** Strava activity / run id when the day has been completed. Drives the
   *  lazy-fetched run-detail in week-row clicks + today's RESULT card. */
  activityId?: string | null;
  /** Planned HR cap (bpm) from workout_spec.hr_cap_bpm. Surfaced on the
   *  PlannedHeroV2 TARGETS row. null when no spec or no HR-band data. */
  hrCap?: number | null;
  /** Runner explicitly skipped this day (day_actions.action='skip'). When
   *  true: week-strip card grayscales, hero swaps to SKIPPED state. */
  skipped?: boolean;
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
};

export type CompletedRun = {
  win: string; winx: string;
  time: string; apace: string; hr: number; peak: number;
  zones: [number,number,number,number,number];
  weather: string; shoe: string; fuel?: string; cal: number; gain: number;
  splits: Array<[string, number, string, string]>; // mile, fill%, pace, color
  recap: string;
};

export const SHOES_DEFAULT = [
  { nm: 'SC Trainer v3', role: 'RACE',     col: '#FC4D64', mi: 142, max: 400 },
  { nm: 'Superblast 3',  role: 'LONG',     col: '#F3AD38', mi: 210, max: 400 },
  { nm: 'Zoom Fly 6',    role: 'TEMPO',    col: '#FF8847', mi: 88,  max: 350 },
  { nm: 'Novablast 5',   role: 'RECOVERY', col: '#27B4E0', mi: 64,  max: 400 },
  { nm: 'Vomero Plus',   role: 'EASY',     col: '#14C08C', mi: 120, max: 400 },
];

export const ROLECOL: Record<string,string> = {
  RACE: '#FC4D64', TEMPO: '#FF8847', LONG: '#F3AD38', EASY: '#14C08C', RECOVERY: '#27B4E0',
};

export type PhaseKey = 'base'|'build'|'peak'|'taper'|'race';
export const PHASE: Record<PhaseKey, { lab: string; name: string; sub: string; focus: string; mesh: Mesh }> = {
  base:  { lab: 'PHASE 01 · WEEKS 1–8',  name: 'BASE',     sub: 'Aerobic foundation',
    focus: 'Build the aerobic engine with easy volume and durability. The patient work that pays off in the fall.',
    mesh: MESH.health },
  build: { lab: 'PHASE 02 · WEEKS 9–16', name: 'BUILD',    sub: 'Threshold & marathon-pace volume',
    focus: 'Sharpen threshold and layer in marathon pace. The two-quality-day weeks where a sub-3 gets built.',
    mesh: MESH.train },
  peak:  { lab: 'PHASE 03 · WEEKS 17–22', name: 'PEAK',    sub: 'Max volume & race simulation',
    focus: 'Your highest weekly load of the block. Top-end fitness and full race-day rehearsals before the taper.',
    mesh: ['#FFA566','#FF5A52','#EC2F54','#C01D48','#A8163F','#4E0A22'] },
  taper: { lab: 'PHASE 04 · WEEKS 23–26', name: 'TAPER',   sub: 'Freshen, sharpen, arrive primed',
    focus: 'Cut the volume, hold the intensity sharp, and roll into Sacramento rested, fresh, and hungry to race.',
    mesh: ['#8EF0B0','#34C194','#1F8A68','#128A64','#137259','#06382E'] },
  race:  { lab: 'FINISH · DEC 6, 2026', name: 'RACE DAY', sub: 'California International Marathon',
    focus: 'Race day. 26.2 miles. Everything you built is on the line. Hold 6:51/mi and don’t bank time early.',
    mesh: MESH.race },
};

export type SeasonType = 'easy'|'recovery'|'intervals'|'tempo'|'mp'|'long'|'vo2'|'sharp'|'rest';
export const SEASON_TYPE_COLOR: Record<SeasonType, string | null> = {
  easy: '#14C08C', recovery: '#27B4E0', intervals: '#FC4D64', tempo: '#FF8847',
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
};

export function hexA(hex: string, a: number): string {
  const h = hex.replace('#','');
  const r = parseInt(h.substr(0,2),16), g = parseInt(h.substr(2,2),16), b = parseInt(h.substr(4,2),16);
  return `rgba(${r},${g},${b},${a})`;
}
