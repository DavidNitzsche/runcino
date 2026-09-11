#!/usr/bin/env node
// web-v2/scripts/_build_ledger.mjs · durable TestFlight build → source SHA record
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS (2026-09-11)
//
// This project has repeatedly lost track of which source commit is on which
// TestFlight build, and every time it needed a live App Store Connect query
// plus git archaeology to reconstruct. Concretely, while building this file:
// two different docs in this repo cite TWO DIFFERENT commits for build 290
// ("commit `0dce24f23`" in one report, "commit `b6bf7c314` (build 290)" in
// another). Both are real commits. Only one is right:
//
//   b6bf7c314  "chore(ship): TestFlight build 290 · ..."   parent = 0dce24f23
//   0dce24f23  "fix(native): ... stop firing duplicate ..."  (the actual fix)
//
// `b6bf7c314`'s sole parent is `0dce24f23` — it is the bookkeeping commit
// created AFTER the archive (bumping `.asc.build`), not the tree that was
// archived. A human grepping "build 290" naturally lands on the commit whose
// MESSAGE says so, which is exactly the wrong one. This is precisely the
// "manual bookkeeping is not sufficient" failure this file exists to end:
// the only way to get this right is to capture the SHA at the moment of
// upload, mechanically, not to reconstruct it afterward from commit prose.
//
// WHAT THIS DOES
//
//   record    · append one entry to the ledger. Called by
//               scripts/ship-testflight-v2.sh right after a successful
//               `altool --upload-app`, capturing `git rev-parse HEAD` BEFORE
//               any post-upload bookkeeping commit exists to be confused with
//               the shipped tree.
//   sha-for   · look up the source SHA for a build number. No network call —
//               reads the durable ledger only.
//   latest    · print the highest-build-number entry. No network call.
//   list      · print every entry (debugging/audit).
//   contains  · does build N's source SHA descend from ref R? COMPUTED ON
//               DEMAND via `git merge-base --is-ancestor`, not frozen at
//               upload time — see the header note below on why.
//   verify    · cross-check the local ledger against the LIVE App Store
//               Connect API (network + credentials required) to catch drift
//               or tampering. Never trusted blindly in place of the ledger —
//               it's the audit path, not the fast path.
//
// WHY "contains" IS COMPUTED, NOT FROZEN (the task's own open question)
//
// An earlier design considered recording, at upload time, the full list of
// "which fixes/branches are ancestors of this build." That list is a
// snapshot of `main`'s topology at one instant, and every one of Rule 8/10/16
// in this project's own CLAUDE.md is a version of the same lesson: a value
// computed once and stored goes stale the moment the thing it describes
// keeps moving, and nothing re-derives it. A frozen "build 290 contains fixes
// X, Y, Z" list would need updating if a fix is later renamed, if two topic
// branches turn out to share a base, or if someone asks about a fix that
// didn't have a name yet at ship time. `git merge-base --is-ancestor` against
// the durably-recorded SHA answers the SAME question, correctly, for any ref
// anyone thinks to ask about later, using the one thing that cannot go stale
// (the commit graph itself). The only thing worth freezing is the SHA; the
// question can always be re-asked.
//
// SCHEMA (docs/testflight-builds.jsonl — one JSON object per line, append-only)
//
//   build        integer, TestFlight build number
//   sha          full 40-char commit SHA, the source tree at archive time
//   branch       local branch name at record time
//   uploaded_at  ISO8601 UTC — wall-clock time of the upload (or, for a
//                reconstructed entry, ASC's own uploadedDate)
//   agent_id     who/what recorded this (ship script fills the real one)
//   recorded     "live" — captured by the ship script at the moment of
//                upload, from a process that was actually shipping.
//                "reconstructed" — backfilled after the fact from ASC +
//                git ancestry, for a build shipped before this ledger
//                existed. A reconstructed entry's `note` field says how it
//                was derived, so nobody mistakes it for a live recording.
//   note         optional free text
//
// ENV OVERRIDES (testability — never touch the real ledger from a self-test)
//
//   BUILD_LEDGER_PATH   default: docs/testflight-builds.jsonl (repo-relative)
//   ASC_ENV_PATH        default: legacy/native/.asc.env (same default as
//                       _asc_max_build.mjs / _asc_review_status.mjs)
//
// Usage:
//   node _build_ledger.mjs record --build 291 --sha <sha> [--branch B] [--note N]
//   node _build_ledger.mjs sha-for 290
//   node _build_ledger.mjs latest
//   node _build_ledger.mjs list
//   node _build_ledger.mjs contains --build 290 --ref origin/fix/some-branch
//   node _build_ledger.mjs verify [290]
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();
const LEDGER_PATH = process.env.BUILD_LEDGER_PATH
  ? path.resolve(process.env.BUILD_LEDGER_PATH)
  : path.join(ROOT, 'docs', 'testflight-builds.jsonl');
