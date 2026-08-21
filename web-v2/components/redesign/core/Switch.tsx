import type { CSSProperties } from 'react';

/**
 * components/redesign/core/Switch.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/forms/Switch.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same track/thumb construction.
 */

export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  /** One quiet line saying what changes. */
  sub?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

/**
 * Visually hidden, still focusable. `display:none` and `visibility:hidden`
 * would take the control out of the tab order along with the pixels, which
 * is the opposite of the point.
 */
const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

/** A setting that takes effect immediately. Never used for something that needs saving. */
export function Switch({ checked = false, onChange, label, sub, disabled = false, style }: SwitchProps) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-6)', minHeight: 'var(--hit-min)',
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
      position: 'relative', ...style,
    }}>
      {/*
        THERE WAS NO CONTROL HERE AT ALL.

        A `<label>` wrapping two `<span>`s, with the handler on the decorative
        track. No `<input>`, no `role`, no `aria-checked`, no `tabIndex`. So:
        not in the tab order, not operable by keyboard, and announced by a
        screen reader as a run of text with no state and no way to change it.
        The "start runs from this phone" switch — which the handoff calls the
        single source of truth for whether RUN appears in the tab bar — could
        not be reached at all without a mouse.

        A real checkbox with `role="switch"` fixes every one of those at once
        and for free: native focus, Space to toggle, correct role and state,
        and the wrapping `<label>` associates the name without needing an id.
        It is positioned out of flow, so the drawn track and thumb below are
        untouched.

        The click handler moves off the track span and onto the input. That
        also fixes a second bug the markup had: `cursor:pointer` was on the
        whole row but only the 52px track actually did anything, so clicking
        the label text looked live and was dead.
      */}
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange && onChange(e.currentTarget.checked)}
        style={srOnly}
      />
      <span
        aria-hidden="true"
        style={{
          width: 52, height: 32, borderRadius: 'var(--radius-pill)', flex: '0 0 auto', marginTop: 2,
          background: checked ? 'var(--signal)' : 'var(--surface-4)', position: 'relative',
          transition: 'background var(--dur-2) var(--ease-out)',
        }}
      >
        <span style={{
          position: 'absolute', top: 4, left: checked ? 24 : 4, width: 24, height: 24, borderRadius: '50%',
          background: checked ? '#000' : 'var(--ink-1)', transition: 'left var(--dur-2) var(--ease-out)',
        }} />
      </span>
      <span style={{ display: 'grid', gap: 2, paddingTop: 4 }}>
        <span style={{ fontSize: 'var(--type-body-s)' }}>{label}</span>
        {sub && <span style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>{sub}</span>}
      </span>
    </label>
  );
}
