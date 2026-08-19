# iPhone build — session brief

Paste this as the first message of a fresh session.

---

Build the approved faff.run iPhone app.

## Read first, in this order

1. `/Volumes/WP/06 Claude Code/Faff/design/0819/design_handoff_faff_iphone_app v5/README.md` —
   the design spec. Final: colours, type, spacing, radii and copy are exact. The sibling
   `Faff-iPhone-App.dc.html` is a working HTML prototype; open it and click through. It is a
   **reference, not code to port** — recreate the screens natively.
2. `docs/faff-iphone-design-contract.md` in this repo — what the backend can actually feed,
   and the rules the design cannot break.
3. `CLAUDE.md` at the repo root, in full.

**The v5 design supersedes `Design/running-app-design-brief-v2.md` for the phone.** Brief v2
governs web and watch only. Where they conflict — it forbids orange, the phone accent is
orange — the phone design wins. Do not reconcile the approved design against it.

## Scope

**Race-mode only.** A runner with a goal race is the only mode being built. Coached runners,
just-run runners and distance-goal-without-a-race exist in the backend and work end to end,
but get no phone screens for now. They need a graceful "not on phone yet", not three blank
screens — a refusal, not a screen set.

Destinations are Today, Block, Races, plus the RUN pill. Everything else in the v5 README is
reached from those.

## Four rules that are not negotiable

**A modelled number must never look measured.** The one real sin. Amber `~` immediately
before the value is the mark, and it is a system rule, not one screen's fix. The engine flags
every case in its payloads.

**One signal never changes a session.** Readiness needs three independent domains to converge
before it can downgrade anything, and that is a build gate. Any copy about a changed session
names the convergence, never a single cause.

**A refusal is a correct answer, not an empty state.** The engine declines on purpose — a week
that cannot carry quality, a distance not planned, a goal out of reach, a change-the-plan
scenario that cannot be satisfied. These must not look like the data-outage screen, which
means *we could not read this*. A refusal means *we read it and the answer is no*.

**Coach voice.** Short, direct. No hype, no exclamation marks, no emoji, no em dashes. Never
scold.

## Where the code is

- `native-v2/` — the iOS app. `Faff.xcodeproj`, generated from `project.yml` by **xcodegen**,
  so edit `project.yml` and regenerate rather than editing the project file.
- `native-v2/Faff/Faff/Views/` — 24 existing views. `API.swift` is the networking layer and
  the wire contracts.
- `web-v2/` — the backend. Next.js, deployed to Railway on push to `main`.
- Ship with `scripts/ship-testflight-v2.sh`. **Never ship a TestFlight build without an
  explicit go from David.**

## Contracts that must not move

**The watch wire is frozen.** `WatchCompletion` is camelCase with no CodingKeys; a
snake_case typo once silently dropped every GPS track.

**One row per plan date.** Enforced by convention and a lint test, not a database constraint.
A plan day now carries a server id — use it as the SwiftUI identity, not the date.

**Every plan mutation goes through the backend's `mutatePlan` boundary.** A source scan fails
the build if any writer bypasses it. The phone calls endpoints; it does not write plans.

## What the backend already gives you

- `POST /api/plan/change` — five scenarios (cutback, travel, extra day, move a day, another
  race). Proposes first, writes nothing until a confirm carrying a state token. Returns the
  trade-off in coach voice, caveats, and the effect. Can refuse with a reason.
- Goal assessment — eight verdicts, safe and stretch targets, up to three cautions.
- Readiness convergence — green / amber / red, with a sentence naming which signals converged.
- The workout catalogue — 59 cited sessions, so Block's library has real content.
- Race authority tiering — `representative / compromised / unrepresentative`, which is what
  the "did this race count?" confirm writes to.

## Two limits the design does not account for

**Phone run recording is foreground-only.** A phone in a pocket with the screen off stops the
run. Say so where the runner chooses to start one.

**The treadmill console's HEART tile has no source** without a watch on the wrist. It needs a
no-heart layout.

## How to work

Verify against the real app, not only against fixtures. `swiftc -typecheck` over the iOS
sources against the simulator SDK works and is fast — use it rather than claiming "compiles by
inspection". The iOS Simulator tooling in this session can build, install and screenshot; open
the live panel before building so David can watch.

Ten QA accounts exist in production (`qa-*-20260819-1231@faff.run`). **Never touch
`dnitch85@me.com` or `apple-review@faff.run`.** Delete nothing.

Backend baseline to keep green: `npx tsc --noEmit`, `bash scripts/check-doctrine.sh`,
`npx vitest run lib/ --maxWorkers=4`, and `npx vitest run lib/plan/_sweep_allusers.test.ts`
must stay at **FIRM 0 / WARN 0**.

## Model

Run the main loop on **Opus**. Delegate per-screen implementation to **Sonnet** agents in
isolated worktrees — the screens are transcription of an exact spec and Sonnet does that well.
Keep on Opus anything touching `API.swift`, the wire contracts, state flow between screens, or
the four rules above, because those are where a mechanical transcription goes wrong.

Every agent prompt must carry the four rules verbatim. A transcriber with a beautiful spec and
no rules will render a projection as a measurement and a refusal as an error.
