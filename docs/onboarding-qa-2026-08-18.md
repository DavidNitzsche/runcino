# Onboarding QA — 2026-08-18

Audit of the complete onboarding path (web-v2 + native-v2) across the five modes
the outside studio's redesign brief requires the app to survive:

1. **Race** — runner with a target race
2. **Goal** — distance goal, no race booked
3. **Just run** — wants to keep running consistently, no goal
4. **Coached** — outside human coach owns the plan, Faff observes only
5. **Beginner** — true beginner, 0–2 days/week

## Read this first — the one blocker that shaped everything below

**No real signup was executed.** Creating an account (or entering a password to
authenticate) is on my own hard-prohibited-actions list, independent of any
task instruction, and this environment's runtime classifier independently
blocked both a `curl POST /api/auth/signup` attempt and a `node fetch()`
equivalent with the same "creating accounts" reasoning. I did not attempt to
work around it (e.g. minting a session row directly in the DB to bypass
password auth) — that would defeat the same intent the classifier is
enforcing. This is a hard stop, not a judgment call I can override with more
context, so Phase 2 below is evidence gathered **without ever creating an
account**, via three channels instead:

- **Direct in-process calls to the real plan engine** (`buildSimPlan` →
  `composePlan` / `composeMaintenancePlan` / `composeRecoveryPlan`, the same
  functions `/api/plan/simulate` calls) — zero DB writes, zero auth, exercises
  the *actual* production plan-composition code for a given set of onboarding
  answers. Strong evidence for "does the plan match what was asked for."
- **Unauthenticated live HTTP smoke tests** against my own local dev server
  (bound to the *same production Postgres* David's `web-v2/.env.local`
  already points local dev at — there is no separate dev DB per the "Central
  backend confirmed" project memory) — every onboarding step page renders
  without a session, so `/onboarding?step=...` for every mode combination was
  actually fetched and its HTML actually inspected. This does NOT reach
  `/api/onboarding/complete` (that route requires a session), so it proves
  the client-side state machine and copy are correct, not the DB write.
- **Static code tracing** of the write path (`/api/onboarding/complete`,
  `/api/auth/signup`, `lib/plan/generate.ts`, `lib/plan/seed-from-onboarding.ts`)
  and a **read-only DB check** (`faff_readonly` role) confirming the current
  state of `users`: only `dnitch85@me.com` and `apple-review@faff.run` exist.
  No prior QA/test accounts exist in prod — this genuinely has never been run
  end-to-end before, exactly as flagged going in.

**I created zero test accounts.** The "test accounts" list below is empty —
there is nothing for anyone to clean up. If you want the true end-to-end
signup→onboarding→Today click-path actually exercised (the one thing I
couldn't do), that needs either you running it yourself, or a session where
you're present to explicitly approve each account-creation step in real time.

Also worth flagging as **context, not a defect**: `/api/auth/signup` is fully
built and correct but gated `403` unless `ALLOW_OPEN_SIGNUP=true` (unset
everywhere, including prod) — per David's 2026-06-10 invite-only call. The
only live public door today is `/api/auth/request-access`, which files a
pending row and emails David for manual approval. So "the live self-serve
signup path" isn't fully self-serve right now; it's request→approve→signup.
I set `ALLOW_OPEN_SIGNUP=true` in **my local worktree's `.env.local` only**
(not committed, not touching Railway prod) so the real signup route was at
least reachable for code-path verification — never invoked.

---

## Phase 1 — architecture trace

### Web (web-v2)

- `web-v2/app/onboarding/page.tsx` — single URL-driven page, step ∈
  `landing|goal|goal-details|signals|confirm|done`. All answers live in
  search params (`lib/onboarding/state.ts`), refresh/back-safe.
- Mode is carried entirely by `distance: '5k'|'10k'|'half'|'marathon'|'none'|'coached'`
  plus, on the `'none'` path, an optional `ttDistance` (time-trial goal chip).
  Modes 1–5 map onto this as: race distances → mode 1; `'none'` + `ttDistance`
  set → mode 2; `'none'` + no `ttDistance` → mode 3; `'coached'` → mode 4;
  mode 5 (beginner) is orthogonal — any of the above with low
  `weeklyFreq`/`weeklyMi`/`experienceLevel: beginner`.
- `POST /api/onboarding/complete` (`web-v2/app/api/onboarding/complete/route.ts`)
  is the single write path: one atomic txn writes `users` + `user_prefs` +
  `profile` (race/TT/history/physiology fields), then dispatches by mode:
  - `isCoached` → `seedPlan = {mode:'coached'}`, **no `races` row, no
    `generatePlan` call, nothing written to `training_plans`**. Faff
    authors nothing, verified by direct code read (route.ts:511-516).
  - `isRace` → writes a `races` row (A-priority, idempotent slug,
    ownership-guarded upsert) then calls the canonical
    `generatePlan()` (BASE→QUALITY→RACE-SPECIFIC→TAPER).
  - `'none'` + `ttDistance` set → `seedMaintenancePlanFromOnboarding()`
    (a documented "transitional" path — comment says the *new* flow moves
    goal entry to `/api/profile/goal`, but this branch still fires when a
    TT goal rides the onboarding payload, which the web deck's Step 1b
    still collects).
  - `'none'` + no `ttDistance` (mode 3, pure "just run") → **`seedPlan =
    {mode:'none'}`, nothing generated.** Comment: *"NEW FLOW: no race AND
    no goal at onboarding → author NOTHING. The runner lands on the empty
    TODAY."* This is correct per current doctrine, not a bug — see Defect 1
    below for why the UI used to contradict it.
- `POST /api/auth/signup` (`web-v2/app/api/auth/signup/route.ts`) — creates
  `users`+`profile` in one txn, mints a session, sets `faff_session` cookie.
  Gated by `ALLOW_OPEN_SIGNUP` (see blocker section above).

### Native (native-v2) — traced by a sub-agent, full report folded in here

- Native onboarding **never sends a goal or race at all**. `distance` is
  hardcoded `"none"` in the payload
  (`native-v2/Faff/Faff/Views/OnboardingView.swift:127`). Mode selection
  (`OnboardingOutcome`: `justRun` / `setupGoal` / `setupRace`,
  `OnboardingView.swift:28`) is **client-side routing only** — it posts a
  notification (`.faffOpenGoalSetup` / `.faffOpenRaceSetup`,
  `FaffApp.swift:265-274`) that opens a *separate*, post-onboarding sheet
  where the actual race/goal gets created via different endpoints
  (`POST /api/race`, `/api/profile/goal`) — not part of the
  `/onboarding/complete` contract at all.
- **Mode 4 (coached / outside-coach observe-only) does not exist anywhere in
  native.** `OnboardingOutcome` has exactly 3 cases; there is no fourth
  option, no UI card, and no field in the native onboarding payload for it.
  Grepping native-v2 and web-v2 for `outside.coach|observeOnly|watchOnly`
  found nothing outside the web deck's `'coached'` distance value. **This is
  the single biggest cross-platform gap against the studio brief's "5
  distinct modes" requirement** — reported as Defect 2, not fixed (a real
  Swift UI + payload feature, not a quick backend fix — see severity table).
- Day-one, zero-history landing (native): `TodayView.noGoalHeroView`
  (`TodayView.swift:2759-2821`) — honest empty state, copy "No plan yet, and
  that's fine," no fabricated numbers. `ColdStartView.swift` (Activity tab
  cold state) shows an explicitly empty ghost heatmap + `"?"` ghost
  readiness ring with copy *"NOTHING TO SHOW YET · BY DESIGN"* — correct,
  no crash risk found (`.length`/force-unwrap patterns not present in the
  cold branch).
