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

  // 1. LEAD — single sentence, characterize the run honestly
  const lead = postRunLead(state, run);

  // 2. RUN QUALITY — HR vs zone band + cadence delta if notable
  const v1 = describeRunQuality(state, run);

  // 3. WHERE YOU STAND — load + week + sleep, with attitude
  const v2 = describeLoadAndVolume(state);

  // 4. WHAT'S NEXT — tomorrow with a directive
  const v3 = describeWhatNext(state);

  const voice = [v1, v2, v3].filter(Boolean);
  return { lead, voice };
}

/** Lead is short, declarative, names what kind of effort that was. */
function postRunLead(state: CoachState, run: NonNullable<CoachState['latest_activity']>): string {
  const zone = zoneOf(state, run.hr);
  const paceFragment = run.pace ? ` at ${run.pace}` : '';
  switch (zone) {
    case 'below-z2': return `Recovery shake-out${paceFragment}.`;
    case 'z2':       return `Z2 aerobic${paceFragment}.`;
    case 'z2-top':   return `Top-Z2 effort${paceFragment}.`;
    case 'z3':       return `Z3 tempo${paceFragment}.`;
    case 'z4':       return `Threshold push${paceFragment}.`;
    case 'z5':       return `VO2 effort${paceFragment}.`;
    default:         return `${run.mi.toFixed(1)} mi logged${paceFragment}.`;
  }
}

type ZoneLabel = 'below-z2' | 'z2' | 'z2-top' | 'z3' | 'z4' | 'z5' | 'unknown';

function zoneOf(state: CoachState, hr: number | null): ZoneLabel {
  if (hr == null || state.profile?.lthr == null) return 'unknown';
  const lthr = state.profile.lthr;
  const z2lo = Math.round(lthr * 0.81);
  const z2mid = Math.round(lthr * 0.85);
  const z2hi = Math.round(lthr * 0.89);
  const z3hi = Math.round(lthr * 0.93);
  const z4hi = Math.round(lthr * 0.99);
  if (hr < z2lo)  return 'below-z2';
  if (hr <= z2mid) return 'z2';
  if (hr <= z2hi)  return 'z2-top';
  if (hr <= z3hi)  return 'z3';
  if (hr <= z4hi)  return 'z4';
  return 'z5';
}

function describeRunQuality(state: CoachState, run: NonNullable<CoachState['latest_activity']>): string {
  const parts: string[] = [];

  if (run.hr != null && state.profile?.lthr != null) {
    const lthr = state.profile.lthr;
    const z2lo = Math.round(lthr * 0.81);
    const z2hi = Math.round(lthr * 0.89);
    const zone = zoneOf(state, run.hr);

    switch (zone) {
      case 'z2':
        parts.push(`${run.hr} bpm the whole ${run.mi.toFixed(1)} mi, dead center of your Z2 (${z2lo}-${z2hi}). Aerobic system did the work.`);
        break;
      case 'z2-top':
        parts.push(`${run.hr} bpm average, top of Z2 (band ${z2lo}-${z2hi}). Slight push but still aerobic.`);
        break;
      case 'below-z2':
        parts.push(`${run.hr} bpm average sat under your Z2 floor of ${z2lo}. Very easy, basically a shake-out.`);
        break;
      case 'z3':
        parts.push(`${run.hr} bpm average put you in Z3 (above your Z2 ceiling of ${z2hi}). Tempo work — not free.`);
        break;
      case 'z4':
        parts.push(`${run.hr} bpm — Z4 threshold territory. Hard session, treat tomorrow as recovery.`);
        break;
      case 'z5':
        parts.push(`${run.hr} bpm — VO2 ceiling. That cost something.`);
        break;
      default:
        parts.push(`${run.hr} bpm across ${run.mi.toFixed(1)} mi.`);
    }
  } else if (run.hr != null) {
    parts.push(`${run.hr} bpm across ${run.mi.toFixed(1)} mi.`);
  } else {
    parts.push(`${run.mi.toFixed(1)} mi logged${run.pace ? ` at ${run.pace}` : ''}.`);
  }

  // Cadence — only mention when meaningfully different from baseline
  if (run.cadence != null && state.cadenceBaseline != null) {
    const delta = run.cadence - state.cadenceBaseline;
    if (delta >= 4) {
      parts.push(`Cadence ${run.cadence} spm, ${delta} above your ${state.cadenceBaseline} baseline. Form was locked in.`);
    } else if (delta <= -4) {
      parts.push(`Cadence ${run.cadence} spm, ${-delta} below your ${state.cadenceBaseline} baseline. Stride got long, watch it next time.`);
    }
  }

  return parts.join(' ');
}

