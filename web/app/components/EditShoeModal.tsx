/**
 * EditShoeModal — single modal for the shoe rotation card.
 *
 *   shoeId === null  → create flow ("ADD" eyebrow, POST /api/shoes)
 *   shoeId !== null  → edit flow  ("EDIT" eyebrow, PUT /api/shoes/[id])
 *
 * The Retire button in the footer hits DELETE /api/shoes/[id] (soft
 * delete — see the route). Hard-deleting would orphan the
 * strava_activities.shoe_id FK.
 *
 * Mirrors EditProfileModal's visual pattern (wide modal, numbered
 * fields, split footer with secondary/primary actions).
 */

'use client';

import { useEffect, useState } from 'react';
import {
  ModalOverlay,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from './Modal';
import type { RunType, Shoe } from '@/lib/shoe-utils';

const RUN_TYPES: { value: RunType; label: string; hint: string }[] = [
  { value: 'easy',      label: 'Easy',      hint: 'Daily trainer' },
  { value: 'long',      label: 'Long',      hint: 'Long-run cushion' },
  { value: 'recovery',  label: 'Recovery',  hint: 'Max stack, low effort' },
  { value: 'tempo',     label: 'Tempo',     hint: 'Threshold work' },
  { value: 'intervals', label: 'Intervals', hint: 'Track / repeats' },
  { value: 'race',      label: 'Race',      hint: 'Race-day super shoe' },
  { value: 'as_needed', label: 'As needed', hint: 'Fallback rotation' },
];

export interface EditShoeModalProps {
  open: boolean;
  /** null = add flow; populated row = edit flow. */
  initialShoe: Shoe | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EditShoeModal({ open, initialShoe, onClose, onSaved }: EditShoeModalProps) {
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [mileage, setMileage] = useState('');
  const [cap, setCap] = useState('');
  const [runTypes, setRunTypes] = useState<RunType[]>([]);
  const [preferred, setPreferred] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = initialShoe != null;

  // Re-hydrate every time the dialog opens. Resets to empty for the
  // add flow so the form doesn't flash stale values from a prior edit.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    if (initialShoe) {
      setBrand(initialShoe.brand);
      setModel(initialShoe.model);
      setColor(initialShoe.color ?? '');
      setMileage(String(Math.round(initialShoe.mileage)));
      setCap(initialShoe.mileage_cap != null ? String(Math.round(initialShoe.mileage_cap)) : '');
      setRunTypes(initialShoe.run_types);
      setPreferred(initialShoe.preferred);
    } else {
      setBrand('');
      setModel('');
      setColor('');
      setMileage('0');
      setCap('400');
      setRunTypes([]);
      setPreferred(true);
    }
  }, [open, initialShoe]);

  if (!open) return null;

  function toggleRunType(t: RunType) {
    setRunTypes((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);
  }

  async function save() {
    setError(null);
    if (!brand.trim()) { setError('Brand is required.'); return; }
    if (!model.trim()) { setError('Model is required.'); return; }
    if (runTypes.length === 0) {
      setError('Pick at least one purpose.');
      return;
    }
    const mileageNum = Number(mileage || '0');
    if (!Number.isFinite(mileageNum) || mileageNum < 0 || mileageNum > 5000) {
      setError('Mileage must be between 0 and 5000.');
      return;
    }
    let capNum: number | null = null;
    if (cap.trim()) {
      const n = Number(cap);
      if (!Number.isFinite(n) || n < 50 || n > 2000) {
        setError('Cap must be between 50 and 2000 miles.');
        return;
      }
      capNum = n;
    }

    setBusy(true);
    try {
      const body = {
        brand: brand.trim(),
        model: model.trim(),
        color: color.trim() || null,
        run_types: runTypes,
        mileage: mileageNum,
        mileage_cap: capNum,
        preferred,
      };
      const res = isEdit
        ? await fetch(`/api/shoes/${initialShoe!.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/shoes', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
      const json = (await res.json()) as { shoe?: Shoe; error?: string };
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function retire() {
    if (!isEdit) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/shoes/${initialShoe!.id}`, { method: 'DELETE' });
      const json = (await res.json()) as { shoe?: Shoe; error?: string };
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const eyebrow = isEdit ? 'EDIT' : 'ADD';
  const titleText = isEdit ? 'Shoe' : 'New shoe';
  const submitLabel = isEdit ? 'Save changes' : 'Add shoe';

  return (
    <ModalOverlay onClose={busy ? undefined : onClose}>
      <Modal size="wide">
        <ModalHeader
          eyebrow={eyebrow}
          title={titleText}
          onClose={busy ? undefined : onClose}
        />
        <ModalBody>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="field">
              <label className="field-label">1 · Brand</label>
              <input
                className="rc-input"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Asics"
                maxLength={60}
              />
            </div>
            <div className="field">
              <label className="field-label">2 · Model</label>
              <input
                className="rc-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. Superblast 3"
                maxLength={80}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label">3 · Color (optional)</label>
            <input
              className="rc-input"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="e.g. White"
              maxLength={40}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="field">
              <label className="field-label">4 · Current mileage</label>
              <div className="input-with-unit">
                <input
                  className="rc-input num"
                  type="number"
                  min={0}
                  max={5000}
                  value={mileage}
                  onChange={(e) => setMileage(e.target.value)}
                  placeholder="0"
                />
                <span className="unit">MI</span>
              </div>
              <div className="field-help">Strava auto-adds miles after runs are tagged to this shoe.</div>
            </div>
            <div className="field">
              <label className="field-label">5 · Mileage cap</label>
              <div className="input-with-unit">
                <input
                  className="rc-input num"
                  type="number"
                  min={50}
                  max={2000}
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                  placeholder="400"
                />
                <span className="unit">MI</span>
              </div>
              <div className="field-help">Cap drives the retire pin. Empty defaults to 400.</div>
            </div>
          </div>

          <div className="field">
            <label className="field-label">6 · Purposes <span style={{ color: 'var(--t3)', fontWeight: 400 }}>(pick all that apply)</span></label>
            <div className="chip-group" style={{ gap: 8, flexWrap: 'wrap' }}>
              {RUN_TYPES.map((t) => {
                const active = runTypes.includes(t.value);
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => toggleRunType(t.value)}
                    className={`chip-pick${active ? ' active' : ''}`}
                    title={t.hint}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div className="field-help">Coach matches each run type to the first shoe in the rotation that handles it.</div>
          </div>

          <div className="field">
            <label className="field-label">7 · Rotation</label>
            <div className="chip-group" style={{ gap: 8 }}>
              <button
                type="button"
                onClick={() => setPreferred(true)}
                className={`chip-pick${preferred ? ' active' : ''}`}
              >
                In rotation
              </button>
              <button
                type="button"
                onClick={() => setPreferred(false)}
                className={`chip-pick${!preferred ? ' active' : ''}`}
              >
                Backup
              </button>
            </div>
            <div className="field-help">Backup shoes drop to the bottom of the recommendation list.</div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isEdit && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={retire}
                disabled={busy}
                style={{ color: 'var(--warn)', borderColor: 'rgba(252,77,84,.3)' }}
                title="Retires the shoe so the Coach stops recommending it. History stays intact."
              >Retire shoe</button>
            )}
          </div>
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
            >{busy ? 'Saving…' : submitLabel}</button>
          </div>
        </ModalFooter>
      </Modal>
    </ModalOverlay>
  );
}
