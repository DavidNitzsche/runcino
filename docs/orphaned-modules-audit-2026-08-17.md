# Orphaned modules — 2026-08-17

A sweep for `lib/*.ts` files with real logic (>40 lines) and zero live
importers anywhere in the repo (static or dynamic import, both checked).
Nine hits. Two were false positives from dynamic `import()` my first pass
missed (`standing-recommendation.ts`, `morning-brief.ts` — both live,
wired via `import('@/lib/coach/...')` in `seed.ts`). This is what's left,
triaged.

## Confirmed dead — safe to remove, blocked by the permission classifier tonight

**`lib/coach/router.ts`** — a `resolveMode()` surface router built for an
LLM tool-use coach engine (`lib/coach/engine.ts`). That whole architecture
was abandoned: `fact-reciter.ts`'s own header cites "Cardinal Rule #1
(PROJECT.md, locked 2026-05-28): Zero LLM · anywhere · ever. This file
replaces `lib/coach/engine.ts`." `engine.ts` no longer exists on disk.
`router.ts` is the orphaned half of a fully-superseded design — confirmed,
not merely suspected. Attempted `git rm` tonight; the auto-mode permission
classifier blocked it (a delete op it wasn't willing to wave through
unattended). Needs your go, or just delete it yourself — it's inert.

## Not touched — explained by an intentional product decision, not a bug

**`lib/coach/strength-status.ts`** — strength/cross-training were removed
from all surfaces (`project_core_coaching_direction_2026-08-17`), data
ingest kept deliberately reversible. This file's caller was presumably the
surface that got cut. Consistent with the decision, not worth resurrecting
or deleting tonight — leave it as-is until strength returns or is formally
sunset.

**`lib/strava/streams.ts`** — untracked, uncommitted. This is the peer
session's course-elevation work in progress in the shared checkout, not
mine to touch (see `feedback_shared_worktree_commit_capture`).

## Real gaps worth your call — not fixed tonight, each is a real decision

**`lib/plan/citation.ts` + `lib/plan/adapt-block.ts`** — the bigger one.
Built 2026-06-08 as "Phase 1.3/1.4" of `docs/PLAN_ENGINE_ARCHITECTURE.md`:
a compile-time-enforced citation system (`mutateWithCitation()` — calling a
plan mutation without a `ResearchCitation` literal fails to compile) and a
3-day-forward-reasoning wrapper around the day-of adapter. Neither has a
single caller. This is the exact enforcement mechanism CLAUDE.md's Rule 7
doctrine-gate philosophy asks for — applied one level down, at every plan
*mutation* rather than at physiological constants — and it was built,
then never adopted by the actual adapter/generator call sites. Migrating
every mutation site onto it is real, cross-cutting surgery on the plan
engine, not a one-file fix. Flagging as a decision, not building it
unattended: is this still the direction, and if so is it worth the
migration cost now or does the doctrine-registry gate already cover the
same ground well enough that this seam is redundant?

**`lib/races/packing.ts`** — a P36 race-week packing list
(`defaultPackingList()`, doctrine-driven, gear/fueling/race-day/recovery,
per-runner overrides already have a `races.meta.packing` slot). Pure
function, well-specified, last touched today. Zero renderers. A real
built-but-never-shipped feature — moderate value, but wiring it means
adding a card to race-detail's race-week mode, which is composition work
under the design brief's rules, not a backend-only change. Good candidate
for tomorrow's agent queue, not tonight's unattended pass.

## Noted, not urgent

**`lib/faff/state-tokens.ts`** vs `lib/faff/glance-adapter.ts`'s inline
`GRADIENT_BY_STATE` — two independent state→gradient mappings. Checked
both maps key-by-key: **no drift today**, they agree on every state. Not a
live bug. But `state-tokens.ts`'s whole reason to exist ("Cardinal Rule
#4 · single source of truth") is doing nothing — `glance-adapter.ts` is
the one actually consumed by 7 files. They use different value shapes
(`'g-easy'` bare token vs. `var(--g-easy)`), so consolidating isn't a
one-line change — real refactor of the poster-gradient pipeline, left
alone tonight rather than risked against a currently-correct render path.

**`lib/plan/core.ts`** — a clean, correct primitives refactor
(`id()`/`addDays()`/`mondayOf()`/etc.) meant to de-duplicate three plan
builders. Zero adopters — the duplication it was meant to kill is still
live in all three builders. Low risk, low urgency; a good small cleanup
task whenever someone's next in those three files anyway, not worth a
dedicated pass on its own.

**`lib/ops/sentry.ts`** — `reportError()` wrapper, zero callers. Turned
out lower-stakes than it looked: `lib/ops/alerts.ts` (`raiseAlert`) is the
real alert pipeline and IS actively used across 6+ cron/webhook/auth call
sites. `sentry.ts` was meant to be a nicer wrapper around the same thing
and nobody switched to it — redundant tooling, not a hidden reliability
gap.