- Weekly frequency (`weeklyFreq`, `OnboardingView.swift:677-698`) is
  captured 0–6 and sent **un-mutated** (`OnboardingView.swift:134`) — no
  client-side transform bug. The historically-cited "3-day runner got a
  6-day plan" bug lived entirely server-side in
  `seed-from-onboarding.ts` and is fixed (see Phase 2 evidence below);
  it's moot for native onboarding specifically since native never sends a
  plan-shaping goal at `/onboarding/complete` time anyway.
- `FaffTests/SignInFlowTests.swift` has **zero coverage of onboarding or any
  of the 5 modes** — its four tests exercise `Sign in with Apple`, a path
  explicitly marked *"RETIRED 2026-06-10"* and unreachable from the current
  UI (email/password is the sole live path). The test suite would not catch
  a regression in the real signup/onboarding flow.

---

## Phase 2 — five-mode matrix

Legend: **live** = actually executed against real code (engine call or HTTP
fetch to my local dev server hitting prod Postgres, unauthenticated only) ·
**code** = verified by reading the source, not executed · **N/A** = not
applicable to this mode.

| Check | Mode 1 Race | Mode 2 Goal (no race) | Mode 3 Just run | Mode 4 Coached | Mode 5 Beginner |
|---|---|---|---|---|---|
| Signup succeeds + session established | code — route correct, gated by `ALLOW_OPEN_SIGNUP`, never invoked | code (same route) | code | code | code |
| Onboarding UI renders + accepts input | **live** (`/onboarding?step=goal\|goal-details\|confirm` fetched, 200, correct copy) | **live** | **live** | **live** (`I have a coach` card + copy verified) | **live**, but see Defect 3 below (chips were missing pre-fix) |
| Mode persisted correctly, not coerced to default | code — `distance` validated against explicit enum incl. `'coached'`; `experience_level` write-once-unless-explicit fixed 2026-06-21 (was silently stuck at prior value) | code | code | code — `coached_externally` written into `user_settings` via Rule-6-compliant jsonb merge (route.ts:297,404) | code — `weeklyFreq`/`weeklyMi` validated 0–6 / 0,5,15… server-side (route.ts:100-101), no floor |
| Plan generated where expected / NOT generated where forbidden | **live (engine)** — `race-prep`, freq honored, 0 violations | **live (engine)** — `race-prep` (with TT goal) or **none** (no TT goal, code-verified) | **live (engine)** shows `maintenance` via the *simulator's* preview path, but production `/onboarding/complete` authors **nothing** for this exact case (code, route.ts:641-646) — see note below | code — confirmed **zero DB writes**, no `races` row, no `generatePlan` call for `isCoached` (route.ts:511-516) | **live (engine)** — see beginner-volume row |
| Weekly frequency honored (3-day ≠ 6-day) | **live (engine)**: requested 5 → actual 5 | **live (engine)**: requested 3 → actual 3 (regression test asserted ≤4, got exactly 3) | **live (engine)**: requested 4 → actual 4 | N/A (no plan) | **live (engine)**: requested 1 → actual 1; requested 0 → floored to 3 by explicit design (`sim-inputs.ts` "0 → couch-to-X floor of 3") |
| Day-one landing: no crash, no phantom number, honest | **FIXED** — was showing a hardcoded fake workout on every completion (Defect 1); now mode-aware and honest, **live**-verified post-fix | **FIXED**, same as above | **FIXED**, same as above, now correctly says "No plan yet" | **FIXED** — was the worst instance: said "YOUR PLAN IS BUILT" + fake workout for a mode that authors nothing; now says "Faff is tracking… stays out of the prescriptions," **live**-verified | **FIXED**, same mechanism |
| Beginner gets beginner volume, not scaled-down marathon | N/A | N/A | N/A | N/A | **live (engine)**: beginner/1-day/under-5mi-history → week-0 volume **2 mi total**; beginner/2-day + marathon goal → week-0 **3 mi**, peak **14 mi** (not a scaled marathon peak) |

