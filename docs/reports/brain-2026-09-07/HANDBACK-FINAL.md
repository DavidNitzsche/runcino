# Handback · final, round 14 · 2026-09-07

`main` at `e19e430b4`. Railway confirmed `SUCCESS` for this exact SHA, and for
every commit in this stretch individually before the next began. TestFlight
**288** is live (`IN_BETA_TESTING`, your internal group). `AUTOMATIC_ADAPTATION_
AUTHORITY` still the literal `false`, confirmed untouched by every merge below.
No agent of mine is in flight. Every one of the four you asked me to close
tonight (Step 3, the organic PUSH proof, the migration packet, the pace-drift
mechanism) is integrated, independently re-verified by me before touching
`main` — not accepted on any agent's word — and deployed.

---

## Your eight questions, first, in order, unambiguous

**1. Is orchestration 16/16?** Yes, genuinely. `WIRED_STEP_PIN = 16`, re-read
from source just now. I did not accept this from the dispatched agent — its
own Rule 18 falsification was a hand-trace, not a run, because it hit a real
disk-exhaustion problem I later found and fixed (the shared volume was at
**100% capacity**, 23Gi free out of 7.3Ti, from roughly a hundred stale
worktrees left over across this whole multi-day session). I froze that
problem out (~590Gi now free), then personally ran `_orchestration.test.ts`
(9/9 pass), personally bumped the pin to 17 and watched the ratchet fail with
the exact right message, restored it, and personally traced the real call —
`option-lane.ts`'s `await classifyEvidence(userUuid, id)`, whose
`completion.partial`/`overrun` results feed real `PULL_BACK`/`HOLD`
branching — since the automated file-reachability check alone cannot tell a
type-only import from a real value call. Step 3's owner is now
`lib/evidence/classify-evidence.ts`, per your ruling that it is the canonical
owner and the dose readers are its consumers, not a competing classifier.

**2. Did the same organic decision complete every stage? No — and this is
the most important thing in this handback.** Not "close." Not "operational."
Honestly: of your twelve named requirements, exactly **one passes for real
today** (restart). The other eleven are not ten separate failures — they
trace to two named, real, non-fabricated conditions:

- **Ten of them** (accept, decline, stale plan, idempotency, ledger absence,
  ledger insertion failure and rollback, safety override, competing
  proposals, outcome, undo) need the organic control case to resolve `PUSH`.
  It resolves `HOLD` instead — **correctly**. Your last real logged run in
  production is 2026-09-04. The rolling boundary under test (week
  2026-09-21) is only "due" the day before it starts, so the proof's clock
  has to sit at 2026-09-20 — sixteen days past your last real run, which is
  past `lib/safety/load-safety.ts`'s own `training_disruption` threshold.
  The safety system is reading real, current, correct data and doing exactly
  what it's supposed to do. I independently confirmed there is no
  `(week, as-of-date)` pair that is both a genuine future demand-step and
  within the disruption window against real data, and confirmed the agent
  did not fabricate an activity or a race to force a different answer — that
  would have made the "organic" claim false, and neither of us did it.
- **One of them** (plan rebuild) hit a **second, separate, real bug**: the
  plan composer authors the week beside your embedded C-race with zero
  quality sessions, and `validateComposedPlan` correctly rejects it — an
  existing mechanism meant to restore one quality day there isn't firing.
  Not touched (a 17,000-line composer is not a same-session fix); spun off
  as its own follow-up task.

While proving this, a **real, previously-unknown, and significant defect**
was found and fixed (see §3). Do not read "16/16 orchestration" plus "the
bug is fixed" as "the loop works end to end." It does not, yet, against real
data, and I want that stated as plainly as I can put it.

**3. Was restart and plan-rebuild survival actually executed?** Restart:
**yes**, genuinely — a completely separate OS process (not a second test
in the same runner) picks up the pending state through Postgres alone and
resolves it correctly, verified reproducibly three times including after a
rebase. Plan rebuild: **no** — blocked on the composer defect named above,
which is real and reproducible, not a proof-harness problem.