/* ─────────────────────── MODE: PRE-RUN ──────────────────────────────── */

function preRun(state: CoachState): { lead: string; voice: string[] } {
  const today = state.todayWorkout;

  // Lead — name the session. Type + distance is enough.
  let lead: string;
  if (!today || today.mi === 0) {
    lead = 'Open day. Nothing scheduled.';
  } else if (today.type === 'rest') {
    lead = 'Rest day.';
  } else {
    const mi = today.mi.toFixed(1);
    lead = `${capitalize(today.type)} ${mi}${today.label ? ` · ${today.label}` : ''}.`;
  }

  const v1 = describeReadinessForToday(state);
  const v2 = describeLoadAndVolume(state);
  const v3 = describePrescriptionForToday(state);

  return { lead, voice: [v1, v2, v3].filter(Boolean) };
}

function describeReadinessForToday(state: CoachState): string {
  const r = computeReadiness(state);
  if (r.score >= 80) return `Readiness ${r.score}. Green across the board. Run the plan.`;
  if (r.score >= 65) return `Readiness ${r.score}. Solid green. Plan stands.`;
  if (r.score >= 50) return `Readiness ${r.score}. Amber. Run the session but listen to the body — back off if it fights back.`;
  if (r.score >= 35) return `Readiness ${r.score}. Low. Drop the intensity, hold the volume.`;
  return `Readiness ${r.score}. Red. Recovery or rest today.`;
}

function describePrescriptionForToday(state: CoachState): string {
  const today = state.todayWorkout;
  if (!today) return '';
  if (state.activeNiggle) {
    const n = state.activeNiggle;
    return `Active niggle on the ${n.body_part}${n.severity ? ` (${n.severity})` : ''}. Honor it. Ease back the second it talks louder.`;
  }
  if (today.type === 'rest') return 'Protect tomorrow. No bonus miles, no junk volume.';
  if (today.type === 'easy') return 'Conversational pace. If you can\'t talk in full sentences, you\'re working too hard.';
  if (today.type === 'long') return 'Patient first half. The back half is the workout.';
  if (today.type === 'tempo') return 'Comfortably hard. Not race effort.';
  if (today.type === 'threshold') return 'Lock the target pace early. Don\'t chase splits, chase consistency.';
  if (today.type === 'intervals') return 'Hit the targets. Full recovery between, no shortcuts.';
  return '';
}

/* ─────────────────────── MODE: REST-DAY ─────────────────────────────── */

function restDay(state: CoachState): { lead: string; voice: string[] } {
  const lead = 'Rest day.';
  const v1 = state.sleep7Deficit >= 3
    ? `Sleep's ${state.sleep7Deficit.toFixed(1)}h short. Get the bank back tonight.`
    : `Body's earning the work. Let it.`;
  const v2 = describeLoadAndVolume(state);
  const v3 = state.nextWorkout
    ? whatNextSentence(state.nextWorkout)
    : '';
  return { lead, voice: [v1, v2, v3].filter(Boolean) };
}

/** Shared with restDay — uses dayName for non-tomorrow references. */
function whatNextSentence(w: NonNullable<CoachState['nextWorkout']>): string {
  const mi = w.mi.toFixed(1);
  const when = dayName(w.date);
  return `Next up ${when}: ${w.type} ${mi}${w.label ? ` (${w.label})` : ''}.`;
}

/* ─────────────────────── MODE: RACE-DAY ─────────────────────────────── */

