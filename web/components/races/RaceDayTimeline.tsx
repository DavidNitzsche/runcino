'use client';

/**
 * RaceDayTimeline · the 9 emotional moments from night-before → debrief.
 *
 * Renders for A-races within the T-7 window (race week + race day) only.
 * Designed to be the dominant section of the page during race week, sitting
 * directly under the FaffPageShell band, above the existing PosterCard.
 *
 * Design source: docs/race-day-timeline-2026-05-27.html — the full arc
 * deck. Each moment in the deck corresponds to one card here. We render
 * a compact mile-marker style stack (not the deck's full-bleed
 * phone-mockup format — that's a design exploration, not a production
 * UI). The runner gets: time marker · what to expect · single brand-
 * voice coach line · optional action.
 *
 * Why this gate (A-races only, T-7 only):
 *  - For B/C races, the existing page chrome is plenty. The race-day
 *    timeline is the day-of compression of months of training — it
 *    only earns its real estate when there's a real moment incoming.
 *  - Outside T-7, the moments are too abstract to act on. We show a
 *    lock state instead ("Timeline unlocks 7 days before race day.").
 *
 * Data dependencies:
 *  - SavedRace.meta for name + distance + goal + courseSlug
 *  - SavedRace.plan.goal.finish_time_s for predicted finish hour
 *  - daysUntil() for the gate
 *  - Uber address gap is intentional — see the action node on the
 *    `race-morning` step. Disabled chip until profile gains a venue
 *    address field (TODO captured in commit body).
 */

import { useMemo, type ReactNode } from 'react';
import type { SavedRace } from '../../lib/storage-types';

export interface RaceDayTimelineProps {
  race: SavedRace;
  /** Days until race day (negative if past). The page already computes
   *  this via daysUntil(); we pass it in to avoid re-deriving Date math. */
  daysUntil: number;
}

