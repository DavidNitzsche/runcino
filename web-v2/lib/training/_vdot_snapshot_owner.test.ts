/**
 * SECOND-OWNER-5 · ONE READER FOR "WHAT IS THIS RUNNER'S VDOT RIGHT NOW".
 *
 * `lib/training/projection-snapshots.ts` carried TWO answers to that question,
 * in the same file. `resolveCurrentVdotSnapshot` is the disciplined one — a
 * total row order, a `VDOT_SNAPSHOT_MAX_AGE_DAYS` bound, and a three-state
 * refusal contract whose refusal branch carries no `vdot` field, so a caller
 * cannot read one without branching. `loadLatestVdotWithAnchor` was the other:
 * `ORDER BY snapshot_date DESC LIMIT 1` with no tie-break over the three rows
 * production holds per snapshot_date, no age bound at all, and a
 * `.catch(() => ({ rows: [] }))` that made a failed read and an empty table the
 * same answer. It had six live callers, one of them the primary iPhone races
 * surface, where it fed Goal Feasibility and the heat detector.
 *
 * Its own query is now deleted and it delegates. This gate stops the shell
 * spreading and makes it self-expiring.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22, stated not implied) ─────────────
 *
 *   · IT IS A TEXT SCAN over import statements and call expressions. A caller
 *     that reaches the shell through a re-export, a dynamic string, or a
 *     variable alias is invisible to it.
 *   · IT SAYS NOTHING ABOUT WHETHER THE SNAPSHOT IS RIGHT. It checks who reads
 *     it, not whether `projection_snapshots` holds a defensible VDOT, and not
 *     whether 14 days is the correct staleness bound (`VDOT_SNAPSHOT_MAX_AGE_
 *     DAYS`'s own doc comment argues that number; nothing here re-argues it).
 *   · IT DOES NOT WATCH `loadLatestVdotForUser`, the sibling in the same file
 *     with the same missing age bound and the same `.catch`. That one has live
 *     callers in `lib/plan/adapt.ts`, `lib/watch/heat.ts` and
 *     `app/api/today/purpose`, was not in this change's scope, and is named
 *     here so its absence is a recorded decision rather than an oversight.
 *   · IT CANNOT TELL A CALLER THAT BRANCHES ON THE REFUSAL FROM ONE THAT
 *     DISCARDS IT. `resolveCurrentVdotSnapshot`'s type does that, at compile
 *     time, which is why this file does not try to.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(__dirname, '../..');

/** The ONE file still allowed to import the deprecated shell, with the reason.
 *
 *  RATCHET. This list may SHRINK, never grow. An entry whose file no longer
 *  imports the shell FAILS until it is deleted — and when the list empties,
 *  `loadLatestVdotWithAnchor` is deleted outright rather than left behind as a
 *  symbol nothing calls. */
const SHELL_IMPORTERS: Record<string, string> = {
  'lib/plan/goal-gap.ts':
    'HARD BOUNDARY. `lib/plan/**` is being rewritten concurrently by another agent, so this ' +
    'call site could not be migrated in the same change without colliding. The shell has no ' +
    'query of its own any more — it delegates to `resolveCurrentVdotSnapshot` — so this caller ' +
    'already gets the age bound, the total row order and the non-swallowed read. What it does ' +
    'NOT get is the three-state refusal, because the shell flattens it to null. Migrate ' +
    '`assessGoalForRunner` to `resolveCurrentVdotSnapshot` and delete both this entry and the ' +
    'shell.',
};

const SHELL = 'loadLatestVdotWithAnchor';
const OWNER = 'lib/training/projection-snapshots.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('SECOND-OWNER-5 · the VDOT snapshot read has one owner', () => {
  const files = ['lib', 'app', 'components', 'scripts']
    .map((d) => path.join(WEB, d))
    .filter((d) => fs.existsSync(d))
    .flatMap((d) => walk(d));

  it('LIVENESS · the scan actually read the tree', () => {
    // Rule 18 point 2. A scanner that reports clean because it looked at
    // nothing is the worst outcome available, since it also reports
    // confidence.
    expect(files.length).toBeGreaterThan(500);
    const owner = files.find((f) => f.endsWith(OWNER));
    expect(owner, `the owning module ${OWNER} was not found — this gate is watching nothing`)
      .toBeTruthy();
    expect(fs.readFileSync(owner!, 'utf8')).toContain(`export async function ${SHELL}`);
  });

  it('the shell has NO query of its own · it delegates', () => {
    // The defect was the QUERY, not the name. Assert the shape of the result
    // (Rule 13 point 3): the function body must call the canonical resolver
    // and must not contain a projection_snapshots SELECT.
    const src = fs.readFileSync(path.join(WEB, OWNER), 'utf8');
    const start = src.indexOf(`export async function ${SHELL}`);
    expect(start).toBeGreaterThan(-1);
    // The body runs to the next top-level `export ` after it, or EOF.
    const rest = src.slice(start);
    const end = rest.indexOf('\nexport ', 1);
    const body = end === -1 ? rest : rest.slice(0, end);
    expect(body).toContain('resolveCurrentVdotSnapshot(');
    expect(
      body,
      `${SHELL} has grown its own query again · it is a delegating shell, not a second reader`,
    ).not.toMatch(/FROM\s+projection_snapshots/i);
    expect(
      body,
      `${SHELL} swallows its read again · a failed read and an empty table are not one fact`,
    ).not.toMatch(/\.catch\(\s*\(\s*\)\s*=>/);
  });

  it('exactly the argued files import the shell · a ratchet', () => {
    const importers: string[] = [];
    for (const f of files) {
      const rel = path.relative(WEB, f).split(path.sep).join('/');
      if (rel === OWNER) continue;
      if (rel.includes('.test.')) continue;
      const src = fs.readFileSync(f, 'utf8');
      // Import statements only — a mention inside a comment is an epitaph, and
      // several files now carry one.
      const imports = src.match(/^\s*(?:import\s+\{[^}]*\}|const\s+\{[^}]*\})\s*=?\s*(?:from|await import\()/gm) ?? [];
      if (imports.some((line) => line.includes(SHELL))) importers.push(rel);
    }
    const allowed = Object.keys(SHELL_IMPORTERS).sort();
    const found = importers.sort();

    const unexplained = found.filter((f) => !allowed.includes(f));
    expect(
      unexplained,
      `${SHELL} is a DEPRECATED SHELL with an argued single caller. New importers must call ` +
        '`resolveCurrentVdotSnapshot` and branch on its refusal (Rule 11).',
    ).toEqual([]);

    // Self-expiring: an entry whose file no longer imports it fails until the
    // entry is deleted — and when the list empties, delete the shell.
    const stale = allowed.filter((f) => !found.includes(f));
    expect(
      stale,
      `these files no longer import ${SHELL} · delete their entries from SHELL_IMPORTERS, and ` +
        'if the list is now empty delete the shell itself rather than leaving a symbol nothing calls',
    ).toEqual([]);
  });

  it('every argued exemption carries a real reason', () => {
    for (const [file, reason] of Object.entries(SHELL_IMPORTERS)) {
      expect(fs.existsSync(path.join(WEB, file)), `${file} does not exist`).toBe(true);
      expect(reason.length, `${file}'s exemption reason is not an argument`).toBeGreaterThan(120);
    }
  });
});
