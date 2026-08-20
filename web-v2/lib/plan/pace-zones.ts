/**
 * lib/plan/pace-zones.ts · the per-zone pace re-anchor.
 *
 * `GET /api/v5/paces` (design 18a "Paces slower / faster") needs a
 * before/after pace for THREE zones — threshold, interval, rep — and they do
 * not move by the same amount at a given VDOT delta:
 * `docs/faff-iphone-design-contract.md` §"Paces slower / faster" — "Measured
 * on a three-point fitness drop: threshold +24 s/mi, interval +22, rep +19.
 * There is no single headline delta — per-zone rows only."
 *
 * So this module returns three independent rows, each derived from the
 * canonical Daniels curve this app already binds to doctrine —
 * `tPaceFromVdot` / `iPaceFromVdot` / `rPaceFromVdot` in
 * `lib/training/vdot.ts`, themselves gated by `PACE.threshold-anchor`,
 * `PACE.interval-offset`'s sibling and `PACE.repetition-is-mile-race-pace` —
 * never re-derived here from an offset or a ratio. Reinventing the table is
 * exactly the mistake `docs/2026-05-19-sim-sweep.md` documents for the
 * deprecated `E = M + 75` / `R = mile-pace` formulas.
 *
 * Doctrine gate: `PACE.zone-reanchor-uses-bound-curve-functions` in
 * `lib/doctrine/registry.ts` checks this file's source calls those three
 * functions directly and never collapses the three rows into one delta.
 */
import { tPaceFromVdot, iPaceFromVdot, rPaceFromVdot } from '@/lib/training/vdot';

export type PaceZoneName = 'Threshold' | 'Interval' | 'Rep';

export interface ZonePaceValue {
  id: string;
  name: PaceZoneName;
  beforeSPerMi: number | null;
  afterSPerMi: number | null;
  /** after − before, seconds per mile. Positive = slower. Null when either
   *  side is unreadable (VDOT off the [30,85] table). */
  deltaSec: number | null;
}

/**
 * One row per zone, before/after at two VDOTs, off the SAME bound curve
 * functions every other pace surface in the app reads. Never returns a
 * combined/averaged delta — that is the one thing this function must not do.
 */
export function resolveZonePaces(
  fromVdot: number | null | undefined,
  toVdot: number | null | undefined,
): ZonePaceValue[] {
  const zones: Array<{ id: string; name: PaceZoneName; fn: (v: number | null | undefined) => number | null }> = [
    { id: 'threshold', name: 'Threshold', fn: tPaceFromVdot },
    { id: 'interval', name: 'Interval', fn: iPaceFromVdot },
    { id: 'rep', name: 'Rep', fn: rPaceFromVdot },
  ];
  return zones.map(({ id, name, fn }) => {
    const before = fromVdot != null ? fn(fromVdot) : null;
    const after = toVdot != null ? fn(toVdot) : null;
    const delta = before != null && after != null ? after - before : null;
    return { id, name, beforeSPerMi: before, afterSPerMi: after, deltaSec: delta };
  });
}

/** "+24 s/mi" / "-9 s/mi" / "±0 s/mi". Null when not computable. Sign is
 *  always shown so the reader never has to infer direction from the words
 *  around it. */
export function formatDeltaLabel(deltaSec: number | null): string | null {
  if (deltaSec == null || !Number.isFinite(deltaSec)) return null;
  const rounded = Math.round(deltaSec);
  if (rounded === 0) return '±0 s/mi';
  return `${rounded > 0 ? '+' : ''}${rounded} s/mi`;
}

/** "6:12" per-mile pace display. Null passthrough for an unreadable value. */
export function formatPaceMinSec(sPerMi: number | null): string | null {
  if (sPerMi == null || !Number.isFinite(sPerMi) || sPerMi <= 0) return null;
  const m = Math.floor(sPerMi / 60);
  const s = Math.round(sPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
