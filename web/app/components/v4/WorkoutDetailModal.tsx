'use client';

/**
 * v4 workout detail modal — opens when the runner clicks "Open Workout"
 * on the hero card. Compact version of the hero with the same data:
 * title, four stats, segments table, intensity bar, coach note, and
 * Mark Complete / Skip Today actions.
 */

import { Modal, ModalClose } from './Modal';
import { SegmentsTable, type SegmentRow } from './SegmentsTable';
import { IntensityBar } from './IntensityBar';
import type { HeroStatPills } from './HeroCard';

export interface WorkoutDetailModalProps {
  open: boolean;
  onClose: () => void;
  /** Eyebrow above the title. */
  eyebrow: string;
  /** Workout title — single or two-line. */
  title: string;
  /** Stats row content. */
  stats: HeroStatPills;
  /** Segment breakdown. */
  segments: SegmentRow[];
  /** Intensity bar position + zone + note. */
  intensityPct: number;
  intensityZone: string;
  intensityNote?: string;
  /** Mark Complete handler. */
  onMarkComplete?: () => void;
  /** Skip Today handler. */
  onSkip?: () => void;
}

export function WorkoutDetailModal(props: WorkoutDetailModalProps) {
  const {
    open,
    onClose,
    eyebrow,
    title,
    stats,
    segments,
    intensityPct,
    intensityZone,
    intensityNote,
    onMarkComplete,
    onSkip,
  } = props;

  return (
    <Modal open={open} onClose={onClose} width={520}>
      <div style={{ padding: '40px' }}>
        <ModalClose onClick={onClose} />

        <div
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '11px',
            letterSpacing: '2.5px',
            color: 'rgba(13,15,18,.35)',
            textTransform: 'uppercase',
            marginBottom: '10px',
          }}
        >
          {eyebrow}
        </div>

        <div
          style={{
            fontFamily: 'Bebas Neue, sans-serif',
            fontSize: '88px',
            lineHeight: 0.86,
            color: 'var(--ink, #0D0F12)',
            marginLeft: '-3px',
            marginBottom: '4px',
          }}
        >
          {title.split('\n').map((line, i) => (
            <span key={i}>
              {line}
              {i < title.split('\n').length - 1 && <br />}
            </span>
          ))}
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '24px', marginBottom: '24px' }}>
          <ModalStat value={stats.distanceMi != null ? stats.distanceMi.toFixed(1) : '—'} unit="mi" label="Distance" />
          <ModalStat value={formatPace(stats.paceSecPerMi) ?? '—'} unit="/mi" label="Pace" />
          <ModalStat value={stats.durationMin != null ? `~${stats.durationMin}` : '—'} unit="min" label="Duration" />
          <ModalStat value={stats.hrCapBpm != null ? `≤${stats.hrCapBpm}` : '—'} unit="bpm" label="Heart Rate" />
        </div>

        {segments.length > 0 && <SegmentsTable rows={segments} style={{ marginTop: 0, marginBottom: '24px' }} />}

        <div style={{ marginBottom: '20px' }}>
          <div
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '11px',
              fontWeight: 500,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              color: 'rgba(13,15,18,.35)',
              marginBottom: '10px',
            }}
          >
            Today&rsquo;s Intensity
          </div>
          <IntensityBar effortPct={intensityPct} zoneName={intensityZone} compact />
        </div>

        {intensityNote && (
          <p
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '13px',
              fontStyle: 'italic',
              color: 'rgba(13,15,18,.35)',
              lineHeight: 1.6,
              marginBottom: '32px',
            }}
          >
            {intensityNote}
          </p>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          {onMarkComplete && (
            <button
              type="button"
              onClick={onMarkComplete}
              style={{
                flex: 1,
                background: 'var(--recovery, #2CA82F)',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                padding: '15px 24px',
                fontFamily: 'Inter, sans-serif',
                fontWeight: 600,
                fontSize: '13px',
                letterSpacing: '1px',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              ✓ Mark Complete
            </button>
          )}
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              style={{
                background: 'transparent',
                border: '1.5px solid rgba(13,15,18,.2)',
                color: 'var(--ink, #0D0F12)',
                borderRadius: '10px',
                padding: '15px 24px',
                fontFamily: 'Inter, sans-serif',
                fontWeight: 600,
                fontSize: '13px',
                letterSpacing: '1px',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Skip Today
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ModalStat({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div
      style={{
        flex: 1,
        background: 'rgba(13,15,18,.04)',
        border: '1px solid rgba(13,15,18,.08)',
        borderRadius: '10px',
        padding: '12px 14px',
      }}
    >
      <div style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '28px', lineHeight: 1, color: 'var(--ink, #0D0F12)' }}>
        {value}
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', color: 'rgba(13,15,18,.55)', marginLeft: '2px' }}>{unit}</span>
      </div>
      <div
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: '11px',
          letterSpacing: '1.5px',
          color: 'rgba(13,15,18,.35)',
          textTransform: 'uppercase',
          marginTop: '3px',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function formatPace(secPerMi: number | null): string | null {
  if (secPerMi == null || !isFinite(secPerMi) || secPerMi <= 0) return null;
  const mm = Math.floor(secPerMi / 60);
  const ss = Math.round(secPerMi - mm * 60);
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}
