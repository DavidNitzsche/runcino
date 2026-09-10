/**
 * lib/observability/types.ts · the failure-class taxonomy.
 *
 * David's explicit requirement: distinguish EDGE, APPLICATION, DATABASE/POOL,
 * UPSTREAM and CLIENT-TIMEOUT failures. This is Rule 11 ("don't know",
 * "measured zero" and "the read failed" are three facts, never one") applied
 * to failure diagnosis — a 502 is not one fact, it is one of several
 * different facts wearing the same HTTP status code, and collapsing them
 * into a generic "error" bucket is exactly the defect this module exists to
 * avoid repeating.
 *
 * `UNKNOWN` is a sixth, deliberate member: "the classifier could not tell"
 * is itself a different fact from "we determined this was APPLICATION", and
 * must never be silently coerced into whichever bucket happens to be the
 * catch-all elsewhere in the app (`classify.ts`'s own header explains why
 * APPLICATION is still the default for an ordinary thrown Error with no
 * recognized signature, and why that is a judgement call, not a UNKNOWN
 * dodge).
 */
export type FailureClass =
  | 'EDGE'
  | 'APPLICATION'
  | 'DATABASE_POOL'
  | 'UPSTREAM'
  | 'CLIENT_TIMEOUT'
  | 'UNKNOWN';

export const ALL_FAILURE_CLASSES: readonly FailureClass[] = [
  'EDGE', 'APPLICATION', 'DATABASE_POOL', 'UPSTREAM', 'CLIENT_TIMEOUT', 'UNKNOWN',
];

export interface ClassifiedFailure {
  failureClass: FailureClass;
  /** Short, human-readable reason the classifier picked this bucket — the
   *  audit trail for "how do we know", stored in `metadata.detail`. */
  detail: string;
  /** Only meaningful when failureClass === 'UPSTREAM'. */
  upstreamService?: string;
}
