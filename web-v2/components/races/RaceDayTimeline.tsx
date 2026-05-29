'use client';

/**
 * RaceDayTimeline · the 9 emotional moments from night-before → debrief.
 *
 * Renders for A-races within the T-7 → T+14 window only (race week +
 * post-race debrief tail). Sits directly under the FaffPageShell band on
 * the race detail page, above the existing PhaseAwareBlocks / course /
 * pace-plan body. Outside the window → locked card; outside priority A
 * → renders null (the existing chrome is plenty for B/C races).
 *
 * Design source (visual structure adapted from):
 *   /Volumes/WP/06 Claude Code/Faff/docs/_salvaged-race-day-timeline-2026-05-28.tsx
 * That salvage was the right design but bound to a `SavedRace` data
 * model that doesn't exist in the production app. This rewrite drives
 * the same 9 moments off the real `RaceRow` model from
 * `lib/coach/races-state.ts`.
 *
 * Mirror: /Volumes/WP/06 Claude Code/Faff/apps/web/src/components/races/RaceDayTimeline.tsx
 * (keep both files in sync per the mirror discipline).
 *
 * Gate (double-checked here for direct callers):
 *   · race.priority === 'A'  (B/C races skip the timeline entirely)
 *   · daysUntil ∈ [-14, 7]   (race week through 2-week debrief window)
 *
 * The race-morning moment exposes an "Order Uber" action. Profile has
 * no street_address column yet, so it renders DISABLED with copy
 * "Add venue address" — wired action lands once the profile gains a
 * home_address field.
 */

import { useMemo } from 'react';
import type { RaceRow } from '@/lib/coach/races-state';

export interface RaceDayTimelineProps {
  race: RaceRow;
  /** Days until race day (negative if past). Page derives this; we
   *  accept it as a prop to keep the gate stable across re-renders. */
  daysUntil: number;
}

type MomentId =
  | 'night-before'
  | 'race-morning'
  | 'pre-race'
  | 'start-line'
  | 'first-third'
  | 'halfway'
  | 'final-third'
  | 'finish'
  | 'debrief';

type Moment = {
  id: MomentId;
  /** Time marker shown at the top-right of each card (T-12h, T+0, +14d…). */
  marker: string;
  /** Caps eyebrow above the headline — phase name. */
  eyebrow: string;
  /** Display-recipe headline (e.g. "SLEEP NOW."). */
  headline: string;
  /** Plain-English "what to expect" line. */
  expect: string;
  /** One coach voice line — second-person, brand voice. No hedging. */
  coach: string;
  /** Optional CTA — rendered as a chip at the bottom of the card. */
  action?: { label: string; href?: string; disabled?: boolean; disabledNote?: string };
  /** Which color anchors this card (left strip + marker tint). */
  tone: 'night' | 'race' | 'green' | 'learn';
};

/** Distance fallback from a label like "Half Marathon" / "10K" / "Marathon".
 *  Mirrors the same logic used inside races-state.ts so the timeline can
 *  derive per-mile markers without requiring distance_mi to be set. */
function distanceMiFromRow(race: RaceRow): number {
  if (race.distance_mi && race.distance_mi > 0) return race.distance_mi;
  const label = (race.distance_label ?? '').toLowerCase();
  if (label.includes('marathon') && !label.includes('half')) return 26.2;
  if (label.includes('half') || label.includes('21k')) return 13.1;
  if (label.includes('10k')) return 6.2;
  if (label.includes('5k')) return 3.1;
  return 13.1; // sensible default for the timeline's mile-marker copy
}

/** Predicted finish-time label for the "Finish" moment marker.
 *  RaceRow.goal is a free-text string like "1:35" / "sub-3" / "3:15".
 *  We parse it as h:mm or mm:ss best-effort, otherwise fall through to
 *  a distance-keyed default so the marker never reads "T+null". */
function predictedFinishLabel(race: RaceRow): string {
  const goal = (race.goal ?? '').trim();
  // Match h:mm or h:mm:ss or sub-h:mm
  const m = goal.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (Number.isFinite(h) && Number.isFinite(mm)) {
      return `${h}:${String(mm).padStart(2, '0')}`;
    }
  }
  // Distance-keyed default — what a typical-runner finish looks like.
  const mi = distanceMiFromRow(race);
  if (mi >= 25) return '3:30';
  if (mi >= 13) return '1:45';
  if (mi >= 6)  return '50m';
  return '25m';
}

