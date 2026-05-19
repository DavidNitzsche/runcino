/**
 * E2 · Morning-after-race awareness on /overview
 *
 * Surfaces a coach-voice card the day after a race, walking the user
 * through reverse-taper recovery stages per Daniels §8.3 + §13.3
 * (encoded as POST_RACE_STAGES in coach/doctrine/post_race.ts).
 *
 * Three stages keyed off days-since-race:
 *   REST   · 100% rest, walking ok, no running
 *   LIGHT  · easy short jogs, conversational pace, distance-capped
 *   EASY   · easy aerobic mileage at reduced volume (30-50% peak)
 *
 * Stage durations scale with race distance:
 *   Marathon (≥22mi):    rest 3d  · light 7d  · easy 14d
 *   Half (≥11mi):        rest 2d  · light 5d  · easy 9d
 *   Shorter (10K, 5K):   rest 1d  · light 3d  · easy 5d
 *
 * Race source: races.actual_result (per L6 source-of-truth — taper
 * surfaces consume race RESULTS, not strava activities). Race must
 * have actual_result populated to be considered "completed."
 *
 * Voice: direct and warm. The runner did the thing; the coaching is
 * about absorbing the load, not testing it. Same shape as V5
 * (evidence + diagnosis + recommendation + falsifier).
 */

import { query } from './db';
import { POST_RACE_STAGES } from '@/coach/doctrine/post_race';

export type RecoveryStage = 'rest' | 'light' | 'easy' | 'done';

export interface PostRaceFinding {
  shouldRender: boolean;
  race: {
    slug: string;
    name: string;
    date: string;
    distanceMi: number;
    finishS: number | null;
    daysAgo: number;
  } | null;
  stage: RecoveryStage;
  /** Day-since-race for the user (1-indexed; race day = 0). */
  daysSinceRace: number;
  /** Stage thresholds: last day of each stage. */
  stageBounds: {
    restEndDay: number;
    lightEndDay: number;
    easyEndDay: number;
  } | null;
  /** Plain-language guidance for today's stage. */
  todayGuidance: string;
  /** What the runner can expect tomorrow / next stage transition. */
  whatsNext: string;
}

interface RaceRow {
  slug: string;
  meta: { name?: string; date?: string; distanceMi?: number };
  actual_result: { finishS?: number } | null;
}

function pickStageForDistance(distanceMi: number) {
  // POST_RACE_STAGES.stages are ordered descending by minRaceMi
  for (const s of POST_RACE_STAGES.value.stages) {
    if (distanceMi >= s.minRaceMi) return s;
  }
  return POST_RACE_STAGES.value.stages[POST_RACE_STAGES.value.stages.length - 1];
}

function dayDelta(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + 'T12:00:00Z');
  const b = Date.parse(toIso + 'T12:00:00Z');
  return Math.round((b - a) / 86_400_000);
}

function fmtDateAgo(daysAgo: number): string {
  if (daysAgo === 0) return 'today';
  if (daysAgo === 1) return 'yesterday';
  if (daysAgo === 2) return '2 days ago';
  if (daysAgo === 3) return '3 days ago';
  if (daysAgo < 7) return `${daysAgo} days ago`;
  if (daysAgo < 10) return 'a week ago';
  return `${daysAgo} days ago`;
}

