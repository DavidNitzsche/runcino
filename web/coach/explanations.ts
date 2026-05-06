/**
 * Plain-English voice lead for the daily card.
 *
 * ONE multi-sentence paragraph that combines:
 *   • the actual prescription (what to do today, with real numbers)
 *   • the state context (why today looks like this — recovery,
 *     heavy block, taper, build-week-N, etc.)
 *   • a real-world execution note (when to back off, what NOT to do)
 *
 * This replaces the old layered design (one-line description +
 * separate italic readiness sentence + toggleable Why panel + bullet
 * citations). Single source of truth for "what's today and why."
 *
 * Voice rules apply:
 *   • Plain language. Translate jargon: "6 × 1 mile" becomes "a mile,
 *     then jog easy for 90 seconds, six times." "MP+20" becomes
 *     "about 20 seconds per mile slower than marathon pace."
 *   • No §-numbers, no "studies show", no "per the research".
 *   • 3–5 sentences. The card breathes.
 *   • Real numbers (paces, miles, reps). Not walls of them.
 *   • Match the room — race day register is different from a quiet
 *     easy day.
 */
import type { CoachState } from '../lib/coach-state';

export interface VoiceLeadCtx {
  workoutType: string;
  /** Display label, e.g. "Easy 6 mi" or "6 × 1 mile threshold". Used
   *  for distance + structure inside the paragraph. */
  label: string;
  /** Distance prescribed today, miles. 0 for rest. */
  distanceMi: number;
  /** Pace band in s/mile, low/high. */
  paceBand?: { lowS: number; highS: number } | null;
  isLong: boolean;
  state: CoachState;
}

