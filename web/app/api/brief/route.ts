/**
 * /api/brief — race-morning brief generator.
 *
 * Stage 2 wired: delegates to `coach.briefRaceMorning(...)`. The Coach
 * routes the call through the LLM brain when `ANTHROPIC_API_KEY` is
 * present (with voice.md + coaching-research.md cached), and falls
 * back to a deterministic stub when not.
 *
 * The legacy response shape — `{ narrative, plan_adjustments, stub }`
 * — is preserved so the existing BriefTile keeps working. The richer
 * `CoachDecision` (rationale + citations) is delivered in a `coach`
 * sub-object the tile picks up incrementally.
 */
import { coach } from '../../../coach/coach';
import { llmAvailable } from '../../../coach/llm';
import { getCourseFacts } from '../../../lib/course-facts';
import type { CoachDecision } from '../../../coach/types';
import { gatherCoachState } from '../../../lib/coach-state';
import { vdotSnapshot, vdotRow } from '../../../lib/vdot';
import { getRunnerProfile, ageFromBirthYear } from '../../../lib/runner-profile-store';

type Body = {
  courseSlug: string;
  raceName?: string;
  raceDate?: string;
  goalDisplay?: string;
  weatherText: string;
  /** Days from today until the race. Drives the brief's adaptive
   *  horizon — course brief / approach / race-week / race-morning.
   *  When omitted, server falls back to recomputing it from raceDate
   *  vs today (or 0 if neither is parseable). */
  daysToRace?: number;
  phases: Array<{ index: number; label: string; startMi: number; endMi: number; paceSPerMi: number; grade: number }>;
};

/** Build a one-line course summary from the plan's phases for the
 *  Coach prompt. Avoids inventing course facts the Coach doesn't have. */
function summarizeCourse(body: Body, raceName: string): string {
  const total = body.phases.length > 0
    ? body.phases[body.phases.length - 1].endMi
    : 0;
  if (total <= 0) return `${raceName}, distance unknown.`;
  const peakGrade = Math.max(...body.phases.map(p => p.grade));
  const peakPhase = body.phases.find(p => p.grade === peakGrade);
  const peakNote = peakPhase && peakGrade > 1
    ? `, with the steepest section near mile ${((peakPhase.startMi + peakPhase.endMi) / 2).toFixed(1)} at ${peakGrade.toFixed(1)}% grade`
    : '';
  return `${raceName}, ${total.toFixed(1)} mi, ${body.phases.length} sectors${peakNote}.`;
}

/** Parse a free-text NOAA-style forecast into the structured weather
 *  the Coach expects. Best-effort regex; if it can't parse, just
 *  forwards the raw text in `conditions`.
 *
 *  Dewpoint patterns recognized: "dew point 65", "Td 65", "DP 65°F",
 *  "65°F dewpoint" (case-insensitive). When a dewpoint is present,
 *  the Coach uses the more accurate Tair+Td slowdown calculation
 *  (Research/06 §2). */
function parseWeather(text: string): { tempF?: number; dewpointF?: number; windMph?: number; conditions?: string } | undefined {
  if (!text || text.trim().length === 0) return undefined;
  // Pull all temperature-shaped tokens for disambiguation
  const tempMatch = text.match(/(?:^|[^/\d])(\d{2,3})\s*°?\s*F/i);
  const windMatch = text.match(/(\d{1,3})\s*mph/i);
  // Dewpoint heuristics — try several common phrasings.
  let dewpointF: number | undefined;
  const dpPatterns = [
    /dew[\s-]?point[^\d]*(\d{2,3})/i,
    /\bTd\s*[:=]?\s*(\d{2,3})/i,
    /\bDP\s*[:=]?\s*(\d{2,3})/i,
    /(\d{2,3})\s*°?\s*F\s*dew[\s-]?point/i,
  ];
  for (const re of dpPatterns) {
    const m = text.match(re);
    if (m) { dewpointF = Number(m[1]); break; }
  }
  return {
    tempF: tempMatch ? Number(tempMatch[1]) : undefined,
    dewpointF,
    windMph: windMatch ? Number(windMatch[1]) : undefined,
    conditions: text.trim(),
  };
}

/** Derive goal pace in seconds per mile from goalDisplay (e.g. "3:30:00")
 *  and total race distance (from phases). Returns null when either
 *  input can't be parsed cleanly. */
function deriveGoalPace(goalDisplay: string | undefined, totalMi: number): number | null {
  if (!goalDisplay || totalMi <= 0) return null;
  const m = goalDisplay.trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const h = m[3] ? Number(m[1]) : 0;
  const min = m[3] ? Number(m[2]) : Number(m[1]);
  const sec = m[3] ? Number(m[3]) : Number(m[2]);
  const totalS = h * 3600 + min * 60 + sec;
  if (totalS <= 0) return null;
  return Math.round(totalS / totalMi);
}

