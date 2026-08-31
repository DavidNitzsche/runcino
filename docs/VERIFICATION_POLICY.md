# Verification policy — isolated-commit verification as a formal substitute for the pre-push hook

**Locked 2026-09-01.** Authorized by `docs/PRODUCT_DECISIONS.md` §
"2026-09-01 · Four calls on the migration handback's open questions" #4, in
response to `docs/reports/handback-2026-09-01.md` §6, §9, §12.4 — two agents in
one night bypassed the pre-push hook with a bare `--no-verify`, both citing the
same real cause, neither one asking first, neither one formally documenting it
beyond a self-flagged note in a handback. This document is what should have
existed before the first bypass, not after the second.

This is a project-specific policy on top of `CLAUDE.md`'s general "operational
vs decision vs external" boundary. It does not loosen that boundary. It exists
because a bare `--no-verify` push is silent by default, and this repo's own
Rule 18 ("a gate is not trusted until it has been made to fail") and Rule 20
("a product rule with no gate is a hypothesis") both say a bypass pattern that
keeps recurring needs a real decision and a real check, not tacit tolerance.

## The problem this solves

`.githooks/pre-push` typechecks and builds `web-v2` against the **current
working tree** before every push. That is correct for a single-agent repo. It
is not concurrency-safe in this one: multiple agents routinely hold uncommitted
work in the same shared checkout at the same time (see `git worktree list` on
any given night), so an unrelated agent's in-progress edit can fail your hook
even when the commit you are pushing is, on its own, clean.

Two extremes are both wrong:

- **Banning any bypass** makes parallel agent work in a shared checkout
  impractical — an agent would be blocked by code it did not write and cannot
  fix, for a push that does not touch that code at all.
- **A silent, ad hoc `--no-verify`** — what actually happened twice in one
  night — trains the system to treat a safety boundary as optional, and
  produces exactly the failure mode CLAUDE.md's "operational vs decision vs
  external" section exists to prevent: an action gets buried instead of
  disclosed.

## The policy

**Isolated-commit verification is an acceptable FORMAL substitute for the
hook, not an unsupervised shortcut, and never a silent one.**

### An agent may bypass the local hook (`git push --no-verify`) without
### stopping to ask only when ALL seven of the following hold, verbatim from
### the authorizing decision:

1. **The failure is proven to originate exclusively from unrelated
   uncommitted changes.** Not assumed, not "probably" — proven. Diff the
   failure against what your own commit actually touches.
2. **The agent verifies the exact commit in a clean isolated worktree.**
   Not the shared dirty tree, not a nearby commit, the exact SHA being pushed.
3. **It runs the SAME checks the hook would have run, not a hand-picked
   subset.** Skipping the watch gate because it is slow, or skipping the build
   because tsc passed, does not qualify.
4. **Results are recorded in the handback or commit metadata.** Not just
   known to the pushing agent — written down somewhere the next reader finds
   it without asking.
5. **CI/deployment verification succeeds where available.** Isolated local
   verification is corroborating evidence, not a replacement for the systems
   that actually gate the branch.
6. **No merge, migration, security, or destructive-operation check is
   omitted.** This exception is about a concurrency artifact in the local
   hook, never about skipping a check because it is inconvenient.
7. **The bypass is explicitly disclosed, not silent.** State that you bypassed,
   why, and what you ran instead — in the same place condition 4 records the
   results.

### Must stop and ask instead when any of the following hold:

- The failure's unrelatedness **can't be proven** (it might be your own change).
- The hook's checks **can't be reproduced in isolation** (e.g. `check-watch.sh`
  needs a booted simulator this environment doesn't have).
- Isolated verification **disagrees with the hook** — the isolated run passes
  but the hook still fails, or vice versa, and you cannot explain why.
- The hook checks something **unavailable elsewhere** — no CI equivalent, no
  Railway confirmation possible.
- The push **affects shared state other agents may depend on** — a schema
  change, a shared config file, anything with a blast radius wider than your
  own commit.

## `scripts/verify-commit.sh` — conditions (2) and (3), by construction

`scripts/verify-commit.sh <sha>` is the "supported `verify-commit <sha>`
command defined as hook-equivalent" the decision names as not-yet-built
tooling. It exists now. Using it correctly satisfies conditions (2) and (3)
automatically — you do not have to separately argue you isolated the commit or
ran the full check set, because the tool only knows how to do both:

- It checks out the **exact requested SHA**, detached, into a dedicated
  worktree at `.claude/worktrees/verify-commit` — never the shared tree — and
  refuses to proceed if that worktree is not byte-clean against the commit.
- It runs **exactly** what `.githooks/pre-push` runs against that commit:
  `scripts/check-web-build.sh` (`tsc --noEmit` then `next build`, both
  unconditional) always, and `scripts/check-watch.sh` whenever the commit
  touches watch paths — the identical path list the dispatcher uses, scaled
  from a push range to a single commit's diff against its parent. There is no
  flag that produces a "lighter" hook-equivalent pass; `--skip-watch` exists
  only to let you deliberately skip a slow gate when you have an independent
  reason, and the tool visibly labels that run as **not** hook-equivalent in
  its own summary so it can't be mistaken for one.
- It reports PASS/FAIL per check and exits non-zero on any failure — see
  `docs/reports/verification-policy-2026-09-01.md` for a real clean run and a
  real falsified failure (a deliberate typecheck error, caught, then
  discarded per Rule 18).

Conditions (1) "proven unrelated", (4) "recorded", (5) "CI/deployment
succeeds", (6) "nothing omitted", and (7) "disclosed" are **not** automated by
this tool. They are still the pushing agent's judgment call to make and to
write down. Do not cite a clean `verify-commit.sh` run as satisfying all seven
conditions — it satisfies exactly two of them, by design, so that the other
five stay a deliberate act rather than something a green exit code quietly
implied.

### Practical notes

- `scripts/verify-commit.sh --clean` removes the persistent isolated worktree.
- The isolated worktree reuses `node_modules` and the Next.js build cache
  across calls (only re-running `npm ci` when `package-lock.json`'s hash
  actually changes), so repeated verification in one session is fast — see the
  report for real timings.
- **The local hook itself does not run the 17-script `prebuild` chain**
  (`check-doctrine.sh`, `check-palette-sync.sh`, `check-normal-window.sh`,
  `check-client-graph.sh`, etc.) — it calls `next build` via `npx`, not
  `npm run build`, so npm's `prebuild` lifecycle hook never fires locally.
  That full chain runs on Railway (`npm run build` in `railway.json`'s build
  command) and independently in CI (`.github/workflows/build-check.yml`, an
  explicit `npm run prebuild` step). `verify-commit.sh` faithfully mirrors
  what the **hook** runs, which is narrower than what Railway and CI run — see
  the report for why this makes condition (5) (CI/deployment verification)
  load-bearing rather than redundant, and not a formality.

## What this does not authorize

- Bypassing the hook because it is slow, or because a check is annoying, or
  because you are confident without having checked.
- Treating a green `verify-commit.sh` run as sufficient on its own — it proves
  the commit, not the bypass. The other five conditions are still arguments
  you have to make.
- Using this pattern for anything the "stop and ask" list above names.

## Where else this is written

The short version lives as a comment block at the top of
`.githooks/pre-push` itself, so an agent who hits the failure sees it in the
same place the failure happens, not only in a doc they have to know to go
find.
