/**
 * Race feasibility validator, second adaptive module.
 *
 * Compares the user's stored race goal time to what their current
 * VDOT predicts for the race distance. Surfaces a verdict like:
 *
 *   "Your VDOT 45.9 (Top 3 efforts: 10K 44:57, Marathon 3:30:25,
 *    Half 1:34:54) implies a predicted HM of 1:38. Goal of 1:30 is
 *    ~8 minutes more aggressive, stretch territory."
 *
 *   "We'd revise this once a race within 4 weeks moves you above
 *    VDOT 49, at that point the goal becomes realistic."
 *
 * Follows the adaptive-pattern philosophy: evidence-backed,
 * falsifier required, asymmetric thresholds (flagging 'stretch' is
 * a hint not a stop sign).
 */

import { listRacesDB } from './race-store';
import { computeAggregateVdot } from './compute-vdot';
import { vdotRow } from './vdot';
import { query } from './db';

export interface RaceFeasibilityVerdict {
  hasFinding: boolean;
  /** The race this verdict refers to. */
  race: {
    slug: string;
    name: string;
    date: string;
    daysAway: number;
    distanceMi: number;
    goalDisplay: string;
    goalFinishS: number;
    goalPaceSPerMi: number;
  } | null;
  /** What the user's current VDOT predicts for the race distance. */
  predicted: {
    vdot: number;
    finishS: number;
    paceSPerMi: number;
    gapSeconds: number;  // goal - predicted; negative = goal is easier
  } | null;
  /** Categorical feasibility verdict. */
  verdict:
    | 'stretch'        // goal > 2 min more aggressive than predicted
    | 'aggressive'     // 1-2 min more aggressive
    | 'fair'           // within ±1 min of predicted
    | 'conservative'   // > 1 min easier than predicted
    | 'no-data'        // not enough race history
    | 'too-close'      // race within 7 days, don't nag, just race
    ;
  /** Human-readable reason, quotes the math. */
  reason: string;
  /** What would change this verdict. */
  falsifier: string;
  /** Top VDOT contributors (so the user can see what we're reading from). */
  evidence: Array<{
    label: string;
    finishDisplay: string;
    date: string;
    vdot: number;
  }>;
}

const FAIR_TOLERANCE_S = 60;        // ±1 min of predicted = fair
const AGGRESSIVE_S = 120;           // 1-2 min ambitious
const TOO_CLOSE_DAYS = 7;           // within race week, suppress nags

function fmtTime(s: number): string {
  if (!s || s <= 0) return ', ';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
    : `${m}:${String(sec).padStart(2,'0')}`;
}

