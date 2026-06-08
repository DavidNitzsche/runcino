/**
 * lib/coach/synthesis.ts · the synthesis card composer.
 *
 * Engine-authored 2-3 sentence story written each morning. Pulls the
 * dominant signal across pillars + confounder hints + illness watch +
 * recovery debt into plain coach English.
 *
 * NOT a template. Each branch examines the actual data and composes
 * a sentence that reflects what's really happening.
 *
 * Doctrine sources:
 *   · Plews HRV (HRV + RHR + sleep move together under stress)
 *   · Research/15 (wrist temp + RR rise 24-48h pre-illness)
 *   · Research/00b (sleep architecture vs quantity framing)
 *   · Saw et al. (subjective wins when it disagrees ≥15pts)
 *
 * Generic mechanism · works for any user. No hardcoded names.
 */

import type { ReadinessBreakdown } from './readiness';
import type { CoachState } from '@/lib/topics/types';

interface SynthesisInputs {
  breakdown: ReadinessBreakdown;
  state: CoachState;
  /** Wrist temp delta vs baseline in °C. Null when no data. */
  wristTempDeltaC: number | null;
  /** Respiratory rate delta vs baseline in breaths/min. */
  rrDelta: number | null;
  /** Sleep stages 7-night avg (deep, REM, total) in minutes. */
  sleepStages: {
    deepMin: number | null;
    remMin: number | null;
    lightMin: number | null;
    totalMin: number | null;
  } | null;
  /** Banister TSB for the day. */
  tsb: number | null;
  /** Whether the previous day's run was hard (long/intervals/race/tempo). */
  recentHardSession: boolean;
}

/**
 * Build the synthesis card. Returns null when there's not enough
 * signal to write an honest sentence (cold start, brand-new user).
 */
export function buildSynthesis(inputs: SynthesisInputs): string | null {
  const { breakdown, state, wristTempDeltaC, rrDelta, sleepStages, tsb, recentHardSession } = inputs;

  // Cold start guard.
  if (!breakdown.inputs || breakdown.inputs.length === 0) return null;
  if (breakdown.inputs.every((i) => i.observedV === 'no data' || i.observedV === 'building history')) return null;
  if (breakdown.score == null) return null;

  // ─── illness watch (highest priority · pre-empts everything else) ──
  // Research/15: wrist temp +0.3-0.5°C combined with RR +2-3 bpm in
  // last 24-48h is the early illness signal that PRECEDES HRV by
  // 24-72 hours. If both elevated, that's the story.
  const tempElevated = wristTempDeltaC != null && wristTempDeltaC >= 0.3;
  const rrElevated = rrDelta != null && rrDelta >= 2;
  if (tempElevated && rrElevated) {
    return buildIllnessWatchStory(wristTempDeltaC!, rrDelta!, breakdown);
  }

  // ─── recovery debt + load story ──
  // If ACWR > 1.4 AND multiple recovery pillars are red, the load step
  // is the story.
  const acwr = state.loadAcwr;
  const hrvPillar = breakdown.inputs.find((i) => i.key === 'hrv');
  const rhrPillar = breakdown.inputs.find((i) => i.key === 'rhr');
  const sleepPillar = breakdown.inputs.find((i) => i.key === 'sleep');
  const loadPillar = breakdown.inputs.find((i) => i.key === 'load');

  const hrvRed = hrvPillar && hrvPillar.weight < -8;
  const rhrRed = rhrPillar && rhrPillar.weight < -3;
  const sleepRed = sleepPillar && sleepPillar.weight < -8;
  const loadRed = loadPillar && loadPillar.weight < -5;

  // ─── sleep is the story ──
  // Sleep down + HRV down + RHR up = classic undersleep stress trifecta.
  if (sleepRed && hrvRed && rhrRed) {
    return buildSleepStory(sleepPillar!, hrvPillar!, rhrPillar!, wristTempDeltaC, rrDelta);
  }

  // ─── load is the story ──
  if (loadRed && acwr != null && acwr > 1.4 && (hrvRed || rhrRed)) {
    return buildLoadStory(loadPillar!, acwr, hrvRed ?? false, rhrRed ?? false, tsb);
  }

  // ─── recovery debt from yesterday's hard session ──
  if (recentHardSession && ((hrvRed ?? false) || (rhrRed ?? false)) && !(sleepRed ?? false)) {
    return buildPostHardSessionStory(hrvPillar, rhrPillar, tsb);
  }

  // ─── HRV is the lone outlier (early-overreach without context) ──
  if (hrvRed && !sleepRed && !rhrRed) {
    return buildLoneHrvStory(hrvPillar!, state);
  }

  // ─── stable / positive story ──
  if (breakdown.score >= 70) {
    return buildSharpStory(breakdown, tsb);
  }
  if (breakdown.score >= 55) {
    return buildModerateStory(breakdown);
  }

  // ─── generic mid-range fallback (something is off but not dramatic) ──
  return buildGenericConcernStory(breakdown, tsb);
}

