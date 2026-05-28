/**
 * Deterministic /today brief renderer.
 *
 * 2026-05-27 P-DETERMINISTIC: zero-LLM /today brief built from rules +
 * templates. Same shape as engine.ts generateBriefing.
 *
 * Voice spec David handed me (RunCore — Coach Note Agent Rules):
 *   - Output is ONE flowing paragraph, 3-6 sentences, spoken-aloud,
 *     read by a coach who already knows this athlete. No bullets, no
 *     stat dumps, no headers.
 *   - Arc: verdict → defining metrics → place in week → limiter → next.
 *     Don't label sections; just write them in order as natural speech.
 *   - Always cite the athlete's bands, never absolutes ("dead in your
 *     Z2 band" not "141 is a low heart rate").
 *   - Stat → meaning translation: lead with what it MEANS, then cite.
 *   - Signal vs noise: small variance is noise; mention lightly and
 *     defuse it ("nothing to chase"), or skip. Only signal earns ink.
 *   - The LIMITER: pick exactly ONE thing that matters most this week,
 *     rank by: injury > sleep > load/volume > execution miss > mechanics.
 *     If nothing rises, don't manufacture concern. Clean day is fine.
 *   - When recovery is the limiter, say it directly and rank it above
 *     the training. Most athletes over-index on the run.
 *
 * Mode branches: post-run | pre-run | rest-day | race-day.
 *
 * Topics: empty for now — server-enriched payloads stay the same, but
 * coach_notes per topic kind are a follow-up.
 *
 * Swap proposal: deterministic rule, not LLM judgment. Trigger when
 * ACWR > 1.5 AND (sleep_deficit >= 5h OR recent TIRED count >= 2).
 */
import type { CoachState } from '@/lib/topics/types';
import type { BriefingResponse, ProposedAlternative } from '@/lib/coach/engine';
import type { ResolvedMode } from '@/lib/coach/router';
import { computeReadiness } from '@/lib/coach/readiness';

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
    topics: [],
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
      promptVersion: 'deterministic-v2',
    },
  };
}

/* ─────────────────────── HEADLINE (lead) ────────────────────────────── */
/** Caps-locked scoreboard-style. Type only; numbers go in the body. */
function headlineForCompletedRun(type: string | null): string {
  switch (type) {
    case 'easy':      return 'EASY RUN DONE';
    case 'long':      return 'LONG RUN DONE';
    case 'tempo':     return 'TEMPO DONE';
    case 'threshold': return 'THRESHOLD DONE';
    case 'intervals': return 'INTERVALS DONE';
    case 'recovery':  return 'RECOVERY DONE';
    case 'shakeout':  return 'SHAKEOUT DONE';
    case 'race':      return 'RACE DONE';
    default:          return 'RUN DONE';
  }
}

