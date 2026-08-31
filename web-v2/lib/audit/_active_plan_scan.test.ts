/**
 * ACTIVEPLAN-1 · a reader that joins plan_workouts to training_plans says WHICH plan.
 *
 * See `active-plan-exemptions.ts` for the bug class and the four defects it
 * produced on 2026-08-30. In short: archiving a plan leaves its `plan_workouts`
 * behind, so a join filtered only on `user_uuid` reads every version the runner
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
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractStringLiterals } from './sql-scan';
import { ACTIVE_PLAN_EXEMPTIONS } from './active-plan-exemptions';

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = ['lib', 'app', 'scripts'];

interface Finding { file: string; sql: string }

/** Pins exactly one plan: `plan_id = $1`, `tp.id = $2`, `pw.plan_id = $1`. */
function pinsOnePlan(sql: string): boolean {
  return /\b(?:pw\.|tp\.|w\.)?(?:plan_)?id\s*=\s*\$\d/i.test(sql)
    || /\bplan_id\s*=\s*\$\d/i.test(sql);
}

/** Constrains to the non-archived plan. */
function constrainsToActive(sql: string): boolean {
  return /archived_iso/i.test(sql);
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
        if (!/training_plans/i.test(sql)) continue;
        if (constrainsToActive(sql) || pinsOnePlan(sql)) continue;
        out.push({ file: path.relative(ROOT, p), sql: sql.slice(0, 160) });
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
      console.log(`  ACTIVEPLAN  ${f.file}\n     ${f.sql}`);
    }
    expect(
      unexcused.length,
      'A query joining plan_workouts to training_plans on user_uuid alone reads ' +
      'EVERY archived plan version, because archiving does not delete plan_workouts. ' +
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
