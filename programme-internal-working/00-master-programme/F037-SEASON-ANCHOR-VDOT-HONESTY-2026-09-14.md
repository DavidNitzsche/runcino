# F037 — `pace_blend.season_anchor_vdot` honesty fix — 2026-09-14

**Status: FIXED, typechecked, unit-tested, Rule-18-falsified. NOT live-verified
against `DATABASE_URL_RO` — no database credentials were available in this
isolated agent worktree. A follow-up session with DB access should confirm
David's live before/after numbers (see §6).**

Framing, stated plainly per this project's push/pull-back rule: **this is an
honesty fix to a progress-DISPLAY field, not a training-pace change.**
`t_pace_s_per_mi` — the pace actually prescribed — is untouched, confirmed
fresh, and confirmed race-blind through a completely separate resolver
(`resolveThresholdCapacity()`). If this fix's Option-A branch fires on a real
account whose stored anchor matches the register's example, the corrected
`pace_blend.season_anchor_vdot` will read LOWER than the frozen value it
replaces (both AFC and Santa Monica computed ~44.1, under the frozen 46.6) —
that is the correct, intended outcome, not a regression.

## 1 · What was actually traced (correcting the prior guess)

The register/consult-log (`2026-09-14-006-progression-mechanism-
reconciliation.md`, Q2) flagged `pace_blend.season_anchor_vdot` /
`season_anchor_source` / `season_anchor_provisional` as mislabeled, and
hedged that the likely consumer was "plausibly the Progress/Gap screen, per
prior memory of `fitness-trajectory.ts` being live in `GapPanel`." I traced
every actual reader before touching anything, per this task's instruction not
to trust that guess uncorrected:

- **`web-v2/lib/training/fitness-trajectory.ts` and
  `web-v2/components/faff-app/views/GapPanel.tsx` do NOT read this field at
  all** (confirmed by full-repo grep for `season_anchor`, `seasonAnchor`,
  `measured_progress_fraction`, `measuredProgressFraction` across `app/`,
  `components/`, and native — zero hits outside `lib/plan`, `lib/training`,
  `lib/faff/v5-evidence-prose.ts`, and their own tests). The prior
  investigation's guess was wrong; there is no live GapPanel/Progress-screen
  consumer today.
- **`measured_progress_fraction`** (the sibling field on the same
  `pace_blend` object) is dead code by design, not a bug: `recompute-
  paces.ts`'s own header ("AUTHORING-CANONICAL-1 · THE GOAL→TRAINING-PACE
  BLEND IS DELETED") confirms the whole mechanism this field fed — a
  per-week `currentT → goalT` blend gated on banked goal-gap progress — was
  deleted 2026-09-01 because it let a stated goal distort training pace
  (Constitution §G). Every write site sets it to a literal `null`. Nothing
  reads it. Out of scope, correctly inert, left untouched.
- **The real, live consumers of `season_anchor_vdot`/`season_anchor_source`**
  are internal, not runner-facing UI:
  - `web-v2/lib/training/pace-anchor.ts`'s `anchorVdotFromState()` — a
    fallback rung (3rd of 4) in the regression/training-lead detection
    cascade used by `adapt.ts`. Left untouched: this is squarely
    adjacent to `AUTOMATIC_ADAPTATION_AUTHORITY` (F031), which this task
    explicitly excludes.
  - `web-v2/lib/plan/reanchor-plan.ts` — reads the stored anchor to decide
    whether an automatic re-anchor should fire, and to label a reanchor
    proposal's "from" evidence (`v5-evidence-prose.ts`'s "The fitness this
    block was priced at" narrative). I added write-time freshness stamps
    here (§3) but deliberately did NOT touch the trigger-decision variables
    (`wasProvisional`, `upgradesProvisionalAnchor`) — widening those would
    change when an automated re-anchor fires or defers to the adapter,
    which is the exact adaptation-cadence territory this task excludes.
    `ReanchorOutcome.fromSource` (the one field that could carry a
    corrected label downstream) has zero external readers today (confirmed
    by grep), so no runner-facing surface is currently affected either way.
  - `web-v2/lib/plan/generate.ts` — **this is the one write path that can
    make a value already stale at persistence time look freshly measured
    forever**, and it is where the fix lives.

