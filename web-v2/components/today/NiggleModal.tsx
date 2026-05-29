'use client';

/**
 * NiggleModal · the full-viewport overlay that captures a niggle log.
 * Spec: docs/2026-05-28-niggle-sick-logging.html §SECTION 02.
 *
 * Captures four things per the deck:
 *   1. WHERE  · body diagram (front + back inline SVG) + L/R/Both side pill
 *   2. SEVERITY · 1-10 with runner-honest anchors (1=annoying, 5=stop-and-
 *      stretch, 10=can't run) per design footer Q2
 *   3. STATUS · just_started | few_days | weeks
 *   4. NOTES  · optional textarea
 *
 * Two CTAs: Cancel (closes) and Log niggle (POSTs to /api/niggle, calls
 * onLogged so the parent can router.refresh()).
 *
 * v1 single-niggle UI: tapping a region replaces the previous selection
 * (no multi-select per design Q3 — agent default).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type NiggleSide = 'left' | 'right' | 'both';
export type NiggleStatus = 'just_started' | 'few_days' | 'weeks';

interface NiggleModalProps {
  onClose: () => void;
}

const HOTSPOT_LABELS: Record<string, string> = {
  hip: 'Hip',
  quad: 'Quad',
  knee: 'Knee',
  shin: 'Shin',
  foot: 'Foot',
  glute: 'Glute',
  hamstring: 'Hamstring',
  calf: 'Calf',
  achilles: 'Achilles',
  it_band: 'ITB',
  plantar: 'Plantar',
};

const SEVERITY_ANCHORS: { value: number; label: string }[] = [
  { value: 1, label: 'Annoying' },
  { value: 5, label: 'Stop & stretch' },
  { value: 10, label: "Can't run" },
];

export function NiggleModal({ onClose }: NiggleModalProps) {
  const router = useRouter();
  const [bodyPart, setBodyPart] = useState<string | null>(null);
  const [side, setSide] = useState<NiggleSide>('right');
  const [severity, setSeverity] = useState<number>(3);
  const [status, setStatus] = useState<NiggleStatus>('just_started');
  const [note, setNote] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !!bodyPart && !submitting;

  async function handleLog() {
    if (!bodyPart) {
      setError('Pick a body part first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/niggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body_part: bodyPart,
          side,
          severity,
          status,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `POST /api/niggle failed (${res.status})`);
      }
      onClose();
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setSubmitting(false);
    }
  }

  // Severity color band (mirrors deck sev-pip on1/on2/on3)
  const sevColor = severity <= 3 ? 'var(--green)' : severity <= 5 ? 'var(--goal)' : 'var(--over)';

  return (
    <div
      role="dialog"
      aria-labelledby="niggle-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(20,17,13,0.55)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 540,
          maxHeight: '92vh',
          background: 'var(--card)',
          borderRadius: 4,
          border: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 22px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <h2
            id="niggle-modal-title"
            style={{
              fontFamily: 'var(--f-display, Oswald, sans-serif)',
              fontWeight: 700,
              letterSpacing: '-0.015em',
              lineHeight: 0.86,
              fontSize: 28,
              color: 'var(--ink)',
              margin: 0,
            }}
          >
            Log a niggle.
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontFamily: 'var(--f-body, Inter, sans-serif)',
              fontWeight: 600,
              fontSize: 14,
              color: 'var(--mute)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Cancel
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 0' }}>
          {/* WHERE */}
          <FieldBlock label="WHERE">
            <SideRadio side={side} onChange={setSide} />
            <BodyDiagram selected={bodyPart} onSelect={setBodyPart} />
            <div
              style={{
                fontFamily: 'var(--f-body)',
                fontSize: 11,
                color: 'var(--mute)',
                marginTop: 4,
              }}
            >
              Tap a region. Tap again to clear.{' '}
              {bodyPart ? (
                <strong style={{ color: 'var(--goal)' }}>
                  {side === 'both' ? 'Both' : side === 'left' ? 'L' : 'R'}{' '}
                  {(HOTSPOT_LABELS[bodyPart] ?? bodyPart).toLowerCase()} selected.
                </strong>
              ) : (
                'Nothing selected yet.'
              )}
            </div>
          </FieldBlock>

          {/* SEVERITY */}
          <FieldBlock label="SEVERITY · HOW BAD">
            <div
              style={{
                background: 'var(--card-2)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: 14,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(10, 1fr)',
                  gap: 4,
                  marginBottom: 10,
                }}
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                  const isOn = n <= severity;
                  const bg = !isOn
                    ? 'var(--card-2)'
                    : n <= 3
                      ? 'rgba(62,189,65,0.85)'
                      : n <= 5
                        ? 'rgba(243,173,56,0.95)'
                        : 'rgba(252,77,100,0.95)';
                  const color = !isOn ? 'var(--mute)' : n <= 5 ? '#0a0c10' : '#fff';
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSeverity(n)}
                      style={{
                        height: 28,
                        background: bg,
                        border: isOn ? 'none' : '1px solid var(--line)',
                        borderRadius: 4,
                        fontFamily: 'var(--f-body)',
                        fontWeight: 700,
                        fontSize: 10,
                        color,
                        cursor: 'pointer',
                        fontVariantNumeric: 'tabular-nums',
                        padding: 0,
                      }}
                      aria-label={`Severity ${n}`}
                      aria-pressed={severity === n}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 4,
                  fontFamily: 'var(--f-body)',
                  fontSize: 10,
                  lineHeight: 1.4,
                  color: 'var(--mute)',
                }}
              >
                {SEVERITY_ANCHORS.map((a, i) => (
                  <div
                    key={a.value}
                    style={{
                      textAlign: i === 0 ? 'left' : i === 1 ? 'center' : 'right',
                    }}
                  >
                    <strong style={{ color: 'var(--ink)', display: 'block', fontWeight: 700, fontSize: 10 }}>
                      {a.value} · {a.label}
                    </strong>
                    {i === 0 && "You'd ignore it."}
                    {i === 1 && 'Mid-run noticing.'}
                    {i === 2 && 'Walking hurts.'}
                  </div>
                ))}
              </div>
            </div>
          </FieldBlock>

          {/* STATUS */}
          <FieldBlock label="STATUS · HOW LONG">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              {(['just_started', 'few_days', 'weeks'] as NiggleStatus[]).map((s) => {
                const labels: Record<NiggleStatus, string> = {
                  just_started: 'Just started',
                  few_days: 'Few days now',
                  weeks: 'Weeks of it',
                };
                const isOn = status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    style={chipBtnStyle(isOn)}
                  >
                    {labels[s]}
                  </button>
                );
              })}
            </div>
          </FieldBlock>

          {/* NOTES */}
          <FieldBlock label="NOTES · OPTIONAL">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Came on at mile 4 of Sunday's long. Loosens up walking. No pain at rest."
              style={{
                width: '100%',
                background: 'var(--card-2)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '12px 14px',
                minHeight: 64,
                fontFamily: 'var(--f-body, Inter, sans-serif)',
                fontWeight: 500,
                fontSize: 13,
                color: 'var(--ink)',
                lineHeight: 1.5,
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </FieldBlock>

          {error && (
            <div
              style={{
                color: 'var(--over)',
                fontFamily: 'var(--f-body)',
                fontSize: 12,
                padding: '8px 12px',
                background: 'rgba(252,77,100,0.08)',
                borderRadius: 8,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ height: 8 }} />
        </div>

        {/* CTAs */}
        <div
          style={{
            padding: '16px 22px 20px',
            display: 'grid',
            gridTemplateColumns: '1fr 2fr',
            gap: 10,
            borderTop: '1px solid var(--line)',
            background: 'var(--card)',
          }}
        >
          <button type="button" onClick={onClose} style={ctaSecStyle}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleLog}
            disabled={!canSubmit}
            style={{
              ...ctaPriStyle,
              opacity: canSubmit ? 1 : 0.45,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              background: sevColor,
            }}
          >
            {submitting ? 'Logging…' : 'Log niggle'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          fontFamily: 'var(--f-body, Inter, sans-serif)',
          fontWeight: 700,
          fontSize: 9,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: 'var(--mute)',
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function SideRadio({ side, onChange }: { side: NiggleSide; onChange: (s: NiggleSide) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
      {(['left', 'right', 'both'] as NiggleSide[]).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          style={sidePillStyle(side === s)}
          aria-pressed={side === s}
        >
          {s === 'left' ? 'LEFT' : s === 'right' ? 'RIGHT' : 'BOTH'}
        </button>
      ))}
    </div>
  );
}

function sidePillStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    background: active ? 'rgba(246,247,248,0.96)' : 'var(--card-2)',
    border: active
      ? '1px solid rgba(246,247,248,0.96)'
      : '1px solid var(--line)',
    color: active ? '#0a0c10' : 'var(--mute)',
    borderRadius: 4,
    padding: '9px 0',
    fontFamily: 'var(--f-body, Inter, sans-serif)',
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: 0.4,
    cursor: 'pointer',
  };
}

function chipBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'rgba(246,247,248,0.96)' : 'var(--card-2)',
    border: active
      ? '1px solid rgba(246,247,248,0.96)'
      : '1px solid var(--line)',
    color: active ? '#0a0c10' : 'var(--mute)',
    borderRadius: 4,
    padding: '11px 8px',
    fontFamily: 'var(--f-body, Inter, sans-serif)',
    fontWeight: active ? 700 : 600,
    fontSize: 11,
    cursor: 'pointer',
    textAlign: 'center',
    lineHeight: 1.3,
  };
}

const ctaSecStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--line)',
  borderRadius: 4,
  padding: '14px 0',
  color: 'var(--mute)',
  fontFamily: 'var(--f-body, Inter, sans-serif)',
  fontWeight: 700,
  fontSize: 14,
  letterSpacing: 0.3,
  cursor: 'pointer',
};

const ctaPriStyle: React.CSSProperties = {
  background: 'var(--green)',
  border: 'none',
  borderRadius: 4,
  padding: '14px 0',
  color: '#0a0c10',
  fontFamily: 'var(--f-body, Inter, sans-serif)',
  fontWeight: 700,
  fontSize: 14,
  letterSpacing: 0.3,
  cursor: 'pointer',
};

// ──────────────────────────────────────────────────────────────────────
// BodyDiagram · front + back SVG, inline, with tappable hotspots.
// SVG paths lifted from the design deck (deck §SECTION 02 mock).
// ──────────────────────────────────────────────────────────────────────

