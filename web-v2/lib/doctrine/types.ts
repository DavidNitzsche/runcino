/**
 * lib/doctrine/types.ts · the shape of a doctrine claim.
 *
 * A claim binds one training-science ASSERTION IN THE ENGINE to the passage in
 * `Research/` that justifies it. The gate then checks two things that are
 * usually checked by nobody:
 *
 *   1. The citation still resolves. The passage is still in the doc, still says
 *      what the claim says it says, and the table still has the row and column
 *      the claim reads.
 *   2. The engine still satisfies the claim — and, wherever possible, the
 *      expected numbers are READ OUT OF THE DOC at run time rather than
 *      hand-copied into the test. A claim that hardcodes both sides is a claim
 *      that can drift from doctrine without anyone noticing, which is the exact
 *      failure this gate exists to stop.
 */
import type { ResolvedCitation } from './resolve';

export interface ClaimContext {
  /** The doctrine passage this claim cites, already located and parsed. */
  cite: ResolvedCitation;
  /**
   * True when `key` is on this claim's exemption list. Consulting an exemption
   * MARKS IT USED · an exemption nobody consults is reported as stale and the
   * gate tells you to delete it. Exemptions cannot rot quietly.
   */
  exempt(key: string): boolean;
}

export interface DoctrineClaim {
  /**
   * Stable identifier, `AREA.claim-in-kebab`. Never reuse an id for a different
   * claim · ids appear in failure messages and in commit archaeology.
   */
  id: string;
  /**
   * The engine assertion this binds, as `path#symbol`. Informational, but keep
   * it accurate: it is the first thing someone reads when the gate fails.
   */
  binds: string[];
  /** Doctrine file, repo-relative. */
  doc: string;
  /**
   * VERBATIM text from `doc` that pins the claim. Prefer a table header row or
   * a section heading — something that changes only when the doctrine itself
   * changes. Never a line number.
   */
  anchor: string;
  /** What doctrine says, in one plain sentence. No jargon, no hedging. */
  claim: string;
  /** Throws when the engine no longer satisfies `claim`. */
  check(ctx: ClaimContext): void;
  /**
   * Sub-cases the engine currently violates, `key` → why it is recorded rather
   * than fixed. Every entry here is a KNOWN VIOLATION, not an opinion that
   * doctrine is wrong. Entries are checked for staleness: fix the engine and
   * the gate makes you delete the exemption.
   */
  exempt?: Record<string, string>;
}
