/**
 * fact-reciter.ts — deterministic, structured "facts" for every coach
 * surface. Zero LLM, zero prose. The runner sees a list of CAPS-tracked
 * labels with terse values.
 *
 * Cardinal Rule #1 (PROJECT.md, locked 2026-05-28): "Zero LLM · anywhere
 * · ever." This file replaces lib/coach/engine.ts (the Anthropic
 * tool-use loop) for every surface.
 *
 * Tone is intentionally flat — facts only, no flourish. Polishing the
 * voice is a future round (PROJECT.md / memory: "WE ARE NOT USING LLM
 * AT ALL. When in doubt just have the coach recite facts and we can
 * dial in the tone of voice later.").
 *
 * Each reciter is PURE — input → output, no async, no fetch, no DB.
 * Callers (the /api/coach/facts route + cron-warm paths) load the
 * underlying state via the existing per-surface state loaders and pass
 * it in.
 */

import type { GlanceState } from './glance-state';
import type { TrainingState, PlanWeek } from './training-state';
import type { RacesState, RaceRow } from './races-state';
import type { HealthState } from './health-state';
import type { ProfileState } from './profile-state';
import type { ReadinessBreakdown } from './readiness';

// ── Public types ───────────────────────────────────────────────────────

export type CoachFactColor =
  | 'default'
  | 'green'
  | 'amber'
  | 'over'
  | 'race';

export interface CoachFact {
  /** Caps-tracked label (the reciter writes it caps already; the
   *  renderer applies `letter-spacing` styling). e.g. "TODAY · WORKOUT". */
  label: string;
  /** The fact itself — terse, structured. e.g. "EASY 6.1 mi" or "—". */
  value: string;
  /** Optional emphasis color for the value. Maps to a CSS variable on
   *  the renderer side. Default = ink. */
  valueColor?: CoachFactColor;
  /** Optional second line. e.g. "build wk 6 of 12". */
  meta?: string;
}

export interface CoachFactBlock {
  surface: 'today' | 'plan' | 'races' | 'race_detail' | 'health' | 'me';
  /** Pass-through day/mode state so the renderer can do filtering or
   *  per-state styling (e.g. RACE_WEEK uses the race-orange wash). */
  state?: string;
  facts: CoachFact[];
}

const DASH = '—';

// ── Tiny helpers ───────────────────────────────────────────────────────

const DOW_LONG = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function dowOf(iso: string): string {
  return DOW_LONG[new Date(iso + 'T12:00:00Z').getUTCDay()] ?? '—';
}

function fmtMi(mi: number | null | undefined, digits = 1): string {
  if (mi == null || !isFinite(mi)) return DASH;
  return `${mi.toFixed(digits)} mi`;
}

function emptyFact(label: string): CoachFact {
  return { label, value: DASH, meta: 'no data yet' };
}

function workoutValue(type: string | null, mi: number | null): string {
  const t = (type ?? '').toLowerCase();
  if (t === 'rest' || t === 'rest_day') return 'REST';
  if (!t || t === 'unplanned') return mi && mi > 0.05 ? `RUN ${fmtMi(mi)}` : 'OPEN';
  const label = t.toUpperCase();
  return mi && mi > 0.05 ? `${label} ${fmtMi(mi)}` : label;
}

function bandColorForReadiness(band: ReadinessBreakdown['band']): CoachFactColor {
  switch (band) {
    case 'sharp':     return 'green';
    case 'ready':     return 'green';
    case 'moderate':  return 'amber';
    case 'pull-back': return 'over';
    default:          return 'default';
  }
}

function loadBand(acwr: number): { name: string; color: CoachFactColor } {
  if (acwr < 0.8)  return { name: 'detraining',  color: 'amber' };
  if (acwr < 1.0)  return { name: 'building',    color: 'green' };
  if (acwr <= 1.3) return { name: 'sweet spot',  color: 'green' };
  if (acwr <= 1.5) return { name: 'elevated',    color: 'amber' };
  return                  { name: 'spike',       color: 'over' };
}

// ── TODAY ──────────────────────────────────────────────────────────────

/**
 * The /today surface — the daily home. Runner cracks the app, scans 8
 * facts: today's workout, body readiness, week status, sleep, load,
 * RHR, HRV, next race horizon. No prose, no character — just facts.
 */
