# TestFlight build 278 · the integrated iPhone + Watch validation build

The first build cut since the Today/week-strip lane was reconciled into the core
programme, and the first whose mapping is **mechanically proven** rather than
asserted.

## Mapping · source commit → archive → IPA → TestFlight → embedded Watch

| Stage | Value |
|---|---|
| source commit | `b384b8b7f08cf1d2bc7f2ca8d57c81e4a185aa7d` |
| working tree | **clean** — 0 modified files at ship time |
| archive | `/tmp/faff-ship-8067/Faff-v2.xcarchive` (per-run, pid-scoped) |
| export | `/tmp/faff-ship-8067/export/Faff.ipa` |
| **iPhone** | `CFBundleVersion` **278** · `run.faff.app` |
| **Watch** | `CFBundleVersion` **278** · `run.faff.app.watchkitapp` (embedded in the same `.ipa`) |
| upload | Delivery UUID `0070a544-8783-49f5-bb9b-7f344cb578e8` |
| App Store Connect | build **278** · VALID · uploaded `2026-09-04T15:42:28-07:00` · distributed to Internal Testers |

The two `CFBundleVersion` values were read **out of the built artifact** with
`PlistBuddy`, not off this document. There is no separate Watch build number:
`project.yml` embeds `FaffWatch Watch App` in the `Faff` target
(`embed: true, codeSign: true`), so one `.ipa` carries both and Xcode stamps
them from the same `CURRENT_PROJECT_VERSION`.

## Why build 277 is NOT claimed by this session

The first ship attempt printed `✓ Uploaded build 276` and
`✓ Build 276 distributed to Internal Testers`. **Both lines were false**, and
finding out why produced SHIPRACE-1:

```
15:32:17  this agent archives (CURRENT_PROJECT_VERSION=276) -> /tmp/Faff-v2.xcarchive
15:32:29  ANOTHER agent exports its own build 277           -> /tmp/Faff-v2-export/Faff.ipa
15:33:27  this agent uploads /tmp/Faff-v2-export/Faff.ipa   -> the OTHER agent's binary
15:34:40  App Store Connect records build 277
```

The archive and export paths were fixed strings under `/tmp`, shared by every
worktree on the machine, and `LOCK_DIR` was `$ROOT/.asc.shipping.lock` where
`$ROOT` is the *worktree* — so the "cross-agent mutex" only ever excluded a
shipper from itself. The confirmation loop then greps App Store Connect for
`276: VALID`, and a build 276 genuinely existed, uploaded by a different agent
at 11:58.

Build 277 was uploaded by this agent's `altool` invocation **from a file this
agent did not produce**. It may well contain the same tree. "Probably the same
tree" is not proof, so it is not claimed.

**This is very likely the mechanism behind TFCLAIM-1** — build 272's commit
message crediting HEROPANEL-1, a fix authored 5h38m *after* 272 was uploaded. A
build number from one tree and a binary from another is exactly what produces
that.

Fixed in `b7a002fb` + `b384b8b7`: the lock is machine-wide, and the archive,
export and export-options paths are per-run (`/tmp/faff-ship-$$`) with a trap
that also stops a *failed* ship leaving a stale `.ipa` for the next run.

## Contents, by ancestry

Every line below is `git merge-base --is-ancestor <commit> b384b8b7` returning
true. Never commit prose, never timestamps.

| Area | Commits |
|---|---|
| Today / week strip | `39d69b71` REDUNDANT-PACE-1 · ACTIVITY-PLACEMENT-1 · OVERRUN-MATCH-1 · PASSIVE-SYNC-TYPE-CONFIRM-1 |
| | `3dfc7bed` TODAYSHELL-1 · `57ec2840` HEROPANEL-1 · `5831a570` STALEDEBOUNCE-1 · `a7a6562e` PANELMOTION-2 |
| Treadmill / post-run | `cd754fd3` TREADMILL-SKIP-1 · `645d540e` + `ea901bea` WORKOUTPHASES-1/2 · `0e80296d` HRPHASE-1 + HRGRADE-1 |
| Engine | `5104342f` · `28c882ec` · `94a207bb` · `d115d857` HRCEILING-1 + HRCHANNEL-1 · `58c9dcc3` HRFLATLINE-1 · `b7a002fb` SHIPRACE-1 |

**REDUNDANT-PACE-1 and ACTIVITY-PLACEMENT-1 were merged and deployed but sat in
no TestFlight build until now.** Build 275's ship commit `89f602df` predates
them — `merge-base` says so, and the Today handback could not have known.

## Automated results on this tree

| Suite | Result |
|---|---|
| iPhone (ad-hoc signed) | **346 tests, 0 failures** |
| Watch (Swift Testing) | **223 cases / 16 suites, 0 failures** |
| `check-watch.sh` | **OK — all guards executed** (223 cases, 22 boards inside Apple's content box, run endable) |
| web/server, production credentials | **514 files / 10,117 tests, 0 failures** |
| prebuild | **22/22 gates** |
| adaptation replay | 30 tests, 0 failures · **PROGRESS 14** |

## Physically verified

**Nothing. On either product.** `PHYSICAL-TESTS.md`'s SMOKE section is 14 steps
and about six minutes, and is the next thing that needs a human.