const ASC_ENV_PATH = process.env.ASC_ENV_PATH
  || path.join(ROOT, 'legacy', 'native', '.asc.env');

// ── ledger I/O ───────────────────────────────────────────────────────────────
//
// Rule 11: a missing file, an empty file, and a corrupt line are three
// different facts. A missing file reads as "no entries yet" (valid — the
// ledger hasn't shipped its first build). A corrupt line is reported to
// stderr and SKIPPED, never silently dropped without a trace, and never
// treated as if the whole file were empty.
function readLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  const raw = fs.readFileSync(LEDGER_PATH, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const entries = [];
  let corrupt = 0;
  for (const [i, line] of lines.entries()) {
    try {
      const obj = JSON.parse(line);
      if (typeof obj.build !== 'number' || typeof obj.sha !== 'string' || !obj.sha) {
        throw new Error('missing required field (build: number, sha: string)');
      }
      entries.push(obj);
    } catch (e) {
      corrupt++;
      console.error(`build-ledger: SKIPPING malformed line ${i + 1} in ${LEDGER_PATH}: ${e.message}`);
    }
  }
  if (corrupt > 0 && entries.length === 0) {
    // Every line was garbage. This is NOT "no entries" — it's corruption, and
    // must not be read as an empty-but-healthy ledger.
    console.error(`build-ledger: ${LEDGER_PATH} has ${corrupt} line(s) and ALL are malformed. Refusing to treat this as an empty ledger.`);
    process.exit(4);
  }
  return entries;
}

function appendLedger(entry) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(entry) + '\n');
}

function latestEntry(entries) {
  if (entries.length === 0) return null;
  return entries.reduce((max, e) => (e.build > max.build ? e : max), entries[0]);
}

function entryForBuild(entries, build) {
  // Last-write-wins if a build number is ever recorded twice (e.g. a
  // corrected re-record) — matches append-only-log semantics generally.
  const matches = entries.filter((e) => e.build === build);
  return matches.length ? matches[matches.length - 1] : null;
}

// ── git helpers ──────────────────────────────────────────────────────────────
function git(args) {
  return execFileSync('git', args, { cwd: ROOT }).toString().trim();
}
function gitOk(args) {
  try { execFileSync('git', args, { cwd: ROOT, stdio: 'ignore' }); return true; }
  catch { return false; }
}

