/**
 * lib/onboarding/complete-inputs.ts — what the runner typed becomes what the
 * engine is told, here.
 *
 * Extracted 2026-08-24 from `POST /api/onboarding/complete` (byte-identical
 * logic, zero behaviour change) so the front door can be walked with no
 * database, no session and no HTTP. Every comment below came with its line.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEAM AND NOT A HELPER
 *
 * This function is where an answer can be silently DROPPED. Every field is
 * validated against a fixed set and a value outside that set becomes `null`
 * without an error — deliberately, because partial input beats a refusal on
 * a form the runner cannot see the rules of. That tolerance is also how four
 * answers reached nothing at all until the 2026-08-21 onboarding audit: a
 * `weeklyFreq` of 7 off a `2...7` stepper, a `weeklyMi` of 24 off a rung set
 * that has no 24 in it, a race-history entry with no `whenRaced`, and a
 * `longRunDay` that was patched in AFTER the plan had already been authored
 * against the default Sunday.
 *
 * A dropped answer is invisible from inside the route. From outside, with the
 * derived inputs in hand, it is a value that went in and did not come out.
 * `lib/onboarding/_onboarding_e2e.test.ts` walks it.
 */
import {
  HIST_AVG_MIDPOINTS,
  HIST_LONG_MIDPOINTS,
  // The rung ladder is doctrine-bound (`VOLUME.onboarding-ladder-reaches-doctrine`
  // cites `lib/onboarding/state.ts#VALID_WEEKLY_MI`), so it is re-exported from
  // there rather than restated here. A second copy is a second answer.
  VALID_WEEKLY_MI,
  type HistAvg,
  type HistLong,
  type HistYears,
  type TTDistance,
  type WeeklyMileage,
  type WeeklyFrequency,
  type RaceHistoryEntry,
  type RaceHistoryDistance,
  type RaceHistoryWhen,
} from './state';

export const VALID_DISTANCES = new Set(['5k', '10k', 'half', 'marathon', 'none', 'coached']);
export const VALID_TT_DISTANCES = new Set<TTDistance>(['1mi', '5k', '10k']);
export { VALID_WEEKLY_MI };
export const VALID_FREQ = new Set<WeeklyFrequency>([0, 1, 2, 3, 4, 5, 6]);
export const VALID_EXPERIENCE = new Set<string>(['beginner', 'intermediate', 'advanced', 'advanced_plus']);
// ZEROSAY-1 (2026-08-19) · '0' on both ladders · see lib/onboarding/state.ts.
export const VALID_HIST_AVG = new Set<HistAvg>(['0', '0-5', '5-15', '15-25', '25-35', '35+', '45+', '45-60', '60-80', '80+']);
export const VALID_HIST_LONG = new Set<HistLong>(['0', '0-3', '3-6', '6-10', '10+', '10-16', '16-22', '22+']);
export const VALID_HIST_YEARS = new Set<HistYears>(['<1', '1-3', '3-7', '7+']);
export const VALID_RACE_HIST_DISTANCES = new Set<RaceHistoryDistance>(['5k', '10k', 'half', 'marathon', 'other']);
export const VALID_RACE_HIST_WHEN = new Set<RaceHistoryWhen>(['<6mo', '6-12mo', '1-2yr', '2+yr']);
export const RACE_HISTORY_MAX_ENTRIES = 3;
export const VALID_DAY_KEYS = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

/** Validate + normalize the body.raceHistory array. Skips bad entries
 *  rather than rejecting the whole request · partial-input tolerance. */
export function validateRaceHistory(raw: unknown): RaceHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RaceHistoryEntry[] = [];
  for (const item of raw) {
    if (out.length >= RACE_HISTORY_MAX_ENTRIES) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const distance = r.distance as string | undefined;
    const timeSec = Number(r.timeSec);
    const whenRaced = r.whenRaced as string | undefined;
    if (!distance || !VALID_RACE_HIST_DISTANCES.has(distance as RaceHistoryDistance)) continue;
    if (!Number.isFinite(timeSec) || timeSec < 60 || timeSec > 3600 * 50) continue;
    if (!whenRaced || !VALID_RACE_HIST_WHEN.has(whenRaced as RaceHistoryWhen)) continue;
    const entry: RaceHistoryEntry = {
      distance: distance as RaceHistoryDistance,
      timeSec: Math.round(timeSec),
      whenRaced: whenRaced as RaceHistoryWhen,
    };
    if (distance === 'other') {
      const otherMi = Number(r.otherDistanceMi);
      if (!Number.isFinite(otherMi) || otherMi <= 0 || otherMi > 200) continue;
      entry.otherDistanceMi = otherMi;
    }
    out.push(entry);
  }
  return out;
}

export function isValidDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
export function isValidTime(v: unknown): v is string {
  return typeof v === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(v);
}

