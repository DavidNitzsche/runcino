'use client';

/**
 * PathToRaceCard · Wave G-2
 *
 * The "PATH TO RACE" hero card. Surfaces, for the runner's next A-race:
 *   - Race name + date + distance + days-to-race
 *   - Current fitness (VDOT-derived predicted time using the freshest
 *     race signal in CoachState)
 *   - Goal time (passed in from the race's goalFinishS or personal_goals)
 *   - Gap (s/mi) and feasibility verdict
 *   - One-line "next move" from the coach
 *
 * All numbers come from `coach.pathToRace()` — no synthesized
 * fallbacks. When there's no A race or no VDOT-eligible recent race,
 * the card renders an honest empty state with a CTA.
 *
 * Integration into /overview/page.tsx happens in a follow-up after
 * Wave F lands. This file does not import from data.ts.
 */

import Link from 'next/link';
import { Card, CardHeader, CardLabel, CardPin, CardFoot } from '@/app/components';
import type { CoachDecision } from '@/coach/types';
import type { PathToRaceResult } from '@/coach/coach';

export interface PathToRaceCardProps {
  /** The decision from `coach.pathToRace()`. null = no A race set
   *  or no goal time → render the empty-state CTA. */
  decision: CoachDecision<PathToRaceResult> | null;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const FEASIBILITY_PIN: Record<
  PathToRaceResult['feasibility'],
  { label: string; variant: 'green' | 'amber' | 'warn' | 'muted' }
> = {
  ahead: { label: 'AHEAD OF GOAL', variant: 'green' },
  on_track: { label: 'ON TRACK', variant: 'green' },
  tight: { label: 'TIGHT', variant: 'amber' },
  behind: { label: 'BEHIND', variant: 'warn' },
  unknown: { label: 'AWAITING DATA', variant: 'muted' },
};

function formatPace(sPerMi: number): string {
  if (!isFinite(sPerMi) || sPerMi <= 0) return '—';
  const mm = Math.floor(sPerMi / 60);
  const ss = Math.round(sPerMi - mm * 60);
  return `${mm}:${ss.toString().padStart(2, '0')}/mi`;
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()];
  return `${mon} ${d.getUTCDate()}`;
}

function formatDistance(mi: number): string {
  if (Math.abs(mi - 13.1) < 0.3) return 'HALF MARATHON';
  if (Math.abs(mi - 26.2) < 0.5) return 'MARATHON';
  if (Math.abs(mi - 6.2) < 0.3) return '10K';
  if (Math.abs(mi - 3.1) < 0.2) return '5K';
  return `${mi.toFixed(1)}MI`;
}

// ─────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────

function EmptyPathCard() {
  return (
    <Card wash="race" span={6} padding="24px 26px">
      <CardHeader>
        <CardLabel color="var(--race)">PATH TO RACE</CardLabel>
        <CardPin variant="muted">NO A-RACE</CardPin>
      </CardHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
        <p
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 22,
            fontWeight: 600,
            lineHeight: 1.25,
            color: 'var(--t1)',
            margin: 0,
          }}
        >
          Add an A-race goal and the coach starts pointing every workout
          at it.
        </p>
        <p
          style={{
            fontFamily: 'var(--f-body)',
            fontSize: 14,
            color: 'var(--t2)',
            margin: 0,
            maxWidth: 520,
          }}
        >
          The PATH card surfaces your current VDOT-anchored fitness, the
          gap to your goal pace, and the number of weeks of typical
          progression it takes to close.
        </p>
        <div style={{ marginTop: 8 }}>
          <Link
            href="/profile"
            style={{
              display: 'inline-block',
              padding: '10px 18px',
              background: 'var(--race)',
              color: '#fff',
              fontFamily: 'var(--f-data)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '1.4px',
              textTransform: 'uppercase',
              borderRadius: 8,
              textDecoration: 'none',
            }}
          >
            Add your race goal →
          </Link>
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main card
// ─────────────────────────────────────────────────────────────────────

