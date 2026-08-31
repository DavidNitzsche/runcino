/**
 * lib/adaptation-harness/report.ts · a check is a value, so it can be falsified.
 *
 * Rule 18: "a gate is not trusted until it has been made to fail." An assertion
 * written as a bare `expect()` cannot be exercised in the failing direction
 * without breaking the run. Here every check is recorded as data — id, whether
 * it BINDS, its verdict, and a human sentence — and the suite's own final
 * assertion reads the ledger. That makes the falsifier possible: break a
 * mechanism, run the same check function, and assert it came back false.
 *
 * ## Binding vs open
 *
 * · BINDING · behaviour the engine is supposed to have today. A false verdict
 *   fails the harness.
 * · OPEN · behaviour CLAUDE.md's hero statement requires and the engine does
 *   not yet have. A false verdict is expected and is reported in red without
 *   failing the run — but a TRUE verdict fails, because it means the behaviour
 *   landed and the marker is now a lie. Every allowlist is a ratchet (Rule 18
 *   guard 4): an open check may be promoted to binding, never left stale.
 *
 * That asymmetry is the whole point. The harness is usable as a gate today AND
 * it names, in its own output, every world the app does not yet serve.
 */

export type Binding = 'binding' | 'open';

export interface Check {
  world: string;
  id: string;
  binding: Binding;
  ok: boolean;
  /** What was actually observed. Never "assertion failed" — the sentence has to
   *  name the mechanism, because that is what the report is for. */
  detail: string;
  /** For an open check: what has to exist before it can be promoted. */
  needs?: string;
}

const LEDGER: Check[] = [];
const WORLDS = new Set<string>();

export function recordWorld(world: string): void {
  WORLDS.add(world);
}

export function check(c: Check): boolean {
  LEDGER.push(c);
  WORLDS.add(c.world);
  return c.ok;
}

export function ledger(): readonly Check[] {
  return LEDGER;
}

export interface Verdict {
  total: number;
  worlds: number;
  /** Binding checks that came back false. These are real failures. */
  broken: Check[];
  /** Open checks that came back TRUE — the behaviour landed, promote the marker. */
  stale: Check[];
  /** Open checks that came back false — the honest red list. */
  open: Check[];
}

export function verdict(): Verdict {
  return {
    total: LEDGER.length,
    worlds: WORLDS.size,
    broken: LEDGER.filter((c) => c.binding === 'binding' && !c.ok),
    stale: LEDGER.filter((c) => c.binding === 'open' && c.ok),
    open: LEDGER.filter((c) => c.binding === 'open' && !c.ok),
  };
}

export function renderReport(): string {
  const v = verdict();
  const lines: string[] = [];
  lines.push('');
  lines.push('═'.repeat(78));
  lines.push('  ADAPTATION HARNESS · does the plan actually respond?');
  lines.push('═'.repeat(78));
  let world = '';
  for (const c of LEDGER) {
    if (c.world !== world) {
      world = c.world;
      lines.push('');
      lines.push(`── ${world} ${'─'.repeat(Math.max(0, 74 - world.length))}`);
    }
    const mark = c.binding === 'binding'
      ? (c.ok ? 'PASS' : 'FAIL')
      : (c.ok ? 'STALE' : 'RED ');
    lines.push(`  [${mark}] ${c.id}`);
    lines.push(`         ${c.detail}`);
    if (!c.ok && c.needs) lines.push(`         needs: ${c.needs}`);
  }
  lines.push('');
  lines.push('─'.repeat(78));
  lines.push(`  ${v.total} checks across ${v.worlds} worlds`);
  lines.push(`  ${v.broken.length} broken (binding, failing) · ${v.open.length} open (known-missing) · ${v.stale.length} stale markers`);
  lines.push('═'.repeat(78));
  lines.push('');
  return lines.join('\n');
}
