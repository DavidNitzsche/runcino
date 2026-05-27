'use client';

/**
 * PostRunCheckinChips (#150) — replaces SOLID/TIRED/WRECKED.
 *
 * Two axes the coach actually needs to prescribe tomorrow well:
 *   1. EXECUTION — did the workout hit its targets (varies by workout type)
 *   2. BODY      — how are the legs/lungs right now (universal)
 *
 * Plus an optional NIGGLE field for pain/tightness — catches overuse onset
 * that RPE alone misses (~60% per the research).
 *
 * On submit:
 *   POST /api/checkin with body { execution, body, niggle?, runId?, workoutType }
 *   → cache-bust briefing
 *   → coach reads on next render
 *
 * Workout-type-aware chip sets per the design locked with David:
 *   quality (threshold/tempo/intervals): NAILED IT / GRINDED IT OUT / COULDN'T HOLD
 *   easy / shakeout:                     CHATTY EASY / CONTROLLED, NOT CHATTY / HAD TO PUSH
 *   long:                                STRONG THROUGHOUT / FADED LATE / HIT THE WALL
 *   race:                                CRUSHED GOAL / ON GOAL / MISSED GOAL
 *   recovery (no exec target):           skip Row 1 entirely
 *
 * Body row is the same on every workout type.
 */
import { useState } from 'react';

export type Execution =
  | 'nailed' | 'grinded' | 'missed'        // quality
  | 'chatty' | 'controlled' | 'pushed'     // easy
  | 'strong' | 'faded' | 'walled'          // long
  | 'crushed_goal' | 'on_goal' | 'missed_goal'; // race

export type BodyState = 'fresh' | 'worked' | 'cooked';

export type WorkoutKind =
  | 'quality' | 'easy' | 'long' | 'race' | 'recovery';

interface Props {
  workoutType?: string | null;    // raw type from plan_workout
  runId?: string | null;
  onSubmitted?: () => void;
  /** Hide the niggle row if the coach already knows about a niggle today. */
  hideNiggle?: boolean;
}

export function PostRunCheckinChips({
  workoutType, runId, onSubmitted, hideNiggle = false,
}: Props) {
  const kind = classify(workoutType);
  const [exec, setExec] = useState<Execution | null>(null);
  const [body, setBody] = useState<BodyState | null>(null);
  const [niggleOpen, setNiggleOpen] = useState(false);
  const [niggle, setNiggle] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recovery / shakeout sub-types skip the execution row.
  const showExec = kind !== 'recovery';
  const canSubmit = (showExec ? exec != null : true) && body != null && !sending;

  async function submit() {
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'post_run',
          workout_kind: kind,
          execution: exec,
          body,
          niggle: niggle.trim() || null,
          run_id: runId ?? null,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSent(true);
      onSubmitted?.();
    } catch (e: any) {
      setError(e?.message ?? 'check-in failed');
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div style={{
        padding: '14px 16px', borderRadius: 12,
        background: 'rgba(62,189,65,0.08)', border: '1px solid rgba(62,189,65,0.22)',
        fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--green)',
      }}>
        Got it — coach will fold this into the next briefing.
      </div>
    );
  }

  const execOptions = executionOptionsFor(kind);
  const prompt = promptFor(kind);

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{
        fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)',
        marginBottom: 12,
      }}>
        {prompt}
      </div>

      {/* Row 1: EXECUTION (skipped for recovery) */}
      {showExec && execOptions && (
        <div style={{ marginBottom: 10 }}>
          <ChipRowLabel>EXECUTION</ChipRowLabel>
          <ChipRow>
            {execOptions.map((opt) => (
              <Chip
                key={opt.value}
                active={exec === opt.value}
                onClick={() => setExec(opt.value)}
                tone={opt.tone}
              >
                {opt.label}
              </Chip>
            ))}
          </ChipRow>
        </div>
      )}

      {/* Row 2: BODY (universal) */}
      <div style={{ marginBottom: 10 }}>
        <ChipRowLabel>LEGS NOW</ChipRowLabel>
        <ChipRow>
          <Chip active={body === 'fresh'}  onClick={() => setBody('fresh')}  tone="green">FRESH</Chip>
          <Chip active={body === 'worked'} onClick={() => setBody('worked')} tone="goal">WORKED</Chip>
          <Chip active={body === 'cooked'} onClick={() => setBody('cooked')} tone="over">COOKED</Chip>
        </ChipRow>
      </div>

      {/* Niggle toggle + optional input */}
      {!hideNiggle && (
        <div style={{ marginTop: 12 }}>
          {!niggleOpen ? (
            <button
              type="button"
              onClick={() => setNiggleOpen(true)}
              style={{
                background: 'transparent', border: '1px dashed rgba(255,255,255,0.18)',
                color: 'var(--mute)', borderRadius: 8,
                padding: '8px 12px',
                fontFamily: 'var(--f-body)', fontSize: 12,
                cursor: 'pointer',
              }}
            >
              + Anything tight or off?
            </button>
          ) : (
            <div>
              <ChipRowLabel>NIGGLE / PAIN</ChipRowLabel>
              <textarea
                value={niggle}
                onChange={(e) => setNiggle(e.target.value)}
                placeholder="Left calf was tight on the cooldown..."
                rows={2}
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: 'var(--ink)',
                  fontFamily: 'var(--f-body)', fontSize: 13,
                  resize: 'vertical', outline: 'none',
                }}
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 6,
          background: 'rgba(252,77,100,0.08)',
          fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--over)',
        }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        style={{
          marginTop: 14,
          background: canSubmit ? 'var(--green)' : 'rgba(255,255,255,0.08)',
          color: canSubmit ? '#0e1014' : 'var(--mute)',
          border: 'none', borderRadius: 10,
          padding: '10px 18px',
          fontFamily: 'var(--f-label)', fontSize: 11,
          fontWeight: 700, letterSpacing: '1.2px',
          cursor: canSubmit ? 'pointer' : 'default',
        }}
      >
        {sending ? 'Saving…' : 'Send to coach'}
      </button>
    </div>
  );
}

