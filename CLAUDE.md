# faff.run — Project Memory

This project is a multi-surface running app for a competitive marathoner. Three surfaces share one source of truth: **web** (command center), **iPhone** (daily companion), **Apple Watch** (execution layer).

---

## Required reading at session start

Read these in order before doing any design or implementation work in this project. Do not skim. Load them into context fully.

### 1. Design source of truth

`Design/running-app-design-brief-v2.md`

The complete design language, locked 2026-06-09 and enforced from build 200: the ten-color palette (byte-for-byte identical on web / iPhone / watch, CI-enforced by `scripts/check-palette-sync.sh`), typography (Oswald ≥16pt display · Inter below · Inter body), mesh doctrine, glass retirement, label grammar, banner caps, and the David-ruled addendum (TweakAccent exemption, phase-identity categorical group). Supersedes v1, which is archived at `Design/running-app-design-brief.md.archived` for reference only.

### 2. Knowledge base research

Two directories holding training methodology, data model, and domain context. Read everything in them:

- `BuildResearch/`
- `Research/`

The coach runtime pulls from these. Decisions about what each beat of a page should hold should be informed by what's in here, not assumptions.

### 3. Product surface specs

- `APP_FEATURE_SPEC.md` — whole-app surface map. What each surface (web, iPhone, watch) is for and what pages exist.
- `C1-overview-and-today.md` — element inventory for Web Overview and iOS Today, including the conditional layouts that promote, demote, add, and remove elements based on training state.

---

## Operating posture

- **The design brief is authoritative.** If existing components, tokens, or layouts conflict with it, replace them. Do not harmonize. Do not split the difference.
- **Light-theme work in the codebase is abandoned.** The app is dark. The palette in the brief is locked.
- **Composition is state-driven, not template-driven.** Pick what each beat of a page holds based on the C1 inventory and the user's current training state (off-season, base, build, peak, taper, race week, race day, post-race, injury). A page rendered race week and a page rendered four months out should look meaningfully different, not the same page with new numbers.
- **Coach voice, not app voice.** Short, direct, no hype, no exclamation marks, no emoji, no em dashes. See the brief's tone section for canonical examples.
- **Audit before changing.** When starting work on a new surface or component, audit what's already there against the brief and surface every conflict before acting. Don't silently rewrite.

---

## Conventions

- New design files under `docs/design/`.
- Research outputs under `docs/research/`.
- Product decisions documented in `docs/PRODUCT_DECISIONS.md`.
- The brief itself is editable. If you find a real reason to change a token, a rule, or a principle, propose the change explicitly rather than working around it.

---

## Race-data source-of-truth (locked 2026-05-19)

**Before merging ANY component that displays race-related data, answer these four questions:**

1. **Does this display a race result?** (finish time, finish pace, PR, race comparison, aggregate VDOT, race-anchored prediction)
2. **If yes, does it read from `races.actual_result` first?** Curated chip times beat raw Strava elapsed.
3. **If it falls back to `strava_activities`, is that fallback labeled as provisional?** (e.g., "Training effort · race to lock in", "Strava elapsed", not "Personal Record"). Strava-source data must never display as authoritative race performance.
4. **Does it skip auto-detected Strava best-effort segments?** A 5K split inside a long run is not a 5K race; pulling `canonicalLabel` directly from `strava_activities` is how the phantom-5K bug landed in compute-vdot. If a race-result consumer reads `canonicalLabel`, it's likely wrong.

**The historical bugs that motivate this checklist** (all fixed by 2026-05-19):

| Bug | Component | Root cause |
|---|---|---|
| Phantom 5K · VDOT 33.6 in aggregate | `compute-vdot.ts` | LEFT JOIN to `strava_activities` allowed auto-detected splits to leak |
| Missing Sombrero Half | `compute-vdot.ts` | Dedup-by-canonical-distance dropped the slower of two HMs |
| Empty Personal Records card | `/races/page.tsx` | Read ONLY from `strava_activities.canonicalLabel`, never from `races.actual_result` |

**Reference docs:**
- `docs/simulations/race-data-source-audit-L6.md` — the 11-component audit confirming current clean state
- `web/app/api/admin/audit-races/route.ts` — diagnostic admin endpoint for ongoing data drift detection

**Non-race-result consumers** (these correctly use `strava_activities`):

- HR readings (`validate-max-hr.ts` reads `maxHr` and `avgHr` from training runs)
- Activity caching (`lib/strava-activities.ts`)
- The sync layer itself (`/api/strava/sync`)

The distinction is *what you're surfacing*: race performance → races table; training data → strava_activities. Use the right source for the right job, not "races good, Strava bad."

