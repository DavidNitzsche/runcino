/**
 * lib/observability/_fence.test.ts · falsifies
 * `lib/observability/harness/fence.ts`'s connection-string predicate.
 *
 * Pure string logic, no database — safe in the default `npm test` sweep even
 * though the fence exists to protect the SEPARATE harness suite
 * (`lib/observability/harness/*.harness.test.ts`) that does touch a database.
 * Rule 18: a fence that has never been shown to refuse anything is a
 * hypothesis, not a guarantee.
 */
import { describe, expect, it } from 'vitest';
import { inspectConnectionString, OBSERVABILITY_SCRATCH_DB_NAME } from './harness/fence';

describe('inspectConnectionString', () => {
  it('refuses a production-shaped Railway URL', () => {
    const v = inspectConnectionString('postgresql://user:pass@containers-us-west-1.railway.app:5432/railway');
    expect(v.ok).toBe(false);
    expect(v.refusal).toMatch(/not loopback/);
  });

  it('refuses a loopback URL naming the WRONG database', () => {
    const v = inspectConnectionString('postgresql://localhost:5432/faff_sandbox');
    expect(v.ok).toBe(false);
    expect(v.refusal).toMatch(/names database/);
  });

  it('refuses an unset DATABASE_URL rather than defaulting', () => {
    expect(inspectConnectionString(undefined).ok).toBe(false);
    expect(inspectConnectionString(null).ok).toBe(false);
    expect(inspectConnectionString('').ok).toBe(false);
  });

  it('refuses an unparseable URL', () => {
    expect(inspectConnectionString('not a url at all').ok).toBe(false);
  });

  it('accepts the harness\'s own loopback database', () => {
    const v = inspectConnectionString(`postgresql://localhost:5432/${OBSERVABILITY_SCRATCH_DB_NAME}`);
    expect(v.ok).toBe(true);
  });

  it('accepts 127.0.0.1 as loopback too', () => {
    const v = inspectConnectionString(`postgresql://127.0.0.1:5432/${OBSERVABILITY_SCRATCH_DB_NAME}`);
    expect(v.ok).toBe(true);
  });
});