export function reciteToday(glance: GlanceState): CoachFactBlock {
  const facts: CoachFact[] = [];

  // TODAY · WORKOUT — pull from the week strip's "today" row.
  const todayRow = glance.weekDays.find((d) => d.isToday) ?? null;
  if (glance.todaySkipped) {
    facts.push({
      label: 'TODAY · WORKOUT',
      value: 'SKIPPED',
      valueColor: 'amber',
      meta: todayRow ? `was ${workoutValue(todayRow.plannedType, todayRow.plannedMi)}` : undefined,
    });
  } else if (todayRow) {
    facts.push({
      label: 'TODAY · WORKOUT',
      value: workoutValue(todayRow.plannedType, todayRow.plannedMi),
      meta: todayRow.plannedLabel ?? undefined,
    });
  } else {
    facts.push(emptyFact('TODAY · WORKOUT'));
  }

  // BODY READINESS
  const r = glance.readiness;
  facts.push({
    label: 'BODY READINESS',
    value: `${r.label} ${r.score} / 100`,
    valueColor: bandColorForReadiness(r.band),
  });

  // WEEK · X of Y · remaining
  if (glance.weekPlanned != null && glance.weekPlanned > 0) {
    const remaining = Math.max(0, +(glance.weekPlanned - glance.weekDone).toFixed(1));
    facts.push({
      label: 'WEEK',
      value: `${glance.weekDone.toFixed(1)} of ${glance.weekPlanned.toFixed(1)} mi`,
      meta: `${remaining.toFixed(1)} mi remaining`,
    });
  } else {
    facts.push({
      label: 'WEEK',
      value: `${glance.weekDone.toFixed(1)} mi done`,
      meta: 'no weekly plan',
    });
  }

  // SLEEP · 7d avg
  if (glance.sleep7Avg != null) {
    const deficit = glance.sleep7Deficit;
    const meta = deficit > 0
      ? `${deficit.toFixed(1)}h short of 7.5h target`
      : 'at target';
    facts.push({
      label: 'SLEEP',
      value: `${glance.sleep7Avg.toFixed(1)}h avg over 7 days`,
      valueColor: deficit >= 5 ? 'over' : deficit >= 3 ? 'amber' : 'default',
      meta,
    });
  } else {
    facts.push(emptyFact('SLEEP'));
  }

  // LOAD · Gabbett ACWR
  if (glance.loadAcwr != null) {
    const b = loadBand(glance.loadAcwr);
    facts.push({
      label: 'LOAD',
      value: `${glance.loadAcwr.toFixed(2)} ACWR · ${b.name}`,
      valueColor: b.color,
      meta: 'Gabbett 7d : 28d ratio',
    });
  } else {
    facts.push({
      label: 'LOAD',
      value: DASH,
      meta: 'needs ≥ 3 runs in last 28 days',
    });
  }

  // RHR · vs baseline
  if (glance.rhrCurrent != null) {
    const delta = glance.rhrBaseline != null
      ? glance.rhrCurrent - glance.rhrBaseline
      : null;
    let meta: string | undefined;
    let color: CoachFactColor = 'default';
    if (delta != null && glance.rhrBaseline != null) {
      if (delta <= -2)     meta = `${Math.abs(delta)} below ${glance.rhrBaseline} base`;
      else if (delta <= 1) meta = `at ${glance.rhrBaseline} base`;
      else                 meta = `${delta} above ${glance.rhrBaseline} base`;
      if (delta >= 5) color = 'over';
      else if (delta >= 3) color = 'amber';
      else if (delta <= -2) color = 'green';
    }
    facts.push({
      label: 'RHR',
      value: `${glance.rhrCurrent} bpm`,
      valueColor: color,
      meta,
    });
  } else {
    facts.push(emptyFact('RHR'));
  }

  // HRV
  if (glance.hrvCurrent != null) {
    const delta = glance.hrvBaseline != null
      ? glance.hrvCurrent - glance.hrvBaseline
      : null;
    let meta: string | undefined;
    let color: CoachFactColor = 'default';
    if (delta != null && glance.hrvBaseline != null) {
      if (delta >= 5)       { meta = `${delta} above ${glance.hrvBaseline} base`; color = 'green'; }
      else if (delta >= -4) { meta = `at ${glance.hrvBaseline} base`; }
      else                  { meta = `${Math.abs(delta)} below ${glance.hrvBaseline} base`; color = 'amber'; }
    }
    facts.push({
      label: 'HRV',
      value: `${glance.hrvCurrent} ms`,
      valueColor: color,
      meta,
    });
  } else {
    facts.push(emptyFact('HRV'));
  }

  // NEXT RACE
  if (glance.nextARaceName && glance.daysToARace != null) {
    facts.push({
      label: 'NEXT RACE',
      value: `${glance.nextARaceName.toUpperCase()} · ${glance.daysToARace} day${glance.daysToARace === 1 ? '' : 's'}`,
      valueColor: 'race',
    });
  } else {
    facts.push({
      label: 'NEXT RACE',
      value: DASH,
      meta: 'no A-race on the calendar',
    });
  }

  return {
    surface: 'today',
    state: glance.todaySkipped ? 'skipped' : (glance.daysToARace != null && glance.daysToARace <= 7 ? 'race-week' : undefined),
    facts,
  };
}

