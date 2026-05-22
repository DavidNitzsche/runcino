/**
 * TimePicker · masked text input for durations
 *
 * Runners type goal/split times, `1:35:00` or `42:15`. Native
 * <input type="time"> opens a clock UI that's OS-themed and doesn't
 * understand durations longer than 24 hours. This is just a styled
 * text input with format normalization on blur.
 *
 *   <TimePicker value={t} onValueChange={setT} format="HH:MM:SS" />
 *
 * Format options:
 *   - "HH:MM:SS", long durations (marathons, ultras)
 *   - "MM:SS", splits, intervals
 *   - "auto", accept either, normalize to whichever fits
 *
 * Validation runs on blur: invalid input is cleared. Caller gets clean
 * values via onValueChange.
 */

'use client';

import { useEffect, useState, type ChangeEvent, type FocusEvent } from 'react';

export type TimePickerFormat = 'HH:MM:SS' | 'MM:SS' | 'auto';

export interface TimePickerProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  format?: TimePickerFormat;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  className?: string;
  ariaLabel?: string;
}

function normalize(raw: string, fmt: TimePickerFormat): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Only digits and colons make it through; pad missing parts.
  const parts = trimmed.split(':').map((p) => p.replace(/\D/g, ''));
  if (parts.some((p) => p === '')) return ''; // invalid
  // Clamp ranges.
  const ints = parts.map((p) => Number(p));
  if (ints.some((n) => Number.isNaN(n))) return '';

  let h = 0,
    m = 0,
    s = 0;
  if (ints.length === 3) {
    [h, m, s] = ints;
  } else if (ints.length === 2) {
    if (fmt === 'HH:MM:SS' || fmt === 'auto') {
      // Two parts in HH:MM:SS context = H:MM (runners write goals as `1:35`)
      [h, m] = ints;
    } else {
      [m, s] = ints;
    }
  } else if (ints.length === 1) {
    if (fmt === 'HH:MM:SS') h = ints[0];
    else m = ints[0];
  } else {
    return '';
  }

  if (m < 0 || m > 59 || s < 0 || s > 59 || h < 0) return '';

  // Pad minutes and seconds to 2 digits, but never pad hours · `1:35:00` reads
  // cleaner than `01:35:00` and matches Strava / Garmin / race-result formatting.
  const pad2 = (n: number) => String(n).padStart(2, '0');
  if (fmt === 'MM:SS') {
    // Roll seconds, allow MM to exceed 59 for long-interval cases (e.g. 90:00).
    const totalMin = h * 60 + m;
    return `${pad2(totalMin)}:${pad2(s)}`;
  }
  if (fmt === 'auto') {
    // Respect user's precision: if they typed 2 parts, keep 2 parts.
    // If they typed 3, keep 3. Don't auto-append :00 seconds.
    if (ints.length === 3) return `${h}:${pad2(m)}:${pad2(s)}`;
    if (ints.length === 2) {
      // Two parts in auto: if h > 0 keep as H:MM, else show as M:SS (sub-hour interval)
      if (h > 0) return `${h}:${pad2(m)}`;
      return `${pad2(m)}:${pad2(s)}`;
    }
    return h > 0 ? `${h}` : `${m}`;
  }
  return `${h}:${pad2(m)}:${pad2(s)}`;
}

export function TimePicker({
  value,
  defaultValue,
  onValueChange,
  format = 'HH:MM:SS',
  placeholder,
  disabled,
  required,
  name,
  className,
  ariaLabel,
}: TimePickerProps) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState<string>(defaultValue ?? '');
  const display = controlled ? (value as string) : internal;

  // Keep internal in sync when defaultValue arrives late.
  useEffect(() => {
    if (!controlled && defaultValue !== undefined) {
      setInternal(defaultValue);
    }
  }, [controlled, defaultValue]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    // Allow only digits and colons during typing.
    const raw = e.target.value.replace(/[^\d:]/g, '');
    if (!controlled) setInternal(raw);
    onValueChange?.(raw);
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    const norm = normalize(e.target.value, format);
    if (!controlled) setInternal(norm);
    onValueChange?.(norm);
  };

  const ph = placeholder ?? (format === 'MM:SS' ? 'MM:SS' : 'HH:MM:SS');

  return (
    <input
      type="text"
      inputMode="numeric"
      className={`rc-input rc-timepicker num${className ? ` ${className}` : ''}`}
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={ph}
      disabled={disabled}
      required={required}
      name={name}
      aria-label={ariaLabel}
      autoComplete="off"
      spellCheck={false}
    />
  );
}