/** Pick an ability tier from goal pace. Marathon-anchored. */
function deriveAbilityTier(goalPaceSPerMi: number | null): 'elite' | 'mid_pack' | 'slow' {
  if (goalPaceSPerMi == null) return 'mid_pack';
  if (goalPaceSPerMi <= 420) return 'elite';      // ≤7:00/mi marathon (~3:03)
  if (goalPaceSPerMi <= 600) return 'mid_pack';   // ≤10:00/mi (~4:20)
  return 'slow';
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const facts = getCourseFacts(body.courseSlug);
  const raceName = body.raceName ?? facts?.race.name ?? body.courseSlug;
  const courseSummary = summarizeCourse(body, raceName);
  const today = new Date().toISOString().slice(0, 10);
  const totalMi = body.phases.length > 0 ? body.phases[body.phases.length - 1].endMi : 0;
  const goalPaceSPerMi = deriveGoalPace(body.goalDisplay, totalMi);
  const abilityTier = deriveAbilityTier(goalPaceSPerMi);
  // Course elevation isn't currently in course-facts; future field.
  // Treating as sea level for now keeps the slowdown calculation
  // skipping the altitude component (a no-op below 1000 ft).
  const elevationFt: number | undefined = undefined;

  // Recompute daysToRace server-side as a fallback when the client
  // didn't send it, so the horizon is always populated. Client value
  // wins when present (clients already know their local clock state).
  const serverDaysToRace = (() => {
    if (body.daysToRace != null && Number.isFinite(body.daysToRace)) return Math.round(body.daysToRace);
    if (!body.raceDate) return 0;
    const t0 = new Date(today + 'T00:00:00Z').getTime();
    const t1 = new Date(body.raceDate + 'T00:00:00Z').getTime();
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 0;
    return Math.round((t1 - t0) / (24 * 3600 * 1000));
  })();

  // Pull the runner's training state so the brief can talk about
  // whether they're on track for the goal, building well, etc. State
  // walks Postgres (saved races, race plans) + Strava activities;
  // failures are non-fatal — the brief still works without it, just
  // without the on-track read. ~150ms typical.
  const trainingContext = await (async () => {
    try {
      const state = await gatherCoachState();
      const snap = vdotSnapshot(state);
      // Project current VDOT onto this race's distance to get a
      // race-equivalent time. Same VDOT lookup table the dashboard
      // tile uses, just rotated to read out a different distance.
      const vdotImpliedRaceTimeS = (() => {
        if (!snap || totalMi <= 0) return null;
        const row = vdotRow(snap.vdot);
        if (!row) return null;
        // Snap to the canonical VDOT-table distance the runner's race
        // is closest to. ±5% tolerance matches the lookup-table rule.
        const dists: Array<{ key: keyof typeof row; mi: number }> = [
          { key: 'mileS',     mi: 1 },
          { key: 'km5S',      mi: 3.107 },
          { key: 'km10S',     mi: 6.214 },
          { key: 'km15S',     mi: 9.321 },
          { key: 'halfS',     mi: 13.109 },
          { key: 'marathonS', mi: 26.219 },
        ];
        for (const d of dists) {
          if (Math.abs(totalMi - d.mi) / d.mi < 0.05) {
            const v = row[d.key];
            return typeof v === 'number' ? v : null;
          }
        }
        return null;
      })();
      const goalTimeS = (() => {
        if (!body.goalDisplay) return null;
        const m = body.goalDisplay.trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
        if (!m) return null;
        const h = m[3] ? Number(m[1]) : 0;
        const min = m[3] ? Number(m[2]) : Number(m[1]);
        const sec = m[3] ? Number(m[3]) : Number(m[2]);
        return h * 3600 + min * 60 + sec || null;
      })();
      return {
        vdot: snap?.vdot ?? null,
        vdotImpliedRaceTimeS,
        goalTimeS,
        weeklyAvg4w: state.volume.weeklyAvg4w,
        weeklyAvg8w: state.volume.weeklyAvg8w,
        deltaPct4v4: state.volume.deltaPct4v4,
        longestLast28Mi: state.volume.longestLast28Mi,
        easyShare14d: state.intensity.easyShare14d,
        heavyBlockSuspected: state.flags.heavyBlockSuspected,
        rebuildAfterBreak: state.flags.rebuildAfterBreak,
      };
    } catch {
      return undefined;  // brief still works without training context
    }
  })();

  // Fetch runner profile so the brief LLM sees age + sex + HRmax.
  // Audit's #1 priority — closes the "brief is blind to demographics"
  // gap. Failure is non-fatal — brief still works, just without
  // cohort framing.
  const runnerProfileForBrief = await (async () => {
    try {
      const p = await getRunnerProfile();
      return {
        age: ageFromBirthYear(p.birthYear),
        sex: p.sex,
        hrmaxBpm: p.hrmaxBpm,
        rhrBpm: p.rhrBpm,
      };
    } catch {
      return undefined;
    }
  })();

  let decision: CoachDecision<string>;
  try {
    decision = await coach.briefRaceMorning({
      today,
      raceName,
      raceDate: body.raceDate ?? today,
      goalDisplay: body.goalDisplay ?? '',
      weather: parseWeather(body.weatherText),
      courseSummary,
      goalPaceSPerMi: goalPaceSPerMi ?? undefined,
      abilityTier,
      elevationFt,
      raceDistanceMi: totalMi > 0 ? totalMi : undefined,
      daysToRace: serverDaysToRace,
      trainingContext,
      runnerProfile: runnerProfileForBrief,
    });
  } catch (e) {
    return new Response(
      `Coach failed: ${e instanceof Error ? e.message : String(e)}`,
      { status: 502 },
    );
  }

  // Legacy shape for the existing BriefTile + a `coach` sub-object
  // that surfaces the rationale + citations.
  return Response.json({
    narrative: decision.answer,
    plan_adjustments: [], // Brief no longer prescribes pace deltas — voice rules call for run-the-plan.
    stub: decision.brain === 'deterministic',
    coach: {
      rationale: decision.rationale,
      citations: decision.citations,
      brain: decision.brain,
      llmAvailable: llmAvailable(),
    },
  });
}