// ── PLAN (training) ────────────────────────────────────────────────────

export function recitePlan(state: TrainingState): CoachFactBlock {
  const facts: CoachFact[] = [];
  const today = state.today;

  // PHASE · BUILD · week N of M
  if (state.currentPhase && state.currentWeekIdx != null && state.weeks.length > 0) {
    const totalWeeks = state.weeks.length;
    facts.push({
      label: 'PHASE',
      value: `${state.currentPhase.toUpperCase()} · week ${state.currentWeekIdx + 1} of ${totalWeeks}`,
    });
  } else if (state.plan_id) {
    facts.push({ label: 'PHASE', value: 'PLAN ACTIVE', meta: 'phase not yet set' });
  } else {
    facts.push({ label: 'PHASE', value: 'NO ACTIVE PLAN', meta: '/plan/generate to build one' });
  }

  // THIS WEEK · planned mi
  if (state.weekPlanned != null && state.weekPlanned > 0) {
    facts.push({
      label: 'THIS WEEK',
      value: `${state.weekPlanned.toFixed(1)} mi planned`,
      meta: `${state.weekDone.toFixed(1)} mi done so far`,
    });
  } else {
    facts.push(emptyFact('THIS WEEK'));
  }

  // NEXT QUALITY
  if (state.nextQuality) {
    const nq = state.nextQuality;
    const dow = dowOf(nq.date);
    facts.push({
      label: 'NEXT QUALITY',
      value: `${dow} · ${nq.type.toUpperCase()} ${fmtMi(nq.mi)}`,
      meta: nq.label ?? undefined,
    });
  } else {
    facts.push({
      label: 'NEXT QUALITY',
      value: DASH,
      meta: 'no upcoming quality session',
    });
  }

  // LONG · next long run
  const longDay = findUpcomingLong(state, today);
  if (longDay) {
    facts.push({
      label: 'LONG',
      value: `${dowOf(longDay.date)} · ${fmtMi(longDay.mi)}`,
      meta: longDay.label ?? undefined,
    });
  } else {
    facts.push({ label: 'LONG', value: DASH, meta: 'no scheduled long run' });
  }

  // WEEKS TO RACE · build / peak / taper count
  if (state.race && state.phases.length > 0) {
    const phaseLine = state.phases
      .map((p) => `${p.endWeekIdx - p.startWeekIdx + 1} wk ${p.label.toLowerCase()}`)
      .join(' · ');
    facts.push({
      label: 'WEEKS TO RACE',
      value: `${state.race.days_to_race} days to ${state.race.name}`,
      valueColor: 'race',
      meta: phaseLine,
    });
  } else if (state.race) {
    facts.push({
      label: 'WEEKS TO RACE',
      value: `${state.race.days_to_race} days to ${state.race.name}`,
      valueColor: 'race',
    });
  }

  return { surface: 'plan', facts };
}

function findUpcomingLong(
  state: TrainingState,
  today: string,
): PlanWeek['days'][number] | null {
  for (const w of state.weeks) {
    for (const d of w.days) {
      if (d.date >= today && d.type === 'long' && d.mi > 0) return d;
    }
  }
  return null;
}

// ── RACES (season view) ────────────────────────────────────────────────