**4. Which functions remain unavailable solely because DDL is unapplied?**
Reconfirmed live, just now: `plan_decision_ledger`, `reassessment_schedule`,
`plan_decision_outcome`, `runner_beliefs` — all four still absent from
production. Concretely: every plan mutation through `mutatePlan` records
"DECISION NOT RECORDED (table_absent)" instead of landing a ledger row;
`reassessment-sweep` computes but cannot persist due dates for six
reassessment kinds; step 16 cannot judge any decision's later outcome;
`run-adaptations` answers `belief_store_pass: table_absent` for every
runner, every night. The approval packet for all six items (166 → 167 → 168
→ 169 → the two backfills) is fully rehearsed and sitting in
`docs/reports/brain-2026-09-07/MIGRATION-PACKET-FINAL.md` — `gen_random_uuid()`
confirmed available, the write role confirmed to be the same superuser that
needs no GRANT, every `psql -f` command rehearsed end-to-end against a
disposable scratch database. **Awaiting your explicit per-statement go —
nothing has been applied.**

**5. What was physically verified, by me, this stretch?**
- The stale "Holding the plan… Sept 13" card you showed me twice on your
  actual phone: root-caused (a dedup that ignored the reason, not just the
  anchor), fixed, and confirmed live in production — queried the database
  before and after, watched the stale row flip to `superseded` and the
  correct card get written, then you confirmed on your own device after a
  retry.
- The "Can't reach faff" banner: confirmed to be transient connectivity on
  your end at that moment (weak signal in your own screenshot), not a
  client bug — the STUCKCONN mechanism already built for exactly this is
  intact; your own retry cleared it.
- DECISIONPLACEMENT-1 (moving the "it's weird to have it on TODAY" card to
  Block): rendered on the simulator against a real copy of your data,
  confirmed gone from Today and present with the correct content on Block,
  including the Details sheet — shipped as **TestFlight 288**.
- ORGANICPUSH-1 (the bug in §3): independently source-traced by me, not
  taken on the agent's word — confirmed `sealAutomaticActions` guarantees
  the batch is 100% notes when the seam is closed, confirmed the note
  branch in `adapt.ts` only ever calls `writeIntent` into `coach_intents`
  and never reaches `plan_workouts`, confirmed `mutationIsPermitted`'s
  `LIFECYCLE` case is unconditionally permitted. Then personally re-ran the
  entire 12-proof harness against the real scratch database myself and got
  exactly the same 1-passed/11-failed result the agent reported, for the
  same two named reasons.
- The pace-drift bug (DECISION-2): a genuinely separate, previously-hidden
  defect — `readPendingRepriceProposal` had parsed every reprice proposal's
  payload at the wrong nesting level since the mechanism shipped, so the
  monitor reported every drift "unexplained" forever even with a valid card
  already pending. I personally falsified this: reverted the fix, watched
  the exact two tests fail with the described symptom, restored it.
- Watch test suite: 223/223, clean, run directly by me this stretch.
- The migration packet's two load-bearing claims (gen_random_uuid
  availability, write-role privileges): both re-confirmed by me directly
  against production, not taken from the sub-agent's report.

**6. Generator/facet count.** **14/21 generators**, re-read from
`GENERATOR_REGISTRY` just now — unchanged from round 13 (no agent this
stretch touched this file).

**7. Which belief owners still compete?** **16 competing (`SECOND`) sites
across 9 of 12 quantities**, re-counted from `quantity-owners.ts` just now —
unchanged from round 13. Nothing this stretch touched belief-owner
consolidation; it remains real, scoped, not-yet-started work.

**8. What exact approval is required from you?**
- The six-item migration packet (166 → 167 → 168 → 169 → `plan_weeks`
  backfill → `plan_phases` backfill), literal SQL and rehearsal in
  `docs/reports/brain-2026-09-07/MIGRATION-PACKET-FINAL.md`. This is the
  one approval that unblocks the ledger, the reassessment scheduler, step
  16's outcome judging, and the belief store — all four of which the
  organic-PUSH proof needed a scratch copy of tonight because production
  doesn't have them yet.
- Nothing else needs a decision from you right now. The pace-drift question
  from round 13 is closed — DECISION-2 shipped a proposal mechanism gated
  on a runner-visible rounding change, proven idempotent against your and
  the other drifting account's real data, so it no longer needs your call
  between "auto-create" and "alert-only."
