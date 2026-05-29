'use client';

/**
 * WorkoutBreakdown · the workout structure visualizer.
 * Spec: design/components/WorkoutBreakdown.md
 *
 * v1 ships 4 of the 6 variants (easy · intervals · tempo · long).
 * Hills + progression are post-v1 per the spec — the union types
 * include them so the contract is stable, but the renderer falls
 * through to a placeholder if they appear.
 *
 * The chart itself is a horizontal phase bar — warmup → work → cooldown
 * left-to-right (universal time convention). SVG for crisp scaling.
 */

import type { WorkoutType } from '@/lib/faff/types';
import { BCard } from './BCard';
import styles from './WorkoutBreakdown.module.css';

type EasyData = { type: 'easy'; distance_mi: number; pace_target: { s: number; band: [number, number] }; hr_cap: number | null };
type IntervalsData = {
  type: 'intervals';
  warmup_mi: number;
  reps: number;
  rep_distance_m: number;
  rep_pace_s_per_mi: number;
  rest_jog_s: number;
  cooldown_mi: number;
};
type TempoData = {
  type: 'tempo';
  warmup_mi: number;
  tempo_distance_mi: number;
  tempo_pace_s_per_mi: number;
  cooldown_mi: number;
};
type LongData = {
  type: 'long';
  distance_mi: number;
  pace_band: [number, number];
  fuel_checkpoints_mi: number[];
  mp_segment?: { start_mi: number; end_mi: number; pace_s_per_mi: number };
};
type HillsData = {
  type: 'hills';
  warmup_mi: number;
  reps: number;
  hill_distance_m: number;
  hill_grade_pct: number;
  recovery_s: number;
  cooldown_mi: number;
};
type ProgressionData = {
  type: 'progression';
  total_mi: number;
  start_pace_s_per_mi: number;
  end_pace_s_per_mi: number;
  phase_breakpoints_mi: number[];
};

export type WorkoutData = EasyData | IntervalsData | TempoData | LongData | HillsData | ProgressionData;

export interface WorkoutBreakdownProps {
  data: WorkoutData;
  runnerLthrBpm?: number;
}

export function WorkoutBreakdown({ data, runnerLthrBpm }: WorkoutBreakdownProps) {
  const headerValue = computeHeaderValue(data);

  return (
    <BCard
      header={{
        label: `WORKOUT · ${data.type.toUpperCase()}`,
        value: headerValue,
      }}
      padding="tight"
      footnote={renderFootnote(data, runnerLthrBpm)}
    >
      <div className={styles.chart}>{renderChart(data)}</div>
    </BCard>
  );
}

function computeHeaderValue(data: WorkoutData): string {
  switch (data.type) {
    case 'easy':
      return `${fmtMi(data.distance_mi)} mi · ~${minutesFromPace(data.distance_mi, data.pace_target.s)}`;
    case 'intervals': {
      const totalMi = data.warmup_mi + (data.reps * data.rep_distance_m) / 1609 + data.cooldown_mi;
      return `${fmtMi(totalMi)} mi · ~${Math.round(totalMi * (data.rep_pace_s_per_mi / 60))} min`;
    }
    case 'tempo': {
      const totalMi = data.warmup_mi + data.tempo_distance_mi + data.cooldown_mi;
      return `${fmtMi(totalMi)} mi · ${fmtMi(data.tempo_distance_mi)} mi @ ${fmtPace(data.tempo_pace_s_per_mi)}`;
    }
    case 'long':
      return `${fmtMi(data.distance_mi)} mi · ${fmtPace(data.pace_band[0])}–${fmtPace(data.pace_band[1])}`;
    case 'hills':
    case 'progression':
    default:
      return '—';
  }
}

function renderChart(data: WorkoutData) {
  switch (data.type) {
    case 'easy':
      return <EasyChart data={data} />;
    case 'intervals':
      return <IntervalsChart data={data} />;
    case 'tempo':
      return <TempoChart data={data} />;
    case 'long':
      return <LongChart data={data} />;
    default:
      return (
        <div className={styles.placeholder}>
          {`${data.type} chart variant lands post-v1 per spec`}
        </div>
      );
  }
}

function renderFootnote(data: WorkoutData, runnerLthrBpm?: number): string {
  switch (data.type) {
    case 'easy':
      return `Aerobic dose · pace band ${fmtPace(data.pace_target.band[0])}–${fmtPace(data.pace_target.band[1])}${data.hr_cap != null ? ` · HR cap ${data.hr_cap}` : ''}.`;
    case 'intervals':
      return `${data.reps}×${data.rep_distance_m}m @ ${fmtPace(data.rep_pace_s_per_mi)} · ${data.rest_jog_s}s float recoveries · HR target Z5${runnerLthrBpm ? ` (~${Math.round(runnerLthrBpm * 1.05)}bpm)` : ''}.`;
    case 'tempo':
      return `Threshold work · pace anchor ${fmtPace(data.tempo_pace_s_per_mi)}/mi · HR locks ~Z4.`;
    case 'long':
      return `Long aerobic · steady in band${data.mp_segment ? ` · MP segment mi ${data.mp_segment.start_mi}–${data.mp_segment.end_mi} @ ${fmtPace(data.mp_segment.pace_s_per_mi)}` : ''}.`;
    case 'hills':
    case 'progression':
    default:
      return '';
  }
}

