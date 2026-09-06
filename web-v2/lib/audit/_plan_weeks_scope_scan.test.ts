/**
 * PLANWEEKS-1 · a `plan_weeks` statement never trusts `plan_weeks.user_uuid`.
 *
 * `plan_weeks.user_uuid` is NULL on 88 of 672 rows in production (measured
 * 2026-09-05) — including all 15 weeks of the owner's CURRENTLY ACTIVE plan.
 * Migration 143 backfilled it once, from `training_plans`, and something
 * stopped populating it afterward. A statement that filters `plan_weeks`
 * directly on that column does not error and does not warn: it silently reads
 * an empty or truncated result, because NULL never satisfies `= $1`.
 *
 * `lib/plan/volume-evidence-loader.ts`'s own header names the shape exactly:
 * a lane read the block as ending 2026-08-24 and refused with "the block is
 * over", confidently, about a plan with fourteen weeks left in it. The SAME
 * shape, found in this sweep: `lib/adaptation/volume-evidence/
 * _replay_real_history.script.ts` (that file's sibling named it as still
 * broken) and `lib/adaptation-harness/substrate.ts` (the scratch-substrate
 * date-shift silently left `plan_weeks.week_start_iso` un-shifted while
 * `plan_workouts.date_iso` moved, which would have handed Rule 13's own
 * verification a plan whose week boundaries disagreed with its workouts). All
 * three are fixed as of this change — this gate is what stops a fourth.
 *
 * `plan_workouts` and `training_plans` both carry the same denormalised-column
 * risk in principle, but ACTIVEPLAN-1 (`_active_plan_scan.test.ts`) already
 * watches `plan_workouts`, and `training_plans.user_uuid` is the column
 * everything else is scoped THROUGH, not a value read off a join — this gate
 * is deliberately narrow to the one column now confirmed unreliable.
 *
 * A week belongs to a PLAN and the plan belongs to the runner: the correct
 * scope is `training_plans.user_uuid`, joined via `plan_weeks.plan_id`, or a
 * single plan pinned by id. Anything that reads `plan_weeks`'s OWN
 * `user_uuid`/`user_id` as a filter — aliased ("w.user_uuid = $1") or bare
 * ("FROM plan_weeks WHERE user_uuid = $1") — is the exact shape that returns
 * nothing for the live plan.
 *
 * ── WHAT THIS SCANNER CANNOT FAIL ON (Rule 22) ─────────────────────────────
 *
 * · A query assembled from fragments that are individually clean, or one that
 *   reaches `plan_weeks` through a view, an ORM, or a helper that interpolates
 *   the table name — it reads string literals, not a live query plan.
 * · A reader that fetches `plan_weeks` broadly (scoped correctly) and then
 *   filters or aggregates by user in TypeScript afterward — the same blind
 *   spot `normal-window-registry.ts` and ACTIVEPLAN-1 both name about
 *   themselves.
 * · Whether the DATA is right — this only watches the SHAPE of the SQL. A
 *   statement that correctly joins `training_plans` still reads whatever rows
 *   the database actually has.
 * · A `.sql` migration file. The walk below matches `_active_plan_scan.test.
 *   ts`'s own directories and extension (`lib/app/scripts`, `.ts` only) on
 *   purpose — the two migrations that legitimately WRITE this column from
 *   `training_plans` live outside that scope and are named in
 *   `plan-weeks-scope-exemptions.ts`'s header rather than encoded as findings
 *   this file could ever see.
 * · A `plan_weeks` read with no `user_uuid`/`user_id` anywhere in the
 *   statement at all (e.g. `UPDATE plan_weeks SET is_cutback = $2 WHERE id =
 *   $1`, pinned by primary key) — there is no runner-scoping claim there to be
 *   wrong, so this scanner has nothing to check.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractStringLiterals } from './sql-scan';
import { PLAN_WEEKS_SCOPE_EXEMPTIONS } from './plan-weeks-scope-exemptions';

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = ['lib', 'app', 'scripts'];

interface Finding {
  file: string;
  sql: string;
  fullSql: string;
}

const KEYWORDS = new Set([
  'set', 'where', 'on', 'join', 'left', 'right', 'inner', 'full', 'outer',
  'group', 'order', 'limit', 'values', 'returning', 'having', 'union', 'and',
  'or', 'using', 'as',
]);

/** The alias `plan_weeks` was given in this statement, or null if there isn't
 *  one (a bare `FROM plan_weeks` / `UPDATE plan_weeks` with nothing between
 *  the table name and the next keyword). */
function planWeeksAlias(sql: string): string | null {
  const m = sql.match(/\bplan_weeks\s+(?:AS\s+)?([a-zA-Z_]\w*)\b/i);
  if (!m) return null;
  return KEYWORDS.has(m[1].toLowerCase()) ? null : m[1];
}

/** Any OTHER user-bearing table named in the statement, alongside plan_weeks.
 *  When one is present, a BARE `user_uuid`/`user_id` is ambiguous rather than
 *  provably plan_weeks's own column, so only the ALIASED form is trustworthy
 *  evidence there. */
function hasOtherUserBearingTable(sql: string): boolean {
  return /\b(training_plans|plan_workouts|plan_phases|plan_mutations|users)\b/i
    .test(sql.replace(/\bplan_weeks\b/gi, ''));
}

