'use client';

/**
 * BodyFlags · the entry chip pair (and recovery row) under the Sibling
 * MiniTileGrid on /today.
 *
 * Spec: docs/2026-05-28-niggle-sick-logging.html
 *   §SECTION 01 · entry chips (LOG A NIGGLE · FEELING SICK)
 *   §SECTION 06 · niggle recovery row (BETTER · SAME · WORSE · GONE)
 *   §SECTION 07 · sick recovery (3-gate card → READY TO RUN)
 *
 * Three modes:
 *   1. neutral · no active flag → render the two entry chips (open modals)
 *   2. niggle  · active niggle  → BETTER/SAME/WORSE/GONE recovery row +
 *                                  physio cue after 7 days
 *   3. sick    · active sick    → 3-gate card; when all three clear,
 *                                  surface "READY TO RUN?" CTA
 *
 * The component is the renderer; the heavy work (resolveDayState +
 * activeNiggle / activeSick) is already on the page.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { NiggleModal } from './NiggleModal';
import { SickModal } from './SickModal';

type ActiveNiggle = {
  id: number;
  body_part: string;
  severity: number;
  side: 'left' | 'right' | 'both' | null;
  status: 'just_started' | 'few_days' | 'weeks';
  logged_at: string;
  days_active: number;
};

type ActiveSick = {
  id: number;
  symptoms: string[];
  has_fever: boolean;
  started: 'today' | 'yesterday' | 'few_days' | 'week_plus';
  logged_at: string;
  days_active: number;
};

export interface BodyFlagsProps {
  activeNiggle: ActiveNiggle | null;
  activeSick: ActiveSick | null;
  /** From glance state · sleep7Avg + rhrCurrent + rhrBaseline drive the gates. */
  sleep7Avg: number | null;
  rhrCurrent: number | null;
  rhrBaseline: number | null;
}

export function BodyFlags({
  activeNiggle,
  activeSick,
  sleep7Avg,
  rhrCurrent,
  rhrBaseline,
}: BodyFlagsProps) {
  const [showNiggleModal, setShowNiggleModal] = useState(false);
  const [showSickModal, setShowSickModal] = useState(false);

  // Sick mode owns the slot when active (plan is paused — no niggle row).
  if (activeSick) {
    return (
      <>
        <SickRecovery sick={activeSick} sleep7Avg={sleep7Avg} rhrCurrent={rhrCurrent} rhrBaseline={rhrBaseline} />
        {showSickModal && <SickModal onClose={() => setShowSickModal(false)} />}
      </>
    );
  }

  // Niggle active · render recovery row.
  if (activeNiggle) {
    return (
      <>
        <NiggleRecovery niggle={activeNiggle} />
        {showNiggleModal && <NiggleModal onClose={() => setShowNiggleModal(false)} />}
      </>
    );
  }

  // Neutral · entry chip pair.
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <EntryChip
          label="LOG A NIGGLE"
          dot="amber"
          onClick={() => setShowNiggleModal(true)}
        />
        <EntryChip
          label="FEELING SICK"
          dot="rest"
          onClick={() => setShowSickModal(true)}
        />
      </div>
      {showNiggleModal && <NiggleModal onClose={() => setShowNiggleModal(false)} />}
      {showSickModal && <SickModal onClose={() => setShowSickModal(false)} />}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// EntryChip · the neutral pill (LOG A NIGGLE / FEELING SICK)
// ──────────────────────────────────────────────────────────────────────

function EntryChip({
  label,
  dot,
  onClick,
}: {
  label: string;
  dot: 'amber' | 'rest';
  onClick: () => void;
}) {
  const dotBg = dot === 'amber' ? 'var(--goal)' : '#008FEC';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        background: 'var(--card-2)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: '11px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'var(--f-body, Inter, sans-serif)',
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: 0.4,
        color: 'var(--mute)',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: dotBg,
          flexShrink: 0,
        }}
        aria-hidden
      />
      {label}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────