function fmtPace(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function fmtBand(b: { lowS: number; highS: number }): string {
  return `${fmtPace(b.lowS)}–${fmtPace(b.highS)} per mile`;
}

export function composeVoiceLead(ctx: VoiceLeadCtx): string {
  const { workoutType, label, distanceMi, paceBand, isLong, state } = ctx;
  const recent = state.races.recent[0] ?? null;
  const inRaceRecovery = recent != null && recent.daysAgo <= 14;
  const heavyBlock = state.flags.heavyBlockSuspected;
  const rebuild = state.flags.rebuildAfterBreak;
  const dist = distanceMi > 0 ? `${distanceMi.toFixed(distanceMi >= 10 ? 0 : 1)} mi` : '';
  const pace = paceBand ? fmtBand(paceBand) : '';

  // ── State-driven overrides come first ───────────────────────────
  if (workoutType === 'rest' && heavyBlock) {
    const races = state.races.raceCount30d;
    const lastName = recent?.name ?? 'your last race';
    return [
      `${races} races in 30 days${recent ? `, last was ${lastName}` : ''}.`,
      `Today off — the body reads that stack of efforts as a pile of acute stress, and the work pays off in recovery, not during the runs.`,
      `Push through this now and the racing compounds without being absorbed; you risk getting hurt or getting slower.`,
      `Rest is where the racing actually converts into fitness.`,
    ].join(' ');
  }
  if (workoutType === 'rest' && inRaceRecovery && recent) {
    return [
      `${recent.daysAgo} day${recent.daysAgo === 1 ? '' : 's'} since ${recent.name}.`,
      `Today off — after a race effort, the body needs 24–72 hours before another stress, and a marathon needs longer.`,
      `Recovery isn't a lost day; it's when the work pays off.`,
      `The fitness from that race is being converted into actual capacity right now, while you rest.`,
    ].join(' ');
  }
  if (rebuild) {
    return [
      `Coming off a quieter stretch — last 7 days are well below your usual.`,
      `Today's an easy ${dist || 'aerobic'} run${pace ? `, around ${pace}` : ''}, no faster.`,
      `Don't try to make it up in one big day; one big spike from your recent normal is the strongest predictor of injury.`,
      `Ease back in. Quality returns once the body's in rhythm again.`,
    ].join(' ');
  }

  // ── Workout-type templates ──────────────────────────────────────
  switch (workoutType) {
    case 'rest':
      return [
        `Today's off-day is part of the plan, not a missed opportunity.`,
        `Hard training stress takes 24–72 hours to absorb — adaptation happens during recovery, not during the run itself.`,
        `Walk, stretch, foam-roll, sleep an extra hour. Tomorrow's run is where the value lands.`,
      ].join(' ');

    case 'recovery':
      return [
        `Recovery run — ${dist || 'short and slow'}${pace ? `, around ${pace}` : ', well below conversational pace'}.`,
        `Truly easy, often slower than feels normal.`,
        `The point is circulation and active recovery, not building anything new. Run it slow enough that you'd be embarrassed if a stranger could see your watch.`,
      ].join(' ');

    case 'general_aerobic':
    case 'easy':
      return [
        `Easy ${dist || 'miles'} today${pace ? `, around ${pace}` : ''}, no faster — even if it feels stupid easy.`,
        `Easy aerobic running is the bread and butter of marathon fitness; more than any single hard workout, this is what builds the engine.`,
        `Honest easy is harder than the threshold day, because if it drifts faster you can't recover for the day that actually pushes you.`,
        `Half the value of this build is in the easy days you ran with discipline.`,
      ].join(' ');

    case 'medium_long':
      return [
        `Medium-long run — ${dist || '11–15 miles'} at endurance pace.`,
        `Pfitzinger's signature: a second weekly run distinct from the long run, kicking in past the 90-minute mark where fast-twitch fibers start getting recruited into aerobic work.`,
        `One of these per week is good. Two separates serious marathoners from the field.`,
      ].join(' ');

    case 'long_steady':
      return [
        `Long run — ${dist || '16–20 miles'} steady, easy effort throughout.`,
        `Past the 90-minute mark, the body starts recruiting fast-twitch fibers into aerobic work — that recruitment, more than anything else, is what makes the marathon possible.`,
        `The point is time on feet, not how fast you cover the miles. Don't manufacture a hero day on a long run.`,
      ].join(' ');

    case 'long_progression':
      return [
        `Progression long run — ${dist || '14–18 miles'}.`,
        `Run the first half easy, then ramp the final 4–8 miles toward marathon pace.`,
        `The opening builds the aerobic base; the closing teaches the body to find marathon pace on already-tired legs — exactly what mile 18 will feel like on race day.`,
      ].join(' ');

    case 'long_mp_block':
      return [
        `Marathon-pace long run — ${dist || '14–22 miles'}, with the middle 8–14 miles at goal MP.`,
        `Probably the single most predictive workout of how your race will go. It trains the marathon energy system at marathon pace on already-tired legs.`,
        `Schedule these 3–5 weeks before race day, not closer — they're high training stress and you need time to absorb.`,
      ].join(' ');

    case 'long_fast_finish':
      return [
        `Long run with a fast finish — ${dist || '16–18 miles'} total, last 2–4 miles closer to half-marathon pace.`,
        `The Hanson signature: high training stress, high specificity to closing strong on tired legs.`,
        `The point isn't to suffer; it's to teach the body that there's still gear left after the bulk of the work is done.`,
      ].join(' ');

    case 'tempo_continuous':
      return [
        `Tempo today — ${dist || '4–8 miles'} continuous${pace ? ` at ${pace}` : ' at threshold pace'}.`,
        `Threshold work has the highest correlation with marathon performance of any single training variable, even higher than VO2max.`,
        `Don't push beyond the prescribed pace; the value is in time at threshold, not how fast you went. Hold the band.`,
      ].join(' ');

    case 'threshold_intervals':
      return [
        `Threshold reps today — a hard mile${pace ? ` at ${pace}` : ' at threshold pace'}, then jog easy for 90 seconds, repeat.`,
        `Push this shit — tomorrow's an easy day, we're not saving legs.`,
        `Threshold has the highest correlation with marathon performance of any single training variable. The pace target matters more than how the reps feel; if rep three drifts past the band, you're under-recovered — drop the last two and call it.`,
      ].join(' ');

    case 'sub_threshold':
      return [
        `Sub-threshold reps today${pace ? ` around ${pace}` : ' just below threshold pace'} — slightly slower than full threshold, longer total time.`,
        `The Norwegian-singles adaptation: bank time at high aerobic intensity without breaking yourself.`,
        `The error mode is treating it like another tempo. Stay sub-threshold; restraint is what makes the system work.`,
      ].join(' ');

    case 'vo2':
      return [
        `VO2 work today — short hard reps${pace ? ` around ${pace}` : ' at 5K to 3K pace'}, with full recovery between.`,
        `This raises the engine's ceiling, which makes everything below it — including marathon pace — feel relatively easier.`,
        `For marathon training, secondary importance. The reps aren't long; the recovery between is the secret to actually hitting the prescribed pace.`,
      ].join(' ');

    case 'marathon_specific':
    case 'marathon_specific_combo':
    case 'marathon_specific_long':
      return [
        `Marathon-specific session today — ${label.toLowerCase()}.`,
        `These are the defining workouts of the peak phase: marathon pace mixed with faster intervals, which trains both the marathon energy system and the ability to recover at MP after surging.`,
        `High demand — make sure tomorrow has space to absorb it.`,
      ].join(' ');

    case 'strides':
    case 'hill_sprints':
      return [
        `Strides today — short bursts of fast running, 80–100 m at near-sprint pace, fully recovered between reps.`,
        `Six to ten reps after an easy run.`,
        `They preserve neuromuscular sharpness and running economy without taxing the aerobic or metabolic systems. Consistently underused by recreational marathoners and consistently emphasized by elite coaches.`,
      ].join(' ');

    case 'race':
      return [
        `Race day. The training is built — today is execution.`,
        `Run the first three miles slower than you want; every fast plan dies in the opening miles.`,
        `Trust the pace plan, take fuel on schedule, drink to thirst, and run your race.`,
      ].join(' ');

    case 'shakeout':
      return [
        `Day before a race — shakeout. ${dist || '20–30 minutes'} very easy, with a few short pickups to wake up the nervous system.`,
        `The legs need to remember they can run, but they don't need any new stress.`,
        `Stop while you still feel fresh. There's nothing to gain from pushing today.`,
      ].join(' ');

    default:
      return isLong
        ? `Long aerobic ${dist || 'run'} today. Time on feet is the metric — pace is secondary. Easy effort throughout.`
        : `Easy aerobic ${dist || 'miles'} today${pace ? `, around ${pace}` : ''}. The substrate everything else gets built on. Easy honestly, not hard.`;
  }
}
