'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Coach hero block — the warm voice + lead + reply chips.
 * §8.1 closed loop: SOLID / TIRED / WRECKED tap → POST /api/checkin → coach reads on next briefing.
 */
export function CoachBlock({
  lead,
  voice,
  briefingId,
  askPrompt = 'How did the run feel?',
  showCheckin = true,
}: {
  lead?: string;
  voice: string[];
  briefingId?: string;
  askPrompt?: string;
  showCheckin?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<'solid' | 'tired' | 'wrecked' | null>(null);
  const [ack, setAck] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(rating: 'solid' | 'tired' | 'wrecked') {
    if (pending) return;
    setSelected(rating);
    startTransition(async () => {
      try {
        const res = await fetch('/api/checkin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating, briefing_id: briefingId, surface: 'today' }),
        });
        if (res.ok) {
          setAck(
            rating === 'solid'   ? 'OK. Hold the plan.' :
            rating === 'tired'   ? "OK — we'll see how the legs are tomorrow." :
                                   "OK. We'll back off tomorrow."
          );
          // Closed loop §8.1: bust the briefing so the next view reflects the rating.
          router.refresh();
        } else {
          setAck("(couldn't save — we'll try again)");
        }
      } catch {
        setAck("(network hiccup — we'll try again)");
      }
    });
  }

  return (
    <section style={{ padding: '8px 24px 22px', borderTop: '1px solid var(--line-2)', marginTop: 4 }}>
      <div style={{
        fontFamily: 'var(--f-body)',
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--green)',
        letterSpacing: '1.6px',
        textTransform: 'uppercase',
        marginBottom: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'var(--green)',
          boxShadow: '0 0 12px rgba(62,189,65,0.6)',
        }} />
        COACH
      </div>

      {lead && (
        <h2 style={{
          fontFamily: 'var(--f-display)',
          fontSize: 32,
          fontWeight: 400,
          color: 'var(--ink)',
          lineHeight: 1.05,
          letterSpacing: '0.5px',
          margin: '0 0 14px',
        }}>
          {lead}
        </h2>
      )}

      {voice.map((p, i) => (
        <p key={i} style={{
          fontFamily: 'var(--f-body)',
          fontSize: 15.5,
          lineHeight: 1.6,
          color: 'rgba(246,247,248,0.86)',
          margin: '0 0 12px',
          letterSpacing: '-0.01em',
        }}>
          {/* Render **bold** markers from LLM output. */}
          {renderInline(p)}
        </p>
      ))}

      {ack && (
        <p style={{
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          color: 'var(--green)',
          margin: '12px 0 4px',
          fontStyle: 'italic',
        }}>
          {ack}
        </p>
      )}

      {showCheckin && (
      <div style={{
        fontFamily: 'var(--f-body)',
        fontSize: 12,
        color: 'var(--mute)',
        marginTop: 18,
        marginBottom: 12,
        letterSpacing: '0.2px',
      }}>
        {askPrompt}
      </div>
      )}

      {showCheckin && (
      <div style={{ display: 'flex', gap: 8 }}>
        {(['solid', 'tired', 'wrecked'] as const).map((r) => {
          const isSelected = selected === r;
          const isDisabled = selected !== null && !isSelected;
          const accent = r === 'solid' ? 'var(--green)' : r === 'tired' ? 'var(--goal)' : 'var(--over)';
          return (
            <button
              key={r}
              onClick={() => submit(r)}
              disabled={pending || isDisabled}
              style={{
                flex: 1,
                background: isSelected ? `${accent.replace(')', ', 0.12)').replace('var(--', 'rgba(var(--')}` : 'transparent',
                backgroundColor: isSelected
                  ? (r === 'solid' ? 'rgba(62,189,65,0.12)' : r === 'tired' ? 'rgba(243,173,56,0.12)' : 'rgba(252,77,100,0.12)')
                  : 'transparent',
                border: `1px solid ${isSelected ? accent : 'var(--line)'}`,
                color: isSelected ? accent : (isDisabled ? 'var(--dim)' : 'var(--ink)'),
                padding: '12px 4px',
                borderRadius: 14,
                fontFamily: 'var(--f-display)',
                fontSize: 18,
                fontWeight: 400,
                letterSpacing: '1.2px',
                cursor: isDisabled || pending ? 'default' : 'pointer',
                opacity: isDisabled ? 0.5 : 1,
                transition: 'all .15s',
              }}
            >
              {r.toUpperCase()}
            </button>
          );
        })}
      </div>
      )}
    </section>
  );
}

// Tiny **bold** parser for LLM-emitted markdown emphasis.
function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const start = text.indexOf('**', i);
    if (start === -1) { out.push(text.slice(i)); break; }
    if (start > i) out.push(text.slice(i, start));
    const end = text.indexOf('**', start + 2);
    if (end === -1) { out.push(text.slice(i)); break; }
    out.push(<strong key={key++} style={{ color: 'var(--ink)', fontWeight: 600 }}>{text.slice(start + 2, end)}</strong>);
    i = end + 2;
  }
  return out;
}
