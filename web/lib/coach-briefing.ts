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
  const { firstName, today, daysToRace, raceLabel, currentWeek, previousWeek, lastWeekStats, thisWeekSoFar, todayDay, localHour } = input;
  const greetingPrefix = greetingForHour(localHour ?? 8);
  // Tag every "Good morning" reference so they pick up the time-aware variant.
  void raceLabel; // (currently unused but reserved for race-day greetings)
  const dow = dayOfWeekIdx(today);   // 0=Sun
  const isMonday    = dow === 1;
  const isSunday    = dow === 0;
  const isFriday    = dow === 5;
  const isSaturday  = dow === 6;
  const isRest      = !todayDay || todayDay.isRest === true || todayDay.distanceMi === 0;

  const greeting = firstName ? `${firstName}` : 'there';

  // ── MONDAY · reflect on last week + frame this week ─────────────
  if (isMonday) {
    let lastWeekSentence = '';
    if (previousWeek && lastWeekStats.totalMi > 0) {
      const plannedMi = previousWeek.plannedMi;
      const ranMi     = lastWeekStats.totalMi;
      const sessions  = lastWeekStats.runDays;
      const plannedSessions = previousWeek.days.filter((d) => !d.isRest).length;
      const deltaPct = plannedMi > 0 ? Math.round(((ranMi - plannedMi) / plannedMi) * 100) : 0;
      const deltaWord = Math.abs(deltaPct) <= 5 ? 'on plan'
        : deltaPct > 0 ? `${Math.abs(deltaPct)}% over`
        : `${Math.abs(deltaPct)}% short`;

      lastWeekSentence = `Last week: ${ranMi} mi across ${n(sessions, 'session')} (${deltaWord} on ${plannedMi} mi planned, ${sessions}/${plannedSessions} done).`;

      if (lastWeekStats.longest) {
        const L = lastWeekStats.longest;
        lastWeekSentence += ` Long run was ${L.mi} mi at ${fmtPace(L.paceSPerMi)}.`;
      }
    } else if (previousWeek) {
      lastWeekSentence = `Last week was a rest reset, no logged runs.`;
    } else {
      lastWeekSentence = `Fresh start to the cycle.`;
    }

    // Frame this week
    const key = pickKeyWorkout(currentWeek);
    const phaseName = currentWeek.phase === 'BASE' ? 'base'
      : currentWeek.phase === 'BUILD' ? 'build'
      : currentWeek.phase === 'PEAK'  ? 'peak'
      : currentWeek.phase === 'TAPER' ? 'taper'
      : 'race week';
    let thisWeekSentence = `This week: ${currentWeek.plannedMi} mi of ${phaseName} work`;
    if (key) {
      thisWeekSentence += `, anchored by ${key.label} on ${fmtMonthDay(key.date)}.`;
    } else {
      thisWeekSentence += '.';
    }

    // Today's piece
    let todaySentence = '';
    if (isRest) {
      todaySentence = `Today's a rest, use it.`;
    } else if (todayDay) {
      todaySentence = `Today is ${todayDay.label.toLowerCase()} at ${todayDay.distanceMi} mi, ${intensityCopyFor(todayDay.type)}`;
    }

    return [
      `${greetingPrefix}, ${greeting}. ${lastWeekSentence}`,
      thisWeekSentence,
      todaySentence,
      urgencyFraming(daysToRace),
    ].filter(Boolean).join(' ');
  }

  // ── SUNDAY · long-run day or rest-day frame ─────────────────────
  if (isSunday && todayDay?.type === 'long') {
    let openLine = '';
    if (thisWeekSoFar.totalMi > 0) {
      openLine = `${thisWeekSoFar.totalMi} mi banked through Saturday across ${n(thisWeekSoFar.runDays, 'session')}. `;
    }
    return `${openLine}Long today: ${todayDay.distanceMi} mi. ${intensityCopyFor('long')} ${urgencyFraming(daysToRace)}`;
  }

  // ── FRIDAY · "weekend is loaded" framing ────────────────────────
  if (isFriday && !isRest && todayDay) {
    const sundayLong = currentWeek.days.find((d) => d.type === 'long' || d.type === 'race');
    let sundayMention = '';
    if (sundayLong && sundayLong.date > today) {
      sundayMention = ` Sunday is ${sundayLong.distanceMi} mi ${sundayLong.type === 'race' ? ', race day' : ', save the legs'}.`;
    }
    return `Today is ${todayDay.label.toLowerCase()} at ${todayDay.distanceMi} mi. ${intensityCopyFor(todayDay.type)}${sundayMention} ${urgencyFraming(daysToRace)}`;
  }

  // ── SATURDAY rest or shake-out framing ──────────────────────────
  if (isSaturday) {
    const sundayLong = currentWeek.days.find((d) => d.type === 'long' || d.type === 'race');
    const sundayLine = sundayLong ? ` Tomorrow: ${sundayLong.distanceMi} mi ${sundayLong.type === 'race' ? 'race' : 'long'}.` : '';
    if (isRest) {
      return `Rest day, ${greeting}. Hydrate, sleep on time, light mobility if you feel like it.${sundayLine} ${urgencyFraming(daysToRace)}`;
    }
    return `Today is ${todayDay!.label.toLowerCase()} at ${todayDay!.distanceMi} mi. ${intensityCopyFor(todayDay!.type)}${sundayLine} ${urgencyFraming(daysToRace)}`;
  }

  // ── Mid-week fallback ───────────────────────────────────────────
  if (isRest) {
    return `Rest day. ${thisWeekSoFar.totalMi > 0 ? `${thisWeekSoFar.totalMi} mi in so far this week.` : ''} ${urgencyFraming(daysToRace)}`.trim();
  }

  // Has a workout today
  const openLine = thisWeekSoFar.totalMi > 0
    ? `${thisWeekSoFar.totalMi} mi this week so far. `
    : '';
  return `${openLine}Today is ${todayDay!.label.toLowerCase()} at ${todayDay!.distanceMi} mi. ${intensityCopyFor(todayDay!.type)} ${urgencyFraming(daysToRace)}`;
}