const FRONT_HOTSPOTS: { key: string; cx: number; cy: number; label: string }[] = [
  { key: 'hip', cx: 37, cy: 100, label: 'HIP' },
  { key: 'hip', cx: 53, cy: 100, label: '' },
  { key: 'quad', cx: 37, cy: 135, label: 'QUAD' },
  { key: 'quad', cx: 53, cy: 135, label: '' },
  { key: 'knee', cx: 37, cy: 160, label: 'KNEE' },
  { key: 'knee', cx: 53, cy: 160, label: '' },
  { key: 'shin', cx: 37, cy: 178, label: 'SHIN' },
  { key: 'shin', cx: 53, cy: 178, label: '' },
  { key: 'foot', cx: 38, cy: 196, label: '' },
  { key: 'foot', cx: 52, cy: 196, label: 'FOOT' },
];

const BACK_HOTSPOTS: { key: string; cx: number; cy: number; label: string }[] = [
  { key: 'glute', cx: 37, cy: 100, label: 'GLUTE' },
  { key: 'glute', cx: 53, cy: 100, label: '' },
  { key: 'hamstring', cx: 37, cy: 140, label: 'HAM' },
  { key: 'hamstring', cx: 53, cy: 140, label: '' },
  { key: 'it_band', cx: 29, cy: 142, label: 'ITB' },
  { key: 'it_band', cx: 61, cy: 142, label: '' },
  { key: 'calf', cx: 37, cy: 176, label: 'CALF' },
  { key: 'calf', cx: 53, cy: 176, label: '' },
  { key: 'achilles', cx: 38, cy: 190, label: '' },
  { key: 'achilles', cx: 52, cy: 190, label: 'ACH.' },
];

