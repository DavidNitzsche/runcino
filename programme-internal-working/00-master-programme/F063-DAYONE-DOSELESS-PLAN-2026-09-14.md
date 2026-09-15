# F063 — day-one dose-less reveal on a rest-day first day, both causes fixed — 2026-09-14

**Status: FIXED (both causes), typechecked, unit-tested (web-v2 + native),
Rule-18-falsified for both causes, Xcode build verified, and rendered
before/after on the `Faff-Review-1` simulator. Committed as three commits on
`fix/f063-dayone-doseless-plan-2026-09-14`, based on `origin/main`
(`df12260e3`). NOT pushed, NOT merged.**

---

## 0 · The finding, restated

Register entry `2026-09-14-010` / F063: a brand-new runner can land day one
of their very first plan on a rest day, and when they do, the onboarding
"day one reveal" screen (screen 9a, `OnboardingV5.swift`) shows a stray
fault-red dash instead of a prescription — literally the first thing a new
runner ever sees from the app.

Two distinct, both-real causes, as the register already traced. Both are
fixed here; neither fix touches the other's file beyond reading it for the
pattern.

---

## 1 · Cause A — the reveal panel's dash used the wrong ink (small, mechanical)

### 1.1 What was actually wrong

`OnboardingV5DayOne.dose` is a non-optional `FaffValue` (see the struct at
`OnboardingV5.swift:167`) — the optional→`.unreadable` conversion already
happens correctly, upstream, at the one production call site
(`HostsV5.swift`'s `dose: today.panel.dose.unreadableIfAbsent`, unchanged
since the onboarding flow first shipped). So a rest-day dose legitimately
resolves to `FaffValue.unreadable` before it ever reaches
`OnboardingRevealPanel` — that part matches the "already-shipped" pattern
the register cites from `BlockV5.swift` / `RacesV5.swift` / `HostsV5.swift`,
and is correct.

The actual bug was one level down, in how `OnboardingRevealPanel` RENDERED
that already-resolved value:

```swift
// before
day.dose.text(.faffText(22, weight: .semibold), color: V5.OnPanel.primary)
```

`.text(_:color:)` is `FaffValue`'s convenience sugar
(`DesignV5/ValuesV5.swift:275`), and it only sets `color`. It leaves
`FaffValueText`'s `mark` and `fault` parameters at their generic, OFF-panel
defaults (`V5.attention` and `V5.fault`). `V5.fault` (`#FF4438`) is the
exact token `TokensV5.swift`'s own `PanelInk.fault` doc comment already
measured and rejected for this context — on a day-state gradient panel it
fails contrast on **all six ramps**, and reads as a jarring, off-brand red
mark rather than the calm "—" the rest of the app draws for "nothing to
show here". Every other hero panel that draws this same field —
`HeroDayPanelContentV5` (the real Today screen, `PanelV5.swift:837-841`),
`BlockV5.swift:336-339`, `RacesV5.swift:274-276` — calls `FaffValueText`
directly and pins `mark`/`fault` to the panel's own ink. `OnboardingRevealPanel`
was the one hero-panel-shaped view that never got that treatment.

### 1.2 The fix

`native-v2/Faff/Faff/ViewsV5/OnboardingV5.swift`, `OnboardingRevealPanel.body`:

```swift
// after
FaffValueText(day.dose, font: .faffText(22, weight: .semibold),
              color: V5.OnPanel.primary, mark: V5.OnPanel.mark,
              fault: V5.OnPanel.fault)
```

`V5.OnPanel.mark`/`.fault` are the same dark-ramp tokens this file already
hardcodes for `.primary`/`.secondary` two lines above (this screen has no
per-ramp `\.v5PanelInk` environment plumbing of its own — a pre-existing,
out-of-scope simplification, see §5). A doctrine comment citing F063 and the
exact reasoning is left at the fix site.

### 1.3 Verification

