/**
 * lib/audit/_timezone_date_scan.test.ts · the gate.
 *
 * `timezone-date-scan.ts` explains WHAT a violation is — a `timestamp with
 * time zone` column cast bare to `::date` and compared against a runner's
 * local calendar day, the exact shape that blanked the "On the belt:
 * speed/incline" card on 2026-08-27 by silently mismatching a treadmill run's
 * UTC-stamped `ts` against the runner's Pacific "today". This file is what
 * makes the build fail on one — and, per GUARD 0, what makes the build fail
 * when the scanner has stopped seeing anything at all.
 *
 * Zero tolerance, not a ratchet. Contrast `_swallow_scan.test.ts`'s EMPTIED
 * tier, which inherited hundreds of pre-existing sites and could only
 * reasonably ask that the count never grow. This bug class had a clean,
 * fully-enumerated sweep on 2026-08-27 — every known site fixed the same day
 * — so the floor and the ceiling are the same number: 0.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  scanSourceForTimezoneDateBug,
  scanTreeForTimezoneDateBug,
  maskCommentsOnly,
  DANGEROUS_COLUMNS,
} from './timezone-date-scan';
import { TIMEZONE_DATE_EXEMPTIONS } from './timezone-date-exemptions';

const ROOT = path.join(__dirname, '..', '..');

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 0 · THE SCANNER ACTUALLY RAN
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 0 · the scanner refuses to pass on nothing', () => {
  const result = scanTreeForTimezoneDateBug(ROOT);

  it('opened a real number of files', () => {
    expect(
      result.filesScanned,
      `only ${result.filesScanned} files scanned. Either the walker broke or ` +
      'the tree moved — web-v2 has thousands of .ts files under lib/ and app/ ' +
      'alone. A scanner that opens nothing and reports clean is worse than no ' +
      'scanner.',
    ).toBeGreaterThan(500);
  });

  it('is watching all six confirmed timestamptz columns', () => {
    expect(DANGEROUS_COLUMNS).toEqual(
      expect.arrayContaining(['ts', 'recorded_at', 'logged_at', 'cleared_at', 'created_at', 'fetched_at']),
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * POSITIVE CONTROLS · the scanner parses what it claims to
 * ═══════════════════════════════════════════════════════════════════════ */