export function PathToRaceCard({ decision }: PathToRaceCardProps) {
  if (!decision) return <EmptyPathCard />;

  const r = decision.answer;
  const pin = FEASIBILITY_PIN[r.feasibility];
  const fitness = r.currentFitness;

  return (
    <Card wash="race" span={6} padding="24px 26px">
      <CardHeader>
        <CardLabel color="var(--race)">PATH TO RACE</CardLabel>
        <CardPin variant={pin.variant}>{pin.label}</CardPin>
      </CardHeader>

      {/* Race header strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          flexWrap: 'wrap',
          marginTop: 14,
          marginBottom: 18,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 30,
            fontWeight: 700,
            lineHeight: 1,
            color: 'var(--t1)',
            letterSpacing: '-0.5px',
          }}
        >
          {r.raceName}
        </span>
        <span
          style={{
            fontFamily: 'var(--f-data)',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--race)',
            letterSpacing: '1.4px',
            textTransform: 'uppercase',
          }}
        >
          {formatDateLabel(r.raceDateISO)} · {r.daysToRace}d · {formatDistance(r.raceDistanceMi)}
        </span>
      </div>

      {/* Three-column tile row: fitness / goal / gap */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 16,
          marginBottom: 18,
        }}
      >
        {/* Current fitness */}
        <div
          style={{
            padding: 16,
            background: 'rgba(244,246,248,.04)',
            border: '1px solid var(--l4)',
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 9,
              fontWeight: 700,
              color: 'var(--t2)',
              letterSpacing: '1.6px',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Current Fitness
          </div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 26,
              fontWeight: 700,
              color: 'var(--t1)',
              lineHeight: 1,
              letterSpacing: '-0.5px',
            }}
          >
            {fitness?.predictedDisplay ?? '—'}
          </div>
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--t2)',
              letterSpacing: '0.5px',
              marginTop: 4,
            }}
          >
            {fitness
              ? `VDOT ${fitness.vdot.toFixed(1)} · ${formatPace(fitness.predictedPaceSPerMi)}`
              : 'No VDOT-eligible race yet'}
          </div>
        </div>

        {/* Goal */}
        <div
          style={{
            padding: 16,
            background: 'rgba(255,87,34,.06)',
            border: '1px solid rgba(255,87,34,.20)',
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 9,
              fontWeight: 700,
              color: 'var(--race)',
              letterSpacing: '1.6px',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Goal
          </div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 26,
              fontWeight: 700,
              color: 'var(--t1)',
              lineHeight: 1,
              letterSpacing: '-0.5px',
            }}
          >
            {r.goalDisplay}
          </div>
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--t2)',
              letterSpacing: '0.5px',
              marginTop: 4,
            }}
          >
            {formatPace(r.goalPaceSPerMi)}
          </div>
        </div>

        {/* Gap + weeks needed */}
        <div
          style={{
            padding: 16,
            background: 'rgba(244,246,248,.04)',
            border: '1px solid var(--l4)',
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 9,
              fontWeight: 700,
              color: 'var(--t2)',
              letterSpacing: '1.6px',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Gap
          </div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 26,
              fontWeight: 700,
              color: r.feasibility === 'behind' || r.feasibility === 'tight'
                ? '#FC4D64'
                : r.feasibility === 'ahead' || r.feasibility === 'on_track'
                ? '#7CD97F'
                : 'var(--t2)',
              lineHeight: 1,
              letterSpacing: '-0.5px',
            }}
          >
            {r.gapDisplay ?? '—'}
          </div>
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--t2)',
              letterSpacing: '0.5px',
              marginTop: 4,
            }}
          >
            {r.weeksNeeded != null
              ? `${r.weeksNeeded}wk needed · ${r.weeksAvailable}wk available`
              : 'awaiting fitness signal'}
          </div>
        </div>
      </div>

      {/* The coach's one-line "next move". This is the headline take-
          away the runner needs to act on this week. */}
      <div
        style={{
          padding: '14px 18px',
          background: 'rgba(39,180,224,.08)',
          border: '1px solid rgba(39,180,224,.24)',
          borderRadius: 10,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--f-data)',
            fontSize: 9,
            fontWeight: 700,
            color: '#27B4E0',
            letterSpacing: '1.6px',
            textTransform: 'uppercase',
            marginBottom: 6,
          }}
        >
          Next Move
        </div>
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--f-body)',
            fontSize: 14,
            lineHeight: 1.45,
            color: 'var(--t1)',
          }}
        >
          {r.nextMove}
        </p>
      </div>

      <CardFoot
        left={`${r.weeksAvailable}wk to race day`}
        right={fitness ? `Fitness anchor: ${fitness.sourceName} · ${fitness.sourceDaysAgo}d ago` : 'Log a recent race to anchor'}
      />
    </Card>
  );
}
