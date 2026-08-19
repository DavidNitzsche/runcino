/**
 * vitest.setup.ts · give the suite the database URL it has always needed.
 *
 * 2026-08-19 · `lib/plan/_wave1_smoke_dryrun.test.ts` — a prod detection
 * sweep that asserts detection invariants hold for EVERY active plan — had
 * been failing on every run with:
 *
 *     Error: The server does not support SSL connections
 *
 * That error was quoted in report after report as "the known unrelated
 * baseline failure", and the whole team learned to read the suite as
 * "3234 passed / 1 failed, that one is fine". It was never fine and it was
 * never unrelated. Nothing loaded `.env.local` into the test process, so
 * `process.env.DATABASE_URL` was undefined, `lib/db/pool.ts` fell back to a
 * localhost default, asked it for TLS, and localhost refused. Given a real
 * connection string the test passes in 19s.
 *
 * The cost was not one red test. A permanently-red suite trains everyone to
 * ignore red, which is the most expensive habit a test suite can teach.
 *
 * Never overrides an already-set variable, so CI and any caller that exports
 * its own DATABASE_URL still win. Missing file is not an error — the suite is
 * overwhelmingly pure and must stay runnable with no database at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

for (const file of ['.env.local', '.env']) {
  const full = path.join(here, file);
  let raw: string;
  try {
    raw = fs.readFileSync(full, 'utf8');
  } catch {
    continue;
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