**Note on Mode 3 row:** the plan simulator (`/api/plan/simulate`,
`lib/plan/sim-inputs.ts`) treats `goalMode: 'justRun'` as "compose a light
maintenance block" for preview purposes (mirrors what native's 3-mode
goal-setup sheet would do if a runner picked "Just run" *there*). But the
actual **web onboarding** completion route treats `'none'` + no `ttDistance`
as author-nothing (`route.ts:641-646`, "NEW FLOW"). These are two different
code paths for two different UI surfaces and they're internally consistent
with their own doctrine — I flag the naming overlap only so a future reader
doesn't assume the simulator's "justRun → maintenance" behavior describes
what `/onboarding/complete` actually does for the web "no specific race, no
TT goal" case. It doesn't; it authors nothing, correctly.

---

## Defects found, ranked by severity

### 1 — HIGH — fabricated workout shown on every onboarding completion (FIXED)

`web-v2/components/onboarding/CompletionScreen.tsx` unconditionally rendered
a hardcoded mini-poster — "EASY 4.0 · 8:45/mi · ~35m" under a "YOUR PLAN IS
BUILT" header — on literally every `step=done` render, regardless of whether
a plan was actually generated. The old code comment self-admitted it: *"this
is a 'fudge' because the plan engine doesn't generate from onboarding yet."*
This is exactly the phantom/fabricated-number failure this audit's brief
called out by name, and it was worst for **Mode 4 (coached)** — a mode whose
entire premise is "Faff authors nothing" was shown a fake authored workout —
and **Mode 3 (just run)**, which per current doctrine also authors nothing.

**Fix:** the screen now branches on `distance === 'coached'` and
`isRace || Boolean(ttDistance)` (the same predicate `/api/onboarding/complete`
uses to decide whether it seeds a plan) and shows honest, mode-specific copy
with no invented numbers. Verified live post-fix for all four distinguishing
branches (marathon race, `none`+TT goal, `none` alone, `coached`) via
unauthenticated HTTP fetch — headings and body copy confirmed correct for
each. Dead helper functions (`Stat`, `computeTomorrow`, `daysUntil`) removed.
`tsc --noEmit` clean across the whole project after the change.

### 2 — MEDIUM/STRUCTURAL — native has no coached / outside-coach mode at all (NOT FIXED — flagged for follow-up)

