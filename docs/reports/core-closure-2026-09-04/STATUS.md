# Core-product closure — STATUS

Programme lead session opened 2026-09-04. Working branch `core/closure-2026-09-04`,
based on `origin/main` @ `72f2f84c` in an isolated worktree
(`/private/tmp/core-closure-0904`). No prior agent branch used as a base.

This file records MEASURED state only. Prior completion language is not carried
forward. Every row cites how it was established.

## Stage 0 — reconciled reality (measured 2026-09-04)

### Git

| Fact | Value | How established |
|---|---|---|
| `origin/main` tip | `72f2f84c` "feat(plan-snapshot): post .faffPlanMutated on completion sync" | `git fetch --all` + `git log origin/main` |
| Root checkout `/Volumes/WP/06 Claude Code/Runcino` | `c6ac987a`, **27 commits behind** origin/main | `git rev-list --left-right --count` |
| Unmerged September branches | 3, all audit/docs: `audit/s1-5-sustained-load` (+1), `pace-canary-infrastructure-20260901` (+1), `audit/independent-coaching-system-2026-09-01` (+1) | per-branch `git rev-list --count origin/main..$b` |
| Unmerged pre-September branches | 25, all ≤ 2026-08-20, none in current scope | same |

Every feature branch from the 2026-09-01→04 programme (`feat/postrun-experience-lead`,
`feat/pre-run-experience`, `claude/today-navigation-p0`, `feat/canonical-adaptation-engine`,
`feat/adaptation-replay-harness`, `feat/race-page`, `feat/workout-rescheduling`,
`feat/s1-marathon-progression`, `fix/upward-bar-matches-contract`, …) is **already
contained in `origin/main`**. The integration debt is not un-merged branches.

### Deployment

| Fact | Value | How established |
|---|---|---|
| Railway deployment | `8ca0e995-1be0-48ef-8941-3ab13f33db64` · **SUCCESS** · 2026-09-04 10:08:10 -07:00 | `railway deployment list --json` (Rule 19: status checked, not push result) |
| Deployed commit | `72f2f84cb2f504ce214d63f45816f23d8e8dabd2` — exactly the tip of `main` | same, `meta.commitHash` |
| Production reachable | `https://www.faff.run` serves the Next.js app (200) | `curl` |
| Bare `faff.run` | still GoDaddy forwarding, `/api/*` 404s — known, deferred | `curl https://faff.run/api/health` → `Not Found` |

**Production is on the current tip of main.** No undeployed backlog.

### TestFlight

| Build | Uploaded | State | Recorded ship commit | Commit time |
|---|---|---|---|---|
| 269 | 2026-09-03 22:06:29 -07 | IN_BETA_TESTING | `cae09863` | 22:40:29 |
| 270 | 2026-09-03 22:41:45 -07 | IN_BETA_TESTING | `b5a3bc9e` | 23:29:37 |
| 271 | 2026-09-03 23:30:02 -07 | IN_BETA_TESTING | `6d0daae8` | 23:56:57 |
| 272 | 2026-09-03 23:57:40 -07 | IN_BETA_TESTING | `40975f02` | **2026-09-04 06:06:08** |

Established with `node web-v2/scripts/_asc_review_status.mjs <n>` against App Store
Connect, and `git show <c> -- legacy/native/.asc.build` for the counter transition
(the file holds the NEXT number; each ship commit consumes one).

**FINDING TFCLAIM-1 — build 272's recorded contents are not verified and are
probably wrong.** `scripts/ship-testflight-v2.sh` reserves the build number at the
start (line 105/109) and the counter commit is made *after* upload succeeds (line
286), so a ship commit always post-dates its upload — 269/270/271 by 26–48 min.
Build 272 was uploaded at 23:57:40 on 09-03; the fix its commit message credits,
HEROPANEL-1 (`57ec2840`), was authored at **05:35:29 on 09-04 — 5h38m later**.
An archive cannot contain a commit that did not exist. Either 272 was built from
uncommitted working-tree code (the failure mode
`feedback_verify_uncommitted_push_committed` records) or the message is false.
Owned by the Today agent (HEROPANEL-1 is Today-lane). Flagged, not silently fixed.
Resolution: the integrated Stage-10 build re-establishes a commit↔build mapping
that is true by construction.

### Tests and gates

| Suite | Result | How established |
|---|---|---|
| web `test-full` (whole suite, no path filter) | **RED** — 1 failed / 481 passed / 46 skipped files; 1 failed / 9967 passed / 107 skipped tests | GitHub Actions run `33898938759` on `72f2f84c`, `--log-failed` |
| web `build-check` (`next build`) | green on `72f2f84c` | run `33898938700` |
| `plan-engine-bench` | green | run `33875473730` |
| native (`native-v2`) XCTest | **not measured; NO CI workflow runs it** | `grep -l 'xcodebuild\|swift' .github/workflows/*.yml` → no matches |
| Watch gate (`check-watch.sh`) | not yet run this session | — |
| prebuild gate chain (~14 scripts) | green implicitly via Railway SUCCESS on `72f2f84c` | Railway build ran `web-v2` prebuild |

