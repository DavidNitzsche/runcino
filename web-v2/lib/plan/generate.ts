/**
 * plan/generate.ts — algorithmic plan generation (v1).
 *
 * Why algorithmic (not LLM-driven): plan STRUCTURE is deterministic
 * doctrine — block periodization is rules. We reserve the LLM for
 * voice/rationale around the structure, never for the structure itself.
 *
 * Every structural rule below cites the canonical research file at
 * `/Research/`. If a rule is added without a citation, that's a bug —
 * see CLAUDE.md "Engine must match research".
 *
 * Block model (Daniels-style, simplified for v1):
 *   - Race week:    deep taper, race day
 *   - Sharpen:      1-2 wks @ 70-80% peak, strides, short tune-up
 *   - Race-specific:2-3 wks @ peak vol, marathon-pace + threshold
 *   - Quality:      4-6 wks ramping, intervals + threshold
 *   - Base:         everything before, easy aerobic + long
 *
 *   Cite: Research/00a-distance-running-training.md §periodization
 *   Cite: Research/04-workout-vocabulary.md §quality-types
 *   Cite: Research/08-pacing-and-race-week.md §taper
 */
import { pool } from '@/lib/db/pool';
import { randomBytes } from 'crypto';
import { loadSettings } from '@/lib/coach/settings';

export type DOW = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sun=0..Sat=6
type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dayKeyToDow = (k: DayKey): DOW => DAY_KEYS.indexOf(k) as DOW;

export interface GenerateInput {
  userId: string;
  raceSlug: string;
}