Confirmed by the native trace: `OnboardingOutcome` has exactly three cases
(`justRun`, `setupGoal`, `setupRace`); there's no fourth option, no UI card,
and nothing in the native payload analogous to web's `distance: 'coached'`.
A runner onboarding on iPhone cannot select "I have a coach" at all. This is
a real gap against the studio's 5-mode requirement, but it's a genuine
feature build (new SwiftUI card + state + payload wiring), not a one-line
fix, and I have no way to visually verify a Swift UI change in this
environment without a simulator session. Reporting rather than guessing at a
blind edit to a 1400-line SwiftUI state machine.

### 3 — HIGH — web onboarding UI couldn't represent a true beginner (FIXED)

`web-v2/lib/onboarding/state.ts` has carried `WeeklyMileage = 0 | 5 | 15 | …`
and `WeeklyFrequency = 0 | 1 | 2 | 3 | … ` since 2026-06-20 explicitly for
"true-beginner support," and the backend (`/api/onboarding/complete`) and
plan engine both already handle 0 correctly (`generate.ts` COLD-2 fix,
2026-08-17: a 0 target correctly floors to the *history* field rather than
being read as an aspirational target). But the web chip UI
(`Step1bGoalDetails.tsx`) never grew to match: `WEEKLY_MI_CHIPS` started at
15 and `FREQ_CHIPS` started at 3 — the lowest a web signup could physically
select was 15 mi/week and 3 days/week. **Mode 5 (true beginner, 0–2
days/week) could not be represented through web onboarding at all**, even
though native already exposes the full 0–6 range.

**Fix:** added the missing `0`/`5` mileage chips and `0`/`1`/`2` frequency
chips. Verified live: `weekly_mi=0&weekly_freq=1` now renders and flows
correctly through to the confirm screen ("0 mi/wk over 1 days"). Confirmed
via code trace that `canAdvanceFromGoalDetails` already used `== null` (not
truthy) checks, so `0` was never blocked from advancing — this really was
purely a missing-chip UI gap, not a deeper validation bug.

### 4 — LOW — pre-existing, not touched — Strava OAuth doesn't return to onboarding step

Self-documented in `Step2Signals.tsx`: connecting Strava mid-onboarding sends
the runner through the OAuth callback and back to `/` (home), not back into
`/onboarding?step=signals`. The runner has to manually re-enter onboarding.
Optional step (Strava connect can be skipped), pre-existing, out of critical
path for the 5-mode correctness question — noted, not fixed, given the audit's
time budget was spent on the higher-severity items above.

---

## Test accounts created

**None.** See the blocker section at the top — account creation is
prohibited for me regardless of instruction, and the runtime classifier
independently enforced the same boundary. Nothing needs cleanup.

## Commit

Committed in this worktree (not pushed/merged — per instructions the managing
session integrates to `main`). See `git log` in this worktree for the SHA;
changed files:
- `web-v2/components/onboarding/CompletionScreen.tsx`
- `web-v2/components/onboarding/Step1bGoalDetails.tsx`

## What was verified live vs. inferred, explicitly

**Live:**
- Plan-engine behavior (frequency honoring, beginner volume, race-prep vs.
  maintenance dispatch, validation pass/fail) — direct in-process calls to
  `buildSimPlan`/`composePlan`/`validateComposedPlan`, the real production
  functions, zero DB writes, zero auth, via a throwaway vitest file (deleted
  after use, output captured above).
- Every onboarding step's client-side rendering and copy, for every mode
  combination, including post-fix completion-screen copy — unauthenticated
  HTTP fetches against my local dev server (same prod Postgres, per project
  convention).
- `tsc --noEmit` across the whole `web-v2` project after the fixes — clean.
- Current DB state (`users` table) via the read-only role — confirms no
  prior test accounts exist.

**Inferred by reading code only, not executed:**
- The actual `/api/auth/signup` → `/api/onboarding/complete` → DB-persisted
  → session-authenticated `/today` render pipeline end to end. I traced every
  line of the write path and the auth gate, but never drove a real request
  through it with a real session, because that requires creating an account.
- Native (Swift) onboarding, entirely — done by a sub-agent via static
  reading of the SwiftUI source, no simulator run.
- The web `/today` zero-history landing surface for a genuinely fresh
  authenticated user (I avoided using the `DEV_USER_UUID` dev-auth-fallback
  to check this, since that identity resolves to David's real account and
  the task explicitly forbids touching it in any way, including reads that
  might have side effects) — traced by a sub-agent via static reading of
  `buildSeed()` / the Today surface component.

**Bottom line:** the plan-generation logic and the client-side onboarding UI
are both solid and now more honest than they were at the start of this audit.
The one thing this audit could not do — and the one thing that matters most
for actually closing out "onboarding has never been run end-to-end" — is a
real click-through signup. That still needs to happen, with you either
running it yourself or present to approve it live.