function fmtPace(s: number): string {
  if (!s || s <= 0) return ', ';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2,'0')}/mi`;
}

function distanceKey(distanceMi: number): 'mileS' | 'km5S' | 'km10S' | 'km15S' | 'halfS' | 'marathonS' | null {
  if (Math.abs(distanceMi - 1) < 0.05) return 'mileS';
  if (Math.abs(distanceMi - 3.107) < 0.155) return 'km5S';
  if (Math.abs(distanceMi - 6.214) < 0.31) return 'km10S';
  if (Math.abs(distanceMi - 9.321) < 0.47) return 'km15S';
  if (Math.abs(distanceMi - 13.109) < 0.55) return 'halfS';
  if (Math.abs(distanceMi - 26.219) < 1.05) return 'marathonS';
  return null;
}

function daysBetween(fromISO: string, toISO: string): number {
  return Math.round(
    (Date.parse(toISO + 'T00:00:00Z') - Date.parse(fromISO + 'T00:00:00Z'))
    / 86_400_000,
  );
}

export async function validateRaceFeasibility(
  userId: string,
  todayISO: string,
): Promise<RaceFeasibilityVerdict> {
  // 1. Pick the nearest upcoming race (any priority).
  let races: Awaited<ReturnType<typeof listRacesDB>> = [];
  try { races = await listRacesDB(userId); } catch { races = []; }
  const upcoming = races
    .filter((r) => r.meta.date >= todayISO)
    .sort((a, b) => a.meta.date.localeCompare(b.meta.date));
  const race = upcoming[0];

  if (!race) {
    return {
      hasFinding: false,
      race: null,
      predicted: null,
      verdict: 'no-data',
      reason: 'No upcoming race on the calendar.',
      falsifier:
        "Add a race in /races/new, we'll start comparing your stored goal " +
        "to your current VDOT and flag stretch goals.",
      evidence: [],
    };
  }

  const parseGoalHMS = (s: string): number => {
    const m = s?.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
  };
  const goalFinishS = race.plan?.goal?.finish_time_s ?? parseGoalHMS(race.meta.goalDisplay);
  const distanceMi = race.meta.distanceMi || 13.109;
  const goalPaceSPerMi = goalFinishS > 0 && distanceMi > 0
    ? Math.round(goalFinishS / distanceMi) : 0;
  const daysAway = Math.max(0, daysBetween(todayISO, race.meta.date));

  const raceMeta = {
    slug: race.slug,
    name: race.meta.name,
    date: race.meta.date,
    daysAway,
    distanceMi,
    goalDisplay: race.meta.goalDisplay,
    goalFinishS,
    goalPaceSPerMi,
  };

  // Suppress feasibility nags inside race week, too late to change
  // goals; just race. The pattern is: "the recommendation needs to
  // be actionable; nagging during race week isn't."
  if (daysAway <= TOO_CLOSE_DAYS) {
    return {
      hasFinding: false,
      race: raceMeta,
      predicted: null,
      verdict: 'too-close',
      reason: `${race.meta.name} is ${daysAway} day${daysAway === 1 ? '' : 's'} away, past the point where feasibility math is useful. Trust the work, execute the plan.`,
      falsifier: 'Feasibility check returns after the race finishes.',
      evidence: [],
    };
  }

  // 2. Get the user's aggregate VDOT.
  const agg = await computeAggregateVdot(userId);
  if (!agg || agg.sources.length === 0) {
    return {
      hasFinding: false,
      race: raceMeta,
      predicted: null,
      verdict: 'no-data',
      reason: 'No race history with HR/time data, can\'t back-calculate fitness yet.',
      falsifier:
        'Log a 5K, 10K, or half marathon (with HR data preferred) and the ' +
        'validator will start comparing your goal to predicted fitness.',
      evidence: [],
    };
  }

  // 3. Look up predicted race time at the user's current VDOT.
  const row = vdotRow(agg.value);
  const distKey = distanceKey(distanceMi);
  if (!row || !distKey) {
    return {
      hasFinding: false,
      race: raceMeta,
      predicted: null,
      verdict: 'no-data',
      reason: `Race distance ${distanceMi.toFixed(2)} mi doesn't map to a canonical Daniels distance (mile/5K/10K/15K/HM/marathon).`,
      falsifier: 'Add an HM or marathon for cleaner feasibility math.',
      evidence: agg.sources.slice(0, 3).map((s) => ({
        label: s.canonicalLabel,
        finishDisplay: fmtTime(s.finishS),
        date: s.date,
        vdot: s.vdot,
      })),
    };
  }
  const predictedFinishS = row[distKey];
  const predictedPaceSPerMi = Math.round(predictedFinishS / distanceMi);

  // C4 · PR anchor, pull the user's best goal-distance PR (race-source
  // only, per L6 source-of-truth) to produce a time-delta framing
  // alongside the VDOT framing. "Your HM PR is 1:34:54. Goal 1:30 is
  // 4:54 faster, requiring ~3.7 VDOT pts of fitness gain."
  // Time-deltas land more concretely than VDOT-deltas.
  let prAnchor: {
    finishS: number;
    finishDisplay: string;
    date: string;
    name: string;
    deltaSecondsFromGoal: number;       // positive = goal is faster than PR
    deltaSecPerMiFromGoal: number;
    deltaVdotEstimate: number | null;   // rough VDOT delta to bridge gap
  } | null = null;
  try {
    const prRows = await query<{
      finish_s: string; date: string; name: string;
    }>(
      `SELECT
          (actual_result->>'finishS')::NUMERIC::TEXT AS finish_s,
          meta->>'date'                              AS date,
          COALESCE(meta->>'name', 'Race')            AS name
         FROM races
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND actual_result IS NOT NULL
          AND (actual_result->>'finishS')::NUMERIC > 0
          AND (meta->>'distanceMi')::NUMERIC BETWEEN $2 AND $3
        ORDER BY (actual_result->>'finishS')::NUMERIC ASC
        LIMIT 1`,
      [
        userId,
        distanceMi * 0.92,  // ±8% canonical-distance window
        distanceMi * 1.08,
      ],
    );
    const pr = prRows[0];
    if (pr) {
      const prFinish = Number(pr.finish_s);
      if (Number.isFinite(prFinish) && prFinish > 0) {
        const deltaSec = prFinish - goalFinishS;
        const deltaSecPerMi = Math.round(deltaSec / distanceMi);
        // Rough conversion · 1 VDOT pt ≈ 6 sec/mi at HM pace. Higher
        // for shorter distances, lower for marathon. Average ~5-7 s/mi
        // gives us a useable rough estimate.
        const deltaVdotEst = deltaSec > 0
          ? Math.round((deltaSecPerMi / 6) * 10) / 10
          : null;
        prAnchor = {
          finishS: prFinish,
          finishDisplay: fmtTime(prFinish),
          date: pr.date,
          name: pr.name,
          deltaSecondsFromGoal: deltaSec,
          deltaSecPerMiFromGoal: deltaSecPerMi,
          deltaVdotEstimate: deltaVdotEst,
        };
      }
    }
  } catch { /* PR lookup non-fatal */ }

  function prAnchorLine(): string {
    if (!prAnchor || prAnchor.deltaSecondsFromGoal <= 0) return '';
    const delta = fmtTime(prAnchor.deltaSecondsFromGoal);
    const sPerMi = prAnchor.deltaSecPerMiFromGoal;
    const vdotEst = prAnchor.deltaVdotEstimate;
    const vdotPart = vdotEst != null
      ? `, requiring roughly ${vdotEst} VDOT points of fitness gain over ${daysAway} days`
      : '';
    return `Your ${prAnchor.name} PR is ${prAnchor.finishDisplay} (${prAnchor.date}). Goal ${race.meta.goalDisplay} is ${delta} faster, about ${sPerMi} sec/mi improvement${vdotPart}. `;
  }
  // Convention: positive gap = goal is HARDER than predicted (goal
  // is a faster time than what VDOT predicts). Negative gap = goal
  // is EASIER. The categorization below reads:
  //   gap > +120  → stretch (>2 min more aggressive)
  //   gap > +60   → aggressive (1-2 min more aggressive)
  //   |gap| ≤ 60  → fair (within ±1 min)
  //   gap < -60   → conservative (>1 min easier)
  const gapSeconds = predictedFinishS - goalFinishS;

  const predicted = {
    vdot: agg.value,
    finishS: predictedFinishS,
    paceSPerMi: predictedPaceSPerMi,
    gapSeconds,
  };

  const evidence = agg.sources.slice(0, 3).map((s) => ({
    label: s.canonicalLabel,
    finishDisplay: fmtTime(s.finishS),
    date: s.date,
    vdot: s.vdot,
  }));

  // 4. Categorize the gap.
  // ASYMMETRIC: stretch and conservative both fire only when the gap
  // is meaningful (>2 min stretch, >1 min conservative). "Fair" is
  // the dominant outcome, the system doesn't constantly second-guess.
  let verdict: RaceFeasibilityVerdict['verdict'];
  let reason: string;
  let falsifier: string;

  const goalDispl = race.meta.goalDisplay;
  const predDispl = fmtTime(predictedFinishS);

  // New convention: gap > 0 = harder than predicted; gap < 0 = easier.
  if (gapSeconds > AGGRESSIVE_S) {
    // >2 min more aggressive, stretch
    verdict = 'stretch';
    const ambitiousBy = fmtTime(gapSeconds);
    reason =
      prAnchorLine() +
      `Your VDOT ${agg.value.toFixed(1)} predicts a ${predDispl} finish for ${race.meta.name}. ` +
      `Goal of ${goalDispl} is ${ambitiousBy} more aggressive, stretch territory. ` +
      `Possible with a strong build cycle, but treat it as a reach goal not a base prediction.`;
    falsifier =
      `We'd revise to 'aggressive' if a race in the next 4-8 weeks pushes your VDOT to ${(agg.value + 2).toFixed(0)}, ` +
      `or to 'fair' at VDOT ${(agg.value + 4).toFixed(0)}+.`;
  } else if (gapSeconds > FAIR_TOLERANCE_S) {
    // 1-2 min more aggressive, aggressive
    verdict = 'aggressive';
    const ambitiousBy = fmtTime(gapSeconds);
    reason =
      prAnchorLine() +
      `Your VDOT ${agg.value.toFixed(1)} predicts ${predDispl}. ` +
      `Goal of ${goalDispl} is ${ambitiousBy} more aggressive, ambitious but in reach with a strong build.`;
    falsifier =
      `We'd revise to 'fair' if a race in the next 4 weeks moves your VDOT up by ` +
      `~2 points (about 1 min/mi faster at HM pace).`;
  } else if (gapSeconds >= -FAIR_TOLERANCE_S) {
    // Within ±1 min of predicted, fair
    verdict = 'fair';
    reason =
      prAnchorLine() +
      `Your VDOT ${agg.value.toFixed(1)} predicts ${predDispl}. ` +
      `Goal of ${goalDispl} is within ±1 min, fair and realistic.`;
    falsifier =
      `We'd revise to 'stretch' if you tighten the goal by >2 min, or 'conservative' ` +
      `if you ease it by >1 min.`;
  } else {
    // >1 min easier, conservative
    verdict = 'conservative';
    const easierBy = fmtTime(Math.abs(gapSeconds));
    reason =
      prAnchorLine() +
      `Your VDOT ${agg.value.toFixed(1)} predicts a ${predDispl} finish for ${race.meta.name}. ` +
      `Goal of ${goalDispl} is ${easierBy} easier than predicted, you have room to push if you want.`;
    falsifier =
      `We'd revise to 'fair' if you bump the goal closer to ${predDispl}, or ` +
      `if a race in the next 4 weeks moves your VDOT down.`;
  }

  return {
    hasFinding: verdict !== 'fair',  // 'fair' is silent; non-fair surfaces a banner
    race: raceMeta,
    predicted,
    verdict,
    reason,
    falsifier,
    evidence,
  };
}
