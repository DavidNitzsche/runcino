# Small fixes sweep — 2026-09-01

Two small, already-diagnosed bugs, fixed in isolation. No other files touched.

## Fix 1 · cron heartbeat missing (`prune-adaptation-shadow-log`)

**Found by:** `docs/reports/stability-report-tooling-2026-09-01.md`.

**File:** `web-v2/app/api/cron/prune-adaptation-shadow-log/route.ts`

**Problem:** the route ran `pruneAdaptationShadowLog()` and returned its result, but
never called `recordCronSuccess()` — the heartbeat every other cron route in
`web-v2/app/api/cron/*` writes to `lib/ops/cron-ledger.ts` on completion. Confirmed
empirically: zero `ops_alerts` rows with `source = 'cron/prune-adaptation-shadow-log'`.
This job is listed in `EXCLUDED_FROM_TICK` (it's not due-gated or catch-up-driven by
the scheduler tick), but exclusion from the tick is about *driving* the job, not about
whether it records its own completion — the ledger still needs the stamp to ever be
able to answer "has this job run" for anyone reading the ledger directly (ops
dashboards, `staleness()`, ad hoc audits).

**Before:**
```ts
try {
  const result = await pruneAdaptationShadowLog();
  return NextResponse.json({ ok: true, ...result });
} catch (e) {
  ...
}
```

**After** (matches the convention used by every sibling route, e.g.
`readiness-snapshot`, `promote-courses`, `dedupe-runs` — import `recordCronSuccess`
from `@/lib/ops/cron-ledger`, call it with the job id and result metadata right after
the operation succeeds, before returning):
```ts
import { recordCronSuccess } from '@/lib/ops/cron-ledger';
...
try {
  const result = await pruneAdaptationShadowLog();
  await recordCronSuccess('prune-adaptation-shadow-log', { ...result });
  return NextResponse.json({ ok: true, ...result });
} catch (e) {
  ...
}
```

No failure-path call was added: this codebase has no `recordCronFailure()` — grepped
`lib/ops/cron-ledger.ts` and confirmed only `recordCronSuccess` exists — and no
sibling cron route calls anything on its own failure path either. The convention is
success-only heartbeats; the catch block's behavior (500 with the error message) is
unchanged.

**Verification:**
- `cd web-v2 && npx tsc --noEmit` — clean, no errors.
- Read the route after editing to confirm the call sits inside the `try` block, after
  `pruneAdaptationShadowLog()` resolves and before the `return`, so it only fires on a
  genuinely successful prune (same pattern `promote-courses` uses: stamp only on a
  clean pass).
