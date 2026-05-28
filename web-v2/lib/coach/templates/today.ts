/**
 * Deterministic /today brief renderer.
 *
 * 2026-05-27 P-DETERMINISTIC: David: "do we need the LLM? Can we hardwire
 * this to the research and data?" Today's experiment. Returns the SAME
 * shape as engine.ts generateBriefing — { lead, voice[], topics[],
 * proposed_alternative?, _state } — but every byte comes from rules +
 * templates. Zero LLM calls. Zero hallucinations. Zero spend. Instant.
 *
 * Voice doctrine David asked for: "plan and where we stand and what to
 * do. Don't need cute. Just need to know."
 *
 * Three-beat structure for every mode:
 *   1. Lead: one short sentence — what this moment IS
 *   2. Where we stand: 2-3 sentences with actual numbers (load, sleep,
 *      week vs plan, today's run vs target)
 *   3. What to do: 1-2 sentences — concrete next action
 *
 * Mode branches: post-run | pre-run | rest-day | race-day.
 *
 * Topics: server-enriched payloads stay the same. The `coach_note` field
 * gets templated from the payload data via topics.ts (next pass).
 *
 * Swap proposal: deterministic rule, not LLM judgment. Trigger when:
 *   - ACWR > 1.5 (Gabbett spike line)
 *   - AND (sleep_deficit >= 5h OR recent TIRED count >= 2)
 *   - AND user hasn't already declined today (swapDeclinedToday)
 * Lifts to proposed_alternative with a templated reason.
 */
import type { CoachState } from '@/lib/topics/types';
import type { BriefingResponse, ProposedAlternative } from '@/lib/coach/engine';
import type { ResolvedMode } from '@/lib/coach/router';
import { computeReadiness } from '@/lib/coach/readiness';

/** Public entry point. Returns a BriefingResponse with empty topics —
 *  the engine post-pass enriches topic payloads + we add coach_notes
 *  separately in the wire-in step. */
export function renderTodayBriefDeterministic(
  state: CoachState,
  resolved: ResolvedMode,
  userId: string,
  eligibleKinds: string[],
): BriefingResponse {
  let lead: string;
  let voice: string[];
  switch (resolved.mode) {
    case 'post-run':
      ({ lead, voice } = postRun(state));
      break;
    case 'pre-run':
      ({ lead, voice } = preRun(state));
      break;
    case 'rest-day':
      ({ lead, voice } = restDay(state));
      break;
    case 'race-day':
      ({ lead, voice } = raceDay(state));
      break;
    default:
      ({ lead, voice } = preRun(state));
  }

  const proposed_alternative = maybeSwapProposal(state);

  return {
    surface: resolved.surface,
    mode: resolved.mode,
    lead,
    voice,
    topics: [], // topics get added by engine post-pass + topic-template layer
    ...(proposed_alternative ? { proposed_alternative } : {}),
    _state: {
      user_id: userId,
      today: state.today,
      candidateKinds: resolved.candidateTopics,
      eligibleKinds,
      weekDone: state.weekDone,
      weekPlanned: state.weekPlanned,
      phaseLabel: state.phaseLabel,
      sleep7Avg: state.sleep7Avg,
      sleep7Deficit: state.sleep7Deficit,
      rhrCurrent: state.rhrCurrent,
      rhrBaseline: state.rhrBaseline,
      cadenceBaseline: state.cadenceBaseline,
      nextARaceName: state.nextARace?.name ?? null,
      daysToARace: state.nextARace?.days_to_race ?? null,
      readiness: computeReadiness(state),
      todayWorkoutType: state.todayWorkout?.type ?? null,
      todayRunId: state.latest_activity?.id ?? null,
      toolTrace: [],
      promptVersion: 'deterministic-v1',
    },
  };
}

/* ─────────────────────── MODE: POST-RUN ─────────────────────────────── */

