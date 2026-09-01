# Post-run section labels still "Section N" on TestFlight build 248 — 2026-09-01

Subject: the account owner installed TF build 248 (shipped tonight, claimed to
carry both `6b37e71f` and `8646b38f`) and re-opened `wko_eaa8cfd7cb94310b`'s
post-run recap. The pace fix (`6b37e71f`) rendered correctly — 8:36/mi,
7:00/mi, 8:28/mi, 7:07/mi, 13:20/mi, 7:03/mi, 17:47/mi, 6:58/mi, 8:53/mi across
9 rows. The label fix (`8646b38f`) did not — every row still read "Section 1"
through "Section 9", despite `8646b38f`'s own report claiming it had been
rendered and verified against this exact run before shipping.

## The real root cause: build 248 was archived and uploaded BEFORE `8646b38f` existed

Not a cache problem. Not a wrong-endpoint problem. **The binary Apple has been
distributing as build 248 was compiled from a git tree that predates the
label-fix commit by several minutes.** The commit landed after the archive
was already sealed and on its way to App Store Connect.

Timeline, all times 2026-09-01, from `git log` and the two same-night reports:

| Time (PT) | Event |
|---|---|
| 11:13:33 | `17b73fe2` committed — backend field-name fix |
| 11:23:18 | `6b37e71f` committed — client pace-math fix |
| **11:53:49** | `/tmp/Faff-v2.xcarchive/Info.plist` written — archive built, `CFBundleVersion 248` |
| **11:54:03** | `/tmp/Faff-v2-export/Faff.ipa` written — IPA exported for upload |
| **11:56:12** | `python3 scripts/asc.py status` — build 248 uploaded and `VALID` on App Store Connect |
| **11:57:08** | `8646b38f` committed — client label-fix, **56 seconds after the upload the ship report already had in hand** |
| 12:07:52 | `7c99b3f0` committed — `8646b38f`'s own verification report, describing a render against a **fresh Debug build in the Simulator**, not the archived Release IPA |
| 12:11:17 | `6595bba5` committed — build-counter bump, ship report written |

`8646b38f`'s own commit message says it built and rendered in the simulator
and calls that "Verified by rendering the real post-run sheet ... after
deploy." That render was real and accurate for what it tested — but what it
tested was a **fresh `xcodebuild` Debug run against the live backend**, a
different artifact from the archived Release build already sitting in App
Store Connect eleven minutes earlier. Nobody rebuilt or re-archived after
`8646b38f` landed.

The subsequent ship session (`docs/reports/testflight-ship-2026-09-01.md`)
found ASC already held a `VALID` upload for build 248 and, rather than
starting a fresh archive, verified the upload by checking
`git merge-base --is-ancestor 8646b38f origin/main` — which only proves the
commit is an ancestor of `main`, not that the **archive already sitting in ASC
was compiled from a tree that contained it**. The archive predates the commit.
That check cannot see the gap it needed to catch, which is exactly Rule 18's
shape: a check that answers a nearby question instead of the one that matters.

### Confirmed with the actual shipped binary, not inference

The archive is still on disk (`/tmp/Faff-v2.xcarchive`, `/tmp/Faff-v2-export`
— untouched since the ship). Rather than trust timestamps alone, grepped the
compiled, code-signed executable Apple is currently serving as build 248:

```
grep -a -c "Warm Up"  /tmp/Faff-v2.xcarchive/Products/Applications/Faff.app/Faff   # 0
grep -a -c "Cool Down" /tmp/Faff-v2.xcarchive/Products/Applications/Faff.app/Faff  # 0
```

Zero occurrences of either string. `8646b38f`'s `sectionPieces` switch is the
**only** place in the entire app that emits the title-case spellings "Warm
Up" / "Cool Down" (the report's own word-choice section notes this explicitly
— every other call site spells them "Warm-up"/"Cool-down" or lowercase). Their
total absence from the shipped binary is direct proof the label-fix code was
never compiled into it, independent of the timestamp argument above.

## Why the pace fix worked and the label fix didn't, in the same build

`6b37e71f` (11:23:18) landed a full 30 minutes before the archive was built
(11:53:49) — it's in build 248. `8646b38f` (11:57:08) landed after the
archive was already built and uploaded — it isn't. Same build, same screen,
two fixes from the same night, opposite sides of one archive boundary. This
also explains why the account owner's report reads as internally
contradictory ("paces are right, labels are wrong") rather than as "nothing
changed" — it genuinely is a half-shipped build.

## What this is not

Ruled out explicitly, per the task's own hypotheses, before landing on the
above:

- **Not a local AppCache staleness bug.** `SurfaceStoreV5`/`AppCache`
  (`native-v2/Faff/Faff/ViewsV5/SurfaceStoreV5.swift`,
  `native-v2/Faff/Faff/AppCache.swift`) seed `model` synchronously from the
  last raw JSON on disk at init, then `.task { await surface.load() }` fires a
  live `GET /api/v5/today` and overwrites it. `API.fetchV5Today(date: nil)`
  (`native-v2/Faff/Faff/DesignV5/APIV5.swift:1255`) explicitly keys its cache
  write on `date == nil`, so a same-day "today" read is exactly the live,
  refreshed, cache-overwriting path — not the `cache: nil` historical-date
  path. Verified directly (see below): a build that actually contains
  `8646b38f`, given a cache primed with the exact pre-fix payload shape (mi/sec
  present, `type` stripped — what a device would hold from before the backend
  started forwarding `type`), self-heals to the correct labels the instant its
  live fetch lands. The caching layer is not what's blocking this.
