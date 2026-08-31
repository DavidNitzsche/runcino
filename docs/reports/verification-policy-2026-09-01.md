# Verification policy — tooling built, real runs demonstrated

Response to `docs/PRODUCT_DECISIONS.md` § "2026-09-01 · Four calls on the
migration handback's open questions" #4. Built the `verify-commit` tool, wrote
the policy where it will actually be read, and assessed the three longer-term
tooling gaps the decision named as not-yet-built.

## Part 1 · `scripts/verify-commit.sh`

**What it does.** Given a SHA, it:

1. Resolves and validates the commit against the real repo (fails loudly on a
   bad SHA — no silent fallback to `HEAD`).
2. Checks it out, detached, into a dedicated persistent worktree at
   `.claude/worktrees/verify-commit` (already covered by the repo's
   `.claude/worktrees/` gitignore entry) — never the shared dirty tree.
   Asserts `git status --porcelain` is empty and `HEAD` matches the requested
   SHA exactly before proceeding; aborts otherwise.
3. Installs `web-v2` dependencies only when `package-lock.json`'s hash has
   actually changed since the last run (reuses `node_modules` and the
   Next.js `.next` build cache across invocations otherwise).
4. Runs **exactly** what `.githooks/pre-push` runs against that isolated
   checkout: `scripts/check-web-build.sh` (`tsc --noEmit` then `next build`)
   unconditionally, and `scripts/check-watch.sh` when the commit's diff
   against its parent touches watch paths — the identical path regex the
   dispatcher (`.githooks/pre-push`'s `touches_watch()`) uses, scaled from a
   push range to a single commit.
5. Reports PASS/FAIL per check with timing, and exits non-zero on any
   failure.

**A real finding while reading the hook, not assumed:** `check-web-build.sh`
invokes `npx next build` directly, not `npm run build`. npm's `prebuild`
lifecycle script only fires when a script is run via `npm run <name>` —
verified empirically (see the harness note below), so the local hook does
**not** run the 17-script `prebuild` chain (`check-doctrine.sh`,
`check-palette-sync.sh`, `check-normal-window.sh`, `check-client-graph.sh`,
etc.) at all. `verify-commit.sh` mirrors the hook faithfully, which means it
is narrower than what Railway (`railway.json`'s build command is `npm install
&& npm run build`, which does fire `prebuild`) and CI (see Part 3) actually
run. This is documented in the tool's own header and in
`docs/VERIFICATION_POLICY.md`, not silently glossed over — it's exactly why
condition (5), "CI/deployment verification succeeds where available," is
load-bearing rather than a formality: the local hook alone cannot see a
`prebuild`-chain regression, only Railway and CI can.

*Empirical check performed:* built a throwaway npm project with a stub `next`
binary and a `prebuild` script; `npm run build` printed `PREBUILD_RAN` before
`NEXT_BINARY_RAN`, `npx next build` printed only `NEXT_BINARY_RAN`. Confirmed
directly rather than assumed from general npm semantics.

### Real runs (this session, this machine)

| Run | Target | Result | Time | Notes |
|---|---|---|---|---|
| 1 | `HEAD` (`41071ccd`) | **CLEAN** | 98s | cold — `npm ci` ran (fresh worktree) |
| 2 | `HEAD` (`5395a07b`, main had advanced) | **CLEAN** | 44s | warm — `node_modules`/`.next` reused, no reinstall |
| 3 | falsifier commit (below) | **FAILED**, exit 1 | 10s | typecheck error caught, fast-fail before `next build` |
| 4 | `origin/main` (`5395a07b`) | **CLEAN** | 38s | worktree restored to a good SHA after the falsifier run |

**Falsification (Rule 18 — a gate is not trusted until made to fail).** Built
a separate scratch worktree at `/tmp/faff-falsify-scratch-*` off
`origin/main` (never touched the shared checkout), appended
`const __verifyCommitFalsifierTypeError: number = "a string";` to
`web-v2/lib/training/vdot.ts`, committed it with a `TEMP:` message stating it
would be discarded and never pushed. Ran `verify-commit.sh` against that SHA:

```
error TS2322: Type 'string' is not assignable to type 'number'.
✗ Web typecheck FAILED. Push aborted.
✗ check-web-build.sh — FAIL (9s)
✗ verify-commit: FAILED at e3e5b7f4... Do not treat this commit as verified.
```
Exit code confirmed `1` (checked directly, not just visually). Then removed
the scratch worktree (`git worktree remove --force`) and confirmed the
falsifier commit (`e3e5b7f42d81c23264117a8c1d7e22cc07fd7002`) is unreachable
from any branch or tag — `git branch/tag --contains` both return empty. It
was never pushed; it will be garbage-collected. The persistent verify-commit
worktree was then re-run against `origin/main` and confirmed clean again (run
4 above).

**Watch-path detection, checked without running the full simulator gate**
(which is slow and not itself part of this task): isolated the same regex
`verify-commit.sh` uses and ran it against commit `2f5838df` (touches
`legacy/native/Faff/FaffWatch Watch App/*.swift`) — correctly matched and
would trigger `check-watch.sh`. The unconditional path (`check-web-build.sh`)
was exercised for real in every run above.

## Part 2 · The formal bypass policy

Written in two places, per the assignment:

- **`docs/VERIFICATION_POLICY.md`** (new — `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md`
  is a 40-point coaching-engine architecture brief, not a process/CI document,
  so it was the wrong shape for this). Full policy: the seven conditions for
  bypassing without stopping, verbatim from the decision; the five
  stop-and-ask conditions; what `verify-commit.sh` does and does not
  automatically satisfy (conditions 2 and 3, by construction — 1, 4, 5, 6, 7
  remain the pushing agent's judgment call); what this does not authorize.
- **A comment block at the top of `.githooks/pre-push`** — so an agent who
  hits the failure sees the policy in the same place the failure happens,
  not only in a doc they'd have to already know to go find. Short version:
  run `verify-commit.sh <sha>`, that proves conditions 2–3, the other five
  are still yours to argue and disclose, and it names the stop-and-ask
  conditions inline.

`verify-commit.sh`'s own summary output reinforces this on every run — its
final lines explicitly state it satisfies conditions (2) and (3) "by
construction" and that (1), (4), (5), (6), (7) are still the caller's to
argue, so a clean run can't be mistaken for a complete bypass justification.

## Part 3 · Longer-term tooling gaps

### Per-agent worktrees — not built (workflow change, as scoped)

This is a process change (each agent gets its own worktree from the start,
rather than sharing one checkout) rather than a tooling one. Not attempted
here — it's outside what this task authorized, and it's a call about how
agents are dispatched, not something a single tooling PR should decide
unilaterally.

### Hook operating on the commit/index rather than the dirty working tree — scoped, not built

Assessed as **large/risky, reporting scope rather than building it**, per the
task's own instruction for this case.

What it would take: `.githooks/pre-push` would need to materialize the
commit(s) actually being pushed into an isolated location (exactly what
`verify-commit.sh` already does) and run checks there, instead of `cd`-ing
into the live `web-v2` and checking whatever is currently on disk. Concretely
that means: determine the pushed range from the hook's stdin (already parsed
today for `touches_watch()`), extend that same worktree-isolation logic to
`check-web-build.sh`'s two checks, and decide what to check for a
multi-commit push (the tip only? every commit? — a real product decision,
not a mechanical one).

Why this isn't a safe drop-in: it changes the behavior and latency of the
one hook every agent in this shared checkout depends on, on every push, by
default — not opt-in like `verify-commit.sh` is. A mistake here (wrong SHA
resolved, a caching bug, a worktree race between two agents pushing at once)
blocks everyone, silently, at the moment they're trying to ship. That's
exactly the failure class Rule 18 warns about turned up to the whole team.
`verify-commit.sh` already gives every agent the option to run this
commit-isolated check today, on demand; converting the hook itself from
opt-in to default is a deliberate call worth its own review, not a
side-effect of this task.

### CI enforcing the non-negotiable checks independently of the local hook — already exists, and it's currently red

**This is the most important finding in this report.** The decision doc
(written 2026-09-01) lists this as "not yet built." It was actually built
the night before: `.github/workflows/build-check.yml`, added in commit
`152950e4` (`2026-08-30 18:51:10 -0700`) — before the decision doc that calls
it a gap. It triggers on every push to `main`, and runs, in order: `npm ci`,
**`npm run prebuild`** (the full 17-script chain), `npx tsc --noEmit`, then
`npm run build` (`next build`). Confirmed active via `gh workflow list`
(`build-check active`). So this specific "not yet built" item in the
decision doc is stale — worth correcting the record, not re-building.

**But it is not passing right now.** Checked the last 10 runs via
`gh run list --workflow=build-check.yml --limit 10`: **10 of 10 failing**, in
the `Gates (prebuild)` step, in ~30-40 seconds each — consistent across many
different commits tonight, which means these are standing violations on
`main`, not push-specific flakes. The two concrete failures on the most
recent run (`33446766744`, commit `41071ccd`):

- `lib/audit/_coercion_scan.test.ts` — a new zero-erasure site at
  `web-v2/lib/plan/progression-spec.ts:92`
  (`v.trim().length > 0 ? v.trim() : null`), 1 finding, 0 allowed. This is
  exactly Rule 11's shape (a measured-empty/absent/failed value collapsing
  into one) and the gate is correctly catching it, not misfiring.
- `lib/audit/_generated_content_gate.test.ts` — `web-v2/lib/training/coaching-thesis.ts`
  is imported by nothing but its own test (`MODULES NOTHING IMPORTS`), 1
  finding, 0 allowed.

Neither is related to this task and neither was touched here — fixing them is
out of scope for a verification-tooling change, and per this repo's own
operating posture, an unrelated substantive fix doesn't belong bundled into a
docs/tooling commit. Flagged as a background task (see below) rather than
fixed inline.

**Consequence for the policy this report just wrote:** condition (5) ("CI/deployment
verification succeeds where available") cannot currently be satisfied via
`build-check.yml` for pushes to `main`, because it is red for reasons
unrelated to any specific push right now. `RAILWAY_TOKEN` is not set in this
environment, so Railway's own deploy status could not be checked directly
either — that check needs to happen from an environment that has the
credential. Until the two findings above are fixed, an agent invoking this
policy on a real bypass should treat condition (5) as "unavailable, argue
from Railway deploy status directly" rather than pointing at a green
`build-check.yml`, and say so explicitly in the disclosure.

## Files touched

- `scripts/verify-commit.sh` — new, executable.
- `docs/VERIFICATION_POLICY.md` — new.
- `.githooks/pre-push` — comment block added at the top; no behavioral change,
  zero lines of the dispatcher logic below it were touched.
- `docs/reports/verification-policy-2026-09-01.md` — this report.

## Recommended follow-up (flagged separately, not fixed here)

The two `build-check.yml` failures above (`progression-spec.ts:92` zero-erasure,
`coaching-thesis.ts` orphan module) are real, currently failing on every push
to `main`, and unrelated to this task's scope.