// NiggleRecovery · BETTER · SAME · WORSE · GONE
// ──────────────────────────────────────────────────────────────────────

function NiggleRecovery({ niggle }: { niggle: ActiveNiggle }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function record(trend: 'better' | 'same' | 'worse' | 'gone') {
    setSubmitting(trend);
    setError(null);
    try {
      const res = await fetch('/api/niggle/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ today: trend }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `recovery failed (${res.status})`);
      }
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSubmitting(null);
    }
  }

  const physioWarn = niggle.days_active >= 7;

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: 'var(--mute)',
          marginBottom: 8,
        }}
      >
        HOW IS IT TODAY?
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        <RecoveryChip
          label="BETTER"
          variant="green"
          onClick={() => record('better')}
          loading={submitting === 'better'}
        />
        <RecoveryChip
          label="SAME"
          variant="muted"
          onClick={() => record('same')}
          loading={submitting === 'same'}
        />
        <RecoveryChip
          label="WORSE"
          variant="amber"
          onClick={() => record('worse')}
          loading={submitting === 'worse'}
        />
        <RecoveryChip
          label="GONE"
          variant="muted"
          onClick={() => record('gone')}
          loading={submitting === 'gone'}
        />
      </div>
      {physioWarn && (
        <div
          style={{
            marginTop: 10,
            background: 'rgba(252,77,100,0.08)',
            border: '1px solid rgba(252,77,100,0.32)',
            borderRadius: 12,
            padding: '10px 12px',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-display, Oswald, sans-serif)',
              fontWeight: 700,
              letterSpacing: '-0.015em',
              fontSize: 16,
              color: 'var(--over)',
              marginBottom: 4,
            }}
          >
            Consider seeing a physio.
          </div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, lineHeight: 1.45, color: 'var(--mute)' }}>
            Day {niggle.days_active + 1}. Past day 7 is where coach guidance ends and clinical input begins.
          </div>
          <div
            style={{
              fontFamily: 'var(--f-body)',
              fontSize: 9,
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: 'var(--mute)',
              marginTop: 6,
            }}
          >
            Cite · research/methodology/05-injury-return-protocols.md · §1.6
          </div>
        </div>
      )}
      {error && (
        <div style={{ color: 'var(--over)', fontSize: 11, marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function RecoveryChip({
  label,
  variant,
  onClick,
  loading,
}: {
  label: string;
  variant: 'green' | 'amber' | 'red' | 'muted';
  onClick: () => void;
  loading: boolean;
}) {
  const palette: Record<typeof variant, { color: string; border: string; bg: string }> = {
    green: { color: 'var(--green)', border: 'rgba(62,189,65,0.35)', bg: 'rgba(62,189,65,0.08)' },
    amber: { color: 'var(--goal)', border: 'rgba(243,173,56,0.35)', bg: 'rgba(243,173,56,0.08)' },
    red: { color: 'var(--over)', border: 'rgba(252,77,100,0.35)', bg: 'rgba(252,77,100,0.08)' },
    muted: { color: 'var(--mute)', border: 'var(--line)', bg: 'var(--card-2)' },
  };
  const p = palette[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      style={{
        background: p.bg,
        border: `1px solid ${p.border}`,
        color: p.color,
        borderRadius: 10,
        padding: '11px 4px',
        fontFamily: 'var(--f-body, Inter, sans-serif)',
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: 0.4,
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SickRecovery · 3-gate card + (when all clear) READY TO RUN CTA
// ──────────────────────────────────────────────────────────────────────

const SLEEP_TARGET_HOURS = 7; // agent default per task Q5; runner profile target wires next phase

function SickRecovery({
  sick,
  sleep7Avg,
  rhrCurrent,
  rhrBaseline,
}: {
  sick: ActiveSick;
  sleep7Avg: number | null;
  rhrCurrent: number | null;
  rhrBaseline: number | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Gate 1 · fever-free for 24h. Best-effort heuristic: if has_fever is
  // still flagged, fever gate is open. (A future round adds a daily
  // fever-recheck check-in; for now, fever clears only when the runner
  // marks recovered or DELETEs.)
  const feverFree = !sick.has_fever;

  // Gate 2 · sleep > target last night. We only have the 7d avg here,
  // not last-night specifically — use avg as best signal available.
  const sleepClear = sleep7Avg != null && sleep7Avg >= SLEEP_TARGET_HOURS;

  // Gate 3 · RHR within +5 of baseline.
  const rhrClear =
    rhrCurrent != null && rhrBaseline != null && rhrCurrent - rhrBaseline <= 5;

  const gates = [
    { label: 'Fever-free for 24h', met: feverFree, tail: feverFree ? 'CLEAR' : 'fever on' },
    { label: `Slept ≥ ${SLEEP_TARGET_HOURS}h last night`, met: sleepClear, tail: sleep7Avg != null ? `${sleep7Avg.toFixed(1)}h` : '—' },
    {
      label: 'RHR within 5 bpm of baseline',
      met: rhrClear,
      tail:
        rhrCurrent != null && rhrBaseline != null
          ? `${rhrCurrent - rhrBaseline >= 0 ? '+' : ''}${rhrCurrent - rhrBaseline} bpm`
          : '—',
    },
  ];
  const metCount = gates.filter((g) => g.met).length;
  const allClear = metCount === 3;

  async function runToday() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/sick/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ today: 'recovered' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `recovery failed (${res.status})`);
      }
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setSubmitting(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: 'var(--mute)',
          marginBottom: 8,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>RETURN GATE · ALL 3 NEEDED</span>
        <span style={{ color: allClear ? 'var(--green)' : 'var(--mute)' }}>
          {metCount}/3
        </span>
      </div>
      <div
        style={{
          background: 'var(--card-2)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {gates.map((g, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '20px 1fr auto',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: g.met ? 'var(--green)' : 'var(--line-2)',
                border: g.met ? 'none' : '1px solid var(--line)',
                color: '#0a0c10',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              {g.met ? '✓' : ''}
            </div>
            <div
              style={{
                fontFamily: 'var(--f-body)',
                fontSize: 12,
                color: g.met ? 'var(--ink)' : 'var(--dim)',
              }}
            >
              {g.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--f-body)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.4,
                color: g.met ? 'var(--green)' : 'var(--mute)',
                textTransform: 'uppercase',
              }}
            >
              {g.tail}
            </div>
          </div>
        ))}
      </div>

      {allClear ? (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              fontFamily: 'var(--f-display, Oswald, sans-serif)',
              fontWeight: 700,
              letterSpacing: '-0.015em',
              fontSize: 22,
              color: 'var(--ink)',
              marginBottom: 4,
            }}
          >
            Ready to run?
          </div>
          <div
            style={{
              fontFamily: 'var(--f-body)',
              fontSize: 12,
              color: 'var(--mute)',
              marginBottom: 10,
              lineHeight: 1.5,
            }}
          >
            All three gates clear. Start with a soft easy run — 30 minutes, conversational, walk if the body asks.
          </div>
          <button
            type="button"
            onClick={runToday}
            disabled={submitting}
            style={{
              width: '100%',
              background: 'var(--green)',
              border: 'none',
              borderRadius: 12,
              padding: '14px 0',
              fontFamily: 'var(--f-body, Inter, sans-serif)',
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: 0.3,
              color: '#0a0c10',
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Resuming…' : 'Run today'}
          </button>
        </div>
      ) : (
        <div
          style={{
            fontFamily: 'var(--f-body)',
            fontSize: 11,
            color: 'var(--mute)',
            marginTop: 10,
            lineHeight: 1.45,
          }}
        >
          Day {sick.days_active + 1} · plan stays paused until all three gates clear.
        </div>
      )}
      {error && (
        <div style={{ color: 'var(--over)', fontSize: 11, marginTop: 8 }}>{error}</div>
      )}
    </div>
  );
}
