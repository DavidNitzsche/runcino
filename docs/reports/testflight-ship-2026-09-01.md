# TestFlight ship — 2026-09-01

## What this ships

The post-run recap fix requested tonight:

- `6b37e71f` — recap no longer shows raw phase duration formatted as pace (2.1mi warm-up was reading `18:04/mi`)
- `8646b38f` — post-run section rows now labelled from the phase's real type ("Warm Up", "Interval 1", "Recovery", "Interval 2", ...) instead of "Section 1", "Section 2", ...

Both confirmed as ancestors of `origin/main` before shipping:

```
git fetch origin main
git merge-base --is-ancestor 6b37e71f origin/main   # OK
git merge-base --is-ancestor 8646b38f origin/main   # OK
```

`origin/main` tip at ship time: `7c99b3f0` ("docs(reports): post-run section labels fix — trace and real-render verification"), which is `8646b38f`'s direct child on `main` — i.e. `main` already carries a self-verification commit for the section-label fix on top of both bug fixes.

## What I found on arrival

Before I ran anything, `git status` and the App Store Connect API already showed a **completed** ship in progress from this exact working tree:

- `legacy/native/.asc.build` was locally modified `248 → 249` (uncommitted) — the ship script's build-counter reservation.
- `native-v2/Faff.xcodeproj/project.pbxproj` had the usual `xcodegen generate` noise (a new random TEMP GUID for the untracked `Secrets.xcconfig` file reference) — this is expected per-run churn, never committed by any prior ship commit in history, and I left it alone.
- `/tmp/Faff-v2.xcarchive` and `/tmp/Faff-v2-export/Faff.ipa` existed, both timestamped **2026-09-01 11:53–11:54** (this session), archived from `CFBundleVersion 248` / `CFBundleShortVersionString 3.0.1`.
- `python3 scripts/asc.py status` reported **`build 248: VALID (uploaded 2026-09-01T11:56:12-07:00)`**.
- No shipping lock (`.asc.shipping.lock`) was held — it had been acquired and released cleanly by whatever process ran this.

This repo is a shared checkout (multiple agents/sessions can be working `main` concurrently — see CLAUDE.md's "shared root checkout" notes). Rather than blindly re-running `ship-testflight-v2.sh` and burning a second build number (249) for an upload that already succeeded, I verified the existing upload end-to-end and completed the two steps that were left undone: confirming distribution and committing the build-counter bump.

## Verification and completion steps actually run

```
python3 scripts/asc.py status    # build 248: VALID (uploaded 2026-09-01T11:56:12-07:00)
python3 scripts/asc.py comply    # ✓ build 248 already export-compliant (declared in Info.plist)
python3 scripts/asc.py autoship  # ✓ build 248 added to beta group ...b8c4-0d8b94f039bd — available to those testers
python3 scripts/asc.py status    # re-confirmed: build 248: VALID
```

```
git add legacy/native/.asc.build
git commit -m "chore(ship): bump build counter to 249 after shipping TF build 248"
git fetch origin main   # confirmed no drift — origin/main still 7c99b3f0 before push
git push origin main    # 7c99b3f0..6595bba5  main -> main
```

The pre-push hook ran `web-v2` typecheck + `next build` and both passed clean (`✓ next build green. Railway is building the same tree.`).

I did **not** stage or commit the unrelated uncommitted files sitting in this shared checkout (`docs/reports/adaptation-shadow-log/*.jsonl`, `docs/reports/pace-replay-corpus-2026-09-01.md`, `docs/reports/status-and-answers-2026-08-31.md`, the `project.pbxproj` xcodegen churn) — those belong to other in-flight work, not this ship.

## Result

| | |
|---|---|
| **Version** | 3.0.1 |
| **Build** | 248 |
| **Bundle** | `run.faff.app` |
| **Uploaded** | 2026-09-01T11:56:12-07:00 |
| **ASC processing status** | VALID (finished processing) |
| **Export compliance** | already declared compliant in Info.plist — no manual step needed |
| **Distribution** | added to Internal Testers beta group `1faa228e-0164-492c-b8c4-0d8b94f039bd` — available now |
| **Build counter** | bumped 248 → 249, committed `6595bba5`, pushed to `origin/main` |

Build 248 is live in TestFlight for Internal Testers right now, containing both recap fixes (`6b37e71f`, `8646b38f`). Nothing is pending — this did not stop mid-processing; `VALID` is App Store Connect's terminal "finished processing" state, and `autoship` already pushed it to the beta group.

## Commands run, in order

```
cd "/Volumes/WP/06 Claude Code/Runcino"
git fetch origin main
git status
git log --oneline -5 origin/main
git merge-base --is-ancestor 6b37e71f origin/main
git merge-base --is-ancestor 8646b38f origin/main
git diff -- legacy/native/.asc.build
git diff --stat -- native-v2/Faff.xcodeproj/project.pbxproj
git diff -- native-v2/Faff.xcodeproj/project.pbxproj
find scripts -iname "*testflight*"
find . -iname "*asc_review_status*" -not -path "*/node_modules/*"
python3 scripts/asc.py status
git log --oneline -5 -- legacy/native/.asc.build
ls -la .asc.shipping.lock            # confirmed: no lock held
/usr/libexec/PlistBuddy -c "Print :ApplicationProperties:CFBundleVersion" /tmp/Faff-v2.xcarchive/Info.plist
/usr/libexec/PlistBuddy -c "Print :ApplicationProperties:CFBundleShortVersionString" /tmp/Faff-v2.xcarchive/Info.plist
python3 scripts/asc.py comply
python3 scripts/asc.py autoship
python3 scripts/asc.py status
git add legacy/native/.asc.build
git commit -m "chore(ship): bump build counter to 249 after shipping TF build 248"
git fetch origin main
git push origin main
```
