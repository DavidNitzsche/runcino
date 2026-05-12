/**
 * Coach narrative line — one sentence the coach says at the very top of
 * /overview, driven entirely by real signals on CoachState.
 *
 * Contract:
 *   "No narrative unless a real signal fires."
 *
 * Every sentence returned MUST:
 *   - cite a real state field, recent activity, check-in, or race
 *     calendar entry — never a generic motivational platitude;
 *   - reference a real number or date the runner can verify
 *     ("23 days since your last 10-mile run", not "it's been a while");
 *   - be one sentence (~≤25 words). If the thought doesn't fit, scope
 *     it down. Two-line "primary + tail clause" is allowed but rare.
 *
 * If no signal in the priority list fires, the function returns null.
 * The UI renders nothing in that case — no empty placeholder, no
 * "Keep up the great work!" filler.
 *
 * The narrative is intentionally distinct in ROLE from `nextPushes`:
 *   • `nextPushes` answers "what should I do this week?" — a to-do list.
 *   • `narrativeLine` answers "where am I right now and what just
 *      happened?" — one sentence of context.
 *
 * Topic overlap with `nextPushes` is acceptable when the voice is
 * descriptive rather than prescriptive: "Three weeks since your last
 * long run" (narrative · where you are) vs "Extend your long run to
 * 10+mi this Saturday" (push · what to do).
 *
 * Priority list (highest fires first; first match wins):
 *   1. Race-week imminent      · nextA ≤ 7 days
 *   2. Coach adjusted today    · deps.adjustment.changed === true
 *   3. Streak milestone        · consecutiveRunDays ∈ {30, 60, 90, 180}
 *   4. Stale check-in          · last check-in > 72h ago
 *   5. Recent PR / VDOT update · DEFERRED (no state.vdot field yet)
 *   6. Mid-build proof         · longest run in last 7d ≥ 12mi
 *   7. Falling behind a build  · deltaPct4v4 ≤ -0.15 + A-race in window
 *   8. Stale quality           · hardMi14d < 1 + A-race in window
 *   9. Stale long run          · days-since-last-long-run > 21
 *
 * @research Research/00a-distance-running-training.md §4. Long run
 * @research Research/00a-distance-running-training.md §5. Threshold/tempo
 * @research Research/00b-recovery-protocols.md §Decision Matrix
 * @research Research/03-taper-and-peaking.md §Race-week volume reduction
 */

import type { CoachState } from '../lib/coach-state';
import type { Citation } from './types';

/** Output shape — one sentence + audit trail. */
export interface NarrativeLine {
  /** The sentence the runner sees. ≤25 words, one sentence. */
  sentence: string;
  /** Signal source label for the UI's small "FROM YOUR …" chip. */
  basedOn: string;
  /** Optional doctrine citation. Only set when the line invokes a
   *  research-backed rule (taper depth, long-run cadence, etc.). */
  citation?: Citation;
  /** Voice tone — UI may use this to colour the line subtly. */
  tone: 'pushing' | 'softening' | 'celebrating' | 'reminding' | 'reorienting';
}

/** Optional adjacent-wave outputs passed in so we don't have to
 *  re-compute them. All optional — narrativeLine still works if none
 *  of these are supplied, it just skips the signals that depend on
 *  them. */
export interface NarrativeDeps {
  /** Output of `coach.adjustForReality()` for today. Powers Priority 2
   *  (Coach adjusted today) — without it we cannot describe an
   *  adjustment because the relevant signals + reason live there. */
  adjustment?: {
    changed: boolean;
    /** Human reasons populated by adjustForReality. e.g.
     *  ["3 of last 7 check-ins flagged poor"]. */
    adjustedFor: string[];
    /** New workout label, e.g. "Easy 6.0 mi (deferred quality)". */
    newLabel?: string;
    /** Was the adjustment a softening (intensity dropped) or push? */
    direction?: 'softening' | 'pushing';
  };
}

const STREAK_MILESTONES = [30, 60, 90, 180] as const;

/** Public entry point. Walks the priority list top-down; the first
 *  signal that has a real trigger produces the line. Returns null when
 *  nothing fires — that is the expected outcome on a steady runner who
 *  is on plan with no race imminent. */