// ─── story builders ─────────────────────────────────────────────────

function buildIllnessWatchStory(
  tempDelta: number,
  rrDelta: number,
  breakdown: ReadinessBreakdown,
): string {
  const tempPart = `Wrist temp +${tempDelta.toFixed(1)}°C`;
  const rrPart = `respiratory rate +${rrDelta.toFixed(0)}/min`;
  const hrv = breakdown.inputs.find((i) => i.key === 'hrv');
  const hrvNote = hrv && hrv.weight < -5
    ? ' HRV is also tracking down · the picture lines up.'
    : ' HRV hasn\'t flagged yet, but these two move 24-48h ahead of it.';
  // 2026-06-03 · stripped prescriptive tail ("Hydrate, push bedtime,
  // and don't add stress with a hard session today.") per no-reactive-
  // coach doctrine. Engine describes the signal, runner decides action.
  return `${tempPart} and ${rrPart} for the last day or two. This combination is the textbook early-illness signal in endurance runners.${hrvNote}`;
}

function buildSleepStory(
  sleep: ReadinessBreakdown['inputs'][number],
  hrv: ReadinessBreakdown['inputs'][number],
  rhr: ReadinessBreakdown['inputs'][number],
  tempDelta: number | null,
  rrDelta: number | null,
): string {
  const tempNote = tempDelta != null && Math.abs(tempDelta) < 0.3
    ? ' Wrist temp is normal so this isn\'t illness'
    : '';
  const rrNote = rrDelta != null && Math.abs(rrDelta) < 2 && tempNote
    ? ' and respiratory rate is steady'
    : '';
  // 2026-06-03 · stripped "it's a deficit you can close tonight" tail
  // per no-reactive-coach. The description of the trifecta is the point.
  return `Sleep is the story. ${sleep.observedV} with ${hrv.observedV} HRV and ${rhr.observedV} RHR · these three move together when the nervous system is undersleep-stressed.${tempNote}${rrNote}.`;
}

function buildLoadStory(
  load: ReadinessBreakdown['inputs'][number],
  acwr: number,
  hrvRed: boolean,
  rhrRed: boolean,
  tsb: number | null,
): string {
  const acwrText = acwr.toFixed(2);
  const recoveryMarkers = [hrvRed && 'HRV', rhrRed && 'RHR'].filter(Boolean).join(' and ');
  const tsbPart = tsb != null && tsb < -15
    ? ` Training Form ${Math.round(tsb)} confirms you\'re carrying real fatigue.`
    : '';
  // 2026-06-03 · stripped "Today is a true recovery day · easy effort
  // if you run at all, or a rest day pays off bigger." per no-reactive-
  // coach. The cost description is the point; the runner reads it.
  return `Load is biting. ACWR ${acwrText} is above the 1.3 ceiling and ${recoveryMarkers} are flagging the cost.${tsbPart}`;
}

