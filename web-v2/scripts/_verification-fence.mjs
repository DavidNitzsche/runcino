/**
 * scripts/_verification-fence.mjs · the barrier, for the `.mjs` script fleet.
 *
 * WHY A SECOND FILE EXISTS AT ALL, SAID PLAINLY. `lib/verify/production-barrier.ts`
 * is the canonical implementation, and every process that can load TypeScript
 * uses it. 348 files under `web-v2/scripts` cannot: they are plain ESM run as
 * `node scripts/whatever.mjs`, with no bundler, no alias and no TS loader. A
 * barrier they are unable to import is a barrier they do not have.
 *
 * So the four decisive literals below are COPIES, and they are copies on
 * purpose, held byte-identical to the TypeScript module by
 * `scripts/check-write-barrier.sh` — the same posture `check-palette-sync.sh`
 * takes for the palette, and for the same reason: where one definition cannot
 * physically be shared, the next best thing is a gate that fails the moment the
 * two disagree. Change one, change both, or the build stops.
 *
 * WHAT IT DOES on import:
 *
 *   1 · Patches `pg`'s `Client`/`Pool` prototypes so a mutating statement is
 *       refused unless `DATABASE_URL` is provably loopback. Identical rule to
 *       the TypeScript barrier, including Rule 11: a target it cannot identify
 *       refuses.
 *   2 · Stamps every outgoing `fetch` with `X-Faff-Verification`, so a script
 *       that drives the LIVE API is refused by `middleware.ts` instead of
 *       posting activities as if it were the runner's phone. This is the half
 *       that matters most here: eleven scripts in this directory default their
 *       base URL to `https://www.faff.run` and issue POST/PATCH/DELETE.
 *
 * HOW TO USE IT · first line of the script, before anything opens a connection:
 *
 *     import './_verification-fence.mjs';
 *
 * IF YOUR SCRIPT IS SUPPOSED TO WRITE PRODUCTION — a backfill, a migration, an
 * approved repair — do NOT import this. It is for verification tooling: audits,
 * probes, smokes, synthetic end-to-end checks. The distinction is the one
 * CLAUDE.md already draws between operational tasks and verification, and it is
 * a judgement the author makes once, in the import line, where it is visible.
 */
import pg from 'pg';
import path from 'node:path';

