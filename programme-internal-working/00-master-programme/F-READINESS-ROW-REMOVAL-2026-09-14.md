# F-READINESS-1 — readiness-score row removed from Today, real removal not a flag — 2026-09-14

**Status: REMOVED (server + every live client consumer), typechecked, native
build green on a real destination, and code-audited against every other
"readiness" surface in the app to confirm nothing else was left half-connected.**

David's own instruction, relayed via the programme lead: drop the
readiness-score row from Today entirely, for now — *"until [a real health
section] is built, we drop anything that is faked in the app."* Scoped exactly
by design-review finding 001. This is a removal, not a fix: no replacement
placeholder, no flag, no speculative build toward a future health section.

## 1 · What was found (Rule 13's "grep broadly first")

The readiness row on Today is built server-side in one place —
`buildWhereYouAre()` in `web-v2/app/api/v5/today/route.ts` — and had exactly
one live client consumer: the V5 "Today, before the run" screen
(`native-v2/Faff/Faff/ViewsV5/TodayBeforeV5.swift`), which expanded it in
place via a `readinessExpansion` view when a row's `action` was
`"expand-readiness"`.

Everything else in the codebase that mentions "readiness" was traced and
found to be a **different** consumer of the same underlying signal, or a
different feature entirely — not a second half-connected consumer of the row
being removed:

- **`glance.readiness` / `computeReadiness()`** (`web-v2/lib/coach/glance-
  state.ts`, `web-v2/lib/coach/readiness.ts`) — the underlying composite
  score computation. Still consumed by the readiness pull-back safety guard,
  `web-v2/lib/coach/morning-brief.ts`, and `web-v2/lib/coach/fact-
  reciter.ts`. **Untouched** — only the Today *display row* built from it is
  gone.
- **Apple Watch payload** (`web-v2/lib/watch/build-workout.ts`'s
  `readinessScore`/`readinessLabel` on `WatchWorkout`) — calls
  `computeReadiness()` directly, independent of `buildWhereYouAre()`/the
  `whereYouAre` row array. Not broken by this change, and out of scope (a
  different device/surface, not Today; David's instruction named Today
  specifically).
- **Health tab** (`native-v2/Faff/Faff/Components/ReadinessBriefSheet.swift`,
  `Views/HealthView.swift`, `Models/ReadinessBriefSeed.swift`, `GET
  /api/readiness/brief`) — a separate, still-live readiness breakdown surface
  reached from the Health tab, not from Today's "Where you are" section.
  `ReadinessBriefSeed`/`ReadinessPillar`/`API.fetchReadinessBrief()` are
  still used here, so none of that type/decoder plumbing was deleted — only
  `TodayBeforeLiveV5`'s *own, second* prefetch of the same endpoint (which
  fed only the row now gone) was removed. Out of scope for this task
  (Today-only), left untouched.
- **Legacy v3 Today tab** (`native-v2/Faff/Faff/Views/TodayView.swift`,
  `Components/TodayReadinessPanel.swift`, `HealthCompactGauge.swift`,
  `ReadinessSnapshot`) — only reachable behind the `-faffLegacy` launch
  argument fallback (confirmed by reading `FaffApp.swift`); the live default
  root is `FaffV5Root`. Untouched — out of scope, and a separate,
  independently-argued escape hatch per CLAUDE.md.
