/**
 * lib/verify/_audit_credential_binding.test.ts · the credential the production
 * audits SKIP on is the credential they CONNECT with.
 *
 * AUDITRO-1 (2026-09-13). Rule 20: the repair in `vitest.setup.ts` is a
 * product rule about how this suite reaches production, and a rule with no
 * gate is a hypothesis. This is the gate.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 * Every `*.audit.test.ts` gates itself `describe.skipIf(!process.env
 * .DATABASE_URL_RO)`, and `.github/workflows/audit-suite.yml` supplies exactly
 * that secret. `lib/db/pool.ts` connects on `DATABASE_URL`. So the guard
 * opened, the files ran, and the pool fell back to its localhost default.
 *
 * Two files (`lib/postrun/_postrun_live`, `lib/postrun/_detail_live`) assert
 * `haveDb()` and went honestly red. The other seven assertions in those same
 * files open `if (!await haveDb()) return;` and reported GREEN HAVING ASSERTED
 * NOTHING — inside the one job whose stated principle is "a production audit
 * that did not run is a FAILURE, not a pass."
 *
 * Worse, it was not deterministic: `lib/db/pool` reads the variable once at
 * module evaluation, so the 22 audit files that assign `process.env
 * .DATABASE_URL` inside a test body only reached production when nothing else
 * in their vitest WORKER had imported the pool first.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT CANNOT TELL YOU AN AUDIT ASSERTED ANYTHING. It proves the connection
 *     string is bound, not that any file used it. The per-file LIVENESS tests
 *     own that, and this exists so they are asking a fair question.
 *   · IT CANNOT SEE THE WORKFLOW. If someone removes `DATABASE_URL_RO` from
 *     `audit-suite.yml`, that job's own tri-state step reports
 *     BLOCKED_MISSING_CREDENTIAL; nothing here notices.
 *   · IT DOES NOT ASSERT THE TARGET IS PRODUCTION. A loopback `DATABASE_URL`
 *     satisfies it, deliberately — the local harnesses depend on that.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('audit credential binding', () => {
  it('RUNTIME · a read-only credential is never left unconnected', () => {
    /* The invariant, asserted on the LIVE process rather than on source, in
     * every worker. Falsified by deleting the binding from `vitest.setup.ts`
     * and running with only `DATABASE_URL_RO` exported: this goes red, which
     * is the whole point — before the repair the same environment produced a
     * green tick beside seven assertions that never executed. */
    if (!process.env.DATABASE_URL_RO) return; // nothing to bind; not this gate's question
    expect(
      process.env.DATABASE_URL,
      'DATABASE_URL_RO is set but DATABASE_URL is not — every *.audit.test.ts ' +
      'skip-guard will open while lib/db/pool falls back to localhost, and the ' +
      'assertions that early-return on a missing database will report green ' +
      'having asserted nothing. See vitest.setup.ts, AUDITRO-1.',
    ).toBeTruthy();
  });

  it('SOURCE · the binding is LIVE CODE in the file that runs before every test module', () => {
    /* Belt to the runtime assertion's braces, and the half that still fails on
     * a developer machine where `.env.local` sets `DATABASE_URL` anyway, so the
     * runtime check above can never notice the binding's removal.
     *
     * COMMENTS ARE STRIPPED FIRST, and that is not decoration. Written without
     * the strip, this assertion PASSED against a `vitest.setup.ts` whose
     * binding had been commented out — the exact shape Rule 18 names twice
     * (`check-automatic-mutations.sh` guard 2, satisfied by any comment). It
     * was found by falsifying this gate rather than by reading it. */
    const raw = fs.readFileSync(new URL('../../vitest.setup.ts', import.meta.url), 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')     // block comments
      .replace(/^\s*\/\/.*$/gm, '');        // whole-line comments
    // The whole point: this file's own prose talks about the binding at length,
    // so a check that cannot tell prose from code proves nothing here.
    expect(raw).toContain('AUDITRO-1');
    expect(code).not.toContain('AUDITRO-1');

    // It adopts the RO url, and only when nothing more specific was given.
    expect(code).toMatch(/if\s*\(\s*!process\.env\.DATABASE_URL\s*&&\s*process\.env\.DATABASE_URL_RO\s*\)/);
    expect(code).toMatch(/process\.env\.DATABASE_URL\s*=\s*process\.env\.DATABASE_URL_RO/);
    // And it never clobbers an explicit one — the loopback harnesses rely on it.
    const bind = code.indexOf('process.env.DATABASE_URL = process.env.DATABASE_URL_RO');
    const guard = code.lastIndexOf('!process.env.DATABASE_URL', bind);
    expect(guard).toBeGreaterThan(-1);
    expect(bind - guard).toBeLessThan(200);
  });

  it('LIVENESS · this gate read a real file and a real environment', () => {
    const src = fs.readFileSync(new URL('../../vitest.setup.ts', import.meta.url), 'utf8');
    expect(src.length).toBeGreaterThan(1000);
    expect(Object.keys(process.env).length).toBeGreaterThan(0);
  });
});