// ── COPIED LITERALS · held byte-identical by scripts/check-write-barrier.sh ──
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
const KNOWN_PRODUCTION_HOST = /(^|\.)(rlwy\.net|railway\.app|railway\.internal|faff\.run)$/i;
const READ_ONLY_LEAD = /^(select|with|show|explain|values|table|begin|start\s+transaction|commit|rollback|end|savepoint|release|set|reset|discard|deallocate|prepare|close|fetch|listen|unlisten)\b/i;
const DML_ANYWHERE = /\b(insert\s+into|update\s+[a-z_"][\w".]*\s+set|delete\s+from|merge\s+into|truncate|drop\s+|alter\s+|create\s+|grant\s+|revoke\s+|refresh\s+materialized|copy\s+[a-z_"][\w".]*\s+from|do\s+\$|call\s+|vacuum|reindex|cluster\s+|comment\s+on|nextval\s*\(|setval\s*\()/i;
// ── end copied literals ─────────────────────────────────────────────────────

const WHO = `script:${path.basename(process.argv[1] ?? 'unknown')}`;

function stripNoise(sql) {
  let s = sql;
  for (;;) {
    const before = s;
    s = s.replace(/^\s+/, '').replace(/^--[^\n]*\n?/, '').replace(/^\/\*[\s\S]*?\*\//, '');
    if (s === before) return s;
  }
}
function stripLiterals(sql) {
  return sql.replace(/\$\$[\s\S]*?\$\$/g, "''").replace(/'(?:[^']|'')*'/g, "''");
}
// Comments anywhere, not just at the front. A mid-query `--` explaining a cast
// once contained the words "this call site", which the deny-list read as a
// procedure invocation and refused. See the TS barrier's stripComments.
function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Same allow-list as the TypeScript barrier: anything unrecognised is refused. */
function isMutating(sql) {
  if (typeof sql !== 'string' || sql.trim() === '') return true;
  const body = stripNoise(sql);
  if (!READ_ONLY_LEAD.test(body)) return true;
  const bare = stripComments(stripLiterals(body));
  if (DML_ANYWHERE.test(bare)) return true;
  if (/^select\b[\s\S]*?\binto\s+[a-z_"]/i.test(bare)) return true;
  if (/^explain\b[\s\S]*\banalyze\b/i.test(bare)) return true;
  if (/\bfor\s+(update|no\s+key\s+update|share)\b/i.test(bare) && /^select\b/i.test(bare)) return true;
  return false;
}

/** Three answers, never two. Only 'local' permits a write. */
export function classifyTarget(url = process.env.DATABASE_URL) {
  if (!url) return { kind: 'indeterminate', describe: 'DATABASE_URL is not set' };
  let u;
  try { u = new URL(url); } catch { return { kind: 'indeterminate', describe: 'DATABASE_URL is not parseable' }; }
  const describe = `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  if (LOOPBACK.has(u.hostname) || u.hostname === 'host.docker.internal') return { kind: 'local', describe };
  if (KNOWN_PRODUCTION_HOST.test(u.hostname)) return { kind: 'production', describe };
  return { kind: 'indeterminate', describe };
}

let attempted = 0;
export function fenceLedger() {
  return { attempted, issued: 0, sentence: `${attempted} write${attempted === 1 ? '' : 's'} attempted, 0 issued` };
}

function refuse(kind, head, describe) {
  attempted += 1;
  const msg = `[write-barrier/script] REFUSED ${kind} · ${WHO}\n`
    + `  target:    ${describe}\n`
    + `  statement: ${head}\n`
    + `  This script imports scripts/_verification-fence.mjs, so it cannot write a\n`
    + `  production or unidentified database. Point DATABASE_URL at a loopback\n`
    + `  database you own, or drop the fence only if this script is a genuine\n`
    + `  operational write (a backfill or an approved repair), not verification.`;
  console.error(msg);
  return new Error(msg);
}

// The target is classified PER QUERY, not once at import. Several scripts in
// this directory read `.env.local` themselves and assign `process.env
// .DATABASE_URL` in their body — which, because ESM hoists imports, happens
// AFTER this module has run. Deciding once at import would have refused every
// one of them regardless of where they were actually pointed, and a fence that
// is wrong in the safe direction still trains people to delete fences.
for (const ctor of [pg.Client, pg.Pool]) {
  if (!ctor?.prototype?.query) continue;
  const original = ctor.prototype.query;
  ctor.prototype.query = function fenced(...args) {
    const first = args[0];
    const text = typeof first === 'string' ? first : first?.text;
    const target = classifyTarget();
    if (target.kind !== 'local' && isMutating(text)) {
      const err = refuse('a database write', String(text ?? '').replace(/\s+/g, ' ').slice(0, 120), `${target.describe} · ${target.kind}`);
      const cb = args.find((a) => typeof a === 'function');
      if (cb) { cb(err); return undefined; }
      return Promise.reject(err);
    }
    return original.apply(this, args);
  };
}

// The HTTP half. Stamping rather than blocking, because the server is the one
// that knows whether IT is production — a script pointed at localhost:3000 in
// front of a loopback database is a perfectly good thing to be doing, and this
// fence has no way to know that from here. `middleware.ts` refuses the stamp
// when the write would reach production, and lets it through when it would not.
if (typeof globalThis.fetch === 'function') {
  const original = globalThis.fetch;
  globalThis.fetch = function stampedFetch(input, init = {}) {
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('X-Faff-Verification', WHO);
    return original.call(this, input, { ...init, headers });
  };
}

{
  const at = classifyTarget();
  console.error(
    `[write-barrier/script] ARMED · ${WHO} · database at import: ${at.describe} (${at.kind})`
    + ` · every write re-checks the target at query time`
    + ` · outgoing requests stamped X-Faff-Verification`,
  );
}
