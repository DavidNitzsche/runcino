'use client';

/**
 * v4 hero card — the centerpiece of /overview.
 *
 *   ┌─────────────────────────────────────┬──────────────────────────┐
 *   │ TODAY · BASE WEEK 3                 │ READINESS  [Ready badge] │
 *   │                                     │                          │
 *   │ EASY                                │      [ readiness ring ]  │
 *   │ RUN  (300px Bebas Neue)             │              88          │
 *   │                                     │                          │
 *   │ [5.5 mi] [9:15/mi] [~52min] [≤145]  │   Building               │
 *   │                                     │                          │
 *   │ ┌─────────────────────┐             │   Effort  +0.25 ▓▓▓░░    │
 *   │ │ Warmup / Main / CD  │             │   Load    1.01  ▓▓░░░    │
 *   │ └─────────────────────┘             │   …                       │
 *   │                                     │                          │
 *   │ [▶ OPEN WORKOUT]  [SKIP TODAY]      │   Today's Intensity      │
 *   │                                     │   [▓▓▓▓░░░░░░░░░░░░░░]   │
 *   │                                     │   Easy · Zone 2          │
 *   └─────────────────────────────────────┴──────────────────────────┘
 *
 * Left column: the workout itself — title + stats + segments + actions.
 * Right column: readiness ring + fitness signals + intensity bar.
 *
 * State: `skipped` fades the hero and flips Skip → Undo Skip.
 *        `complete` greens the title and locks Open Workout.
 */

import type { ReactNode } from 'react';
import { useState } from 'react';
import { StatPill } from './StatPill';
import { SegmentsTable, type SegmentRow } from './SegmentsTable';
import { IntensityBar } from './IntensityBar';
import { ReadinessRing, type ReadinessLevel } from './ReadinessRing';
import { FitnessSignalRow, type FitnessSignal } from './FitnessSignalRow';
import { PrimaryButton, GhostButton } from './Buttons';

export interface HeroStatPills {
  distanceMi: number | null;
  paceSecPerMi: number | null;
  durationMin: number | null;
  hrCapBpm: number | null;
}

export interface HeroCardProps {
  /** Eyebrow above the title (e.g. "TODAY · BASE WEEK 3"). */
  eyebrow: string;
  /** Workout label as one or two lines (e.g. "EASY\nRUN", "THRESHOLD"). */
  title: string;
  /** Four pill values. Any null renders an em-dash. */
  stats: HeroStatPills;
  /** Warmup / main / cooldown rows. Empty array hides the table. */
  segments: SegmentRow[];

  /** Right-column readiness inputs. */
  readinessScore: number | null;
  readinessLevel: ReadinessLevel;
  /** "Ready" / "Watching" / "Recover" badge text. */
  readinessBadge: string;
  /** Caption under the ring ("Building", "Holding", etc). */
  readinessCaption: string;
  /** Five fitness signal bars. */
  signals: FitnessSignal[];
  /** Today's intensity bar position 0..100. */
  intensityPct: number;
  /** Zone name + note. */
  intensityZone: string;
  intensityNote?: string;

  /** Open Workout handler. */
  onOpenWorkout?: () => void;
  /** Skip Today handler — called with the new skipped state. */
  onSkipToggle?: (nextSkipped: boolean) => void;
  /** Externally-controlled "skipped" state — survives a page reload via
   *  the skip-store. When undefined, the card manages it internally. */
  skipped?: boolean;
  /** True when today's planned workout includes strength training.
   *  Renders a small chip near the eyebrow so the runner sees it
   *  without scanning the calendar. */
  hasStrength?: boolean;
}