export async function narrativeLine(
  state: CoachState,
  todayISO: string,
  deps: NarrativeDeps = {},
): Promise<NarrativeLine | null> {
  // ── Priority 1: Race-week imminent (A-race within 7 days) ──────────
  // Drives the "you've banked everything you need" voice — taper-week
  // reorientation, not a push. Cite Research/03 taper doctrine.
  const nextA = state.races.nextA;
  if (nextA && nextA.daysAway >= 0 && nextA.daysAway <= 7) {
    const daysWord = nextA.daysAway === 0
      ? 'today'
      : nextA.daysAway === 1
        ? 'tomorrow'
        : `in ${nextA.daysAway} days`;
    return {
      sentence: nextA.daysAway === 0
        ? `${nextA.name} is today — volume is already low and the work is banked.`
        : `${nextA.name} is ${daysWord}; the taper protects what you've banked, so drop intensity and trust the build.`,
      basedOn: 'race calendar',
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§Tapering — volume reduction in the final 7-14 days',
      },
      tone: 'reorienting',
    };
  }

  // ── Priority 2: Coach adjusted today ───────────────────────────────
  // adjustForReality returned a change. Source the reason from its
  // output so the line cites the same signal the adjustment did.
  if (deps.adjustment && deps.adjustment.changed) {
    const reasons = deps.adjustment.adjustedFor;
    const reasonClause = reasons.length === 0
      ? ''
      : reasons.length === 1
        ? reasons[0]
        : `${reasons.length} recovery signals firing (${reasons[0]})`;
    const direction = deps.adjustment.direction ?? 'softening';
    const action = direction === 'softening' ? 'softened' : 'pushed';
    const sentence = reasonClause
      ? `Coach ${action} today's session — ${reasonClause}.`
      : `Coach ${action} today's session based on recent signals.`;
    return {
      sentence,
      basedOn: 'coach · live adjustment',
      citation: {
        doc: 'Research/00b-recovery-protocols.md',
        section: '§Warning Signs of Incomplete Recovery — Decision Matrix',
      },
      tone: direction,
    };
  }

  // ── Priority 3: Streak milestone ───────────────────────────────────
  // consecutiveRunDays crossed a documented base-building marker. We
  // fire AT the exact day so the celebration lands once, not every
  // subsequent day until it breaks.
  // Streak-break detection requires a historical max we don't store
  // yet (e.g. "first miss in 47 days"). Flagged in the wave report.
  const streak = state.recovery.consecutiveRunDays;
  if ((STREAK_MILESTONES as readonly number[]).includes(streak)) {
    return {
      sentence: `You just crossed ${streak} consecutive run-days — the aerobic base is real now.`,
      basedOn: 'run streak',
      tone: 'celebrating',
    };
  }

  // ── Priority 4: Stale check-in (>72h since last check-in) ──────────
  // The check-in is the only qualitative signal the engine has. When
  // it goes stale the coach is "flying partly blind" — we describe
  // that state, while nextPushes prescribes the action ("log one").
  const checkin = state.checkin;
  if (checkin) {
    const daysStale = (() => {
      if (checkin.loggedToday) return 0;
      if (checkin.latestDateISO == null) return Infinity;
      const t = Date.parse(todayISO + 'T12:00:00Z');
      const l = Date.parse(checkin.latestDateISO + 'T12:00:00Z');
      return Math.max(0, Math.round((t - l) / 86_400_000));
    })();
    if (daysStale >= 4) {
      const noun = checkin.latestDateISO == null
        ? `No check-in on file`
        : `${daysStale} days since your last check-in`;
      return {
        sentence: `${noun} — coach is flying partly blind on energy and recovery.`,
        basedOn: 'check-in log',
        citation: {
          doc: 'Research/00b-recovery-protocols.md',
          section: '§Warning Signs of Incomplete Recovery — Qualitative Signals',
        },
        tone: 'reminding',
      };
    }
  }

  // ── Priority 5: Recent PR / VDOT update ────────────────────────────
  // DEFERRED — requires a `vdot` snapshot (current + previous) on the
  // CoachState. Today vdot lives in lib/vdot.ts and is recomputed at
  // read-time, not persisted on state. Flagged in the wave report for
  // a future state-builder pass to add `state.fitness.vdot` +
  // `state.fitness.vdotPrev` so this signal can fire.

  // ── Priority 6: Mid-build proof (long run ≥ 12mi in last 7 days) ───
  // The runner just put down a meaningful long run. Differentiator
  // vs Priority 9 (stale): here the long run JUST happened. We
  // require the 7-day window so the celebration is current.
  const recentLong = state.volume.last7Days
    .filter((d) => d.miles >= 12)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (recentLong) {
    const daysAgo = (() => {
      const t = Date.parse(todayISO + 'T12:00:00Z');
      const r = Date.parse(recentLong.date + 'T12:00:00Z');
      return Math.max(0, Math.round((t - r) / 86_400_000));
    })();
    const when = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`;
    return {
      sentence: `Your long run hit ${recentLong.miles.toFixed(1)} mi ${when} — the aerobic engine is taking hold.`,
      basedOn: 'recent activity',
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§The Seven Workout Categories — 4. Long run',
      },
      tone: 'pushing',
    };
  }

  // ── Priority 7: Falling behind on a build ──────────────────────────
  // 4-week-vs-prior-4-week volume trending down by ≥15% with an A-race
  // still in the build window. Reorienting voice — name the trajectory.
  const deltaPct = state.volume.deltaPct4v4;
  const hasUpcomingA = nextA != null && nextA.daysAway > 7 && nextA.daysAway <= 16 * 7;
  if (
    deltaPct != null
    && deltaPct <= -0.15
    && hasUpcomingA
  ) {
    const dropPct = Math.round(Math.abs(deltaPct) * 100);
    const weeksOut = Math.round(nextA!.daysAway / 7);
    return {
      sentence: `Volume is down ${dropPct}% over the last 4 weeks with ${nextA!.name} ${weeksOut} weeks out — the trajectory needs a long run this Saturday.`,
      basedOn: 'volume trend · 4w vs prior 4w',
      tone: 'reorienting',
    };
  }

  // ── Priority 8: Stale quality (no T/I work in 14 days) ─────────────
  // Counterpart to nextPushes "add_threshold" — same trigger, different
  // voice. Narrative: "It's been X days…" (state). Push: "Get one
  // session in this week" (action). We only fire when there's an
  // A-race still some way out — no point pushing threshold inside
  // the taper.
  if (
    state.intensity.hardMi14d < 1
    && nextA != null
    && nextA.daysAway > 21
  ) {
    return {
      sentence: `It's been 14+ days since your last threshold session — Tuesday is the day to break that.`,
      basedOn: 'intensity · last 14d',
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§The Seven Workout Categories — 5. Threshold / tempo',
      },
      tone: 'pushing',
    };
  }

  // ── Priority 9: Stale long run (>21 days) ──────────────────────────
  // Mirrors nextPushes' extend-long-run trigger. Same threshold, but
  // narrative voice. The differentiator: we describe WHERE you are
  // ("three weeks since your last long run"); nextPushes describes
  // WHAT TO DO ("extend to 10+mi Saturday"). We only fire if Priority
  // 6 (recent long run) didn't — those two are mutually exclusive by
  // ordering.
  const longRunMi = state.volume.longestLast28Mi;
  const daysSinceLong = (() => {
    if (longRunMi < 10) return 28; // none in 28d
    // Was there a ≥10mi run in the last 7 days?
    const recent7 = state.volume.last7Days
      .filter((d) => d.miles >= 10)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (recent7) {
      const t = Date.parse(todayISO + 'T12:00:00Z');
      const r = Date.parse(recent7.date + 'T12:00:00Z');
      return Math.max(0, Math.round((t - r) / 86_400_000));
    }
    return 14; // somewhere between 7 and 28 — midpoint estimate
  })();
  const inRecoveryWindow = state.recoveryWindowEndsISO != null
    && state.recoveryWindowEndsISO >= todayISO;
  if (
    daysSinceLong > 21
    && !inRecoveryWindow
    && !state.flags.rebuildAfterBreak
    && !state.flags.heavyBlockSuspected
  ) {
    const weeks = Math.round(daysSinceLong / 7);
    return {
      sentence: `${weeks} weeks since your last long run — Saturday eases the aerobic engine back into work.`,
      basedOn: 'recent activity',
      citation: {
        doc: 'Research/00a-distance-running-training.md',
        section: '§The Seven Workout Categories — 4. Long run',
      },
      tone: 'pushing',
    };
  }

  // No signal fired — coach has nothing specific to say today.
  return null;
}