- **Not a wrong endpoint.** `wko_eaa8cfd7cb94310b`'s post-run recap is served
  by the same `/api/v5/today` route `8646b38f` patched — confirmed by
  `V5Today.state == "after_run"` in the actual live payload fetched during
  verification below, carrying this exact run's `routePhases` with `type`
  already present. The backend side of the fix is live and correct; only the
  client binary is stale.

## The fix

No code change. `8646b38f` and `17b73fe2` are both correct, both on `main`
(current tip `43e15e88`), and the backend halves are already deployed and
live (confirmed serving `type` on `routePhases` for this exact run — see
verification). **The only thing missing is a new TestFlight build compiled
from a tree that actually contains `8646b38f`.** `main` has had it for over
two hours; nothing since has touched `TodayAfterV5.swift`, `APIV5.swift`, or
the `routePhases` code in `v5-today.ts`/`route.ts`.

**This needs a new TestFlight build to reach the account owner's phone. I am
not shipping it** — per standing instruction, a TestFlight ship needs his
explicit go each time, same as every prior ship. The build counter is already
at 249 (bumped in `6595bba5` under the mistaken belief build 248 covered both
fixes); the next `ship-testflight-v2.sh` run will correctly produce 249 from
current `main`, which does contain both fixes.

## Verification — rendered for real, against a cache primed to the exact stale shape a synced device would hold

Per Rule 13: rendered, not inferred, and specifically targeting the scenario
the task worried about (a previously-cached run) even though the actual root
cause turned out to be the artifact, not the cache.

1. Built `Faff` (Debug, iOS Simulator, `iPhone 17` — `8829D8FB-278F-458A-B895-C7E799F07E78`)
   from current `main` (`43e15e88`, which contains `8646b38f`) via
   `mcp__Claude_Code_iOS_Simulator__build` — succeeded, 0 warnings.
2. Captured the simulator's existing `v5.today` AppCache entry (`UserDefaults`
   key `faff.cache.v5.today`, `run.faff.app.plist`) — a real, live payload for
   `wko_eaa8cfd7cb94310b`, `state: "after_run"`, 9 `routePhases` rows each
   already carrying `type` ("warmup"/"work"/"recovery"/"cooldown").
3. Built a stale variant of that exact payload by stripping the `type` key
   from every phase — reproducing precisely the payload shape a device would
   hold from before the backend started forwarding `type` (mi/sec present —
   `17b73fe2` already fixed those field names — but no classification), and
   wrote it back into the app's `UserDefaults` plist so the next cold launch
   seeds `model` synchronously from this stale, type-less cache exactly the
   way `V5Surface.init` is documented to.
4. Terminated the app, launched the freshly built binary
   (`mcp__Claude_Code_iOS_Simulator__control`, action `launch`), screenshotted
   through the launch-gate splash, then screenshotted the landed Today screen
   and scrolled to "Piece by piece" (`swipe`, `(200,700)` → `(200,150)`,
   device points).
5. Read, top to bottom, on the real device screen:

   | Row | Distance | Pace |
   |---|---|---|
   | Warm Up | 2.10 mi | 8:36/mi |
   | Interval 1 | 1.01 mi | 7:00/mi |
   | Recovery | 0.12 mi | 8:28/mi |
   | Interval 2 | 1.01 mi | 7:07/mi |
   | Recovery | 0.08 mi | 13:20/mi |
   | Interval 3 | 1.00 mi | 7:03/mi |
   | Recovery | 0.06 mi | 17:47/mi |
   | Interval 4 | 1.01 mi | 6:58/mi |
   | Cool Down | 2.11 mi | 8:53/mi |

   Nine rows, correct names, correct paces, matching the hero card (8.50 mi
   Threshold, 1:08:23, 8:03/mi) and every value the earlier two reports
   already verified. This is the same run, started from a cache deliberately
   primed to the exact "paces right, no type, would fall back to Section N"
   shape — and it did not fall back, because `.task`'s live fetch landed
   before the runner could act on the stale first frame, and the fetch itself
   carries `type` because the backend half of `8646b38f` is genuinely live.

6. This confirms both halves independently: the client code, when it is
   actually the code running, works correctly against a real previously-synced
   run's data; and there is no separate caching defect standing between a
   correctly-built app and the correct label. The only variable that explains
   the account owner's screenshot is which binary is on his phone.

Did not restore the simulator's `run.faff.app.plist` afterward — a debug
reinstall during this test replaced the app's data container (a new
`DataContainer` GUID), which is normal simulator behavior on a fresh install
and not something that needs undoing; nothing here touched the account
owner's real device or any production data.

## Process note for whoever ships next

`docs/reports/testflight-ship-2026-09-01.md`'s ancestor check
(`git merge-base --is-ancestor <sha> origin/main`) is necessary but not
sufficient when reusing an ALREADY-BUILT archive instead of building fresh —
it proves the commit is on the branch, not that the specific archive already
sitting in ASC was compiled after that commit existed. The archive's own
`Info.plist` mtime (or, more robustly, a git SHA stamped into the app at
build time — Rule 19's "cover the last step" already asks for exactly this
kind of self-check elsewhere) compared against the fix commit's timestamp
would have caught this before the ship report was written. Flagging as a
follow-up, not fixing here — out of scope for this task, and changing the
ship script is its own reviewable change.