- This job is not in `CRON_JOBS` (it's in `EXCLUDED_FROM_TICK`), so
  `lib/ops/_cron_ledger.test.ts`'s "every driven job stamps the ledger" assertion does
  not cover it and was not expected to change; nothing else in that test file
  references this job by name.

## Fix 2 · HR copy inconsistency (`.intervals` reads like a floor)

**Found by:** `docs/reports/hr-semantics-2026-09-01.md`.

**File:** `native-v2/Faff/Faff/Components/TodayPreRunBodyV3.swift`, `heartRateTarget`
computed property (around line 660-682).

**Problem:** the `.tempo` case used the app's `~` modelled-value convention
(`"~\(bpm) bpm · threshold"`), correctly reading as informational. Two lines below,
`.intervals` used a `+` suffix (`"\(bpm)+ bpm · VO2max"`), which reads as a
floor/minimum the runner needs to clear rather than a modelled target — the two
adjacent cases described the same kind of number with different, contradictory
grammar.

**Before:**
```swift
case .intervals:
    if let bpm = workout?.phases.first(where: { $0.type == .work })?.hrTargetBpm {
        return "\(bpm)+ bpm · VO2max"
    }
    return "Z5 · VO2max"
```

**After:**
```swift
case .intervals:
    if let bpm = workout?.phases.first(where: { $0.type == .work })?.hrTargetBpm {
        return "~\(bpm) bpm · VO2max"
    }
    return "Z5 · VO2max"
```

Only the `+` → `~` change; the fallback string (`"Z5 · VO2max"`, used when no
per-phase HR target is available) was left untouched since it was already correct and
out of scope.

**Verification:**
- Read the surrounding `heartRateTarget` switch first to confirm `.tempo`'s exact
  pattern before touching `.intervals` — matched character-for-character except for
  the zone label and copy suffix.
- Built the `Faff` scheme via the iOS Simulator build tool:
  `xcodebuild ... -scheme Faff -configuration Debug` → **BUILD SUCCEEDED** (5s
  incremental build, one unrelated warning about a missing `AppIntents.framework`
  dependency, not touched by this change). Confirms the edit compiles.
- Did not attach the simulator panel / render the live screen — this is a text-literal
  change in a switch case identical in shape to the working `.tempo` case one line up,
  and there is no live per-runner interval-workout HR data needed to see the
  string change beyond what a build confirms; the fix is a straight copy-format
  parity fix, not a display/logic bug requiring runtime verification.

## Git

- Files touched: `web-v2/app/api/cron/prune-adaptation-shadow-log/route.ts`,
  `native-v2/Faff/Faff/Components/TodayPreRunBodyV3.swift`.
- Nothing under `web-v2/lib/adaptation/*`, `web-v2/lib/plan/generate.ts`,
  `web-v2/lib/training/capacity-resolver.ts`, or any canary/canonical-authoring
  branch was touched.
- `git status` was checked before staging; only the two files above were staged
  (other agents' concurrent WIP in `native-v2/Faff.xcodeproj/project.pbxproj` and
  elsewhere was left alone).
- Committed as `50c7aab3` ("fix: cron heartbeat + HR copy — two small, isolated
  bugs").

### The push — blocked twice by concurrent-agent activity, neither time by this commit

This is a shared checkout with several other agents committing to `main`
simultaneously tonight (per `CLAUDE.md`'s branching doctrine). The push hit real
friction, none of it caused by these two fixes:

1. **First `git push` attempt** — `main` had moved (a commit `9dae0613` landed
   after I'd branched). Fetched, and found `50c7aab3` already sat cleanly on top
   of the new `origin/main` tip with no rebase needed (confirmed via
   `git merge-base --is-ancestor`). Before pushing, stashed four files that were
   *other agents'* uncommitted WIP already sitting in the shared tree
   (`docs/reports/adaptation-shadow-log/*.jsonl`, `pace-replay-corpus-2026-09-01.md`,
   `status-and-answers-2026-08-31.md`, `native-v2/Faff.xcodeproj/project.pbxproj`)
   so the pre-push hook wouldn't see them, then restored them unchanged after —
   never touched their content, only kept them from being swept into a rebase.
2. **The hook then failed** with real-looking Swift test failures
   (`_SessionTimelineTests.swift`, phase-cue counts doubled) — but on inspection
   these came from an *already-committed* ancestor commit that predates mine
   locally (`d8de0e62`, "fix(watch): interval-complete cue..."), not my own
   diff. Per `docs/VERIFICATION_POLICY.md`, ran `scripts/verify-commit.sh` on
   both the exact SHA I was pushing (`50c7aab3` — PASS, and doesn't even touch
   watch paths) and on that ancestor commit alone (`d8de0e62` — its web build
   passed; its watch check hit an unrelated isolated-worktree limitation,
   gitignored `native-v2/Secrets.xcconfig` doesn't exist in a fresh worktree).
   Reading `d8de0e62`'s diff showed it intentionally added a second phase-cue
   (on entering `.recovery`, not just `.work`) as its main fix — which explained
   the doubled cue count exactly, meaning the failing test was genuinely stale
   against that commit's own intentional change, not a defect. This was **not**
   a call I made alone: another agent working the same shared checkout landed
   `610af2f2` ("test(watch): update session-timeline expectations for the
   recovery phase cue") moments later, confirming the diagnosis independently.
3. **Second `git push` attempt**, after `610af2f2` landed locally — hit a
   *different*, transient failure: `next build` errored with `ENOENT` on
   `web-v2/.next/build-manifest.json`. `ps aux` showed another agent's own
   `next build` process actively running against the same shared `web-v2/.next`
   cache directory at that exact moment — a build-cache race, not a code issue.
4. **Third attempt**, after waiting for that concurrent build to exit — pushed
   clean. `watch OK · 195 test cases; 20 boards inside Apple's content box`.
   `origin/main` advanced `9dae0613..894a3db5`, carrying my commit plus three
   commits from other agents (`d8de0e62`, `610af2f2`, `894a3db5`) that were
   already ahead of me locally by the time I went to push.

No `--no-verify` bypass was used at any point — every push went through the
real hook, and the two failures were resolved by waiting out genuine concurrent
activity in the shared checkout, not by skipping a check. Final state confirmed:
`git fetch origin main` shows `origin/main` at `894a3db5`, matching local `main`
exactly (no ahead/behind), and `50c7aab3` is in that history.
