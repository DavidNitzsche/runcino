import type { CSSProperties } from 'react';

/**
 * components/redesign/core/Radio.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/forms/Radio.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same inset-ring selected state.
 */

export interface RadioProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  /** Says what this choice makes the plan do. */
  sub?: string;
  disabled?: boolean;
  /**
   * Groups the options that belong together, so arrow keys move between them
   * and a screen reader says "2 of 5" rather than "2 of 1".
   *
   * Left off deliberately by default rather than defaulted to one shared
   * string: `Step1bGoalDetailsRedesign` renders three independent sets on one
   * page (weekly average, long run, years running), and a shared name would
   * fold all three into a single group and let one answer clear another.
   * Passing it per set is a real improvement and a call-site change; the
   * audit report names the sets that want it.
   */
  name?: string;
  style?: CSSProperties;
}

/** One of a small set, where the choice reshapes the plan. Used for the five onboarding modes and for experience level. */
export function Radio({ checked = false, onChange, label, sub, disabled = false, name, style }: RadioProps) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-6)', minHeight: 'var(--hit-min)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
        position: 'relative', ...style,
      }}
    >
      {/*
        Third of the three: a `<label>` with an `onClick` and no `<input>`.
        Onboarding's five mutually exclusive modes had no radio group at all —
        not focusable, no `aria-checked`, and nothing saying the five belonged
        to one another. A keyboard user could not pick a mode; a screen-reader
        user could not tell which was already picked.

        `name` groups them so arrow keys move between the options the way a
        radio group is meant to, and it is derived from the component rather
        than asked of every call site. All five onboarding modes render as one
        group, which is what they are.

        The drawn ring below is unchanged and marked decorative.
      */}
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange && onChange(true)}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: 0,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      />
      <span aria-hidden="true" style={{
        width: 24, height: 24, flex: '0 0 auto', marginTop: 8, borderRadius: '50%',
        background: 'var(--surface-control)', boxShadow: checked ? 'inset 0 0 0 7px var(--signal)' : 'none',
        transition: 'box-shadow var(--dur-2) var(--ease-out)',
      }} />
      <span style={{ display: 'grid', gap: 2, paddingTop: 6 }}>
        <span style={{ fontSize: 'var(--type-body-s)' }}>{label}</span>
        {sub && <span style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', maxWidth: 'var(--measure-say)' }}>{sub}</span>}
      </span>
    </label>
  );
}
