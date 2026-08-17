/**
 * post-race-composition · Today's post-race state (web recomposition deck,
 * Decision 1 · approved 2026-08-17).
 *
 * The week after a race, Today rendered as an ordinary training day whose
 * plan happened to be empty. The deck's ruling: days 0 to 7 after a race
 * get their own composition.
 *
 * 2026-08-17 · CORRECTED. The first build of that ruling overcorrected:
 * it gave the race the hero on every day of the window and dropped the
 * day's own prescription entirely, so the morning after his half David
 * read a page that never mentioned the easy 4 he was supposed to run.
 * The beat ORDER now lives in lib/today/composition.ts, which puts
 * today's work first from day 1 onward and demotes the race to a line.
 *
 * What stays here is what only this state knows: how long ago the race
 * was, and the shape of the recovery window the plan actually wrote.
 *
 * ── The thing that must not be hardcoded ───────────────────────────────
 *
 * Recovery windows are CONTEXT-AWARE as of 52174bcd. A half marathon in
 * the middle of a marathon build now prescribes roughly 17 then 23 miles
 * of easy running across two weeks, on four then six running days — NOT
 * two weeks of rest (Research/00b-recovery-protocols.md:196-204 has two
 * distinct columns; "no quality for 10-14 days" is not "no running for
 * 10-14 days"). A marathon's own window is a four-week reverse taper.
 *
 * So nothing here assumes a length, a shape, or a rest day. Every field
 * is read off the ACTIVE PLAN: the RECOVERY phase span from plan_phases,
 * and the real prescribed days inside it from plan_workouts. What the
 * plan says is what the page renders, easy runs included.
 *
 * When there is no recovery plan (the runner has no plan, or the block
 * that covers today is not a recovery block), selectRecoveryWindow
 * returns null and the caller degrades to the race hero plus the ordinary
 * week strip. Nothing is invented.
 *
 * Pure module · no React, no fetch. Tested in post-race-composition.test.ts.
 */

/** A plan_phases row as the seed exposes it. */
export type PhaseSpan = {
  label: string;
  startWeekIdx: number;
  endWeekIdx: number;
};

/** One prescribed day, as season.weekDays exposes it. */
export type PlanDayLite = {
  /** ISO YYYY-MM-DD. Days without a date cannot be placed and are skipped. */
  date?: string;
  dow: string;
  type: string;
  name: string;
  mi: number;
  done?: boolean;
};

/** One cell of the recovery-window strip, rendered exactly as prescribed. */
export type RecoveryDay = {
  iso: string;
  /** MON / TUE / … straight from the plan row. */
  dow: string;
  /** Day of month, for the big numeral. */
  dayNum: number;
  type: string;
  /** "Easy 4" / "Long 8" / "Off" — derived from the row, never invented. */
  label: string;
  miles: number;
  isRunning: boolean;
  isToday: boolean;
  isPast: boolean;
  done: boolean;
};

export type RecoveryWindow = {
  /** First prescribed date in the window. */
  startISO: string;
  /** Last prescribed date in the window. */
  endISO: string;
  /** "Aug 17 to 30" — the window's real span, not a fixed 7 or 14. */
  rangeLabel: string;
  /** Day after the window ends. Null when the plan ends with the window. */
  nextBlockISO: string | null;
  /** "next block opens Aug 31", or null. */
  nextBlockLabel: string | null;
  /** 1-based week within the window. */
  weekIndex: number;
  /** How many weeks the window actually spans. */
  weeksTotal: number;
  /** 1-based day within the window (day 1 = startISO). */
  dayIndex: number;
  /** Total days the window spans, inclusive. */
  daysTotal: number;
  /** The current week's prescribed days, in plan order. Drives the strip. */
  days: RecoveryDay[];
  /** Planned miles in the current window week. */
  weekPlannedMi: number;
  /** Miles already logged in the current window week. */
  weekDoneMi: number;
  /** How many days of the current week actually prescribe a run. */
  runningDays: number;
  /** The phase label the plan authored, e.g. "RECOVERY". */
  phaseLabel: string;
};

/* ── date helpers · noon-UTC anchored so no label ever shifts a day ───── */

function parseISO(iso: string): number {
  return Date.parse(iso.slice(0, 10) + 'T12:00:00Z');
}

function shortDate(iso: string): string {
  const t = parseISO(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(t));
}

function dayOfMonth(iso: string): number {
  const t = parseISO(iso);
  if (!Number.isFinite(t)) return 0;
  return new Date(t).getUTCDate();
}

