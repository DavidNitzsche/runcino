'use client';

/**
 * Faff Toolkit · Family F · Entry Sheets
 *
 *   ManualHealthSheet · sleep/HRV/RHR/weight + manual measurement entry.
 *                       Lives behind a "+ ADD MEASUREMENT" pill on Health.
 *                       POSTs to /api/health/manual. Closes line 1352.
 *   NewGoalSheet      · personal_goals create form. Lives behind a "+ NEW
 *                       GOAL" pill on Targets. POSTs to /api/goals.
 *                       Closes line 1830 (cross-cutting personal goals).
 *   LogNonRunSheet    · Strength | Cross toggle, modality + duration.
 *                       POSTs to /api/strength or /api/cross-training
 *                       depending on toggle. Closes lines 1847 + 1863.
 *   SymptomReportSheet · UI shell only. Wire-up to /api/niggle and
 *                       /api/sick exists, but the follow-up loop
 *                       (escalation to /api/injuries) is blocked per
 *                       README §"Blocked components" — do NOT wire the
 *                       injury escalation today.
 *   ReturnGateCard    · post-sick "ready to run?" return gate. Closes
 *                       line 264 (sick recovery).
 *
 * All sheets share the .fa-sheet shell. Caller is in charge of mounting
 * + presenting (drawer, modal, inline expander).
 */
import { useState } from 'react';
import { FaError } from './atoms';

interface SheetShellProps {
  title: string;
  subtitle?: string;
  onClose?: () => void;
  children: React.ReactNode;
}

function SheetShell({ title, subtitle, onClose, children }: SheetShellProps) {
  return (
    <div className="fa-sheet" role="dialog" aria-label={title}>
      <div className="grab">
        <span className="bar" />
      </div>
      <div className="hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="t">{title}</div>
          {subtitle ? <div className="s">{subtitle}</div> : null}
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 0,
              color: 'var(--fa-mute)',
              cursor: 'pointer',
              fontSize: 20,
              padding: '4px 8px',
              marginRight: -4,
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="bd">{children}</div>
    </div>
  );
}

/* ============================================================
   ManualHealthSheet
   ============================================================ */
const MANUAL_HEALTH_TYPES: Array<{ key: string; label: string; placeholder: string; min: number; max: number; }> = [
  { key: 'sleep_hours', label: 'Sleep (hrs)', placeholder: '7.5', min: 0, max: 16 },
  { key: 'hrv', label: 'HRV (ms)', placeholder: '52', min: 0, max: 200 },
  { key: 'resting_hr', label: 'Resting HR (bpm)', placeholder: '46', min: 25, max: 110 },
  { key: 'body_mass', label: 'Weight (kg)', placeholder: '70', min: 30, max: 200 },
  { key: 'hr_recovery', label: 'HR recovery (bpm)', placeholder: '28', min: 0, max: 80 },
  { key: 'vo2_max', label: 'VO₂max', placeholder: '52', min: 20, max: 90 },
];

export function ManualHealthSheet({
  date,
  onSaved,
  onClose,
}: {
  date?: string;
  onSaved?: () => void;
  onClose?: () => void;
}) {
  const [sampleType, setSampleType] = useState(MANUAL_HEALTH_TYPES[0].key);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const def = MANUAL_HEALTH_TYPES.find((t) => t.key === sampleType)!;

  async function submit() {
    const num = parseFloat(value);
    if (Number.isNaN(num)) { setErr('Enter a number.'); return; }
    if (num < def.min || num > def.max) { setErr(`Out of range · expected ${def.min}–${def.max}.`); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/health/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sample_type: sampleType,
          value: num,
          sample_date: date,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setValue('');
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetShell title="Log measurement" subtitle="Manual entry · saved to your health timeline" onClose={onClose}>
      <div className="fa-field">
        <label>Metric</label>
        <div className="fa-pickrow">
          {MANUAL_HEALTH_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`opt${sampleType === t.key ? ' sel' : ''}`}
              onClick={() => { setSampleType(t.key); setValue(''); setErr(null); }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="fa-field">
        <label>Value</label>
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => { setValue(e.target.value); setErr(null); }}
          placeholder={def.placeholder}
          style={{
            width: '100%',
            background: 'rgba(13,16,22,.36)',
            border: '1px solid var(--glass-line)',
            borderRadius: 'var(--r-chip)',
            padding: '12px 14px',
            color: 'var(--txt)',
            fontFamily: 'var(--font-display)',
            fontSize: 18,
          }}
        />
      </div>
      {err ? <FaError text={err} /> : null}
      <button type="button" className="fa-submit" onClick={submit} disabled={busy || !value}>
        {busy ? 'Saving…' : 'Save measurement'}
      </button>
      {onClose ? (
        <button type="button" className="fa-skip" onClick={onClose}>
          Cancel
        </button>
      ) : null}
    </SheetShell>
  );
}

/* ============================================================
   NewGoalSheet · personal_goals create. POSTs to /api/goals.
   ============================================================ */
const GOAL_TYPES = ['volume', 'speed', 'distance', 'habit', 'strength', 'health'] as const;
type GoalType = (typeof GOAL_TYPES)[number];

export function NewGoalSheet({ onSaved, onClose }: { onSaved?: () => void; onClose?: () => void }) {
  const [goalType, setGoalType] = useState<GoalType>('volume');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!target.trim()) { setErr('Target is required.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal_type: goalType,
          target: target.trim(),
          deadline: deadline || null,
          rationale: rationale.trim() || null,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetShell title="New goal" subtitle="Tell the coach what you want to chase." onClose={onClose}>
      <div className="fa-field">
        <label>Type</label>
        <div className="fa-pickrow">
          {GOAL_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`opt${goalType === t ? ' sel' : ''}`}
              onClick={() => setGoalType(t)}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="fa-field">
        <label>Target</label>
        <input
          type="text"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={goalType === 'volume' ? '40 mi/wk by Aug 31' : goalType === 'speed' ? '19:00 5K' : 'Describe the goal'}
          style={inputStyle}
        />
      </div>
      <div className="fa-field">
        <label>Deadline (optional)</label>
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div className="fa-field">
        <label>Rationale (optional)</label>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="What's the story behind this goal?"
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--font-body)', fontSize: 14 }}
        />
      </div>
      {err ? <FaError text={err} /> : null}
      <button type="button" className="fa-submit" onClick={submit} disabled={busy || !target.trim()}>
        {busy ? 'Saving…' : 'Set goal'}
      </button>
      {onClose ? <button type="button" className="fa-skip" onClick={onClose}>Cancel</button> : null}
    </SheetShell>
  );
}