function buildMoments(race: RaceRow, hasVenueAddress: boolean): Moment[] {
  const distanceMi = distanceMiFromRow(race);
  const finishTime = predictedFinishLabel(race);
  const halfMi      = (distanceMi / 2).toFixed(1);
  const firstThirdMi = (distanceMi / 3).toFixed(1);
  const lastThirdMi  = ((distanceMi * 2) / 3).toFixed(1);

  return [
    {
      id: 'night-before',
      marker: 'T-12h',
      eyebrow: 'Night before',
      headline: 'Sleep now.',
      expect: 'Final checklist sweep. Kit on the floor. Watch charging. Alarm armed.',
      coach: "You've done the work. The race is tomorrow. Lights out.",
      tone: 'night',
    },
    {
      id: 'race-morning',
      marker: 'T-4h',
      eyebrow: 'Race morning · early',
      headline: 'Get to the start.',
      expect: 'Coffee, breakfast 3h before gun, kit on, drop bag packed, ride to the venue.',
      coach: 'Logistics dominant. No new decisions on race day — execute the plan.',
      action: hasVenueAddress
        ? { label: 'Order Uber', href: buildUberDeepLink(race) }
        : {
            label: 'Add venue address',
            disabled: true,
            disabledNote: 'Add a home + venue address to your profile to wire this.',
          },
      tone: 'race',
    },
    {
      id: 'pre-race',
      marker: 'T-30m',
      eyebrow: 'Pre-race · corral',
      headline: 'Calm hands.',
      expect: 'Warmup jog, dynamic mobility, last bathroom, phone in drop bag, into the corral.',
      coach: 'First mile slower than feels right. Discipline opens this race.',
      tone: 'race',
    },
    {
      id: 'start-line',
      marker: 'T+0',
      eyebrow: 'Gun',
      headline: 'Go.',
      expect: "GPS auto-starts the watch. Phone is in the drop bag. It's you and the wrist.",
      coach: "Crowd surge. Don't chase. Settle into goal pace by mile 1.",
      tone: 'race',
    },
    {
      id: 'first-third',
      marker: `Mi 1–${firstThirdMi}`,
      eyebrow: 'First third · settling',
      headline: 'Hold the leash.',
      expect: "Body warming up, breathing rhythmic. Pace can feel easy — that's the trap.",
      coach: 'Run the plan, not the legs. The fast race is run from here.',
      tone: 'green',
    },
    {
      id: 'halfway',
      marker: `Mi ${halfMi}`,
      eyebrow: 'Halfway',
      headline: 'Reset and reload.',
      expect: 'Fueling window. Heart rate locked. Predicted finish is what you executed.',
      coach: 'Halfway done. Now the race actually starts.',
      tone: 'green',
    },
    {
      id: 'final-third',
      marker: `Mi ${lastThirdMi}+`,
      eyebrow: 'Final third · the work',
      headline: 'This is the race.',
      expect: 'Quads loading. Pace defended, not chased. Bumps landing on the wrist.',
      coach: 'Drop the shoulders. Quick feet. One mile at a time to the line.',
      tone: 'race',
    },
    {
      id: 'finish',
      marker: `T+${finishTime}`,
      eyebrow: 'Finish',
      headline: 'Across the line.',
      expect: 'Watch auto-saves. Spectator graph lights up. Photo crew, medal, foil blanket.',
      coach: 'You ran the race we built. Walk it out before the legs lock.',
      tone: 'green',
    },
    {
      id: 'debrief',
      marker: '+14d',
      eyebrow: 'Two weeks later · debrief',
      headline: 'Read the race.',
      expect: 'Strava synced. Per-phase + per-mile actuals against the plan. Calibration delta.',
      coach: 'What the day taught us about the runner you are now — and what we tune next.',
      tone: 'learn',
    },
  ];
}

/** Uber deep-link skeleton. No real coordinates yet — the profile has no
 *  street_address / venue_address. When those fields land, swap the
 *  pickup/dropoff placeholders for lat/lon. Today the disabled state in
 *  the action chip prevents this URL ever being rendered, but the
 *  function is kept so the surface is wired-and-waiting. */