## 2 · The actual defect, precisely

`generate.ts`'s `ComposePlanInput` carries an optional inheritance pair,
`seasonAnchorVdot?` / `seasonAnchorSource?`, documented (COLD-3, 2026-08-17)
as "the season's original anchor VDOT, carried FORWARD across mid-block
rebuilds." Before this fix:

```ts
const seasonAnchorSource: AnchorSource = input.seasonAnchorVdot != null
  ? (input.seasonAnchorSource ?? 'measured_vdot')
  : anchorSourceFromCapacityMode(anchors.basis.threshold.sourceMode);
...
season_anchor_vdot: input.seasonAnchorVdot ?? estimatedCurrentVdot,
```

`input.seasonAnchorVdot != null` was sufficient, on its own, to inherit both
the number **and its label** verbatim, with no check on how old that number
actually was. No timestamp of any kind travelled with it. A value that was
genuinely measured once — including, per the register, one traceable to
`users.vdot_last_reviewed`, unreviewed since 2026-05-19 — would re-stamp
itself `measured_vdot` / `season_anchor_provisional: false` on every
subsequent inheriting rebuild, forever, because nothing about the mechanism
could tell "measured 4 days ago" from "measured 4 months ago."

Note for the next reader: `AUTHORING-CANONICAL-1` (2026-09-01) already
changed `loadGeneratorInputs` to stop populating this inheritance pair for
production callers (confirmed: no production call site sets
`seasonAnchorVdot`; only test fixtures do), and added its own comment
claiming the anchor is "now written from the canonical threshold capacity's
own derived VDOT ... a stronger provenance than the three-rung inheritance."
That is true for every FRESH `composePlan()` call today. It does **not**
retroactively repair a `pace_blend` written by the OLD inheriting code before
that date and never rebuilt since — and the interface, the branch, and three
tested call sites (`_probe_cim_block.test.ts`, `_coldstart_doctrine.test.ts`,
`_authoring_input_surface.test.ts`) all keep this inheritance path alive and
reachable, so it cannot be assumed structurally dead. This fix hardens
exactly that seam, for both the historical case and any future caller.

## 3 · The fix (Option A, applied narrowly, plus a freshness stamp)

Chose **Option A — recompute live, the same way `t_pace_s_per_mi` already
does** — but scoped to fire only when an inherited value cannot prove it is
still fresh, not on every rebuild. Rationale for why this is Option A and not
Option B: the anchor's own doctrine purpose ("the fitness this block was
priced at") is a factual claim about the CURRENT authoring, and the doctrine
this codebase already cites for it (`Research/01` §"Freshness window") treats
a VDOT signal past 12 weeks/84 days as **expired**, not merely "a slower
baseline" — so an anchor that fails that test has no legitimate reading left
to relabel into; the honest thing left to do is recompute it off the same
live resolver already pricing the block. A genuinely fresh inheritance (inside
the 84-day window) is still honored unchanged — this is not a general-purpose
switch to a live mirror, which would defeat the anchor's purpose as a stable
comparison point for the reanchor mechanism.

**`web-v2/lib/plan/anchor-provenance.ts`** — added, doctrine-cited to
`Research/01-pace-zones-vdot.md` §"Freshness window" (:659-677):