export function reciteRaces(state: RacesState): CoachFactBlock {
  const facts: CoachFact[] = [];

  // NEXT A — the headline race
  if (state.aRace) {
    const a = state.aRace;
    const dist = a.distance_label ?? (a.distance_mi != null ? `${a.distance_mi.toFixed(1)} mi` : null);
    const distBit = dist ? ` · ${dist.toLowerCase()}` : '';
    facts.push({
      label: 'NEXT A',
      value: `${a.name.toUpperCase()} · ${a.days} day${a.days === 1 ? '' : 's'}${distBit}`,
      valueColor: 'race',
    });
    // GOAL
    facts.push({
      label: 'GOAL',
      value: a.goal ?? DASH,
      valueColor: a.goal ? 'race' : 'default',
      meta: a.goal ? undefined : 'no goal set',
    });
  } else {
    facts.push({ label: 'NEXT A', value: DASH, meta: 'no A-race on the calendar' });
  }

  // Other upcoming A races (when stacked)
  if (state.aRaces.length > 1) {
    const others = state.aRaces.slice(1);
    facts.push({
      label: 'OTHER A',
      value: `${others.length} more upcoming`,
      valueColor: 'race',
      meta: others.map((r) => `${r.name} (${r.days}d)`).join(' · '),
    });
  }

  // B-races
  if (state.upcomingBs.length > 0) {
    const nearest = state.upcomingBs[0];
    facts.push({
      label: 'B',
      value: `${state.upcomingBs.length} upcoming · nearest ${nearest.name} (${nearest.days}d)`,
    });
  } else {
    facts.push({ label: 'B', value: '0 upcoming' });
  }

  // C-races
  if (state.upcomingCs.length > 0) {
    const nearest = state.upcomingCs[0];
    facts.push({
      label: 'C',
      value: `${state.upcomingCs.length} upcoming · nearest ${nearest.name} (${nearest.days}d)`,
    });
  } else {
    facts.push({ label: 'C', value: '0 upcoming' });
  }

  // PAST
  if (state.past.length > 0) {
    const recent = state.past[0];
    const recentBits: string[] = [recent.name];
    if (recent.finishTime) recentBits.push(recent.finishTime);
    facts.push({
      label: 'PAST',
      value: `${state.past.length} completed`,
      meta: `most recent: ${recentBits.join(' · ')}`,
    });
  } else {
    facts.push({ label: 'PAST', value: '0 completed' });
  }

  return { surface: 'races', facts };
}

// ── RACE DETAIL ────────────────────────────────────────────────────────

export function reciteRaceDetail(
  race: RaceRow,
  _glance: GlanceState | null,
): CoachFactBlock {
  const facts: CoachFact[] = [];
  const dist = race.distance_label ?? (race.distance_mi != null ? `${race.distance_mi.toFixed(1)} mi` : null);

  // DISTANCE
  if (dist && race.distance_mi != null) {
    facts.push({
      label: 'DISTANCE',
      value: `${dist} · ${race.distance_mi.toFixed(1)} mi`,
    });
  } else if (dist) {
    facts.push({ label: 'DISTANCE', value: dist });
  } else {
    facts.push(emptyFact('DISTANCE'));
  }

  // DATE
  if (race.date) {
    const meta = race.is_past
      ? `${Math.abs(race.days)} days ago`
      : `${race.days} day${race.days === 1 ? '' : 's'} from now`;
    facts.push({
      label: 'DATE',
      value: race.date,
      valueColor: race.is_past ? 'default' : 'race',
      meta,
    });
  } else {
    facts.push(emptyFact('DATE'));
  }

  // GOAL · with pace per mile when distance + goal both present
  if (race.goal) {
    const pace = paceFromGoal(race.goal, race.distance_mi);
    facts.push({
      label: 'GOAL',
      value: race.goal,
      valueColor: 'race',
      meta: pace ?? undefined,
    });
  } else {
    facts.push({ label: 'GOAL', value: DASH, meta: 'no goal set' });
  }

  // LOCATION
  if (race.location) {
    facts.push({ label: 'LOCATION', value: race.location });
  }

  // FINISH (past races)
  if (race.is_past && race.finishTime) {
    const meta = race.matchedRun?.pace ? `pace ${race.matchedRun.pace}` : undefined;
    facts.push({
      label: 'FINISH',
      value: race.finishTime,
      valueColor: race.pb ? 'green' : 'default',
      meta: race.pb ? `PB${meta ? ' · ' + meta : ''}` : meta,
    });
  }

  // TAPER (upcoming)
  if (!race.is_past && race.date && race.days > 7) {
    // 7-day taper before race day is standard
    const taperStart = isoMinusDays(race.date, 7);
    facts.push({
      label: 'TAPER STARTS',
      value: taperStart,
      meta: `7 days out · ${race.days - 7} days from now`,
    });
  }

  return { surface: 'race_detail', state: race.is_past ? 'past' : (race.days <= 7 ? 'race-week' : undefined), facts };
}

