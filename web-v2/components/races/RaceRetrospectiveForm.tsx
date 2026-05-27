'use client';

/**
 * RaceRetrospectiveForm — post-race form for finish time + subjective notes.
 * Lives on /races/[slug] when proximity === 'post-race'.
 *
 * Writes through to PATCH /api/race so retro lands in races.meta:
 *   finishTime, pb, retroFelt, retroExecution, retroNotes
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function RaceRetrospectiveForm({ slug, existing }: {
  slug: string;
  existing: { finishTime?: string | null; pb?: boolean | null; retroFelt?: string | null; retroExecution?: string | null; retroNotes?: string | null };
}) {
  const router = useRouter();
  const [finishTime, setFinishTime] = useState(existing.finishTime ?? '');
  const [pb, setPb] = useState(existing.pb ?? false);
  const [felt, setFelt] = useState(existing.retroFelt ?? '');
  const [execution, setExecution] = useState(existing.retroExecution ?? '');
  const [notes, setNotes] = useState(existing.retroNotes ?? '');
  const [pending, startTransition] = useTransition();
  const [ack, setAck] = useState<string | null>(null);

  async function submit() {
    setAck(null);
    try {
      const r = await fetch('/api/race', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          finishTime: finishTime || null,
          pb,
          retroFelt: felt || null,
          retroExecution: execution || null,
          retroNotes: notes || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'save failed');
      setAck('Saved. Coach will reference this in next race talk.');
      startTransition(() => router.refresh());
    } catch (e: any) {
      setAck(`Failed: ${e.message}`);
    }
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <Field label="Finish time">
          <input
            value={finishTime} onChange={(e) => setFinishTime(e.target.value)}
            placeholder="1:30:08"
            style={inputStyle()}
          />
        </Field>
        <Field label="Personal best?">
          <div style={{ display: 'flex', gap: 6 }}>
            {[true, false].map((v) => (
              <button key={String(v)} onClick={() => setPb(v)}
                style={{
                  background: pb === v ? (v ? 'rgba(62,189,65,0.18)' : 'rgba(255,255,255,0.04)') : 'transparent',
                  border: `1px solid ${pb === v ? (v ? 'var(--green)' : 'var(--line)') : 'var(--line)'}`,
                  color: pb === v ? (v ? 'var(--green)' : 'var(--mute)') : 'var(--mute)',
                  borderRadius: 8, padding: '8px 14px',
                  fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '1px', cursor: 'pointer',
                }}>
                {v ? 'YES · PB' : 'NO'}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <Field label="How did it feel?">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['Strong', 'Solid', 'Hung on', 'Survived', 'Blew up'].map((f) => (
            <button key={f} onClick={() => setFelt(f)}
              style={{
                background: felt === f ? 'rgba(243,173,56,0.18)' : 'transparent',
                border: `1px solid ${felt === f ? 'var(--goal)' : 'var(--line)'}`,
                color: felt === f ? 'var(--goal)' : 'var(--mute)',
                borderRadius: 999, padding: '6px 12px',
                fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '1px', cursor: 'pointer',
              }}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Pacing execution">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {['Negative split', 'Even', 'Faded late', 'Went out too hot'].map((f) => (
            <button key={f} onClick={() => setExecution(f)}
              style={{
                background: execution === f ? 'rgba(176,132,255,0.18)' : 'transparent',
                border: `1px solid ${execution === f ? 'var(--learn)' : 'var(--line)'}`,
                color: execution === f ? 'var(--learn)' : 'var(--mute)',
                borderRadius: 999, padding: '6px 12px',
                fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '1px', cursor: 'pointer',
              }}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Notes (one or two sentences)">
        <textarea
          value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="What worked, what didn't. Hot? Tactical mistake? Hill that hurt?"
          style={{ ...inputStyle(), minHeight: 90, resize: 'vertical' }}
        />
      </Field>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <button onClick={submit} disabled={pending}
          style={{
            background: 'var(--green)', color: '#001', border: 'none', borderRadius: 8,
            padding: '10px 20px', fontFamily: 'var(--f-label)', fontSize: 12, letterSpacing: '1.2px',
            cursor: pending ? 'default' : 'pointer',
          }}>
          {pending ? 'SAVING…' : 'SAVE RETROSPECTIVE'}
        </button>
        {ack && <span style={{ fontSize: 12, color: 'var(--mute)' }}>{ack}</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 6, fontWeight: 700 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)', borderRadius: 8,
    color: 'var(--ink)', fontFamily: 'var(--f-body)', fontSize: 14, padding: '8px 12px', width: '100%',
  };
}