/** Everything the route persists, already validated and derived. */
export interface OnboardingCompleteInputs {
  distance: string;
  isCoached: boolean;
  isRace: boolean;
  date: string | null;
  time: string | null;
  name: string;
  timezone: string;
  connectionsSkipped: boolean;
  ttDistance: TTDistance | null;
  ttTime: string | null;
  ttTimeSeconds: number | null;
  weeklyMi: WeeklyMileage | null;
  weeklyFreq: WeeklyFrequency | null;
  histAvg: HistAvg | null;
  histLong: HistLong | null;
  histYears: HistYears | null;
  /** null when the runner gave no evidence at all · see CAP-2-NULL. */
  experienceLevel: string | null;
  raceHistory: RaceHistoryEntry[];
  histAvgMi: number | null;
  histLongMi: number | null;
  birthday: string | null;
  sex: 'M' | 'F' | null;
  heightCm: number | null;
  ageNum: number | null;
  longRunDay: string | null;
  restDay: string | null;
  startDate: string | null;
}

/** The route's own 400s, as data. `status` is what the response carries. */
export interface OnboardingCompleteRefusal { error: string; status: 400 }

export function isRefusal(
  r: OnboardingCompleteInputs | OnboardingCompleteRefusal,
): r is OnboardingCompleteRefusal {
  return (r as OnboardingCompleteRefusal).error !== undefined;
}

/**
 * The body as posted → the values the route writes.
 *
 * @param todayInTz the runner's own today, already resolved from `timezone`
 *   by `dayKeyInTz`. Passed in rather than computed so this function has no
 *   clock — the start-date clamp is the only thing that reads it.
 * @param now used only for the birthday→age arithmetic. Defaults to the wall
 *   clock, exactly as the route did inline.
 */