type Moment = {
  id:
    | 'night-before'
    | 'race-morning'
    | 'pre-race'
    | 'start-line'
    | 'first-third'
    | 'halfway'
    | 'final-third'
    | 'finish'
    | 'debrief';
  /** Time marker shown at the top of each card (T-12h, T+0, +14d, …). */
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

/** Build the 9 canonical moments from race metadata. The brand-voice
 *  coach lines come straight from the deck and stay short (verbs,
 *  imperatives, no fluff). */
function buildMoments(race: SavedRace, hasVenueAddress: boolean): Moment[] {
  const finishH = Math.floor(race.plan.goal.finish_time_s / 3600);
  const finishM = Math.floor((race.plan.goal.finish_time_s % 3600) / 60);
  const finishTime = finishH > 0 ? `${finishH}:${String(finishM).padStart(2, '0')}` : `${finishM}m`;
  const halfMi = (race.meta.distanceMi / 2).toFixed(1);
  const firstThirdMi = (race.meta.distanceMi / 3).toFixed(1);
  const lastThirdMi = ((race.meta.distanceMi * 2) / 3).toFixed(1);

  return [
    {
      id: 'night-before',
      marker: 'T-12h',
      eyebrow: 'Night before · Saturday',
      headline: 'Sleep now.',
      expect: 'Final checklist sweep. Kit on the floor. Watch charging. Alarm armed.',
      coach: 'You\'ve done the work. The race is tomorrow. Lights out.',
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
            disabledNote: 'Add a home address + race venue to your profile to wire this.',
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
      expect: 'GPS auto-starts the watch. Phone is in the drop bag. It\'s you and the wrist.',
      coach: 'Crowd surge. Don\'t chase. Settle into goal pace by mile 1.',
      tone: 'race',
    },
    {
      id: 'first-third',
      marker: `Mi 1–${firstThirdMi}`,
      eyebrow: 'First third · settling',
      headline: 'Hold the leash.',
      expect: 'Body warming up, breathing rhythmic. Pace can feel easy — that\'s the trap.',
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

/** Uber deep link (placeholder — no real API key). Per task brief:
 *  "uber://?action=setPickup&..." with home address + venue. Today we
 *  don't have either on the profile, so the action above is disabled.
 *  When we do, the link will resolve to the canonical Uber URL scheme:
 *    uber://?action=setPickup&pickup[latitude]=…&pickup[longitude]=…
 *    &dropoff[latitude]=…&dropoff[longitude]=…&dropoff[nickname]=Race+Start
 *  iOS/Android open the Uber app if installed; otherwise the universal
 *  link `https://m.uber.com/ul/` falls through to the App Store. */
function buildUberDeepLink(race: SavedRace): string {
  // No real coordinates available yet — emit the URL skeleton with the
  // race name pinned as dropoff nickname. The actual pickup/dropoff
  // payload will land when profile gains a home_address field.
  const dropoffName = encodeURIComponent(`${race.meta.name} start`);
  return `uber://?action=setPickup&pickup=my_location&dropoff[nickname]=${dropoffName}`;
}

const TONE_COLOR: Record<Moment['tone'], string> = {
  night: '#5B6CB0',
  race:  'var(--race, #FF5722)',
  green: 'var(--color-success, #3EBD41)',
  learn: 'var(--color-xp, #9013FE)',
};

export function RaceDayTimeline({ race, daysUntil }: RaceDayTimelineProps) {
  // TODO 2026-05-28: profile gains a home address field → flip to true.
  // For now, the Order Uber chip renders disabled with "Add venue address".
  const hasVenueAddress = false;
  // Build moments unconditionally so hooks ordering is stable across
  // renders. The gate below decides whether to render them; the cost of
  // building a 9-element array is trivial.
  const moments = useMemo(() => buildMoments(race, hasVenueAddress), [race, hasVenueAddress]);

  // Gate: A-races only, within T-7 (forward) or T-14 (debrief tail).
  // Page-level callers already check priority + window, but we double-
  // check here so direct imports stay honest.
  const priority = race.meta.priority ?? 'A';
  if (priority !== 'A') return null;
  if (daysUntil < -14 || daysUntil > 7) {
    return <RaceTimelineLocked daysUntil={daysUntil} />;
  }

  // Highlight which moment is "current" so the runner's eye lands there
  // first. Race-week before race-morning = night-before. Race day morning
  // = race-morning. Etc.
  const activeId = activeMomentId(daysUntil);

  return (
    <section className="race-day-timeline" aria-label="Race-day timeline">
      <TimelineHeader race={race} daysUntil={daysUntil} />
      <div className="rdt-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
      }}>
        {moments.map(m => (
          <MomentCard key={m.id} moment={m} isActive={m.id === activeId} />
        ))}
      </div>
    </section>
  );
}

function activeMomentId(daysUntil: number): Moment['id'] {
  if (daysUntil > 1) return 'night-before';        // T-7 .. T-2 → frame the week
  if (daysUntil === 1) return 'night-before';      // Saturday → night-before is "now"
  if (daysUntil === 0) return 'race-morning';      // Sunday morning → start of arc
  if (daysUntil >= -1) return 'finish';            // T+0 day → debrief just behind
  return 'debrief';                                 // post-race window
}

function TimelineHeader({ race, daysUntil }: { race: SavedRace; daysUntil: number }) {
  const label =
    daysUntil > 1 ? `Race week · ${daysUntil} days to go`
    : daysUntil === 1 ? 'Race tomorrow'
    : daysUntil === 0 ? 'Race day · now'
    : daysUntil >= -7 ? `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} ago`
    : 'Debrief window';
  return (
    <div className="rdt-head" style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: 14,
      paddingBottom: 10,
      borderBottom: '1px solid var(--l4)',
    }}>
      <div>
        <div style={{
          fontFamily: 'var(--f-data)',
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '1.8px',
          textTransform: 'uppercase',
          color: 'var(--race)',
        }}>Race-day timeline · the full arc</div>
        <div style={{
          fontFamily: 'var(--f-display)',
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-.01em',
          lineHeight: 1,
          marginTop: 6,
          textTransform: 'uppercase',
          color: 'var(--ink)',
        }}>{race.meta.name}</div>
      </div>
      <div style={{
        fontFamily: 'var(--f-data)',
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
    <div className="rdt-moment" style={{
      background: isActive ? 'var(--l1)' : 'var(--l1)',
      border: isActive ? `1.5px solid ${accent}` : '1px solid var(--l4)',
      borderLeft: `4px solid ${accent}`,
      borderRadius: 10,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      position: 'relative',
      boxShadow: isActive ? `0 0 0 1px ${accent}33, 0 8px 24px rgba(0,0,0,.18)` : 'none',
    }}>
      {/* Marker pill */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 8,
      }}>
        <span style={{
          fontFamily: 'var(--f-data)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '1.4px',
          textTransform: 'uppercase',
          color: accent,
        }}>{moment.eyebrow}</span>
        <span className="tabular" style={{
          fontFamily: 'var(--f-data)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.5px',
          color: 'var(--mute)',
          fontVariantNumeric: 'tabular-nums',
        }}>{moment.marker}</span>
      </div>

      {/* Headline */}
      <h3 style={{
        fontFamily: 'var(--f-display)',
        fontSize: 26,
        fontWeight: 700,
        letterSpacing: '-.01em',
        lineHeight: 1,
        margin: 0,
        textTransform: 'uppercase',
        color: 'var(--ink)',
      }}>{moment.headline}</h3>

      {/* What to expect */}
      <p style={{
        margin: 0,
        fontSize: 12.5,
        lineHeight: 1.55,
        color: 'rgba(245,244,238,0.78)',
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

      {/* Optional action */}
      {moment.action && <MomentAction action={moment.action} accent={accent} />}

      {isActive && (
        <span style={{
          position: 'absolute', top: 10, right: 10,
          fontFamily: 'var(--f-data)',
          fontSize: 9, fontWeight: 700,
          letterSpacing: '1.2px',
          padding: '3px 7px',
          borderRadius: 99,
          background: accent,
          color: '#fff',
        }}>NOW</span>
      )}
    </div>
  );
}

function MomentAction({ action, accent }: { action: NonNullable<Moment['action']>; accent: string }) {
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
          border: '1px dashed var(--l4)',
          color: 'var(--mute)',
          fontFamily: 'var(--f-data)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '1.2px',
          textTransform: 'uppercase',
          cursor: 'not-allowed',
        }}>
          {action.label}
        </span>
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
  // Render as <a> for deep links (uber:// etc.) so the browser hands off.
  // Wrapped via <Link> would error on non-http schemes.
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
        fontFamily: 'var(--f-data)',
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
    <section className="race-day-timeline-locked" style={{
      background: 'var(--l1)',
      border: '1px dashed var(--l4)',
      borderRadius: 14,
      padding: '24px 26px',
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{
        fontFamily: 'var(--f-data)',
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
        letterSpacing: '-.005em',
        textTransform: 'uppercase',
        color: 'var(--ink)',
        lineHeight: 1.1,
      }}>
        Unlocks 7 days before race day.
      </div>
      <div style={{ fontSize: 12.5, color: 'rgba(245,244,238,0.6)' }}>
        {daysUntil > 7
          ? `Currently ${daysUntil} days out. The night-before → debrief arc reveals itself in race week.`
          : 'Debrief window closed. The race report sits below.'}
      </div>
    </section>
  );
}