function postRun(state: CoachState): { lead: string; voice: string[] } {
  const run = state.latest_activity;
  if (!run) {
    // Defensive — shouldn't happen since the router only chooses post-run
    // when latest_activity.date === today, but handle gracefully.
    return preRun(state);
  }

  // 1. LEAD — characterize the run in one short sentence
  const zoneSummary = zoneCharacter(state, run.hr);
  const lead = run.pace
    ? `${zoneSummary} at ${run.pace} pace.`
    : `${run.mi.toFixed(1)} mi logged.`;

  // 2. WHERE WE STAND — three beats: run quality, load, sleep
  const v1 = describeRunQuality(state, run);
  const v2 = describeLoadAndVolume(state);

  // 3. WHAT TO DO — next workout + (optional) recovery nudge if load is hot
  const v3 = describeWhatNext(state);

  const voice = [v1, v2, v3].filter(Boolean);
  return { lead, voice };
}

function zoneCharacter(state: CoachState, hr: number | null): string {
  if (hr == null || state.profile?.lthr == null) return 'Run banked';
  const lthr = state.profile.lthr;
  // Friel zones from LTHR — keep aligned with lib/training/zones.ts
  const z2lo = Math.round(lthr * 0.81);
  const z2hi = Math.round(lthr * 0.89);
  const z3hi = Math.round(lthr * 0.93);
  const z4hi = Math.round(lthr * 0.99);
  if (hr < z2lo) return 'Below-Z2 effort';
  if (hr <= z2hi) return 'Mid-Z2 hold';
  if (hr <= z3hi) return 'Z3 tempo effort';
  if (hr <= z4hi) return 'Z4 threshold push';
  return 'Z5+ effort';
}

function describeRunQuality(state: CoachState, run: NonNullable<CoachState['latest_activity']>): string {
  const parts: string[] = [];
  if (run.hr != null && state.profile?.lthr != null) {
    const lthr = state.profile.lthr;
    const z2lo = Math.round(lthr * 0.81);
    const z2hi = Math.round(lthr * 0.89);
    if (run.hr >= z2lo && run.hr <= z2hi) {
      parts.push(`Held ${run.hr} bpm the whole ${run.mi.toFixed(1)} mi, right inside the Z2 band (${z2lo}-${z2hi}).`);
    } else if (run.hr > z2hi && run.hr <= Math.round(lthr * 0.93)) {
      parts.push(`Ran ${run.hr} bpm average — top of Z2 into Z3 (band ${z2lo}-${z2hi}). Slight aerobic push.`);
    } else if (run.hr < z2lo) {
      parts.push(`Average ${run.hr} bpm sat below your Z2 floor of ${z2lo} — very easy effort.`);
    } else {
      parts.push(`Average ${run.hr} bpm — above the Z2 ceiling of ${z2hi}. Hard effort logged.`);
    }
  } else if (run.hr != null) {
    parts.push(`Held ${run.hr} bpm average across ${run.mi.toFixed(1)} mi.`);
  } else {
    parts.push(`${run.mi.toFixed(1)} mi logged${run.pace ? ` at ${run.pace} pace` : ''}.`);
  }

  // Cadence — only mention when notable (within or outside ±4 spm from baseline)
  if (run.cadence != null && state.cadenceBaseline != null) {
    const delta = run.cadence - state.cadenceBaseline;
    if (delta >= 4) {
      parts.push(`Cadence ${run.cadence} spm, ${delta} above your ${state.cadenceBaseline} baseline.`);
    } else if (delta <= -4) {
      parts.push(`Cadence ${run.cadence} spm, ${-delta} below your ${state.cadenceBaseline} baseline.`);
    }
  }

  return parts.join(' ');
}

/* ─────────────────────── MODE: PRE-RUN ──────────────────────────────── */