export function HeroCard(props: HeroCardProps) {
  const {
    eyebrow,
    title,
    stats,
    segments,
    readinessScore,
    readinessLevel,
    readinessBadge,
    readinessCaption,
    signals,
    intensityPct,
    intensityZone,
    intensityNote,
    onOpenWorkout,
    onSkipToggle,
    skipped: skippedProp,
    hasStrength,
  } = props;

  const [skippedLocal, setSkippedLocal] = useState(false);
  const skipped = skippedProp ?? skippedLocal;
  const toggleSkip = () => {
    const next = !skipped;
    if (skippedProp === undefined) setSkippedLocal(next);
    onSkipToggle?.(next);
  };

  return (
    <div
      style={{
        background: 'var(--surface, #FFFFFF)',
        borderRadius: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04)',
        display: 'grid',
        gridTemplateColumns: '1fr 460px',
        marginTop: '16px',
        overflow: 'hidden',
      }}
    >
      {/* LEFT COLUMN */}
      <div
        style={{
          padding: '40px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '20px',
          }}
        >
          <span
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '12px',
              letterSpacing: '2.5px',
              color: 'rgba(13,15,18,.35)',
              textTransform: 'uppercase',
            }}
          >
            {eyebrow}
          </span>
          {hasStrength && (
            <span
              title="Strength training scheduled after the run"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: 'rgba(212,144,10,.12)',
                color: 'var(--milestone, #D4900A)',
                fontFamily: 'Inter, sans-serif',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                padding: '3px 10px',
                borderRadius: '20px',
              }}
            >
              💪 Strength after
            </span>
          )}
        </div>

        <h1
          style={{
            fontFamily: 'Bebas Neue, sans-serif',
            fontSize: '300px',
            lineHeight: 0.86,
            letterSpacing: '-4px',
            color: 'var(--ink, #0D0F12)',
            flex: '0 0 auto',
            marginLeft: '-6px',
            opacity: skipped ? 0.25 : 1,
            transition: 'opacity .3s',
          }}
        >
          {renderMultilineTitle(title)}
        </h1>

        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: '10px',
            marginTop: '4px',
            flexWrap: 'wrap',
            opacity: skipped ? 0.25 : 1,
            transition: 'opacity .3s',
          }}
        >
          <StatPill value={stats.distanceMi != null ? stats.distanceMi.toFixed(1) : null} unit="mi" label="Distance" />
          <StatPill value={formatPace(stats.paceSecPerMi)} unit="/mi" label="Pace" />
          <StatPill value={stats.durationMin != null ? `~${stats.durationMin}` : null} unit="min" label="Duration" />
          <StatPill value={stats.hrCapBpm != null ? `≤${stats.hrCapBpm}` : null} unit="bpm" label="Heart Rate" />
        </div>

        {segments.length > 0 && (
          <div style={{ opacity: skipped ? 0.25 : 1, transition: 'opacity .3s' }}>
            <SegmentsTable rows={segments} />
          </div>
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: '12px',
            marginTop: '24px',
          }}
        >
          {onOpenWorkout && (
            <PrimaryButton
              onClick={onOpenWorkout}
              disabled={skipped}
              style={{ opacity: skipped ? 0.3 : 1, pointerEvents: skipped ? 'none' : 'auto' }}
            >
              ▶&nbsp;&nbsp;Open Workout
            </PrimaryButton>
          )}
          <GhostButton
            onClick={toggleSkip}
            style={
              skipped
                ? { borderColor: 'var(--milestone, #D4900A)', color: 'var(--milestone, #D4900A)' }
                : undefined
            }
          >
            {skipped ? '↩ Undo Skip' : 'Skip Today'}
          </GhostButton>
        </div>
      </div>

      {/* RIGHT COLUMN */}
      <div
        style={{
          background: 'rgba(13,15,18,.02)',
          padding: '40px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '16px',
            }}
          >
            <span
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '12px',
                fontWeight: 500,
                letterSpacing: '1.5px',
                color: 'rgba(13,15,18,.35)',
                textTransform: 'uppercase',
              }}
            >
              Readiness
            </span>
            <ReadyBadge level={readinessLevel}>{readinessBadge}</ReadyBadge>
          </div>

          <ReadinessRing score={readinessScore} level={readinessLevel} caption={readinessCaption} />
        </div>

        <FitnessSignalRow signals={signals} style={{ marginTop: 24 }} />

        <div style={{ marginTop: 0 }}>
          <div
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '12px',
              fontWeight: 500,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              color: 'rgba(13,15,18,.35)',
              marginBottom: '14px',
            }}
          >
            Today&rsquo;s Intensity
          </div>
          <IntensityBar effortPct={intensityPct} zoneName={intensityZone} note={intensityNote} />
        </div>
      </div>
    </div>
  );
}

function ReadyBadge({ level, children }: { level: ReadinessLevel; children: ReactNode }) {
  const color =
    level === 'green'  ? 'var(--recovery, #2CA82F)' :
    level === 'yellow' ? 'var(--milestone, #D4900A)' :
                         'var(--warn, #F43F5E)';
  const wash =
    level === 'green'  ? 'rgba(44,168,47,.12)' :
    level === 'yellow' ? 'rgba(212,144,10,.12)' :
                         'rgba(244,63,94,.12)';
  return (
    <span
      style={{
        background: wash,
        color,
        fontFamily: 'Inter, sans-serif',
        fontWeight: 600,
        fontSize: '11px',
        letterSpacing: '1.5px',
        padding: '4px 12px',
        borderRadius: '20px',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </span>
  );
}

function renderMultilineTitle(title: string): ReactNode {
  const lines = title.split('\n');
  return lines.map((line, i) => (
    <span key={i}>
      {line}
      {i < lines.length - 1 && <br />}
    </span>
  ));
}

function formatPace(secPerMi: number | null): string | null {
  if (secPerMi == null || !isFinite(secPerMi) || secPerMi <= 0) return null;
  const mm = Math.floor(secPerMi / 60);
  const ss = Math.round(secPerMi - mm * 60);
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}
