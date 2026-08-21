/**
 * components/faff-app/Modelled.tsx · RULE ONE on the web surface.
 *
 *   "A modelled number must never look measured. This is the only real sin.
 *    A projected finish, a pace derived from training rather than a race, a
 *    projection after time off — all modelled. The amber tilde is the mark,
 *    and it is a system rule rather than one screen's fix."
 *
 * ── why this file exists · 2026-08-21 web audit ──────────────────────────
 *
 * The phone has `FaffValue`, whose whole point is that it has no untyped
 * initialiser: a number cannot reach a view without naming its basis.
 * `scripts/check-modelled-mark.sh` guards the composers that feed it.
 *
 * Web had none of that. `grep -riE "modelled|modeled" web-v2/components/`
 * returned zero hits before this file. Web's substitute was an adjacent
 * uppercase word — PROJECTED, FROM TODAY'S FITNESS — applied inconsistently,
 * plus a hand-typed `~` in a handful of places and absent in comparable
 * ones. The results a runner actually saw:
 *
 *   · TrainView printed the projected marathon finish at 46px through a
 *     class LITERALLY NAMED `amber`, which a 2026-06-01 design pass had
 *     overridden to `#F6F7F8` — the same near-white as every measured
 *     number on the page. The class name asserted the provenance; the rule
 *     it selected removed it.
 *   · The Workout drawer ran `.replace('~','')` on an estimate the composer
 *     had marked, so the detail view a runner opens to look CLOSER was the
 *     less honest of the two.
 *   · One function gave `~168 bpm` to a tempo HR ceiling and `< 144 bpm` to
 *     an easy one — two outputs of the same zone model, one marked, one
 *     printed as a hard threshold.
 *
 * ── what this is, and what it deliberately is not ────────────────────────
 *
 * This is the MARK, not a provenance type. A real fix carries the basis on
 * the value from the composer down, the way `FaffValue` does, and `FaffSeed`
 * has no field for it on any number — that is a bigger change than one
 * audit should make to a 2,600-line seed composer, and it is written up as a
 * finding rather than half-done here. What this gives the web surface is the
 * thing rule one actually names: one place the mark is drawn, one token it
 * is drawn in, and a CI guard that stops it being stripped downstream.
 *
 * The hex is web's own. Brief v2 governs this surface and the phone's
 * `#F2B03C` is not in web's ten-colour table; `--eyebrow` / `#F3AD38` is
 * the locked Attention amber and is what `check-palette-sync.sh` allows.
 */

import type { ReactNode } from 'react';

/** The mark. One definition · nothing else may type this character. */
export const MODELLED_MARK = '~';

/**
 * Wrap a number the engine MODELLED rather than measured.
 *
 * The mark is its own span in Attention amber so it reads as an annotation
 * on the value rather than a character in it, and so it cannot be copied,
 * truncated or formatted away with the digits.
 *
 * `title` is the plain-English basis. It is optional only because some call
 * sites already carry the basis in a visible label beside them; where there
 * is no such label, pass one.
 */
export function Modelled({
  children,
  title,
  markStyle,
}: {
  children: ReactNode;
  title?: string;
  /** Escape hatch for heroes where the mark needs its own tracking.
   *  Colour and SIZE are not overridable · see the notes below. */
  markStyle?: Omit<React.CSSProperties, 'color' | 'WebkitTextFillColor' | 'fontSize'>;
}) {
  return (
    <span title={title ?? 'Modelled, not measured'}>
      <span
        aria-hidden="true"
        style={{
          ...markStyle,
          // `-webkit-text-fill-color` BEATS `color` wherever it is set, and
          // it is set: `.train2 .proj .pjbig.amber` in globals.css paints
          // `-webkit-text-fill-color:#F6F7F8` to kill an old gold gradient.
          // Setting colour alone left the mark the same white as the digits,
          // which is precisely the failure this component exists to stop.
          color: 'var(--eyebrow, #F3AD38)',
          WebkitTextFillColor: 'var(--eyebrow, #F3AD38)',
          // Near full size on purpose. At 0.62em against a 46px Oswald
          // numeral the tilde sits low and thin and reads as a MINUS —
          // "-3:31:48" — which is not merely unmarked but actively wrong
          // about the number's sign. A mark that can be misread as an
          // operator is worse than no mark.
          fontSize: '0.86em',
          // The tilde's own advance is narrow; a little air keeps it from
          // touching the first digit and being read as part of it.
          marginRight: '0.1em',
        }}
      >
        {MODELLED_MARK}
      </span>
      {children}
    </span>
  );
}
