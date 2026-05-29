/**
 * BodyChips · the 5-chip body-signal strip (BODY / SLEEP / RHR / HRV / LOAD).
 * Paper-overhaul 2026-05-29 (docs/DESIGN_OVERHAUL_2026-05-29.md §5).
 *
 * Instrument-readout tiles: caps label + registration dot (status tone) +
 * big tabular value + faint meta. All deterministic (no LLM). Each chip
 * degrades to "—" / mute dot when the signal is missing.
 */
import { RegistrationDot, SpecLabel, type StatusTone } from '@/components/faff/graphic';

export interface BodyChipsProps {
  readinessBand: 'sharp' | 'ready' | 'moderate' | 'pull-back' | null;
  readinessLabel: string | null;
  readinessScore: number | null;
  sleep7Avg: number | null;
  rhrCurrent: number | null;
  rhrBaseline: number | null;
  hrvCurrent: number | null;
  hrvBaseline: number | null;
  loadAcwr: number | null;
}

interface Chip {
  label: string;
  value: string;
  unit?: string;
  meta: string;
  tone: StatusTone;
}

function sign(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function buildChips(p: BodyChipsProps): Chip[] {
  // BODY — readiness composite.
  const bodyTone: StatusTone =
    p.readinessBand == null ? 'mute'
    : p.readinessBand === 'sharp' || p.readinessBand === 'ready' ? 'green'
    : p.readinessBand === 'moderate' ? 'amber'
    : 'over';
  const body: Chip = {
    label: 'BODY',
    value: p.readinessLabel ?? '—',
    meta: p.readinessScore != null ? `${p.readinessScore}/100` : 'NO DATA',
    tone: bodyTone,
  };

  // SLEEP — 7-day average hours.
  const sleepTone: StatusTone =
    p.sleep7Avg == null ? 'mute' : p.sleep7Avg >= 7 ? 'green' : p.sleep7Avg >= 6 ? 'amber' : 'over';
  const sleep: Chip = {
    label: 'SLEEP',
    value: p.sleep7Avg != null ? p.sleep7Avg.toFixed(1) : '—',
    unit: p.sleep7Avg != null ? 'h' : undefined,
    meta: '7-DAY AVG',
    tone: sleepTone,
  };

  // RHR — lower is better; tone off delta vs baseline.
  const rhrDelta = p.rhrCurrent != null && p.rhrBaseline != null ? p.rhrCurrent - p.rhrBaseline : null;
  const rhrTone: StatusTone =
    p.rhrCurrent == null ? 'mute' : rhrDelta == null ? 'green' : rhrDelta <= 3 ? 'green' : rhrDelta <= 7 ? 'amber' : 'over';
  const rhr: Chip = {
    label: 'RHR',
    value: p.rhrCurrent != null ? `${p.rhrCurrent}` : '—',
    unit: p.rhrCurrent != null ? 'bpm' : undefined,
    meta: rhrDelta != null ? `Δ ${sign(rhrDelta)} vs base` : 'RESTING',
    tone: rhrTone,
  };

  // HRV — higher is better; tone off delta vs baseline.
  const hrvDelta = p.hrvCurrent != null && p.hrvBaseline != null ? p.hrvCurrent - p.hrvBaseline : null;
  const hrvTone: StatusTone =
    p.hrvCurrent == null ? 'mute' : hrvDelta == null ? 'green' : hrvDelta >= 0 ? 'green' : hrvDelta >= -8 ? 'amber' : 'over';
  const hrv: Chip = {
    label: 'HRV',
    value: p.hrvCurrent != null ? `${p.hrvCurrent}` : '—',
    unit: p.hrvCurrent != null ? 'ms' : undefined,
    meta: hrvDelta != null ? `Δ ${sign(hrvDelta)} vs base` : 'VARIABILITY',
    tone: hrvTone,
  };

  // LOAD — ACWR sweet spot 0.8–1.3 (Gabbett).
  const acwr = p.loadAcwr;
  const loadTone: StatusTone =
    acwr == null ? 'mute'
    : acwr >= 0.8 && acwr <= 1.3 ? 'green'
    : acwr >= 1.5 || acwr < 0.7 ? 'over'
    : 'amber';
  const load: Chip = {
    label: 'LOAD',
    value: acwr != null ? acwr.toFixed(2) : '—',
    meta: 'ACWR',
    tone: loadTone,
  };

  return [body, sleep, rhr, hrv, load];
}

export function BodyChips(props: BodyChipsProps) {
  const chips = buildChips(props);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 12,
      }}
      className="body-chips"
    >
      {chips.map((c) => (
        <div
          key={c.label}
          style={{
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-card)',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <SpecLabel>{c.label}</SpecLabel>
            <RegistrationDot tone={c.tone} size={8} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
            <span
              className="tabular"
              style={{
                fontFamily: 'var(--f-display)',
                fontWeight: 700,
                fontSize: c.value.length > 5 ? 20 : 26,
                lineHeight: 0.9,
                letterSpacing: '-0.01em',
                color: 'var(--ink)',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {c.value}
            </span>
            {c.unit && <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 600, color: 'var(--mute)' }}>{c.unit}</span>}
          </div>
          <span style={{ fontFamily: 'var(--f-label)', fontSize: 8.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>
            {c.meta}
          </span>
        </div>
      ))}
    </div>
  );
}
