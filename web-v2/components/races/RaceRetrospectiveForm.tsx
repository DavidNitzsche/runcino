'use client';

/**
 * RaceRetrospectiveForm — post-race form for finish time + subjective notes.
 * Lives on /races/[slug] when proximity === 'post-race'.
 *
 * Two-step save:
 *   1. POST /api/race/result — canonical actual_result write when finishTime
 *      is set. Returns VDOT delta + marathon projection for the ack toast.
 *   2. PATCH /api/race — retrospective fields (felt, execution, notes, pb)
 *      that live in races.meta.
 */
import { useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { parseRaceTime } from '@/lib/training/vdot';

function parseFinishTime(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) > 0 ? Number(t) : null;
  // 2026-06-09 · race-killer F2 — shared parser. A runner typing a HM
  // finish as "1:30" got 90 seconds from the local 2-part branch.
  return parseRaceTime(t);
}

function fmtSec(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return '·';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface NextPlanAck {
  ok: boolean;
  raceSlug: string;
  raceName: string;
  weeks_generated?: number;
  compressed?: boolean;
  reason?: string;
}

interface SaveAck {
  text: string;
  vdot?: { before: number | null; after: number | null };
  mProj?: number | null;
  planArchived?: boolean;
  nextPlan?: NextPlanAck | null;
}

export function RaceRetrospectiveForm({ slug, existing }: {
  slug: string;
  existing: {
    finishTime?: string | null;
    pb?: boolean | null;
    avgHrBpm?: number | null;
    retroFelt?: string | null;
    retroExecution?: string | null;
    retroNotes?: string | null;
  };
}) {
  const router = useRouter();
  const [finishTime, setFinishTime] = useState(existing.finishTime ?? '');
  const [pb, setPb] = useState(existing.pb ?? false);
  const [avgHrBpm, setAvgHrBpm] = useState(existing.avgHrBpm ? String(existing.avgHrBpm) : '');
  const [felt, setFelt] = useState(existing.retroFelt ?? '');
  const [execution, setExecution] = useState(existing.retroExecution ?? '');
  const [notes, setNotes] = useState(existing.retroNotes ?? '');
  const [pending, startTransition] = useTransition();
  const [ack, setAck] = useState<SaveAck | null>(null);

  const submit = useCallback(async () => {
    setAck(null);
    try {
      const finishS = parseFinishTime(finishTime);
      let vdotBefore: number | null = null;
      let vdotAfter: number | null = null;
      let mProjAfter: number | null = null;
      let planArchived = false;
      let nextPlanResult: NextPlanAck | null = null;

      // Step 1 — canonical result write (only when a finish time is entered).
      if (finishS) {
        const rr = await fetch('/api/race/result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug,
            finishS,
            avgHrBpm: avgHrBpm ? Number(avgHrBpm) : undefined,
          }),
        });
        const rj = await rr.json();
        if (!rr.ok) throw new Error(rj.error ?? 'result save failed');
        vdotBefore = rj.vdotBefore ?? null;
        vdotAfter = rj.vdotAfter ?? null;
        mProjAfter = rj.marathonProjectionSec ?? null;
        planArchived = rj.planArchived ?? false;
        nextPlanResult = (rj.nextPlan ?? null) as NextPlanAck | null;
      }

      // Step 2 — retrospective fields land in meta.
      const pr = await fetch('/api/race', {
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
      const pj = await pr.json();
      if (!pr.ok) throw new Error(pj.error ?? 'retro save failed');

      setAck({
        text: finishS ? 'Result locked in.' : 'Saved.',
        vdot: finishS ? { before: vdotBefore, after: vdotAfter } : undefined,
        mProj: mProjAfter,
        planArchived,
        nextPlan: finishS ? nextPlanResult : null,
      });
      startTransition(() => router.refresh());
    } catch (e: unknown) {
      setAck({ text: `Failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [slug, finishTime, avgHrBpm, pb, felt, execution, notes, router]);

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
                  background: pb === v ? (v ? 'rgba(62,189,65,0.18)' : 'var(--card-2)') : 'transparent',
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

      <Field label="Avg heart rate (optional)">
        <input
          value={avgHrBpm} onChange={(e) => setAvgHrBpm(e.target.value)}
          placeholder="162"
          type="number"
          style={{ ...inputStyle(), width: 120 }}
        />
      </Field>

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

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 14 }}>
        <button onClick={submit} disabled={pending}
          style={{
            background: 'var(--green)', color: '#001', border: 'none', borderRadius: 8,
            padding: '10px 20px', fontFamily: 'var(--f-label)', fontSize: 12, letterSpacing: '1.2px',
            cursor: pending ? 'default' : 'pointer', flexShrink: 0,
          }}>
          {pending ? 'SAVING…' : 'SAVE RETROSPECTIVE'}
        </button>
        {ack && (
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            <span style={{ color: 'var(--ink)' }}>{ack.text}</span>
            {ack.vdot?.after != null && (
              <span style={{ marginLeft: 10, color: 'var(--ink)' }}>
                {'VDOT '}
                {ack.vdot.before != null
                  ? <>{ack.vdot.before.toFixed(1)} <span style={{ color: 'var(--mute)' }}>→</span> </>
                  : null}
                <strong>{ack.vdot.after.toFixed(1)}</strong>
                {ack.mProj != null && (
                  <span style={{ color: 'var(--mute)' }}>
                    {' · Marathon '}{fmtSec(ack.mProj)}
                  </span>
                )}
              </span>
            )}
            {ack.planArchived && (
              <span style={{ marginLeft: 8, color: 'var(--mute)' }}>· Plan archived.</span>
            )}
            {ack.nextPlan?.ok && (
              <span style={{ marginLeft: 8, color: 'var(--ink)' }}>
                {`· ${ack.nextPlan.raceName} plan ready`}
                {ack.nextPlan.weeks_generated
                  ? ` (${ack.nextPlan.weeks_generated} weeks${ack.nextPlan.compressed ? ' · compressed' : ''})`
                  : ''}.
              </span>
            )}
            {ack.nextPlan && !ack.nextPlan.ok && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--over)' }}>
                {`${ack.nextPlan.raceName || ack.nextPlan.raceSlug || 'Next'} plan generation failed.`}
                {ack.nextPlan.reason ? ` ${ack.nextPlan.reason}` : ''}
                {ack.nextPlan.raceSlug && (
                  <>{' '}<a href={`/races/${ack.nextPlan.raceSlug}`} style={{ color: 'var(--over)', textDecoration: 'underline' }}>Open race to retry.</a></>
                )}
              </div>
            )}
          </div>
        )}
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
    background: 'var(--card-2)', border: '1px solid var(--line)', borderRadius: 8,
    color: 'var(--ink)', fontFamily: 'var(--f-body)', fontSize: 14, padding: '8px 12px', width: '100%',
  };
}
