/**
 * Field · Input · Textarea · SelectNative · InputWithUnit · ChipPick · RadioRow
 *
 * The form-field primitives from _template-edit-2026-05-09 and
 * _template-action-2026-05-09.
 *
 * <Field> wraps a label + control + optional help text.
 * <Input>, <Textarea> are styled native controls.
 * <SelectNative> is the styled-but-still-native <select>, kept as an escape
 *   hatch for forms that need OS integration (autofill, mobile picker). For
 *   the design-system-matching popup, use <Dropdown> from ./Dropdown.tsx.
 * <InputWithUnit> wraps an Input with a fixed unit suffix.
 * <ChipPick> is the pill toggle (active state matches CardPin variants).
 * <RadioRow> is the radio + label + meta + aux-right row pattern.
 */

import type {
  ReactNode,
  HTMLAttributes,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
  ButtonHTMLAttributes,
} from 'react';

export interface FieldProps {
  /** Label text, rendered uppercase, mono, muted above the control. */
  label?: ReactNode;
  /** Optional help text, small, muted, beneath the control. */
  help?: ReactNode;
  children: ReactNode;
  /** Optional className for the wrapping <div class="field">. */
  className?: string;
}

export function Field({ label, help, children, className }: FieldProps) {
  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      {label !== undefined && <label className="field-label">{label}</label>}
      {children}
      {help !== undefined && <div className="field-help">{help}</div>}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}
export function Input({ className, ...rest }: InputProps) {
  return <input className={`rc-input${className ? ` ${className}` : ''}`} {...rest} />;
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}
export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={`rc-textarea${className ? ` ${className}` : ''}`} {...rest} />;
}

export interface SelectNativeProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
}
/**
 * Native <select> styled to match the form aesthetic. The popup, however,
 * is browser/OS-controlled and will paint with native chrome. Prefer
 * <Dropdown> from ./Dropdown.tsx unless OS integration is required.
 */
export function SelectNative({ children, className, ...rest }: SelectNativeProps) {
  return (
    <select className={`rc-select${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </select>
  );
}

export interface InputWithUnitProps extends InputHTMLAttributes<HTMLInputElement> {
  unit: ReactNode;
}
export function InputWithUnit({ unit, className, ...rest }: InputWithUnitProps) {
  return (
    <div className="input-with-unit">
      <input className={`rc-input${className ? ` ${className}` : ''}`} {...rest} />
      <span className="unit">{unit}</span>
    </div>
  );
}

export type ChipPickVariant = 'corp' | 'race' | 'coach' | 'good' | 'amber' | 'warn' | 'purple';

export interface ChipPickProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  active?: boolean;
  variant?: ChipPickVariant;
  children: ReactNode;
}
export function ChipPick({
  active = false,
  variant,
  children,
  className,
  ...rest
}: ChipPickProps) {
  const classes = ['chip-pick'];
  if (active) {
    classes.push('active');
    // The 'corp' variant is the default active style (no extra modifier).
    if (variant && variant !== 'corp') classes.push(variant);
  }
  if (className) classes.push(className);
  return (
    <button type="button" className={classes.join(' ')} {...rest}>
      {children}
    </button>
  );
}

export interface ChipGroupProps {
  children: ReactNode;
}
export function ChipGroup({ children }: ChipGroupProps) {
  return <div className="chip-group">{children}</div>;
}

export interface RadioRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  active?: boolean;
  /** Bold uppercase main label. */
  label: ReactNode;
  /** Optional second-line meta (mono, muted). */
  meta?: ReactNode;
  /** Right-aligned auxiliary text. */
  aux?: ReactNode;
  onSelect?: () => void;
}
export function RadioRow({
  active = false,
  label,
  meta,
  aux,
  onSelect,
  className,
  ...rest
}: RadioRowProps) {
  return (
    <div
      role="radio"
      aria-checked={active}
      tabIndex={0}
      className={`radio-row${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onSelect) {
          e.preventDefault();
          onSelect();
        }
      }}
      {...rest}
    >
      <span className="radio-mark" />
      <div>
        <div className="radio-label">{label}</div>
        {meta !== undefined && <div className="radio-meta">{meta}</div>}
      </div>
      {aux !== undefined && <span className="radio-aux">{aux}</span>}
    </div>
  );
}

export interface RadioListProps {
  children: ReactNode;
}
export function RadioList({ children }: RadioListProps) {
  return <div className="radio-list">{children}</div>;
}
