# Ownership Board — live, single source of truth for who's doing what

**Read this before dispatching anything. Update it every time you dispatch, every time a session
reports, and on every hourly self-check.** This file exists because sessions were allowed to go
idle after reporting instead of being immediately re-dispatched — David's direct correction,
2026-09-14 night. This board is the fix: it is checked, not remembered.

**Standing rule for every role, restated in every dispatch message:** end every report with your
own recommended next investigation. A report with no next-step is incomplete.

**Standing rule for the programme lead (this session):** an hourly cron (see bottom of this file)
re-reads this board, checks every session's real state via `list_sessions`, and re-dispatches
anything idle with its "Next task" column below — immediately, not after being asked. If a
mission-critical area (any gradecard row C-or-below) has no active owner, that is a programme
failure and gets a task assigned in the same check.

---

## Board (last verified against real `list_sessions` state: 2026-09-14 ~21:13 local / 04:12 UTC)

| Role | Session | Current task (real, verified) | Next task — NAMED, with expected artifact | Last real output | Blocker |
|---|---|---|---|---|---|
| Programme lead | this session | Isolating F082/F086/F066 into proper commits; answering David's anti-stall corrections | Hourly→30-min self-check cron (job `8987d97c`) | This file + register F093-F095 | none |
| Code agent | Faff code agent lead (`local_dda85548`) | **RUNNING** (verified via list_sessions, 04:12:48 UTC) — F063 (day-one dose-less plan) + F078 (week-off date off-by-one) in parallel, per their own report neither is submittable yet (F063's own agent still mid-verification, correctly not rushed) | Named: once F063+F078 land, fix F037 (stale `season_anchor_vdot` mislabeled as measured — Runner Model & Evidence, C-) → expected artifact: commit + register update citing the doctrine fix, submitted as an RR. THEN: F095 watch-gate flake re-check (run the gate twice more under normal load, confirm not a real regression) | 3 commits on F063 branch, F078 dispatched | none |
| External reviewer | Faff external review lead (`local_b83f01e6`) | Idle ~11 min (verified) — just finished a real proactive audit (cross-change sweep across 5 CONFIRMED branches, clean; independently re-verified 2 historical-incident claims, both real) | Named: bounded 3+-way merge simulation across all 5 confirmed branches at once (their own proposed next step, approved) → expected artifact: a review note confirming no 3-way conflict, or naming the specific one found. THEN: review F066 (branch pushed, SHA `75e5c0c05`) once code agent packages the RR | Two independently-reproduced RR reviews + one proactive audit | none |
| Design & UX review | Faff design and UX review (`local_e54440f7`) | **RUNNING** (verified) — pivoted to source-only reads (host load hit 420+) producing F093 (long_run_day discards `replanned`, no toast — Today & Block, C) and F094 (Strava connect failure swallowed) | Named: continue source-audit of Travel windows detail screen (`TravelV5.swift`) → expected artifact: a finding doc, same pattern as F093/F094. Resume live render verification (F082 Dodgers screen, F086 long-run screen) the moment `uptime` drops under ~60 | F093, F094 logged this cycle | Host load only — not idle |
| Coaching consultant | Faff coach consultant (`local_7adc730c`) | **RUNNING** (verified) — closed item 1 (F074 reconfirmation, approved, real diff read), moving to item 2 (F077, repeated non-adherence — Post-run Learning / Baseline, C-) | Named: F077 ruling → expected artifact: consult-log entry defining detection + coach response + recommitment path. THEN item 3 (F080 goal-feasibility ownership — Runner Model, C-), item 4 (safety/race-prediction implications of F066) | Consult-log 2026-09-14-018 | none |
| Independent product review | Faff independent product review (`local_a2d4e4ca`) | Idle ~seconds (verified, essentially between turns) — confirmed redefined role, started on "adaptive coaching relationship + Today" (Today & Block, C) using the 9 IPR reports as grounding | Named: finish that pass → expected artifact: a balanced report (defects/protect/improve/remove/propose/strongest-investment) on the coaching-relationship + Today question. THEN rotate to "what should Health become" (Health, D+, deliberately deferred but still worth exploring) | Confirmed role shift, starting first balanced pass | none |
| Background: IPR synthesis | subagent `a067c5e15afe83910` | Reading all 9 IPR reports, adding missing register rows (F089-F092 landed), building product-opportunities register, reconciling coverage matrix | Report back with full tally | F089-F092 confirmed added | Running without worktree isolation (my mistake, docs-only so lower risk — see feedback memory) |

| David's Desk | David Interface Agent (`local_699a5e84`) | Just started, getting oriented (read own brief + register + ownership board) | Confirm live to David's programme lead handoff, then stand by for any flagged item from another role | Session spun up 2026-09-14 night | none |

**New role tonight: David's Desk.** Single channel to David — every other role routes "needs David" items to it instead of pinging separately or waiting for the hub to be checked. Full brief: `for external review/DAVID-INTERFACE-OPERATING-BRIEF.md`. All 5 other role sessions notified of the new protocol.

**Baseline Plans (C+)** — no dedicated current task this cycle; concrete next action named: whichever role is next free runs `_coach_sensible.test.ts` live and reports current pass/fail (cheap, single-test check) rather than sitting unassigned. Assigning to external reviewer's bounded-audit slot after the 3-way merge sim.

---

## Mission-critical (gradecard C-or-below) active-owner check

Per David's direct instruction: every C-or-below area needs a named gap, evidence needed for next
grade, active owner, current task, next action. Filled in as each area gets a real dispatch below.

| Area | Grade | Gap to next grade | Evidence needed | Owner | Current task | Next action |
|---|---|---|---|---|---|---|
| Onboarding | D | Real evidence (race time, pace, layoff) discarded before plan generation | F074's fix reviewed + merged + native wired | Code agent (F074 backend done) + design/coach for native follow-on | F074 at RR-20260914-031 | Merge on review confirm; native wiring is separately scoped |
| Adaptation & progression | C | Upward push proven live once, not yet a repeatable pattern | A second real upward adaptation firing for David's account | Coach consultant to define what evidence would prove it's repeatable | Idle → dispatched | Watch cron output over the next few days; define the proof bar now |
| Runner model & evidence | C- | Stale VDOT anchor / disconnected piece | F037's already-scoped fix landing | Code agent | Not yet dispatched this cycle | Queue behind F063 |
| Today & Block | C | Duplicated decision card, plan-change notification gap (F028/F029) | Both fixed and rendered | Code agent + design review | Not yet dispatched this cycle | Queue next after F063/onboarding |
| Post-run learning | C- | Recap overconfidence, silent-recovery-test gap | Fixes for both, rendered | Code agent | Not yet dispatched | Queue behind safety/onboarding |
| Health/readiness | D+ | Deliberately deferred — not a gap to close right now | N/A | N/A | Deliberately idle | Revisit once higher-tier areas clear, per standing decision |
| Runner control | C+ | Re-run guard (F072/F073) reviewed but unmerged | David's merge authorization | Programme lead | On `rc/f072-f073-rerun-guard-2026-09-14`, awaiting go | Ask David for merge batch decision |
| Baseline plans | C+ | Easy-day-before-quality check status unconfirmed | Confirm `_coach_sensible.test.ts` current state | Code agent | Not yet dispatched | Queue soon, cheap to check |

---

## Standing mechanism

- **Hourly cron** (session-local, auto-expires after 7 days per platform limit — must be
  re-created if this session runs past that): re-reads this board, calls `list_sessions` (cheap,
  no model cost) to find idle/stalled sessions, re-dispatches from the "Next task" column,
  updates this file, and sends a `PushNotification` if every session is idle at once or a
  mission-critical row has no active owner.
- **This file is the durable record** — checked into the repo, not memory. Update it inline as
  part of every dispatch and every report received.
