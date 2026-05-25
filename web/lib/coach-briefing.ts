/**
 * Coach briefing copy generator.
 *
 * Produces 2–4 sentence briefings that adapt to the day of week + the
 * runner's actual last-7-days data. The voice is the same as a coach
 * looking at your wahoo screen: short, observational, specific.
 *
 * Mondays reflect on last week + frame the new one. Tue–Sat talk
 * about today's workout in context of the week's arc. Sunday is the
 * long-run day, frame it as the week's centerpiece. Rest days
 * (whichever DOW) get rest-specific copy.
 *
 * Inputs are intentionally small, anything more would push toward
 * LLM-generation territory. The point here is to swap mechanical
 * "Today is easy at 5.5mi." copy for something that reads like a
 * person who can see your data.
 */

import type { PlanWeek, PlanWeekDay } from './synthetic-plan';
import type { WeekStats } from './completed-runs';

interface BriefingInput {
  firstName: string;
  today: string;            // YYYY-MM-DD
  daysToRace: number;
  raceLabel: string;        // e.g. 'AFC Half'
  currentWeek: PlanWeek;
  previousWeek: PlanWeek | null;
  /** Real activity stats for the previous calendar week. Always passed
   *  (might be all zeros if the runner hasn't logged anything). */
  lastWeekStats: WeekStats;
  /** Real activity stats for the *current* week so far (Mon-yesterday). */
  thisWeekSoFar: WeekStats;
  /** Today's planned workout (or null on rest days). */
  todayDay: PlanWeekDay | null;
  /** Local hour 0-23, drives the "Good morning / afternoon / evening"
   *  prefix. Caller passes the user's local time so the greeting
   *  matches what the runner sees on the wall clock. Defaults to 8
   *  (morning) when omitted, so existing callers don't regress. */
  localHour?: number;
  /** Miles logged on today specifically (post-run). When non-null AND
   *  ≥ ~90% of planned, the briefing flips from PRE-RUN prescription
   *  voice ("Run it conversational, last quarter can drift faster") to
   *  POST-RUN reflection voice ("X mi banked. Quiet day tomorrow.")
   *  Acknowledges that the run is DONE — the coach must not keep
   *  telling you how to run something you've already finished. */
  todayActualMi?: number | null;
}