function preRun(state: CoachState): { lead: string; voice: string[] } {
  const today = state.todayWorkout;

  let lead: string;
  if (!today || today.type === 'rest' || today.mi === 0) {
    lead = 'Nothing on the plan today.';
  } else {
    lead = `${capitalize(today.type)}${today.mi > 0 ? ` · ${today.mi.toFixed(1)} mi` : ''}${today.label ? ` · ${today.label}` : ''}.`;
  }

  const v1 = describeReadinessForToday(state);
  const v2 = describeLoadAndVolume(state);
  const v3 = describeWhatToDoForPlannedDay(state);

  return { lead, voice: [v1, v2, v3].filter(Boolean) };
}

function describeReadinessForToday(state: CoachState): string {
  const r = computeReadiness(state);
  if (r.score >= 80) return `Readiness ${r.score}. System is green — body's absorbing the work.`;
  if (r.score >= 65) return `Readiness ${r.score}. Solid green, run as planned.`;
  if (r.score >= 50) return `Readiness ${r.score}. Amber — feasible but watch the signals.`;
  if (r.score >= 35) return `Readiness ${r.score}. Low — strongly consider an easier session.`;
  return `Readiness ${r.score}. Deep red — rest or shake-out only.`;
}

function describeWhatToDoForPlannedDay(state: CoachState): string {
  const today = state.todayWorkout;
  if (!today) return 'No workout queued today.';
  if (today.type === 'rest') return 'Rest day — protect tomorrow.';
  if (state.activeNiggle) {
    return `Active niggle: ${state.activeNiggle.body_part} (${state.activeNiggle.severity ?? 'mild'}). Honor it — ease back if it flares.`;
  }
  return `Target: ${today.mi.toFixed(1)} mi${today.label ? ' (' + today.label + ')' : ''}.`;
}

/* ─────────────────────── MODE: REST-DAY ─────────────────────────────── */

function restDay(state: CoachState): { lead: string; voice: string[] } {
  const lead = 'Rest day.';
  const v1 = state.sleep7Deficit >= 3
    ? `Sleep is ${state.sleep7Deficit.toFixed(1)}h short this week. Prioritize getting under tonight.`
    : `Sleep deficit is manageable (${state.sleep7Deficit.toFixed(1)}h). Hold the routine.`;
  const v2 = describeLoadAndVolume(state);
  const v3 = state.nextWorkout
    ? `Next: ${capitalize(state.nextWorkout.type)} on ${dayName(state.nextWorkout.date)} (${state.nextWorkout.mi.toFixed(1)} mi).`
    : 'No upcoming workout queued.';
  return { lead, voice: [v1, v2, v3] };
}

/* ─────────────────────── MODE: RACE-DAY ─────────────────────────────── */

function raceDay(state: CoachState): { lead: string; voice: string[] } {
  const race = state.nextARace;
  if (!race) return preRun(state);
  const lead = `Race day: ${race.name ?? 'A-race'}.`;
  const v1 = race.goal ? `Goal: ${race.goal}.` : 'Race the plan you trained for.';
  const v2 = 'Pace plan first 5k conservative. Trust the work in the chronic block.';
  const v3 = 'Fuel early. Run from your zones, not your watch pace.';
  return { lead, voice: [v1, v2, v3] };
}

/* ─────────────────────── SHARED: LOAD + VOLUME ──────────────────────── */

