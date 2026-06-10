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
 *   quality (threshold/tempo/intervals): ON TARGET / GRINDED IT OUT / COULDN'T HOLD
 *   easy / shakeout:                     CHATTY EASY / CONTROLLED, NOT CHATTY / HAD TO PUSH
 *   long:                                STRONG THROUGHOUT / FADED LATE / HIT THE WALL
 *   race:                                GOAL MET / ON GOAL / MISSED GOAL
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
  const [niggle, setNiggle] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // P-CHECKIN-REPLY 2026-05-27: slim inline reply from the coach,
  // returned by POST /api/checkin. Renders below the chips in place
  // of the old generic green "Got it" stub.
  const [coachReply, setCoachReply] = useState<string | null>(null);

  // Recovery / shakeout sub-types skip the execution row.
  const showExec = kind !== 'recovery';
  // P-OPTION-C 2026-05-27: text or chips both count as a valid check-in.
  // The text field is the primary input — if the runner wrote anything,
  // we have enough to send. Chips become a quick-tap option but no
  // longer mandatory.
  const hasText = niggle.trim().length > 0;
  const hasChips = (showExec ? exec != null : true) && body != null;
  const canSubmit = (hasText || hasChips) && !sending;

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
      const payload = await r.json().catch(() => ({}));
      setCoachReply(payload?.coach_reply ?? null);
      setSent(true);
      // P-CHECKIN-REPLY 2026-05-27: intentionally NOT calling onSubmitted.
      // The old contract was "tell the parent to router.refresh and
      // regenerate the whole brief," which felt like a reset. The new
      // contract is: the reply renders inline, the brief stays as-is,
      // and the next natural regen (day rollover / run ingest) folds
      // the check-in in normally.
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
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: 'var(--f-label)', fontSize: 10, fontWeight: 700,
          letterSpacing: '1.4px', color: 'var(--green)',
        }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M2 5.5l2.5 2.5L9 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          COACH HEARD YOU
        </div>
        {coachReply ? (
          <p style={{
            margin: 0,
            fontFamily: 'var(--f-body)', fontSize: 14, lineHeight: 1.55,
            color: 'var(--ink)',
          }}>
            {coachReply}
          </p>
        ) : (
          <p style={{
            margin: 0,
            fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--green)',
          }}>
            Got it. Coach will fold this into tomorrow's brief.
          </p>
        )}
      </div>
    );
  }

  const execOptions = executionOptionsFor(kind);

  // P-OPTION-C 2026-05-27 — text field is now the primary input. The
  // chips drop to a "quick tap" secondary row. Either or both will
  // submit; runner can just talk to the coach.
  return (
    <div style={{ padding: '12px 0' }}>
      {/* PRIMARY: free-text field */}
      <div style={{
        fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--ink)',
        marginBottom: 8, fontWeight: 600,
      }}>
        How'd the run go?
      </div>
      <textarea
        value={niggle}
        onChange={(e) => setNiggle(e.target.value)}
        rows={3}
        style={{
          width: '100%',
          background: 'var(--card-2)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          padding: '12px 14px',
          color: 'var(--ink)',
          fontFamily: 'var(--f-body)', fontSize: 14, lineHeight: 1.5,
          resize: 'vertical', outline: 'none',
          marginBottom: 14,
        }}
      />

      {/* SECONDARY: quick-tap chips. Collapsed by default — runner can
          expand if they want to tap instead of type. */}
      <details style={{ marginBottom: 8 }}>
        <summary style={{
          cursor: 'pointer',
          fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)',
          letterSpacing: '0.4px',
          padding: '4px 0',
          listStyle: 'none',
          userSelect: 'none',
        }}>
          + quick tap instead
        </summary>
        <div style={{ marginTop: 10 }}>
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
          <div style={{ marginBottom: 4 }}>
            <ChipRowLabel>LEGS NOW</ChipRowLabel>
            <ChipRow>
              <Chip active={body === 'fresh'}  onClick={() => setBody('fresh')}  tone="green">FRESH</Chip>
              <Chip active={body === 'worked'} onClick={() => setBody('worked')} tone="goal">WORKED</Chip>
              <Chip active={body === 'cooked'} onClick={() => setBody('cooked')} tone="over">COOKED</Chip>
            </ChipRow>
          </div>
        </div>
      </details>

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
          background: canSubmit ? 'var(--green)' : 'var(--card-2)',
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
        // AFC fix 8 · "NAILED IT" → disciplined register per the task
        // brief's own example ("YOU NAILED IT" → "ON GOAL"). Wire value
        // 'nailed' unchanged · backend enum.
        { value: 'nailed',  label: 'ON TARGET',       tone: 'green' },
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
      // AFC fix 8 · "CRUSHED" violated the voice contract (no hype).
      // The wire value `crushed_goal` is a backend enum read by
      // /api/checkin + canned replies · label-only change here.
      return [
        { value: 'crushed_goal', label: 'GOAL MET',    tone: 'green' },
        { value: 'on_goal',      label: 'ON GOAL',     tone: 'goal' },
        { value: 'missed_goal',  label: 'MISSED GOAL', tone: 'over' },
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
        background: active ? colorVar : 'var(--card-2)',
        color: active ? '#0e1014' : 'var(--ink)',
        border: `1px solid ${active ? colorVar : 'var(--line)'}`,
        borderRadius: 8,
        padding: '8px 12px',
        fontFamily: 'var(--f-label)', fontSize: 10,
        fontWeight: 700, letterSpacing: '1.1px',
        cursor: 'pointer',
        transition: 'background .12s, border-color .12s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--card)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--card-2)';
      }}
    >
      {children}
    </button>
  );
}
