/**
 * lib/adaptation/canonical-shadow/deferral-writer.ts · THE SECOND LEGITIMATE
 * WRITE, FENCED THE SAME WAY AS THE FIRST.
 *
 * Sibling of `shadow-log-writer.ts`, and deliberately a separate file rather
 * than a widened one: that writer allow-lists EXACTLY ONE statement shape
 * (`INSERT INTO canonical_adaptation_shadow_log (...)`) and adding a second
 * table and a second verb to it would loosen the tightest control in this
 * directory in order to serve an unrelated feature. Two narrow fences beat one
 * wide one.
 *
 * ── WHY THIS ONE NEEDS AN UPDATE AND THE SHADOW LOG DOES NOT ───────────────
 *
 * The shadow log is an append-only record of what the engine DECIDED. The
 * deferral queue is a LEDGER OF OPEN ITEMS: an item is queued, carried across
 * boundaries, and eventually stamped with an expiry. Rows are never deleted —
 * "retired because the block ended" and "silently vanished" are different
 * facts and only one survives a DELETE — so retiring an item is an UPDATE that
 * sets `expired_at`, `expiry_reason` and `expiry_detail`, and the database's
 * own CHECK constraint refuses a row that says "gone" without saying why.
 *
 * So exactly two statement shapes are authorized, both against exactly
 * `canonical_adaptation_deferrals`:
 *
 *   1 · INSERT INTO canonical_adaptation_deferrals (...)   — queue or refresh
 *   2 · UPDATE canonical_adaptation_deferrals SET ...      — stamp an expiry
 *
 * Anything else — any other table, a DELETE, a DROP, a second statement
 * smuggled past a semicolon, a CTE that touches a plan table — is refused
 * BEFORE it reaches the wire, not merely undesired.
 *
 * ── RULE 18 · THIS FENCE HAS BEEN FALSIFIED ────────────────────────────────
 *
 * `_deferral_store.test.ts` plants an `UPDATE plan_workouts` and a
 * `DELETE FROM canonical_adaptation_deferrals` through this function and
 * asserts both are refused with the message quoted in the report, then asserts
 * the two real statement shapes are accepted. A fence that has never refused
 * anything is a hypothesis.
 *
 * ── RULE 22 · WHAT THIS FENCE CANNOT FAIL ON ───────────────────────────────
 *
 * · A CORRECT-SHAPED STATEMENT WITH WRONG CONTENT. An INSERT into the right
 *   table carrying nonsense passes here and is refused, if at all, by the
 *   table's own constraints.
 * · A WRITE ISSUED ANY OTHER WAY. It only fences statements routed through it.
 *   `_never_mutates_plan.test.ts` guard 1 is the other half: it scans this
 *   whole directory's source for any write against any other table.
 */
import { pool } from '@/lib/db/pool';

const ALLOWED_TABLE = 'canonical_adaptation_deferrals';

/** `INSERT INTO canonical_adaptation_deferrals (` — leading comments and
 *  whitespace tolerated, nothing else. */
const ALLOWED_INSERT_RE = new RegExp(
  `^\\s*(?:--[^\\n]*\\n|\\s)*insert\\s+into\\s+"?${ALLOWED_TABLE}"?\\s*\\(`,
  'i',
);

/** `UPDATE canonical_adaptation_deferrals SET` — same tolerance. */
const ALLOWED_UPDATE_RE = new RegExp(
  `^\\s*(?:--[^\\n]*\\n|\\s)*update\\s+"?${ALLOWED_TABLE}"?\\s+set\\s`,
  'i',
);

/**
 * Anything that could smuggle a second statement or a second table past the
 * shapes above, checked over the whole statement with its string literals
 * blanked. `update` and `insert` are IN this list because a legal statement
 * has exactly one of each verb and it is the one the anchored patterns above
 * already matched — so a second occurrence anywhere is a second statement.
 */
const FORBIDDEN_ANYWHERE_RE =
  /\b(delete\s+from|drop\s+|alter\s+|truncate|grant\s+|revoke\s+|create\s+|merge\s+into|do\s+\$|call\s+|with\s+[a-z_"])\b|;\s*\S/i;

export class DeferralWriteRefused extends Error {
  constructor(reason: string, head: string) {
    super(
      `[canonical-shadow/deferral-writer] REFUSED a write · ${reason}\n`
      + `  statement: ${head}\n`
      + '  This client may issue exactly two statement shapes, both against '
      + `${ALLOWED_TABLE}: a queue-row insert, and an expiry stamp. `
      + 'Everything else is refused.',
    );
    this.name = 'DeferralWriteRefused';
  }
}

/** The one write door for the deferral queue. */
export async function writeDeferral(sql: string, params: readonly unknown[]): Promise<void> {
  const head = sql.replace(/\s+/g, ' ').trim().slice(0, 160);
  const isInsert = ALLOWED_INSERT_RE.test(sql);
  const isUpdate = ALLOWED_UPDATE_RE.test(sql);
  if (!isInsert && !isUpdate) {
    throw new DeferralWriteRefused(
      `statement is not one of the two authorized write shapes against ${ALLOWED_TABLE}`,
      head,
    );
  }
  // Blank string literals first, same discipline as `shadow-log-writer.ts`, so
  // a jsonb payload whose TEXT contains the word "delete" cannot trip a false
  // refusal. A deferral's `reason_detail` is a runner-facing sentence and could
  // plausibly contain almost any word.
  const withoutStrings = sql
    .replace(/\$\$[\s\S]*?\$\$/g, "''")
    .replace(/'(?:[^']|'')*'/g, "''")
    // `ON CONFLICT ... DO UPDATE SET` is the upsert half of the SAME INSERT,
    // targeting the SAME table by definition of the clause — it cannot name a
    // second one. Neutralised before the scan rather than excused after it, so
    // the "no second verb anywhere" rule below stays absolute for everything
    // that is genuinely a second statement.
    .replace(/\bdo\s+update\s+set\b/gi, 'do_upsert_set');
  // Scan PAST the verb that has already been matched, so the anchored verb
  // itself is not re-flagged. For an INSERT that is everything from the column
  // list on; for an UPDATE, everything from `SET` on.
  const from = isInsert ? withoutStrings.indexOf('(') : withoutStrings.toLowerCase().indexOf(' set ');
  const rest = withoutStrings.slice(from < 0 ? 0 : from);
  if (FORBIDDEN_ANYWHERE_RE.test(rest) || /\b(insert\s+into|update\s+[a-z_"])/i.test(rest)) {
    throw new DeferralWriteRefused(
      'statement contains a second statement, a second table, or a disallowed keyword',
      head,
    );
  }
  await pool.query(sql, params as unknown[]);
}

/** The table this writer may ever touch, exported so a test can assert the
 *  migration and this file agree on the name (Rule 16). */
export const CANONICAL_ADAPTATION_DEFERRALS_TABLE = ALLOWED_TABLE;
