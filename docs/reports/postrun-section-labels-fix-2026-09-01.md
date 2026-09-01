# Post-run section labels fix — 2026-09-01

Subject: `wko_eaa8cfd7cb94310b`, the account owner's real completed threshold
run (warm-up, 4 reps, 3 jogs, cool-down). Companion to
`docs/reports/postrun-recap-fix-2026-09-01.md`, which fixed the field-name
mismatch (`17b73fe2`) that first let real phase data reach this screen, and to
`6b37e71f`, which fixed the section pace math the moment that data arrived.
This report fixes the third bug the same render surfaced: the row **names**.

His own words, immediately on seeing the pace fix render: *"yeah but section
1, section2? thats nonsense. Needs to be warm up, interval 1, break, interval
2, etc. the plan. not some random bullshit."*

---

## Where the labels were generated

`native-v2/Faff/Faff/ViewsV5/TodayAfterV5.swift`, `sectionPieces` (the
"Piece by piece" post-run breakdown feeding `RepBreakdownV5`). Before this
fix:

```swift
return RepPiece(id: i,
         label: "Section \(i + 1)",
         isWork: true,
         ...
```

Every row was named off its bare array position, with no regard for what the
phase actually was — a warm-up, a real quality rep, or the jog between two of
them all read as an interchangeable "Section N".

## Why the real type wasn't being used — it was there and being dropped

`model.routePhases` (`V5RoutePhase`, `native-v2/Faff/Faff/DesignV5/APIV5.swift`)
only ever carried `{ mi, sec }`. The doc comment on `sectionPieces` said so
explicitly: *"All this screen carries is `routePhases`, which is a distance
and a duration per phase. So the rows are numbered rather than named... because
inventing [a name] from a pace would be the phone deciding what the plan
asked for."* That reasoning was sound for the payload as it stood, but the
payload was thinner than it needed to be.

The server side, `web-v2/app/api/v5/today/route.ts`, builds `routePhases` by
`flatMap`-ing `completionPhases` — the watch's own completion payload,
`coach_intents.value.phases` (`reason = 'watch_completion'`). That array
already carries a real `type` field (`"warmup" | "work" | "recovery" |
"cooldown"`), and this exact route function was already reading it twice, a
few lines away, for other purposes:

- `workAveragesFromPhases(completionPhases.map((ph) => ({ type: ph.type ?? null, ... })))` —
  scopes HR/cadence/pace averages to work phases only.
- the `phases` block feeding `deriveWin` (`type: p.type ?? null`) — lets the
  win-line composer talk about "the four reps" instead of "the whole run".

The `routePhases` flatMap was the one place that built a phase object and
left `type` on the floor:

```ts
routePhases: indoor
  ? []
  : completionPhases.flatMap((ph: any) => {
      const mi = Number(ph.actualDistanceMi ?? ph.distanceMi ?? ph.distance_mi);
      const sec = Number(ph.actualDurationSec ?? ph.durationSec ?? ph.duration_sec);
      return Number.isFinite(mi) && mi > 0 && Number.isFinite(sec) && sec > 0
        ? [{ mi, sec: Math.round(sec) }]   // <- type dropped here
        : [];
    }),
```

So this was a pure wire/plumbing gap, not a missing capability: the
classification the Swift side needed was one property away the whole time.
The web-v2 sibling fix in the same commit series (`17b73fe2`) had already
fixed the *distance/duration* field-name mismatch on this exact block; it
didn't touch `type` because `type` was never mismatched — it was just never
forwarded.

This mirrors, at a smaller scale, the same gap `RunDetailV5` never had:
`RunDetailV5.repPieces` reads `phase_breakdown` (a different, richer query —
`loadPhaseBreakdown` in `lib/coach/run-state.ts`), which already carries
`type` end to end and has since before tonight. The run-history screen was
never confused about which phase was which; the immediate post-run sheet,
reading the thinner `routePhases` wire, was.

## The fix

**`web-v2/lib/faff/v5-today.ts`** — added `type: string | null` to the two
`routePhases` type declarations (`V5Today.routePhases`,
`V5RecentRunCtx.routePhases`; `buildRecentRun`'s return type already aliases
`V5Today['routePhases']`, so it picked the change up for free).