---

## Operational vs decision vs external (locked 2026-05-19)

The boundary that decides whether the agent acts, asks, or confirms before touching something. Three distinct buckets:

### 1. Operational tasks · self-execute

Run as part of the work. Surface results, not requests to trigger.

- Backfills, internal data populations (e.g., `/api/admin/backfill-splits`)
- Running diagnostics endpoints the agent built (`l7-signal-view`, `audit-races`, `race-hr-diagnostic`)
- Invoking endpoints the agent built itself, including read-only admin routes
- Test runs, typecheck, lint
- Sync checks, status probes
- Reading data that exists in the system to verify its own work

The pattern is: agent built it → agent knows it's safe → agent has rate-limited it → agent runs it. The result goes in the status surface, not a "go run this" instruction. Buttons buried in status docs get missed when shipping fast.

### 2. Decisions · explicitly flag as blockers

Pause. Ask. Resume after answer.

- Combined-rule shapes when multiple valid options exist (e.g., "either signal fires alone vs. softer combined threshold")
- Threshold values where the right answer isn't physiologically obvious
- Architectural splits where the trade-off is real (DI vs. direct DB, lazy vs. eager fetch)
- Scope expansions beyond the explicit queue
- Anything where two defensible answers exist and the wrong one creates structural debt

The pattern is: state the decision, state the options, state the default if no answer, pause. Resume the moment an answer lands.

### 3. Externally-consequential actions · require confirmation

These touch the outside world or cost real money/trust. Confirm before each one.

