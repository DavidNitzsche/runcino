'use client';

/**
 * /profile · modal trigger buttons.
 *
 * The server page renders this as a small client island for each
 * "Edit Profile" / "Edit Prefs" / "+ Add Shoe" button. For tonight's
 * launch, clicking surfaces a placeholder alert; the full modal UIs
 * (with form state + API wiring) are a follow-up commit.
 */

import { useState } from 'react';

interface Props {
  mode: 'edit-profile' | 'edit-prefs' | 'add-shoe';
  initialName?: string;
  initialAge?: number | null;
  initialSex?: 'M' | 'F' | null;
  initialLocation?: string | null;
  initialLevel?: string;
  initialLongRunDay?: string;
  initialQualityDays?: string[];
  initialRestDay?: string;
}

const LABELS = {
  'edit-profile': 'Edit Profile',
  'edit-prefs':   'Edit Prefs',
  'add-shoe':     '+ Add Shoe',
};

export function ProfileModalsIsland(props: Props) {
  const [open, setOpen] = useState(false);
  const isHero = props.mode === 'edit-profile';
  const cls = isHero ? 'identity-edit' : 'card-action';

  return (
    <>
      <button className={cls} type="button" onClick={() => setOpen(true)}>
        {LABELS[props.mode]}
      </button>
      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(13,15,18,.55)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            zIndex: 1000, padding: '60px 24px', overflowY: 'auto', backdropFilter: 'blur(4px)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div style={{ background: '#fff', borderRadius: 18, boxShadow: '0 30px 80px rgba(0,0,0,.25)', maxWidth: 540, width: '100%', padding: '36px 40px 32px' }}>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: 'rgba(13,15,18,.35)', fontWeight: 600 }}>
              {props.mode === 'add-shoe' ? 'Shoe Rotation' : props.mode === 'edit-prefs' ? 'Training Profile' : 'Identity'}
            </div>
            <div style={{ fontFamily: '"Bebas Neue", sans-serif', fontSize: 38, letterSpacing: '-0.5px', lineHeight: 1, color: '#0D0F12', marginTop: 6 }}>
              {LABELS[props.mode].toUpperCase()}
            </div>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(13,15,18,.55)', lineHeight: 1.55, marginTop: 24 }}>
              The full edit form lands in the next commit. For now, the structural port of /profile is live — what you see in the cards above reflects what your account holds.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(13,15,18,.08)' }}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 12,
                  letterSpacing: '1.5px', textTransform: 'uppercase',
                  padding: '11px 22px', borderRadius: 9, cursor: 'pointer',
                  background: '#0D0F12', color: '#fff', border: 'none',
                }}
              >Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