function addDays(iso: string, n: number): string {
  const t = parseISO(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ta = parseISO(a);
  const tb = parseISO(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.round((tb - ta) / 86400000);
}

/**
 * "Aug 17 to 30" when the window sits in one month, "Aug 28 to Sep 10"
 * when it crosses one. Written the way a coach says it, not as a range
 * glyph.
 */
export function formatWindowRange(startISO: string, endISO: string): string {
  const a = shortDate(startISO);
  const b = shortDate(endISO);
  const sameMonth = a.split(' ')[0] === b.split(' ')[0];
  return sameMonth ? `${a} to ${dayOfMonth(endISO)}` : `${a} to ${b}`;
}

/** "Easy 4" / "Long 8" / "Off". Reads the prescription, never guesses. */
export function recoveryDayLabel(day: PlanDayLite): string {
  const t = (day.type ?? '').toLowerCase();
  if (t === 'rest' || day.mi <= 0) return 'Off';
  const noun =
    t === 'long' ? 'Long' :
    t === 'recovery' ? 'Recovery' :
    t === 'easy' ? 'Easy' :
    // A recovery block should not carry quality, but if the plan authored
    // something else, say what it says rather than flattening it to Easy.
    t.charAt(0).toUpperCase() + t.slice(1);
  const mi = Math.round(day.mi * 10) / 10;
  return `${noun} ${mi % 1 === 0 ? mi.toFixed(0) : mi.toFixed(1)}`;
}

/**
 * Find the recovery block that covers today and read its real shape.
 *
 * Returns null when no phase whose label reads as recovery contains the
 * current week — including the ordinary case of a runner mid-build. The
 * caller must handle null; there is no synthetic fallback window.
 */
export function selectRecoveryWindow(input: {
  phases: PhaseSpan[];
  weekDays: PlanDayLite[][];
  nowIdx: number;
  todayISO: string;
}): RecoveryWindow | null {
  const { phases, weekDays, nowIdx, todayISO } = input;
  if (!Array.isArray(phases) || phases.length === 0) return null;
  if (!Array.isArray(weekDays) || weekDays.length === 0) return null;

  const phase = phases.find(
    (p) =>
      /recover/i.test(p.label ?? '') &&
      nowIdx >= p.startWeekIdx &&
      nowIdx <= p.endWeekIdx,
  );
  if (!phase) return null;

  const startWeek = Math.max(0, phase.startWeekIdx);
  const endWeek = Math.min(weekDays.length - 1, phase.endWeekIdx);
  if (endWeek < startWeek) return null;

  // Every dated day inside the window, so the span is the plan's own span
  // rather than a count of weeks times seven.
  const allDates: string[] = [];
  for (let w = startWeek; w <= endWeek; w++) {
    for (const d of weekDays[w] ?? []) {
      if (d.date) allDates.push(d.date);
    }
  }
  if (allDates.length === 0) return null;
  allDates.sort();
  const startISO = allDates[0];
  const endISO = allDates[allDates.length - 1];

  // The plan may continue past the recovery block. When it does, the next
  // block opens the day after; when it does not, say nothing.
  const hasLaterWeek = endWeek < weekDays.length - 1 &&
    (weekDays[endWeek + 1] ?? []).some((d) => !!d.date);
  const nextBlockISO = hasLaterWeek ? addDays(endISO, 1) : null;

  const currentWeek = weekDays[Math.max(startWeek, Math.min(endWeek, nowIdx))] ?? [];
  const days: RecoveryDay[] = currentWeek
    .filter((d) => !!d.date)
    .map((d) => {
      const iso = d.date as string;
      const mi = Math.max(0, d.mi ?? 0);
      const isRunning = (d.type ?? '').toLowerCase() !== 'rest' && mi > 0;
      return {
        iso,
        dow: d.dow,
        dayNum: dayOfMonth(iso),
        type: d.type,
        label: recoveryDayLabel(d),
        miles: mi,
        isRunning,
        isToday: iso === todayISO,
        isPast: iso < todayISO,
        done: !!d.done,
      };
    });

  const weekPlannedMi =
    Math.round(days.reduce((s, d) => s + d.miles, 0) * 10) / 10;
  const weekDoneMi = 0; // filled by the caller from real logged miles

  return {
    startISO,
    endISO,
    rangeLabel: formatWindowRange(startISO, endISO),
    nextBlockISO,
    nextBlockLabel: nextBlockISO ? `next block opens ${shortDate(nextBlockISO)}` : null,
    weekIndex: Math.max(1, Math.min(endWeek - startWeek + 1, nowIdx - startWeek + 1)),
    weeksTotal: endWeek - startWeek + 1,
    dayIndex: Math.max(1, daysBetween(startISO, todayISO) + 1),
    daysTotal: daysBetween(startISO, endISO) + 1,
    days,
    weekPlannedMi,
    weekDoneMi,
    runningDays: days.filter((d) => d.isRunning).length,
    phaseLabel: phase.label,
  };
}

/**
 * The window's one-line summary, spoken from what the plan prescribes.
 *
 * "4 running days · 17 mi easy" for a half's context-aware window;
 * "2 running days · 6 mi easy" for a marathon's reverse taper; "rest
 * only" when the plan really did prescribe no running. The sentence is
 * derived, never asserted.
 *
 * 2026-08-17 · the "Week 1 of 2" prefix is gone. David read the live page
 * and found the same window described three separate ways on one screen —
 * "DAY 1 OF 14", "RECOVERY WINDOW · AUG 17 TO 30", and "Week 1 of 2".
 * Position in the window is now stated once, in the strip header. This
 * line says what the week HOLDS, which is the one thing the header does
 * not.
 */
export function recoveryWeekSummary(w: RecoveryWindow): string {
  if (w.runningDays === 0) return 'rest only';
  const dayPart = `${w.runningDays} running day${w.runningDays === 1 ? '' : 's'}`;
  const miPart = `${w.weekPlannedMi % 1 === 0 ? w.weekPlannedMi.toFixed(0) : w.weekPlannedMi.toFixed(1)} mi easy`;
  return `${dayPart} · ${miPart}`;
}

/* ── the composition switch ──────────────────────────────────────────── */

/**
 * 2026-08-17 · the four `show*Tile` booleans that used to live here are
 * gone. `lib/today/composition.ts` is the single authority on which tiles
 * render, in every state, and two modules answering the same question is
 * the shape of bug this codebase keeps paying for. What stays here is
 * everything only the post-race state knows: how long ago the race was,
 * and what the recovery plan actually prescribes.
 */
export type PostRaceComposition = {
  /** True when Today should render the post-race composition. */
  active: boolean;
  /** Days since the race finished. 0 = race day itself, 1 = yesterday. */
  daysSince: number | null;
  /** "yesterday" / "2 days ago" — the recent-race beat's eyebrow tail. */
  sinceLabel: string | null;
  /** The strip's eyebrow. Carries the real range when a window exists. */
  stripHeader: string;
  /** The strip's right-hand note, or null. */
  stripNote: string | null;
  /** The line under the strip, or null when there is no recovery plan. */
  stripSummary: string | null;
  recovery: RecoveryWindow | null;
};

/** Days 0 to 7 after a race, per the deck. */
export const POST_RACE_TODAY_WINDOW_DAYS = 7;

export function composePostRaceToday(input: {
  /** /api/today/purpose returned type 'post_race'. */
  purposeIsPostRace: boolean;
  /** Days since the most recent A/B race, or null when there isn't one. */
  daysSince: number | null;
  recovery: RecoveryWindow | null;
}): PostRaceComposition {
  const { purposeIsPostRace, daysSince, recovery } = input;

  // Either signal alone is enough. The purpose endpoint is the coach's own
  // read; the race calendar is the fact. When the plan already rolled the
  // runner into a recovery block, that corroborates but is not required —
  // a runner with no plan at all still just raced.
  const inWindow =
    daysSince != null && daysSince >= 0 && daysSince <= POST_RACE_TODAY_WINDOW_DAYS;
  const active = inWindow || (purposeIsPostRace && daysSince == null);

  // One description of the window, not three. Where you are in it and how
  // long it runs, in a single eyebrow.
  //
  // 2026-08-17 · this is computed BEFORE the active branch on purpose. A
  // recovery block outlives the post-race window: David's runs 14 days,
  // the composed post-race state 7. On day 8 the runner is still in the
  // block, and a strip that reverted to "THIS WEEK" the moment the race
  // stopped being news would be describing a recovery week as an ordinary
  // one. The window's own copy belongs to the window.
  const stripHeader = recovery
    ? `RECOVERY · DAY ${recovery.dayIndex} OF ${recovery.daysTotal} · ${recovery.rangeLabel.toUpperCase()}`
    : active ? 'RECOVERY WEEK' : 'THIS WEEK';
  const stripNote = recovery?.nextBlockLabel ?? null;
  const stripSummary = recovery ? recoveryWeekSummary(recovery) : null;

  if (!active) {
    return {
      active: false,
      daysSince,
      sinceLabel: null,
      stripHeader,
      stripNote,
      stripSummary,
      recovery,
    };
  }

  const sinceLabel =
    daysSince == null ? null
      : daysSince === 0 ? 'today'
      : daysSince === 1 ? 'yesterday'
      : `${daysSince} days ago`;

  return {
    active: true,
    daysSince,
    sinceLabel,
    stripHeader,
    stripNote,
    stripSummary,
    recovery,
  };
}
