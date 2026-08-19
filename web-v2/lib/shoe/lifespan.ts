/**
 * lib/shoe/lifespan.ts · THE single source of truth for how long a shoe lasts.
 *
 * Before this file there were five different answers to "when does a shoe
 * retire", spread across five files and two languages, and no runner could
 * have told you which one their progress bar was drawing:
 *
 *   web-v2/lib/coach/profile-state.ts        `Number(s.mileage_cap) || 400`
 *   web-v2/lib/shoe/auto-assign.ts           `COALESCE(mileage_cap, 400)`
 *   web-v2/app/api/shoe/route.ts             `body.mileage_cap ?? 400`
 *   web-v2/components/faff-app/seed.ts       `Math.round(s.cap || 400)`
 *   web-v2/components/redesign/gear/…        `Number(retireAt) || 350`
 *   native-v2/…/Views/ShoesView.swift        `s.mileage_cap ?? 450` (and 400)
 *   native-v2/…/Views/ProfileView.swift      `s.cap ?? 450`
 *
 * They now all resolve through `resolveShoeCapMi`.
 *
 * ── Where the numbers come from ────────────────────────────────────────────
 *
 * TWO different things, and the difference matters.
 *
 * The BANDS are doctrine. `Research/17-footwear.md` § "Mileage Lifespan by
 * Category" carries a mileage band per shoe category, and every band below is
 * transcribed from it verbatim. The doctrine gate
 * (`CONVENTION.shoe-retirement-default`) parses that table at run time and
 * fails if either end of any band here disagrees with the doc.
 *
 * The DEFAULT — which single number inside the band becomes the retirement
 * target — IS A CONVENTION. Doctrine states bands, not defaults, and nothing
 * in `Research/` picks a point inside one. Two of these were confirmed by the
 * owner; the rest follow from them.
 *
 *   · TRAINER FAMILY → 400 mi (owner-confirmed). In-vivo work puts midsole
 *     cushioning degradation at 480-640 km (300-400 mi); 400 is the top of
 *     that band and sits inside the widely-quoted 250-500 range.
 *   · RACE-DAY SHOES → 250 mi (owner-confirmed). Lightweight racers are cited
 *     at 200-300 mi; 250 is the midpoint.
 *   · EVERYTHING ELSE → the midpoint of its own doctrine band, because neither
 *     confirmed anchor names it.
 *
 * HOW PRECISE THIS IS NOT. The familiar "300-500 miles" rule traces to a
 * single 1985 study (Cook, Kester & Brunet) measuring midsole compression,
 * which found meaningful loss of shock absorption somewhere around 250-500 mi.
 * The literature is explicit that any fixed mileage is coarse: degradation
 * varies with surface, body weight and gait. These numbers are a reasonable
 * place to put a bar, not a measurement of a particular runner's shoe.
 *
 * An earlier draft of this file defaulted to the LOW end of every band, which
 * would have retired a race-day shoe at 150 mi — below anything the evidence
 * supports, and with roughly a third of its life left.
 *
 * A runner who disagrees sets `shoes.mileage_cap` and their number wins over
 * all of this, always.
 *
 * ── Room left for surface ──────────────────────────────────────────────────
 *
 * Road wears a shoe measurably faster than treadmill or trail, and we already
 * record surface per run. No surface adjustment is built here and none should
 * be inferred. What this file does is keep the denominator resolvable in ONE
 * place (`resolveShoeCapMi`), so a later surface-weighted target has a single
 * function to change rather than five hardcoded numbers to hunt down.
 */

/**
 * Shoe category. The keys are ours; each maps to exactly one row of the
 * doctrine table, named in `doctrineRow` and checked by the gate.
 *
 * `Research/17` also has a "Category × Use-Case Matrix" that splits trail into
 * buffed/technical and calls the super shoe "Super shoe (racing)". The lifespan
 * table — the one that actually answers this question — does neither, so these
 * follow the lifespan table.
 */
export type ShoeType =
  | 'daily_trainer'
  | 'max_cushion'
  | 'tempo_trainer'
  | 'super_shoe'
  | 'racing_flat'
  | 'trail'
  | 'track_spike'
  | 'stability';

export interface ShoeLifespan {
  /** Runner-facing name. Coach voice: names the thing, explains nothing. */
  label: string;
  /** VERBATIM first-cell text of this category's row in the doctrine table. */
  doctrineRow: string;
  /** Low end of the doctrine band, in miles. */
  lowMi: number;
  /** High end of the doctrine band, in miles. */
  highMi: number;
  /**
   * CONVENTION · the retirement target for this category when the runner has
   * not set one. Always inside `[lowMi, highMi]` — the gate asserts it. See the
   * file header for where 400 and 250 come from and how coarse they are.
   */
  defaultMi: number;
  /** Why `defaultMi` is that number, in one phrase. Read by nobody but people. */
  defaultBasis: string;
}

/**
 * `Research/17-footwear.md` § "Mileage Lifespan by Category".
 * Every band here is read back out of that table by the doctrine gate.
 */