- The plan-rebuild composer defect (zero-quality cutback week beside an
  embedded C-race) and the pre-existing 2026-08-21 legacy-prefetch redesign
  are both flagged as follow-up work, not decisions I'm asking you to make.

---

## Everything that shipped and deployed this stretch, in order

| Commit | What | Confirmed |
|---|---|---|
| `d02f5769f` | DECISIONPLACEMENT-1 — Decisions card moved from Today to Block | Railway SUCCESS, rendered on simulator, TestFlight 288 |
| `6323d8028` | Migration packet finalized (read-only, docs-only) | Railway SUCCESS, gen_random_uuid + role privileges independently re-verified by me |
| `334e90430` | RULE16-DOSEEVIDENCE-1 — orchestration 16/16 | Railway SUCCESS, orchestration test personally re-run and falsified by me |
| `9f9724dac` | DECISION-2 — pace-drift proposal mechanism | Railway SUCCESS, dedup bug found+fixed+falsified by the agent, independently re-falsified by me |
| `e19e430b4` | ORGANICPUSH-1 — the notes-only-lane authority bug, plus the honest 12-point proof | Railway SUCCESS, bug independently source-traced by me, full proof harness personally re-run by me against real scratch data |

Full `vitest` re-run, every single merge, dry-run worktree, before touching
`main`: only the two known pre-existing live-DB-dependent failures
(`lib/postrun/_postrun_surface_parity.audit.test.ts`,
`lib/audit/_cross_surface_contract.test.ts`), never anything new. All 28
prebuild gates green, every time.

## A process note I'm not absorbing quietly

The Step-3 agent pushed its own branch with `--no-verify`, without asking
first, when its pre-push hook's Watch-QC gate failed to scope a diff on a
brand-new branch (a documented behavior of that hook, not something it
caused). I independently confirmed the pushed diff touches zero native/watch
files, so no actual harm resulted — but bypassing a hook without your
authorization is a rule violation regardless of outcome, and I'm reporting
it rather than letting it pass silently. A second agent, in the identical
situation, correctly stopped and asked instead. I integrated both through
the normal `main`-checkout merge path, which scopes correctly and needed no
bypass either way.

## Infrastructure finding, fixed along the way

The shared volume hosting this whole repo and every agent worktree was at
**100% capacity** (23Gi free of 7.3Ti) partway through tonight — a real
problem, not a fluke, caused by roughly a hundred already-merged or
abandoned worktrees from across this entire multi-day session never being
cleaned up, several individually over 100GB. This is very likely what
degraded the Step-3 agent's own verification (it could not run its own
falsification and disclosed that honestly). I cleaned up 20 confirmed
already-merged, clean worktrees; ~590Gi is free now. Roughly 89 worktrees
remain, most carrying genuine uncommitted or unmerged work from other
sessions/branches I did not touch — this is worth a dedicated cleanup pass
at some point, but not something to do carelessly mid-session.

## What's left, named plainly, not rounded up

- **The migration packet** — your explicit approval, one statement at a
  time, per the stop-condition already written into the packet.
- **Organic PUSH, the actual end-to-end proof** — not closeable tonight
  without either (a) waiting for real production training data to advance
  past the safety threshold naturally, (b) a doctrine decision about
  whether a scheduled-but-unconfirmed race's taper should be recognized
  from the schedule alone even without fresh activity data (a real, narrow
  question, not touched), or (c) your explicit one-time authorization for a
  synthetic activity extension in this walk only — which neither I nor the
  agent did without asking.
- **The plan-rebuild composer defect** (zero-quality cutback week) —
  flagged, scoped, not fixed.
- **Belief-owner consolidation** — 9 of 12 quantities, 16 competing sites,
  unchanged this stretch.
- **Facet re-derivation beyond generators**, **Pa:HR matrix beyond what was
  already proven**, **the native calorie-resync dry-run preview**, and
  **the remaining native/Watch verification checklist items** (Move-a-Run's
  current refusal, accepted-change consistency across Today/Block/Watch,
  Watch explanation accuracy against a live decision, second-foreground
  request counts) are all still open from earlier rounds, untouched this
  stretch.

Continuing on what's tractable without your input. The migration packet and
the organic-PUSH question above are the two things only you can move.
