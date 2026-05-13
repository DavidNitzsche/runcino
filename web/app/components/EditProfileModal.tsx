/**
 * EditProfileModal — wires the + ADD YOUR INFO / EDIT button on the
 * IdentityHeroCard.
 *
 * Same modal handles both create and edit:
 *   - profile === null  → empty fields, eyebrow "ADD"
 *   - profile === row   → pre-filled, eyebrow "EDIT"
 *
 * Visual pattern mirrors AddGoalModal (designs/_template-edit / _template-action):
 * wide modal · eyebrow · title · numbered field labels · segmented sex
 * control · Coach-impact preview · split footer with Cancel / Save.
 *
 * POSTs to /api/profile/edit on submit. On success, calls onSaved so
 * the page can reload and re-run getProfile() → HR zones / narrative /
 * watching strip all pick up the new identity.
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
import { VALID_SEX, type ProfileRow } from '@/lib/profile-types';

export interface EditProfileModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function EditProfileModal({ open, onClose, onSaved }: EditProfileModalProps) {
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<typeof VALID_SEX[number]>('Prefer not to say');
  const [city, setCity] = useState('');
  const [hrmax, setHrmax] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = profile != null;

  // Hydrate state every time the dialog reopens.
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setError(null);
    setBusy(false);
    // Reset to empties immediately so the form doesn't flash stale values.
    setProfile(null);
    setFullName('');
    setAge('');
    setSex('Prefer not to say');
    setCity('');
    setHrmax('');

    fetch('/api/profile/edit', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json: { ok: boolean; profile: ProfileRow | null; error?: string }) => {
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error || 'Failed to load profile.');
          return;
        }
        const p = json.profile;
        setProfile(p);
        if (p) {
          setFullName(p.full_name ?? '');
          setAge(p.age != null ? String(p.age) : '');
          const profileSex = p.sex && (VALID_SEX as readonly string[]).includes(p.sex)
            ? (p.sex as typeof VALID_SEX[number])
            : 'Prefer not to say';
          setSex(profileSex);
          setCity(p.city ?? '');
          setHrmax(p.hrmax != null ? String(p.hrmax) : '');
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  async function save() {
    setError(null);
    // Client-side validation mirrors saveProfile() so we don't even
    // hit the API on obvious mistakes.
    if (!fullName.trim()) {
      setError('Name is required.');
      return;
    }
    const ageNum = Number(age);
    if (!Number.isFinite(ageNum) || ageNum < 10 || ageNum > 100) {
      setError('Age is required (10–100).');
      return;
    }
    if (hrmax.trim()) {
      const hr = Number(hrmax);
      if (!Number.isFinite(hr) || hr < 100 || hr > 250) {
        setError('Max HR must be between 100 and 250 bpm.');
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch('/api/profile/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          age: ageNum,
          sex,
          city: city.trim() || null,
          hrmax: hrmax.trim() ? Number(hrmax) : null,
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

  const eyebrow = isEdit ? 'EDIT' : 'ADD';
  const titleText = isEdit ? 'Your Profile' : 'Your Profile';
  const submitLabel = isEdit ? 'Save changes' : 'Save profile';

  return (
    <ModalOverlay onClose={busy ? undefined : onClose}>
      <Modal size="wide">
        <ModalHeader
          eyebrow={eyebrow}
          title={titleText}
          onClose={busy ? undefined : onClose}
        />
        <ModalBody>
          <div className="field">
            <label className="field-label">1 · Name</label>
            <input
              className="rc-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Alex Rivera"
              maxLength={120}
            />
            <div className="field-help">Shown on the IdentityHero and across Coach surfaces.</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
            <div className="field">
              <label className="field-label">2 · Age</label>
              <div className="input-with-unit">
                <input
                  className="rc-input num"
                  type="number"
                  min={10}
                  max={100}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="38"
                />
                <span className="unit">YRS</span>
              </div>
              <div className="field-help">Drives Tanaka HRmax estimate when Max HR is empty.</div>
            </div>
            <div className="field">
              <label className="field-label">Sex</label>
              <div className="chip-group" style={{ gap: 8 }}>
                {VALID_SEX.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSex(s)}
                    className={`chip-pick${sex === s ? ' active' : ''}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="field-help">Used by /health metrics (M/F lines) — defaults to Prefer not to say.</div>
            </div>
          </div>

          <div className="field">
            <label className="field-label">3 · Location (optional)</label>
            <input
              className="rc-input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Los Angeles, CA"
              maxLength={120}
            />
            <div className="field-help">Free-form. Used for weather context on race days.</div>
          </div>

          <div className="field">
            <label className="field-label">4 · Max HR (optional)</label>
            <div className="input-with-unit">
              <input
                className="rc-input num"
                type="number"
                min={100}
                max={250}
                value={hrmax}
                onChange={(e) => setHrmax(e.target.value)}
                placeholder="—"
              />
              <span className="unit">BPM</span>
            </div>
            <div className="field-help">
              Leave empty to use the Tanaka estimate (208 − 0.7 × age). Enter a measured value
              once you have one — it overrides the estimate everywhere.
            </div>
          </div>

          <div style={{
            padding: '14px 16px',
            background: 'rgba(39,180,224,.06)',
            border: '1px solid rgba(39,180,224,.20)',
            borderRadius: 8,
            marginTop: 4,
          }}>
            <div className="t-eyebrow" style={{ color: 'var(--coach)' }}>▸ WHAT THE COACH USES THIS FOR</div>
            <div className="t-body" style={{ color: 'var(--t1)', marginTop: 8, lineHeight: 1.55 }}>
              Age and Max HR drive the 5-zone HR table. Name + sex populate identity surfaces
              (IdentityHero, /health page). Location lets Coach pull weather for upcoming races.
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
          <div className="foot-meta">
            {isEdit ? '▸ Updated identity flows to HR zones, narrative, watching strip' : '▸ Coach will recompute HR zones once saved'}
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
