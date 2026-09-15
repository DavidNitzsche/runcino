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

## Board (last verified against real `list_sessions` state: 2026-09-15 ~05:48 UTC)

| Role | Session | Current task (real, verified) | Next task — NAMED | Last real output | Blocker |
|---|---|---|---|---|---|
| Programme lead | this session | Processing the continuous stream of findings/decisions/rulings, keeping register/hub/board/CLAUDE.md doctrine current | 30-min self-check cron (job `8987d97c`) | Register at F113, CLAUDE.md Rule 25 (locked + merged to main) | none |
| Code agent | Faff code agent lead (`local_dda85548`) | **RUNNING** — F080 in flight; F060/F037/F063/F078 landed; F072/F073 merged AND deployed (Rule 19 chain confirmed); F110 (safety, pace-bail) and F065 (root-caused) queued high-priority next | Named: F110 (safety, pace-metric bail starved) is top priority once F080 clears, then F065/F111/F112/PO-008 | F110/F111/F112/F065-rootcause all dispatched this session | none |
| External reviewer | Faff external review lead (`local_b83f01e6`) | Idle ~29 min — confirmed F072/F073 MERGED+DEPLOYED via `check-deploy-status.sh` (Rule 19 closed) | **Dispatched this cycle**: trace F102 — confirm whether `81bf30eb8` genuinely fixed `_coach_sensible.test.ts`'s Rule-12 issue or the gate was weakened (Rule 18) | Rule 19 deploy confirmation | none |
| Design & UX review | Faff design and UX review (`local_e54440f7`) | **RUNNING** — now 34 findings deep (016-034) across 8 phone screens + 4 Watch areas; F110/F111/F112/F113 landed tonight (3 instances of the same safety-relevant accumulator-behind-display-gate shape); render still blocked (unexplained touch issue, load 97-113) | Writing out a batched render-verification sequence for the next viable load window (F082/F086 + their own source-only findings) | F113 root-caused (classifySession has no week-awareness) | Render blocked — working around it, not idle |
| Coaching consultant | Faff coach consultant (`local_7adc730c`) | Idle ~34 min — wrote conversational coach-voice doctrine (David's quote) into `Design/coach-voice-brief.md`, twice (original + pre/post-run follow-up) | **Dispatched this cycle**: continue `ownership.ts` sweep, or pivot to whether Rule 25's "ask/substitute" shape exists in coaching/pace logic | `Design/coach-voice-brief.md` doctrine additions | none |
| Independent product review | Faff independent product review (`local_a2d4e4ca`) | Idle ~37 min — completed generalization audit, Settings pass, coach-voice pass, cross-report synthesis (`SYNTHESIS-20260914-001`) | **Dispatched this cycle**: App Store readiness + privacy/auth (last named untouched area) | SYNTHESIS-20260914-001 | none |
| David's Desk | Davids Desk (`local_699a5e84`) | Idle ~6 min — "Faff Asks" live and working well per David directly; independently verified standing merge authorization with David live (not just a doc check) | Standing by | Multiple verbatim-quoted rulings (F069/F081/F092/F103/PO-008/Rule 25) | none |

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