`test-full` has been red on **every** push to main today (`33898938759`,
`33876263647`'s sibling `33876263615`, `33875473690`) — three consecutive commits
shipped and deployed over a red suite.

**The single failure — FORMATLINT-1:**

```
FAIL lib/format/_format_lint.test.ts > no new file spells its own rounding rule
  + "lib/training/spec-card.ts — toFixed(1) on miles"
```

`spec-card.ts:143` (`dedupeLabelDistance`, introduced by `9cfdef7f` STEPLABEL-DUP-1)
builds its comparison prefix as `` `${distanceMi.toFixed(1)} mi ` `` → `"6.0 mi "`,
while the canonical formatter `lib/format/run.ts:miNum` renders a whole mile as
`"6"` → `"6 mi"`. **This is exactly the whole-mile label-deduplication mismatch
named in the Stage 6 brief**, and it is also the one thing keeping the repository
red. One fix closes both. In scope (shared server-side training module, not Today
rendering).

## Ownership boundary — active Today agent

Owned by the other agent, not edited here:

- `native-v2/**` Today page and week strip views, `PlanSnapshot` (local), Today
  navigation/loading/offline/shell, Today-specific cache and sync.
- Its branch: `claude/today-navigation-p0` @ `3dfc7bed` (already merged to main).
- Its worktree: `/private/tmp/faff-p0-worktree` (dirty: `project.pbxproj`) — untouched.
- Its recent main commits: `57ec2840` HEROPANEL-1, `5831a570` STALEDEBOUNCE-1,
  `9dab886c`, `72f2f84c`, `ac810978`.

Held for its handback: TFCLAIM-1, Stage 9 integration, Today-specific voice rendering.

## Classification

- **Landed, deployed, suite RED**: web engine work — main is deployed but `test-full` fails.
- **Shipped, not physically verified**: TestFlight 269–272 (treadmill, post-run, Today hero panel).
- **Contradicted**: TFCLAIM-1 (build 272 ↔ HEROPANEL-1).
- **Unmeasured**: native + Watch test state — no CI covers them at all.

---

## Scope correction, applied 2026-09-04 mid-session

David narrowed the programme: the products are the **native iPhone app**, the
**Apple Watch app**, and the shared backend / database / APIs / coaching, plan
and adaptation engines / synchronisation / deployment those two require.
Browser-facing pages are out of scope and excluded from the closure verdict.

Living under `web-v2` does **not** make code web-only. Almost all of it is the
native apps' server, and it stays in scope wherever the iPhone or Watch consumes
it, or where it determines plans, workouts, execution identity, post-run
interpretation, race information, evidence or adaptation.

### Re-audit of Stage 0 against the corrected scope

**Nothing measured in Stage 0 was web-only. Nothing is withdrawn.**

| Stage 0 finding | Surface | Still in scope |
|---|---|---|
| main RED on `test-full` (FORMATLINT-1) | shared → iPhone + Watch (`spec-card.ts` feeds the Today card and the wrist) | yes |
| Railway deployment reality | shared — the phone and watch read this server | yes |
| TestFlight 269–275, TFCLAIM-1 | iPhone (+ Watch, embedded) | yes |
| native suite unmeasured, no CI | iPhone | yes — now the highest-value CI gap |
| Watch suite unmeasured, no CI | Watch | yes |
| VACUOUS-AUDITS | shared → iPhone | yes |
| Today agent boundary | iPhone | held, unchanged |

The one item that looked web-shaped is not: `app/api/plan/undo/route.ts`
(SEALDATE-1) is called by the iPhone at
`native-v2/Faff/Faff/API+Toolkit.swift:422`.

### The Watch, corrected

Stage 0 recorded the Watch suite as "0 tests executed". **That was wrong, and
the correction matters:** the Watch tests use Swift Testing, not XCTest, so the
XCTest bundle count is legitimately zero while Swift Testing reports separately
— `Test run with 223 tests in 16 suites passed`.

Stage 0 also ran `check-watch.sh` only in its PARTIAL form (board geometry
skipped for want of a booted simulator). With Apple Watch Series 11 (46mm)
booted it now reports **OK, all guards executed**: 223 test cases, 22 boards
inside Apple's content box, run endable.

### Deployment, final

`94a207bb` → deployment `962c0258-3d3d-4510-a04d-169d30e9d4c0` → **SUCCESS**.

### The integrated build

`git diff --name-only 89f602df origin/main -- native-v2/` is **empty**: no
native file has changed since build 275 was cut. Build 275 is therefore the
integrated validation build for both iPhone and Watch, and a 276 would be
byte-identical.
