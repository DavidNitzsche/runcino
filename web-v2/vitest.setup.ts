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
// AUDITRO-1 (2026-09-13) · THE CREDENTIAL THE AUDITS SKIP ON MUST BE THE
// CREDENTIAL THEY CONNECT WITH.
//
// Every one of the 33 `*.audit.test.ts` files gates itself on
// `DATABASE_URL_RO`, and `audit-suite.yml` supplies exactly that secret and no
// other. But `lib/db/pool.ts` connects on `DATABASE_URL`. So in CI the
// skip-guard opened, the file RAN, and the pool fell back to the localhost
// default and answered "The server does not support SSL connections".
//
// The visible half was two loud failures — `_postrun_live` and `_detail_live`
// both assert `haveDb()` (Rule 18 clause 2), so they went red. The dangerous
// half is the other seven assertions in those same two files: each opens with
// `if (!await haveDb()) { console.warn(...); return; }` and therefore REPORTED
// GREEN HAVING ASSERTED NOTHING, in the very job whose stated principle is
// "a production audit that did not run is a failure, not a pass."
//
// CORRECTED 2026-09-13 (AUDITRO-2). THE ORIGINAL WORDING OF THIS PARAGRAPH
// CALLED THE PER-FILE WORKAROUND "NOT EVEN DETERMINISTIC", AND BLAMED
// FILE-TO-WORKER ASSIGNMENT. THAT DIAGNOSIS WAS WRONG, AND WRONG IN THE
// DIRECTION THAT MATTERS: it described a race, which invites "retry it and see",
// when the real thing is a fixed ordering that fails the same way every run.
//
// `vitest.config.ts` sets no `isolate: false`, so vitest's default per-FILE
// isolation applies: every test file is evaluated against a fresh module
// registry, and `lib/db/pool`'s module-level read of `DATABASE_URL` therefore
// happens once PER FILE, not once per worker. Nothing another file did can
// reach it.
//
// What actually breaks is intra-file ORDER, and ES module semantics fix that
// order at parse time. A file's static `import` graph — `@/lib/db/pool`
// directly, or transitively through `lib/runs/volume.ts`, `lib/coach/
// glance-state.ts` and the rest — is fully evaluated BEFORE the first line of
// the file's own body, let alone before a `process.env.DATABASE_URL = RO`
// inside a test callback. So in the 22 audit files that carry that assignment,
// the assignment is deterministically TOO LATE whenever the file statically
// imports the pool at any depth, and deterministically fine when it does not.
// Which files are affected is a property of each file's own import graph and
// is the same on every run. Measured 2026-09-13 with only `DATABASE_URL_RO`
// exported: `_postrun_corpus` and `_durability_anchor` both died on the
// localhost fallback, three levels down in `lib/runs/volume.ts` — every time,
// not sometimes.
//
// The repair is unchanged and correct either way, and this is the reason it
// is: a setup file runs before ANY test module is evaluated, which is earlier
// than any import the modules themselves can hoist. It never overrides an
// explicit `DATABASE_URL` (a developer machine's `.env.local` above, or a
// harness pointing at a loopback scratch database, still win), and the value it
// adopts is the `faff_readonly` role — SELECT only at the database, with the
// write barrier below as the second, independent layer.
//
// Rule 11: "no credential", "the read-only credential" and "the read-write
// credential" are three facts. `lib/verify/ro-credential.ts` is the one place
// that names them, so the gate can exercise all three in a job that has none of
// them rather than only in the job that already works (AUDITRO-2). Applying the
// decision here keeps it from naming a fourth state — configured, and still
// unreachable.
//
// TWO CONSEQUENCES OF THIS BINDING THAT NOTHING CURRENTLY CHECKS. Written down
// because Rule 20's own instruction is that an honest "unenforced" is a known
// gap and an unmarked one is a rule everybody believes is holding:
//
//   1. IT SERVES THE WHOLE SUITE, not just the audits. In any environment that
//      exports `DATABASE_URL_RO` and no `DATABASE_URL`, the ~78 test files that
//      reach `lib/db/pool` now genuinely connect (read-only) where they used to
//      fail fast on the localhost default. Load and surprise rather than
//      danger — reads are fenced and the `*.db.test.ts` scratch tests still
//      refuse, since they require a loopback host AND a named scratch database.
//      No-ops in `test-full.yml` (no `_RO`) and on a developer machine
//      (`.env.local` sets `DATABASE_URL`).
//   2. THE FENCE'S VERDICT DEPENDS ON THE RO URL'S HOST. If `DATABASE_URL_RO`
//      were ever pointed at a loopback database, this binding would flip
//      `classifyDatabaseTarget` from `indeterminate` (refuse writes) to `local`
//      (PERMIT writes). Not true today — RO is the remote `faff_readonly`
//      role — and deliberately not gated here, because the gate belongs beside
//      `classifyDatabaseTarget` rather than beside the binding. Named so the
//      next person changing that secret knows it is load-bearing twice.
const { resolveCredentialBinding } = await import('./lib/verify/ro-credential');
if (resolveCredentialBinding(process.env).action === 'bind-read-only') {
  process.env.DATABASE_URL = process.env.DATABASE_URL_RO;
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
const { barrierInstall } = await import('./lib/verify/install-barrier');

// FAIL-LOUD IN VERIFICATION (2026-09-03). The install is wrapped so it can never
// take the production app down at import; that leniency must not extend to a
// test run. A barrier that failed to arm here would let 78 test files reach a
// production pool unfenced while every suite still reported green.
if (!barrierInstall.installed && !barrierInstall.alreadyInstalled) {
  throw new Error(
    `[write-barrier] refused to start the test run: the barrier is not armed — ${barrierInstall.summary}`,
  );
}
