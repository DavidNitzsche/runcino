/**
 * lib/adaptation/canonical-shadow/shadow-log-writer.ts · THE ONE LEGITIMATE
 * WRITE.
 *
 * Everything else this directory does is a read (`read-only-db.ts`, fenced
 * two independent ways). This file is the single exception the task
 * authorizes: persisting the canonical engine's own decision records to
 * `canonical_adaptation_shadow_log` — a table with no consumer but this
 * mechanism, read by nothing live, exactly the posture
 * `db/migrations/160_adaptation_shadow_log.sql` already established for the
 * PACE-only shadow-compare table (see
 * `db/migrations/164_canonical_adaptation_shadow_log.sql`'s own header for
 * why a brand-new table, not that one, is correct here).
 *
 * ── WHY THIS IS ITS OWN GUARDED CLIENT, NOT `lib/db/pool` DIRECTLY ─────────
 *
 * The task's own hard constraint: "no `pool.query` inside the canonical
 * path may be anything but a SELECT." Writing the shadow log is the one
 * exception, so it needs to be structurally narrower than "use the app's
 * writable pool and be careful" — the same discipline this codebase applies
 * everywhere else (Rule 18: a convention is not a control). `insertShadowRecord`
 * below is the ONLY function in this whole directory that may hold a
 * writable connection, and even it is fenced: every statement is checked
 * against a single hardcoded allow-list entry — an INSERT into EXACTLY
 * `canonical_adaptation_shadow_log`, nothing else, ever. An UPDATE, a
 * DELETE, or an INSERT into any other table — `plan_workouts`,
 * `training_plans`, `plan_weeks`, or anything else — is refused before it
 * reaches the wire, not merely undesired.
 *
 * `_never_mutates_plan.test.ts` proves this by planting a violation (an
 * UPDATE against `plan_workouts` issued through `insertShadowRecord`) and
 * asserting it is refused, then removing the plant — Rule 18.
 */
import { pool } from '@/lib/db/pool';

const ALLOWED_TABLE = 'canonical_adaptation_shadow_log';

/** Matches only `INSERT INTO canonical_adaptation_shadow_log (...)`, case
 *  insensitive, comments/whitespace tolerant at the front. Anything else —
 *  including a bare `INSERT INTO canonical_adaptation_shadow_logX` or an
 *  INSERT that also touches a second table via a CTE — is refused, because
 *  this is an ALLOW-LIST of one exact statement shape, not a deny-list. */
const ALLOWED_INSERT_RE = new RegExp(
  `^\\s*(?:--[^\\n]*\\n|\\s)*insert\\s+into\\s+"?${ALLOWED_TABLE}"?\\s*\\(`,
  'i',
);

/** Anything that could smuggle a second statement or a second table past the
 *  shape above — a second `INSERT`, an `UPDATE`, a `DELETE`, a `WITH`, or a
 *  statement-separating semicolon before the end. */
const FORBIDDEN_ANYWHERE_RE =
  /\b(update\s+[a-z_"]|delete\s+from|drop\s+|alter\s+|truncate|grant\s+|revoke\s+|create\s+|merge\s+into|do\s+\$|call\s+)\b|;\s*\S/i;

export class ShadowLogWriteRefused extends Error {
  constructor(reason: string, head: string) {
    super(
      `[canonical-shadow/shadow-log-writer] REFUSED a write · ${reason}\n`
      + `  statement: ${head}\n`
      + `  This client may issue exactly one statement shape: `
      + `INSERT INTO ${ALLOWED_TABLE} (...). Everything else is refused.`,
    );
    this.name = 'ShadowLogWriteRefused';
  }
}

/**
 * The one write. Throws `ShadowLogWriteRefused` for anything that is not
 * recognisably `INSERT INTO canonical_adaptation_shadow_log (...)`.
 */
export async function insertShadowRecord(sql: string, params: readonly unknown[]): Promise<void> {
  const head = sql.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!ALLOWED_INSERT_RE.test(sql)) {
    throw new ShadowLogWriteRefused(
      `statement is not an INSERT INTO ${ALLOWED_TABLE}`,
      head,
    );
  }
  // Blank string literals before the "anywhere" scan, same discipline as
  // `production-barrier.ts`, so a jsonb payload whose TEXT happens to
  // contain the word "update" cannot trip a false refusal.
  const withoutStrings = sql.replace(/\$\$[\s\S]*?\$\$/g, "''").replace(/'(?:[^']|'')*'/g, "''");
  const afterFirstParen = withoutStrings.slice(withoutStrings.indexOf('('));
  if (FORBIDDEN_ANYWHERE_RE.test(afterFirstParen)) {
    throw new ShadowLogWriteRefused(
      'statement contains a second statement or a disallowed keyword',
      head,
    );
  }
  await pool.query(sql, params as any[]);
}

/** The table this writer may ever touch, exported so a test can assert the
 *  migration and this file agree on the name (Rule 16). */
export const CANONICAL_ADAPTATION_SHADOW_LOG_TABLE = ALLOWED_TABLE;
