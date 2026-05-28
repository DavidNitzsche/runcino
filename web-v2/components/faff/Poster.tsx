'use client';

/**
 * Poster · the gradient hero card. Verb top-left, stat trio bottom.
 * Spec: design/components/Poster.md
 *
 * Renders the resolver's `PosterPayload` directly · zero state derivation
 * client-side. The component decides VISUAL composition based on which
 * fields are present (heroNumber for LONG, choiceRow for MISSED,
 * daysCountdown for RACE-WEEK).
 */

import type { PosterPayload } from '@/lib/faff/types';
import { StatTrio } from './StatTrio';
import { STATE_GRADIENT_VAR } from '@/lib/faff/state-tokens';
import styles from './Poster.module.css';

export interface PosterProps {
  payload: PosterPayload;
}

export function Poster({ payload }: PosterProps) {
  const gradient =
    // Prefer the server-emitted token if it resolves to one we know;
    // fall back to the state-keyed map. The server's `gradient_token`
    // field is the contract; this client mapping is the safety net.
    STATE_GRADIENT_VAR[payload.state] ?? `var(--g-${payload.gradient_token})`;

  // The verb · screen readers should get sentence-case so caps aren't
  // spelled letter-by-letter (per CoachVoice.md §"Caps headline a11y").
  const verbAria = toSentenceCase(payload.verb);

  return (
    <article
      className={styles.poster}
      style={{ background: gradient }}
      data-state={payload.state}
      aria-labelledby="poster-headline"
    >
      <div className={styles.eyebrow}>{payload.eyebrow}</div>

      {payload.hero_number ? (
        <HeroNumber id="poster-headline" heroNumber={payload.hero_number} />
      ) : (
        <h1
          id="poster-headline"
          className={styles.verb}
          // Per design/typography/audits/sprint-02-type-fit-audit.md §4
          // (P0 INTERVALS truncation fix): `data-verb-length` selects the
          // responsive clamp() range in Poster.module.css so medium-length
          // verbs (INTERVALS., THRESHOLD., NAILED IT., …) fit single-line
          // on Phone SE, and long/very-long verbs get a 0.92 line-height
          // bump when they wrap (framework.md §2.1 · Oswald-tuned).
          data-verb-length={classifyVerbLength(payload.verb)}
          aria-label={verbAria}
        >
          {renderVerb(payload.verb)}
          {payload.verb_suffix && (
            <span className={styles.verbSuffix}>{payload.verb_suffix}</span>
          )}
        </h1>
      )}

      {payload.phase_tag && <div className={styles.phaseTag}>{payload.phase_tag}</div>}

      {payload.prose && <p className={styles.prose}>{payload.prose}</p>}

      {payload.days_countdown && (
        <div className={styles.daysCountdown}>
          <span className={`${styles.daysNumber} tabular`}>{payload.days_countdown.days}</span>
          <span className={styles.daysLabel}>
            {payload.days_countdown.days === 1 ? 'DAY' : 'DAYS'}
          </span>
          <span className={styles.daysDate}>{payload.days_countdown.dateLabel}</span>
        </div>
      )}

      {payload.choice_row && <ChoiceRow row={payload.choice_row} />}

      {payload.stat_trio && payload.stat_trio.length > 0 && (
        <StatTrio stats={payload.stat_trio} />
      )}
    </article>
  );
}

function HeroNumber({
  id,
  heroNumber,
}: {
  id?: string;
  heroNumber: NonNullable<PosterPayload['hero_number']>;
}) {
  const aria = heroNumber.unit
    ? `${heroNumber.value} ${heroNumber.unit.toLowerCase()}`
    : heroNumber.value;
  return (
    <div id={id} className={styles.heroNumber} aria-label={aria}>
      <span className={`${styles.heroNumberValue} tabular`}>{heroNumber.value}</span>
      {heroNumber.unit && <span className={styles.heroNumberUnit}>{heroNumber.unit}</span>}
      {heroNumber.duration && (
        <span className={styles.heroNumberDuration}>~{heroNumber.duration}</span>
      )}
    </div>
  );
}