// ──────────────────────────────────────────────────────────────────────
// Chart variants · SVG horizontal phase bars
// ──────────────────────────────────────────────────────────────────────

const CHART_HEIGHT = 96;

function EasyChart({ data }: { data: EasyData }) {
  return (
    <svg
      viewBox={`0 0 100 ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      className={styles.svg}
      aria-hidden
    >
      <rect x="0" y="32" width="100" height="32" rx="4" fill="var(--green)" opacity="0.85" />
      {/* HR cap chip · only rendered when the spec has a value. LTHR isn't
          threaded to plan-builder yet, so most authored rows ship null. */}
      {data.hr_cap != null && (
        <>
          <line x1="0" x2="100" y1="24" y2="24" stroke="var(--goal)" strokeDasharray="2 3" strokeWidth="1" />
          <text x="50" y="20" textAnchor="middle" fontSize="6" fill="var(--goal)" fontFamily="var(--f-body)" fontWeight="700">
            HR cap {data.hr_cap}
          </text>
        </>
      )}
    </svg>
  );
}

function IntervalsChart({ data }: { data: IntervalsData }) {
  // Stepped bars: warmup, [rep, rest] × N, cooldown.
  // Equal-ish widths · just for the visual rhythm. The header carries
  // the actual proportions.
  const slots = 2 + data.reps * 2; // wm + 2*reps + cd
  const slotW = 100 / slots;
  const bars: React.ReactElement[] = [];
  let x = 0;
  // warmup
  bars.push(
    <rect key="wm" x={x} y={60} width={slotW * 0.9} height={20} rx="2" fill="var(--dist)" opacity="0.7" />,
  );
  x += slotW;
  for (let i = 0; i < data.reps; i++) {
    bars.push(
      <rect
        key={`rep-${i}`}
        x={x}
        y={20}
        width={slotW * 0.9}
        height={60}
        rx="2"
        fill="var(--goal)"
        opacity="0.9"
      />,
    );
    x += slotW;
    bars.push(
      <rect
        key={`rest-${i}`}
        x={x}
        y={64}
        width={slotW * 0.9}
        height={12}
        rx="2"
        fill="var(--mute)"
        opacity="0.5"
      />,
    );
    x += slotW;
  }
  bars.push(
    <rect key="cd" x={x} y={60} width={slotW * 0.9} height={20} rx="2" fill="var(--dist)" opacity="0.7" />,
  );

  return (
    <svg viewBox={`0 0 100 ${CHART_HEIGHT}`} preserveAspectRatio="none" className={styles.svg} aria-hidden>
      {bars}
    </svg>
  );
}

function TempoChart({ data }: { data: TempoData }) {
  const total = data.warmup_mi + data.tempo_distance_mi + data.cooldown_mi;
  const wmW = (data.warmup_mi / total) * 100;
  const tempoW = (data.tempo_distance_mi / total) * 100;
  const cdW = (data.cooldown_mi / total) * 100;
  return (
    <svg viewBox={`0 0 100 ${CHART_HEIGHT}`} preserveAspectRatio="none" className={styles.svg} aria-hidden>
      <rect x={0} y={56} width={wmW} height={24} rx="2" fill="var(--dist)" opacity="0.7" />
      <rect x={wmW} y={24} width={tempoW} height={56} rx="2" fill="var(--goal)" opacity="0.9" />
      <rect x={wmW + tempoW} y={56} width={cdW} height={24} rx="2" fill="var(--dist)" opacity="0.7" />
    </svg>
  );
}

function LongChart({ data }: { data: LongData }) {
  const mpStart = data.mp_segment ? (data.mp_segment.start_mi / data.distance_mi) * 100 : 0;
  const mpW = data.mp_segment
    ? ((data.mp_segment.end_mi - data.mp_segment.start_mi) / data.distance_mi) * 100
    : 0;
  return (
    <svg viewBox={`0 0 100 ${CHART_HEIGHT}`} preserveAspectRatio="none" className={styles.svg} aria-hidden>
      <rect x={0} y={40} width={100} height={26} rx="2" fill="var(--dist)" opacity="0.85" />
      {data.mp_segment && (
        <rect x={mpStart} y={40} width={mpW} height={26} rx="2" fill="var(--race)" opacity="0.9" />
      )}
      {data.fuel_checkpoints_mi.map((mi, i) => {
        const x = (mi / data.distance_mi) * 100;
        return <circle key={i} cx={x} cy={68} r={1.6} fill="var(--goal)" />;
      })}
    </svg>
  );
}

function fmtMi(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function fmtPace(secondsPerMi: number): string {
  const m = Math.floor(secondsPerMi / 60);
  const s = Math.round(secondsPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function minutesFromPace(mi: number, sPerMi: number): string {
  const totalSec = mi * sPerMi;
  const totalMin = totalSec / 60;
  return `${Math.round(totalMin)} min`;
}

// Workout-type → chart-variant convenience map · for pages that have the
// WorkoutType but not yet the structured `WorkoutData` (Sprint 02 scaffold
// only uses the union directly; this is reserved for Sprint 05 wiring).
export function chartVariantForWorkoutType(t: WorkoutType): WorkoutData['type'] | null {
  switch (t) {
    case 'easy':
      return 'easy';
    case 'long':
      return 'long';
    case 'quality':
      // ambiguous · the actual variant depends on sub_label · resolved
      // by the page once the workout detail is loaded
      return null;
    default:
      return null;
  }
}
