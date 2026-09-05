/**
 * lib/plan/_move_never_deletes.test.ts · A MOVE NEVER DESTROYS A WORKOUT.
 *                                        (NEVER-DELETE-1, 2026-09-04)
 *
 * ─── THE RULE ───────────────────────────────────────────────────────────────
 *
 * Moving a run rearranges the calendar. It never deletes a prescribed session.
 * `lib/plan/reschedule.ts` states it as an absolute — "every edit is a
 * permutation of dates over existing rows plus in-place prescription changes.
 * No INSERT, no DELETE" — and `permutationFault` proves it for that module.
 *
 * ─── WHY THIS FILE EXISTS  (Rule 20) ────────────────────────────────────────
 *
 * The rule was true of the owner and false of the app. `POST
 * /api/today/reschedule` with `replace: true` issued
 *
 *     DELETE FROM plan_workouts WHERE id = $1
 *
 * on the run sitting in the destination, and its own comment called that row
 * "regenerable plan data". Nothing regenerated it. `/api/plan/undo` did not
 * know about it, `plan_reschedules` had no record of it, and the coach intent
 * logged that a swap happened without logging what had been in the row. A
 * prescribed session left the block and the only route back was a full
 * rebuild, which re-authors every other week too.
 *
 * The rule was written down in one module's header and enforced nowhere else,
 * which Rule 20 says is a hypothesis rather than a rule. This is the check.
 *
 * ─── WHAT IT ALLOWS, AND WHY ────────────────────────────────────────────────
 *
 * Deleting a REST PLACEHOLDER is not deleting a workout. A rest row carries no
 * distance, no prescription and no training, and the movers keep exactly one
 * row per day, so removing a duplicate rest row after a swap is bookkeeping.
 * Those sites are listed individually with their reason rather than waved
 * through by a pattern, so a future delete that is NOT a rest row fails even
 * if it sits two lines away from one that is.
 *
 * ─── RATCHET  (Rule 18) ─────────────────────────────────────────────────────
 *
 * `ALLOWED` may shrink and never grow. An entry whose site no longer exists
 * FAILS until it is deleted, so the list cannot quietly outlive what it
 * excused.
 *
 * ─── WHAT THIS GATE CANNOT FAIL ON  (Rule 22) ───────────────────────────────
 *
 * · A delete issued through SQL built at run time, a string template that
 *   assembles the table name, an ORM, or a stored procedure. It reads source
 *   text for a literal statement. Nothing in these files does that today, and
 *   `_mutation_boundary.test.ts` covers the writer-outside-the-boundary case
 *   from the other direction.
 * · A move that LOSES a workout without deleting it, for example by writing
 *   two sessions onto one date. `permutationFault` and the contract suite's
 *   "the same day count is prescribed before and after" case own that.
 * · Deletes in migrations, scripts or test files. Those are out of scope and
 *   are excluded from the scan on purpose.
 * · Whether the SWAP that replaced the delete is CORRECT. It proves only that
 *   nothing is destroyed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['lib', 'app'];

/** A literal delete against the prescriptions table. */
const DELETE_RE = /DELETE\s+FROM\s+plan_workouts/i;

interface Site { file: string; line: number; text: string }

/**
 * Every delete site that is permitted, and the argument for each.
 *
 * RATCHET: may shrink, never grow. Keyed by file plus the distinctive text of
 * the surrounding block, never by line number, because line numbers rot.
 */