export const SHOE_LIFESPAN: Record<ShoeType, ShoeLifespan> = {
  daily_trainer: {
    label: 'Daily trainer', doctrineRow: 'Daily trainer', lowMi: 400, highMi: 500,
    defaultMi: 400, defaultBasis: 'trainer family · owner-confirmed 400',
  },
  max_cushion: {
    label: 'Max cushion', doctrineRow: 'Max cushion', lowMi: 400, highMi: 600,
    defaultMi: 400, defaultBasis: 'trainer family · owner-confirmed 400',
  },
  stability: {
    label: 'Stability', doctrineRow: 'Stability', lowMi: 400, highMi: 500,
    defaultMi: 400, defaultBasis: 'trainer family · owner-confirmed 400',
  },
  trail: {
    label: 'Trail', doctrineRow: 'Trail (lugged)', lowMi: 300, highMi: 500,
    defaultMi: 400, defaultBasis: 'trainer family · owner-confirmed 400',
  },
  super_shoe: {
    label: 'Super shoe', doctrineRow: 'Super shoe (PEBA)', lowMi: 150, highMi: 250,
    defaultMi: 250, defaultBasis: 'race-day · owner-confirmed 250',
  },
  racing_flat: {
    label: 'Racing flat', doctrineRow: 'Racing flat', lowMi: 200, highMi: 300,
    defaultMi: 250, defaultBasis: 'race-day · owner-confirmed 250',
  },
  tempo_trainer: {
    label: 'Tempo trainer', doctrineRow: 'Tempo / speed trainer', lowMi: 300, highMi: 400,
    defaultMi: 350, defaultBasis: 'neither anchor names it · midpoint of its own band',
  },
  track_spike: {
    label: 'Track spike', doctrineRow: 'Track spike', lowMi: 100, highMi: 200,
    defaultMi: 150, defaultBasis: 'neither anchor names it · midpoint of its own band',
  },
};

/**
 * DOCTRINE · `Research/00b-recovery-protocols.md` § "Carbon-Plated Shoe Effect
 * on Recovery": high training volume in super shoes is capped at 1-2 sessions
 * per week, rotating non-plated shoes for daily mileage. Bone and connective
 * tissue still absorb the full load, so "the window saved on muscle damage may
 * be paid back by skeletal load if mileage in super shoes is unbounded."
 *
 * This is a FREQUENCY limit and is NOT the retirement bar — a different signal
 * about a different risk, deliberately not folded into `defaultMi`.
 *
 * NOT WIRED. Nothing reads this yet; it is registered so the number is gated
 * (`FOOTWEAR.super-shoe-session-cap`) before anything depends on it. Wiring it
 * needs no new flag: `shoe_type === 'super_shoe'` identifies a plated shoe, and
 * runs already carry a shoe assignment, so the count is derivable once a
 * surface exists to say it on.
 */
export const SUPER_SHOE_MAX_SESSIONS_PER_WEEK = 2;

export const SHOE_TYPES = Object.keys(SHOE_LIFESPAN) as ShoeType[];

/**
 * What an untyped shoe is treated as. Every shoe predating the `shoe_type`
 * column is untyped, and the daily trainer is both the category that "absorbs
 * the majority (60-80%) of weekly mileage" (Research/17) and the one whose
 * default (400) matches what those rows were already drawn against — so this
 * is the choice that moves nobody's existing progress bar.
 */
export const DEFAULT_SHOE_TYPE: ShoeType = 'daily_trainer';

/** True for a string that names a real category. */
export function isShoeType(v: unknown): v is ShoeType {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SHOE_LIFESPAN, v);
}

/** Narrow an unknown (a DB text column, a request body) to a category. */
export function coerceShoeType(v: unknown): ShoeType {
  return isShoeType(v) ? v : DEFAULT_SHOE_TYPE;
}

/**
 * The default retirement mileage for a category. A CONVENTION inside the
 * doctrine band, not a doctrine value — see the file header.
 */
export function defaultCapMi(type: ShoeType | null | undefined): number {
  return SHOE_LIFESPAN[coerceShoeType(type)].defaultMi;
}

/**
 * THE resolver. Every surface that draws a shoe against a retirement target
 * calls this and nothing else.
 *
 * An explicit `mileage_cap` always wins — a runner who set a number knows
 * something about that pair we do not. Zero and negative caps are treated as
 * unset rather than honoured: a cap of 0 makes percent-used infinite, which is
 * how a "0 mi" typo becomes a shoe that reads 100% used on its first run.
 */
export function resolveShoeCapMi(
  type: ShoeType | string | null | undefined,
  explicitCapMi: number | string | null | undefined,
): number {
  const explicit = explicitCapMi == null ? NaN : Number(explicitCapMi);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return defaultCapMi(coerceShoeType(type));
}

/**
 * Percent of a shoe's life used, 0-100+, rounded. Deliberately NOT clamped at
 * 100 — a shoe 40% past its retirement mileage should say so rather than sit
 * at a full bar looking the same as one that just arrived there.
 */
export function shoePctUsed(
  mileageMi: number,
  type: ShoeType | string | null | undefined,
  explicitCapMi: number | string | null | undefined,
): number {
  const cap = resolveShoeCapMi(type, explicitCapMi);
  if (!(cap > 0)) return 0;
  return Math.round((mileageMi / cap) * 100);
}
