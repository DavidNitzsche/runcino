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
          gap: 6,
          padding: '14px 32px',
          background: 'transparent',
          border: '1.5px solid rgba(13,15,18,.2)',
          borderRadius: 10,
          fontFamily: 'Oswald, sans-serif',
          fontSize: 13,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          fontWeight: 600,
          color: '#0D0F12',
          cursor: 'pointer',
        }}
      >
        {open ? '× Close' : '⇄ Substitute'}
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
            {menu.crossRef && (
              <span style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: 0,
                textTransform: 'none',
                color: 'rgba(13,15,18,.62)',
                marginLeft: 8,
              }}>
                {' — '}
                <a
                  href={menu.crossRef.href}
                  style={{ color: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                >
                  {menu.crossRef.text}
                </a>
              </span>
            )}
          </div>

          {menu.substitutions.map((s, i) => {
            const isRecommended = menu.recommendedIndex === i;
            return (
              <div
                key={i}
                style={{
                  padding: '10px 12px',
                  marginBottom: i === menu.substitutions.length - 1 ? 0 : 10,
                  background: isRecommended ? 'rgba(232,93,38,.06)' : 'rgba(255,255,255,.5)',
                  border: isRecommended
                    ? '1.5px solid rgba(232,93,38,.40)'
                    : '1px solid rgba(13,15,18,.08)',
                  borderRadius: 8,
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                }}>
                  <div style={{ fontWeight: 700, color: '#0D0F12' }}>
                    {s.label}
                  </div>
                  {isRecommended && (
                    <span style={{
                      fontFamily: 'Oswald, sans-serif',
                      fontSize: 9,
                      letterSpacing: 1.2,
                      fontWeight: 700,
                      color: '#B3450A',
                      background: 'rgba(232,93,38,.12)',
                      padding: '2px 7px',
                      borderRadius: 4,
                    }}>
                      RECOMMENDED
                    </span>
                  )}
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
            );
          })}

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
