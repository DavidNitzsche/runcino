/**
 * lib/auth/auth-takeover.test.ts
 *
 * 2026-08-21 · backend audit · two unauthenticated paths to somebody else's
 * account, and one that mistook an outage for an expiry.
 *
 * A · APPLE SIGN-IN LINKED ON A FORGEABLE EMAIL
 *   `app/api/auth/apple/route.ts` resolved the account with
 *     const email = (claims.email ?? body.email ?? null) || null;
 *   under a comment claiming the body could not be trusted. Apple sends the
 *   `email` claim on the FIRST authorization only, so for most real tokens the
 *   `??` handed the decision to the request body. `email` then keyed
 *   `SELECT id FROM users WHERE email = $1`, wrote the caller's
 *   `apple_user_id` onto that user's profile, and minted a 90-day session as
 *   them. Any Apple ID that can authorize audience `run.faff.app` was enough,
 *   and the link made it persistent. The invite-only gate never fired — it is
 *   only reached when `userUuid` is still null.
 *
 * B · ADMIN BOOTSTRAP SET A PASSWORD WITHOUT CHECKING ONE
 *   `app/api/auth/email/route.ts` ran, BEFORE any `bcrypt.compare`, a branch
 *   gated only on `is_admin && email_verified_at == null` that hashed and
 *   stored whatever password arrived, then revoked the real admin's sessions.
 *   Production check (faff_readonly, 2026-08-21): the single admin row is
 *   already verified, so nothing is exposed today — but admins are only made
 *   by DDL/seed and every such row is born `email_verified_at IS NULL`, so the
 *   branch reopens on the next admin and stays open until they log in first.
 *
 * C · A DATABASE OUTAGE REPORTED AS AN EXPIRED SESSION
 *   The two coach-proposal routes discarded the response `requireUserId`
 *   built and substituted a hardcoded 401. `requireUserId` answers 503 for an
 *   unreadable sessions table on purpose; the phone clears its Keychain token
 *   on 401 and cannot sign back in, because signing in reads the same table.
 *
 * These are source-level assertions. The exploit is a property of which
 * EXPRESSION the code evaluates, and a mocked-pool round trip would prove
 * only that the mock returned what it was told to.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
/** Strip comments — every fix documents the removed code on purpose. */
const codeOf = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('A · Apple sign-in must not resolve an account from a forgeable email', () => {
  const P = 'app/api/auth/apple/route.ts';

  it('A1 · body.email never feeds the `email` binding', () => {
    const code = codeOf(P);
    // The exact defect: a fallback chain that reaches body.email.
    expect(code).not.toMatch(/claims\.email\s*\?\?\s*body\.email/);
    expect(code).not.toMatch(/body\.email\s*\?\?\s*claims\.email/);
    // And the binding is built from the verified claim alone.
    expect(code).toMatch(/const\s+email\s*:\s*string\s*\|\s*null\s*=\s*\(\s*claims\.email\s*\?\?\s*null\s*\)/);
  });

  it('A2 · body.email is not consulted anywhere in the handler', () => {
    // Ignoring it outright, not merely deprioritising it: an accepted-but-
    // unused field is how this returns.
    expect(codeOf(P)).not.toMatch(/body\??\.email/);
  });

  it('A3 · the account lookup that the email keys is still the sensitive one', () => {
    // Guards the premise. If this SELECT ever moves, A1/A2 stop being the
    // whole story and this test should fail loudly rather than pass hollowly.
    expect(codeOf(P)).toMatch(/FROM users WHERE email = \$1/);
  });
});

describe('B · the admin bootstrap branch must prove something', () => {
  const P = 'app/api/auth/email/route.ts';

  it('B1 · it requires a shared secret, and fails closed when unset', () => {
    const code = codeOf(P);
    expect(code).toMatch(/ADMIN_BOOTSTRAP_TOKEN/);
    // Fail-closed: an unset/empty token can never satisfy the check. Same
    // posture as the thirteen cron routes.
    expect(code).toMatch(/bootstrapToken\.length\s*>\s*0/);
    expect(code).toMatch(/bootstrapHeader\s*===\s*bootstrapToken/);
  });

  it('B2 · it only ever sets a FIRST password, never overwrites one', () => {
    expect(codeOf(P)).toMatch(/userRow\.password_hash\s*==\s*null/);
  });

  it('B3 · the old credential-free condition is gone', () => {
    const code = codeOf(P);
    // The pre-fix gate was exactly these two clauses and nothing else.
    const gate = code.match(/if\s*\(\s*\n?\s*userRow\.is_admin === true[\s\S]{0,400}?\)\s*\{/);
    expect(gate).not.toBeNull();
    expect(gate![0]).toMatch(/bootstrapAuthorised/);
    expect(gate![0]).toMatch(/password_hash/);
  });
});

describe('C · an unreadable database is not an expired session', () => {
  for (const P of [
    'app/api/coach/proposal/[id]/accept/route.ts',
    'app/api/coach/proposal/[id]/decline/route.ts',
  ]) {
    it(`C · ${P} returns what requireUserId built`, () => {
      const code = codeOf(P);
      // The defect: throwing away `auth` and hardcoding 401.
      expect(code).not.toMatch(
        /auth instanceof NextResponse\s*\)\s*\{[\s\S]{0,200}?status:\s*401/,
      );
      // `return auth` — optionally cast to the handler's declared error union,
      // which is a type annotation, not a re-wrap: the status still travels.
      expect(code).toMatch(
        /auth instanceof NextResponse\s*\)\s*\{\s*return auth(?: as NextResponse<\w+>)?;\s*\}/,
      );
    });
  }

  it('C · and no OTHER route reinvents a 401 for a requireUserId failure', () => {
    // The sweep found exactly two. Assert the class stays closed rather than
    // just the two instances.
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const out = execSync(
      `/usr/bin/grep -rl --include=route.ts -A3 -e "auth instanceof NextResponse" app/api | sort -u`,
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    const files = out.split('\n').filter(Boolean);
    // Guard against the harness reporting on itself: if the grep matched
    // nothing, the assertion below would pass while proving nothing.
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => {
      const c = codeOf(f);
      return /auth instanceof NextResponse\s*\)\s*\{[\s\S]{0,200}?status:\s*401/.test(c);
    });
    expect(offenders).toEqual([]);
  });
});
