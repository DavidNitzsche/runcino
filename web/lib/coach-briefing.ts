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
  const { today, daysToRace, raceLabel, currentWeek, previousWeek, lastWeekStats, thisWeekSoFar, todayDay } = input;
  void raceLabel; void greetingForHour; void fmtMonthDay; void n; void urgencyFraming; void intensityCopyFor;
  const dow = dayOfWeekIdx(today);
  const isMonday    = dow === 1;
  const isSunday    = dow === 0;
  const isSaturday  = dow === 6;
  const isRest      = !todayDay || todayDay.isRest === true || todayDay.distanceMi === 0;

  // The hero already shows today's workout (EASY · 5.8 mi · 8:46/mi). The
  // coach line's job is INSIGHT — what only someone reading your week
  // would say. Two short sentences max, no recitation of today's
  // prescription, no race countdown (the AFC chip up top owns that).

  // ── helpers ──
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

  /** "On plan", "+12% ahead", "−18% behind" — only when the comparison is meaningful. */
  function weekPaceRead(): string | null {
    if (plannedToHere <= 0 || bankedMi <= 0) return null;
    const pct = Math.round(((bankedMi - plannedToHere) / plannedToHere) * 100);
    if (Math.abs(pct) <= 5) return `on plan through ${dowNameFromIdx(dow - 1)} (${bankedMi} of ${plannedToHere} mi banked)`;
    if (pct > 0)            return `${pct}% ahead of plan through ${dowNameFromIdx(dow - 1)} (${bankedMi} / ${plannedToHere} mi)`;
    return `${Math.abs(pct)}% short of plan through ${dowNameFromIdx(dow - 1)} (${bankedMi} / ${plannedToHere} mi)`;
  }

  // ── MONDAY · short read on last week + frame this week's shape ──
  if (isMonday) {
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
      const ramp = cwPlanned > plannedMi + 1
        ? `Stepping up to ${cwPlanned} mi of ${phaseWord} this week.`
        : cwPlanned < plannedMi - 1
        ? `Easing to ${cwPlanned} mi this week, a cutback.`
        : `Holding ${cwPlanned} mi this week.`;
      return `Last week ${closedWord} (${ranMi} / ${plannedMi} mi)${longRead}. ${ramp}`;
    }
    return `Fresh week opening: ${currentWeek.plannedMi} mi of ${phaseWord}, ${currentWeek.days.filter((d) => !d.isRest).length} sessions.`;
  }

  // ── SUNDAY long-run · frame what the week earned + how to run it ──
  if (isSunday && todayDay && (todayDay.type === 'long' || todayDay.type === 'race')) {
    if (todayDay.type === 'race') {
      return `Race day. Conserve the first third, settle the middle, commit the last 5k.`;
    }
    if (bankedMi > 0) {
      return `${bankedMi} mi banked this week. Today's ${todayDay.distanceMi} mi is the payoff. Run it conversational; the last quarter can drift faster if it wants to.`;
    }
    return `Today's the week's anchor — conversational for the bulk, let pace come to you on the back half.`;
  }

  // ── SATURDAY ── shape the weekend ──
  if (isSaturday) {
    if (futureSundayLong) {
      const role = todayDay && !isRest ? 'Today is the shake-out' : 'Today is the rest day';
      return `${role} for tomorrow's ${futureSundayLong.distanceMi} mi. Protect the legs, keep effort light.`;
    }
    if (isRest) {
      return `Rest day. Hydrate, sleep on time, light mobility if you feel like it.`;
    }
  }

  // ── REST mid-week ──
  if (isRest) {
    if (bankedMi > 0 && plannedToHere > 0) {
      const read = weekPaceRead();
      return read ? `Rest day. You're ${read}. Recovery is part of the work; tomorrow picks back up.` : `Rest day. Recovery is part of the work; tomorrow picks back up.`;
    }
    return `Rest day. Recovery is part of the work.`;
  }

  // ── MID-WEEK / FRIDAY run day — INSIGHT, NOT RECITATION ──
  // Pick the most useful observation: load-vs-plan if interesting, else
  // point to Sunday's anchor and frame today against it.
  if (todayDay) {
    const t = todayDay.type;
    // Quality day: emphasize execution + recovery downstream.
    if (t === 'quality') {
      if (futureSundayLong) {
        return `Today's the quality session. Execute clean, then back off. Sunday's ${futureSundayLong.distanceMi} mi long run needs fresh legs.`;
      }
      return `Today's the quality session. Execute clean, then back off. Recovery between hard days is where the gain locks in.`;
    }
    // Long mid-week (rare): point to the volume frame.
    if (t === 'long') {
      return `Today's the long run. Time on feet is the stimulus; the back half can drift slower if it needs to.`;
    }
    // EASY day — insight depends on what's around it.
    if (t === 'easy' || t === 'recovery') {
      const read = weekPaceRead();
      if (futureSundayLong) {
        // Friday/Sat easy with a Sunday long: this is recovery for the anchor.
        if (read) {
          return `${capFirst(read)}. Today's easy is glycogen-saving for Sunday's ${futureSundayLong.distanceMi} mi. Keep effort honest.`;
        }
        return `Today's easy is glycogen-saving for Sunday's ${futureSundayLong.distanceMi} mi long run. Keep effort honest; pace is a result, not a target.`;
      }
      if (read) {
        return `${capFirst(read)}. Today's easy keeps the engine running without adding load.`;
      }
      return `Today's easy is base-building, not training. Keep HR honest and the work happens.`;
    }
  }

  // Fallback (no todayDay metadata or unknown type)
  return `Today's run is on the schedule. Keep effort honest; the plan's built around the pattern, not any single session.`;
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