- Sending email
- Deleting files, rows, or external resources
- Spending money (API costs are usually fine; service-tier upgrades aren't)
- Touching public-facing surfaces (production deploys, public posts, live data the user-facing app reads in a way the user can't undo)
- Anything destructive that can't be reversed by running the inverse command

The pattern is: name the action, name what it touches, name what reverses it, confirm.

**Why this matters:** the bug class is "agent buries an action in a status doc → user misses it → expected outcome never happens → agent's report drifts from reality." Operating boundaries fix the bug class. Buttons in status docs get missed; decisions correctly flagged get answered; external actions correctly gated stay safe.

---

## Per-finding context filters (locked 2026-05-19 round 4)

**When a surface aggregates multiple downstream findings, each finding applies its own context filters concretely. A surface-level guard doesn't protect sub-findings.**

The bug pattern this fixes: V5 Z2 stimulus check has a race-week suppression at the surface level (whole banner suppresses within 7 days of a race). But the *threshold under-reach* sub-finding inside the surface walked workouts independently and picked up a taper workout from 3 days pre-Big Sur — pace in T-band, HR sub-Z4, looked exactly like the "easy days too hard → can't reach Z4" symptom we surface. Was actually intentional taper conservation. The surface's race-week guard would have correctly suppressed the whole banner *if today were 3 days from a race*. But today is 23 days post-Big Sur — the surface fires correctly, and the sub-finding has to apply its OWN race-recency filter to skip the historical taper workout.

**The rule, concretely:**

- A surface that aggregates N findings runs N filter applications, one per finding.
- Inheritance is semantic, not automatic. The parent surface's filters describe *what context distorts this whole story*; each child finding asks *what context distorts THIS specific observation*.
- Same architecture as L7 Signal 1's per-observation filtering: signals walk activities, and each activity gets its own context resolution (heat, race-recency, hr-missing) before contributing to the rollup.

**Where this applies going forward:**

- Readiness scores aggregating sleep + RHR + training load — each input filtered separately
- Weekly summaries pulling daily executions — each day filtered for race-week, illness, weather
- Plan adherence reports — each missed/modified session filtered for context (rain day, sick day, deliberate cutback)
- Season retrospectives — each phase's findings filtered for the conditions specific to that phase
- Any future "explain this trend" surface — each datum filtered, not just the trend window

If you're building a surface that combines multiple observations into a unified story, list out every observation the surface depends on and apply the same context-filter taxonomy to each. The parent's filters don't propagate automatically; you propagate them explicitly.

This rule was caught on first prod run of the V5 Z2 stimulus check. The cost of inheritance-by-assumption: a coaching observation that would have blamed easy-day load for what was actually planned taper conservation. The cost of doing this right: a few extra lines that ask the same race-calendar question for each finding instead of trusting the parent guard.

---

## Rule 6 · Multi-writer jsonb columns require field-level updates, not full-replace upserts (locked 2026-05-19 round 5)

**Promoted from candidate after second instance found in `lib/race-store.ts:saveRaceDB` during the queued pre-emptive audit. Same shape, different column. The candidate-stage discipline worked: the second instance was recognized at first sight instead of looking novel.**

When two or more code paths write to the same jsonb column with different field coverage, naive full-replace upserts silently erase fields the active writer doesn't know about. The active writer overwrites the inactive writer's contributions because `SET column = EXCLUDED.column` can't distinguish "writer didn't include this field" from "writer intentionally cleared this field."

### The failure pattern

Three known instances at the time of locking:

| Column | Multi-writer | Detail-only field | Status |
|---|---|---|---|
| `strava_activities.data` (multi-tenant) | `syncSingleActivity`, `syncStravaForUser`, backfill | `splits` | Fixed `d114c35` |
| `strava_activities.data` (legacy single-tenant) | `strava-cache.ts:refreshActivities` | `splits` | Fixed this round |
| `races` (jsonb-shape body) | `saveRaceDB` (editor POST + rebuild) | `actual_result` | Fixed this round |

### The fix pattern

`jsonb_set` (for jsonb columns) or `CASE WHEN ... ELSE` (for whole-jsonb columns) with a guard that preserves the existing field when the new payload doesn't carry it. Always symmetric across all writers.

```sql
-- pattern A · field inside a jsonb column
SET data = CASE
  WHEN strava_activities.data ? 'splits' AND NOT (EXCLUDED.data ? 'splits')
  THEN jsonb_set(EXCLUDED.data, '{splits}', strava_activities.data->'splits')
  ELSE EXCLUDED.data
END

-- pattern B · whole-column jsonb that's detail-only
SET actual_result = CASE
  WHEN EXCLUDED.actual_result IS NOT NULL
  THEN EXCLUDED.actual_result
  ELSE races.actual_result
END
```

To explicitly clear a preserved field, callers must use a purpose-built setter (e.g., `setActualResultDB(slug, null)`). The default save path always preserves — explicit destruction beats silent destruction.

### How to detect this pattern in your code

Grep for `SET <column> = EXCLUDED.<column>` patterns. For each match, ask:

1. **Is the column jsonb (or jsonb-typed)?** If no, skip — non-jsonb upserts have schema-enforced shape.
2. **Are there multiple writers to this column?** If only one writer, the bug can't fire; still consider whether future code might add a second.
3. **Do the writers have different field coverage?** Most importantly: does any writer NOT populate every field that some OTHER writer populates? If yes, the gap is the bug surface.

If 1+2+3 all yes → apply the guard. If 1+2 yes but 3 unclear → audit the field coverage explicitly before deciding.

### How to test

Simulate writer-A-then-writer-B sequences:

1. Writer A inserts row with field F populated.
2. Writer B updates same row, payload lacks field F.
3. Assert field F is still present after writer B's update.

If you can't write this test cheaply, the write path probably has the bug.

### Lesson worth holding

The candidate-stage naming worked. The splits-preservation bug fix in `d114c35` had a one-time feel — "we fixed it, move on." Pre-naming the candidate rule turned the second instance from "huh, weird, another bug" into "oh, that's the same shape as splits, apply the same guard." Time-to-recognize dropped from 45+ minutes (splits) to under 5 minutes (race actual_result). Pattern recognition compounds when patterns are named.

---

## What to do if a doc referenced above is missing

If any of the required-reading documents is missing or empty when you go to read it, stop and tell me which one is missing. Don't proceed by inference.

---

## Branching & integration — `main` is the working line (locked 2026-05-20)

`main` is the active working line. Build here. **Before writing any code, confirm your base is current:** `git fetch`, then check whether `main` is ahead of whatever branch your worktree started on. A worktree's starting branch is often NOT current.

- The `claude/build-runcino-app-OIRJr` branch and the adjective-noun-hex worktree branches (`funny-chandrasekhar-…`, `objective-black-…`, etc.) are parallel-session branches and may be **behind** `main`. Never assume your worktree's base branch is the source of truth.
- Integrate to `main`. When moving a commit from another branch onto `main`, dry-run the cherry-pick/merge in an **isolated detached worktree** (never the parent checkout another agent may be using), inspect the conflicts, and abort if it would regress. Diverged branches can carry deprecated logic.
- A second agent is frequently committing to `main` at the same time. Fetch immediately before any push, **fast-forward only, never force**. Expect overlap in coach-core files.

### Cautionary example (2026-05-20) — what we almost did

An agent ran a full HR/VDOT/pace audit and fix, built and verified it green on the stale `claude/build-runcino-app-OIRJr` branch, then went to cherry-pick it onto `main`. The cherry-pick conflicted in `web/lib/coach-state.ts` and `web/lib/vdot.ts` because `main` had already moved further in those exact areas:

- `gatherCoachState` on `main` is multi-tenant (`opts.userId`) and already populates `recovery.rhrBpm` (plus HRV/sleep) from HealthKit biometrics. The stale-branch commit would have replaced that with manual-profile RHR and nulled HRV/sleep — a regression.
- `pacesFromVdot` on `main` was re-architected to delegate to `resolveTrainingPaces` (canonical Daniels Table 2). The old `E = M + 75` / `R = mile-pace` formula was deprecated as systematically wrong (see `docs/2026-05-19-sim-sweep.md`). The stale-branch commit would have revived it.

The cherry-pick was aborted in an isolated worktree; `main` was never touched. The fix's *ideas* (personalize HR thresholds off real HRmax, name-or-HR hard-day detection, the dormant marathon VDOT correction) still hold, but they must be **re-derived on `main`'s current architecture**, not transplanted.

**Lesson:** confirm `main` is your base before building, and never transplant a commit across diverged branches without dry-running the merge and reading the conflicts. Building on a stale branch produces work that is redundant (already done better on `main`) or deprecated (already removed from `main`).

## Deployment doctrine — approved fixes go to `main` (locked 2026-06-06)

When a fix is approved (falsifiers passed, David reviewed, explicit go given), **Claude** deploys it — David approves the fix, not the git push:

1. Commit immediately to the working branch with a clear message.
2. Push the branch to origin.
3. Merge to `main` and push `origin/main` (fetch first, fast-forward only).
4. Confirm Railway deploys — the pipeline fires automatically on push to `main`.
5. Run the cluster's smoke-check falsifiers **against prod** and report results.

"Deploy through the normal pipeline" means *you* (Claude) do steps 1–5, not David. **An approved fix that isn't committed and pushed is not deployed** — it's at risk of loss and prod is running the old code. Never leave approved work uncommitted.

**The only exception:** DDL / data writes (direct DB changes) still require David's explicit per-statement go before execution, as always. **Code changes deploy on approval; data writes need a separate explicit go.**

---

## Fully-autonomous mode — no stopping unless mission critical (locked 2026-05-24)

When David says "execute to 100% fully autonomous" (or equivalent — "full autonomous", "go in hard", "fully execute"), that's a hard instruction: **don't stop unless something is mission critical.** This applies to every agent on this app.

### Not mission critical — keep going

- Comfortable stopping points ("I've landed the architecture, time to write the report") — write the report at the END, after you've executed everything you can.
- Build / TypeScript / lint errors — debug and fix them. Per `feedback_verify_by_self_audit.md` you may not have `node_modules` to typecheck locally; that's not a reason to stop, it's a reason to read more carefully + audit by tracing types in the file.
- Merge conflicts during rebase — resolve them or `reset --hard origin/main` + `cherry-pick` your commits.
- Push rejected because main moved — fetch, rebase or reset+cherry-pick, retry.
- Risk concerns about touching big files (v4 component port, etc.) — read the file, make the smallest correct change, ship.
- Other agent's WIP referenced symbols that aren't on main — add the missing definition or work around. Don't punt.
- Decisions where the wrong choice is recoverable — pick using your best judgment ("use your best idea") and document the choice in the commit message.
- A phase has "framework + best example" wins but isn't fully polished — keep going until everything in the spec is at least at framework level, THEN come back for polish.

### Mission critical — stop and ask

- A destructive operation the user hasn't authorized (force push, hard reset of unmerged work, dropping a production table, deleting non-tombstoned data).
- A schema migration that would break the running app for live users (non-additive change, NOT NULL on existing data without backfill, renamed columns).
- Credential / auth change that could lock the user out.
- Money spend over an obvious budget (paid service tier, expensive API calls in a tight loop).
- Genuinely ambiguous input where no reasonable default exists AND the wrong choice cascades.
- A clear infrastructure failure (Railway is down, GitHub auth gone, DB unreachable) — surface and wait.

### Failure mode this rule fixes

The bug class: agent does 30% of the requested work, writes a "where to pick up next session" report, calls it done. The user comes back and asks "I thought you were going to build 100%, what stopped you?" — because nothing actually did stop the agent; it stopped itself at a comfortable point.

Specific anti-patterns:
- Writing the end-of-session report while there's still work in the queue.
- Marking tasks "completed" because they're at "framework level" when the user asked for full execution.
- Stopping after a build failure instead of fixing it.
- Stopping after a rebase conflict instead of resolving via reset+cherry-pick.
- Stopping because "the other agent's code might conflict" — read both, make the call.

The autonomous-mode default is **forward motion**. End-of-session report happens when there's nothing left in scope, not when the agent is tired.