const ALLOWED: Array<{ file: string; near: string; why: string }> = [
  {
    file: 'app/api/today/reschedule/route.ts',
    near: 'for (const extra of restOnTarget.slice(1))',
    why: 'Removes DUPLICATE REST placeholders left on the vacated day after the '
      + 'first rest row has been relocated onto it. A rest row carries no '
      + 'distance and no prescription, and the movers keep one row per day.',
  },
  {
    file: 'app/api/today/reschedule/route.ts',
    near: 'just drop any rest',
    why: 'Removes REST placeholders on the destination day so the arriving run '
      + 'owns the day cleanly. Same reasoning: a rest row is not a workout.',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__snapshots__') continue;
      walk(p, out);
    } else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) {
      // Tests and migrations are out of scope, stated rather than assumed.
      if (/\.test\.tsx?$/.test(e.name)) continue;
      if (e.name.startsWith('_')) continue;
      out.push(path.relative(ROOT, p));
    }
  }
  return out;
}

function findSites(): { sites: Site[]; filesRead: number } {
  const files: string[] = [];
  for (const d of SCAN_DIRS) {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  const sites: Site[] = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    lines.forEach((text, i) => {
      // A comment ABOUT a delete is not a delete. This is what lets the route
      // keep its own history in a header without tripping its own gate.
      const code = text.replace(/^\s*(\/\/|\*).*$/, '');
      if (DELETE_RE.test(code)) sites.push({ file: f, line: i + 1, text: text.trim() });
    });
  }
  return { sites, filesRead: files.length };
}

/** Does an allowlist entry's `near` text appear within 12 lines of the site? */
function excusedBy(site: Site, entry: { file: string; near: string }): boolean {
  if (site.file !== entry.file) return false;
  const lines = fs.readFileSync(path.join(ROOT, site.file), 'utf8').split('\n');
  const lo = Math.max(0, site.line - 13);
  const hi = Math.min(lines.length, site.line + 12);
  return lines.slice(lo, hi).join('\n').includes(entry.near);
}

describe('NEVER-DELETE-1 · a move never destroys a prescribed workout', () => {
  it('the scanner actually read the source tree', () => {
    const { filesRead } = findSites();
    // Rule 18 liveness. A scanner reporting clean over zero files is the worst
    // available outcome, because it also reports confidence.
    expect(filesRead, 'the scan matched no files at all').toBeGreaterThan(200);
  });

  it('the scanner can still SEE a delete · the pattern has not gone dead', () => {
    const { sites } = findSites();
    // If this ever hits zero the allowlist below is vacuous and the gate has
    // quietly stopped meaning anything. Deleting the last site is fine; doing
    // so must also empty ALLOWED, which the staleness check enforces.
    expect(sites.length, 'no DELETE FROM plan_workouts anywhere, so this gate proves nothing')
      .toBeGreaterThan(0);
  });

  it('every delete of a plan workout is a rest placeholder, with an argued reason', () => {
    const { sites } = findSites();
    const unexcused = sites.filter((s) => !ALLOWED.some((a) => excusedBy(s, a)));
    expect(
      unexcused.map((s) => `${s.file}:${s.line} · ${s.text}`),
      'a move path deletes a plan workout. Rearrange it instead: the displaced '
      + 'session takes the day the moved one vacated. If the delete really is a '
      + 'rest placeholder, add it to ALLOWED with its reason.',
    ).toEqual([]);
  });

  it('no allowlist entry has outlived the thing it excused', () => {
    const { sites } = findSites();
    const stale = ALLOWED.filter((a) => !sites.some((s) => excusedBy(s, a)));
    expect(
      stale.map((a) => `${a.file} · near "${a.near}"`),
      'an exemption no longer matches any delete. Delete the entry.',
    ).toEqual([]);
  });

  it('the rescheduling OWNER deletes nothing at all', () => {
    // The owner module is held to the stronger bar its own header states. It
    // has no rest-placeholder bookkeeping to do, because every edit it makes
    // is a permutation over rows that already exist.
    const src = fs.readFileSync(path.join(ROOT, 'lib/plan/reschedule.ts'), 'utf8');
    const codeLines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    expect(codeLines.filter((l) => DELETE_RE.test(l))).toEqual([]);
    expect(codeLines.filter((l) => /INSERT\s+INTO\s+plan_workouts/i.test(l))).toEqual([]);
  });
});
