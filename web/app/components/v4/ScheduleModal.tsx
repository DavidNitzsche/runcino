'use client';

/**
 * v4 schedule modal — the "View Full Schedule →" popup from the week
 * card. Phase-grouped list of every week in the active plan, with the
 * current week highlighted.
 *
 *   Race meta: "Americas Finest City Half · Aug 17, 2026"
 *   Title:     "Full Schedule"
 *
 *   ── BASE PHASE ──
 *   Week 1 · Apr 28 · 28mi · Easy · Tempo 5mi · …    ✓ Done
 *   Week 2 · May 5  · 33mi · …                       ✓ Done
 *   Week 3 · May 12 · 38mi · … (current)             In Progress
 *   …
 *
 *   ── BUILD PHASE ──
 *   …
 */

import type { ReactNode } from 'react';
import { Modal, ModalClose } from './Modal';

export type ScheduleWeekStatus = 'done' | 'current' | 'upcoming';

export interface ScheduleWeek {
  weekNum: number;
  dateLabel: string;       // "Apr 28"
  miles: number;
  description: string;     // "Easy · Tempo 5mi · Easy · Long 8mi · Strides"
  status: ScheduleWeekStatus;
}

export interface SchedulePhase {
  /** Phase title (e.g. "Base Phase"). */
  label: string;
  weeks: ScheduleWeek[];
}

export interface ScheduleModalProps {
  open: boolean;
  onClose: () => void;
  /** Race meta line (e.g. "Americas Finest City Half · Aug 17, 2026"). */
  raceMeta: string;
  /** Phases in order, BASE → BUILD → PEAK → TAPER. */
  phases: SchedulePhase[];
}

export function ScheduleModal({ open, onClose, raceMeta, phases }: ScheduleModalProps) {
  return (
    <Modal open={open} onClose={onClose} width={860}>
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
          {raceMeta}
        </div>

        <div
          style={{
            fontFamily: 'Bebas Neue, sans-serif',
            fontSize: '52px',
            lineHeight: 1,
            color: 'var(--ink, #0D0F12)',
            marginTop: '8px',
            marginBottom: '28px',
          }}
        >
          Full Schedule
        </div>

        {phases.map((phase, pIdx) => (
          <section key={`${phase.label}-${pIdx}`}>
            <div
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '2.5px',
                textTransform: 'uppercase',
                color: 'rgba(13,15,18,.35)',
                padding: '8px 0 6px',
                borderBottom: '1px solid rgba(13,15,18,.07)',
                marginBottom: '4px',
                marginTop: pIdx === 0 ? 0 : '24px',
              }}
            >
              {phase.label}
            </div>

            {phase.weeks.map((w) => (
              <WeekRow key={`${phase.label}-${w.weekNum}`} week={w} />
            ))}
          </section>
        ))}

        {phases.length === 0 && (
          <div
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '14px',
              color: 'rgba(13,15,18,.35)',
              padding: '40px 0',
              textAlign: 'center',
            }}
          >
            No plan active yet. Set an A-race goal in /profile to author one.
          </div>
        )}
      </div>
    </Modal>
  );
}

function WeekRow({ week }: { week: ScheduleWeek }) {
  const isCurrent = week.status === 'current';
  const bg = isCurrent ? 'rgba(44,168,47,.06)' : 'transparent';
  const border = isCurrent ? '1px solid rgba(44,168,47,.14)' : '1px solid transparent';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '72px 72px 64px 1fr 80px',
        alignItems: 'center',
        padding: '11px 14px',
        borderRadius: '10px',
        gap: '8px',
        background: bg,
        border,
      }}
    >
      <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--ink, #0D0F12)' }}>
        Week {week.weekNum}
      </span>
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', color: 'rgba(13,15,18,.35)' }}>
        {week.dateLabel}
      </span>
      <span style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '22px', color: 'var(--ink, #0D0F12)', lineHeight: 1 }}>
        {Math.round(week.miles)}
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '11px', color: 'rgba(13,15,18,.35)', marginLeft: 3 }}>mi</span>
      </span>
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', color: 'rgba(13,15,18,.55)' }}>
        {week.description}
      </span>
      <StatusCell status={week.status} />
    </div>
  );
}

function StatusCell({ status }: { status: ScheduleWeekStatus }) {
  let color = 'rgba(13,15,18,.35)';
  let weight = 400;
  let label: ReactNode = 'Upcoming';
  if (status === 'done') {
    color = 'var(--recovery, #2CA82F)';
    weight = 600;
    label = '✓ Done';
  } else if (status === 'current') {
    color = 'var(--milestone, #D4900A)';
    weight = 600;
    label = 'In Progress';
  }
  return (
    <span
      style={{
        fontFamily: 'Inter, sans-serif',
        fontSize: '12px',
        textAlign: 'right',
        color,
        fontWeight: weight,
      }}
    >
      {label}
    </span>
  );
}