function buildUberDeepLink(race: RaceRow): string {
  const dropoffName = encodeURIComponent(`${race.name} start`);
  return `uber://?action=setPickup&pickup=my_location&dropoff[nickname]=${dropoffName}`;
}

// Tone → accent color. Race accent uses --g-race endpoint (--race);
// the other three reuse existing semantic tokens so the section reads
// as part of the same palette as the rest of the app.
const TONE_COLOR: Record<Moment['tone'], string> = {
  night: '#5B7CB8',           // --zone-1 slate-blue · night arc
  race:  'var(--race)',       // FF8847 race orange
  green: 'var(--green)',      // 3EBD41 done/ready
  learn: 'var(--learn)',      // B084FF insight / debrief
};

export function RaceDayTimeline({ race, daysUntil }: RaceDayTimelineProps) {
  // TODO 2026-05-28: when profile.street_address + race.venue_address
  // land, flip this to derive from the real values and the chip
  // becomes a live Uber deep-link.
  const hasVenueAddress = false;

  // Build moments unconditionally so hooks ordering stays stable. The
  // gate below decides what to render; a 9-element array is cheap.
  const moments = useMemo(() => buildMoments(race, hasVenueAddress), [race, hasVenueAddress]);

  // Gate: A-races only, T-7 forward through T+14 debrief.
  const priority = race.priority ?? 'C';
  if (priority !== 'A') return null;
  if (daysUntil < -14 || daysUntil > 7) {
    return <RaceTimelineLocked daysUntil={daysUntil} />;
  }

  const activeId = activeMomentId(daysUntil);

  return (
    <section
      aria-label="Race-day timeline"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 18,
        padding: '22px 24px',
        marginBottom: 18,
      }}
    >
      <TimelineHeader race={race} daysUntil={daysUntil} />
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
      }}>
        {moments.map((m) => (
          <MomentCard key={m.id} moment={m} isActive={m.id === activeId} />
        ))}
      </div>
    </section>
  );
}

/** Choose which moment is "now" so the runner's eye lands on it first.
 *  Pre-race week (we don't render here, but if called) → night-before.
 *  Race week up through Saturday (T-1) → night-before.
 *  Race day (T+0) → race-morning (the arc begins here).
 *  T+1 (day after) → finish (the most recent moment).
 *  T+2 .. T+14 → debrief (we're in the reflection window). */
function activeMomentId(daysUntil: number): MomentId {
  if (daysUntil > 1)  return 'night-before';
  if (daysUntil === 1) return 'night-before';
  if (daysUntil === 0) return 'race-morning';
  if (daysUntil >= -1) return 'finish';
  return 'debrief';
}

function TimelineHeader({ race, daysUntil }: { race: RaceRow; daysUntil: number }) {
  const label =
    daysUntil > 1 ? `Race week · ${daysUntil} days to go`
    : daysUntil === 1 ? 'Race tomorrow'
    : daysUntil === 0 ? 'Race day · now'
    : daysUntil >= -7 ? `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} ago`
    : 'Debrief window';
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: 16,
      paddingBottom: 12,
      borderBottom: '1px solid var(--line-2)',
    }}>
      <div>
        <div style={{
          fontFamily: 'var(--f-body)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '1.6px',
          textTransform: 'uppercase',
          color: 'var(--race)',
        }}>Race-day timeline · the full arc</div>
        <div style={{
          fontFamily: 'var(--f-display)',
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          lineHeight: 0.95,
          marginTop: 6,
          textTransform: 'uppercase',
          color: 'var(--ink)',
        }}>{race.name}</div>
      </div>
      <div style={{
        fontFamily: 'var(--f-body)',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '1.4px',
        textTransform: 'uppercase',
        color: 'var(--mute)',
        textAlign: 'right',
      }}>{label}</div>
    </div>
  );
}

