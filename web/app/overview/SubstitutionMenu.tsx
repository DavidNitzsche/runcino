'use client';

/**
 * C8 · Workout substitution menu · expandable on Skip
 *
 * "If today's session isn't going to happen, here are 2-3 ways to
 * keep something useful while honoring the constraint." Each option
 * lists what it PRESERVES and what it SACRIFICES — honest trade-offs,
 * not silent auto-modification.
 */

import { useState } from 'react';
import type { SubstitutionMenu as Menu } from '@/lib/workout-substitutions';

interface Props {
  menu: Menu;
}

export function SubstitutionMenu({ menu }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '8px 14px',
          background: 'transparent',
          border: '1px solid rgba(13,15,18,.20)',
          borderRadius: 6,
          fontFamily: 'Oswald, sans-serif',
          fontSize: 11,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          fontWeight: 600,
          color: 'rgba(13,15,18,.70)',
          cursor: 'pointer',
        }}
      >
        {open ? '× Close substitutions' : '⇄ Substitute'}
      </button>

      {open && (
        <div
          style={{
            marginTop: 14,
            padding: '16px 18px',
            background: 'rgba(13,15,18,.025)',
            border: '1px solid rgba(13,15,18,.10)',
            borderRadius: 10,
            fontFamily: 'Inter, sans-serif',
            fontSize: 12.5,
            lineHeight: 1.55,
            color: 'rgba(13,15,18,.82)',
            maxWidth: 640,
          }}
        >
          <div
            style={{
              fontFamily: 'Oswald, sans-serif',
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
              fontWeight: 700,
              color: 'rgba(13,15,18,.55)',
              marginBottom: 12,
            }}
          >
            Substitutions for {menu.workoutLabel}
          </div>

          {menu.substitutions.map((s, i) => (
            <div
              key={i}
              style={{
                padding: '10px 12px',
                marginBottom: i === menu.substitutions.length - 1 ? 0 : 10,
                background: 'rgba(255,255,255,.5)',
                border: '1px solid rgba(13,15,18,.08)',
                borderRadius: 8,
              }}
            >
              <div style={{ fontWeight: 700, color: '#0D0F12', marginBottom: 4 }}>
                {s.label}
              </div>
              <div style={{ marginBottom: 6, color: 'rgba(13,15,18,.82)' }}>
                {s.prescription}
              </div>
              <div style={{ fontSize: 11.5, color: 'rgba(13,15,18,.62)' }}>
                <span style={{ color: '#1f6a21', fontWeight: 600 }}>Preserves:</span>{' '}
                {s.preserves}
              </div>
              <div style={{ fontSize: 11.5, color: 'rgba(13,15,18,.62)', marginTop: 2 }}>
                <span style={{ color: '#B3450A', fontWeight: 600 }}>Sacrifices:</span>{' '}
                {s.sacrifices}
              </div>
            </div>
          ))}

          <div
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop: '1px solid rgba(13,15,18,.06)',
              fontSize: 11,
              color: 'rgba(13,15,18,.55)',
              fontStyle: 'italic',
            }}
          >
            Pick the substitution that matches your constraint. The system doesn't
            auto-modify the plan — you choose what to do.
          </div>
        </div>
      )}
    </>
  );
}
