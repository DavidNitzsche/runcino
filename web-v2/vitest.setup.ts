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

// ─────────────────────────────────────────────────────────────────────────────
// AND THEN FENCE IT.
//
// The block above is the reason a fence is needed. It has just loaded
// `.env.local` into this test process, and on a developer machine that file's
// `DATABASE_URL` is the PRODUCTION READ-WRITE url. 78 test files under `lib/**`
// reach `lib/db/pool`; before this line the only things between any of them and
// the owner's live training history were a directory exclusion in
// `vitest.config.ts` and one hand-written fence inside `lib/adaptation-harness`.
//
// An agent once ran a live simulator session signed in as his production
// account and wrote two junk activity rows into his real history. His ruling:
// "Simulator and automated test clients must be unable to post activities,
// complete workouts, or mutate my production account. Environment labelling or
// connection-string policy alone is insufficient."
//
// So this runs AFTER the loader, in every worker, before any test module is
// evaluated — early enough that a test constructing its own `new Pool(...)`
// gets the patched prototype too. It refuses every mutating statement unless
// the target database is provably loopback; a production or unidentifiable
// target refuses (Rule 11). The local harnesses keep working, because a
// loopback scratch database is exactly what they point at.
//
// `lib/verify/_production_write_barrier.test.ts` is the proof, and it fails if
// this import is removed.
//
// DYNAMIC on purpose. A static `import` is HOISTED above the loader block, so
// the barrier would be armed before `DATABASE_URL` existed and its startup line
// would report "DATABASE_URL is not set" on a machine where it very much is.
// The per-query decision reads the environment at call time either way, so the
// only thing that would have been wrong is the sentence in the log — which is
// exactly the kind of confidently-wrong report this whole file is about.
await import('./lib/verify/install-barrier');