function fmtTime(s: number | null): string {
  if (s == null || s <= 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Build the today + whatsNext copy based on stage + days remaining
 *  in stage. Voice: direct, warm, specific. */
function buildGuidance(
  raceDist: number,
  stage: RecoveryStage,
  daysSinceRace: number,
  bounds: { restEndDay: number; lightEndDay: number; easyEndDay: number },
): { today: string; next: string } {
  const isMarathon = raceDist >= 22;
  const isHalf = raceDist >= 11 && raceDist < 22;

  if (stage === 'rest') {
    const remaining = bounds.restEndDay - daysSinceRace;
    const today = isMarathon
      ? "Day " + daysSinceRace + " post-marathon · full rest. No running. Walking, stretching, foam roller all encouraged. Your body is repairing micro-tears from race effort — running on it doesn't accelerate recovery, it extends it. Eat well, sleep well."
      : isHalf
        ? "Day " + daysSinceRace + " post-HM · full rest. Walking ok, no running. The race effort is more taxing than the miles suggest at HM intensity."
        : "Day " + daysSinceRace + " post-race · full rest. Walking ok, no running. Even short races spike cortisol and inflammation — give the body 24-48h.";
    const next = remaining > 0
      ? `${remaining + 1} more day${remaining === 0 ? '' : 's'} of full rest, then easy short jogs.`
      : `Tomorrow: light recovery jogs begin (20-30 min easy if your legs say go).`;
    return { today, next };
  }

  if (stage === 'light') {
    const remaining = bounds.lightEndDay - daysSinceRace;
    const today = isMarathon
      ? `Day ${daysSinceRace} post-marathon · light recovery zone. 20-30 min very easy jog ok if legs feel willing. Conversational pace, HR strictly below Z2 ceiling. Walk if you need to. Skip if anything feels off — there is no rush to come back faster than your body wants.`
      : isHalf
        ? `Day ${daysSinceRace} post-HM · light recovery. 20-40 min easy at conversational pace. HR below Z2 ceiling. Skip if legs feel heavy.`
        : `Day ${daysSinceRace} post-race · light recovery. 20-40 min easy. Pace is whatever lets you hold a conversation.`;
    const next = remaining > 0
      ? `${remaining + 1} more day${remaining === 0 ? '' : 's'} of light/easy jogs. Then back to normal easy mileage.`
      : `Tomorrow: building back toward your normal easy volume (still no quality).`;
    return { today, next };
  }

  if (stage === 'easy') {
    const remaining = bounds.easyEndDay - daysSinceRace;
    const today = isMarathon
      ? `Day ${daysSinceRace} post-marathon · easy aerobic zone (no quality). Reduced volume — 30-50% of peak weeks per §13.3. Build mileage gradually. Skip the speed work. Threshold and intervals return after the full ${bounds.easyEndDay}-day window.`
      : `Day ${daysSinceRace} post-race · easy aerobic only. No quality work yet — let the system fully absorb the race stress before adding sharpening stimulus.`;
    const next = remaining > 0
      ? `${remaining} more day${remaining === 1 ? '' : 's'} of easy-only. After that, normal plan resumes — threshold + intervals + long runs.`
      : `Tomorrow: normal plan resumes. Threshold + intervals return; long runs scale back up.`;
    return { today, next };
  }

  // 'done' — outside the window; we shouldn't render but produce safe defaults.
  return {
    today: 'Recovery window complete · normal training resumed.',
    next: '',
  };
}

export async function computePostRaceFinding(
  userId: string,
  todayIso: string,
): Promise<PostRaceFinding> {
  const empty: PostRaceFinding = {
    shouldRender: false,
    race: null,
    stage: 'done',
    daysSinceRace: 0,
    stageBounds: null,
    todayGuidance: '',
    whatsNext: '',
  };

  // Most recent race that completed (has actual_result.finishS), within
  // the widest recovery window (14 days for marathon — anything past
  // that and we're outside any stage).
  const cutoffIso = new Date(Date.parse(todayIso + 'T00:00:00Z') - 14 * 86_400_000)
    .toISOString().slice(0, 10);

  const rows = await query<RaceRow>(
    `SELECT slug, meta, actual_result
       FROM races
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND meta->>'date' BETWEEN $2 AND $3
        AND actual_result IS NOT NULL
        AND (actual_result->>'finishS')::NUMERIC > 0
      ORDER BY meta->>'date' DESC
      LIMIT 1`,
    [userId, cutoffIso, todayIso],
  );
  const row = rows[0];
  if (!row || !row.meta?.date) return empty;

  const raceDate = row.meta.date;
  const daysSinceRace = dayDelta(raceDate, todayIso);
  if (daysSinceRace < 0) return empty;  // race in the future, not us
  if (daysSinceRace === 0) {
    // race day itself — different message family, defer to next-day handling
    return {
      ...empty,
      race: {
        slug: row.slug,
        name: row.meta.name ?? 'Race',
        date: raceDate,
        distanceMi: Number(row.meta.distanceMi) || 0,
        finishS: row.actual_result?.finishS ?? null,
        daysAgo: 0,
      },
      shouldRender: true,
      stage: 'rest',
      daysSinceRace: 0,
      stageBounds: null,
      todayGuidance: 'Race day. Celebrate. The training was the work; the race is the celebration of it. Recovery starts tomorrow.',
      whatsNext: 'Tomorrow: full rest. No running. Walking ok.',
    };
  }

  const distanceMi = Number(row.meta.distanceMi) || 0;
  const stageDef = pickStageForDistance(distanceMi);
  if (daysSinceRace > stageDef.easyEndDay) {
    return empty; // outside any recovery stage
  }

  const stage: RecoveryStage =
    daysSinceRace <= stageDef.restEndDay ? 'rest' :
    daysSinceRace <= stageDef.lightEndDay ? 'light' :
    daysSinceRace <= stageDef.easyEndDay ? 'easy' : 'done';

  const guidance = buildGuidance(distanceMi, stage, daysSinceRace, stageDef);

  return {
    shouldRender: true,
    race: {
      slug: row.slug,
      name: row.meta.name ?? 'Race',
      date: raceDate,
      distanceMi,
      finishS: row.actual_result?.finishS ?? null,
      daysAgo: daysSinceRace,
    },
    stage,
    daysSinceRace,
    stageBounds: {
      restEndDay: stageDef.restEndDay,
      lightEndDay: stageDef.lightEndDay,
      easyEndDay: stageDef.easyEndDay,
    },
    todayGuidance: guidance.today,
    whatsNext: guidance.next,
  };
}

/** Display helpers for the React component. */
export { fmtDateAgo, fmtTime };
