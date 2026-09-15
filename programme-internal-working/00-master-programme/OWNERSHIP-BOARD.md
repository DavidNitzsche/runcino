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

## Board (last verified against real `list_sessions` state: 2026-09-15 ~05:16 UTC)

| Role | Session | Current task (real, verified) | Next task — NAMED | Last real output | Blocker |
|---|---|---|---|---|---|
| Programme lead | this session | Processing the continuous stream of findings/decisions, keeping register/hub/board current | 30-min self-check cron (job `8987d97c`) | Register at F108, PO-009, CLAUDE.md coach-voice doctrine, hub refreshed | none |
| Code agent | Faff code agent lead (`local_dda85548`) | **RUNNING** — F080 (assessGoal/canonical-outlook ownership) in flight; F060, F037, F063, F078 all landed and independently re-verified tonight; F056/F057 merge-authorization now confirmed live by David's Desk | Named: F065 (Watch stride double-count, root-cause dive) next per their own plan, then PO-008 (shared "why" component — David greenlit) slotted in wherever makes sense | F060/F037 landed (RR-034/035), F063/F078 landed (RR-032/033) | none |
| External reviewer | Faff external review lead (`local_b83f01e6`) | **Idle ~32 min** — last real output: 5-way merge sim (clean) + live `_coach_sensible.test.ts` run (6/6 passing, flagged stale header) | **Dispatched this cycle**: confirm Railway deployment STATUS for tonight's `main` merges (F072/F073 at minimum) — Rule 19 discipline, "BUILT" was proven at push time but "DEPLOYED" never independently confirmed. Bounded, concrete, real stakes. | Merge sim + live test run | none — was between tasks |
| Design & UX review | Faff design and UX review (`local_e54440f7`) | **RUNNING** — full-file reads across 7 major screens tonight (Settings/Shoes/RunLobby/Onboarding/Block/Races/Today), F093-F094/F099-F101/F103/F105/F107 logged; render verification blocked on an unexplained touch-input issue (not the earlier CPU-load cause), stepping back from render attempts per their own call | Continuing source-audit work; will resume render verification opportunistically | 7 full-file reads, F100/027 considered fully scoped across the app | Render blocked, not idle — working around it |
| Coaching consultant | Faff coach consultant (`local_7adc730c`) | Idle ~2 min — just closed F077/F080/F066-arbitration + 2 proactive `ownership.ts` sweep findings (F096 safety-arbitration gap, F097 MAX_DEMONSTRATED_DOSE, self-corrected), wrote conversational coach-voice doctrine into `Design/coach-voice-brief.md` | Continue the `ownership.ts` OPEN-entry sweep for the same "real gap, never turned into a runner-facing design" shape | Consult-log through `2026-09-15-025` | none |
| Independent product review | Faff independent product review (`local_a2d4e4ca`) | Idle ~6 min — completed generalization audit (F106), Settings pass (F104), coach-voice pass (F108), and a cross-report synthesis (`SYNTHESIS-20260914-001`, 3 real patterns across the corpus) | Self-directed — no specific next item named in last report; free to pick per their own judgment (Profile/Settings already done, most named areas covered) | SYNTHESIS-20260914-001, F104/F106/F108 | none |
| David's Desk | Davids Desk (`local_699a5e84`) | Idle ~2 min — live, fully operational, "Faff Asks" queue confirmed working well by David directly; verifying F056/F057 authorization live with the code agent right now | Standing by for flagged items | Multiple resolved decisions relayed with verbatim quotes (F069/F081/F092/PO-008 rulings), correctly caught 2 stale-hub issues | none |

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
