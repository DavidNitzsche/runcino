'use client';

/**
 * SickModal · the full-viewport overlay that captures a sick log.
 * Spec: docs/2026-05-28-niggle-sick-logging.html §SECTION 03.
 *
 * Captures four things per the deck:
 *   1. SYMPTOMS · multi-select (head_cold|chest|fever|gi|aches|fatigue|voice|other)
 *   2. STARTED  · today | yesterday | few_days | week_plus
 *   3. FEVER    · boolean toggle (when ON, shows DO-NOT-RUN red banner)
 *   4. NOTES    · optional textarea
 *
 * Two CTAs: Cancel and "Pause the plan" — POSTs to /api/sick, calls
 * onLogged so the parent can router.refresh().
 *
 * "Other" symptom (Q4 agent default) opens a free-text field inline. The
 * string is sent in the `note` field, not the symptoms array (otherwise
 * the array could carry user text — the enum is fixed).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type SickStarted = 'today' | 'yesterday' | 'few_days' | 'week_plus';
export type SickSymptom =
  | 'head_cold'
  | 'chest'
  | 'fever'
  | 'gi'
  | 'aches'
  | 'fatigue'
  | 'voice'
  | 'other';

interface SickModalProps {
  onClose: () => void;
}

const SYMPTOM_LABELS: Record<SickSymptom, string> = {
  head_cold: 'Head cold',
  chest: 'Chest congestion',
  fever: 'Fever',
  gi: 'GI / stomach',
  aches: 'Body aches',
  fatigue: 'Fatigue',
  voice: 'Lost voice',
  other: 'Other',
};

const STARTED_LABELS: Record<SickStarted, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  few_days: '2–3 days ago',
  week_plus: 'A week or more',
};

export function SickModal({ onClose }: SickModalProps) {
  const router = useRouter();
  const [symptoms, setSymptoms] = useState<Set<SickSymptom>>(new Set());
  const [started, setStarted] = useState<SickStarted>('today');
  const [hasFever, setHasFever] = useState<boolean>(false);
  const [otherText, setOtherText] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSymptom(s: SickSymptom) {
    setSymptoms((prev) => {
      const next = new Set(prev);
      if (next.has(s)) {
        next.delete(s);
      } else {
        next.add(s);
        // Toggling on `fever` flips has_fever for the toggle convenience.
        if (s === 'fever') setHasFever(true);
      }
      return next;
    });
  }

  function toggleFever() {
    setHasFever((prev) => {
      const next = !prev;
      setSymptoms((p) => {
        const set = new Set(p);
        if (next) set.add('fever');
        else set.delete('fever');
        return set;
      });
      return next;
    });
  }

  const canSubmit = symptoms.size > 0 && !submitting;

  async function handleLog() {
    if (symptoms.size === 0) {
      setError('Pick at least one symptom.');
      return;
    }
    setSubmitting(true);
    setError(null);
    // Build the note: prefer user note, but if "Other" is selected and they
    // wrote free text, prefix the note with it.
    let finalNote = note.trim();
    if (symptoms.has('other') && otherText.trim()) {
      finalNote = finalNote
        ? `Other: ${otherText.trim()}. ${finalNote}`
        : `Other: ${otherText.trim()}`;
    }

    try {
      const res = await fetch('/api/sick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symptoms: Array.from(symptoms),
          started,
          has_fever: hasFever,
          note: finalNote || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `POST /api/sick failed (${res.status})`);
      }
      onClose();
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-labelledby="sick-modal-title"
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
            id="sick-modal-title"
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
            I&rsquo;m not well.
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
          {/* SYMPTOMS */}
          <FieldBlock label="SYMPTOMS · TAP ALL THAT APPLY">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {(Object.keys(SYMPTOM_LABELS) as SickSymptom[]).map((s) => {
                const on = symptoms.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSymptom(s)}
                    style={symChipStyle(on)}
                    aria-pressed={on}
                  >
                    <span style={checkBoxStyle(on)}>{on ? '✓' : ''}</span>
                    {SYMPTOM_LABELS[s]}
                  </button>
                );
              })}
            </div>
            {symptoms.has('other') && (
              <input
                type="text"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="What else? (free text)"
                style={{
                  marginTop: 8,
                  width: '100%',
                  background: 'var(--card-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 4,
                  padding: '11px 14px',
                  fontFamily: 'var(--f-body, Inter, sans-serif)',
                  fontSize: 13,
                  color: 'var(--ink)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            )}
          </FieldBlock>

          {/* STARTED */}
          <FieldBlock label="STARTED">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              {(['today', 'yesterday', 'few_days'] as SickStarted[]).map((s) => {
                const isOn = started === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStarted(s)}
                    style={chipBtnStyle(isOn)}
                  >
                    {STARTED_LABELS[s]}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setStarted('week_plus')}
              style={{ ...chipBtnStyle(started === 'week_plus'), marginTop: 6, width: '100%' }}
            >
              {STARTED_LABELS['week_plus']}
            </button>
          </FieldBlock>

          {/* FEVER */}
          <FieldBlock label="FEVER · ABOVE 100°F / 37.8°C">
            <button
              type="button"
              onClick={toggleFever}
              style={{
                width: '100%',
                background: hasFever ? 'rgba(252,77,100,0.08)' : 'var(--card-2)',
                border: hasFever
                  ? '1px solid rgba(252,77,100,0.45)'
                  : '1px solid var(--line)',
                borderRadius: 4,
                padding: '14px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              aria-pressed={hasFever}
            >
              <div style={{ fontFamily: 'var(--f-body)', fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
                {hasFever ? 'Yes, I have a fever' : 'No fever'}
                <span
                  style={{
                    display: 'block',
                    fontWeight: 500,
                    fontSize: 11,
                    color: 'var(--mute)',
                    marginTop: 3,
                  }}
                >
                  Above 100°F / 37.8°C
                </span>
              </div>
              <div
                style={{
                  width: 44,
                  height: 26,
                  borderRadius: 999,
                  background: hasFever ? 'var(--over)' : 'var(--line)',
                  position: 'relative',
                  flexShrink: 0,
                  transition: 'background 0.18s ease',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: hasFever ? 21 : 3,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: hasFever ? '#fff' : 'var(--mute)',
                    transition: 'left 0.18s ease, background 0.18s ease',
                  }}
                />
              </div>
            </button>
            {hasFever && (
              <div
                style={{
                  background: 'rgba(252,77,100,0.10)',
                  border: '1px solid rgba(252,77,100,0.45)',
                  borderRadius: 4,
                  padding: '12px 14px',
                  marginTop: 10,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--f-display, Oswald, sans-serif)',
                    fontWeight: 700,
                    letterSpacing: '-0.015em',
                    fontSize: 18,
                    color: 'var(--over)',
                    marginBottom: 4,
                  }}
                >
                  DO NOT RUN.
                </div>
                <div
                  style={{
                    fontFamily: 'var(--f-body, Inter, sans-serif)',
                    fontSize: 11,
                    lineHeight: 1.45,
                    color: 'var(--mute)',
                  }}
                >
                  Training with a fever raises core temperature further, risks dehydration, and in rare cases triggers <strong>myocarditis</strong>. The body needs rest, fluids, and time. The plan will resume when your fever is gone for 24h and your RHR is within 5 bpm of baseline.
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
                  Cite · research/methodology/05-injury-return-protocols.md · §recovery gates
                </div>
              </div>
            )}
          </FieldBlock>

          {/* NOTES */}
          <FieldBlock label="NOTES · OPTIONAL">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Started feeling rough after Sunday's long run. Sore throat by Monday evening."
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
              ...ctaPriSickStyle,
              opacity: canSubmit ? 1 : 0.45,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? 'Pausing…' : 'Pause the plan'}
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

function symChipStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'rgba(246,247,248,0.96)' : 'var(--card-2)',
    border: active
      ? '1px solid rgba(246,247,248,0.96)'
      : '1px solid var(--line)',
    color: active ? '#0a0c10' : 'var(--mute)',
    borderRadius: 4,
    padding: '11px 12px',
    fontFamily: 'var(--f-body, Inter, sans-serif)',
    fontWeight: active ? 700 : 600,
    fontSize: 11,
    cursor: 'pointer',
    textAlign: 'left',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  };
}

function checkBoxStyle(on: boolean): React.CSSProperties {
  return {
    width: 14,
    height: 14,
    borderRadius: 4,
    border: on ? '1.5px solid #0a0c10' : '1.5px solid var(--mute)',
    background: on ? '#0a0c10' : 'transparent',
    color: '#fff',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    fontWeight: 800,
    lineHeight: 1,
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

const ctaPriSickStyle: React.CSSProperties = {
  background: 'rgba(246,247,248,0.96)',
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