- `xcodebuild -scheme Faff build` for the `Faff` scheme (embeds Watch) — **BUILD SUCCEEDED**, both before capturing the "before" screenshot (with the fix temporarily reverted) and after restoring it.
- New XCTest: `V5ContrastTests.testOnboardingRevealDoseDashClearsOnDayOneRamp`.
  Measures the OLD call site's token (`V5.fault`) failing `largeText` (3.0:1)
  contrast against every ramp a fresh plan's day one can actually carry
  (`.rest`, `.easy`, `.long`, `.phase` — never `.race`/`.quality`, since
  `composePlan` writes day one before any race exists and never opens on a
  hard session), and the fix's token (`V5.OnPanel.fault`) clearing all of
  them. Ran on-device via `xcodebuild test -only-testing:FaffTests/V5ContrastTests`
  on `Faff-Review-1` — **19/19 passed**, including this one.
- **Rule 18, rendered.** Used the app's own debug seam
  (`-faffV5Screens` launch argument → `ScreensCatalogV5` → "Onboarding · day
  one" / `9a-reveal`, which renders `OnboardingV5DayOne.sampleV5` directly).
  Temporarily forced that sample to a rest day (`dayState: .rest,
  sessionType: "Rest", dose: .unreadable`), then:
  - **Before** (cause A's fix reverted to the old `.text(_:color:)` sugar,
    sample still forced to rest): the reveal panel showed "REST" with a
    visibly **reddish/orange** dash beneath it — the literal stray fault
    mark the register describes.
  - **After** (fix restored): the identical rest-day sample renders a plain
    **white** dash, reading as part of the panel rather than an error.
  - Both the code revert and the sample-data override were temporary,
    reverted before committing (confirmed by `git diff` showing only the
    intended two-file, intentional diff — see the commit for cause A).

---

## 2 · Cause B — `frontLoadFirstRun`'s guard read the week boundary, not day one

### 2.1 What was actually wrong

`web-v2/lib/plan/generate.ts`'s `composePlan` carries a 2026-06-10
mitigation, "get them running on day one": if week 0's anchor day is a rest
day, steal an easy run from later in the week and put it there, so a
mid-week onboarder doesn't stare at several rest days before their first
run. Its guard, until this fix:

```ts
if (weeks.length > 0 && new Date(input.startMondayISO + 'T12:00:00Z').getUTCDay() !== 1) {
  frontLoadFirstRun(weeks[0].days, new Date(input.startMondayISO + 'T12:00:00Z').getUTCDay(), input.availableDows ?? null);
}
```

This reads `startMondayISO`'s weekday, and asks "is it not Monday" as its
proxy for "this runner is a mid-week onboarder, week 0 doesn't start on the
natural boundary". That proxy was correct until **WEEK-ALIGN-1
(2026-08-24)** — see `requestedBlockStartISO`'s doc comment
(`generate.ts:729-757`) — which deliberately split two questions that a
single variable had been answering:

- **Where does week 0 begin?** Always the training-week **boundary**
  (`weekStartBoundaryOf`, the day after `long_run_day`) → `startMondayISO`.
- **Which day is the runner's first?** The literal onboarding/join day →
  `requestedBlockStartISO(todayISO, startAnchor, startDateISO)`, consumed
  downstream at the persist layer as `clipBeforeISO`
  (`persistsComposedDay`, `generate.ts:796-808`).

After WEEK-ALIGN-1, `startMondayISO` is **always** the boundary and never
the literal day the runner's plan visually starts. The guard's proxy was
never updated to match. Concretely:

- For a **Sunday** long-run runner (the single most common case —
  `weekStartDow = (0 + 1) % 7 = 1`, i.e. Monday), the boundary is **always**
  Monday, so `getUTCDay() !== 1` is **permanently false**. The mitigation
  could never fire again for any Sunday-long-run onboarder, mid-week signup
  or not.
- For other long-run days the guard could still fire, but on the
  **boundary's** weekday — which `persistsComposedDay`/`clipBeforeISO` may
  drop as pre-signup — "fixing" a day the runner never sees while leaving
  their real day one (which may still be a rest day in the template)
  untouched.

Traced this via `git log -L` on the guard's own history: it has been
unchanged, verbatim, since the mitigation was first written — WEEK-ALIGN-1
landed around it, in the same file, without anyone revisiting this call
site.

### 2.2 The fix

**`ComposePlanInput` gets a new optional field**, `firstOwnedDayISO?: string
| null` (`generate.ts`, next to `startMondayISO`'s own definition): the
runner's actual first VISIBLE day, i.e. `requestedBlockStartISO(...)`'s
result — the same value the persist layer already computes and clips
against as `clipBeforeISO`. `composePlan` itself never called
`requestedBlockStartISO` before this — only the persist layer, downstream of
`composePlan`, ever did.

**The one production caller**, `loadGeneratorInputs`, already computes this
exact value as `blockStartISO` (`generate.ts:~17972`,
`requestedBlockStartISO(todayISO, startAnchor, startDateISO)`) before
`composePlan` is even invoked — it's the same call that later becomes
`clipBeforeISO`. It now also passes it through as `firstOwnedDayISO` on the
`ComposePlanInput` it returns.

**The guard and the relocation target both read it**, when present:

```ts
if (input.firstOwnedDayISO != null) {
  if (weeks.length > 0 && input.firstOwnedDayISO !== input.startMondayISO) {
    frontLoadFirstRun(weeks[0].days, new Date(input.firstOwnedDayISO + 'T12:00:00Z').getUTCDay(), input.availableDows ?? null);
  }
} else if (weeks.length > 0 && new Date(input.startMondayISO + 'T12:00:00Z').getUTCDay() !== 1) {
  // OLD guard, run verbatim — see §2.3 below.
  frontLoadFirstRun(weeks[0].days, new Date(input.startMondayISO + 'T12:00:00Z').getUTCDay(), input.availableDows ?? null);
}
```

`requestedBlockStartISO`, `clipBeforeISO` and `persistsComposedDay` are
**untouched** — they were correct. The bug was only that `composePlan`'s own
guard/target never learned about the split when WEEK-ALIGN-1 landed.

### 2.3 A real near-miss, caught by the verification bar itself

My first version of this fix used a simpler fallback: `const firstDayISO =
input.firstOwnedDayISO ?? input.startMondayISO`, then compared `firstDayISO
!== input.startMondayISO`. That is WRONG, and I only caught it because the
verification bar demanded running the full `lib/plan/` suite, not just the
targeted files: `_layout_contract.test.ts`'s 8,781-archetype corpus digest
changed. That harness (and several others — sim/bench callers, older
fixtures) still passes a **literal, non-Monday date directly as
`startMondayISO`** — the pre-WEEK-ALIGN-1 shape. My naive fallback made
`firstDayISO` trivially equal to `startMondayISO` for every such caller
(since neither supplies `firstOwnedDayISO`), which silently and permanently
**disabled** `frontLoadFirstRun` for all of them — a real behavior change,
not the byte-identical fallback I'd intended.

Fixed by making the fallback branch run the **OLD guard verbatim** (§2.2's
`else if`) rather than deriving a value that happens to differ. This is
genuinely byte-identical for every caller not supplying the new field —
confirmed by the digest test going back to green — and the new behavior is
reachable only through the one caller that explicitly supplies
`firstOwnedDayISO` today (the real onboarding/start-today path). Flagging
this here because it is exactly the "residual uncertainty" this report
should not gloss over: **any other caller migrated to
`ComposePlanInput` in the future without wiring `firstOwnedDayISO` will
silently keep the OLD (buggy) contract**, since the field is optional by
design (Rule per §2.4/scope). That's a reasonable default (least surprise —
adding a field never breaks an existing caller), but it does mean this bug
class is not structurally impossible to reintroduce for a brand-new caller;
only production's real callsite is fixed.

### 2.4 `_authoring_input_surface.test.ts`

This doctrine gate demands every new `ComposePlanInput` field be classified
against the runner's allowed inputs (Rule 20 / INPUT-SURFACE-1). Classified
`firstOwnedDayISO` under "completed versus future dates", alongside
`startMondayISO` — it decides WHEN day one's prescription is written, never
WHAT is prescribed, so it is not a new authority over plan content.

### 2.5 The test gap — `_audit_placement.test.ts`

The register already named this: `_audit_placement.test.ts`'s `buildInput`
passes the raw onboarding weekday straight into `startMondayISO`
(`STARTDOW-1`'s own header even documents the OLD guard verbatim, unaware it
had gone stale) — the pre-WEEK-ALIGN-1 contract. Every test in that file,
run against that shape, proved nothing about this regression.

Added a new `describe` block, `FIRSTDAY-1 · frontLoadFirstRun reads the
runner's real first day`, that builds the **exact production shape**: a
Sunday-long-run runner, `startMondayISO` = the real boundary (computed via
the exported `weekStartBoundaryOf`), signing up on a genuinely mid-week day
(Wednesday). Per Rule 18:

1. `RULE 18 · pre-fix shape (no firstOwnedDayISO) reproduces day one landing
   dose-less` — confirms the bug reproducing FIRST: without
   `firstOwnedDayISO`, day one (Wednesday) lands exactly as the boundary
   template drew it — a rest day, `distanceMi === 0`.
2. `FIXED · firstOwnedDayISO lets frontLoadFirstRun seat a real run on the
   runner's actual day one` — confirms the fix: with `firstOwnedDayISO`
   supplied, day one becomes `easy` with real mileage, the weekly running-day
   count is unchanged (conservative relocation, not additive), and the donor
   day (the template's other easy day) is now rest.

Verified the falsification is real, not a fixture artifact: temporarily
reverted cause B's guard to the pre-fix code (file-copy backup, not
`git stash` — this repo has flagged `git stash` as unsafe across shared
worktrees), reran the suite — the `FIXED` test failed exactly as predicted
(`expected 'rest' to be 'easy'`), the `RULE 18 · pre-fix shape` test and
every other test in the file still passed. Restored the fix, reran — 13/13
green again.

---

## 3 · Doctrine citation

`WEEK-ALIGN-1` (2026-08-24, `generate.ts:729-757` /
`requestedBlockStartISO`'s own doc comment) is cited at both fix sites (the
new `ComposePlanInput.firstOwnedDayISO` field doc and the guard itself) and
in this report, per this file's own dense, WHY-not-WHAT comment register.

---

## 4 · Full verification run

### 4.1 TypeScript

`npx tsc --noEmit` in `web-v2` — clean at every checkpoint (after cause A/B
individually, after the test-gap fix, and at the final state).

### 4.2 Targeted suites

| Suite | Result |
|---|---|
| `lib/plan/_audit_placement.test.ts` | 13/13 passed (11 pre-existing + 2 new F063 + the sanity checks folded into the new describe block make 13 total) |
| `lib/plan/_maint_invariants.test.ts` | 5/5 passed |
| `lib/plan/_sweep_allusers.test.ts` | 1/1 passed (9,294 archetypes) |
| `lib/plan/_rolling_seven_ceiling.test.ts` | 4/6 passed, 2 failed — **same 2 pre-existing failures as before this change** (register finding F046; same assertion text, same line numbers, confirmed unrelated to F063 both by inspection and by the full `lib/plan/` run below) |
| `lib/plan/_authoring_input_surface.test.ts` | Failed once (new field unclassified), fixed by classifying `firstOwnedDayISO`, then passed |
| `lib/plan/_layout_contract.test.ts` (8,781-archetype corpus digest) | Failed once during iteration (see §2.3), passed after the guard redesign — confirms true byte-stability for every caller not supplying the new field |
| Full `lib/plan/` directory (240 files, 3,667 tests) | 217 passed / 4 failed (final) → after the `_authoring_input_surface`/`_layout_contract` fixes: **235 passed / 2 failed / 19 skipped**, the 2 failures being `_rolling_seven_ceiling`'s pre-existing pair and one DB-gated audit liveness check (`_authoring_shadow_compare.audit.test.ts`, fails identically with or without this change — it refuses to report green when `DATABASE_URL_RO` is unset, by design) |

### 4.3 Rule 18 falsification, both causes

- **Cause A**: reverted the render-site fix to the old `.text(_:color:)`
  sugar, forced the debug catalog's sample to a rest day, rebuilt, and
  rendered on `Faff-Review-1` — reproduced the reddish/orange stray dash.
  Restored the fix, rebuilt, rendered again — plain white dash. See §1.3.
- **Cause B**: reverted the guard to the pre-fix code via a file-copy backup
  (not `git stash`), reran `_audit_placement.test.ts` — the new `FIXED` test
  failed with the exact predicted mismatch, everything else stayed green.
  Restored, reran — 13/13 green. See §2.5.

### 4.4 Swift build + on-device test

- `xcodebuild -project Faff.xcodeproj -scheme Faff -destination "platform=iOS
  Simulator,name=Faff-Review-1" build` — **BUILD SUCCEEDED** (embeds the
  Watch app target, as required).
- `xcodebuild test -only-testing:FaffTests/V5ContrastTests` on
  `Faff-Review-1` — **19/19 passed**.
- Rendered `OnboardingRevealPanel` via the app's own `-faffV5Screens` debug
  catalog on `Faff-Review-1` (`iPhone 17 Pro`) — one of the three
  David-approved simulators, and the one already booted in this environment.
  Did not create any new simulator or device model.

### 4.5 Full-suite baseline diff (`origin/main` before vs. this branch after)

Per the verification bar: checked out `origin/main`
(`df12260e3`, confirmed unmoved via `git fetch` immediately before) into the
working tree (via `git checkout df12260e3 -- .`, not a branch switch, so the
three F063 commits stayed intact on this branch's history), ran the full
`npx vitest run` suite as the BEFORE baseline, then restored this branch's
files (`git checkout HEAD -- .`) and ran it again as the AFTER.

**BEFORE (origin/main, `df12260e3`):** Test Files: 3 failed | 631 passed | 52
skipped (686). Tests: 4 failed | 12,346 passed | 1 expected fail | 260
skipped (12,611). Duration 73.6s (first run) / 86.7s (rerun for the full
failure list, below — vitest's transform/import timings vary run to run,
counts do not).

The 3 failing files / 4 failing tests, BEFORE:

1. `lib/plan/_authoring_shadow_compare.audit.test.ts` — `AUTHORING SHADOW
   COMPARE · liveness > states whether the DB-backed comparison ran at all`
   — refuses to report green when `DATABASE_URL_RO` is unset (by design,
   Rule 18).
2. `lib/plan/_rolling_seven_ceiling.test.ts` — `it takes EASY miles only ·
   no long run, quality session or race day is cut` and `Rule 9 · a hair
   more demonstrated peak buys a hair more plan, not a different one` — the
   pre-existing register finding F046, named in the task brief as an
   expected pre-existing failure.
3. `lib/adaptation/canonical-shadow/_f038_reign_scoping.audit.test.ts` —
   `F038 REIGN SCOPING · liveness > states whether the DB-backed replay ran
   at all` — same DB-gated-liveness shape as #1.

**AFTER (this branch, `9d25d10d1`):** Test Files: 3 failed | 631 passed | 52
skipped (686). Tests: 4 failed | 12,350 passed | 1 expected fail | 260
skipped (12,615). Duration 81.5s.

The 3 failing files / 4 failing tests, AFTER — **identical set, same test
names, same assertions**:

1. `lib/plan/_authoring_shadow_compare.audit.test.ts` — same DB-gated check.
2. `lib/plan/_rolling_seven_ceiling.test.ts` — same 2 pre-existing F046
   failures.
3. `lib/adaptation/canonical-shadow/_f038_reign_scoping.audit.test.ts` —
   same DB-gated check.

**New failures introduced by this change: none.** The +4 passed tests
(12,346 → 12,350) and +4 total tests (12,611 → 12,615) are exactly the four
new tests added to `_audit_placement.test.ts`'s F063 describe block (2
sanity checks + the pre-fix-reproduction test + the fixed-behavior test),
all passing. Methodology: fetched `origin/main` immediately before to
confirm it had not moved (still `df12260e3`), overlaid its file content onto
the working tree with `git checkout df12260e3 -- .` (HEAD stayed on this
branch throughout, so the three F063 commits were never at risk), ran the
full suite, then restored this branch's files with `git checkout HEAD -- .`
and ran it again.

---

## 5 · Scope boundaries — what this deliberately did NOT do

- **Did not touch `block-anchor.ts`, `requestedBlockStartISO`,
  `clipBeforeISO`, or `persistsComposedDay`'s own logic.** They were correct;
  only `composePlan`'s stale proxy for "is this runner's first day mid-week"
  moved.
- **Did not touch F062's own fix in `BlockV5.swift`** beyond reading it (and
  its git history) for the precedent pattern.