- `SEASON_ANCHOR_EXPIRY_DAYS = 84` (the doctrine table's own "12+ weeks →
  Expired" row).
- `isAnchorStampExpired(stampedAtIso, asOfISO)` — pure, and **a missing stamp
  is treated as expired**, not as fresh-by-default. This is the load-bearing
  choice: every `pace_blend` written before this fix has no stamp at all, so
  the fail-safe direction matters. Precedent cited directly:
  `authoring-convergence.ts`'s `REANCHOR_STATUS_UNKNOWN` state already
  established this codebase's answer to the identical ambiguity ("be honest
  about this state rather than defaulting to 'assumed fine'" — Rule 11).
- `paceBlendAnchorIsExpired(paceBlend, asOfISO)` — the same check against a
  raw `pace_blend` object, mirroring `paceBlendAnchorIsProvisional`'s shape
  (source vs. age are two different questions; this is the age one).

**`web-v2/lib/plan/generate.ts`**:

- `ComposePlanInput` gained `seasonAnchorStampedAt?: string | null` next to
  the two existing inheritance fields, doc-commented with the same doctrine
  cite.
- The inheritance branch now checks `isAnchorStampExpired` first:
  ```ts
  const seasonAnchorInherited = input.seasonAnchorVdot != null
    && !isAnchorStampExpired(input.seasonAnchorStampedAt, input.startMondayISO);
  const seasonAnchorSource: AnchorSource = seasonAnchorInherited
    ? (input.seasonAnchorSource ?? 'measured_vdot')
    : anchorSourceFromCapacityMode(anchors.basis.threshold.sourceMode);
  ```
  and the `pace_blend` write uses `seasonAnchorInherited` the same way for
  both the number and a new `season_anchor_stamped_at` field: a trusted
  inheritance carries its ORIGINAL stamp forward unchanged (re-stamping "now"
  would launder an old-but-still-fresh measurement into a newer-looking one);
  an expired/absent one is replaced by the live `estimatedCurrentVdot` and
  stamped with this authoring's own deterministic date
  (`input.startMondayISO` — `composePlan` is a pure function with no
  `Date.now()`, per its own existing `_travel_invariants` byte-identical
  composition gate, so the stamp uses the same input every other
  deterministic field in this composer already uses).
- The two non-race composers (maintenance/recovery, which source their anchor
  from the always-freshly-computed `input.bestRecentVdot` rather than an
  inheritance parameter) now also write `season_anchor_stamped_at:
  input.startMondayISO`, so every write site leaves a checkable freshness
  mark going forward.
- Corrected an adjacent stale comment at the `pace_blend` write site that
  still described the deleted goal-blend gating mechanism as if live.

**`web-v2/lib/plan/reanchor-plan.ts`** — both explicit-reanchor write sites
(`reanchorOffCanonicalPrior`'s canonical-prior arm, `reanchorRacePrep`'s
apply arm) now also write `season_anchor_stamped_at` alongside the
`reanchored_at` they already stamp, for consistency: every writer of
`season_anchor_vdot` now also writes its freshness mark.

**Not changed, deliberately**: `wasProvisional` / `upgradesProvisionalAnchor`
in `reanchor-plan.ts` (would touch automated reanchor cadence/deferral — F031
territory), `pace-anchor.ts`'s detection cascade (same reason), and
`t_pace_s_per_mi` / `resolveThresholdCapacity()` (confirmed unrelated,
out of scope by the task's own instruction).

## 4 · Doctrine citation at the fix site

`anchor-provenance.ts` and `generate.ts` both carry a dense WHY-comment at
the fix site citing this exact resolution: `for coaching consult/consult-
log/2026-09-14-006-progression-mechanism-reconciliation.md` (Q2), explicit
that this is NOT the F032 "44.1 vs 46.6" tension (already separately
resolved — `t_pace_s_per_mi` never reads this anchor) and that a corrected
number moving down is the intended outcome, not a regression.

## 5 · Verification

- `npx tsc --noEmit` — clean, in `web-v2`, after every edit.
- New test file: `web-v2/lib/plan/_f037_season_anchor_honesty.test.ts` (10
  tests, all passing):
  - Unit tests on `isAnchorStampExpired` / `paceBlendAnchorIsExpired`:
    inside-window, past-84-days (using the register's own 2026-05-19 →
    2026-09-14 dates, 118 days), **missing stamp → expired**, unparseable
    stamp → expired, no-anchor-at-all → not expired.
    `paceBlendAnchorIsExpired` is also asserted directly against an object
    shaped exactly like the register's finding (46.6 /
    `'measured_vdot'` / `provisional: false`, no stamp) → `true`.
  - Integration tests calling `composePlan()` directly (no DB needed) with a
    synthetic fixture: a stale inherited anchor (46.6, stamped 2026-05-19,
    111 days before a 2026-09-07 `startMondayISO`) alongside a fresh
    `bestRecentVdot: 44.1` — asserts the persisted `season_anchor_vdot` lands
    at ~44.1 (not 46.6), is LOWER than the stale value, and is re-stamped
    with the authoring's own date. A second case with no stamp at all
    (matching every real pre-fix row) proves the same replacement. A third
    case with a stamp only 10 days old proves the fix does NOT force a live
    mirror — a genuinely fresh inheritance is honored unchanged, including
    its original stamp. A fourth case with no inheritance at all confirms
    fresh authoring stamps its own date.
- **Rule 18 falsification, performed**: temporarily swapped `generate.ts`
  back to its pre-fix `HEAD` content (via a file copy, not `git stash` — see
  `feedback_git_stash_shared_across_worktrees` memory), re-ran the new test
  file: 4 of 10 tests failed, reproducing the exact bug (`season_anchor_vdot`
  stayed 46.6 instead of recomputing to ~44.1; `season_anchor_stamped_at` was
  `undefined`). Restored the fix; all 10 tests green again, `tsc --noEmit`
  clean again.
- Registered the new `ComposePlanInput` field in
  `_authoring_input_surface.test.ts`'s `ALLOWED` allowlist (INPUT-SURFACE-1's
  own gate fails the build otherwise on any new field left unclassified).
