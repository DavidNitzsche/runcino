/**
 * lib/db/read.ts · a failure is not an answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INCIDENT
 *
 * `plan_workouts.date_iso` is a TEXT day key. Four shipped queries compared it
 * against a `date` or a `timestamp`. Postgres refuses that outright —
 * `operator does not exist: text >= timestamp with time zone` — and all four
 * wrapped the call in `.catch(() => empty)`.
 *
 * So a hard type error became an empty result, and an empty result is a
 * perfectly good answer. The drift monitor's whole pace axis had never fired
 * for any runner and reported that as "no drift". `runner_calibration
 * .data_quality` sat at `cold-start` for every runner because the `>= 3 →
 * building` gate counted a number that was an error. Nobody noticed for months,
 * because A SWALLOWED FAILURE AND AN HONEST NOTHING ARE THE SAME VALUE. Every
 * test passed. Every gate was green.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE IS FOR
 *
 * One question, asked at every database read: can the caller tell "we looked
 * and there is nothing" apart from "we failed to look"?
 *
 *   · `attempt`  — the honest primitive. Returns a tagged result. The caller
 *                  must branch, so it cannot accidentally treat a failure as
 *                  an answer.
 *   · `rowsOrNull` / `rowOrNull` / `valueOrNull`
 *                — for readers whose consumers treat `null` as UNKNOWN and an
 *                  empty array / zero as MEASURED. `null` is the distinguishable
 *                  failure; the empty array stays available for the honest
 *                  nothing.
 *   · `rowsOrEmpty` — the deliberate, argued escape hatch. It STILL LOGS. Use
 *                  it only where absent and failed are genuinely the same to
 *                  every consumer, and say why at the call site.
 *
 * Every one of them logs on failure. That is the floor: a database call may
 * fail, but it may never fail invisibly.
 *
 * The gate that enforces this is `scripts/check-swallowed-failure.sh`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SIBLING · `lib/route/failure.ts`
 *
 * That file is the ROUTE half of the same rule: once a load-bearing read has
 * failed, `outage()` is how the response says so without looking like a
 * refusal. This file is the READ half: how the failure survives long enough to
 * reach it, instead of turning into `[]` two frames earlier.
 */
import type { QueryResultRow } from 'pg';

/** A read that either produced a value or named its failure. Never both. */
export type Attempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

function asError(e: unknown): Error {
  if (e instanceof Error) return e;
  return new Error(typeof e === 'string' ? e : JSON.stringify(e));
}

/**
 * The line every failed read prints. One prefix, so prod logs are greppable:
 *
 *     [db/read] FAILED <label> · <pgcode> · <message>
 *
 * `code` is Postgres's SQLSTATE when there is one. `42883` (operator does not
 * exist), `42703` (column does not exist), `42P01` (relation does not exist)
 * and `42804` (datatype mismatch) are the four that produced the incident —
 * every one of them is a bug in the query, never a fact about the runner.
 */
export function logReadFailure(label: string, e: unknown): Error {
  const err = asError(e);
  const code = (e as { code?: string } | null)?.code;
  console.error(
    `[db/read] FAILED ${label} · ${code ?? 'no-sqlstate'} · ${err.message}`,
  );
  return err;
}

/** SQLSTATEs that always mean "the query is wrong", never "the runner has no data". */
const QUERY_IS_WRONG = new Set([
  '42883', // undefined_function — includes `operator does not exist`
  '42703', // undefined_column
  '42P01', // undefined_table
  '42804', // datatype_mismatch
  '42P08', // ambiguous_parameter — `inconsistent types deduced for parameter $n`
  '42P18', // indeterminate_datatype
  '42601', // syntax_error
  '42P02', // undefined_parameter
]);

/**
 * True when this rejection is a defect in the SQL rather than a condition of
 * the data or the connection. Exposed so a caller can choose to be louder about
 * the class that has already cost this app four shipped features.
 */
export function isQueryDefect(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return typeof code === 'string' && QUERY_IS_WRONG.has(code);
}

/**
 * Run a read and tag the outcome. The caller has to open the box.
 *
 *     const r = await attempt('drift/pace-window', pool.query(SQL, args));
 *     if (!r.ok) return { paceDrift: null, reason: 'unavailable' };
 *     …r.value.rows…
 */
export async function attempt<T>(label: string, p: Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: logReadFailure(label, e) };
  }
}

/**
 * Rows, or `null` when the read FAILED. An empty array still means "looked,
 * found nothing" — that distinction is the entire point.
 */
export async function rowsOrNull<R extends QueryResultRow>(
  label: string,
  p: Promise<{ rows: R[] }>,
): Promise<R[] | null> {
  const r = await attempt(label, p);
  return r.ok ? r.value.rows : null;
}

/**
 * The first row, `undefined` when the read succeeded and matched nothing, and
 * `null` when the read failed. Three states, because there are three.
 */
export async function rowOrNull<R extends QueryResultRow>(
  label: string,
  p: Promise<{ rows: R[] }>,
): Promise<R | undefined | null> {
  const r = await attempt(label, p);
  return r.ok ? r.value.rows[0] : null;
}

/**
 * Rows, or `[]` when the read failed — the shape the incident shipped, kept
 * ONLY for reads where absent and failed are genuinely the same to every
 * consumer, and LOUD either way.
 *
 * If you reach for this, write the sentence that says why at the call site. If
 * you cannot write that sentence, the answer is `rowsOrNull`.
 */
export async function rowsOrEmpty<R extends QueryResultRow>(
  label: string,
  p: Promise<{ rows: R[] }>,
): Promise<R[]> {
  return (await rowsOrNull(label, p)) ?? [];
}