function BodyDiagram({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (s: string | null) => void;
}) {
  function tap(key: string) {
    onSelect(selected === key ? null : key);
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        background: 'var(--card-2)',
        border: '1px solid var(--line)',
        borderRadius: 4,
        padding: 14,
        marginBottom: 10,
      }}
    >
      <BodySideView title="FRONT" hotspots={FRONT_HOTSPOTS} selected={selected} onTap={tap} variant="front" />
      <BodySideView title="BACK" hotspots={BACK_HOTSPOTS} selected={selected} onTap={tap} variant="back" />
    </div>
  );
}

function BodySideView({
  title,
  hotspots,
  selected,
  onTap,
  variant,
}: {
  title: string;
  hotspots: typeof FRONT_HOTSPOTS;
  selected: string | null;
  onTap: (k: string) => void;
  variant: 'front' | 'back';
}) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          fontFamily: 'var(--f-body)',
          fontWeight: 700,
          fontSize: 9,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: 'var(--mute)',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <svg
        viewBox="0 0 90 200"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: '100%', height: 'auto' }}
        aria-label={`${title.toLowerCase()} body diagram`}
      >
        <g fill="var(--card-2)" stroke="var(--line)" strokeWidth={0.6}>
          <ellipse cx={45} cy={12} rx={8} ry={10} />
          <rect x={42} y={20} width={6} height={6} rx={2} />
          <path d="M30 28 Q33 25 45 25 Q57 25 60 28 L62 60 Q62 75 58 88 L32 88 Q28 75 28 60 Z" />
          <path d="M30 30 Q22 42 21 60 Q20 78 23 92 L26 92 Q23 78 24 62 Q25 46 32 36 Z" />
          <path d="M60 30 Q68 42 69 60 Q70 78 67 92 L64 92 Q67 78 66 62 Q65 46 58 36 Z" />
          {variant === 'front' ? (
            <>
              <path d="M32 88 L58 88 L60 110 L52 112 L45 110 L38 112 L30 110 Z" />
              <path d="M45 110 L52 112 L57 115 L57 158 L48 158 L45 130 Z" />
              <path d="M45 110 L38 112 L33 115 L33 158 L42 158 L45 130 Z" />
              <ellipse cx={37} cy={160} rx={5} ry={3} />
              <ellipse cx={53} cy={160} rx={5} ry={3} />
              <path d="M48 162 L56 162 L55 193 L49 193 Z" />
              <path d="M34 162 L42 162 L41 193 L35 193 Z" />
              <ellipse cx={38} cy={196} rx={6} ry={3} />
              <ellipse cx={52} cy={196} rx={6} ry={3} />
            </>
          ) : (
            <>
              <path d="M32 88 L58 88 L60 112 L45 116 L30 112 Z" />
              <path d="M45 116 L60 112 L58 158 L48 158 L45 130 Z" />
              <path d="M45 116 L30 112 L32 158 L42 158 L45 130 Z" />
              <ellipse cx={37} cy={160} rx={5} ry={3} />
              <ellipse cx={53} cy={160} rx={5} ry={3} />
              <path d="M48 162 L57 162 Q57 175 55 193 L49 193 Z" />
              <path d="M33 162 L42 162 Q42 175 41 193 L35 193 Z" />
              <ellipse cx={38} cy={196} rx={6} ry={3} />
              <ellipse cx={52} cy={196} rx={6} ry={3} />
            </>
          )}
        </g>
        {hotspots.map((h, i) => {
          const isSel = selected === h.key;
          return (
            <g key={`${h.key}-${i}`}>
              <circle
                cx={h.cx}
                cy={h.cy}
                r={isSel ? 6.5 : 4}
                fill={isSel ? 'rgba(243,173,56,0.85)' : 'var(--card-2)'}
                stroke={isSel ? 'rgba(255,255,255,0.9)' : 'var(--line)'}
                strokeWidth={isSel ? 1.4 : 0.5}
                style={{ cursor: 'pointer' }}
                onClick={() => onTap(h.key)}
              />
              {h.label ? (
                <text
                  x={h.cx > 45 ? 69 : 20}
                  y={h.cy + 3}
                  textAnchor={h.cx > 45 ? 'start' : 'end'}
                  fontFamily="Inter"
                  fontSize={4.4}
                  fontWeight={700}
                  fill="var(--dim)"
                >
                  {h.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