// ── ASC (App Store Connect) — same JWT recipe as _asc_max_build.mjs ─────────
function ascCredentials() {
  if (!fs.existsSync(ASC_ENV_PATH)) return null;
  const env = {};
  for (const line of fs.readFileSync(ASC_ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = env;
  if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_PATH) return null;
  return { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH };
}

function ascJwt(creds) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'ES256', kid: creds.ASC_KEY_ID, typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const payload = b64({ iss: creds.ASC_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' });
  const signer = crypto.createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const der = signer.sign(fs.readFileSync(creds.ASC_KEY_PATH, 'utf8'));
  let off = 2;
  if (der[1] & 0x80) off += der[1] & 0x7f;
  const rLen = der[off + 1]; const r = der.subarray(off + 2, off + 2 + rLen);
  const sOff = off + 2 + rLen; const sLen = der[sOff + 1];
  const s = der.subarray(sOff + 2, sOff + 2 + sLen);
  const pad = (buf) => {
    const out = Buffer.alloc(32);
    buf.subarray(Math.max(0, buf.length - 32)).copy(out, Math.max(0, 32 - buf.length));
    return out;
  };
  const sig = Buffer.concat([pad(r), pad(s)]).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

async function ascFetch(jwt, apiPath) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + apiPath, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) throw new Error(`ASC ${r.status} on ${apiPath}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

const [, , cmd, ...rest] = process.argv;

async function main() {
  switch (cmd) {
    case 'record': {
      const f = parseFlags(rest);
      if (!f.build || !f.sha) {
        console.error('usage: record --build N --sha SHA [--branch B] [--agent A] [--uploaded-at TS] [--recorded live|reconstructed] [--note N]');
        process.exit(2);
      }
      const build = Number(f.build);
      if (!Number.isInteger(build) || build <= 0) {
        console.error(`record: --build must be a positive integer, got '${f.build}'`);
        process.exit(2);
      }
      if (!gitOk(['cat-file', '-e', f.sha])) {
        console.error(`record: --sha '${f.sha}' does not resolve to a commit in this repo`);
        process.exit(2);
      }
      const full_sha = git(['rev-parse', f.sha]);
      const entry = {
        build,
        sha: full_sha,
        branch: f.branch || (gitOk(['rev-parse', '--abbrev-ref', 'HEAD']) ? git(['rev-parse', '--abbrev-ref', 'HEAD']) : 'unknown'),
        uploaded_at: f['uploaded-at'] || new Date().toISOString(),
        agent_id: f.agent || process.env.AGENT_ID || `${process.env.USER || 'unknown'}@local`,
        recorded: f.recorded || 'live',
        note: f.note || '',
      };
      appendLedger(entry);
      console.log(`→ recorded build ${build} = ${full_sha} (${entry.recorded}) in ${LEDGER_PATH}`);
      console.log(`  Commit this file: git add ${path.relative(ROOT, LEDGER_PATH)}`);
      break;
    }

    case 'sha-for': {
      const build = Number(rest[0]);
      if (!Number.isInteger(build)) { console.error('usage: sha-for <build-number>'); process.exit(2); }
      const entries = readLedger();
      const entry = entryForBuild(entries, build);
      if (!entry) {
        // Rule 11: "not found" is not "empty string" and not exit 0.
        console.error(`sha-for: no ledger entry for build ${build} (${entries.length} entries on file)`);
        process.exit(1);
      }
      console.log(entry.sha);
      break;
    }

    case 'latest': {
      const entries = readLedger();
      const entry = latestEntry(entries);
      if (!entry) { console.error('latest: ledger is empty — no builds recorded yet'); process.exit(1); }
      console.log(JSON.stringify(entry, null, 2));
      break;
    }

    case 'list': {
      const entries = readLedger().sort((a, b) => a.build - b.build);
      if (entries.length === 0) { console.log('(ledger empty)'); break; }
      for (const e of entries) console.log(JSON.stringify(e));
      break;
    }

    case 'contains': {
      const f = parseFlags(rest);
      if (!f.build || !f.ref) { console.error('usage: contains --build N --ref <git-ref-or-sha>'); process.exit(2); }
      const build = Number(f.build);
      const entries = readLedger();
      const entry = entryForBuild(entries, build);
      if (!entry) { console.error(`contains: no ledger entry for build ${build}`); process.exit(2); }
      if (!gitOk(['cat-file', '-e', f.ref])) {
        console.error(`contains: ref '${f.ref}' does not resolve in this repo (fetch it first if it's on a remote you haven't fetched)`);
        process.exit(2);
      }
      const refSha = git(['rev-parse', f.ref]);
      const isAncestor = gitOk(['merge-base', '--is-ancestor', refSha, entry.sha]);
      console.log(isAncestor ? 'yes' : 'no');
      process.exit(isAncestor ? 0 : 1);
      break; // eslint-disable-line no-unreachable
    }

    case 'verify': {
      const creds = ascCredentials();
      if (!creds) {
        console.error(`verify: no ASC credentials at ${ASC_ENV_PATH} — cannot reach the live API. The local ledger is unverified (not wrong, just unconfirmed).`);
        process.exit(3);
      }
      const entries = readLedger();
      const targetBuild = rest[0] ? Number(rest[0]) : (latestEntry(entries)?.build ?? null);
      if (targetBuild == null) { console.error('verify: ledger is empty and no build number given'); process.exit(2); }
      const local = entryForBuild(entries, targetBuild);
      if (!local) { console.error(`verify: no local ledger entry for build ${targetBuild} to check`); process.exit(2); }

      const jwt = ascJwt(creds);
      const apps = await ascFetch(jwt, '/v1/apps?limit=200&fields[apps]=name,bundleId');
      const app = apps.data.find((a) => /faff/i.test(a.attributes.name) || /faff/i.test(a.attributes.bundleId)) || apps.data[0];
      const q = `/v1/builds?filter[app]=${app.id}&filter[version]=${targetBuild}&fields[builds]=version,uploadedDate,processingState,expired`;
      const builds = await ascFetch(jwt, q);
      const findings = [];
      const warnings = [];

      if (!builds.data.length) {
        findings.push(`ASC has NO build numbered ${targetBuild} at all — the local ledger entry may be a phantom (never actually uploaded, or expired+purged).`);
      } else {
        const remote = builds.data[0];
        const localMs = Date.parse(local.uploaded_at);
        const remoteMs = Date.parse(remote.attributes.uploadedDate);
        const driftMin = Math.abs(localMs - remoteMs) / 60000;
        // A live-recorded entry should be within a couple minutes of ASC's own
        // clock (upload latency); a reconstructed one is looser since it was
        // deliberately set FROM ascs own uploadedDate to begin with, so drift
        // there would mean something changed it after the fact.
        const tolerance = local.recorded === 'reconstructed' ? 5 : 15;
        if (Number.isFinite(driftMin) && driftMin > tolerance) {
          findings.push(`uploaded_at drift: ledger says ${local.uploaded_at}, ASC says ${remote.attributes.uploadedDate} (${driftMin.toFixed(1)} min apart, tolerance ${tolerance} min).`);
        }
        if (remote.attributes.expired) {
          findings.push(`ASC reports build ${targetBuild} as EXPIRED — informational, not necessarily a ledger error.`);
        }
      }

      // Ledger-vs-ASC max build comparison (reuses the same live query the
      // existing _asc_max_build.mjs makes, inlined here to avoid a second JWT
      // mint) — catches "ledger is missing recent ships" and "ledger has a
      // build ASC does not (phantom entry, or ASC purged it).
      const allBuilds = await ascFetch(jwt, `/v1/builds?filter[app]=${app.id}&limit=200&fields[builds]=version`);
      const ascMax = allBuilds.data.reduce((m, b) => Math.max(m, parseInt(b.attributes.version, 10) || 0), 0);
      const ledgerMax = latestEntry(entries)?.build ?? 0;
      if (ledgerMax < ascMax) {
        findings.push(`ledger's highest recorded build is ${ledgerMax}, but ASC's highest is ${ascMax} — the ledger is missing at least one real upload.`);
      }
      if (ledgerMax > ascMax) {
        findings.push(`ledger's highest recorded build is ${ledgerMax}, but ASC's highest is only ${ascMax} — the ledger has a build ASC does not (phantom entry, or ASC purged it).`);
      }

      // ── indirect SHA plausibility (WARNING only, never PASS/FAIL) ──────────
      //
      // ASC genuinely has no git-SHA field — nothing here can CONFIRM the sha
      // is right, and this does not pretend to. What IS independently checkable
      // is whether the recorded sha's own commit timestamp is even plausible
      // next to the recorded upload time: a build cannot ship a commit that
      // did not exist yet, and a build shipping a commit from months before
      // the upload (for a "live" — recorded at the moment of shipping — entry)
      // is at least worth a second look. Neither direction is proof of
      // anything (a slow release process, a rebased commit, or clock skew all
      // produce the same signal without any wrongdoing), so this is reported
      // as a WARNING, clearly separate from the PASS/FAIL findings above and
      // never gating the exit code.
      try {
        const commitIso = git(['show', '-s', '--format=%cI', local.sha]);
        const commitMs = Date.parse(commitIso);
        const uploadMs = Date.parse(local.uploaded_at);
        if (Number.isFinite(commitMs) && Number.isFinite(uploadMs)) {
          const deltaMin = (uploadMs - commitMs) / 60000; // positive = commit before upload (expected)
          const FUTURE_TOLERANCE_MIN = 60; // clock skew allowance
          const STALE_TOLERANCE_DAYS = local.recorded === 'reconstructed' ? 180 : 14;
          if (deltaMin < -FUTURE_TOLERANCE_MIN) {
            warnings.push(`plausibility: recorded sha's commit is dated AFTER the recorded upload (commit ${commitIso}, uploaded_at ${local.uploaded_at}, commit is ${Math.abs(deltaMin).toFixed(0)} min later) — a build cannot ship code that does not exist yet. This sha is likely wrong, or the two clocks disagree. Not proof (ASC has no git-SHA field to confirm against) — a signal worth checking by hand.`);
          } else if (deltaMin > STALE_TOLERANCE_DAYS * 1440) {
            warnings.push(`plausibility: recorded sha's commit (${commitIso}) predates the recorded upload (${local.uploaded_at}) by ${(deltaMin / 1440).toFixed(1)} days, wider than the ${STALE_TOLERANCE_DAYS}-day band expected for a "${local.recorded}" entry. Not proof of a wrong sha — a slow release process or a rebase can explain this too — but wide enough to be worth a second look.`);
          }
        }
      } catch {
        warnings.push(`plausibility: recorded sha ${local.sha} does not resolve in this local checkout, so its commit date could not be cross-checked against uploaded_at (fetch it first if it's on a remote you haven't fetched).`);
      }

      console.log(`verify: build ${targetBuild} — local sha ${local.sha} (${local.recorded})`);
      // Mandatory on EVERY invocation of this command, pass or fail — this is
      // the one fact the ledger cannot prove about itself, and it must never
      // be possible to read a clean run as "the sha was confirmed."
      console.log('  SHA NOT INDEPENDENTLY VERIFIED — ASC has no git-SHA field; this ledger');
      console.log('  entry\'s sha is only as trustworthy as whatever process wrote it.');
      if (findings.length === 0) {
        console.log('  OK — no drift detected against live App Store Connect (build number,');
        console.log('  upload time, and ledger-vs-ASC max all agree).');
      } else {
        console.log(`  ${findings.length} finding(s):`);
        for (const f of findings) console.log(`  - ${f}`);
      }
      if (warnings.length > 0) {
        console.log(`  ${warnings.length} WARNING(s) (indirect plausibility signal only, does not fail this check):`);
        for (const w of warnings) console.log(`  ! ${w}`);
      }
      if (findings.length > 0) process.exit(1);
      break;
    }

    default:
      console.error('usage: _build_ledger.mjs <record|sha-for|latest|list|contains|verify> ...');
      process.exit(2);
  }
}

main().catch((e) => { console.error(`build-ledger: ${e.message}`); process.exit(1); });
