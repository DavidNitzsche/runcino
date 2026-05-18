/**
 * Accent picker presets + hex normalizer.
 *
 * Kept pure so the modal (client) and the card (also client) can share
 * the same swatch list without dragging pg into either bundle.
 */

export interface AccentSwatch {
  label: string;
  hex: string;
}

/** Default accent — matches `--corp` in globals.css and DEFAULT_ACCENT in lib/accent-color.ts. */
export const DEFAULT_ACCENT_HEX = '#008FEC';

export const ACCENT_SWATCHES: AccentSwatch[] = [
  { label: 'Blue',    hex: '#008FEC' },
  { label: 'Orange',  hex: '#FF5722' },
  { label: 'Green',   hex: '#3EBD41' },
  { label: 'Purple',  hex: '#9013FE' },
  { label: 'Red',     hex: '#F43F5E' },
  { label: 'Teal',    hex: '#14C08C' },
  { label: 'Pink',    hex: '#E83E8C' },
  { label: 'Amber',   hex: '#F5C518' },
];

/** Returns a normalized `#RRGGBB` uppercase, or null when input is
 *  empty / unset. Throws when the shape is non-empty but invalid. */
export function normalizeAccentHex(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
  if (!m) throw new Error('Accent color must be a 6-digit hex like #008FEC.');
  return `#${m[1].toUpperCase()}`;
}