export interface GenerateResult {
  ok: boolean;
  plan_id?: string;
  weeks_generated?: number;
  reason?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function today(): string {
  return new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

// Monday of the week containing `iso`
function mondayOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const shift = dow === 0 ? -6 : 1 - dow;
  return addDays(iso, shift);
}

// Parse a goal time like "1:35:00" or "3:25:00" → seconds, or null.
function parseGoalSeconds(goal: string | null | undefined): number | null {
  if (!goal) return null;
  const m = String(goal).match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}

// Race distance in miles. Prefers numeric meta.distanceMi (most reliable),
// falls back to label parsing.
function distanceMiOf(meta: any): number {
  const numeric = Number(meta?.distanceMi);
  if (isFinite(numeric) && numeric > 0) return numeric;

  const label: string = String(meta?.distanceLabel ?? meta?.distance_label ?? meta?.name ?? '').toLowerCase();
  if (!label) return 13.1;
  if (label.includes('marathon') && !label.includes('half')) return 26.2;
  if (label.includes('half') || label.includes('21k')) return 13.1;
  if (label.includes('10k')) return 6.2;
  if (label.includes('5k')) return 3.1;
  const m = label.match(/([\d.]+)\s*mi/);
  if (m) return parseFloat(m[1]);
  return 13.1;
}

// Recent 4-week avg weekly volume → starting point for the ramp.
async function recentWeeklyMileage(userId: string): Promise<number> {
  const r = await pool.query(
    `SELECT COALESCE(SUM((data->>'distanceMi')::numeric), 0) AS mi
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::text
            >= (NOW() - interval '28 days')::date::text`,
    [userId]
  ).catch(() => ({ rows: [{ mi: 0 }] }));
  return Math.round((Number(r.rows[0]?.mi ?? 0) / 4) * 10) / 10;
}

// ── Block sizing ────────────────────────────────────────────────────────

interface BlockPlan {
  totalWeeks: number;
  phases: Array<{ label: string; weeks: number; rationale: string; citation: string }>;
}

function sizeBlocks(totalWeeks: number, raceDistanceMi: number): BlockPlan {
  // Marathon vs half — half gets shorter taper + shorter race-specific block.
  const isMarathon = raceDistanceMi >= 20;
  const taperWeeks       = isMarathon ? 3 : 2;
  // Race-specific = the closest-to-race quality block. Sized by race distance,
  // squeezed only if total runway is too short.
  const raceSpecificWks  = Math.min(isMarathon ? 4 : 3, Math.max(0, totalWeeks - taperWeeks - 4));
  // Quality block: bigger when there's more runway, capped at 8.
  const remainingAfterTaperAndRS = totalWeeks - taperWeeks - raceSpecificWks;
  const qualityWeeks     = Math.min(8, Math.max(3, Math.floor(remainingAfterTaperAndRS * 0.6)));
  // Base: everything left, but capped at 8 weeks so we don't stall in aerobic
  // forever when the race is far out. If race is >6 months out, the user is
  // effectively in maintenance — the surplus weeks fold into base anyway.
  const baseWeeks        = Math.min(8, Math.max(0, totalWeeks - taperWeeks - raceSpecificWks - qualityWeeks));
  // If base was capped, redistribute the extras into quality so we don't end
  // up with fewer total weeks than the runway.
  const extraWeeks       = Math.max(0, totalWeeks - taperWeeks - raceSpecificWks - qualityWeeks - baseWeeks);
  const expandedQuality  = qualityWeeks + extraWeeks;

  // Build phase list in chronological order (oldest → race day).
  const phases: BlockPlan['phases'] = [];
  if (baseWeeks > 0) phases.push({
    label: 'BASE',
    weeks: baseWeeks,
    rationale: 'Aerobic foundation — easy volume + long progressions, no quality yet.',
    citation: 'Research/00a-distance-running-training.md §periodization',
  });
  if (expandedQuality > 0) phases.push({
    label: 'QUALITY',
    weeks: expandedQuality,
    rationale: 'Intervals + threshold sessions to lift aerobic ceiling.',
    citation: 'Research/04-workout-vocabulary.md §intervals-and-threshold',
  });
  if (raceSpecificWks > 0) phases.push({
    label: 'RACE-SPECIFIC',
    weeks: raceSpecificWks,
    rationale: 'Pace + long-run integration at race-specific demands.',
    citation: 'Research/00a-distance-running-training.md §race-specific',
  });
  phases.push({
    label: 'TAPER',
    weeks: taperWeeks,
    rationale: 'Volume drops sharply, intensity preserved. Sharpen, then race.',
    citation: 'Research/08-pacing-and-race-week.md §taper',
  });

  return { totalWeeks, phases };
}

// ── Volume curve ────────────────────────────────────────────────────────

/** Experience-level volume floor + ramp tuning (Q-01 / SIM-02).
 *
 * Without these, a true beginner running 5 mpw who picks a goal race got
 * an immediate jump to 15 mpw (3× their actual base) in week 1 — way
 * over the 10% rule. With these, each level has a sensible floor that
 * matches research-grounded base mileage by experience.
 *
 * Cite: Research/00a-distance-running-training.md §volume-by-experience
 * Cite: Research/22-plan-templates.md §minimum-base-by-level
 */
type LevelKey = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;
const VOLUME_FLOOR_MPW: Record<Exclude<LevelKey, null>, number> = {
  beginner: 10,
  intermediate: 15,
  advanced: 20,
  advanced_plus: 25,
};
const RAMP_PCT: Record<Exclude<LevelKey, null>, number> = {
  beginner: 0.05,         // conservative 5%/wk for new runners
  intermediate: 0.07,
  advanced: 0.07,
  advanced_plus: 0.08,    // capable of slightly more aggressive ramp
};

/** Returns target mileage for each week 0..N-1 (chronological).
 *
 * Cite: Research/00a-distance-running-training.md §progressive-overload (10%/wk cap, deload every 4th wk)
 * Cite: Research/08-pacing-and-race-week.md §taper (cut volume, hold intensity)
 *
 * Non-deload weeks ramp by RAMP_PCT (level-scaled, 5-8%); cutback weeks
 * land at 85% of the previous PEAK so the trend climbs cleanly across
 * cycles. Floor scales by experience_level.
 */
function volumeCurve(baseMi: number, blocks: BlockPlan, level: LevelKey): number[] {
  const vols: number[] = [];
  const floor = level ? VOLUME_FLOOR_MPW[level] : VOLUME_FLOOR_MPW.intermediate;
  const ramp  = level ? RAMP_PCT[level]         : RAMP_PCT.intermediate;
  let weekVol = Math.max(floor, baseMi);
  let lastPeak = weekVol;

  let cursor = 0;
  for (const phase of blocks.phases) {
    for (let w = 0; w < phase.weeks; w++) {
      if (phase.label === 'TAPER') {
        const wksLeft = phase.weeks - w;
        const taperFactor = wksLeft === 1 ? 0.45 : wksLeft === 2 ? 0.60 : 0.75;
        vols.push(Math.round(lastPeak * taperFactor));
      } else {
        const isDeload = cursor > 0 && (cursor + 1) % 4 === 0;
        if (cursor > 0) {
          if (isDeload) {
            weekVol = Math.round(lastPeak * 0.85);
          } else {
            weekVol = Math.round(weekVol * (1 + ramp));
            lastPeak = Math.max(lastPeak, weekVol);
          }
        }
        vols.push(weekVol);
      }
      cursor++;
    }
  }
  return vols;
}

// ── Weekly layout ───────────────────────────────────────────────────────

interface DayPlan {
  dow: DOW;
  type: 'easy' | 'long' | 'threshold' | 'intervals' | 'tempo' | 'race' | 'rest' | 'shakeout';
  distanceMi: number;
  isQuality: boolean;
  isLong: boolean;
  subLabel: string | null;
  notes: string;
}

function layoutWeek({
  phase, weekIdx, totalWeeks, weeklyMi, longRunDow, qualityDows, restDow, isRaceWeek, raceDow, raceDistanceMi,
}: {
  phase: string; weekIdx: number; totalWeeks: number;
  weeklyMi: number; longRunDow: DOW; qualityDows: DOW[]; restDow: DOW;
  isRaceWeek: boolean; raceDow: DOW | null; raceDistanceMi: number;
}): DayPlan[] {
  // Race week: all roads lead to race day.
  if (isRaceWeek && raceDow != null) {
    const days: DayPlan[] = [];
    for (let d = 0; d < 7; d++) {
      const dow = d as DOW;
      if (dow === raceDow) {
        days.push({
          dow, type: 'race', distanceMi: raceDistanceMi, isQuality: true, isLong: true,
          subLabel: 'RACE', notes: 'Execute the plan. Pacing in race-week briefing.',
        });
      } else {
        // Day before race: 2mi shakeout w/ strides. 2 days before: rest.
        const daysBeforeRace = (raceDow - dow + 7) % 7;
        if (daysBeforeRace === 1) {
          days.push({ dow, type: 'shakeout', distanceMi: 2, isQuality: false, isLong: false, subLabel: 'SHAKEOUT', notes: '2 mi + 4×20s strides. Loosen the legs.' });
        } else if (daysBeforeRace === 2) {
          days.push({ dow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off feet. Hydrate.' });
        } else if (daysBeforeRace >= 3 && daysBeforeRace <= 5) {
          // Easy 3-4mi w/ light strides midweek
          days.push({ dow, type: 'easy', distanceMi: 3 + (daysBeforeRace === 4 ? 1 : 0), isQuality: false, isLong: false, subLabel: 'EASY', notes: 'Conversational. Strides optional.' });
        } else {
          days.push({ dow, type: daysBeforeRace > 5 ? 'easy' : 'rest', distanceMi: daysBeforeRace > 5 ? 4 : 0, isQuality: false, isLong: false, subLabel: daysBeforeRace > 5 ? 'EASY' : 'REST', notes: '' });
        }
      }
    }
    return days;
  }

  // Standard week: 1 long, 1-2 quality, rest = easy, 1 rest day.
  // Distribute remaining miles across easy days proportionally.
  const longShare    = phase === 'BASE' ? 0.30 : phase === 'TAPER' ? 0.28 : 0.34;
  const qualityShare = phase === 'BASE' ? 0    : phase === 'TAPER' ? 0.18 : 0.22; // total across quality days
  const longMi = Math.round(weeklyMi * longShare);
  const qualityMiEach = qualityDows.length > 0 ? Math.round((weeklyMi * qualityShare) / qualityDows.length) : 0;

  // Pre-allocate: rest = 0, long + quality slotted in
  const slots: (DayPlan | null)[] = new Array(7).fill(null);
  slots[restDow] = { dow: restDow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Sleep, mobility, fuel.' };
  slots[longRunDow] = {
    dow: longRunDow, type: 'long', distanceMi: longMi, isQuality: false, isLong: true,
    subLabel: phase === 'RACE-SPECIFIC' ? `LONG · ${Math.round(longMi * 0.4)}mi @ MP` : 'LONG',
    notes: phase === 'RACE-SPECIFIC'
      ? `Steady ${longMi - Math.round(longMi * 0.4)}mi, then ${Math.round(longMi * 0.4)}mi at race pace.`
      : phase === 'TAPER' ? 'Easy long, hold pace. Quality lives in the race itself.'
      : 'Conversational throughout. Build the engine.',
  };
  if (phase !== 'BASE') {
    const qualityTypes: Array<DayPlan['type']> =
      phase === 'TAPER'         ? ['threshold']                                       // tune-up
      : phase === 'RACE-SPECIFIC' ? ['threshold', 'tempo']                            // sharpening
      : phase === 'QUALITY'       ? (weekIdx % 2 === 0 ? ['intervals', 'threshold'] : ['threshold', 'tempo'])
      : [];
    qualityDows.forEach((dow, i) => {
      if (slots[dow] != null) return; // conflict — skip
      const qt = qualityTypes[i % qualityTypes.length];
      const sub =
        qt === 'intervals'  ? '6×800m @ I pace · 90s jog'
      : qt === 'threshold'  ? '3×1mi @ T pace · 2:00 jog'
      : qt === 'tempo'      ? `${Math.max(3, Math.round(qualityMiEach * 0.6))}mi continuous tempo`
      :                       'QUALITY';
      slots[dow] = {
        dow: dow as DOW, type: qt, distanceMi: qualityMiEach, isQuality: true, isLong: false,
        subLabel: sub,
        notes:
          qt === 'intervals' ? 'WU 1.5mi, reps, CD 1mi. Hold pace, even splits.'
        : qt === 'threshold' ? 'WU 1.5mi, threshold reps, CD 1mi. Comfortably hard.'
        : qt === 'tempo'     ? 'WU 1.5mi, continuous tempo, CD 1mi. Just below threshold.'
        :                      '',
      };
    });
  }

  // Fill remaining slots with easy.
  const allocated = slots.filter(Boolean).reduce((s, d) => s + (d!.distanceMi || 0), 0);
  const remainingMi = Math.max(0, weeklyMi - allocated);
  const easySlots = slots
    .map((s, i) => ({ slot: s, dow: i as DOW }))
    .filter((x) => x.slot == null);
  const perEasy = easySlots.length > 0 ? Math.max(3, Math.round(remainingMi / easySlots.length)) : 0;
  for (const { dow } of easySlots) {
    slots[dow] = {
      dow, type: 'easy', distanceMi: perEasy, isQuality: false, isLong: false,
      subLabel: 'EASY', notes: 'Conversational. Z2 HR cap.',
    };
  }

  return slots as DayPlan[];
}

// ── Persistence ─────────────────────────────────────────────────────────

async function clearActivePlansFor(userId: string): Promise<void> {
  await pool.query(
    `UPDATE training_plans SET archived_iso = NOW()
      WHERE user_uuid = $1 AND archived_iso IS NULL`,
    [userId]
  );
}

async function persistPlan(args: {
  userId: string; raceSlug: string; raceDateISO: string;
  blocks: BlockPlan; weeks: Array<{ startISO: string; phase: string; days: DayPlan[]; isRaceWeek: boolean }>;
  authoredState: Record<string, unknown>;
}): Promise<string> {
  const planId = id('pln');
  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, race_id, goal_iso, authored_state)
     VALUES ($1, 'me', $2, 'race-prep', $3, $4, $5)`,
    [planId, args.userId, args.raceSlug, args.raceDateISO, args.authoredState]
  );

  // Phases (need ids upfront so weeks can reference)
  const phaseIds: string[] = [];
  let cursor = 0;
  for (const ph of args.blocks.phases) {
    const phaseId = id('phs');
    phaseIds.push(phaseId);
    await pool.query(
      `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [phaseId, planId, ph.label, cursor, cursor + ph.weeks - 1, ph.rationale, ph.citation]
    );
    cursor += ph.weeks;
  }

  // Map weekIdx → phaseId
  const phaseForWeek = (idx: number): string => {
    let c = 0;
    for (let i = 0; i < args.blocks.phases.length; i++) {
      const ph = args.blocks.phases[i];
      if (idx >= c && idx < c + ph.weeks) return phaseIds[i];
      c += ph.weeks;
    }
    return phaseIds[phaseIds.length - 1];
  };

  for (let wi = 0; wi < args.weeks.length; wi++) {
    const w = args.weeks[wi];
    const weekId = id('wk');
    await pool.query(
      `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, is_race_week, rationale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [weekId, planId, wi, w.startISO, phaseForWeek(wi), w.isRaceWeek, `${w.phase} · week ${wi + 1}`]
    );

    for (const d of w.days) {
      if (d.distanceMi === 0 && d.type !== 'rest' && d.type !== 'race') continue;
      const wkoId = id('wko');
      const dateISO = addDays(w.startISO, ((d.dow - 1 + 7) % 7));
      // dow stored as 1=Mon..7=Sun in our convention? Use what plan_workouts expects.
      // We pass dow 0..6 (Sun..Sat). Existing reader treats numeric dow + sub_label.
      await pool.query(
        `INSERT INTO plan_workouts (id, plan_id, week_id, date_iso, dow, type, distance_mi,
                                    is_quality, is_long, notes, sub_label,
                                    original_date_iso, original_type, original_distance_mi)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $4, $6, $7)`,
        [wkoId, planId, weekId, dateISO, d.dow, d.type, d.distanceMi,
         d.isQuality, d.isLong, d.notes, d.subLabel]
      );
    }
  }

  return planId;
}

// ── Main entrypoint ─────────────────────────────────────────────────────

export async function generatePlan(input: GenerateInput): Promise<GenerateResult> {
  const { userId, raceSlug } = input;

  // 1. Load the target race
  const raceRow = (await pool.query(`SELECT slug, meta FROM races WHERE slug = $1`, [raceSlug])).rows[0];
  if (!raceRow) return { ok: false, reason: 'race not found' };
  const meta = raceRow.meta ?? {};
  const raceDateISO: string | undefined = meta.date;
  if (!raceDateISO) return { ok: false, reason: 'race missing date' };

  const totalDays = daysBetween(today(), raceDateISO);
  if (totalDays < 14) return { ok: false, reason: 'race < 2 weeks away; use race-week briefing only' };
  if (totalDays > 365) return { ok: false, reason: 'race > 1 year out; plan only when within a year' };

  const raceDistanceMi = distanceMiOf(meta);
  const goalSec = parseGoalSeconds(meta.goalDisplay);
  const goalPaceSec = goalSec ? Math.round(goalSec / raceDistanceMi) : null;

  // 2. Load user prefs for layout
  const prefs = await loadSettings(userId).catch(() => null);
  const longRunDow  = dayKeyToDow((prefs?.long_run_day ?? 'sun') as DayKey);
  const restDow     = dayKeyToDow((prefs?.rest_day ?? 'sat') as DayKey);
  const qualityDows = (prefs?.quality_days ?? ['tue', 'thu']).map((d) => dayKeyToDow(d as DayKey));

  // P34 — cross-training opt-in. If the runner has cross_training_modes
  // set on profile (bike/swim/strength/other), we tag the rest day's
  // sub_label so the plan shows the activity instead of just "REST".
  // (Type stays 'rest' so distance + readiness logic don't break.)
  const ctRow = (await pool.query(
    `SELECT cross_training_modes FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0];
  const crossModes: string[] = Array.isArray(ctRow?.cross_training_modes)
    ? ctRow.cross_training_modes : [];

  // 3. Determine week count + block sizes
  // The plan starts on the Monday of "this week", ends on the week containing race day.
  const startMonday = mondayOf(today());
  const raceMonday  = mondayOf(raceDateISO);
  const totalWeeks = daysBetween(startMonday, raceMonday) / 7 + 1;
  if (totalWeeks < 3) return { ok: false, reason: 'plan needs at least 3 weeks runway' };

  const blocks = sizeBlocks(totalWeeks, raceDistanceMi);
  const recentMi = await recentWeeklyMileage(userId);

  // Read experience_level for volume-curve scaling (Q-01 / SIM-02 fix).
  // Falls back to 'intermediate' shape when unknown.
  const expRow = (await pool.query<{ experience_level: string | null }>(
    `SELECT experience_level FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  const level = (expRow?.experience_level ?? null) as LevelKey;

  const vols = volumeCurve(recentMi, blocks, level);

  // 4. Build each week
  const weeks: Array<{ startISO: string; phase: string; days: DayPlan[]; isRaceWeek: boolean }> = [];
  let phaseCursor = 0;
  let phaseWkRemaining = blocks.phases[0].weeks;
  let phaseLabel = blocks.phases[0].label;
  for (let wi = 0; wi < totalWeeks; wi++) {
    while (phaseWkRemaining === 0) {
      phaseCursor++;
      phaseWkRemaining = blocks.phases[phaseCursor].weeks;
      phaseLabel = blocks.phases[phaseCursor].label;
    }
    const weekStart = addDays(startMonday, wi * 7);
    const isRaceWeek = wi === totalWeeks - 1;
    const raceDow: DOW | null = isRaceWeek
      ? ((new Date(raceDateISO + 'T12:00:00Z').getUTCDay()) as DOW)
      : null;
    const days = layoutWeek({
      phase: phaseLabel,
      weekIdx: wi,
      totalWeeks,
      weeklyMi: vols[wi],
      longRunDow,
      qualityDows,
      restDow,
      isRaceWeek,
      raceDow,
      raceDistanceMi,
    });
    // P34 — relabel the rest day with cross-training activity when opted
    // in. Rotates through enabled modes across weeks so the runner gets
    // variety (bike one week, swim the next, etc.). Strength gets one
    // dedicated day every other week when it's in the mix.
    if (crossModes.length > 0) {
      const restDay = days.find((d) => d.type === 'rest' && d.distanceMi === 0);
      if (restDay) {
        const mode = crossModes[wi % crossModes.length];
        const subLabel = mode === 'strength' ? 'STRENGTH'
          : mode === 'bike' ? 'BIKE 45-60 MIN'
          : mode === 'swim' ? 'SWIM 30-40 MIN'
          : 'CROSS-TRAIN';
        restDay.subLabel = subLabel;
        restDay.notes = `Cross-training: ${mode}. Easy effort. Not a run replacement — keeps the engine humming on a non-impact day.`;
      }
    }
    weeks.push({ startISO: weekStart, phase: phaseLabel, days, isRaceWeek });
    phaseWkRemaining--;
  }

  // 5. Archive existing active plans, then persist
  await clearActivePlansFor(userId);

  const planId = await persistPlan({
    userId, raceSlug, raceDateISO, blocks, weeks,
    authoredState: {
      generated_at: new Date().toISOString(),
      total_weeks: totalWeeks,
      race_distance_mi: raceDistanceMi,
      goal_pace_s_per_mi: goalPaceSec,
      recent_avg_mpw: recentMi,
      citations: blocks.phases.map((p) => p.citation),
    },
  });

  return { ok: true, plan_id: planId, weeks_generated: totalWeeks };
}
