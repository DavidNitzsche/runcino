/**
 * DatePicker · custom <input type="date"> replacement
 *
 * Native date pickers paint with the OS theme — light gray on macOS, blue on
 * Chrome, calendar-emoji on iOS. None of these match the May 2026 dark system.
 * This component uses `react-day-picker` for the calendar grid wrapped in a
 * Radix Popover for positioning and focus management.
 *
 *   <DatePicker value={date} onValueChange={setDate} />
 *
 * Value is the ISO `YYYY-MM-DD` string (matching native <input type="date">),
 * so existing form code can swap in without conversion. The trigger renders
 * the value in mono font; the popup matches the .modal family.
 */

'use client';

import * as Popover from '@radix-ui/react-popover';
import { useState, type ReactNode } from 'react';
import { DayPicker, type Matcher } from 'react-day-picker';

export interface DatePickerProps {
  /** ISO date string YYYY-MM-DD. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: ReactNode;
  /** ISO YYYY-MM-DD. Days before this are disabled. */
  min?: string;
  /** ISO YYYY-MM-DD. Days after this are disabled. */
  max?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

function isoToDate(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  // Parse as local time, not UTC — `new Date('2026-05-11')` shifts by TZ.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function dateToIso(d: Date | undefined): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function DatePicker({
  value,
  defaultValue,
  onValueChange,
  placeholder = 'YYYY-MM-DD',
  min,
  max,
  disabled,
  className,
  ariaLabel,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState<string | undefined>(defaultValue);
  const current = value !== undefined ? value : internal;
  const selected = isoToDate(current);

  const handleSelect = (day: Date | undefined) => {
    const iso = dateToIso(day);
    if (value === undefined) setInternal(iso);
    onValueChange?.(iso);
    setOpen(false);
  };

  const disabledMatchers: Matcher[] = [];
  const minDate = isoToDate(min);
  const maxDate = isoToDate(max);
  if (minDate) disabledMatchers.push({ before: minDate });
  if (maxDate) disabledMatchers.push({ after: maxDate });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`rc-datepicker-trigger${className ? ` ${className}` : ''}`}
          disabled={disabled}
          aria-label={ariaLabel}
        >
          <span className={`rc-datepicker-value${current ? '' : ' placeholder'}`}>
            {current || placeholder}
          </span>
          <span className="rc-datepicker-icon" aria-hidden>
            <CalendarGlyph />
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="rc-datepicker-content"
          align="start"
          sideOffset={6}
        >
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={handleSelect}
            disabled={disabledMatchers.length > 0 ? disabledMatchers : undefined}
            showOutsideDays
            weekStartsOn={1}
            classNames={{
              root: 'rc-rdp-root',
              months: 'rc-rdp-months',
              month: 'rc-rdp-month',
              month_caption: 'rc-rdp-caption',
              caption_label: 'rc-rdp-caption-label',
              nav: 'rc-rdp-nav',
              button_previous: 'rc-rdp-nav-btn',
              button_next: 'rc-rdp-nav-btn',
              month_grid: 'rc-rdp-grid',
              weekdays: 'rc-rdp-weekdays',
              weekday: 'rc-rdp-weekday',
              week: 'rc-rdp-week',
              day: 'rc-rdp-day',
              day_button: 'rc-rdp-day-btn',
              today: 'rc-rdp-today',
              selected: 'rc-rdp-selected',
              outside: 'rc-rdp-outside',
              disabled: 'rc-rdp-disabled',
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CalendarGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 5.5H12.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.5 1V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M9.5 1V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