function ChoiceRow({ row }: { row: NonNullable<PosterPayload['choice_row']> }) {
  return (
    <div className={styles.choiceRow}>
      <button
        type="button"
        className={[
          styles.choiceButton,
          row.recommended === 'catch_up' ? styles.choiceRecommended : '',
        ]
          .filter(Boolean)
          .join(' ')}
        // Action is wired by the page · this scaffold only renders shape.
        data-action="catch_up"
      >
        <span className={styles.choiceLabel}>{row.left.label}</span>
        <span className={styles.choiceSub}>{row.left.sub}</span>
      </button>
      <button
        type="button"
        className={[
          styles.choiceButton,
          row.recommended === 'move_on' ? styles.choiceRecommended : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-action="move_on"
      >
        <span className={styles.choiceLabel}>{row.right.label}</span>
        <span className={styles.choiceSub}>{row.right.sub}</span>
      </button>
    </div>
  );
}

/**
 * Convert a caps verb like `NAILED IT.` to `Nailed it.` for screen
 * readers (per CoachVoice.md §"Caps headline pronunciation").
 *
 * Conservative approach: title-case the first letter of the first word,
 * lowercase the rest. Subsequent words after spaces stay lowercase
 * (the verb is a single short statement; we don't try to detect proper
 * nouns). If a verb needs special pronunciation (e.g. `GO.` already
 * works fine; `5K.` should stay `5K.`) the engine can emit an
 * `aria_label_override` field — TBD with backend.
 */
function toSentenceCase(verb: string): string {
  const lower = verb.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Classify a verb by character count AND wrap-ability for the responsive
 * size formula. Per design/typography/framework.md §3.4 + audits/sprint-02-
 * type-fit-audit.md §4.5 (P0 fix) + Web round 2 follow-up 2026-05-28
 * (medium-singleword split). The five classes map to data-verb-length CSS
 * selectors in Poster.module.css:
 *
 *   short              (≤6 chars)              — REST., GO., TEMPO., BANKED., FADED.
 *   medium-singleword  (7–10, no space)        — INTERVALS., THRESHOLD., SHAKEOUT., WELCOME.
 *   medium             (7–10, has space)       — NAILED IT., RUN EASY., PICK ONE., BACK OFF.
 *   long               (11–15)                 — DISTANCE BANKED., WELCOME BACK., GOOD ENOUGH.
 *   very-long          (16+)                   — EASE OFF TOMORROW., MISSED THE TARGETS.
 *
 * Why the medium-singleword split: at the same char count, a single-word
 * verb has NO wrap point (the only break the engine offers is the period,
 * and we don't break at punctuation). It MUST fit single-line at every
 * tier or it clips against the Poster's overflow: hidden. A space-broken
 * verb of the same length can fall back to a 2-line wrap, so its clamp
 * can be a touch more generous.
 *
 * Character count includes the trailing period and any spaces.
 */
function classifyVerbLength(
  verb: string,
): 'short' | 'medium-singleword' | 'medium' | 'long' | 'very-long' {
  const n = verb.length;
  if (n <= 6) return 'short';
  if (n <= 10) {
    // Strip the trailing period before checking for an internal space.
    // `INTERVALS.` has no spaces → single-word. `NAILED IT.` has a space.
    const body = verb.replace(/\.+$/, '');
    return body.includes(' ') ? 'medium' : 'medium-singleword';
  }
  if (n <= 15) return 'long';
  return 'very-long';
}

/**
 * Render the verb as a single text node — no per-pair span overrides
 * under the v1 Oswald lock-in.
 *
 * Per design/tokens/typography.css (2026-05-28 Oswald 700 lock-in),
 * Oswald handles hero-scale kerning natively. The historical per-pair
 * library in design/typography/framework.md §1.4 (built around Inter 900's
 * L-E, I-T, IT-period gaps) does not apply to v1 Oswald verbs — every v1
 * verb renders correctly at the baseline display recipe alone.
 *
 * The Inter-900-era NAILED IT. special case (three pair overrides) is
 * retired. If a future font swap ever requires per-pair work again, the
 * §1.4 library is retained as historical reference for the analytical
 * method.
 */
function renderVerb(verb: string): string {
  return verb;
}
