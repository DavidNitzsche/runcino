# Session status · 2026-06-10 · multi-user onboarding + plan generation

Clean handoff for next session. Everything below is **committed + pushed to `origin/main`** and live on prod (**www.faff.run**, Railway auto-deploy verified healthy).

## What shipped (this session)

| Commit | What |
|---|---|
| `e5225352` | **Frequency fix** — all 3 plan generators honor `weekly_frequency`. A 3-day runner was getting a 6-day plan (the bug David hit 3 clicks in). Gated on NOT NULL → David (null) unaffected. |
| `96d0f990` | **Cold-start polish** — no false "1 day missed" on day one (strength floored at join date); readiness ring "0" → "—" for no-biometric users. |
| `f0e31811` | **Goals drive the plan** — "get faster at a 5K/mile" now prescribes VO2 intervals (was generic threshold); phase reads "5K BUILD". |
| `222fc3ec` | **No past runs** — onboarding plans anchor week 0 at the join day, not the Monday before. |
| `97ab5113` | **COACHED card** — empty biometric tiles → "Connect Apple Health" prompt; coach-calendar paste moved to Settings › Connections. |
| `21f78060` | **Day-one front-load** — week 0 puts a run on the start day if it'd otherwise be rest. |
| `a36ec226` | **Ask start day + long-run day** — confirm step has both pickers; plan honors them (verified: start "in 3 days" + long Sat → plan starts Sat, longs on Saturdays). |

Verification: `_plan_matrix_smoke.mjs` 33/33 (every path × frequency 3-6 × history tier, validates real `plan_workouts` rows), `vitest` 458 passed, palette CI gate green.

## How to test (local sandbox)

`bash web-v2/scripts/sandbox.sh` → http://localhost:3100 · DB `faff_sandbox` · password for all demo users `faff-test`.

- **Onboarded, see each plan**: `demo-marathon`, `demo-marathon-6d`, `demo-half`, `demo-10k`, `demo-5k`, `demo-faster-5k`, `demo-faster-mile`, `demo-consistency`, `demo-coached`, `demo-marathon-faraway` `@test.local`.
- **Fresh onboarding experience**: `runner-b@test.local` … `runner-e@test.local` (un-onboarded → log in, go through onboarding incl. the new start-day/long-run-day step).
- Re-provision after any plan-gen change: `node web-v2/scripts/_provision_demo_users.mjs`.

## Open items for next session

1. **DECISION NEEDED · low-frequency easy run exceeds the long run.** A 3-day/~24mpw 5K runner's single easy day absorbs leftover volume and balloons past the long (11mi easy vs 5mi long). A naive `easy ≤ long` cap was tried and **reverted** (it flattens the volume ramp for low-frequency short-race plans and false-positives on race week). Real fix is volume calibration with tradeoffs — options: (a) cap weekly volume to what the frequency holds, (b) raise the long-run floor for low-frequency runners, (c) other. Needs David's pick. Tracked as a background chip (`task_a3ad231a`).
2. **iPhone wiring** — native onboarding (SwiftUI) needs the start-day + long-run-day pickers to match web; backend already accepts `startDate`/`longRunDay` (lenient, optional). Also check whether the native COACHED/cold-start states have the same empty-tile issue web had. See `docs/IPHONE_SYNC_LEDGER.md § 2026-06-10`.
3. **Race far out → maintenance** — a runner who signs up >build-window before a race correctly gets a maintenance block, but it doesn't reference the upcoming race (no countdown). Doctrine-correct but thin UX; worth a race-aware maintenance surface.
4. **Prod test-account purge** — persona/test accounts on prod from earlier waves still await one DELETE go (see `project_multiuser_signup_2026-06-10` memory). Not urgent.

## Note · shared checkout

Another agent was working the same checkout this session (TodayView DragSheet / calendar / splits work) with **uncommitted** WIP in `TodayView.tsx` + `session-shape.ts`. My work is all committed by explicit path; their uncommitted files were left untouched. My TodayView changes are confirmed present in `origin/main` HEAD.