export function deriveOnboardingComplete(
  body: Record<string, unknown>,
  todayInTz: string,
  now: Date = new Date(),
): OnboardingCompleteInputs | OnboardingCompleteRefusal {
  // ── Validate inputs ──────────────────────────────────────────────
  const distance = typeof body.distance === 'string' && VALID_DISTANCES.has(body.distance)
    ? body.distance : null;
  if (!distance) return { error: 'distance is required', status: 400 };

  // 'coached' (2026-06-10 · fifth onboarding mode): the runner's own
  // coach owns the plan. Not a race path, not a maintenance path —
  // Faff authors NOTHING and acts as the measurement layer.
  const isCoached = distance === 'coached';
  const isRace = distance !== 'none' && !isCoached;
  const date: string | null = isRace && isValidDate(body.date) ? (body.date as string) : null;
  if (isRace && !date) {
    return { error: 'race date is required when a race distance is picked', status: 400 };
  }

  const time: string | null = isValidTime(body.time) ? (body.time as string) : null;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'name is required', status: 400 };

  const timezone = typeof body.timezone === 'string' && body.timezone.length > 0
    ? body.timezone : null;
  if (!timezone) return { error: 'timezone is required', status: 400 };

  const connectionsSkipped = Boolean(body.connectionsSkipped);

  // ── Step 1b fields ──────────────────────────────────────────────
  // 2026-06-10: volume + history persist on EVERY running path now —
  // race paths walk Step 1b too, because a cold-start race plan needs
  // a self-reported baseline (generate.ts seeds recentWeeklyMi /
  // recentLongMi from these when run history is empty). TT goal stays
  // no-race-only (a race-path runner already named their goal). Null is
  // always fine — coached posts none of these.
  const ttDistance = !isRace && typeof body.ttDistance === 'string'
      && VALID_TT_DISTANCES.has(body.ttDistance as TTDistance)
    ? (body.ttDistance as TTDistance) : null;
  const ttTime = !isRace && ttDistance && typeof body.ttTime === 'string'
      && body.ttTime.length > 0 && body.ttTime.length <= 32
    ? body.ttTime : null;
  // 2026-06-15 · exact goal time in seconds (native sends it for goal mode).
  // Drives the goal-readiness projection precisely instead of the ±1.5min
  // bucket midpoint. Stored in user_settings (no migration); read back by
  // loadGoalReadyProjection. Sane band: 3:00–4:00:00.
  const ttTimeSeconds = !isRace && ttDistance
      && Number.isFinite(Number(body.ttTimeSeconds))
      && Number(body.ttTimeSeconds) >= 180 && Number(body.ttTimeSeconds) <= 14400
    ? Math.round(Number(body.ttTimeSeconds)) : null;
  const weeklyMi = Number.isFinite(Number(body.weeklyMi))
      && VALID_WEEKLY_MI.has(Number(body.weeklyMi) as WeeklyMileage)
    ? (Number(body.weeklyMi) as WeeklyMileage) : null;
  const weeklyFreq = Number.isFinite(Number(body.weeklyFreq))
      && VALID_FREQ.has(Number(body.weeklyFreq) as WeeklyFrequency)
    ? (Number(body.weeklyFreq) as WeeklyFrequency) : null;
  const histAvg = typeof body.histAvg === 'string'
      && VALID_HIST_AVG.has(body.histAvg as HistAvg)
    ? (body.histAvg as HistAvg) : null;
  const histLong = typeof body.histLong === 'string'
      && VALID_HIST_LONG.has(body.histLong as HistLong)
    ? (body.histLong as HistLong) : null;
  const histYears = typeof body.histYears === 'string'
      && VALID_HIST_YEARS.has(body.histYears as HistYears)
    ? (body.histYears as HistYears) : null;
  // Self-reported experience level (onboarding asks it directly now). Persists
  // to profile.experience_level (migration 106) — the cold-start input that
  // runner-calibration + the plan volume curve read. Previously this field was
  // accepted by JSON parse and dropped on the floor, so every onboarded runner
  // fell to the intermediate default regardless of what they picked.
  const experienceLevelRaw = (typeof body.experienceLevel === 'string'
      && VALID_EXPERIENCE.has(body.experienceLevel))
    ? body.experienceLevel : null;
  // CAP-2 (2026-06-23) · the WEB onboarding deck doesn't ask experience directly (native does), so a
  // web signup would fall to the intermediate default → ±20mi/wk mis-tier vs native. Derive it from
  // the years-running + mileage the web deck DOES capture: <1yr or sub-15mpw → beginner; experienced
  // (3-7/7+yr) AND 35+mpw → advanced; else intermediate. Native (sends experienceLevel) is unaffected.
  // CAP-2-NULL (2026-08-19) · with no evidence, write no tier — a tier is a
  // ±20 mi/wk claim. See the route's own note; `experience_level` is nullable.
  const hasExperienceEvidence = histYears != null || histAvg != null
    || histLong != null || weeklyMi != null;
  const experienceLevel: string | null = experienceLevelRaw ?? (!hasExperienceEvidence ? null : (
    // ZEROSAY-1 · '0' is below '0-5', so it is beginner by the same rule.
    (histYears === '<1' || histAvg === '0' || histAvg === '0-5' || histAvg === '5-15') ? 'beginner'
    : ((histYears === '3-7' || histYears === '7+')
        && (histAvg === '35+' || histAvg === '45+'
            || histAvg === '45-60' || histAvg === '60-80' || histAvg === '80+')) ? 'advanced'
    : 'intermediate'
  ));

  // 2026-06-03 · race history capture (TASK B4).
  const raceHistory = validateRaceHistory(body.raceHistory);

  // Convert chip ranges → integer midpoints for the DB (history_* columns).
  const histAvgMi = histAvg ? HIST_AVG_MIDPOINTS[histAvg] : null;
  const histLongMi = histLong ? HIST_LONG_MIDPOINTS[histLong] : null;

  const birthday = typeof body.birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.birthday)
    ? body.birthday : null;
  const sex = typeof body.sex === 'string' && /^(M|F|m|f|male|female)$/i.test(body.sex)
    ? (body.sex.toUpperCase().startsWith('M') ? 'M' : 'F') as 'M' | 'F' : null;
  const heightCm = Number.isFinite(Number(body.height_cm))
    && Number(body.height_cm) >= 120 && Number(body.height_cm) <= 230
    ? Number(body.height_cm) : null;
  const ageNum = birthday ? (() => {
    const b = new Date(birthday + 'T12:00:00Z');
    if (isNaN(b.getTime())) return null;
    let a = now.getUTCFullYear() - b.getUTCFullYear();
    const before = now.getUTCMonth() < b.getUTCMonth() ||
      (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate());
    if (before) a--;
    return (a >= 13 && a <= 100) ? a : null;
  })() : null;

  // 2026-06-10 · scheduling (David: "ask when they want to start · what
  // day the long runs should be on"). longRunDay → user_settings.long_run_day
  // (the jsonb field the generator reads via loadSettings). startDate →
  // the plan's week-0 anchor (clamped to [runner-today, +21d]).
  const longRunDay = typeof body.longRunDay === 'string' && VALID_DAY_KEYS.has(body.longRunDay)
    ? (body.longRunDay as string) : null;
  // Rest day must not collide with the long run; the generator overwrites
  // a shared slot with the long and would leave the week rest-less.
  const restDay = longRunDay ? (longRunDay === 'sat' ? 'mon' : 'sat') : null;
  const startDate = (() => {
    if (typeof body.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) return null;
    const hi = new Date(todayInTz + 'T12:00:00Z');
    hi.setUTCDate(hi.getUTCDate() + 21);
    const hiISO = hi.toISOString().slice(0, 10);
    return (body.startDate >= todayInTz && body.startDate <= hiISO) ? body.startDate : null;
  })();

  return {
    distance, isCoached, isRace, date, time, name, timezone, connectionsSkipped,
    ttDistance, ttTime, ttTimeSeconds, weeklyMi, weeklyFreq,
    histAvg, histLong, histYears, experienceLevel, raceHistory,
    histAvgMi, histLongMi, birthday, sex, heightCm, ageNum,
    longRunDay, restDay, startDate,
  };
}