- **`legacy/web/**`** — retired, unbuilt, not deployed (`main` builds
  `web-v2` only per CLAUDE.md's Race-data source-of-truth section).
  Untouched.
- **`web-v2/components/faff-app/overlays/Drawer.tsx`,
  `components/redesign/graphics/RangeScale.tsx`** — a separate, older web
  "readiness brief" drawer keyed off `FaffSeed['readiness']`
  (`morning-brief.ts`/`personal-goals.ts`/`redesign/settings`), not
  `V5Row`/`buildWhereYouAre()`. The web frontend is paused per CLAUDE.md
  ("IGNORED UNTIL FURTHER NOTICE") and this widget doesn't read the row being
  removed. Untouched.

## 2 · Server-side removal

`web-v2/app/api/v5/today/route.ts`, `buildWhereYouAre()` (grepped for the
row's construction rather than trusting the finding's original line number,
per the task's own instruction — it had moved to line 2593 by the time of
this change):

```diff
   const rows: V5Row[] = [];
-  if (glance.readiness?.score != null) {
-    rows.push({
-      id: 'readiness', label: 'Readiness',
-      sub: glance.readiness.label ?? null,
-      // RULE ONE. Readiness is a composite score — weighted HRV, RHR, sleep
-      // and load, each banded against a rolling baseline. Nothing measured
-      // it; a model produced it out of things that were. "82 / 100" printed
-      // like a heart rate is the app asserting a precision it does not have.
-      value: { text: `${glance.readiness.score} / 100`, modelled: true },
-      action: null,
-    });
-  }
-  // After readiness, before the week. Readiness is how the runner is TODAY,
-  // fitness is what they are worth, the week is what they have done. The
-  // section reads in that order. Null when the read failed or when there is
-  // no runner to read yet; a refusal is a row, not a null.
+  // F-READINESS-1 (2026-09-14) · the readiness row (composite HRV/RHR/sleep
+  // score) was removed from this section outright, per David's own
+  // instruction: "until [a real health section] is built, we drop anything
+  // that is faked in the app." A modelled composite score is exactly that —
+  // see design-review finding 001. `glance.readiness` itself is untouched
+  // and still feeds the readiness pull-back guard, the morning brief and
+  // `fact-reciter.ts`; only this display row is gone. Fitness is what the
+  // runner is worth, the week is what they have done. Null when the read
+  // failed or when there is no runner to read yet; a refusal is a row, not a
+  // null.
   if (fitnessRow) rows.push(fitnessRow);
```

No flag, no `if (false)`, no commented-out block — the construction is gone.
`glance` itself is still passed into the function and still used for
`weekPlanned`/`weekDone`/`sleep7Avg`, so the function signature is unchanged.

## 3 · Client-side removal (native-v2, deleted, not hidden)

Per Rule 20/CLAUDE.md's "prefer deletion before addition": the client's
consumer of the row and every piece of now-dead optional plumbing it required
were deleted, not flagged off.

**`native-v2/Faff/Faff/ViewsV5/TodayBeforeV5.swift`:**

- `whereYouAreSection` — removed the `row.action == "expand-readiness"`
  branch (the `ExpandingRow` that opened `readinessExpansion`). The row loop
  now only distinguishes "has an action" vs. "no action", same as every
  other `V5Row` list on this screen.
- Deleted the `readinessExpansion` computed view (the pillar breakdown list)
  in full.
- Deleted the `readinessPillars: [ReadinessPillar]` and
  `readinessPillarsUnread: Bool` screen parameters, and their doc comments —
  dead optional plumbing once the only view that read them was gone.
- Deleted the `@State private var readinessExpanded` toggle.
- Deleted the `#Preview` call's `readinessPillars:` argument, and the sample
  data feeding it (`TodayBeforeV5Sample.readinessPillars` +
  `readinessPillarsJSON`).
- Removed the `"id": "readiness", ... "action": "expand-readiness"` row from
  the embedded `sampleBeforeRunJSON` preview fixture.

**`native-v2/Faff/Faff/ViewsV5/TodayBeforeSamplesPreRunV5.swift`:** removed
the same readiness row from all 4 embedded JSON fixtures (tune-up, hills,
long, race day) used by the `-faffV5Screens` debug catalog's "5a-reps" /
"5a-hills" / "5a-long" / "5a-race" entries, so the design-review catalog
matches what the server now actually sends.

**`native-v2/Faff/Faff/ViewsV5/TodayBeforeLiveV5.swift`:** this is the file
that wires `TodayBeforeV5` to the network (used by all 4 real
`TodayHostV5.content(_:)` call sites in `HostsV5.swift` — confirmed this is
the live wiring, not a stale/parallel path). Removed:

- `@State private var pillars: [ReadinessPillar]` and `pillarsUnread: Bool`.
- The `pillarsFetch` async `GET /api/readiness/brief` call inside
  `prefetch()`, and its two lines writing into `pillars`/`pillarsUnread`
  (the prefetch now awaits 3 reads instead of 4).
- The `readinessPillars:`/`readinessPillarsUnread:` arguments passed into
  `TodayBeforeV5(...)`.
- Updated the file's own header comment and the `prefetch()` doc comment,
  which both explicitly named the readiness pillar fetch, so they don't
  describe removed behavior.

No other call site of `TodayBeforeV5(...)` (the 5 `ScreensCatalogV5.swift`
sample entries, the bare preview in the same file) passed the removed
parameters, so nothing else needed touching there.

## 4 · Verification

- **`npx tsc --noEmit`** (whole `web-v2` project, using a symlinked
  `node_modules` from the sibling worktree since this one had none per this
  project's own "worktrees may lack node_modules" guidance): **0 errors.**
- **`vitest`**: could not run in this environment — reproduced the exact same
  `ERR_MODULE_NOT_FOUND` (`pathe/dist/index.mjs`) directly against the main
  checkout's own `web-v2/node_modules`, confirming this is a pre-existing,
  broken dependency install in the shared checkout, not something this
  change caused or could fix in scope. Fell back to source-level audit
  (below) for the test-suite check per this project's documented
  node_modules-less-worktree guidance.
  - Checked whether any existing test asserts the readiness row's presence.
    `buildWhereYouAre` has no dedicated unit test (only call site is the
    route itself). The two other places a `{ id: 'readiness', ... }` object
    literal appears — `web-v2/lib/faff/_surface_sweep.test.ts` (2 places) and
    `web-v2/lib/faff/_v5_today.test.ts` (the stepped-day test) — are
    hand-authored fixture input to `composeV5Today`/`auditToday`, testing
    generic pass-through and stepped-day-suppression behavior with a
    same-shaped `V5Row` as a stand-in; none of them call or assert anything
    about `buildWhereYouAre` itself. **No test needed to flip from asserting
    presence to asserting absence, because none exercised the real
    construction path.**
- **`xcodebuild`** (native-v2, `Faff` scheme, Debug, real device destination
  `iPhone 17 Pro`, iOS 26.5 simulator runtime): **BUILD SUCCEEDED.** Zero
  warnings or errors in any of the 3 touched files
  (`TodayBeforeV5.swift`/`TodayBeforeLiveV5.swift`/
  `TodayBeforeSamplesPreRunV5.swift`). (An initial attempt against the full
  aggregate scheme with a generic `iOS Simulator` destination failed on an
  unrelated `WatchKit` module-resolution error in `WatchLayout.swift` — a
  destination/companion-pairing artifact, not a compile error in any file
  this change touched; the concrete-device build above is the real signal.)
- **Live render**: launched the compiled `Faff.app` in a fresh iOS
  simulator via the app's own `-faffV5Screens` debug launch argument (bypasses
  login, goes straight to the design-review screens catalog built from this
  same sample data). Confirmed visually that the catalog's other Today-family
  screens render correctly off the rebuilt app (a "Today · after the run"
  card rendered with the correct layout, no crash, no dangling readiness
  UI). Simulator tooling in this shared, multi-session environment became
  unresponsive (commands timing out under concurrent load from other
  sessions' simulators/builds) before a screenshot of the exact "5a · Today,
  before the run" catalog entry could be captured — reported honestly rather
  than claimed. The code-level evidence (no "readiness"/`Readiness` string
  remains anywhere in `TodayBeforeV5.swift`, `TodayBeforeLiveV5.swift`, or
  `TodayBeforeSamplesPreRunV5.swift`; the sample JSON the catalog renders no
  longer contains the row; the build compiles and links clean) is strong,
  but per Rule 13 this one specific screenshot is marked **unconfirmed**, not
  claimed.

## 5 · What did NOT change

- `glance.readiness` / `computeReadiness()` / the readiness pull-back safety
  guard / `morning-brief.ts` / `fact-reciter.ts` — untouched.
- The Apple Watch's own `readinessScore`/`readinessLabel` payload fields —
  untouched (independent consumer, different surface).
- The Health tab's `ReadinessBriefSheet`/`GET /api/readiness/brief` — still
  live, untouched; only Today's second, redundant prefetch of the same
  endpoint is gone.
- The legacy `-faffLegacy` v3 Today tab and its own readiness panel —
  untouched (unreachable by default, independently argued escape hatch).
- No replacement placeholder was added anywhere the row used to render, and
  nothing was built toward "a real health section" — that is explicitly
  future work David named, not this task.

## Branch

`fix/readiness-row-removal-2026-09-14`, based on current `origin/main` at
the time of this change (`9fbc79543`). Not pushed, not merged — left for
external review submission per standing instruction, despite being low-risk.