function MomentCard({ moment, isActive }: { moment: Moment; isActive: boolean }) {
  const accent = TONE_COLOR[moment.tone];
  return (
    <div style={{
      background: 'var(--card-2)',
      border: isActive ? `1.5px solid ${accent}` : '1px solid var(--line)',
      borderLeft: `4px solid ${accent}`,
      borderRadius: 10,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      position: 'relative',
      boxShadow: isActive ? `0 0 0 1px ${accent}33, 0 8px 24px rgba(0,0,0,0.18)` : 'none',
    }}>
      {/* Eyebrow + time marker row */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 8,
      }}>
        <span style={{
          fontFamily: 'var(--f-body)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '1.4px',
          textTransform: 'uppercase',
          color: accent,
        }}>{moment.eyebrow}</span>
        <span className="tabular" style={{
          fontFamily: 'var(--f-body)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.5px',
          color: 'var(--mute)',
        }}>{moment.marker}</span>
      </div>

      {/* Headline — display recipe */}
      <h3 style={{
        fontFamily: 'var(--f-display)',
        fontSize: 26,
        fontWeight: 700,
        letterSpacing: '-0.01em',
        lineHeight: 0.95,
        margin: 0,
        textTransform: 'uppercase',
        color: 'var(--ink)',
      }}>{moment.headline}</h3>

      {/* What-to-expect line */}
      <p style={{
        margin: 0,
        fontSize: 12.5,
        lineHeight: 1.55,
        color: 'rgba(246,247,248,0.78)',
      }}>{moment.expect}</p>

      {/* Coach voice */}
      <p style={{
        margin: 0,
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--ink)',
        fontStyle: 'italic',
        borderLeft: `2px solid ${accent}`,
        paddingLeft: 10,
      }}>{moment.coach}</p>

      {/* Optional action chip */}
      {moment.action && <MomentAction action={moment.action} accent={accent} />}

      {isActive && (
        <span style={{
          position: 'absolute',
          top: 10,
          right: 10,
          fontFamily: 'var(--f-body)',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '1.2px',
          padding: '3px 7px',
          borderRadius: 99,
          background: accent,
          color: '#0e1014',
        }}>NOW</span>
      )}
    </div>
  );
}

function MomentAction({
  action,
  accent,
}: {
  action: NonNullable<Moment['action']>;
  accent: string;
}) {
  if (action.disabled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 99,
          background: 'rgba(255,255,255,0.04)',
          border: '1px dashed var(--line)',
          color: 'var(--mute)',
          fontFamily: 'var(--f-body)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '1.2px',
          textTransform: 'uppercase',
          cursor: 'not-allowed',
          width: 'fit-content',
        }}>{action.label}</span>
        {action.disabledNote && (
          <span style={{
            fontSize: 10.5,
            color: 'var(--mute)',
            lineHeight: 1.4,
          }}>{action.disabledNote}</span>
        )}
      </div>
    );
  }
  // Render as a raw <a> so non-http schemes (uber://) hand off to the OS.
  // Next/Link would refuse the non-http href.
  return (
    <a
      href={action.href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 14px',
        borderRadius: 99,
        background: `${accent}1A`,
        border: `1px solid ${accent}4D`,
        color: accent,
        fontFamily: 'var(--f-body)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '1.2px',
        textTransform: 'uppercase',
        textDecoration: 'none',
        width: 'fit-content',
      }}
    >
      → {action.label}
    </a>
  );
}

function RaceTimelineLocked({ daysUntil }: { daysUntil: number }) {
  return (
    <section style={{
      background: 'var(--card)',
      border: '1px dashed var(--line)',
      borderRadius: 14,
      padding: '24px 26px',
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      marginBottom: 18,
    }}>
      <div style={{
        fontFamily: 'var(--f-body)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '1.6px',
        textTransform: 'uppercase',
        color: 'var(--mute)',
      }}>Race-day timeline</div>
      <div style={{
        fontFamily: 'var(--f-display)',
        fontSize: 22,
        fontWeight: 700,
        letterSpacing: '-0.005em',
        textTransform: 'uppercase',
        color: 'var(--ink)',
        lineHeight: 1.1,
      }}>
        Timeline unlocks 7 days before race day.
      </div>
      <div style={{ fontSize: 12.5, color: 'rgba(246,247,248,0.6)' }}>
        {daysUntil > 7
          ? `Currently ${daysUntil} days out. The night-before → debrief arc reveals itself in race week.`
          : 'Debrief window closed. The race report sits below.'}
      </div>
    </section>
  );
}