function describeLoadAndVolume(state: CoachState): string {
  const parts: string[] = [];

  // Load (ACWR)
  if (state.loadAcwr != null) {
    if (state.loadAcwr >= 1.5) {
      parts.push(`Load ratio ${state.loadAcwr.toFixed(2)} — above Gabbett's 1.5 spike line.`);
    } else if (state.loadAcwr >= 1.3) {
      parts.push(`Load ratio ${state.loadAcwr.toFixed(2)} — top of the sweet-spot band.`);
    } else if (state.loadAcwr >= 0.8) {
      parts.push(`Load ratio ${state.loadAcwr.toFixed(2)} — sweet spot.`);
    } else {
      parts.push(`Load ratio ${state.loadAcwr.toFixed(2)} — under-loaded, room to add volume.`);
    }
  }

  // Volume vs plan
  if (state.weekPlanned != null && state.weekDone != null) {
    const delta = state.weekDone - state.weekPlanned;
    if (Math.abs(delta) >= 2) {
      const dir = delta > 0 ? 'over' : 'under';
      parts.push(`Week so far: ${state.weekDone.toFixed(1)} of ${state.weekPlanned.toFixed(1)} planned (${Math.abs(delta).toFixed(1)} mi ${dir}).`);
    } else {
      parts.push(`Week so far: ${state.weekDone.toFixed(1)} of ${state.weekPlanned.toFixed(1)} planned — on track.`);
    }
  } else if (state.weekDone != null && state.weekDone > 0) {
    parts.push(`Week so far: ${state.weekDone.toFixed(1)} mi.`);
  }

  // Sleep
  if (state.sleep7Deficit >= 5) {
    parts.push(`Sleep is ${state.sleep7Deficit.toFixed(1)}h short for the week.`);
  } else if (state.sleep7Deficit >= 2) {
    parts.push(`Sleep ${state.sleep7Deficit.toFixed(1)}h under target.`);
  }

  return parts.join(' ');
}

/* ─────────────────────── SHARED: WHAT NEXT ──────────────────────────── */

function describeWhatNext(state: CoachState): string {
  if (state.nextWorkout) {
    const w = state.nextWorkout;
    return `Tomorrow: ${capitalize(w.type)} · ${w.mi.toFixed(1)} mi${w.label ? ` (${w.label})` : ''}.`;
  }
  return '';
}

/* ─────────────────────── SWAP PROPOSAL RULE ─────────────────────────── */

function maybeSwapProposal(state: CoachState): ProposedAlternative | undefined {
  // Don't propose if user already declined a swap today
  const decliningIntent = (state.pendingIntents ?? []).find(
    (i) => i.reason === 'declined_swap' && i.field === 'date' && String(i.value) === state.today,
  );
  if (decliningIntent) return undefined;

  // Trigger condition: ACWR > 1.5 AND (sleep deficit >= 5h OR recent TIRED count >= 2)
  const acwrHot = state.loadAcwr != null && state.loadAcwr > 1.5;
  const sleepBad = state.sleep7Deficit >= 5;
  const tiredCount = (state.recentCheckIns ?? []).filter((c) => c.rating === 'tired' || c.rating === 'wrecked').length;
  const subjectiveBad = tiredCount >= 2;

  if (!acwrHot || (!sleepBad && !subjectiveBad)) return undefined;

  // Find tomorrow's planned workout — only swap if there IS one and it's
  // not already a rest day.
  const tomorrow = state.nextWorkout;
  if (!tomorrow || tomorrow.type === 'rest' || tomorrow.mi <= 0) return undefined;

  // Propose: replace tomorrow's planned with an easy recovery shake-out
  // 60-70% of the planned distance, capped at 4 mi.
  const altMi = Math.min(4, Math.round(tomorrow.mi * 0.65 * 10) / 10);

  const reasonParts: string[] = [];
  if (acwrHot) reasonParts.push(`ACWR ${state.loadAcwr!.toFixed(2)} is above the 1.5 spike line`);
  if (sleepBad) reasonParts.push(`sleep is ${state.sleep7Deficit.toFixed(1)}h short`);
  if (subjectiveBad) reasonParts.push(`${tiredCount} TIRED check-in${tiredCount === 1 ? '' : 's'} this week`);
  const reason = `${reasonParts.join(' and ')}. Dial back to protect the next quality session.`;

  return {
    alt_type: 'recovery',
    alt_distance_mi: altMi,
    alt_label: `${altMi}-mi recovery shake-out`,
    reason,
  };
}

/* ─────────────────────── HELPERS ────────────────────────────────────── */

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayName(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return DOW_SHORT[d.getUTCDay()];
}