/** Does this statement filter `plan_weeks` on ITS OWN `user_uuid`/`user_id`,
 *  rather than on `training_plans`'s (joined) or a plan pinned by id? */
function scopesPlanWeeksUserColumnDirectly(sql: string): boolean {
  const alias = planWeeksAlias(sql);
  if (alias) {
    return new RegExp(`\\b${alias}\\.user_(?:uuid|id)\\s*(?:=|\\bIN\\b)`, 'i').test(sql);
  }
  if (hasOtherUserBearingTable(sql)) return false;
  return /\buser_(?:uuid|id)\s*(?:=|\bIN\b)/i.test(sql);
}

function scan(): Finding[] {
  const out: Finding[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!/node_modules|\.next|\.git/.test(p)) walk(p);
        continue;
      }
      if (!p.endsWith('.ts') || p.includes('.test.')) continue;
      let src: string;
      try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
      for (const raw of extractStringLiterals(src)) {
        const sql = raw.replace(/\s+/g, ' ');
        if (!/\bplan_weeks\b/i.test(sql)) continue;
        if (!scopesPlanWeeksUserColumnDirectly(sql)) continue;
        out.push({
          file: path.relative(ROOT, p),
          sql: sql.slice(0, 160),
          fullSql: sql,
        });
      }
    }
  };
  for (const d of DIRS) walk(path.join(ROOT, d));
  return out;
}

describe('PLANWEEKS-1 · plan_weeks statements never trust plan_weeks.user_uuid', () => {
  const findings = scan();

  const excused = (f: Finding): boolean => PLAN_WEEKS_SCOPE_EXEMPTIONS.some(
    (e) => e.file === f.file && (e.statement == null || f.fullSql.includes(e.statement)),
  );

  it('the scanner still finds plan_weeks SQL at all — a silent zero would prove nothing', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/plan/adjudication/live-sequence.ts'), 'utf8');
    const anySql = extractStringLiterals(src).some((s) => /\bplan_weeks\b/i.test(s));
    expect(anySql, 'scanner extracted no plan_weeks SQL from a file known to have some — it is broken, not clean').toBe(true);
  });

  it('POSITIVE CONTROL · the aliased shape that returned "the block is over" is caught', () => {
    // volume-evidence-loader.ts's own header, verbatim shape, before its fix.
    const bad = `SELECT w.plan_id, w.week_start_iso FROM plan_weeks w WHERE w.user_uuid = $1::uuid`;
    expect(scopesPlanWeeksUserColumnDirectly(bad)).toBe(true);
  });

  it('POSITIVE CONTROL · the bare, unaliased shape (the harness\'s pre-fix statement) is caught', () => {
    const bad = `UPDATE plan_weeks SET week_start_iso = to_char(week_start_iso::date + $2::int, 'YYYY-MM-DD') WHERE user_uuid = $1::uuid`;
    expect(scopesPlanWeeksUserColumnDirectly(bad)).toBe(true);
  });

  it('NEGATIVE CONTROL · scoping through training_plans is not flagged', () => {
    const good = `SELECT w.plan_id, w.week_start_iso FROM plan_weeks w JOIN training_plans tp ON tp.id = w.plan_id AND tp.user_uuid = $1::uuid`;
    expect(scopesPlanWeeksUserColumnDirectly(good)).toBe(false);
  });

  it('NEGATIVE CONTROL · a plan_weeks read pinned by plan_id with no user column at all is not flagged', () => {
    const good = `UPDATE plan_weeks SET is_cutback = $2 WHERE id = $1`;
    expect(scopesPlanWeeksUserColumnDirectly(good)).toBe(false);
  });

  it('no unguarded, unexempted statement scopes plan_weeks on its own user column', () => {
    const unexcused = findings.filter((f) => !excused(f));
    for (const f of unexcused) {
      // eslint-disable-next-line no-console
      console.log(`  PLANWEEKS [direct]  ${f.file}\n     ${f.sql}`);
    }
    expect(
      unexcused.length,
      'A statement filters plan_weeks on its OWN user_uuid/user_id column, which is NULL on 88 '
      + 'of 672 production rows including every week of the live plan. Scope through '
      + '`training_plans.user_uuid` (joined on plan_id) instead, pin a single plan by id, or add '
      + 'an argued entry to PLAN_WEEKS_SCOPE_EXEMPTIONS saying why this statement is safe anyway.',
    ).toBe(0);
  });

  it('the allowlist is a ratchet — an exemption whose file is now clean must be deleted', () => {
    const stale = PLAN_WEEKS_SCOPE_EXEMPTIONS.filter((e) => !findings.some(
      (f) => f.file === e.file && (e.statement == null || f.fullSql.includes(e.statement)),
    ));
    expect(
      stale.map((e) => e.file),
      'These files no longer trip the scanner, so their exemptions are stale and must be deleted '
      + '— the list may shrink, never grow.',
    ).toEqual([]);
  });

  it('every exemption carries a real reason, not a shrug', () => {
    for (const e of PLAN_WEEKS_SCOPE_EXEMPTIONS) {
      expect(e.reason.length, `${e.file} has no argued reason`).toBeGreaterThan(60);
      expect(e.reason, `${e.file}'s reason is a shrug`).not.toMatch(/^(ok|fine|safe|n\/a)\b/i);
    }
  });
});