describe('positive controls', () => {
  it('flags a bare `ts::date` compared against a parameter', () => {
    const src = `
      export async function loadCompletion(userId: string, today: string) {
        return pool.query(
          \`SELECT value FROM coach_intents
             WHERE user_id = $1 AND reason = 'watch_completion'
               AND ts::date = $2::date\`,
          [userId, today],
        );
      }
    `;
    const sites = scanSourceForTimezoneDateBug('fixture.ts', src);
    expect(sites).toHaveLength(1);
    expect(sites[0].column).toBe('ts');
  });

  it('flags `recorded_at::date` inside a GROUP BY', () => {
    const src = `
      const rows = await pool.query(
        \`SELECT recorded_at::date AS d, AVG(value) AS v FROM health_samples
           WHERE user_id = $1 GROUP BY recorded_at::date\`,
        [userId],
      );
    `;
    const sites = scanSourceForTimezoneDateBug('fixture.ts', src);
    // Both the SELECT and the GROUP BY occurrence are real, distinct bugs —
    // the fix converts both or neither, so both must be visible.
    expect(sites.length).toBeGreaterThanOrEqual(2);
    expect(sites.every((s) => s.column === 'recorded_at')).toBe(true);
  });

  it('flags `logged_at::date` and `cleared_at::date`', () => {
    const src = `
      const sick = await pool.query(
        \`SELECT 1 FROM sick_episodes
           WHERE user_id = $1 AND logged_at::date <= $2::date
             AND (cleared_at IS NULL OR cleared_at::date >= $2::date)\`,
        [userId, dateIso],
      );
    `;
    const sites = scanSourceForTimezoneDateBug('fixture.ts', src);
    expect(sites.map((s) => s.column).sort()).toEqual(['cleared_at', 'logged_at']);
  });

  it('does NOT flag the fixed form — `(col AT TIME ZONE $N::text)::date`', () => {
    const src = `
      export async function loadCompletion(userId: string, today: string, tz: string) {
        return pool.query(
          \`SELECT value FROM coach_intents
             WHERE user_id = $1 AND reason = 'watch_completion'
               AND (ts AT TIME ZONE $3::text)::date = $2::date\`,
          [userId, today, tz],
        );
      }
    `;
    expect(scanSourceForTimezoneDateBug('fixture.ts', src)).toHaveLength(0);
  });

  it('does NOT flag a safe plain-`date` column — `sample_date::date`', () => {
    const src = `
      pool.query(\`SELECT 1 FROM health_samples WHERE sample_date::date <= $1::date\`, [d]);
    `;
    expect(scanSourceForTimezoneDateBug('fixture.ts', src)).toHaveLength(0);
  });

  it("does NOT flag a jsonb-extracted date string — (data->>'date')::date", () => {
    const src = `
      pool.query(\`SELECT 1 FROM runs WHERE (data->>'date')::date = $1::date\`, [d]);
    `;
    expect(scanSourceForTimezoneDateBug('fixture.ts', src)).toHaveLength(0);
  });

  it('does NOT flag `date_iso::date` or `week_start_iso`', () => {
    const src = `
      pool.query(\`SELECT 1 FROM plan_workouts WHERE date_iso::date >= $1::date\`, [d]);
    `;
    expect(scanSourceForTimezoneDateBug('fixture.ts', src)).toHaveLength(0);
  });

  it('is not fooled by the pattern appearing inside a // comment', () => {
    const src = `
      // was ts::date = $2::date before the 2026-08-27 fix
      export function noop() {}
    `;
    expect(scanSourceForTimezoneDateBug('fixture.ts', src)).toHaveLength(0);
  });

  it('is not fooled by the pattern appearing inside a /* */ doc comment', () => {
    const src = `
      /**
       * the old fallback was \`ELSE ts::date = $2::date END\`, which is UTC-shifted.
       */
      export function noop() {}
    `;
    expect(scanSourceForTimezoneDateBug('fixture.ts', src)).toHaveLength(0);
  });

  it('reports the real line number, comments included, so a fix can find it', () => {
    const src = [
      '// line 1 comment',
      '// line 2 comment',
      'pool.query(`SELECT ts::date AS d FROM check_ins WHERE user_id = $1`, [u]);',
    ].join('\n');
    const sites = scanSourceForTimezoneDateBug('fixture.ts', src);
    expect(sites).toHaveLength(1);
    expect(sites[0].line).toBe(3);
  });

  it('maskCommentsOnly leaves template-literal SQL fully intact', () => {
    const src = 'const q = `SELECT ts::date FROM x`; // trailing comment';
    const masked = maskCommentsOnly(src);
    expect(masked).toContain('SELECT ts::date FROM x');
    expect(masked).not.toContain('trailing comment');
    // byte length + newline count preserved, same discipline as maskSource.
    expect(masked).toHaveLength(src.length);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE GATE · zero tolerance
 * ═══════════════════════════════════════════════════════════════════════ */

function describeSite(s: { file: string; line: number; column: string; snippet: string }): string {
  return `  ${s.file}:${s.line}  [${s.column}::date]\n      ${s.snippet}`;
}

describe('gate · a timestamptz column may never be compared to a runner-local day unconverted', () => {
  const result = scanTreeForTimezoneDateBug(ROOT);
  const exemptIds = new Set(TIMEZONE_DATE_EXEMPTIONS.map((e) => e.id));
  const unexempted = result.sites.filter((s) => !exemptIds.has(s.id));

  it('finds ZERO unexempted sites', () => {
    expect(
      unexempted.map(describeSite).join('\n'),
      `\n${unexempted.length} site(s) cast a timestamptz column bare to ` +
      '`::date` with no `AT TIME ZONE` conversion — the exact shape that ' +
      'blanked the "On the belt" card on 2026-08-27.\n\n' +
      'Fix: resolve `const tz = await runnerTimezone(userId).catch(() => null)`, ' +
      'thread `tz ?? \'UTC\'` in as a new query parameter, and rewrite the ' +
      'comparison as `(col AT TIME ZONE $N::text)::date`.\n\n' +
      'This gate is zero-tolerance by design (David: "time zone issues should ' +
      'NEVER ever EVER happen"). Do not add an exemption unless the query is ' +
      'genuinely UTC-scoped for a cross-user aggregate, never a per-runner read.\n',
    ).toBe('');
  });

  it('no exemption outlives the site it exempts', () => {
    const liveIds = new Set(result.sites.map((s) => s.id));
    const stale = TIMEZONE_DATE_EXEMPTIONS.filter((e) => !liveIds.has(e.id)).map((e) => e.id);
    expect(
      stale.join('\n'),
      '\nThese exemptions no longer match any site. The code moved or was fixed ' +
      '— delete them.\n',
    ).toBe('');
  });

  it('every exemption carries a real reason', () => {
    const thin = TIMEZONE_DATE_EXEMPTIONS
      .filter((e) => e.reason.trim().length < 40)
      .map((e) => e.id);
    expect(
      thin.join('\n'),
      '\nThese exemptions have a reason too short to be an argument.\n',
    ).toBe('');
  });

  it('the exemption list is empty — this bug class gets no legacy pass', () => {
    expect(
      TIMEZONE_DATE_EXEMPTIONS.length,
      '\nAn exemption was added. Re-read the module doc: the only legitimate ' +
      'reason is a query deliberately UTC-scoped for a cross-user aggregate, ' +
      'never a per-runner read. If this is a per-runner read, fix it instead.\n',
    ).toBe(0);
  });
});