function buildPostHardSessionStory(
  hrv: ReadinessBreakdown['inputs'][number] | undefined,
  rhr: ReadinessBreakdown['inputs'][number] | undefined,
  tsb: number | null,
): string {
  const markers = [hrv && hrv.weight < -5 && `HRV ${hrv.observedV}`, rhr && rhr.weight < -3 && `RHR ${rhr.observedV}`]
    .filter(Boolean).join(' and ');
  const tsbPart = tsb != null && tsb < -10
    ? ` Training Form ${Math.round(tsb)} · you\'re in the loaded band.`
    : '';
  // 2026-06-03 · stripped "An easy run or full rest today · push the
  // next quality session when these settle." per no-reactive-coach.
  return `Recovering from yesterday\'s hard session. ${markers} are the expected post-effort markers.${tsbPart}`;
}

function buildLoneHrvStory(
  hrv: ReadinessBreakdown['inputs'][number],
  state: CoachState,
): string {
  const cyclePart = state.cyclePhase === 'luteal'
    ? ' (luteal-adjusted)'
    : '';
  // 2026-06-03 · stripped "Easy effort today; trust your subjective
  // read." per no-reactive-coach. The "what could be causing this" +
  // "watch tomorrow" framing is description, kept.
  return `HRV is down${cyclePart} while sleep and RHR are holding · could be early functional overreach OR a one-off (stress, alcohol, late caffeine). Watch the next 24-48h · if it persists tomorrow that\'s a real signal.`;
}

function buildSharpStory(
  breakdown: ReadinessBreakdown,
  tsb: number | null,
): string {
  // 2026-06-03 · stripped "Green light · push the planned session, hit
  // your paces, the body will absorb it." and "push some volume" tails
  // per no-reactive-coach. Engine describes the state.
  const tsbPart = tsb != null && tsb >= 5 && tsb <= 25
    ? ' Training Form is in race-ready territory.'
    : tsb != null && tsb > 25
      ? ' Training Form is high · fresh but slightly under-trained band.'
      : '';
  // 2026-06-05 · multi-tenant audit Pattern 5 fix · cite-or-shut-up.
  // Was: hardcoded "All five pillars" · a lie for any runner without
  // every recovery source connected (Strava-only-web sees just LOAD).
  // Now: count actual reporting pillars (any with a real observation,
  // not 'no data' / 'building history') and only claim "all" when the
  // full panel of five reports · otherwise name the count honestly.
  const realPillarCount = breakdown.inputs.filter(
    (i) => i.observedV !== 'no data'
      && i.observedV !== 'building history'
      && i.weight !== 0,
  ).length;
  const totalPillars = breakdown.inputs.length;
  const intro = realPillarCount === totalPillars && totalPillars >= 4
    ? `All ${totalPillars} pillars are in good shape`
    : realPillarCount >= 2
      ? `${realPillarCount} of ${totalPillars} pillars are in good shape`
      : realPillarCount === 1
        ? 'The one pillar reporting is in good shape'
        : 'Score is in the sharp band';
  return `${intro} with score ${breakdown.score}.${tsbPart}`;
}

function buildModerateStory(breakdown: ReadinessBreakdown): string {
  // 2026-06-03 · stripped "Run the planned session" / "Run as planned,
  // easy effort." tails per no-reactive-coach.
  const driver = breakdown.inputs
    .filter((i) => i.weight < -3)
    .sort((a, b) => a.weight - b.weight)[0];
  if (!driver) {
    return `Score ${breakdown.score} · holding pattern. Pillars are mostly even, nothing dramatic in either direction.`;
  }
  return `Score ${breakdown.score} · ${driver.label.split(' · ')[0]} is the soft spot (${driver.observedV}). Worth watching tomorrow to see if it persists or rebounds.`;
}

function buildGenericConcernStory(
  breakdown: ReadinessBreakdown,
  tsb: number | null,
): string {
  const reds = breakdown.inputs.filter((i) => i.weight < -3);
  const labels = reds.slice(0, 2).map((r) => r.label.split(' · ')[0]).join(' and ');
  const tsbPart = tsb != null && tsb < -10
    ? ` Training Form ${Math.round(tsb)} is in the loaded band.`
    : '';
  // 2026-06-03 · stripped "This is a pull-back day. Easy run or rest,
  // sleep is the highest-leverage move tonight." per no-reactive-coach.
  return `Multiple pillars softening · ${labels} are the biggest.${tsbPart}`;
}
