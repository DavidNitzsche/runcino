/**
 * Plain-English explanations for the Coach's "Why?" panel.
 *
 * The CoachDecision.rationale is one sentence — what shows by default
 * on the daily card. The CoachDecision.explanation is the longer prose
 * version — what the user sees when they tap "Why?". It's grounded in
 * the research but READS LIKE THE COACH TALKING, not a citation list.
 *
 * Templates here. Pure functions, no LLM call. Fast, free, predictable.
 * Voice rules apply: plain language, no §-numbers, no "studies show",
 * 60–140 words. Match the room — race-day prep is different from
 * a flat easy day.
 */
import type { CoachState } from '../lib/coach-state';

interface ExplainCtx {
  workoutType: string;
  isLong: boolean;
  state: CoachState;
}

/** Compose a 1-paragraph explanation for the prescription. The order
 *  inside the function matters: state-driven overrides come first
 *  (post-race recovery, heavy block, rebuild), then workout-type
 *  templates, then the catch-all. */
export function composeExplanation(ctx: ExplainCtx): string {
  const { workoutType, isLong, state } = ctx;
  const recent = state.races.recent[0] ?? null;
  const inRaceRecovery = recent != null && recent.daysAgo <= 14;
  const heavyBlock = state.flags.heavyBlockSuspected;
  const rebuild = state.flags.rebuildAfterBreak;

  // ── State-driven overrides come first ───────────────────────────
  if (workoutType === 'rest' && (heavyBlock || inRaceRecovery)) {
    if (heavyBlock) {
      return `You've stacked ${state.races.raceCount30d} races in 30 days. The body reads that as a pile of acute stress, and the work pays off in recovery, not during the runs. Most of the adaptation from racing happens between sessions — if you keep adding more right now, those efforts compound without being absorbed and you risk getting hurt or getting slower. Today off is where the value of the racing actually converts into fitness.`;
    }
    if (recent) {
      return `${recent.daysAgo} day${recent.daysAgo === 1 ? '' : 's'} since ${recent.name}. After a hard race effort, the body needs 24–72 hours before another stress, and a marathon-distance effort needs longer. Recovery isn't a lost day — it's when the work pays off. The fitness from that race is being converted into actual capacity right now, while you rest.`;
    }
  }
  if (rebuild) {
    return `You're coming off a quieter stretch. The right move isn't to make it up in one big run — that's how injuries happen. Rebuild gradually, easy mileage first, then layer in quality once the body's back in rhythm. The week-over-week jump matters less than the size of any single run; one big spike from your recent normal is the strongest predictor of injury.`;
  }

  // ── Workout-type templates ──────────────────────────────────────
  switch (workoutType) {
    case 'rest':
      return `Today's off-day is part of the plan, not a missed opportunity. Hard training stress takes 24–72 hours to absorb — adaptation happens during recovery, not during the run itself. If you're feeling restless, walk, stretch, foam-roll, sleep an extra hour. Tomorrow's run is where the value lands.`;

    case 'recovery':
      return `Recovery runs are about circulation and active recovery — not building anything new. Truly easy, often slower than feels normal, 30–50 minutes. The point is to keep blood moving, flush the legs, and not add stress. Run it slow enough that you'd be embarrassed if a stranger could see your watch.`;

    case 'general_aerobic':
    case 'easy':
      return `Easy aerobic running is the bread and butter of marathon fitness. More than any single hard workout, this is what builds the engine — mitochondrial density, capillary growth, the slow-twitch capacity that determines how long you can hold marathon pace. The catch: easy runs only work if they're actually easy. Running them too fast turns them into low-quality threshold work, and you can't recover for the day that actually pushes you. Honest easy is harder than threshold. That's why most people don't.`;

    case 'medium_long':
      return `Medium-long runs are a Pfitzinger signature — a second weekly run of 11–15 miles distinct from the long run. The aerobic adaptation that matters most kicks in around the 90-minute mark, where fast-twitch fibers start getting recruited into aerobic work. One of these per week is good. Two separates serious marathoners from the field.`;

    case 'long_steady':
      return `The long run is the headline workout of marathon training. Past 90 minutes, the body starts recruiting fast-twitch fibers into aerobic work — that recruitment, more than anything else, is what makes the marathon possible. Today's run is steady aerobic effort, not race pace. The point is time on feet, not how fast you cover the miles.`;

    case 'long_progression':
      return `Progression long runs start easy and finish at marathon pace or just above. The opening miles build the aerobic base; the closing miles teach the body to find marathon pace on already-tired legs — exactly what mile 18 will feel like on race day. The pattern Pfitzinger popularized is to ramp the final 4–8 miles toward MP, then settle in.`;

    case 'long_mp_block':
      return `Long runs with marathon-pace miles in the middle are probably the single most predictive workout of how your race will go. They train the marathon energy system at marathon pace on already-tired legs. Schedule these 3–5 weeks before race day, not closer — they're high training stress and you need time to absorb.`;

    case 'long_fast_finish':
      return `The Hanson "fast finish" long run — last 2–4 miles run faster than marathon pace (closer to half-marathon pace). It's high training stress and high specificity to closing strong on tired legs. The point isn't to suffer; it's to teach the body that there's still gear left after the bulk of the work is done.`;

    case 'tempo_continuous':
      return `Tempo work targets your lactate threshold — the highest correlation with marathon performance of any single physiological marker, even higher than VO2max. Marathon pace lives at or just below threshold, so improving threshold directly raises what you can hold for 26 miles. Today's tempo is one continuous block at threshold pace — classic and demanding. Don't try to push beyond the prescribed pace; the value is in time at threshold, not how fast you went.`;

    case 'threshold_intervals':
      return `Threshold intervals are Daniels' staple — short reps at threshold pace with brief recovery jogs. The short rests let you accumulate more time at intensity than a continuous tempo could, which is what builds threshold faster. The pace target matters more than how the reps feel — too fast and it becomes VO2 work; too slow and it's just a tempo with extra steps.`;

    case 'sub_threshold':
      return `Sub-threshold work is the Norwegian-singles adaptation. Slightly slower than full threshold pace, longer total volume — the principle is restraint. You're banking time at high aerobic intensity without breaking yourself, which is what the Bakken/Ingebrigtsen system gets right. The error mode is treating it like another tempo. Stay sub-threshold.`;

    case 'vo2':
      return `VO2max work raises the engine's ceiling, which makes everything below it — including marathon pace — feel relatively easier. For marathon training specifically, this is secondary importance. It doesn't directly train the marathon energy system, but a higher ceiling means your marathon pace sits at a lower percentage of max. One per week through the build, then we trim it as you enter the race-specific peak.`;

    case 'marathon_specific':
    case 'marathon_specific_combo':
    case 'marathon_specific_long':
      return `Marathon-specific workouts are the defining sessions of the peak phase. Combo workouts that alternate marathon pace with faster intervals teach the marathon energy system AND the ability to recover at MP after surging. These sessions are demanding — they need full recovery before another hard day. Worth it: the simulation prepares you for the moments in the race when something disrupts the rhythm.`;

    case 'strides':
    case 'hill_sprints':
      return `Strides are short bursts of fast running — 80–100m at near-sprint pace, fully recovered between reps. They preserve neuromuscular sharpness and running economy without taxing the aerobic or metabolic systems. Hill sprints serve the same purpose with lower injury risk. Consistently underused by recreational marathoners, consistently emphasized by elite coaches. Add them after easy runs, 2–3 times a week.`;

    case 'race':
      return `This is the easy part. The training is built; today is execution. Run the first three miles slower than you want to — every fast plan dies in the opening miles. Trust the pace plan, take fuel on schedule, drink to thirst, and run your race.`;

    case 'shakeout':
      return `Day before the race. The legs need to remember they can run, but they don't need any new stress. 20–30 minutes very easy, with a few short pickups to wake up the nervous system. Stop while you still feel fresh — there's nothing to gain from pushing today.`;

    default:
      return isLong
        ? `Long aerobic work anchors the week. Time on feet, not pace, is the metric that matters today.`
        : `Aerobic miles are the substrate everything else gets built on. Easy honestly, not hard. Tomorrow's session is where the push happens.`;
  }
}
