/**
 * REBUILDTRUTH-1 · ACKSURVIVE-1 · EXPIRYMOUNT-1 · STATUSWORDS-1
 *
 * Four of David's 2026-09-05 item-12 fixes share one shape: **the app told
 * somebody a thing had happened when it had not.** They are gated together
 * because separating them would suggest they are four bugs rather than one
 * habit.
 *
 *   REBUILDTRUTH-1  a route returned `rebuildTriggered: true` as a literal
 *   ACKSURVIVE-1    a rebuild left the runner's pending questions pointing at
 *                   a plan that no longer exists
 *   EXPIRYMOUNT-1   proposal expiry ran only when a phone asked
 *   STATUSWORDS-1   tooling and comments said DEPLOYED when they meant BUILT
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (CLAUDE.md Rule 22) ─────────────────────
 *
 *   · It reads SOURCE. It cannot fail on a rebuild that genuinely misreports
 *     at runtime, only on the shapes that made misreporting possible. The
 *     behavioural half of the family lives in `lib/plan/_noop_stamp.test.ts`.
 *   · Guard S1's phrase list is a BLOCKLIST, and a blocklist can only catch
 *     the phrasings someone thought of. A new way of claiming a deploy —
 *     "prod has this", "it is out" — passes. What it does guarantee is that
 *     the two known instances cannot come back.
 *   · Guard S2 proves a cited script EXISTS. It cannot prove the script
 *     checks what the citation says it checks.
 *   · Guard E1 proves the expiry sweep is MOUNTED in a cron route. It cannot
 *     prove the cron ran — `lib/ops/cron-ledger.ts` owns that — and it cannot
 *     prove the cron's user population reaches every runner holding pending
 *     rows. That gap is real and named in the report, not closed here.
 *   · Distribution (Rule 22): every assertion in this file is of the form
 *     "the honest shape is present" rather than "the dishonest string is
 *     absent", except S1 and A2 where absence IS the invariant — and both of
 *     those are paired with a positive assertion in the same test, because an
 *     absence-only assertion is satisfied by garbage (the citation scrub that
 *     turned "Research/04 §5.3." into ".3." passed exactly such a test).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(__dirname, '../..');
const REPO = path.resolve(WEB, '..');
const readWeb = (rel: string): string => fs.readFileSync(path.join(WEB, rel), 'utf8');
const readRepo = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

/* ══════════════════════════════════════════════════════════════════════════
 * REBUILDTRUTH-1 · a flag reports what happened
 * ═══════════════════════════════════════════════════════════════════════ */

