/**
 * AccentColorModal — brand-accent picker.
 *
 * Stores the chosen color as `profile.accent_color` via the small
 * `/api/profile/accent` endpoint (separate from /api/profile/edit so
 * the picker doesn't require name/age to be set first).
 *
 * Visual: 8 named swatches + a custom hex field. On save we trigger a
 * hard reload — the root layout reads `accent_color` server-side and
 * stamps `--corp` / `--accent` onto <html>, so the entire app picks
 * up the new color in one paint instead of via React state plumbing.
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
import { ACCENT_SWATCHES, DEFAULT_ACCENT_HEX, normalizeAccentHex } from './accent-presets';

export interface AccentColorModalProps {
  open: boolean;
  initialColor: string | null;
  onClose: () => void;
  onSaved: (color: string) => void;
}

export function AccentColorModal({ open, initialColor, onClose, onSaved }: AccentColorModalProps) {
  const [picked, setPicked] = useState(initialColor ?? DEFAULT_ACCENT_HEX);
  const [hex, setHex] = useState(initialColor ?? DEFAULT_ACCENT_HEX);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    const start = initialColor ?? DEFAULT_ACCENT_HEX;
    setPicked(start);
    setHex(start);
  }, [open, initialColor]);

  if (!open) return null;

  function pickSwatch(c: string) {
    setPicked(c);
    setHex(c);
    setError(null);
  }

  function onHexChange(raw: string) {
    setHex(raw);
    // Live preview when the input is a valid hex; otherwise keep the
    // last good pick so the preview chip doesn't strobe while typing.
    try {
      const v = normalizeAccentHex(raw);
      if (v) {
        setPicked(v);
        setError(null);
      }
    } catch {
      // partial input — wait for save to surface the error
    }
  }

  async function save() {
    setError(null);
    let final: string;
    try {
      const v = normalizeAccentHex(hex);
      if (!v) {
        setError('Pick a color or enter a hex.');
        return;
      }
      final = v;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/profile/accent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accent_color: final }),
      });
      const json = (await res.json()) as { ok?: boolean; accent_color?: string; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      onSaved(final);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function resetToDefault() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/profile/accent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accent_color: null }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      onSaved(DEFAULT_ACCENT_HEX);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onClose}>
      <Modal>
        <ModalHeader
          eyebrow="ACCENT"
          title="Brand color"
          onClose={busy ? undefined : onClose}
        />
        <ModalBody>
          <div className="field">
            <label className="field-label">1 · Preset</label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 8,
              }}
            >
              {ACCENT_SWATCHES.map((s) => {
                const active = picked.toUpperCase() === s.hex.toUpperCase();
                return (
                  <button
                    key={s.hex}
                    type="button"
                    onClick={() => pickSwatch(s.hex)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      padding: '12px 6px',
                      background: 'var(--l2)',
                      border: active ? `2px solid ${s.hex}` : '2px solid transparent',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontFamily: 'var(--f-data)',
                      fontSize: 10,
                      letterSpacing: '1.2px',
                      color: active ? 'var(--t0)' : 'var(--t2)',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    <span
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        background: s.hex,
                        border: '1px solid rgba(0,0,0,.08)',
                      }}
                    />
                    {s.label}
                  </button>
                );
              })}
            </div>
            <div className="field-help">Tap a swatch to preview. Save to apply across the app.</div>
          </div>

          <div className="field">
            <label className="field-label">2 · Custom hex</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span
                aria-hidden="true"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: picked,
                  border: '1px solid var(--l4)',
                  flexShrink: 0,
                }}
              />
              <input
                className="rc-input mono"
                value={hex}
                onChange={(e) => onHexChange(e.target.value)}
                placeholder="#008FEC"
                maxLength={7}
                style={{ fontFamily: 'var(--f-data)' }}
              />
            </div>
            <div className="field-help">Any 6-digit hex — `#RRGGBB`. Pick something that reads well on dark backgrounds.</div>
          </div>

          <div style={{
            padding: '14px 16px',
            background: 'rgba(39,180,224,.06)',
            border: '1px solid rgba(39,180,224,.20)',
            borderRadius: 8,
            marginTop: 4,
          }}>
            <div className="t-eyebrow" style={{ color: 'var(--coach)' }}>▸ PREVIEW</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 }}>
              <button
                type="button"
                disabled
                style={{
                  padding: '10px 18px',
                  background: picked,
                  color: '#fff',
                  border: 0,
                  borderRadius: 6,
                  fontFamily: 'var(--f-data)',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '1.2px',
                  textTransform: 'uppercase',
                  cursor: 'default',
                }}
              >
                PRIMARY ACTION
              </button>
              <span
                style={{
                  padding: '6px 12px',
                  background: 'transparent',
                  color: picked,
                  border: `1px solid ${picked}`,
                  borderRadius: 4,
                  fontFamily: 'var(--f-data)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '1.2px',
                  textTransform: 'uppercase',
                }}
              >
                ACCENT PIN
              </span>
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
          <button
            type="button"
            className="btn btn-secondary"
            onClick={resetToDefault}
            disabled={busy}
            title="Reverts to the canonical Runcino blue."
          >Reset to default</button>
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
              style={{ background: picked, borderColor: picked }}
            >{busy ? 'Saving…' : 'Save accent'}</button>
          </div>
        </ModalFooter>
      </Modal>
    </ModalOverlay>
  );
}