/* ============================================================
   LogNonRunSheet · Strength / Cross-training combined sheet.
   ============================================================ */
const STRENGTH_TYPES = ['full body', 'upper', 'lower', 'core'];
const CROSS_MODALITIES = ['bike', 'swim', 'hike', 'row', 'ski'];

export function LogNonRunSheet({ onSaved, onClose }: { onSaved?: () => void; onClose?: () => void }) {
  const [mode, setMode] = useState<'strength' | 'cross'>('strength');
  const [subtype, setSubtype] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [durationMin, setDurationMin] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const options = mode === 'strength' ? STRENGTH_TYPES : CROSS_MODALITIES;

  async function submit() {
    if (!subtype) { setErr('Pick a type.'); return; }
    const dur = parseInt(durationMin, 10);
    if (Number.isNaN(dur) || dur <= 0 || dur > 600) { setErr('Enter a duration in minutes.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const endpoint = mode === 'strength' ? '/api/strength' : '/api/cross-training';
      const body = mode === 'strength'
        ? { date, session_type: subtype, duration_min: dur, notes: notes.trim() || null }
        : { date, modality: subtype, duration_min: dur, notes: notes.trim() || null };
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetShell title="Log non-run" subtitle="Strength + cross feed the weekly volume strip." onClose={onClose}>
      <div className="fa-field">
        <label>Type</label>
        <div className="fa-seg">
          <button type="button" className={mode === 'strength' ? 'sel' : ''} onClick={() => { setMode('strength'); setSubtype(null); }}>STRENGTH</button>
          <button type="button" className={mode === 'cross' ? 'sel' : ''} onClick={() => { setMode('cross'); setSubtype(null); }}>CROSS</button>
        </div>
      </div>
      <div className="fa-field">
        <label>{mode === 'strength' ? 'Focus' : 'Modality'}</label>
        <div className="fa-pickrow">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              className={`opt${subtype === o ? ' sel' : ''}`}
              onClick={() => setSubtype(o)}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
      <div className="fa-field" style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Duration (min)</label>
          <input
            type="number"
            inputMode="numeric"
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
            placeholder="45"
            style={inputStyle}
          />
        </div>
      </div>
      <div className="fa-field">
        <label>Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--font-body)', fontSize: 14 }}
        />
      </div>
      {err ? <FaError text={err} /> : null}
      <button type="button" className="fa-submit" onClick={submit} disabled={busy || !subtype || !durationMin}>
        {busy ? 'Saving…' : 'Log session'}
      </button>
      {onClose ? <button type="button" className="fa-skip" onClick={onClose}>Cancel</button> : null}
    </SheetShell>
  );
}

/* ============================================================
   SymptomReportSheet · niggle / sick toggle. Posts to /api/niggle
   or /api/sick depending on the segment. The escalation-to-injury
   loop is intentionally NOT wired (see README §Blocked components ·
   /api/injuries CRUD is missing).
   ============================================================ */
const BODY_PARTS = ['hamstring', 'calf', 'achilles', 'shin', 'knee', 'hip', 'foot', 'glute', 'lower back'];
const SIDES = ['left', 'right', 'both'];

export function SymptomReportSheet({ onSaved, onClose }: { onSaved?: () => void; onClose?: () => void }) {
  const [mode, setMode] = useState<'niggle' | 'sick'>('niggle');
  const [bodyPart, setBodyPart] = useState<string | null>(null);
  const [side, setSide] = useState<string | null>(null);
  const [severity, setSeverity] = useState<number | null>(null);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [fever, setFever] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleSymptom(s: string) {
    setSymptoms((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'niggle') {
        if (!bodyPart || !severity) { setErr('Body part + severity required.'); setBusy(false); return; }
        const r = await fetch('/api/niggle', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body_part: bodyPart, side, severity }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // Doctrine escalation · Research/05 "pain ≥4/10 stops the
        // session." Severity ≥7 (major bucket) ALSO writes a runner_injuries
        // row so the adaptation engine flips into INJURY mode and the
        // walk-run scaffold can fire. Best-effort: niggle save already
        // succeeded, escalation failure is non-fatal.
        if (severity >= 7) {
          fetch('/api/injuries', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              body_part: bodyPart,
              side,
              severity, // 1-10 scale, the backend maps to {minor,moderate,major}
            }),
          }).catch(() => { /* silent */ });
        }
      } else {
        if (symptoms.length === 0) { setErr('Pick at least one symptom.'); setBusy(false); return; }
        const r = await fetch('/api/sick', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ symptoms, fever, started_date: new Date().toISOString().slice(0, 10) }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      }
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetShell
      title={mode === 'niggle' ? 'Report niggle' : 'Report sick day'}
      subtitle="The coach softens the plan around what you're carrying."
      onClose={onClose}
    >
      <div className="fa-field">
        <div className="fa-seg">
          <button type="button" className={mode === 'niggle' ? 'sel' : ''} onClick={() => setMode('niggle')}>NIGGLE</button>
          <button type="button" className={mode === 'sick' ? 'sel' : ''} onClick={() => setMode('sick')}>SICK</button>
        </div>
      </div>

      {mode === 'niggle' ? (
        <>
          <div className="fa-field">
            <label>Body part</label>
            <div className="fa-pickrow">
              {BODY_PARTS.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`opt${bodyPart === b ? ' sel' : ''}`}
                  onClick={() => setBodyPart(b)}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
          <div className="fa-field">
            <label>Side</label>
            <div className="fa-pickrow">
              {SIDES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`opt${side === s ? ' sel' : ''}`}
                  onClick={() => setSide(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="fa-field">
            <label>Severity · 1 mild · 10 stops you</label>
            <div className="fa-scale">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <span
                  key={n}
                  className={`n${severity === n ? ' sel' : ''}`}
                  onClick={() => setSeverity(n)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') setSeverity(n); }}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="fa-field">
            <label>Symptoms (multi)</label>
            <div className="fa-pickrow">
              {['sore throat', 'cough', 'fatigue', 'congestion', 'body aches', 'nausea'].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`opt${symptoms.includes(s) ? ' sel' : ''}`}
                  onClick={() => toggleSymptom(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="fa-field" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              role="switch"
              aria-checked={fever}
              className="fa-switch"
              onClick={() => setFever(!fever)}
              aria-label="Fever toggle"
            />
            <label style={{ marginBottom: 0, color: 'var(--txt)', fontWeight: 600 }}>Fever above 100°F</label>
          </div>
        </>
      )}

      {err ? <FaError text={err} /> : null}
      <button type="button" className="fa-submit" onClick={submit} disabled={busy}>
        {busy ? 'Saving…' : 'Submit'}
      </button>
      {onClose ? <button type="button" className="fa-skip" onClick={onClose}>Cancel</button> : null}
    </SheetShell>
  );
}

/* ============================================================
   ReturnGateCard · sick recovery "ready to run?" prompt.
   ============================================================ */
export function ReturnGateCard({
  title = 'Ready to run?',
  body = 'Faff paused your plan while you were sick. When you feel back to baseline, tell the coach so we can resume.',
  ctaLabel = 'I FEEL BETTER',
  onConfirm,
}: {
  title?: string;
  body?: string;
  ctaLabel?: string;
  onConfirm?: () => void;
}) {
  return (
    <div className="fa-gate">
      <div className="t">{title}</div>
      <div className="s">{body}</div>
      <button
        type="button"
        className="fa-submit"
        style={{ marginTop: 14, background: 'var(--rest, var(--dist))' }}
        onClick={onConfirm}
      >
        {ctaLabel}
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(13,16,22,.36)',
  border: '1px solid var(--glass-line)',
  borderRadius: 'var(--r-chip)',
  padding: '12px 14px',
  color: 'var(--txt)',
  fontFamily: 'var(--font-display)',
  fontSize: 16,
};