- **Did not change `frontLoadFirstRun`'s own internal logic** — which day it
  picks to relocate a run onto, given availability (FRONTLOAD-AVAIL-1) — only
  what it is told the "day one" weekday is.
- **Did not touch `docs/PRODUCT_DECISIONS.md`'s `TIEREVIDENCE-2`** or
  anything about self-reported experience level.
- **Did not give `OnboardingRevealPanel` full per-ramp `PanelInk` awareness.**
  It hardcodes `V5.OnPanel` (the dark-ramp set) for `.primary`/`.secondary`
  already, pre-existing and unrelated to F063; the cause-A fix matches that
  existing convention rather than introducing environment-based `PanelInk`
  plumbing this screen has never had. Flagging as a known, pre-existing,
  out-of-scope gap: if a fresh plan's day one is ever composed as `.quality`
  or `.race` (the two light ramps), this screen's headline/kicker text — not
  just the dose dash — would already have been under-inked before this fix,
  and remains so after it. In practice `composePlan` writes day one before
  any race exists and does not open a brand-new plan on a hard session, so
  this is very unlikely to be reachable, but it is not structurally
  impossible and was not verified either way here.
- **Did not migrate any OTHER `ComposePlanInput` caller
  (`sim-inputs.ts`, `block-preview.ts`, `authoring-shadow-compare.ts`, or any
  other test fixture) to supply `firstOwnedDayISO`.** Only the real
  onboarding/start-today path (`loadGeneratorInputs`) was wired. Every other
  caller keeps the OLD (pre-WEEK-ALIGN-1-aware) guard behavior by design — see
  §2.3's residual-uncertainty note.
- **Did not fully rewrite `_audit_placement.test.ts`'s `buildInput` helper**
  to be boundary-aware everywhere. That would touch the ~14k-combo sweep's
  shared plumbing and risk unrelated collateral breakage for a file already
  flagged as testing a stale contract; instead added a narrowly-scoped new
  `describe` block that constructs the real production shape directly,
  alongside (not replacing) the existing sweep.
- **Did not merge or push to `main`.** All three commits live on
  `fix/f063-dayone-doseless-plan-2026-09-14`, based on `origin/main`.

---

## 6 · Commits

1. `229d184db` — `fix(iphone-v5): F063 cause A -- day-one reveal dash reads honest, not raw fault`
2. `1bc8d7f87` — `fix(plan): F063 cause B -- frontLoadFirstRun reads the boundary, not day one`
3. `9d25d10d1` — `test(plan): F063 -- close the placement sweep's blind spot to WEEK-ALIGN-1`

Branch: `fix/f063-dayone-doseless-plan-2026-09-14`, based on `origin/main` @ `df12260e3`.
