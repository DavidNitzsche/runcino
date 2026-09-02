/**
 * lib/audit/_swallow_scan.test.ts · the gate.
 *
 * `swallow-scan.ts` explains WHAT a violation is. This file is what makes the
 * build fail on one, and — GUARD 0, the one that matters most — what makes the
 * build fail when the scanner has stopped seeing anything.
 *
 * A scanner that opens no files and reports clean IS THE BUG IT IS HUNTING, one
 * level up: a failure (the parser broke) rendered as an answer (no violations).
 * So this file refuses to pass on nothing. It asserts floors on files and
 * database statements actually parsed, and it drives the real scanner over
 * fixtures that reproduce every parsing trap this repo has fallen into.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  scanSource,
  scanTree,
  maskSource,
  classifyFallback,
  handlerObservesError,
  enclosingSymbol,
  type SwallowSite,
} from './swallow-scan';
import {
  SWALLOW_EXEMPTIONS,
  EMPTIED_BASELINE,
  EMPTIED_KNOWN,
  SCAN_FLOORS,
} from './swallowed-failure-registry';

const ROOT = path.join(__dirname, '..', '..');

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 0 · THE SCANNER ACTUALLY RAN
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 0 · the scanner refuses to pass on nothing', () => {
  const result = scanTree(ROOT);

  it('opened a real number of files', () => {
    expect(
      result.filesScanned,
      `only ${result.filesScanned} files scanned (floor ${SCAN_FLOORS.files}). ` +
      'Either the walker broke or the tree moved. A scanner that opens nothing ' +
      'and reports clean is worse than no scanner.',
    ).toBeGreaterThanOrEqual(SCAN_FLOORS.files);
  });

  it('found a real number of database calls', () => {
    expect(
      result.dbCallsSeen,
      `only ${result.dbCallsSeen} db call sites seen (floor ${SCAN_FLOORS.dbCalls}). ` +
      'The DB_CALL pattern has stopped matching how this codebase talks to Postgres. ' +
      'Fix the pattern; do not lower the floor.',
    ).toBeGreaterThanOrEqual(SCAN_FLOORS.dbCalls);
  });

  it('is still finding sites at all', () => {
    // Not a target — a floor. If this ever legitimately reaches zero, the
    // baseline below will be zero too and this assertion is the last to change.
    expect(
      result.sites.length,
      'the scanner found zero swallow sites in a tree that had 407 on 2026-08-24. ' +
      'That is a parser regression, not a clean-up.',
    ).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * POSITIVE CONTROLS · the scanner parses what it claims to
 *
 * Every fixture here is a shape that defeated a real grep in this repo.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('positive controls · the traps that have actually fired here', () => {
  it('catches a MULTI-LINE SQL template with the .catch six lines below the query', () => {
    const src = `
      export async function loadThing(userId: string) {
        const rows = (await pool.query<{ n: string }>(
          \`SELECT COUNT(*)::text AS n
             FROM plan_workouts pw
             JOIN training_plans tp ON tp.id = pw.plan_id
            WHERE tp.user_uuid = $1
              AND pw.date_iso::date >= $2::date\`,
          [userId, today],
        ).catch(() => ({ rows: [{ n: '0' }] }))).rows[0];
        return Number(rows.n);
      }
    `;
    const { sites } = scanSource('fixture.ts', src);
    expect(sites).toHaveLength(1);
    expect(sites[0].severity).toBe('minted');
    expect(sites[0].symbol).toBe('loadThing');
    expect(sites[0].id).toBe('fixture.ts::loadThing');
  });

  it('catches a .catch whose handler body spans several lines', () => {
    const src = `
      export async function wide(u: string) {
        return pool.query(\`SELECT 1 FROM runs WHERE user_uuid = $1\`, [u])
          .catch(
            () => ({
              rows: [],
            }),
          );
      }
    `;
    const { sites } = scanSource('fixture.ts', src);
    expect(sites).toHaveLength(1);
    expect(sites[0].severity).toBe('emptied');
  });

  it('catches `try { …query… } catch { return <default> }`', () => {
    const src = `
      export async function sealed(u: string, d: string): Promise<boolean> {
        try {
          const r = await pool.query(\`SELECT 1 FROM runs WHERE user_uuid = $1\`, [u]);
          return r.rows.length > 0;
        } catch {
          return false;
        }
      }
    `;
    const { sites } = scanSource('fixture.ts', src);
    expect(sites).toHaveLength(1);
    expect(sites[0].form).toBe('try-catch');
    expect(sites[0].severity).toBe('minted');
    expect(sites[0].symbol).toBe('sealed');
  });

  it('does NOT flag a handler that logs the error', () => {
    const src = `
      export async function loud(u: string) {
        return pool.query(\`SELECT 1 FROM runs WHERE user_uuid = $1\`, [u])
          .catch((e) => { console.error('read failed', e); return { rows: [] }; });
      }
    `;
    expect(scanSource('fixture.ts', src).sites).toHaveLength(0);
  });

  it('does NOT flag a handler that goes through logReadFailure', () => {
    const src = `
      export async function viaHelper(u: string) {
        return pool.query(\`SELECT 1 FROM runs WHERE user_uuid = $1\`, [u])
          .catch((e) => { logReadFailure('x', e); return { rows: [] }; });
      }
    `;
    expect(scanSource('fixture.ts', src).sites).toHaveLength(0);
  });

  it('DOES flag a handler that binds the error and then ignores it', () => {
    // Bound-and-dropped is the same blindness with a parameter name on it.
    const src = `
      export async function pretend(u: string) {
        return pool.query(\`SELECT 1 FROM runs WHERE user_uuid = $1\`, [u])
          .catch((e) => ({ rows: [] }));
      }
    `;
    expect(scanSource('fixture.ts', src).sites).toHaveLength(1);
  });

  it('does NOT flag a .catch on something that is not a database call', () => {
    const src = `
      export async function fetchy(u: string) {
        return fetch('https://example.com/' + u).then((r) => r.json()).catch(() => null);
      }
    `;
    expect(scanSource('fixture.ts', src).sites).toHaveLength(0);
  });

  it('is not fooled by SQL-shaped prose inside a comment', () => {
    // A false finding was filed exactly this way during the 2026-08-24 sweep:
    // `SELECT max_hr FROM profile` inside a doc comment, describing a bug that
    // had already been fixed.
    const src = `
      /**
       * Replaces the old \`SELECT max_hr FROM profile\` which queried a column
       * that does not exist and fell through with .catch(() => ({ rows: [] })).
       */
      export async function clean(u: string) {
        const r = await pool.query(\`SELECT hrmax FROM profile WHERE user_uuid = $1\`, [u]);
        return r.rows[0] ?? null;
      }
    `;
    expect(scanSource('fixture.ts', src).sites).toHaveLength(0);
  });

  it('is not fooled by a brace or a // inside a SQL string', () => {
    const src = `
      export async function braces(u: string) {
        return pool.query(
          \`SELECT data->'splits' AS s, 'http://x//y' AS u, '{"a":1}'::jsonb AS j
             FROM runs WHERE user_uuid = $1\`,
          [u],
        ).catch(() => ({ rows: [] }));
      }
    `;
    const { sites } = scanSource('fixture.ts', src);
    expect(sites).toHaveLength(1);
    expect(sites[0].symbol).toBe('braces');
  });

  it('resolves the ENCLOSING FUNCTION even through a Promise<{…}> return type', () => {
    // `): Promise<{ a: string } | null> {` — taking the type literal's brace as
    // the body brace made every site in such a function resolve to `<module>`.
    const src = `
      async function loadNoSessionReason(
        userId: string,
      ): Promise<{ reason: string; site: string | null } | null> {
        const r = (await pool.query(\`SELECT 1 FROM runs WHERE user_uuid = $1\`, [userId])
          .catch(() => ({ rows: [{ n: '0' }] }))).rows[0];
        return r ? { reason: 'x', site: null } : null;
      }
    `;
    const { sites } = scanSource('fixture.ts', src);
    expect(sites).toHaveLength(1);
    expect(sites[0].symbol).toBe('loadNoSessionReason');
  });

  it('does not name a site after the local it was assigned to', () => {
    const src = `
      export async function realName(u: string) {
        const rows = await pool.query(\`SELECT 1 FROM runs WHERE user_uuid = $1\`, [u])
          .catch(() => ({ rows: [] }));
        return rows;
      }
    `;
    expect(scanSource('fixture.ts', src).sites[0].symbol).toBe('realName');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * UNIT · the classifier
 * ═══════════════════════════════════════════════════════════════════════ */

describe('classifier', () => {
  it('calls a fabricated row MINTED and an empty one EMPTIED', () => {
    expect(classifyFallback("({ rows: [{ n: '0' }] })")).toBe('minted');
    expect(classifyFallback('({ rows: [] })')).toBe('emptied');
    expect(classifyFallback('({ rowCount: 0 })')).toBe('minted');
    expect(classifyFallback('0')).toBe('minted');
    expect(classifyFallback('false')).toBe('minted');
    expect(classifyFallback("'easy'")).toBe('minted');
    expect(classifyFallback('[]')).toBe('emptied');
    expect(classifyFallback('null')).toBe('emptied');
    expect(classifyFallback('new Map()')).toBe('emptied');
  });

  it('says nothing about a handler that produces something substantive', () => {
    expect(classifyFallback('computeFallbackFromCache(userId)')).toBeNull();
  });

  it('knows an unused binding is still blind', () => {
    expect(handlerObservesError('e', ' ({ rows: [] })')).toBe(false);
    expect(handlerObservesError('e', ' { console.error(e); return []; }')).toBe(true);
    expect(handlerObservesError(null, ' { logReadFailure("x", err); return []; }')).toBe(true);
  });

  it('preserves byte offsets when masking, so line numbers stay true', () => {
    const src = 'const a = 1;\n// comment here\nconst b = `SELECT 1`;\n';
    const masked = maskSource(src);
    expect(masked).toHaveLength(src.length);
    expect(masked.split('\n')).toHaveLength(src.split('\n').length);
    expect(masked).not.toContain('comment');
    expect(masked).not.toContain('SELECT');
  });

  it('reports <module> for a top-level statement, not a wrong name', () => {
    expect(enclosingSymbol(maskSource('const x = 1;\nfoo();\n'), 15)).toBe('<module>');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE GATE
 * ═══════════════════════════════════════════════════════════════════════ */

function describeSite(s: SwallowSite): string {
  return `  ${s.file}:${s.line}  [${s.severity}]  ${s.id}\n      ${s.fallback.slice(0, 110)}`;
}

describe('gate · a database failure may not become an answer', () => {
  const result = scanTree(ROOT);
  const minted = result.sites.filter((s) => s.severity === 'minted');
  const emptied = result.sites.filter((s) => s.severity === 'emptied');
  const exemptIds = new Set(SWALLOW_EXEMPTIONS.map((e) => e.id));

  it('every MINTED site is argued in the registry', () => {
    const unlisted = minted.filter((s) => !exemptIds.has(s.id));
    expect(
      unlisted.map(describeSite).join('\n'),
      `\n${unlisted.length} site(s) turn a database failure into a FABRICATED value ` +
      'with no argument on record.\n\n' +
      'Do not add a registry entry to make this pass unless you can honestly finish:\n' +
      '  "absent and failed lead to the same outcome for every consumer, because ___"\n\n' +
      'Otherwise: return null, fail CLOSED if it is a guard, or outage() if it is a route.\n',
    ).toBe('');
  });

  it('no registry entry outlives the site it exempts', () => {
    const liveIds = new Set(result.sites.map((s) => s.id));
    const stale = SWALLOW_EXEMPTIONS.filter((e) => !liveIds.has(e.id)).map((e) => e.id);
    expect(
      stale.join('\n'),
      '\nThese exemptions no longer match any site. The code was fixed — delete them.\n' +
      'An exemption that outlives its bug is a licence nobody checked.\n',
    ).toBe('');
  });

  it('every exemption carries a real reason', () => {
    const thin = SWALLOW_EXEMPTIONS
      .filter((e) => e.reason.trim().length < 60)
      .map((e) => e.id);
    expect(
      thin.join('\n'),
      '\nThese exemptions have a reason too short to be an argument. ' +
      'An exemption with no reason is not an exemption, it is a site nobody looked at.\n',
    ).toBe('');
  });

  it('has no duplicate exemption ids', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const e of SWALLOW_EXEMPTIONS) {
      if (seen.has(e.id)) dupes.push(e.id);
      seen.add(e.id);
    }
    expect(dupes.join('\n'), '\nA duplicate id means one of the two entries is never read.\n').toBe('');
  });

  /* ────────────────────────────────────────────────────────────────────────
   * THE EMPTIED RATCHET · keyed on IDENTITY, not on a count.
   *
   * It used to be `emptied.length <= EMPTIED_BASELINE && >= EMPTIED_BASELINE`,
   * and that is a BUDGET, not a ratchet. Falsified 2026-09-01: one planted
   * `.catch(() => ({ rows: [] }))` in `lib/plan/generate.ts` FAILED correctly
   * on its own, and PASSED — "swallowed-failure OK · empty-result baseline
   * 374" — as soon as an unrelated `.catch` was tidied out of
   * `lib/strava/connection-status.ts`. A swallowed database read could be
   * added to the plan engine and paid for with a peripheral cleanup.
   *
   * The two assertions below are the same pair `_coercion_scan.test.ts` runs
   * over `LOAD_BEARING_KNOWN`, and they fail in both directions: a site seen
   * more often than listed is NEW, a site listed more often than seen is
   * STALE. Counts per id are significant.
   *
   * WHAT THIS CANNOT FAIL ON (Rule 22): it cannot fail on a swallowed read
   * MOVING between two functions that are both already listed the same number
   * of times, nor on one of the 374 legacy entries being wrong about whether
   * it should be there at all — the list is an inventory transcribed from the
   * scanner, not 374 arguments anybody made.
   * ──────────────────────────────────────────────────────────────────────── */

  it('no EMPTIED site is added, anywhere', () => {
    const allowed = new Map<string, number>();
    for (const id of EMPTIED_KNOWN) allowed.set(id, (allowed.get(id) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const s of emptied) seen.set(s.id, (seen.get(s.id) ?? 0) + 1);

    const added: string[] = [];
    for (const [id, n] of seen) {
      const cap = allowed.get(id) ?? 0;
      if (n > cap) {
        added.push(
          `${id} · ${n} site(s), ${cap} on the ratchet\n` +
          emptied.filter((s) => s.id === id).map(describeSite).join('\n'),
        );
      }
    }
    expect(
      added.join('\n'),
      '\nA database failure is being turned into an empty result at a site the ratchet ' +
      'does not carry.\n\n' +
      'Route it through lib/db/read.ts — `rowsOrNull` when the caller can tell the ' +
      'difference, `rowsOrEmpty` (which still logs) when it genuinely cannot.\n\n' +
      'Do NOT pay for it by deleting an unrelated entry from EMPTIED_KNOWN. That trade ' +
      'is the exact defect this list replaced: the old scalar baseline passed a new ' +
      'swallow inside lib/plan/generate.ts because a peripheral one had been tidied.\n',
    ).toBe('');
  });

  it('no EMPTIED ratchet entry outlives the site it names', () => {
    const seen = new Map<string, number>();
    for (const s of emptied) seen.set(s.id, (seen.get(s.id) ?? 0) + 1);
    const counted = new Map<string, number>();
    const stale: string[] = [];
    for (const id of EMPTIED_KNOWN) {
      counted.set(id, (counted.get(id) ?? 0) + 1);
      if ((counted.get(id) ?? 0) > (seen.get(id) ?? 0)) stale.push(id);
    }
    expect(
      stale.join('\n'),
      '\nThese ids are on the EMPTIED ratchet but no longer exist in the tree. Somebody ' +
      'FIXED them, which is the point — delete the lines, and lower EMPTIED_BASELINE to ' +
      'match, so the list can never drift back up.\n',
    ).toBe('');
  });

  it('EMPTIED_BASELINE still summarises EMPTIED_KNOWN', () => {
    // The shell gate reads the integer with sed on a cold container that has
    // no TypeScript toolchain, so the two must not be able to disagree.
    expect(
      EMPTIED_KNOWN.length,
      `\nEMPTIED_KNOWN holds ${EMPTIED_KNOWN.length} ids but EMPTIED_BASELINE says ` +
      `${EMPTIED_BASELINE}. scripts/check-swallowed-failure.sh reads the integer and ` +
      'would report a figure the list does not support.\n',
    ).toBe(EMPTIED_BASELINE);
  });
});