**`web-v2/app/api/v5/today/route.ts`** — the `routePhases` flatMap now
forwards `type: typeof ph.type === 'string' ? ph.type : null`, passed through
raw rather than narrowed to the four known values (narrowing happens
client-side, same posture `lib/runs/run-shape.ts`'s `runPhases()` normalizer
takes for its own callers).

**`native-v2/Faff/Faff/DesignV5/APIV5.swift`** — `V5RoutePhase` gained
`let type: String?`. Plain `Decodable` auto-synthesis handles a missing or
null key as `nil`, so a phone running against an old server (pre-2026-09-01)
degrades safely rather than crashing.

**`native-v2/Faff/Faff/ViewsV5/TodayAfterV5.swift`, `sectionPieces`** — now
switches on the real type:

```swift
var workOrdinal: [Int: Int] = [:]
for (idx, p) in usable.enumerated() where p.type == "work" {
    workOrdinal[idx] = workOrdinal.count + 1
}
...
let label: String
switch p.type {
case "warmup":   label = "Warm Up"
case "cooldown": label = "Cool Down"
case "recovery": label = "Recovery"
case "work":     label = "Interval \(workOrdinal[i] ?? 1)"
default:         label = "Section \(i + 1)"
}
```

`isWork` now reads `p.type.map { $0 == "work" } ?? true` — a real
classification instead of the old blanket `true` "refusal to claim which
ones are work" (the refusal is preserved only for the no-`type` fallback
case, where nothing on the payload supports a claim either way).

This also fixes a second, quieter symptom of the same missing field:
`RepBreakdownV5`'s own header states its one visual-hierarchy rule — *"THE
WORK IS PRIMARY, the rest is context. Reps draw in full ink; warm-up,
recovery jogs and cool-down draw quiet."* With every row hard-coded to
`isWork: true`, that rule had nothing to key off on this screen and every
row — warm-up, reps, jogs, cool-down alike — drew in full ink. It now
actually distinguishes them.

### Word choices, and why they match the rest of the app (Rule 16/17)

- **"Interval N", counted within the work phases only** — not the phase's
  position in the whole array. This is the exact convention
  `LiveRunOutdoorV5.lineHead` already uses for the phase in progress during
  the run itself: `(isWork && workCount > 1) ? "Interval \(workIndex) of
  \(workCount)" : phase.label`, where `workIndex`/`workCount` are computed by
  filtering to `type == .work` first. `sectionPieces`'s `workOrdinal` walk is
  the same filter-then-number operation, so a runner who saw "Interval 2 of
  4" flash on their wrist mid-rep sees "Interval 2" again on the same rep
  after the run — one name, not two.
- **"Recovery"** for the jog between reps — the word `RunDetailV5
  .fallbackLabel` already uses (`case "recovery": return "Recovery"`) and the
  same word the pre-run card's spec copy uses for the identical phase
  (`web-v2/lib/training/spec-card.ts`: `recovery: 'Honest jog, not
  standing.'`). Not "Jog" — that word is not established anywhere on this
  card; "Recovery" already is, twice.
- **"Warm Up" / "Cool Down"** — title case, matching the task's explicit
  naming and legible at the row's 16-point weight; `RunDetailV5
  .fallbackLabel`'s own fallback spells these "Warm-up"/"Cool-down" (hyphenated,
  sentence case) since it is a fallback for when the server sends no label at
  all on the richer `phase_breakdown` payload — a different call site with a
  different neighbourhood of text around it. Nothing on today's card
  contradicts either spelling, so this is a fresh choice made for this
  screen's own type-driven fallback, not a divergence from an established one.

## How this generalizes beyond the one 4-interval threshold session

- **A long run with an embedded marathon-pace segment** — its MP block and
  its steady base miles are both `type: "work"` in the phase data (the wire
  only distinguishes four families, not workout sub-kinds), so they draw as
  "Interval 1" / "Interval 2". That reads a little generic for a long run
  specifically, but it is still a real, ordered name instead of an
  uninformative one, and it is exactly the same four-way vocabulary
  `RunDetailV5`, `LiveRunOutdoorV5` and the wire itself already share — this
  fix does not introduce a new taxonomy, it forwards the one that already
  exists everywhere else in the app.
- **An easy run with no internal structure** — `routePhases` carries at most
  one usable phase (mi > 0, sec > 0), and `sectionPieces`'s existing
  `guard usable.count > 1 else { return [] }` — unchanged by this fix —
  keeps drawing nothing. The poster at the top of the post-run sheet already
  states that run's distance, time and pace; a "Piece by piece" list of one
  row was already recognized as noise before tonight (`RunDetailV5.repPieces`
  makes the identical ruling for the same reason) and stays suppressed.
- **A payload with no `type` at all** (a server response cached from before
  this fix, or any future era this build doesn't recognise) — every phase
  falls through to `default: "Section \(i + 1)"`, the old numbered behaviour,
  rather than guessing a name the data doesn't support. This is a graceful
  degradation path, not the common case going forward: real watch-completed
  runs already carry `type` today.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run app/api lib/faff lib/coach lib/runs` — 1134 passing (79
  files), no regressions.
