/**
 * Regression: a password change must end every other live session.
 *
 * Before 2026-08-21 neither password-setting path touched the sessions
 * table. A token minted under the OLD password stayed valid for the rest
 * of its 90-day TTL, so changing a password did not put out anyone who
 * already had access — which is the main reason a person changes one.
 *
 * These assertions fail against the pre-fix code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** Route body with the import block stripped, so `indexOf` finds real
 *  call sites rather than the `import { … }` line naming the same symbol. */
const body = (p: string) => {
  // 2026-08-21 · backend audit · strip COMMENTS as well as imports before the
  // offset scans below. They locate code by `indexOf`, so a doc comment that
  // merely NAMES `revokeAllSessionsForUser` while explaining the branch landed
  // an earlier offset than the call and inverted the ordering assertion — the
  // test was reading prose and reporting on it as if it were code. Stripping
  // comments makes the checks strictly tighter: the symbol now has to appear
  // in an executable position to satisfy them at all.
  const src = read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const lines = src.split('\n');
  const lastImport = lines.reduce((acc, l, i) => (/^import\s/.test(l) ? i : acc), -1);
  return lines.slice(lastImport + 1).join('\n');
};

describe('revokeAllSessionsForUser is shaped correctly', () => {
  const src = read('lib/auth/session.ts');

  it('exists and is exported', () => {
    expect(src).toMatch(/export async function revokeAllSessionsForUser/);
  });

  it('is bound to one user — never a bare token-only revoke', () => {
    const fn = src.slice(src.indexOf('export async function revokeAllSessionsForUser'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
    expect(body).toContain('UPDATE sessions');
    // The single-tenant residue: user_uuid may be null on legacy rows, so
    // the filter has to consider both columns or it silently matches none.
    expect(body).toMatch(/COALESCE\(user_uuid::text, user_id\)\s*=\s*\$1/);
  });

  it('only touches sessions that are still live', () => {
    const fn = src.slice(src.indexOf('export async function revokeAllSessionsForUser'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
    expect(body).toContain('revoked_at IS NULL');
  });

  it('can spare the caller own session, and hashes it before comparing', () => {
    const fn = src.slice(src.indexOf('export async function revokeAllSessionsForUser'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
    // Tokens are stored hashed. Comparing a RAW token against the column
    // would spare nothing and silently sign the caller out.
    expect(body).toMatch(/hashToken\(opts\.exceptToken\)/);
    expect(body).toMatch(/session_token\s*<>\s*\$2/);
  });
});

describe('both password-setting paths call it', () => {
  it('/api/auth/set-password revokes, sparing the caller', () => {
    const src = body('app/api/auth/set-password/route.ts');
    const updateAt = src.indexOf('SET password_hash');
    const revokeAt = src.indexOf('revokeAllSessionsForUser');
    expect(updateAt, 'route still sets the password').toBeGreaterThan(-1);
    expect(revokeAt, 'set-password must revoke other sessions').toBeGreaterThan(-1);
    expect(revokeAt, 'revoke follows the password write').toBeGreaterThan(updateAt);
    expect(src).toContain('exceptToken');
    expect(src).toContain('tokenFromRequest');
  });

  it('the /api/auth/email admin bootstrap branch revokes too', () => {
    const src = body('app/api/auth/email/route.ts');
    const updateAt = src.indexOf('SET password_hash');
    const revokeAt = src.indexOf('revokeAllSessionsForUser');
    expect(updateAt).toBeGreaterThan(-1);
    expect(revokeAt, 'bootstrap branch must revoke other sessions').toBeGreaterThan(-1);
    expect(revokeAt, 'revoke follows the password write').toBeGreaterThan(updateAt);
    // No token to spare here — the caller's session is minted afterwards.
    const between = src.slice(updateAt, revokeAt + 200);
    expect(between).not.toContain('exceptToken');
  });
});