describe('REBUILDTRUTH-1 · no route claims a rebuild it did not observe', () => {
  it('R1 · the goal-edit route reads fireAutoRebuild instead of discarding it', () => {
    const src = readWeb('app/api/race/[slug]/route.ts');
    expect(src.length, 'read nothing').toBeGreaterThan(2000);
    // The literal. This is the entire defect.
    expect(src).not.toContain('rebuildTriggered: true,');
    // And the honest shape that replaced it — asserted positively, so the fix
    // cannot be "delete the field".
    expect(src).toContain('rebuildTriggered: rebuild.rebuilt');
    expect(src).toContain('const r = await fireAutoRebuild({');
    // `unchanged` is the case `generate.ts` warns about by name: the rebuild
    // ran, produced nothing worth landing, and was rolled back.
    expect(src).toContain("status: 'no_change'");
    // A swallowed throw must not read as success.
    expect(src).toContain('the rebuild threw:');
  });

  it('R2 · the profile route does not call a dedupe or a no-change a replan', () => {
    const src = readWeb('app/api/profile/route.ts');
    expect(src.length).toBeGreaterThan(2000);
    expect(src).not.toContain('replanned = !!r.ok;');
    // SETTINGS-RULE11-1 (2026-09-09) · the inline `Boolean(r.ok && newPlanId)`
    // this test used to assert literally in THIS file moved to the shared
    // `resolveReplanOutcome` (R2c below), so `/api/settings/route.ts`'s
    // identical sibling defect (R2b) could call the same resolver instead of
    // a second hand-copy — Rule 16, one quantity one name. Asserted here as
    // "calls the shared resolver", not as the formula's own literal text.
    expect(src).toContain("from '@/lib/plan/replan-outcome'");
    expect(src).toContain('resolveReplanOutcome(');
  });

  it('R2b · app/api/settings/route.ts carried the identical sibling defect, fixed the same way', () => {
    // Found 2026-09-08 (audit §10a item 8): `replanned = !!r.ok` reads TRUE
    // for `deduped_within_30s` and `unchanged` exactly as it did in R2's
    // route before that one was fixed 2026-09-05 — a missed sibling, not a
    // regression, since REBUILDTRUTH-1 had zero mentions outside a code
    // comment. Fixed 2026-09-09 by calling the SAME resolver as R2.
    const src = readWeb('app/api/settings/route.ts');
    expect(src.length).toBeGreaterThan(1500);
    expect(src).not.toContain('replanned = !!r.ok;');
    expect(src).toContain("from '@/lib/plan/replan-outcome'");
    expect(src).toContain('resolveReplanOutcome(');
  });

  it('R2c · resolveReplanOutcome is the ONE place that reads newPlanId to decide replanned (Rule 16)', () => {
    const src = readWeb('lib/plan/replan-outcome.ts');
    expect(src).toContain('const replanned = Boolean(r.ok && newPlanId);');
    expect(src).toContain('replanStatus');
  });

  it('R3 · auto-rebuild still distinguishes the three outcomes it is read for', () => {
    // The discriminator this fix leans on. If `newPlanId` stopped being absent
    // on an `unchanged` rebuild, both routes above would silently go back to
    // reporting a replan that did not happen.
    const src = readWeb('lib/plan/auto-rebuild.ts');
    expect(src).toContain('newPlanId: unchanged ? undefined : newPlanId');
    expect(src).toMatch(/status\s*=\s*!rebuildOk \? 'pending' : unchanged \? 'no_change' : 'auto_applied'/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ACKSURVIVE-1 · a rebuild retires the runner's pending questions honestly
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ACKSURVIVE-1 · a rebuild does not leave pending proposals pointing at an archived plan', () => {
  it('A1 · the supersede exists, marks rather than deletes, and names its population', () => {
    const src = readWeb('lib/plan/proposals-state.ts');
    expect(src).toContain('export async function supersedeWorkoutProposalsForArchivedPlans');
    const fn = src.slice(src.indexOf('export async function supersedeWorkoutProposalsForArchivedPlans'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    // MARK, never DELETE — an accepted or declined proposal is a record of
    // what the runner decided and must survive.
    expect(body).toContain("SET status = 'superseded'");
    expect(body).not.toMatch(/DELETE\s+FROM/i);
    expect(body, 'it would retire proposals the runner had already answered')
      .toContain("p.status = 'pending'");
    // Rule 14 · the population is named: this user, archived plans only.
    expect(body).toContain('tp.archived_iso IS NOT NULL');
    expect(body).toContain('p.user_uuid = $1::uuid');
  });

  it('A2 · both clearActivePlansFor implementations call it', () => {
    // Five archive paths funnel through these two functions. Before this, the
    // ONLY caller in the app was `app/api/plan/undo/route.ts`, the rarest of
    // them.
    // Assert the CALL, never the mention. A first pass of this guard checked
    // `toContain('supersedeWorkoutProposalsForArchivedPlans')` and PASSED when
    // the call was deleted, because the destructuring `await import(...)` line
    // still carried the name (Rule 18 · a gate that cannot fail is a
    // hypothesis; this one was falsified and rewritten).
    for (const f of ['lib/plan/generate.ts', 'lib/plan/seed-from-onboarding.ts']) {
      const src = readWeb(f);
      expect(src, `${f} does not CALL the workout-proposal supersede`)
        .toMatch(/await supersedeWorkoutProposalsForArchivedPlans\((client|tx), userId\)/);
      // Alongside its sibling, not instead of it.
      expect(src, `${f} lost the plan-proposal supersede`)
        .toMatch(/await supersedeProposalsForArchivedPlans\((client|tx), userId\)/);
    }
  });

  it('A3 · the undo route keeps its own narrower supersede', () => {
    // Scoped to the one block it put away, which is correct there and is NOT
    // what the archive paths need. Two call sites, two scopes, on purpose.
    const src = readWeb('app/api/plan/undo/route.ts');
    expect(src).toContain('UPDATE plan_workout_proposals');
    expect(src).toContain("SET status = 'superseded'");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * EXPIRYMOUNT-1 · expiry does not wait for a phone
 * ═══════════════════════════════════════════════════════════════════════ */

describe('EXPIRYMOUNT-1 · proposal expiry is mounted on a cron, not on a fetch', () => {
  it('E1 · plan-drift calls the workout-proposal sweep', () => {
    // `lib/plan/_proposal_expiry.test.ts` states in its own header that it
    // "cannot fail on the sweep actually being SCHEDULED... that mount is a
    // separate line in a cron route". This is that line, gated. Rule 20: the
    // mechanism was correct and the mount was the hypothesis.
    const src = readWeb('app/api/cron/plan-drift/route.ts');
    expect(src.length).toBeGreaterThan(5000);
    // Word-boundary matched, and matched on the CALL. A substring check here
    // passed when the symbol was renamed to `expireStaleWorkoutProposalsXX`,
    // which is the mount vanishing (Rule 18 · falsified, then rewritten).
    expect(src, 'plan-drift does not call the workout-proposal sweep')
      .toMatch(/await expireStaleWorkoutProposals\(\w+\)/);
    expect(src, 'plan-drift does not call the plan-proposal sweep')
      .toMatch(/await expireStalePendingProposals\(\w+\)/);
  });

  it('E2 · a failed sweep is reported, never counted as "found nothing"', () => {
    const src = readWeb('app/api/cron/plan-drift/route.ts');
    // Rule 11 · the -1 sentinel is what separates "the sweep failed" from
    // "the sweep expired zero rows". A plain 0 would collapse them.
    expect(src).toContain('r.workout_proposals_expired = -1;');
  });

  it('E3 · the sweep itself uses the runner\'s own day, not the server\'s', () => {
    const src = readWeb('lib/plan/proposal-expiry.ts');
    expect(src).toContain('runnerToday');
    // The prose records why `CURRENT_DATE` was removed, so the string is still
    // in the file. The invariant is that no STATEMENT uses it — checked on the
    // backtick-quoted SQL only, which is where it would do damage.
    const sql = [...src.matchAll(/`([^`]*(?:UPDATE|SELECT)[^`]*)`/g)].map((m) => m[1]).join('\n');
    expect(sql.length, 'found no SQL to check').toBeGreaterThan(100);
    expect(sql, 'a statement still asks the server what day it is').not.toContain('CURRENT_DATE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * STATUSWORDS-1 · built is not merged is not deployed is not shipped
 * ═══════════════════════════════════════════════════════════════════════ */

/** Present-tense claims about production that the emitting code cannot see. */
const DEPLOY_CLAIMS: ReadonlyArray<{ phrase: string; why: string }> = [
  {
    phrase: 'Railway is building the same tree',
    why: 'a local `next build` asserting, in the present tense, what a service '
      + 'it never contacts is doing right now',
  },
  {
    phrase: 'is now written on every exit of this',
    why: 'a header claiming rows land in a table that is not applied to production',
  },
];

describe('STATUSWORDS-1 · no tool or header claims a deploy it cannot observe', () => {
  it('S1 · the known deployment-conflating claims are gone, and replaced', () => {
    const files = ['scripts/check-web-build.sh'];
    let scanned = 0;
    for (const f of files) {
      const src = readRepo(f);
      scanned += 1;
      for (const { phrase, why } of DEPLOY_CLAIMS) {
        // The phrase may appear ONLY inside the comment that records why it was
        // removed. One occurrence is the epitaph; two means it came back.
        const hits = src.split(phrase).length - 1;
        expect(hits, `${f} claims "${phrase}" — ${why}`).toBeLessThanOrEqual(1);
      }
    }
    // Liveness (Rule 18) · a scanner that read nothing must not report clean.
    expect(scanned, 'scanned zero files').toBe(files.length);
    // The positive half: the four words are named and separated.
    const build = readRepo('scripts/check-web-build.sh');
    for (const w of ['BUILT', 'MERGED', 'DEPLOYED', 'SHIPPED']) {
      expect(build, `check-web-build.sh does not distinguish ${w}`).toContain(w);
    }
    // And it says what it actually proved.
    expect(build).toContain('BUILT, locally');
  });

  it('S2 · every check-*.sh a source comment cites actually exists', () => {
    // Two files cited `check-planversion-ratchet.sh` as the gate keeping
    // `planVersion` honest. `check-planversion-ratchet.sh` does not exist and
    // never has; `check-imaginary-gate.sh` does not exist either and is named
    // only because the falsification pass inserts it. Rule 20's corollary: a
    // citation nothing verifies is worse than silence, because it stops the
    // next reader from checking.
    const scriptsDir = path.join(REPO, 'scripts');
    const onDisk = new Set(fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.sh')));
    expect(onDisk.size, 'read no scripts at all').toBeGreaterThan(10);

    const roots = ['lib', 'app'];
    const cited = new Map<string, string[]>();
    let filesScanned = 0;
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        filesScanned += 1;
        const src = fs.readFileSync(full, 'utf8');
        for (const m of src.matchAll(/\b(check-[a-z0-9-]+\.sh)\b/g)) {
          const rel = path.relative(WEB, full);
          cited.set(m[1], [...(cited.get(m[1]) ?? []), rel]);
        }
      }
    };
    for (const r of roots) walk(path.join(WEB, r));
    expect(filesScanned, 'scanned zero source files').toBeGreaterThan(500);
    expect(cited.size, 'found no gate citations at all — the pattern stopped matching')
      .toBeGreaterThan(3);

    const missing = [...cited.entries()]
      .filter(([name]) => !onDisk.has(name))
      // The two files that RECORD the dangling citation being removed name it
      // on purpose. They are identified by saying so, not by being allowlisted
      // by path — a path allowlist would excuse a future real citation in the
      // same file.
      .filter(([name, where]) => where.some((w) => {
        // A file EXCULPATES a name only by NAMING IT in the disclaimer:
        // "`check-foo.sh` does not exist". Never by proximity.
        //
        // The first version of this filter looked for "does not exist" within
        // 900 characters of the citation, and a falsification pass walked
        // straight through it: inserting a brand-new gate name beside an
        // existing disclaimer inherited that disclaimer and the gate reported
        // clean. A proximity rule excuses whatever happens to be
        // nearby, which is the opposite of what an exemption is for
        // (Rule 18 · "never let an exemption bypass the assertion — guard it
        // with the violating condition").
        const src = readWeb(w);
        const escaped = name.replace(/[.]/g, '\\.');
        return !new RegExp('`?' + escaped + '`?[^.]{0,80}?does not exist').test(src);
      }));
    expect(
      missing.map(([n, w]) => `${n} (cited by ${w.join(', ')})`),
      'a source comment cites a gate script that does not exist',
    ).toEqual([]);
  });

  it('S3 · the decision ledger says out loud that it is not on production', () => {
    // The house style, pinned so it cannot drift back to the present tense.
    // Rule 19: green is not deployed, and this table is the live example.
    const src = readWeb('lib/plan/mutate.ts');
    expect(src).toContain('IS NOT APPLIED TO PRODUCTION');
    expect(readWeb('lib/brain/ledger/decision-ledger.ts')).toContain('green is not deployed');
    // And the migration itself.
    expect(readWeb('db/migrations/166_plan_decision_ledger.sql'))
      .toContain('NOT APPLIED TO PRODUCTION');
  });
});