- Xcode build, `Faff` scheme, Debug, iOS Simulator (`xcodebuild` via
  `mcp__Claude_Code_iOS_Simulator__build`) — succeeded, 7 pre-existing
  warnings unrelated to this change.
- **Rendered per Rule 13**, against the real account and the real run, not a
  fixture: committed `8646b38f`, pushed to `main`
  (`5cf9a7f2..8646b38f`). Another session's concurrent push fast-forwarded
  `main` to a merge commit, `e6f459b1`; confirmed `8646b38f` is an ancestor
  of it (`git merge-base --is-ancestor`) before treating the newer deploy as
  covering this fix. Polled `railway status --json` for the `faff` service
  until `latestDeployment.meta.commitHash` matched `e6f459b1...` and
  `status: SUCCESS` (BUILDING → DEPLOYING → SUCCESS, roughly 7 minutes) —
  required because `API.baseURL` on the phone is `https://www.faff.run`,
  so the simulator talks straight to prod and an unconfirmed deploy would
  have rendered stale code (Rule 19).

  Before the fix landed, the already-booted simulator was sitting on this
  exact screen showing the bug verbatim: "Section 1" 2.10 mi 8:36/mi,
  "Section 2" 1.01 mi 7:00/mi, "Section 3" 0.12 mi 8:28/mi, ... "Section 8"
  6:58/mi — confirming this was the live, reachable bug and not a stale
  cache.

  Force-quit that process and relaunched the freshly built `Faff.app`
  (this exact Xcode build, not a reused process) against the now-live
  backend. The Today screen came up already on `wko_eaa8cfd7cb94310b`
  (Tue Sep 1, Threshold, 8.50 mi, 1:08:23, 8:03/mi — the same run).
  Scrolled to "Piece by piece" and read, top to bottom, exactly:

  | Row | Distance | Pace | Ink |
  |---|---|---|---|
  | Warm Up | 2.10 mi | 8:36/mi | quiet |
  | Interval 1 | 1.01 mi | 7:00/mi | full |
  | Recovery | 0.12 mi | 8:28/mi | quiet |
  | Interval 2 | 1.01 mi | 7:07/mi | full |
  | Recovery | 0.08 mi | 13:20/mi | quiet |
  | Interval 3 | 1.00 mi | 7:03/mi | full |
  | Recovery | 0.06 mi | 17:47/mi | quiet |
  | Interval 4 | 1.01 mi | 6:58/mi | full |
  | Cool Down | 2.11 mi | 8:53/mi | quiet |

  Nine rows, matching the session's real shape exactly (warm-up, four reps,
  three jogs, cool-down). Every pace is identical to what `6b37e71f` already
  verified for these same rows by position, confirming this fix renamed the
  rows without touching the pace math beside them. The `isWork`-driven ink
  weight is visibly correct for the first time on this screen: the four
  "Interval N" rows render in full/bold weight, the warm-up/recovery/
  cool-down rows render in the quieter secondary weight — exactly
  `RepBreakdownV5`'s stated rule ("reps draw in full ink; warm-up, recovery
  jogs and cool-down draw quiet").

  Screenshots taken during this render (via
  `mcp__Claude_Code_iOS_Simulator__control`) show the hero card (8.50 mi
  Threshold), the route map, and the full "Piece by piece" list through
  "Send it to Strava" at the bottom of the sheet. A repo-wide grep for the
  old "Section N" wording after the fix matches only the `default:`
  fallback branch inside `sectionPieces` itself — the graceful-degradation
  path for a payload with no `type`, not a live label anywhere else.

