# Ownership Board — live, single source of truth for who's doing what

**Read this before dispatching anything. Update it every time you dispatch, every time a session
reports, and on every self-check.** This file exists because sessions were allowed to go idle after
reporting instead of being immediately re-dispatched — David's direct correction, 2026-09-14 night.

**Standing rule for every role, restated in every dispatch message:** end every report with your
own recommended next investigation. A report with no next-step is incomplete.

**Standing rule for the programme lead (this session):** a cron (job `8987d97c`, every 30 min, see
bottom) re-reads this board, checks every session's real state via `list_sessions`, and re-dispatches
anything idle with a NAMED task — immediately, not after being asked. Any gradecard row C-or-below
with no active owner is a programme failure and gets assigned in the same check.

---

## Board (last verified against real `list_sessions` state: 2026-09-15 ~07:15 UTC)

**Cycle 6**: TestFlight build 293 actively shipping (code agent, ~20-30min ETA from dispatch, carrying F072/F073/F056/F057-sentences/F029). External reviewer, coach consultant, independent reviewer all re-dispatched on F124's verification/product-decision split (safety verify + training-context read + UX read, three angles on one real control-loss bug). Design review and David's Desk both genuinely active, no dispatch needed.

**Cycle 5 dispatches**: external reviewer → independently verify F119's PhoneSync claim before a fix is built on it. Independent reviewer → single strongest next-investment read across the full register (F001-F120), not just their own reports. Coach consultant → doctrine read on F102's Rule 12 question, to hand David both sides before he decides. Design review → status-line design for F119's fix, or continue source audit if render's still blocked. Code agent and David's Desk both actively running — no dispatch needed.

**Current top priority, all roles aware: getting merged work SHIPPED, not just merged.** David directly (live, testing on his own phone): user-facing fixes touching his current day/week must reach Railway/TestFlight, not sit merged-and-dormant. Locked into CLAUDE.md's deployment doctrine. Code agent is actively working this now (F057's deploy was blocked by a coach-voice gate violation, being fixed; no TestFlight build yet exists carrying tonight's native work — TF 292 predates all of it).

| Role | Session | Current task (real, verified) | Next task — NAMED | Last real output | Blocker |
|---|---|---|---|---|---|
| Programme lead | this session | Processing the continuous stream of findings (now at F120)/decisions/rulings, keeping register/hub/board/CLAUDE.md doctrine current | 30-min self-check cron (job `8987d97c`) | Register at F120, CLAUDE.md Rules 25 + "merged is not shipped" (both locked + merged to main) | none |
| Code agent | Faff code agent lead (`local_dda85548`) | **RUNNING** — fixing the coach-voice gate violation blocking F057's deploy; F056/F057/F072/F073/F060/F037/F080 all landed tonight; F110/F111/F112/F119/F065/PO-008/F057-remaining-4/F118 all queued, F120's scoping guidance (grep sibling sites before closing) relayed | Named: unblock the deploy, then cut a TestFlight build carrying F056/F057-native/F072/F073 (standing authorization in CLAUDE.md), THEN F110 (safety) first among the rest | F056/F057/F072/F073 confirmed MERGED+DEPLOYED (F072/F073) via Rule 19 chain | Coach-voice gate violation, being fixed now |
| External reviewer | Faff external review lead (`local_b83f01e6`) | Idle ~26 min — traced F102 precisely (real gate-quality fix + real rounding fix, but Rule 12's architecture genuinely unfixed — routed to David's Desk); confirmed F072/F073 Rule 19 DEPLOYED | **Dispatched this cycle**: independently re-trace F117's account-deletion claim (does `/api/account/delete` really exist, do what's claimed, really unwired) | F102's precise 3-way verdict, F072/F073 deploy confirmation | none |
| Design & UX review | Faff design and UX review (`local_e54440f7`) | Idle ~10 min — 36 findings deep (016-036), delivered a real cross-report synthesis (F120, 2 patterns); render still blocked (F116, 2 devices tried, same intermittent input-drop symptom) | Self-directed per their own plan — continuing source audit, checking render environment periodically | F120 synthesis, F119 (PhoneSync sync-status mechanism reaches nobody) | Render blocked (F116) — working around it |
| Coaching consultant | Faff coach consultant (`local_7adc730c`) | Idle ~6 min — F057's remaining 4 sentences fully scoped with real proposed copy, ready for code agent | Self-directed or wait for next dispatch — sweep + Rule 25 + F057 all delivered this session | F057 4-sentence proposals (consult-log `2026-09-15-028`) | none |
| Independent product review | Faff independent product review (`local_a2d4e4ca`) | Idle ~4 min — App Store readiness pass done (F117: 3 real submission blockers, corrected own earlier framing on account deletion) | Self-directed — most named areas covered; free to pick or wait for direction | F117/IPR-014 | none |
| David's Desk | Davids Desk (`local_699a5e84`) | Idle ~4 min — relayed the real deploy-status facts to David, pushing for a concrete TestFlight-build ETA | Standing by for the code agent's concrete answer on build timing | David's "merged isn't shipped" directive relayed and now doctrine-locked | none |