/** Map raw plan_workout type → check-in workout kind. */
function classify(type: string | null | undefined): WorkoutKind {
  const t = (type ?? '').toLowerCase();
  if (['threshold', 'tempo', 'intervals', 'vo2max'].includes(t)) return 'quality';
  if (['long', 'progression'].includes(t)) return 'long';
  if (['race'].includes(t)) return 'race';
  if (['easy', 'shakeout'].includes(t)) return 'easy';
  if (['rest', 'recovery'].includes(t)) return 'recovery';
  return 'easy';
}

function executionOptionsFor(kind: WorkoutKind): Array<{ value: Execution; label: string; tone: ChipTone }> | null {
  switch (kind) {
    case 'quality':
      return [
        { value: 'nailed',  label: 'NAILED IT',       tone: 'green' },
        { value: 'grinded', label: 'GRINDED IT OUT',  tone: 'goal' },
        { value: 'missed',  label: "COULDN'T HOLD",   tone: 'over' },
      ];
    case 'easy':
      return [
        { value: 'chatty',     label: 'CHATTY EASY',          tone: 'green' },
        { value: 'controlled', label: 'CONTROLLED, NOT CHATTY', tone: 'goal' },
        { value: 'pushed',     label: 'HAD TO PUSH',          tone: 'over' },
      ];
    case 'long':
      return [
        { value: 'strong', label: 'STRONG THROUGHOUT', tone: 'green' },
        { value: 'faded',  label: 'FADED LATE',         tone: 'goal' },
        { value: 'walled', label: 'HIT THE WALL',       tone: 'over' },
      ];
    case 'race':
      return [
        { value: 'crushed_goal', label: 'CRUSHED GOAL', tone: 'green' },
        { value: 'on_goal',      label: 'ON GOAL',      tone: 'goal' },
        { value: 'missed_goal',  label: 'MISSED GOAL',  tone: 'over' },
      ];
    case 'recovery':
      return null;
  }
}

function promptFor(kind: WorkoutKind): string {
  switch (kind) {
    case 'quality':  return 'How did the workout land vs target?';
    case 'easy':     return 'How did the easy effort feel?';
    case 'long':     return 'How did the back half feel?';
    case 'race':     return 'How did the race finish vs your plan?';
    case 'recovery': return 'How are you sitting after the day off?';
  }
}

// ── Presentational helpers ────────────────────────────────────────────

type ChipTone = 'green' | 'goal' | 'over' | 'mute';

function ChipRowLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="card-eyebrow" style={{ color: 'var(--mute)', marginBottom: 6 }}>
      {children}
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {children}
    </div>
  );
}

function Chip({ active, onClick, tone, children }: {
  active: boolean;
  onClick: () => void;
  tone: ChipTone;
  children: React.ReactNode;
}) {
  const colorVar = `var(--${tone === 'mute' ? 'mute' : tone})`;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? colorVar : 'rgba(255,255,255,0.04)',
        color: active ? '#0e1014' : 'var(--ink)',
        border: `1px solid ${active ? colorVar : 'rgba(255,255,255,0.10)'}`,
        borderRadius: 8,
        padding: '8px 12px',
        fontFamily: 'var(--f-label)', fontSize: 10,
        fontWeight: 700, letterSpacing: '1.1px',
        cursor: 'pointer',
        transition: 'background .12s, border-color .12s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
      }}
    >
      {children}
    </button>
  );
}
