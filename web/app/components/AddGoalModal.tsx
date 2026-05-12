/**
 * AddGoalModal — wires the +ADD GOAL button on /profile.
 *
 * Implements the canonical pattern from designs/_template-action-2026-05-09.html:
 * wide modal · ADD eyebrow · "Personal Goal" title · 1-Goal type chip group ·
 * 2-Target (type-specific input) · 3-By when + Tolerance · optional rationale ·
 * Coach-impact preview · split footer with Coach meta + Cancel/Add buttons.
 *
 * POSTs to /api/goals on submit. On success, calls onSaved so /profile can
 * refresh its goal list.
 */

'use client';

import { useState, useEffect } from 'react';
import {
  ModalOverlay,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from './Modal';

const GOAL_TYPES = [
  { id: 'volume',   label: 'VOLUME',   help: "Coach ramps your weekly mileage toward a target. Plan respects this when scheduling weeks." },
  { id: 'speed',    label: 'SPEED',    help: "Coach adds threshold + race-pace work earlier in builds and gates quality at goal-pace targets." },
  { id: 'distance', label: 'DISTANCE', help: "Coach builds durability with back-to-back long runs ahead of the target distance." },
  { id: 'habit',    label: 'HABIT',    help: "Coach holds run frequency at a target floor — never below it for adherence streaks." },
  { id: 'strength', label: 'STRENGTH', help: "Coach gates running quality on strength absorption — caps stacking and protects squat days." },
  { id: 'health',   label: 'HEALTH',   help: "Coach prioritizes sleep + HRV recovery, dialing quality back when health metrics flag." },
] as const;

const TOLERANCES = [
  { id: 'aggressive', label: 'Aggressive · 12%/wk ramp' },
  { id: 'standard',   label: 'Standard · 10%/wk ramp' },
  { id: 'conservative', label: 'Conservative · 8%/wk ramp' },
] as const;

const TYPE_PROMPTS: Record<typeof GOAL_TYPES[number]['id'], { label: string; placeholder: string; unit: string }> = {
  volume:   { label: 'Target weekly mileage', placeholder: '45',        unit: 'MI / WK' },
  speed:    { label: 'Target race time',      placeholder: '1:29:00',   unit: 'TIME' },
  distance: { label: 'Target distance',       placeholder: '31',        unit: 'MI' },
  habit:    { label: 'Target runs per week',  placeholder: '5',         unit: 'RUNS / WK' },
  strength: { label: 'Target strength days',  placeholder: '3',         unit: 'DAYS / WK' },
  health:   { label: 'Sleep floor',           placeholder: '7.0',       unit: 'HRS / NIGHT' },
};

export interface AddGoalModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function AddGoalModal({ open, onClose, onSaved }: AddGoalModalProps) {
  const [goalType, setGoalType] = useState<typeof GOAL_TYPES[number]['id']>('volume');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [tolerance, setTolerance] = useState<typeof TOLERANCES[number]['id']>('standard');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when the dialog reopens
  useEffect(() => {
    if (open) {
      setGoalType('volume');
      setTarget('');
      setDeadline('');
      setTolerance('standard');
      setRationale('');
      setBusy(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const typePrompt = TYPE_PROMPTS[goalType];
  const typeMeta = GOAL_TYPES.find((g) => g.id === goalType)!;

  async function save() {
    setError(null);
    if (!target.trim()) {
      setError('Target is required.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal_type: goalType,
          target: target.trim(),
          deadline: deadline || null,
          tolerance,
          rationale: rationale.trim() || null,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onClose}>
      <Modal size="wide">
        <ModalHeader
          eyebrow="ADD"
          title="Personal Goal"
          onClose={busy ? undefined : onClose}
        />
        <ModalBody>
          <div className="field">
            <label className="field-label">1 · Goal type</label>
            <div className="chip-group" style={{ gap: 8 }}>
              {GOAL_TYPES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGoalType(g.id)}
                  className={`chip-pick${goalType === g.id ? ' active' : ''}`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <div className="field-help">{typeMeta.help}</div>
          </div>

          <div className="field">
            <label className="field-label">2 · {typePrompt.label}</label>
            <div className="input-with-unit">
              <input
                className="rc-input num"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={typePrompt.placeholder}
              />
              <span className="unit">{typePrompt.unit}</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="field">
              <label className="field-label">3 · By when (optional)</label>
              <input
                className="rc-input num"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
              <div className="field-help">Deadline drives Coach&apos;s ramp pacing.</div>
            </div>
            <div className="field">
              <label className="field-label">Tolerance</label>
              <select
                className="rc-select"
                value={tolerance}
                onChange={(e) => setTolerance(e.target.value as typeof TOLERANCES[number]['id'])}
              >
                {TOLERANCES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
              <div className="field-help">How fast Coach pushes the cap.</div>
            </div>
          </div>

          <div className="field">
            <label className="field-label">Why this matters (optional)</label>
            <textarea
              className="rc-textarea"
              placeholder="Helps you remember the why during hard blocks."
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
            />
          </div>

          <div style={{
            padding: '14px 16px',
            background: 'rgba(39,180,224,.06)',
            border: '1px solid rgba(39,180,224,.20)',
            borderRadius: 8,
            marginTop: 4,
          }}>
            <div className="t-eyebrow" style={{ color: 'var(--coach)' }}>▸ HOW THE COACH WILL USE THIS GOAL</div>
            <div className="t-body" style={{ color: 'var(--t1)', marginTop: 8, lineHeight: 1.55 }}>
              {typeMeta.help}
            </div>
          </div>

          {error && (
            <div style={{
              color: 'var(--warn)', fontSize: 12, padding: 10,
              background: 'rgba(252,77,84,.08)',
              border: '1px solid rgba(252,77,84,.3)',
              borderRadius: 8,
              marginTop: 6,
            }}>
              {error}
            </div>
          )}
        </ModalBody>
        <ModalFooter split>
          <div className="foot-meta">▸ Coach will start applying this immediately</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={busy}
            >Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={busy}
            >{busy ? 'Saving…' : 'Add goal'}</button>
          </div>
        </ModalFooter>
      </Modal>
    </ModalOverlay>
  );
}