- Full regression sweep: `lib/plan`, `lib/training`, `lib/faff`,
  `lib/doctrine`, `lib/adaptation` — 3,342+ tests passing. Confirmed the only
  failures present (`_rolling_seven_ceiling.test.ts` ×2,
  `_authoring_shadow_compare.audit.test.ts`,
  `_f038_reign_scoping.audit.test.ts`) are **pre-existing and unrelated**:
  the two audit tests fail only because `DATABASE_URL_RO`/`DATABASE_URL` is
  unset in this sandboxed worktree (they say so explicitly), and
  `_rolling_seven_ceiling.test.ts` fails identically against the unmodified
  `HEAD` copy of `generate.ts` (verified directly, via the same
  swap-and-restore technique used for the falsification above) — confirmed
  unrelated to this change.

## 6 · What was NOT verified, and why

**No live `DATABASE_URL_RO` query was performed.** This agent ran in an
isolated worktree sandbox with no database credentials in its environment
(`.env` held only the example placeholder; `env | grep DATABASE_URL` was
empty). The task asked for this only conditionally ("if you can safely query
... this is read-only verification"), so this is a known gap rather than a
skipped requirement: a follow-up session with `DATABASE_URL_RO` access should
confirm David's actual live `pace_blend.season_anchor_vdot` /
`season_anchor_source` / `season_anchor_stamped_at` before/after this fix's
next real rebuild, and report the exact numbers per the task's original ask.

**Also not resolved, correctly, per scope**: whether David's specific active
plan is currently reachable by this fix at all depends on facts only a live
DB read can settle — whether his current plan's `pace_blend` was written by
the pre- or post-2026-09-01 code, and whether it has been rebuilt since. If
his plan predates the fix and hasn't been rebuilt, `pace_blend.season_anchor_
vdot` will not change until the NEXT `composePlan()` rebuild or explicit
reanchor event touches it — this fix corrects the mechanism going forward and
for the tested inheritance path; it does not itself trigger an immediate
rewrite of an already-persisted stale row. Whether something SHOULD
proactively trigger that rewrite is a scheduling/triggering question
(adjacent to Q1/Q3 in the consult log) explicitly out of this task's scope.

## 7 · Files changed

- `web-v2/lib/plan/anchor-provenance.ts` — `SEASON_ANCHOR_EXPIRY_DAYS`,
  `isAnchorStampExpired`, `paceBlendAnchorIsExpired`.
- `web-v2/lib/plan/generate.ts` — `seasonAnchorStampedAt` field, hardened
  inheritance branch, `season_anchor_stamped_at` at all three `pace_blend`
  write sites, corrected an adjacent stale comment.
- `web-v2/lib/plan/reanchor-plan.ts` — `season_anchor_stamped_at` at both
  explicit-reanchor write sites.
- `web-v2/lib/plan/_authoring_input_surface.test.ts` — registered the new
  field in the input-surface allowlist.
- `web-v2/lib/plan/_f037_season_anchor_honesty.test.ts` — new, 10 tests.

Branch: `fix/f037-season-anchor-vdot-honesty-2026-09-14`, based on
`origin/main`. Not merged, not pushed, per instruction.