/** Pick a time-of-day greeting that matches the runner's wall clock. */
function greetingForHour(hour: number): string {
  if (hour < 4 || hour >= 22) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function fmtPace(sPerMi: number): string {
  const m = Math.floor(sPerMi / 60);
  const s = sPerMi % 60;
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}

function dayOfWeekIdx(iso: string): number {
  // 0=Sun, 1=Mon, ..., 6=Sat
  return new Date(iso + 'T12:00:00Z').getUTCDay();
}

function fmtMonthDay(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Adverb that frames how close the runner is to the start line. */
function urgencyFraming(daysToRace: number): string {
  if (daysToRace <= 14)   return `Race week is the next horizon, ${daysToRace} days out.`;
  if (daysToRace <= 28)   return `Taper is on the horizon (${daysToRace} days to the start).`;
  if (daysToRace <= 56)   return `Build phase territory, ${daysToRace} days to race.`;
  return `${daysToRace} days to the start line.`;
}

/** Pluralization helper without pulling in a lib. */
function n(count: number, singular: string, plural?: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${plural ?? singular + 's'}`;
}

/** Pick a representative non-rest day with the heaviest workload for "the key one". */
function pickKeyWorkout(week: PlanWeek): PlanWeekDay | null {
  const nonRest = week.days.filter((d) => !d.isRest);
  if (nonRest.length === 0) return null;
  // Race trumps long trumps quality trumps long-mileage easy
  const race = nonRest.find((d) => d.type === 'race');
  if (race) return race;
  const long = nonRest.find((d) => d.type === 'long');
  if (long) return long;
  const quality = nonRest.find((d) => d.type === 'quality');
  if (quality) return quality;
  return nonRest.slice().sort((a, b) => b.distanceMi - a.distanceMi)[0];
}

function intensityCopyFor(type: string): string {
  if (type === 'easy' || type === 'recovery') return 'Conversational pace; the work is built on the easy days.';
  if (type === 'long')    return 'Time on feet is the stimulus; pace stays conversational, last 20 can drift if it feels natural.';
  if (type === 'quality') return 'Comfortably hard, controlled threshold effort, work then cool down easy.';
  if (type === 'race')    return 'Race day. Conserve early, commit late.';
  return '';
}

/* ───────────────────────────────────────────────────────────────────
 * The generator
 * ─────────────────────────────────────────────────────────────────── */

export function generateBriefing(input: BriefingInput): string {
  const { today, daysToRace, raceLabel, currentWeek, previousWeek, lastWeekStats, thisWeekSoFar, todayDay, todayActualMi } = input;
  void raceLabel; void greetingForHour; void fmtMonthDay; void n; void urgencyFraming; void intensityCopyFor;
  const dow = dayOfWeekIdx(today);
  const isMonday    = dow === 1;
  const isSunday    = dow === 0;
  const isSaturday  = dow === 6;
  const isRest      = !todayDay || todayDay.isRest === true || todayDay.distanceMi === 0;

  // Multi-paragraph briefings: clauses joined with '\n\n'. The /overview
  // page splits on the blank line and renders each as its own <p>. The
  // string-typed return preserves the API surface so iOS continues to
  // get a single payload — clients that don't split just see the
  // paragraphs run on (acceptable degraded render).
  const join = (...paras: (string | null | undefined)[]): string =>
    paras.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).join('\n\n');

  // Plan helpers shared by both pre- and post-run branches.
  const sundayLong = currentWeek.days.find((d) => d.type === 'long' || d.type === 'race');
  const futureSundayLong = sundayLong && sundayLong.date > today ? sundayLong : null;
  const bankedMi = Math.round(thisWeekSoFar.totalMi);
  const plannedToHere = (() => {
    // Sum of planned miles for days strictly before today.
    let s = 0;
    for (const d of currentWeek.days) {
      if (d.date < today && !d.isRest) s += d.distanceMi || 0;
    }
    return Math.round(s * 10) / 10;
  })();
  const phaseWord = currentWeek.phase === 'BASE' ? 'base'
    : currentWeek.phase === 'BUILD' ? 'build'
    : currentWeek.phase === 'PEAK'  ? 'peak'
    : currentWeek.phase === 'TAPER' ? 'taper'
    : 'race week';

  /** Find the next noteworthy session this week (today excluded). */
  function nextKeyThisWeek(): { day: string; label: string } | null {
    const order = ['race', 'long', 'quality'] as const;
    for (const t of order) {
      const found = currentWeek.days.find((d) => d.date > today && !d.isRest && d.type === t);
      if (found) {
        return { day: dowNameFromIdx(dayOfWeekIdx(found.date)), label: `${found.distanceMi} mi ${t === 'quality' ? 'quality session' : t}` };
      }
    }
    return null;
  }

  /** Race-horizon framing for the closing paragraph, only when meaningful. */
  function raceHorizon(): string | null {
    if (daysToRace <= 0) return null;
    if (daysToRace <= 7)  return `Race week. The work is done; the only job now is to show up fresh.`;
    if (daysToRace <= 14) return `Race is two weeks out. Taper logic owns the next ten days, sharpness comes from rest, not more pounding.`;
    if (daysToRace <= 28) return `Race is ${daysToRace} days out. The peak window is closing, taper enters next phase.`;
    return null;
  }

  // ── POST-RUN OVERRIDE ────────────────────────────────────────
  // If today's run is DONE, the coach must not keep prescribing it.
  // Flip to reflection + diagnosis + forward-looking projection. The
  // dedicated Run Detail page carries the full FORM read; the briefing
  // covers WHAT JUST HAPPENED + WHERE THAT PUTS US.
  if (todayActualMi != null && todayActualMi > 0 && todayDay && !todayDay.isRest && todayDay.distanceMi > 0) {
    const completionPct = todayActualMi / todayDay.distanceMi;
    if (completionPct >= 0.9) {
      const banked = Math.round(todayActualMi * 10) / 10;
      const t = todayDay.type;
      // Week shape AFTER absorbing today's miles, so the diagnosis paragraph
      // reflects current ledger, not the pre-run number.
      const weekTotal = Math.round((bankedMi + banked) * 10) / 10;
      const weekPlanned = currentWeek.plannedMi;
      const weekFraction = weekPlanned > 0 ? weekTotal / weekPlanned : 0;
      const weekReadPara = weekPlanned > 0
        ? (weekFraction >= 0.95
            ? `That puts the week at ${weekTotal} of ${weekPlanned} mi planned. Comes home on plan.`
            : weekFraction >= 0.65
            ? `That puts the week at ${weekTotal} of ${weekPlanned} mi planned. Solid bank, room left if the schedule calls for more.`
            : `That puts the week at ${weekTotal} of ${weekPlanned} mi planned. There's still the back half of the week to write.`)
        : null;
      const next = nextKeyThisWeek();
      const horizon = raceHorizon();

      if (t === 'long') {
        return join(
          `${banked} mi long run banked. The week's anchor is in.`,
          `That's the kind of session that builds the engine. The aerobic system doesn't care how fast it went, only that the time on feet got done.`,
          weekReadPara,
          `Quiet day tomorrow. Let the legs absorb what just went in.`,
          horizon,
        );
      }
      if (t === 'race') {
        return join(
          `Race in the books.`,
          `The training is what brought you to the line. Now recovery starts: real food, real sleep, walking is plenty for today.`,
          `Race retrospectives don't write themselves the day of. Give it a day, then we'll read the splits and pull the lessons.`,
        );
      }
      if (t === 'quality') {
        return join(
          `Quality session done. ${banked} mi in.`,
          `This is where fitness actually gets made. A workout that demanded something, a body that delivered it. Three or four of these stacked together is what moves the needle.`,
          weekReadPara,
          `Tomorrow stays easy so the work lands. Don't compound off one good day.`,
        );
      }
      if (t === 'easy' || t === 'recovery') {
        return join(
          `Easy ${banked} mi in. Boring on purpose, exactly the right shape.`,
          `Half the value of any build is the easy days run honestly. The hard work already happened; today was the deposit.`,
          next ? `Up next this week: ${next.day} brings the ${next.label}.` : weekReadPara,
        );
      }
      return join(
        `${banked} mi banked. Today's done.`,
        next ? `Up next: ${next.day}'s ${next.label}.` : `Tomorrow's the next thing.`,
      );
    }
    // Short of plan but still ran something — acknowledge it honestly.
    if (completionPct >= 0.5) {
      const banked = Math.round(todayActualMi * 10) / 10;
      const planned = todayDay.distanceMi;
      return join(
        `${banked} of ${planned} mi today. Short of plan, but it counts.`,
        `The weekly mileage isn't the point; the cumulative load is. A short day beats a skipped day every time.`,
        nextKeyThisWeek() ? `Up next this week: ${nextKeyThisWeek()!.day}'s ${nextKeyThisWeek()!.label}.` : null,
      );
    }
  }

  // ── PRE-RUN / NON-RUN VOICE ──────────────────────────────────
  // Day-of-week branches with multi-paragraph output. Each branch
  // serves at least two of the six jobs (REFLECTION + PRESCRIPTION,
  // PRESCRIPTION + PROJECTION, etc.).

  /** "On plan", "+12% ahead", "−18% behind" — only when the comparison is meaningful. */
  function weekPaceRead(): string | null {
    if (plannedToHere <= 0 || bankedMi <= 0) return null;
    const pct = Math.round(((bankedMi - plannedToHere) / plannedToHere) * 100);
    if (Math.abs(pct) <= 5) return `on plan through ${dowNameFromIdx(dow - 1)} (${bankedMi} of ${plannedToHere} mi banked)`;
    if (pct > 0)            return `${pct}% ahead of plan through ${dowNameFromIdx(dow - 1)} (${bankedMi} / ${plannedToHere} mi)`;
    return `${Math.abs(pct)}% short of plan through ${dowNameFromIdx(dow - 1)} (${bankedMi} / ${plannedToHere} mi)`;
  }

  // ── MONDAY · reflect last week, frame this week, prescribe today ──
  if (isMonday) {
    const horizon = raceHorizon();
    const next = nextKeyThisWeek();
    if (previousWeek && lastWeekStats.totalMi > 0) {
      const ranMi = Math.round(lastWeekStats.totalMi);
      const plannedMi = previousWeek.plannedMi;
      const deltaPct = plannedMi > 0 ? Math.round(((ranMi - plannedMi) / plannedMi) * 100) : 0;
      const closedWord = Math.abs(deltaPct) <= 5 ? 'closed out on plan'
        : deltaPct > 0 ? `closed ${Math.abs(deltaPct)}% over plan`
        : `closed ${Math.abs(deltaPct)}% short`;
      const longRead = lastWeekStats.longest
        ? `, longest ${lastWeekStats.longest.mi} mi at ${fmtPace(lastWeekStats.longest.paceSPerMi)}`
        : '';
      const cwPlanned = currentWeek.plannedMi;
      const rampPara = cwPlanned > plannedMi + 1
        ? `Stepping up to ${cwPlanned} mi of ${phaseWord} this week. Build territory means more volume and the quality day starts to bite. The easy days stay genuinely easy, or this falls apart.`
        : cwPlanned < plannedMi - 1
        ? `Easing to ${cwPlanned} mi this week. Cutback. Fitness gets banked during weeks like this, not by pounding harder.`
        : `Holding ${cwPlanned} mi this week. Consistency at this volume is what compounds.`;
      const todayPara = isRest
        ? `Today is rest. The body banks last week's work today, not by piling on more.`
        : todayDay ? `Today: ${todayDay.label.toLowerCase()}, ${todayDay.distanceMi} mi. Easy starts the week the right way.` : null;
      return join(
        `Last week ${closedWord} (${ranMi} / ${plannedMi} mi)${longRead}.`,
        rampPara,
        todayPara,
        next ? `The key day this week is ${next.day}: ${next.label}.` : null,
        horizon,
      );
    }
    return join(
      `Fresh week opening. ${currentWeek.plannedMi} mi of ${phaseWord} on the board, ${currentWeek.days.filter((d) => !d.isRest).length} sessions.`,
      next ? `Centerpiece is ${next.day}: ${next.label}.` : null,
      isRest ? `Today is rest. The week starts the right way by NOT chasing miles on Monday.` : `Today is your easy opener. Conversational pace, no heroics.`,
      horizon,
    );
  }

  // ── SUNDAY long-run · frame what the week earned + how to run it ──
  if (isSunday && todayDay && (todayDay.type === 'long' || todayDay.type === 'race')) {
    if (todayDay.type === 'race') {
      return join(
        `Race day.`,
        `Conserve the first third, settle the middle, commit the last 5k. Every fast plan dies in the opening miles.`,
        `Fuel on schedule, drink to thirst. Trust the work that's already in the bank.`,
      );
    }
    const horizon = raceHorizon();
    if (bankedMi > 0) {
      return join(
        `${bankedMi} mi banked this week. Today's ${todayDay.distanceMi} mi is the payoff.`,
        `Run it conversational. Time on feet is the stimulus; the back half can drift faster if the legs want it, but don't chase pace.`,
        `Tomorrow is the absorption window. No matter how good today feels, don't compound off one strong long run.`,
        horizon,
      );
    }
    return join(
      `Today is the week's anchor: ${todayDay.distanceMi} mi long run.`,
      `Conversational for the bulk. Let pace come to you on the back half — don't force it.`,
      horizon,
    );
  }

  // ── SATURDAY ── shape the weekend ──
  if (isSaturday) {
    const horizon = raceHorizon();
    if (futureSundayLong) {
      const rolePara = todayDay && !isRest
        ? `Today is the shake-out for tomorrow's ${futureSundayLong.distanceMi} mi. ${todayDay.distanceMi} mi easy. Loose the legs without taxing them.`
        : `Today is rest. Tomorrow's ${futureSundayLong.distanceMi} mi is the week's anchor — fresh legs matter.`;
      return join(
        rolePara,
        `Protect the legs. Hydrate today, eat normally, get in bed at a reasonable hour.`,
        horizon,
      );
    }
    if (isRest) {
      return join(
        `Rest day. Hydrate, sleep on time, light mobility if you feel like it.`,
        weekPaceRead() ? `You're ${weekPaceRead()}. That's the week's shape going into the weekend.` : null,
        horizon,
      );
    }
  }

  // ── REST mid-week ──
  if (isRest) {
    const read = weekPaceRead();
    return join(
      `Today is rest.`,
      `Recovery is part of the work, not separate from it. The adaptations happen during the down days; the runs are the stimulus.`,
      read ? `So far you're ${read}.` : null,
      futureSundayLong ? `Up ahead: Sunday's ${futureSundayLong.distanceMi} mi long run is the week's centerpiece.` : null,
    );
  }

  // ── MID-WEEK / FRIDAY run day ──
  if (todayDay) {
    const t = todayDay.type;
    const read = weekPaceRead();
    const horizon = raceHorizon();

    if (t === 'quality') {
      return join(
        `Quality day: ${todayDay.label.toLowerCase()}, ${todayDay.distanceMi} mi.`,
        `Hit the band. Finish controlled. Don't bury yourself — three or four of these stacked across a phase is what moves fitness, not one hero day.`,
        futureSundayLong
          ? `Sunday's ${futureSundayLong.distanceMi} mi long run needs fresh legs, so today's job is sharp work followed by a clean cool-down.`
          : `The next 48 hours is where the work actually lands. Tomorrow stays easy.`,
        horizon,
      );
    }
    if (t === 'long') {
      return join(
        `Today is the long run: ${todayDay.distanceMi} mi.`,
        `Time on feet is the stimulus. Run the bulk conversational; the back half can drift slower if it needs to.`,
        horizon,
      );
    }
    if (t === 'easy' || t === 'recovery') {
      const easyPara = `Today's easy is ${todayDay.distanceMi} mi at honest conversational pace. If you can't hold a sentence, slow down. That's the rule.`;
      const purposePara = futureSundayLong
        ? `This is glycogen-saving for Sunday's ${futureSundayLong.distanceMi} mi long run. Pace is a result, not a target.`
        : `Easy days are the work; hard days are the spice. Run this honestly and the harder sessions land harder.`;
      return join(
        easyPara,
        purposePara,
        read ? `For context: you're ${read}.` : null,
        horizon,
      );
    }
  }

  // Fallback (no todayDay metadata or unknown type)
  return join(
    `Today's run is on the schedule.`,
    `Keep effort honest. The plan is built around the pattern across weeks, not any single session.`,
  );
}

/** Used in inline copy: "through Thursday". 0=Sun … 6=Sat. */
function dowNameFromIdx(idx: number): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const i = ((idx % 7) + 7) % 7;
  return names[i];
}

function capFirst(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
