/**
 * ACTIVEPLAN-1 · a reader of plan_workouts says WHICH plan.
 *
 * See `active-plan-exemptions.ts` for the bug class and the four defects it
 * produced on 2026-08-30. In short: archiving a plan leaves its `plan_workouts`
 * behind, so a read filtered only on `user_uuid` reads every version the runner
 * has ever had — 47 of them for the owner — and silently multiplies counts,
 * skews medians, and duplicates cards. Nothing fails; the numbers are just
 * fiction.
 *
 * This is a SCANNER, not a behaviour test, for the reason the gate audit gave
 * about the rest of the apparatus: every existing check samples the output at
 * points and asks whether each point is legal, and a plan-version-inflated
 * count is perfectly legal. The defect is only visible in the SQL.
 *
 * A statement is guarded when it either constrains to the active plan
 * (`archived_iso`) or pins a single plan by id. Anything else must carry an
 * argued exemption.
 *
 * ── 2026-09-01 · THE HOLE THIS SCANNER SHIPPED WITH ─────────────────────────
 *
 * It read:
 *
 *     if (!/plan_workouts/i.test(sql)) continue;
 *     if (!/training_plans/i.test(sql)) continue;   // ← everything else skipped
 *
 * and its own title said "a reader that JOINS plan_workouts TO training_plans".
 * But `plan_workouts` carries its own `user_uuid` column, so the natural way to
 * write the bug does not mention `training_plans` at all — and that shape was
 * skipped before any guard ran.
 *
 * FALSIFIED: Rule 14's own documented defect, verbatim in shape —
 *
 *     SELECT COUNT(*)::text AS n FROM plan_workouts pw
 *      WHERE pw.user_uuid = $1 AND pw.is_quality = true
 *        AND pw.date_iso >= (CURRENT_DATE - INTERVAL '7 days')::text
 *
 * appended to `lib/coach/race-replacement.ts` → **4 tests, 0 failures.** That
 * is the "59 quality sessions in one week across 47 plan versions" query, and
 * it was invisible.
 *
 * The second gate is now USER-SCOPED-OR-JOINED, not joined-only: any
 * `plan_workouts` statement that filters on `user_uuid`/`user_id` is subject to
 * the same two guards as one that names `training_plans`. That found one live
 * reader, `lib/coach/easy-discipline.ts`, which was grading the runner's easy
 * days against an ARCHIVED plan's pace band for three of seven production
 * users — one of them 40 s/mi out.
 *
 * ── WHAT THIS SCANNER CANNOT FAIL ON (Rule 22) ─────────────────────────────
 *
 * It cannot see a query assembled from fragments that are individually clean,
 * nor one that reaches `plan_workouts` through a view or a helper that
 * interpolates the table name. It cannot tell a genuinely-correct
 * cross-version read from a defective one — that is what the exemption
 * registry's argued reasons are for. And it reads SQL, so a reader that
 * aggregates plan rows in TypeScript after an over-broad fetch is invisible
 * to it (the same blind spot `normal-window-registry.ts` exists to cover).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractStringLiterals } from './sql-scan';
import { ACTIVE_PLAN_EXEMPTIONS } from './active-plan-exemptions';

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = ['lib', 'app', 'scripts'];

interface Finding { file: string; sql: string; reach: 'joins-training-plans' | 'user-scoped' }

/** Pins exactly one plan: `plan_id = $1`, `tp.id = $2`, `pw.plan_id = $1`. */
function pinsOnePlan(sql: string): boolean {
  return /\b(?:pw\.|tp\.|w\.)?(?:plan_)?id\s*=\s*\$\d/i.test(sql)
    || /\bplan_id\s*=\s*\$\d/i.test(sql);
}

/** Constrains to the non-archived plan. */
function constrainsToActive(sql: string): boolean {
  return /archived_iso/i.test(sql);
}

/**
 * Filters on the RUNNER — which is not the same as filtering on the right ROWS,
 * and is the whole of Rule 14. `plan_workouts` has its own `user_uuid`, so this
 * shape needs no join to `training_plans` and was invisible to the old scanner.
 */
function scopesToOneRunner(sql: string): boolean {
  return /\b(?:pw\.|w\.|p\.)?user_(?:uuid|id)\s*(?:=|\bIN\b)/i.test(sql);
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
        if (!/plan_workouts/i.test(sql)) continue;
        const joined = /training_plans/i.test(sql);
        const userScoped = scopesToOneRunner(sql);
        // Either reach is enough. Requiring the JOIN is the hole this scanner
        // shipped with; see the file header.
        if (!joined && !userScoped) continue;
        if (constrainsToActive(sql) || pinsOnePlan(sql)) continue;
        out.push({
          file: path.relative(ROOT, p),
          sql: sql.slice(0, 160),
          reach: joined ? 'joins-training-plans' : 'user-scoped',
        });
      }
    }
  };
  for (const d of DIRS) walk(path.join(ROOT, d));
  return out;
}

describe('ACTIVEPLAN-1 · plan_workouts joins name their plan', () => {
  const findings = scan();
  const exemptFiles = new Set(ACTIVE_PLAN_EXEMPTIONS.map((e) => e.file));

  it('the scanner still finds SQL at all — a silent zero would prove nothing', () => {
    // If extractStringLiterals or the directory layout changes underneath this,
    // scan() returns [] and every assertion below passes vacuously. That is the
    // shape of failure `check-modelled-mark.sh` shipped for months (it created
    // the tree it audited, scanned zero files, and reported clean).
    const all = scan.toString().length > 0;
    expect(all).toBe(true);
    const anySql = (() => {
      const src = fs.readFileSync(path.join(ROOT, 'lib/plan/adapt.ts'), 'utf8');
      return extractStringLiterals(src).some((s) => /plan_workouts/i.test(s));
    })();
    expect(anySql, 'scanner extracted no plan_workouts SQL — it is broken, not clean').toBe(true);
  });

  it('no unguarded, unexempted join reads across every plan version', () => {
    const unexcused = findings.filter((f) => !exemptFiles.has(f.file));
    for (const f of unexcused) {
      // eslint-disable-next-line no-console
      console.log(`  ACTIVEPLAN [${f.reach}]  ${f.file}\n     ${f.sql}`);
    }
    expect(
      unexcused.length,
      'A query reads plan_workouts for one runner without saying which plan, so it reads ' +
      'EVERY archived version, because archiving does not delete plan_workouts. It does not ' +
      'need to join training_plans to do this — plan_workouts has its own user_uuid, and that ' +
      'shape is exactly the one this scanner used to skip. ' +
      'Add `AND tp.archived_iso IS NULL`, pin one plan by id, or add an argued ' +
      'entry to ACTIVE_PLAN_EXEMPTIONS saying why reading across versions is right here.',
    ).toBe(0);
  });

  it('the allowlist is a ratchet — an exemption whose file is now clean must be deleted', () => {
    const flagged = new Set(findings.map((f) => f.file));
    const stale = ACTIVE_PLAN_EXEMPTIONS.filter((e) => !flagged.has(e.file));
    expect(
      stale.map((e) => e.file),
      'These files no longer trip the scanner, so their exemptions are stale. ' +
      'Delete them — the list may shrink, never grow.',
    ).toEqual([]);
  });

  it('every exemption carries a real reason, not a shrug', () => {
    for (const e of ACTIVE_PLAN_EXEMPTIONS) {
      expect(e.reason.length, `${e.file} has no argued reason`).toBeGreaterThan(60);
      expect(e.reason, `${e.file}'s reason is a shrug`).not.toMatch(/^(ok|fine|safe|n\/a)\b/i);
    }
  });
});