function isoMinusDays(date: string, days: number): string {
  const t = Date.parse(date + 'T12:00:00Z');
  if (isNaN(t)) return DASH;
  return new Date(t - days * 86400000).toISOString().slice(0, 10);
}

function paceFromGoal(goal: string, distanceMi: number | null): string | null {
  if (!distanceMi || distanceMi <= 0) return null;
  // Parse H:MM:SS or M:SS
  const m = goal.trim().match(/^(?:(\d+):)?(\d+):(\d{2})$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const totalSec = h * 3600 + mm * 60 + ss;
  if (totalSec <= 0) return null;
  const paceSec = Math.round(totalSec / distanceMi);
  const pm = Math.floor(paceSec / 60);
  const ps = paceSec % 60;
  return `${pm}:${String(ps).padStart(2, '0')}/mi pace`;
}

// ── HEALTH ─────────────────────────────────────────────────────────────

export function reciteHealth(state: HealthState): CoachFactBlock {
  const facts: CoachFact[] = [];

  // WATCH MODE
  const modeColor: CoachFactColor =
    state.watchMode === 'watch-red'    ? 'over' :
    state.watchMode === 'watch-amber'  ? 'amber' :
    state.watchMode === 'green'        ? 'green' :
                                         'default';
  facts.push({
    label: 'WATCH MODE',
    value: state.watchMode.toUpperCase().replace(/-/g, ' '),
    valueColor: modeColor,
    meta: state.watchItems.length > 0
      ? `${state.watchItems.length} item${state.watchItems.length === 1 ? '' : 's'} on the list`
      : undefined,
  });

  // SLEEP · 7d avg + deficit
  if (state.sleep.avg7n != null) {
    const deficit = state.sleep.deficit7;
    facts.push({
      label: 'SLEEP 7d',
      value: `${state.sleep.avg7n.toFixed(1)}h avg`,
      valueColor: deficit >= 5 ? 'over' : deficit >= 3 ? 'amber' : 'green',
      meta: deficit > 0
        ? `${deficit.toFixed(1)}h short of 7.5h target`
        : 'at or above 7.5h target',
    });
  } else {
    facts.push(emptyFact('SLEEP 7d'));
  }

  // RHR
  if (state.rhr.current != null) {
    const delta = state.rhr.delta;
    let color: CoachFactColor = 'default';
    let meta: string | undefined;
    if (delta != null && state.rhr.baseline != null) {
      if (delta >= 5)       { meta = `+${delta} vs ${state.rhr.baseline} bpm base`; color = 'over'; }
      else if (delta >= 3)  { meta = `+${delta} vs ${state.rhr.baseline} bpm base`; color = 'amber'; }
      else if (delta <= -2) { meta = `${delta} vs ${state.rhr.baseline} bpm base`; color = 'green'; }
      else                  { meta = `at ${state.rhr.baseline} bpm base`; }
    }
    facts.push({
      label: 'RHR 60d',
      value: `${state.rhr.current} bpm`,
      valueColor: color,
      meta,
    });
  } else {
    facts.push(emptyFact('RHR 60d'));
  }

  // HRV
  if (state.hrv.current != null) {
    const pct = state.hrv.pctAboveBaseline;
    let color: CoachFactColor = 'default';
    let meta: string | undefined;
    if (pct != null && state.hrv.baseline != null) {
      const sign = pct >= 0 ? '+' : '';
      meta = `${sign}${pct}% vs ${state.hrv.baseline} ms base`;
      if (pct >= 5)        color = 'green';
      else if (pct >= -4)  color = 'default';
      else                 color = 'amber';
    }
    facts.push({
      label: 'HRV 60d',
      value: `${state.hrv.current} ms`,
      valueColor: color,
      meta,
    });
  } else {
    facts.push(emptyFact('HRV 60d'));
  }

  // WEIGHT (optional — only shown when present)
  if (state.weight.current != null) {
    const delta = state.weight.delta30;
    const meta = delta != null
      ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} lb over 30d`
      : undefined;
    facts.push({
      label: 'WEIGHT',
      value: `${state.weight.current.toFixed(1)} lb`,
      meta,
    });
  }

  // CADENCE (optional)
  if (state.cadence.baseline != null) {
    facts.push({
      label: 'CADENCE 60d',
      value: `${state.cadence.baseline} spm avg`,
    });
  }

  // VO2 (optional)
  if (state.vo2.current != null) {
    facts.push({
      label: 'VO2 MAX',
      value: `${state.vo2.current.toFixed(1)}`,
      meta: 'Apple Watch wellness signal',
    });
  }

  return {
    surface: 'health',
    state: state.watchMode,
    facts,
  };
}

// ── ME (profile) ───────────────────────────────────────────────────────

export function reciteMe(state: ProfileState): CoachFactBlock {
  const facts: CoachFact[] = [];

  // RUNNER · identity
  const idParts: string[] = [];
  if (state.identity.full_name) idParts.push(state.identity.full_name.toUpperCase());
  if (state.identity.age != null) idParts.push(String(state.identity.age));
  if (state.identity.city) idParts.push(state.identity.city.toUpperCase());
  facts.push({
    label: 'RUNNER',
    value: idParts.length > 0 ? idParts.join(' · ') : DASH,
    meta: idParts.length === 0 ? 'identity not yet set' : undefined,
  });

  // TRAINING FOR · next A race + goal
  if (state.nextARace) {
    const a = state.nextARace;
    facts.push({
      label: 'TRAINING FOR',
      value: `${a.name.toUpperCase()} · ${a.days_to_race} day${a.days_to_race === 1 ? '' : 's'}`,
      valueColor: 'race',
      meta: a.goal ? `goal ${a.goal}` : 'no goal set',
    });
  } else {
    facts.push({
      label: 'TRAINING FOR',
      value: DASH,
      meta: 'no A-race on the calendar',
    });
  }

  // LTHR · primary zone anchor (Friel)
  if (state.physiology.lthr != null) {
    facts.push({
      label: 'LTHR',
      value: `${state.physiology.lthr} bpm`,
      meta: state.physiology.lthr_method ?? undefined,
    });
  } else {
    facts.push({
      label: 'LTHR',
      value: DASH,
      meta: 'no LTHR set or derived',
    });
  }

  // VDOT
  if (state.physiology.vdot != null) {
    facts.push({
      label: 'VDOT',
      value: state.physiology.vdot.toFixed(1),
      meta: 'best recent race basis',
    });
  } else {
    facts.push({
      label: 'VDOT',
      value: DASH,
      meta: 'needs a recent A/B race finish',
    });
  }

  // MAX HR
  if (state.physiology.max_hr != null) {
    facts.push({
      label: 'MAX HR',
      value: `${state.physiology.max_hr} bpm`,
      meta: state.physiology.max_hr_source ?? undefined,
    });
  }

  // HR ZONES · 5-row table summarized as one fact (rows in `meta`).
  if (state.physiology.zones && state.physiology.zones.zones.length > 0) {
    const zt = state.physiology.zones;
    const lines = zt.zones.map((z) => `${z.shortLabel} ${z.lower}-${z.upper}`);
    facts.push({
      label: 'HR ZONES',
      value: `${zt.zones.length} zones · ${zt.anchor.label} ${zt.anchor.bpm}`,
      meta: lines.join(' · '),
    });
  }

  // SHOES · count + preferred / newest
  if (state.shoes.length > 0) {
    const preferred = state.shoes.find((s) => s.preferred) ?? state.shoes[0];
    facts.push({
      label: 'SHOES',
      value: `${state.shoes.length} active`,
      meta: `current: ${preferred.name} · ${preferred.mileage} of ${preferred.cap} mi`,
    });
  } else {
    facts.push({
      label: 'SHOES',
      value: '0 active',
      meta: 'add a shoe in /profile',
    });
  }

  return { surface: 'me', facts };
}