function headlineForPlanned(type: string | null): string {
  switch (type) {
    case 'easy':      return 'EASY RUN ON DECK';
    case 'long':      return 'LONG RUN ON DECK';
    case 'tempo':     return 'TEMPO ON DECK';
    case 'threshold': return 'THRESHOLD ON DECK';
    case 'intervals': return 'INTERVALS ON DECK';
    case 'recovery':  return 'RECOVERY ON DECK';
    case 'shakeout':  return 'SHAKEOUT ON DECK';
    case 'race':      return 'RACE DAY';
    case 'rest':      return 'REST DAY';
    default:          return 'OPEN DAY';
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * MODE: POST-RUN
 *
 * Single paragraph following the arc: verdict → defining metrics →
 * place in week → limiter → next action. See spec at top of file.
 * ═══════════════════════════════════════════════════════════════════════ */

function postRun(state: CoachState): { lead: string; voice: string[] } {
  const run = state.latest_activity;
  if (!run) return preRun(state);

  const plannedType = state.todayWorkout?.type ?? null;
  const lead = headlineForCompletedRun(plannedType);

  const sentences: string[] = [];

  // 1. VERDICT — what kind of session it was, executed how
  sentences.push(verdictSentence(state, run, plannedType));

  // 2. DEFINING METRIC(S) — translate stat → meaning, athlete's bands
  sentences.push(hrReadSentence(state, run));
  const cad = cadenceSentence(state, run);
  if (cad) sentences.push(cad);

  // 3. PLACE IN WEEK — load + mileage outlook, conversational
  const place = weekPlacementSentence(state);
  if (place) sentences.push(place);

  // 4. THE LIMITER — single ranked callout, or skip if nothing flashes
  const lim = limiterSentence(state);
  if (lim) sentences.push(...lim);

  // 5. NEXT ACTION — tomorrow + directive
  sentences.push(nextActionSentence(state));

  return { lead, voice: [sentences.filter(Boolean).join(' ')] };
}

/* ─────────────────────── BEAT: VERDICT ──────────────────────────────── */

function verdictSentence(
  state: CoachState,
  run: NonNullable<CoachState['latest_activity']>,
  plannedType: string | null,
): string {
  const zone = zoneOf(state, run.hr);
  const planned = plannedType ?? 'run';

  // EXECUTION MISS: easy planned but ran in Z3+
  if ((planned === 'easy' || planned === 'recovery' || planned === 'shakeout')
      && (zone === 'z3' || zone === 'z4' || zone === 'z5')) {
    return `Heads up — easy day got run hard.`;
  }

  // Clean / on-plan by type
  if (planned === 'easy') {
    if (zone === 'z2')       return `Nice work today — clean easy run.`;
    if (zone === 'z2-top')   return `Solid easy day — you pushed it a notch but stayed aerobic.`;
    if (zone === 'below-z2') return `Easy day, played conservative.`;
    return `Easy run logged.`;
  }
  if (planned === 'long') {
    if (zone === 'z2' || zone === 'below-z2') return `Long run done — patient effort, exactly the brief.`;
    if (zone === 'z2-top')                    return `Long run done — pushed it slightly but held aerobic.`;
    return `Long run in the books — call it work.`;
  }
  if (planned === 'tempo') {
    if (zone === 'z3')           return `Tempo done — you put real work in.`;
    if (zone === 'z4')           return `Tempo ran hotter than the brief — that was more threshold.`;
    if (zone === 'z2-top')       return `Tempo came in a touch easy — still useful, just not threshold-stress.`;
    return `Tempo logged.`;
  }
  if (planned === 'threshold') {
    if (zone === 'z4')           return `Threshold session in the books — you held the line.`;
    if (zone === 'z3')           return `Threshold came in a notch under — solid effort, just shy of the brief.`;
    if (zone === 'z5')           return `Threshold ran hot — closer to VO2 than threshold.`;
    return `Threshold work logged.`;
  }
  if (planned === 'intervals') {
    return `Intervals done — that's the kind of work that moves the needle.`;
  }
  if (planned === 'race') {
    return `Race done. Now we recover.`;
  }
  // No plan to compare to — describe by what happened
  if (zone === 'z2')       return `Clean Z2 aerobic effort.`;
  if (zone === 'z2-top')   return `Aerobic with a small push.`;
  if (zone === 'below-z2') return `Very easy effort logged.`;
  if (zone === 'z3')       return `Tempo-zone effort logged.`;
  if (zone === 'z4')       return `Threshold work logged.`;
  if (zone === 'z5')       return `Hard effort logged — that cost something.`;
  return `${run.mi.toFixed(1)} mi logged.`;
}

/* ─────────────────────── BEAT: HR READ ──────────────────────────────── */

function hrReadSentence(state: CoachState, run: NonNullable<CoachState['latest_activity']>): string {
  if (run.hr == null || state.profile?.lthr == null) {
    return `${run.mi.toFixed(1)} miles logged${run.pace ? ` at ${run.pace}` : ''}.`;
  }
  const lthr = state.profile.lthr;
  const z2lo = Math.round(lthr * 0.81);
  const z2hi = Math.round(lthr * 0.89);
  const zone = zoneOf(state, run.hr);
  const dist = run.mi.toFixed(1);

  switch (zone) {
    case 'z2':
      return `You sat at ${run.hr} average across ${dist}, right in the middle of your Z2 band, exactly where an easy day should live.`;
    case 'z2-top':
      return `You held ${run.hr} across ${dist}, top of your Z2 band (${z2lo}-${z2hi}) — slight push but still aerobic.`;
    case 'below-z2':
      return `You sat at ${run.hr} across ${dist}, below your Z2 floor of ${z2lo} — very conservative effort, basically a shake-out.`;
    case 'z3':
      return `You averaged ${run.hr} across ${dist}, into Z3 above your Z2 ceiling of ${z2hi} — that's tempo work, not aerobic recovery.`;
    case 'z4':
      return `You held ${run.hr} across ${dist}, in Z4 threshold territory — real work, treat tomorrow accordingly.`;
    case 'z5':
      return `You ran ${run.hr} across ${dist}, at your VO2 ceiling — that cost something.`;
    default:
      return `${run.hr} bpm across ${dist} miles.`;
  }
}

/* ─────────────────────── BEAT: CADENCE (signal/noise) ───────────────── */

function cadenceSentence(state: CoachState, run: NonNullable<CoachState['latest_activity']>): string | null {
  if (run.cadence == null || state.cadenceBaseline == null) return null;
  const delta = run.cadence - state.cadenceBaseline;
  // Noise: ±3 from baseline is normal day-to-day variance — skip entirely.
  if (Math.abs(delta) <= 3) return null;
  // Light defusal: 4-7 either direction. Mention + reassure.
  if (delta >= 4 && delta <= 7) {
    return `Cadence ticked up to ${run.cadence}, a hair quicker than usual — good sign, nothing to chase.`;
  }
  if (delta <= -4 && delta >= -7) {
    return `Cadence dipped to ${run.cadence}, a touch slower than usual — nothing to chase on an easy day.`;
  }
  // Real signal: 8+ either direction. Worth a real callout.
  if (delta >= 8) {
    return `Cadence climbed to ${run.cadence}, meaningfully above your ${state.cadenceBaseline} baseline. Worth noting.`;
  }
  return `Cadence dropped to ${run.cadence}, well below your ${state.cadenceBaseline} baseline — keep an eye on it next run.`;
}

/* ─────────────────────── BEAT: WEEK PLACEMENT ───────────────────────── */

function weekPlacementSentence(state: CoachState): string | null {
  // Need at least the load OR a planned week to say something useful.
  const haveLoad = state.loadAcwr != null;
  const havePlan = state.weekPlanned != null && state.weekDone != null;
  if (!haveLoad && !havePlan) return null;

  // 2026-05-27 FIX: when load > 1.5, the LIMITER owns the load number
  // entirely. Otherwise the week placement says "your load is past the
  // sweet spot" AND the limiter says "load is past the sweet spot" —
  // double mention. Skip load here when the limiter will pick it up.
  const loadGoesToLimiter = haveLoad && state.loadAcwr! > 1.5;

  const parts: string[] = [];

  // Load — stat → meaning first, then cite the number softly
  if (haveLoad && !loadGoesToLimiter) {
    const r = state.loadAcwr!.toFixed(2);
    if (state.loadAcwr! >= 1.3) {
      parts.push(`Your load's at ${r}, top of your productive band`);
    } else if (state.loadAcwr! >= 0.8) {
      parts.push(`Your load's at ${r}, right in your sweet spot`);
    } else if (state.loadAcwr! >= 0.5) {
      parts.push(`Your load's at ${r}, on the light side`);
    } else {
      parts.push(`Your load's at ${r}, well under your normal`);
    }
  }

  // Week — with long-run outlook. Use "with X to close it out" pattern
  // for the long-run-remaining clause so we don't double-"and" when
  // joining with the load sentence.
  if (havePlan) {
    const done = state.weekDone!.toFixed(1);
    const planned = state.weekPlanned!.toFixed(1);
    const delta = state.weekDone! - state.weekPlanned!;
    const longRunAhead = hasLongRunRemaining(state);
    const longDay = longRunAhead ? dayNameOf(longRunAhead.date) : null;

    // When load was suppressed, this is the leading clause of the
    // sentence and needs to start with a capital. Otherwise it joins
    // with the load clause via ", and " so it stays lowercase.
    const leadingClause = parts.length === 0;
    const youAre = leadingClause ? `You're` : `you're`;

    if (Math.abs(delta) < 2) {
      parts.push(`${youAre} at ${done} of ${planned} on the week and right on pace`);
    } else if (delta >= 2) {
      parts.push(`${youAre} at ${done} of ${planned} on the week, sitting ${delta.toFixed(1)} ahead`);
    } else {
      // Under-plan — long run remaining gets a "with X to close it out"
      // suffix so it doesn't collide with the joining "and".
      if (longDay) {
        parts.push(`${youAre} at ${done} of ${planned} on the week, with ${longDay}'s long run still to close it out`);
      } else {
        parts.push(`${youAre} at ${done} of ${planned} on the week with ${Math.abs(delta).toFixed(1)} still to go`);
      }
    }
  }

  if (parts.length === 0) return null;
  return parts.join(', and ') + '.';
}

/** Does the remaining week have a long run? Returns its day or null. */
function hasLongRunRemaining(state: CoachState): { date: string } | null {
  const today = state.today;
  for (const d of state.currentWeekDays ?? []) {
    if (d.date > today && d.type === 'long' && d.mi > 0) {
      return { date: d.date };
    }
  }
  return null;
}

/* ─────────────────────── BEAT: THE LIMITER (pick one) ───────────────── */

/**
 * Returns 1-2 sentences elevating the SINGLE most important thing this
 * week, or null if nothing flashes (which is itself a valid state — clean
 * day is a clean day, don't manufacture concern).
 *
 * Ranked priority:
 *   1. Niggle (injury risk)
 *   2. Sleep deficit (>= 5h short on the 7-day window)
 *   3. Load too high (ACWR > 1.5)
 *   4. Underloading (ACWR < 0.7, only if user is actively training)
 *   5. Execution miss this week (TIRED check-ins x2+)
 *   6. None — return null
 */
function limiterSentence(state: CoachState): string[] | null {
  // 1. NIGGLE
  if (state.activeNiggle) {
    const n = state.activeNiggle;
    const severity = n.severity ?? 'mild';
    return [
      `The one thing I'm actually watching is the ${n.body_part} — ${severity} right now, and ${n.days_ago === 0 ? 'fresh' : `${n.days_ago} day${n.days_ago === 1 ? '' : 's'} in`}.`,
      `Don't push through it. Ease back the second it talks louder — we can absorb a little less mileage, we can't absorb an injury.`,
    ];
  }

  // 2. SLEEP
  if (state.sleep7Deficit >= 5) {
    const hours = Math.round(state.sleep7Deficit);
    return [
      `The one thing I'm actually watching this week isn't the running — it's sleep.`,
      `You're about ${hours} hours short, and that's the lever that matters most right now. The training's in a good place; recovery's what'll make or break how it lands. Get after the sleep.`,
    ];
  }

  // 3. LOAD TOO HIGH
  if (state.loadAcwr != null && state.loadAcwr > 1.5) {
    return [
      `What I'm watching is your load number — ${state.loadAcwr.toFixed(2)}, past the sweet spot.`,
      `The body's accumulating faster than it's absorbing. Dial it back this week so the next quality session has somewhere to land.`,
    ];
  }

  // 4. UNDERLOADING — only flag if there's an active plan + we're meaningfully under
  if (state.loadAcwr != null && state.loadAcwr < 0.7 && state.weekPlanned != null && state.weekPlanned > 15) {
    return [
      `What I'd flag is the load — ${state.loadAcwr.toFixed(2)} is on the light side for what the plan wants.`,
      `The aerobic base wants more volume to grow. Room to add this week if the legs are willing.`,
    ];
  }

  // 5. EXECUTION MISS — repeated TIRED check-ins
  const tiredCount = (state.recentCheckIns ?? []).filter((c) => c.rating === 'tired' || c.rating === 'wrecked').length;
  if (tiredCount >= 2) {
    return [
      `The pattern I'm watching is the check-ins — ${tiredCount} TIRED in the last few days.`,
      `That's the body telling us recovery isn't keeping up with the training. Pull back on intensity until the rating turns.`,
    ];
  }

  // 6. NOTHING FLASHES
  return null;
}

/* ─────────────────────── BEAT: NEXT ACTION ──────────────────────────── */

function nextActionSentence(state: CoachState): string {
  const w = state.nextWorkout;
  if (!w) return `Nothing on the books tomorrow.`;
  const mi = w.mi.toFixed(1);
  switch (w.type) {
    case 'easy':      return `Easy ${mi} tomorrow, keep it relaxed.`;
    case 'long':      return `Long run tomorrow at ${mi}, patient first half.`;
    case 'tempo':     return `Tempo ${mi} tomorrow, comfortably hard.`;
    case 'threshold': return `Threshold session tomorrow${w.label ? ` (${w.label})` : ''}, lock the pace early.`;
    case 'intervals': return `Intervals tomorrow${w.label ? ` (${w.label})` : ''}, hit the targets with full recovery between.`;
    case 'recovery':  return `Recovery ${mi} tomorrow, slow on purpose.`;
    case 'shakeout':  return `Shake-out ${mi} tomorrow, just loosen the legs.`;
    case 'rest':      return `Rest day tomorrow — actually rest.`;
    case 'race':      return `Race day tomorrow. Trust the work.`;
    default:          return `Tomorrow: ${w.type} ${mi}.`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * MODE: PRE-RUN
 * ═══════════════════════════════════════════════════════════════════════ */

function preRun(state: CoachState): { lead: string; voice: string[] } {
  const today = state.todayWorkout;
  const lead = headlineForPlanned(today?.type ?? null);

  const sentences: string[] = [];

  // Frame what's on the plate
  if (today && today.type !== 'rest' && today.mi > 0) {
    sentences.push(preRunFraming(today));
  } else if (!today || today.mi === 0) {
    sentences.push(`Nothing scheduled today — your call on what (if anything) to run.`);
  }

  // Readiness as opening read
  const r = computeReadiness(state);
  sentences.push(readinessSentence(r.score));

  // Week placement
  const place = weekPlacementSentence(state);
  if (place) sentences.push(place);

  // Limiter
  const lim = limiterSentence(state);
  if (lim) sentences.push(...lim);

  // Directive for today
  if (today && today.type !== 'rest' && today.mi > 0) {
    sentences.push(directiveForType(today.type));
  } else if (today?.type === 'rest') {
    sentences.push(`Protect tomorrow. No junk volume.`);
  }

  return { lead, voice: [sentences.filter(Boolean).join(' ')] };
}

function preRunFraming(today: NonNullable<CoachState['todayWorkout']>): string {
  const mi = today.mi.toFixed(1);
  switch (today.type) {
    case 'easy':      return `On the plate today: easy ${mi}.`;
    case 'long':      return `On the plate today: long run, ${mi}.`;
    case 'tempo':     return `On the plate today: tempo ${mi}${today.label ? ` (${today.label})` : ''}.`;
    case 'threshold': return `On the plate today: threshold session${today.label ? ` — ${today.label}` : ''}.`;
    case 'intervals': return `On the plate today: intervals${today.label ? ` (${today.label})` : ''}.`;
    case 'recovery':  return `On the plate today: recovery ${mi}.`;
    case 'shakeout':  return `On the plate today: shake-out ${mi}.`;
    case 'race':      return `Today's the day — race effort.`;
    default:          return `On the plate today: ${today.type} ${mi}.`;
  }
}

function readinessSentence(score: number): string {
  if (score >= 80) return `Body's reading strong (${score}) — green light to run the plan.`;
  if (score >= 65) return `Readiness is solid (${score}) — plan stands.`;
  if (score >= 50) return `Readiness is amber (${score}) — run it, but listen if the body fights back.`;
  if (score >= 35) return `Readiness is low (${score}) — drop the intensity, hold the volume.`;
  return `Readiness is red (${score}) — recovery day, not training day.`;
}

function directiveForType(type: string): string {
  switch (type) {
    case 'easy':      return `Conversational pace, can't talk in sentences means you're working too hard.`;
    case 'long':      return `Patient first half — the back half is the workout.`;
    case 'tempo':     return `Comfortably hard, not race effort.`;
    case 'threshold': return `Lock the target pace early, don't chase splits, chase consistency.`;
    case 'intervals': return `Hit the targets. Full recovery between, no shortcuts.`;
    case 'recovery':  return `Slow on purpose. The work is the slowness.`;
    case 'shakeout':  return `Loose legs, nothing more.`;
    default:          return ``;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * MODE: REST-DAY
 * ═══════════════════════════════════════════════════════════════════════ */

function restDay(state: CoachState): { lead: string; voice: string[] } {
  const lead = 'REST DAY';
  const sentences: string[] = [`Rest day — actually rest.`];

  const place = weekPlacementSentence(state);
  if (place) sentences.push(place);

  const lim = limiterSentence(state);
  if (lim) sentences.push(...lim);

  if (state.nextWorkout) {
    sentences.push(whatNextSentenceForRest(state.nextWorkout));
  }

  return { lead, voice: [sentences.filter(Boolean).join(' ')] };
}

function whatNextSentenceForRest(w: NonNullable<CoachState['nextWorkout']>): string {
  const mi = w.mi.toFixed(1);
  const when = dayNameOf(w.date);
  return `${when}: ${w.type} ${mi}${w.label ? ` (${w.label})` : ''}.`;
}

/* ═══════════════════════════════════════════════════════════════════════
 * MODE: RACE-DAY
 * ═══════════════════════════════════════════════════════════════════════ */

function raceDay(state: CoachState): { lead: string; voice: string[] } {
  const race = state.nextARace;
  if (!race) return preRun(state);
  const lead = 'RACE DAY';
  const sentences: string[] = [
    `Race day. ${race.name ?? 'A-race'} — the work is already done.`,
  ];
  if (race.goal) sentences.push(`Goal on the line: ${race.goal}.`);
  sentences.push(`Conservative first 5k — the discipline early is what buys the finish.`);
  sentences.push(`Fuel before you think you need it. Race from your zones, not your watch pace.`);
  return { lead, voice: [sentences.join(' ')] };
}

/* ═══════════════════════════════════════════════════════════════════════
 * SWAP PROPOSAL (deterministic rule)
 * ═══════════════════════════════════════════════════════════════════════ */

function maybeSwapProposal(state: CoachState): ProposedAlternative | undefined {
  const decliningIntent = (state.pendingIntents ?? []).find(
    (i) => i.reason === 'declined_swap' && i.field === 'date' && String(i.value) === state.today,
  );
  if (decliningIntent) return undefined;

  const acwrHot = state.loadAcwr != null && state.loadAcwr > 1.5;
  const sleepBad = state.sleep7Deficit >= 5;
  const tiredCount = (state.recentCheckIns ?? []).filter((c) => c.rating === 'tired' || c.rating === 'wrecked').length;
  const subjectiveBad = tiredCount >= 2;

  if (!acwrHot || (!sleepBad && !subjectiveBad)) return undefined;

  const tomorrow = state.nextWorkout;
  if (!tomorrow || tomorrow.type === 'rest' || tomorrow.mi <= 0) return undefined;

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

/* ═══════════════════════════════════════════════════════════════════════
 * HELPERS
 * ═══════════════════════════════════════════════════════════════════════ */

type ZoneLabel = 'below-z2' | 'z2' | 'z2-top' | 'z3' | 'z4' | 'z5' | 'unknown';

function zoneOf(state: CoachState, hr: number | null): ZoneLabel {
  if (hr == null || state.profile?.lthr == null) return 'unknown';
  const lthr = state.profile.lthr;
  const z2lo = Math.round(lthr * 0.81);
  const z2mid = Math.round(lthr * 0.85);
  const z2hi = Math.round(lthr * 0.89);
  const z3hi = Math.round(lthr * 0.93);
  const z4hi = Math.round(lthr * 0.99);
  if (hr < z2lo)   return 'below-z2';
  if (hr <= z2mid) return 'z2';
  if (hr <= z2hi)  return 'z2-top';
  if (hr <= z3hi)  return 'z3';
  if (hr <= z4hi)  return 'z4';
  return 'z5';
}

const DOW_SHORT = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayNameOf(iso: string): string {
  return DOW_SHORT[new Date(iso + 'T12:00:00Z').getUTCDay()];
}
