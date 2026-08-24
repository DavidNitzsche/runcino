/**
 * lib/plan/day-note.ts — the sentence the plan wrote for THIS day.
 *
 * `plan_workouts.notes` is NOT NULL and populated on every row the engine has
 * ever written: 4431 of 4431 in production on 2026-08-24. The generator authors
 * it per day, keyed on what that day is FOR — "Extra rest · still recovering.",
 * "Long run back · easy effort.", "Recovery easy · conversational, no surges."
 *
 * Nothing read it. `week-loader.ts` selected `id, date_iso, dow, type,
 * distance_mi, sub_label`; `mutate.ts` and `seal.ts` read it only to write it
 * back unchanged; `run-state.ts` selected `pw.notes` in a query that then used
 * `pw.type` and dropped the rest. Meanwhile Today composed its own copy from
 * `derivePurpose`, a function keyed on the workout TYPE, which is why a rest
 * day three days after a half marathon and a rest day in week two of base
 * printed the same sentence.
 *
 * This is the second of the three instances found on 2026-08-24. The first
 * (`plan_phases.rationale`) is now read by this same composer; the third
 * (`lib/plan/block-preview.ts`) is still dead. See
 * `lib/audit/generated-content.ts` for the gate that stops a fourth.
 */
import { pool } from '@/lib/db/pool';

/**
 * House punctuation, applied at the READ boundary.
 *
 * Rule four bans the em dash, and `check-coach-voice.sh` enforces it across
 * every source file that authors runner-facing copy. It cannot reach a
 * database. Production holds rows written before that gate existed — "Easy run
 * — conversational pace, full stop.", "Cutback easy — shorter, slower, no
 * agenda." — and the moment this column reaches a screen those become copy the
 * runner reads. No live writer produces them any more (every `notes:` literal
 * in `generate.ts` uses the middot), so this is a one-way repair of history,
 * not a licence to keep writing them.
 */
export function houseVoice(text: string): string {
  return text
    .replace(/\s*—\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The engine's note for one plan day, or null when the day has no row. */
export async function loadDayNote(planId: string, dateISO: string): Promise<string | null> {
  const row = (await pool.query<{ notes: string | null }>(
    `SELECT pw.notes
       FROM plan_workouts pw
      WHERE pw.plan_id = $1 AND pw.date_iso = $2
      ORDER BY pw.distance_mi DESC NULLS LAST
      LIMIT 1`,
    [planId, dateISO],
  ).catch(() => ({ rows: [] as Array<{ notes: string | null }> }))).rows[0];
  const raw = row?.notes?.trim();
  if (!raw) return null;
  return houseVoice(raw);
}

/** Is `candidate` already said by `text`? Punctuation- and case-insensitive. */
function alreadySaid(text: string, candidate: string): boolean {
  const flatten = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const hay = flatten(text);
  const needle = flatten(candidate);
  if (!needle) return true;
  return hay.includes(needle);
}

export interface WhyParts {
  /** `plan_phases.rationale` — why this BLOCK. */
  phaseRationale: string | null;
  /** `plan_workouts.notes` — why THIS DAY. */
  dayNote: string | null;
  /** `derivePurpose`'s one-word restatement of the type. */
  verdict: string | null;
  /** `derivePurpose`'s generic facts, the fallback when the plan said nothing. */
  facts: string[];
}

/**
 * Compose the "why this run" line, most-general first.
 *
 * ORDER — the phase rationale leads (David's ruling of 2026-08-21: the block's
 * reason is the answer to "why", the session description is not), then the
 * day's own note, then the generic layer.
 *
 * The generic layer is a FALLBACK, not an addition. `derivePurpose` is keyed on
 * the workout type alone; once the plan has said what the day is for in its own
 * words, repeating "Easy day. Conversational pace · should feel like nothing."
 * underneath adds nothing and is the padding David objected to. So when a day
 * note exists, the verdict and facts are dropped unless they say something the
 * two authored sentences did not.
 */
export function composeWhy(parts: WhyParts): string {
  const out: string[] = [];
  const push = (candidate: string | null | undefined) => {
    const s = candidate?.trim();
    if (!s) return;
    const sofar = out.join(' ');
    if (alreadySaid(sofar, s)) return;
    out.push(s);
  };

  push(parts.phaseRationale);
  push(parts.dayNote);

  if (parts.dayNote) {
    // THE PLAN HAS SPOKEN. The generic layer stops here, and it has to.
    //
    // `derivePurpose` is keyed on the workout TYPE and nothing else, so its
    // facts are written for the average week that type appears in. Printed
    // after two authored sentences they are at best a repetition and at worst
    // a contradiction. Both were live on this runner's screen:
    //
    //   easy · "Recovery easy · conversational, no surges." then
    //          "Conversational pace · should feel like nothing." — twice.
    //   long · "Long run back · easy effort." then "The long run is the single
    //          most important run of your marathon week." — during a post-race
    //          RECOVERY block, where it is simply not true.
    //
    // Short and direct beats complete. The prescription, the fuelling and the
    // pace band all have their own places on the screen; this line answers why.
    return out.join(' ');
  }

  // No day note (no active plan, or a synthesised day with no row). Keep the
  // behaviour that shipped on 2026-08-24: the phase rationale often ends "Easy
  // running only · no quality" and the verdict is the single word "Easy day.",
  // which printed together says easy three times.
  const verdictIsRedundant =
    !!parts.phaseRationale
    && /easy running only/i.test(parts.phaseRationale)
    && /^easy day\.?$/i.test((parts.verdict ?? '').trim());
  if (!verdictIsRedundant) push(parts.verdict);
  for (const f of parts.facts) push(f);
  return out.join(' ');
}