**All 5 role sessions + David's Desk operational.** Faff Asks (live db-backed question queue) is the
canonical "needs David" channel now — hub's Needs From You tab is a thin pointer to it, not a
duplicate.

---

## Mission-critical (gradecard C-or-below) active-owner check

| Area | Grade | Current state | Active owner | Next action |
|---|---|---|---|---|
| Onboarding | D | F074 landed (RR-031), F103 (mileage-stepper silent snap-down, high priority) + F100 addendum (discarded writes) newly found | Code agent (F074 merge pending review confirm), design review (found F103) | F103 needs a product decision (rung-only stepper vs. show-resolved-value) before code work |
| Adaptation & progression | C | F034 (headroom-reserve) already fixed and deployed earlier tonight; no second real upward-adaptation instance confirmed yet | Coach consultant defined the proof bar | Watching for a real second instance over the coming days — no active task right now, correctly so |
| Runner model & evidence | C- | F037 (stale VDOT anchor honesty fix) landed, RR-035; F096 (safety-arbitration gap) and F080 (goal-feasibility ownership) both ruled | Code agent (F080 in flight) | F080 landing next |
| Today & Block | C | F100 (discarded writes, 7 screens), F105 (Block retry wrong params), F103 (onboarding stepper) all found tonight — real defect density, several already logged, none yet fixed | Design review (finding), code agent (queued) | Needs code agent capacity once F080/F065 clear |
| Post-run learning | C- | F077 fully ruled (doctrine + calibration), ready for implementation once `TRAINING_CONSISTENCY` consolidation happens | Coach consultant (ruling done) | Consolidation of 3 disagreeing consistency readers is the real blocker, not a decision gap |
| Health/readiness | D+ | Deliberately deferred, unchanged | N/A | Correctly idle |
| Runner control | C+ | F072/F073 merged to `main` tonight (`e6fbd4045`) under David's standing merge authorization | Closed for now | Watch for regressions |
| Baseline plans | C+ | `_coach_sensible.test.ts` confirmed 6/6 passing live (F102) — contradicts its own "red on purpose" header comment, not yet resolved which is true | External reviewer (found it) | Needs someone to confirm `81bf30eb8` genuinely fixed it vs. gate weakened (Rule 18) |

**Net assessment this cycle: every C-or-below area has real, recent movement — none are unowned.**
Onboarding and Today/Block have real new defect density from tonight's full-file reads; that's
findings outpacing fixes, not neglect — the code agent has a real queue (F080 → F065 → PO-008 → the
Today/Block backlog) and is moving through it steadily.

---

## Standing mechanism

- **Cron** `8987d97c`, every 30 min (`7,37 * * * *`), session-local, auto-expires 7 days from
  creation (2026-09-14 night) — renew before expiry, watch for the renewal-check instruction in the
  job's own prompt.
- **Faff Asks** (https://claude.ai/code/artifact/670b93b3-86b7-45d0-bbe0-f4bad9ac4c1e) is the live
  "needs David" queue, owned by David's Desk — check it via `read_db` (`collection: "questions"`) for
  a cheap open-count without pinging David's Desk each time.
- **This file is the durable record** — checked into the repo, not memory.
