/**
 * lib/verify/_audit_credential_binding.audit.test.ts · the credential the
 * production audits SKIP on is the credential they CONNECT with.
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
 * The per-file workaround (`process.env.DATABASE_URL = RO` inside a test body)
 * fails on intra-file ORDER, not on a race — see `vitest.setup.ts`'s own
 * corrected paragraph. Vitest isolates the module registry per FILE, and a
 * file's static import graph is evaluated before its body, so the assignment
 * is deterministically too late in every file that reaches `lib/db/pool` at
 * any import depth.
 *
 * ── WHY THIS FILE IS NAMED `*.audit.test.ts` (AUDITRO-2, 2026-09-13) ─────────
 *
 * It was `_audit_credential_binding.test.ts`. `audit-suite.yml` selects its
 * files with `git ls-files 'lib/**\/*.audit.test.ts'`, so the gate for that
 * job's own credential was the one file that job never ran. It ran only in
 * `test-full`, which deliberately has no secrets — and there its single
 * load-bearing assertion opened with `if (!process.env.DATABASE_URL_RO)
 * return;` and asserted nothing. A gate that runs only where it cannot fail,
 * and is excluded from the job it protects, is Rule 18's central case with
 * both halves at once.
 *
 * It carries no `describe.skipIf` on purpose: it needs no database, and it is
 * exactly as meaningful in a job with no credential as in one with a
 * credential. That is what AUDITRO-2 changed.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT CANNOT TELL YOU AN AUDIT ASSERTED ANYTHING. It proves the connection
 *     string is bound, not that any file used it. The per-file LIVENESS tests
 *     own that, and this exists so they are asking a fair question.
 *   · IT CANNOT SEE THE WORKFLOW'S SECRETS. If someone removes
 *     `DATABASE_URL_RO` from `audit-suite.yml`, that job's own tri-state step
 *     reports BLOCKED_MISSING_CREDENTIAL; nothing here notices. It DOES now
 *     check the workflow's FILE SELECTION, because that is what excluded this
 *     file in the first place.
 *   · IT DOES NOT ASSERT THE TARGET IS PRODUCTION. A loopback `DATABASE_URL`
 *     satisfies it, deliberately — the local harnesses depend on that.
 *   · IT CANNOT CATCH A SETUP FILE THAT IS NEVER LOADED. `vitest.config.ts`'s
 *     `setupFiles` entry is the thing that makes any of this run, and nothing
 *     here reads it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { resolveCredentialBinding } from './ro-credential';

describe('audit credential binding', () => {
  it('DECISION · all three credential shapes, in every job, with no credential needed', () => {
    /* AUDITRO-2. This is the assertion that used to early-return. It drives
     * `lib/verify/ro-credential.ts` — the SAME function `vitest.setup.ts`
     * applies (Rule 16, no re-typed copy) — over every shape of environment,
     * so it is exactly as live in `test-full` (no secrets) as in
     * `audit-suite` (one secret).
     *
     * Rule 11 in three rows: "no credential", "read-only only" and "already
     * explicit" are three facts and each must reach its own answer. */
    expect(resolveCredentialBinding({}).action).toBe('no-credential');
    expect(resolveCredentialBinding({ DATABASE_URL_RO: 'postgres://ro' }).action)
      .toBe('bind-read-only');
    expect(resolveCredentialBinding({ DATABASE_URL: 'postgres://rw' }).action)
      .toBe('keep-explicit');
    // The one that matters most: an explicit URL is NEVER clobbered, even
    // when a read-only one is also present. The loopback harnesses depend on
    // this and would write to production without it.
    expect(resolveCredentialBinding({
      DATABASE_URL: 'postgres://localhost/scratch',
      DATABASE_URL_RO: 'postgres://ro',
    }).action).toBe('keep-explicit');
    // Empty string is not a credential. `${{ secrets.X }}` interpolates to ''
    // when the secret is absent, which is precisely how CI presents "missing".
    expect(resolveCredentialBinding({ DATABASE_URL: '', DATABASE_URL_RO: '' }).action)
      .toBe('no-credential');
  });

  it('LIVE · after setup ran, nothing is left to bind — in ANY environment', () => {
    /* The invariant, asserted on the LIVE process, in every worker and every
     * job. `vitest.setup.ts` has already applied the decision by the time any
     * test module is evaluated, so asking again must never answer
     * `bind-read-only`: that answer means the credential is configured and
     * still unreachable, which is the exact fourth state AUDITRO-1 is about.
     *
     * No early return. With no credential at all the answer is
     * `no-credential` and this still asserts; with `DATABASE_URL_RO` and no
     * binding it goes red, which is the whole point — before the repair that
     * same environment produced a green tick beside seven assertions that
     * never executed. */
    const live = resolveCredentialBinding(process.env);
    expect(
      live.action,
      'DATABASE_URL_RO is set but DATABASE_URL is not — every *.audit.test.ts ' +
      'skip-guard will open while lib/db/pool falls back to localhost, and the ' +
      'assertions that early-return on a missing database will report green ' +
      'having asserted nothing. See vitest.setup.ts, AUDITRO-1.',
    ).not.toBe('bind-read-only');
    expect(['keep-explicit', 'no-credential']).toContain(live.action);
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

    // It goes through the ONE decision function, and applies it.
    expect(code).toMatch(/resolveCredentialBinding\s*\(\s*process\.env\s*\)/);
    expect(code).toMatch(/['"]bind-read-only['"]/);
    expect(code).toMatch(/process\.env\.DATABASE_URL\s*=\s*process\.env\.DATABASE_URL_RO/);
    // And the assignment is GUARDED by that decision, not standing alone.
    const bind = code.indexOf('process.env.DATABASE_URL = process.env.DATABASE_URL_RO');
    expect(bind).toBeGreaterThan(-1);
    const guard = code.lastIndexOf('resolveCredentialBinding', bind);
    expect(guard).toBeGreaterThan(-1);
    expect(bind - guard).toBeLessThan(200);
  });

  it('WIRING · the job whose credential this protects actually selects this file', () => {
    /* AUDITRO-2, and the finding that earned this test: the gate was named
     * `_audit_credential_binding.test.ts`, and `audit-suite.yml` selects
     * `lib/**\/*.audit.test.ts`. So the check for that job's own credential was
     * excluded from that job by one missing filename segment, silently, with
     * nothing anywhere able to say so.
     *
     * Read the glob OUT OF THE WORKFLOW at run time rather than hardcoding it
     * (Rule 18: a check that hardcodes both sides only proves it agrees with
     * itself), then apply it to this file's own name. Renaming this file, or
     * narrowing that glob, fails here. */
    const wf = fs.readFileSync(
      new URL('../../../.github/workflows/audit-suite.yml', import.meta.url), 'utf8');
    const m = /git ls-files\s+'([^']+)'/.exec(wf);
    expect(m, 'audit-suite.yml no longer selects its files with `git ls-files \'<glob>\'`')
      .not.toBeNull();
    const glob = m![1];
    // `lib/**/*.audit.test.ts` → anchored regex over the repo-relative path
    // this job sees (it runs with working-directory: web-v2).
    const rx = new RegExp('^' + glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '(?:.*/)?')
      .replace(/\*/g, '[^/]*') + '$');
    const selfPath = 'lib/verify/' + new URL(import.meta.url).pathname.split('/').pop()!;
    expect(rx.test(selfPath),
      `audit-suite.yml selects '${glob}', which does not match '${selfPath}' — ` +
      'this gate would not run in the job it exists to protect.').toBe(true);
    // LIVENESS (Rule 18 clause 2): both files were really read, and the glob
    // really is a glob rather than an empty string that matches everything.
    expect(wf.length).toBeGreaterThan(1000);
    expect(glob).toContain('.audit.test.ts');
    // Falsification anchor: the same regex must REJECT the old name, or it is
    // not telling the two apart and the assertion above proves nothing.
    expect(rx.test('lib/verify/_audit_credential_binding.test.ts')).toBe(false);
  });

  it('LIVENESS · this gate read a real file and a real environment', () => {
    const src = fs.readFileSync(new URL('../../vitest.setup.ts', import.meta.url), 'utf8');
    expect(src.length).toBeGreaterThan(1000);
    expect(Object.keys(process.env).length).toBeGreaterThan(0);
    // The decision module is real code, not a stub that answers one way.
    const shapes = new Set([
      resolveCredentialBinding({}).action,
      resolveCredentialBinding({ DATABASE_URL_RO: 'x' }).action,
      resolveCredentialBinding({ DATABASE_URL: 'x' }).action,
    ]);
    expect(shapes.size).toBe(3);
  });
});