function raceDay(state: CoachState): { lead: string; voice: string[] } {
  const race = state.nextARace;
  if (!race) return preRun(state);
  const lead = `Race day. ${race.name ?? 'A-race'}.`;
  const v1 = race.goal ? `Goal on the line: ${race.goal}.` : 'Race the plan you trained for.';
  const v2 = 'Conservative first 5k. The discipline early buys the finish.';
  const v3 = 'Fuel before you think you need it. Race from your zones, not your watch pace.';
  return { lead, voice: [v1, v2, v3] };
}

/* ─────────────────────── SHARED: LOAD + VOLUME ──────────────────────── */

function describeLoadAndVolume(state: CoachState): string {
  const parts: string[] = [];

  // Load (ACWR) — with attitude per band
  if (state.loadAcwr != null) {
    const r = state.loadAcwr.toFixed(2);
    if (state.loadAcwr >= 1.5) {
      parts.push(`Load's at ${r}, past the 1.5 spike line. Body's accumulating faster than it's absorbing. Back off this week.`);
    } else if (state.loadAcwr >= 1.3) {
      parts.push(`Load's at ${r}, top of the productive band. Right where adaptation happens.`);
    } else if (state.loadAcwr >= 0.8) {
      parts.push(`Load's at ${r}, sweet spot. Body's absorbing the work.`);
    } else if (state.loadAcwr >= 0.5) {
      parts.push(`Load's at ${r}, under-loaded. Room to add volume.`);
    } else {
      parts.push(`Load's at ${r}, well under. Detraining territory if this holds.`);
    }
  }

  // Volume vs plan — frame trajectory, not just numbers
  if (state.weekPlanned != null && state.weekDone != null) {
    const delta = state.weekDone - state.weekPlanned;
    const done = state.weekDone.toFixed(1);
    const planned = state.weekPlanned.toFixed(1);
    if (Math.abs(delta) < 2) {
      parts.push(`Week: ${done} of ${planned}, on pace.`);
    } else if (delta >= 2) {
      parts.push(`Week: ${done} of ${planned}, running ${delta.toFixed(1)} ahead.`);
    } else {
      // Under plan — usually means days remaining will catch up.
      parts.push(`Week: ${done} of ${planned}, ${Math.abs(delta).toFixed(1)} still to come.`);
    }
  } else if (state.weekDone != null && state.weekDone > 0) {
    parts.push(`Week: ${state.weekDone.toFixed(1)} so far.`);
  }

  // Sleep — directive, not just diagnostic
  if (state.sleep7Deficit >= 5) {
    parts.push(`Sleep's ${state.sleep7Deficit.toFixed(1)}h short for the week. Get under early tonight.`);
  } else if (state.sleep7Deficit >= 2) {
    parts.push(`Sleep ${state.sleep7Deficit.toFixed(1)}h under target. Don't let it drift.`);
  }

  return parts.join(' ');
}

/* ─────────────────────── SHARED: WHAT NEXT ──────────────────────────── */

function describeWhatNext(state: CoachState): string {
  const w = state.nextWorkout;
  if (!w) return '';
  const type = w.type;
  const mi = w.mi.toFixed(1);
  // Each type gets a short directive after the call-out — runner-speak,
  // not coach-corporate.
  switch (type) {
    case 'easy':
      return `Tomorrow: easy ${mi}. Keep it conversational.`;
    case 'long':
      return `Tomorrow: long run, ${mi}. Patient first half, earn the back half.`;
    case 'tempo':
      return `Tomorrow: tempo ${mi}. Comfortably hard, not race effort.`;
    case 'threshold':
      return `Tomorrow: threshold session, ${mi}${w.label ? ` (${w.label})` : ''}. Lock the pace early.`;
    case 'intervals':
      return `Tomorrow: intervals${w.label ? ` (${w.label})` : ''}. Hit the targets, full recovery between.`;
    case 'race':
      return `Tomorrow: race day. Trust the work.`;
    case 'recovery':
      return `Tomorrow: recovery ${mi}. Slow on purpose.`;
    case 'shakeout':
      return `Tomorrow: shake-out ${mi}. Loose legs, nothing more.`;
    case 'rest':
      return `Tomorrow: rest. Earn it by actually resting.`;
    default:
      return `Tomorrow: ${type} · ${mi} mi${w.label ? ` (${w.label})` : ''}.`;
  }
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
