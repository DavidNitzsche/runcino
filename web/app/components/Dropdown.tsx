/**
 * Dropdown · custom <select> replacement
 *
 * A Radix-powered select that fully replaces the native browser dropdown.
 * The native popup paints with OS-default colors (light gray, serif) which
 * clashes with the dark JetBrains/Oswald/Jost aesthetic — this component
 * paints every part itself.
 *
 * The closed-state trigger mimics `.rc-select` exactly so it slots into
 * existing `<Field>` rows without visual diff. The popup escapes any
 * clipping ancestor via Radix Portal and matches the `.modal` family in
 * tone (--l2 surface, --l4 border, subtle fade-in animation).
 *
 *   <Dropdown value={v} onValueChange={setV} placeholder="Select…">
 *     <DropdownItem value="5K">5K</DropdownItem>
 *     <DropdownItem value="HALF">Half marathon</DropdownItem>
 *   </Dropdown>
 *
 * Accessibility comes from Radix: full keyboard nav (Arrow/Home/End/Type-ahead),
 * focus management on open/close, ARIA roles, screen-reader announcements.
 */

'use client';

import * as Select from '@radix-ui/react-select';
import { forwardRef, type ReactNode } from 'react';

export interface DropdownProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: ReactNode;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  /** aria-label when the trigger sits outside a <label>. */
  ariaLabel?: string;
}

export function Dropdown({
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Select…',
  disabled,
  name,
  required,
  children,
  className,
  ariaLabel,
}: DropdownProps) {
  return (
    <Select.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
      required={required}
    >
      <Select.Trigger
        className={`rc-dropdown-trigger${className ? ` ${className}` : ''}`}
        aria-label={ariaLabel}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="rc-dropdown-icon" aria-hidden>
          <ChevronGlyph />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          className="rc-dropdown-content"
          position="popper"
          sideOffset={6}
          align="start"
        >
          <Select.ScrollUpButton className="rc-dropdown-scroll-btn">▲</Select.ScrollUpButton>
          <Select.Viewport className="rc-dropdown-viewport">
            {children}
          </Select.Viewport>
          <Select.ScrollDownButton className="rc-dropdown-scroll-btn">▼</Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export interface DropdownItemProps {
  value: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

export const DropdownItem = forwardRef<HTMLDivElement, DropdownItemProps>(
  function DropdownItem({ value, children, disabled, className }, ref) {
    return (
      <Select.Item
        ref={ref}
        value={value}
        disabled={disabled}
        className={`rc-dropdown-item${className ? ` ${className}` : ''}`}
      >
        <Select.ItemText>{children}</Select.ItemText>
        <Select.ItemIndicator className="rc-dropdown-indicator">
          <CheckGlyph />
        </Select.ItemIndicator>
      </Select.Item>
    );
  },
);

export interface DropdownGroupProps {
  label?: ReactNode;
  children: ReactNode;
}
export function DropdownGroup({ label, children }: DropdownGroupProps) {
  return (
    <Select.Group>
      {label !== undefined && (
        <Select.Label className="rc-dropdown-group-label">{label}</Select.Label>
      )}
      {children}
    </Select.Group>
  );
}

export function DropdownSeparator() {
  return <Select.Separator className="rc-dropdown-separator" />;
}

/** Same chevron geometry as the .rc-select background-image — drawn in SVG so the popper version can match. */
function ChevronGlyph() {
  return (
    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1 1L5 5L9 1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="12" height="9" viewBox="0 0 12 9" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1 4.5L4.5 8L11 1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
