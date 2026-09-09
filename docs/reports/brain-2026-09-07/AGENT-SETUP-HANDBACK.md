# Agent setup handback — for external review

Scope of this document: the orchestration architecture only — who is doing
what, under what contract, and why. It does not restate the technical
findings (those are in `HANDBACK-ROUND3-FINAL.md` and the round-4 handback
to follow); it documents the process that produced and is still producing
them.

---

## 1 · My role

I am the orchestrating session — the integration owner, not a fourth
implementer. Concretely, that means:

- I personally do the work that requires continuous judgment across the
  whole session and cannot be handed to a fresh-context agent without
  losing that judgment: tracing a decision record through a real
  production system, root-causing a defect where the first hypothesis
  turns out wrong, verifying a deployment's exact provenance, writing the
  checkpoint document a human will act on.
- I delegate bounded, independently-specifiable work — a defect with a
  clear description, a clear file area, and a clear proof requirement — to
  implementer agents.
- I designed and now enforce the review contract every delegated fix runs
  through (§3 below), which did not start this rigorous — it was tightened
  mid-session on explicit instruction, and that instruction is now standing
  policy for the rest of this work, not a one-time request.
- I read every diff myself before treating a delegated fix as real. A
  subagent's own summary is not evidence; the commit is. This project's own
  standing rule (Rule 13, verify by rendering it yourself) applies to
  subagent output exactly as it applies to my own claims.
- I track cross-agent file overlap and specify merge order before anything
  lands on top of anything else, since multiple agents run in parallel
  worktrees against a shared codebase.
- I am the one who commits, pushes, and confirms deployment for my own
  direct work, and I hold delegated work to the same bar before it counts
  as shipped.

## 2 · Why delegation at all, and why not more of it

Four fixes this round were bounded enough — one defect, one clear file
area, a stated proof requirement — that a fresh agent with no other context
could execute and verify them without needing the rest of this session's
history. Three investigations were not: they required carrying forward
findings from earlier steps, revising a hypothesis after it turned out
wrong, and making a judgment call about doctrine intent that a fresh agent
would have had to re-derive from scratch or take on faith. Those three I did
myself.

## 3 · The verification contract

This is the load-bearing part of the setup, and it is stricter than my
first instinct produced. My original proposal was "I'll personally review
the diff before accepting it." The standing instruction that replaced it:

**States, tracked per fix, none of them skippable:**

```
implemented → independently reviewed → integrated → regression-tested → physically verified → TestFlight-ready
```

**The implementer's contract.** A fresh agent, given: the defect as
originally reported (with real evidence, not a paraphrase), the doctrine or
acceptance criteria that bound the fix, and an explicit list of what proof
it must produce before calling itself done (real data, not a fixture; a
falsified before/after where applicable; the relevant test/gate suite run
clean; a build that compiles). It works in an isolated git worktree so
parallel agents cannot step on each other's uncommitted state.

**The reviewer's contract — a separate agent, not the implementer marking
its own work:**

1. Receives the *original issue*, the doctrine/acceptance criteria, the
   repository and the actual diff (a commit hash, not prose) — explicitly
   **not** the implementer's own report or summary.
2. Independently inspects the affected code paths, runs the relevant tests
   itself, and attempts at least one *new* falsification case the
   implementer's own proof did not cover.
3. Renders a verdict in a fixed structure — **PASS / PASS WITH CONDITIONS /
   FAIL** — covering every acceptance criterion individually (met / not
   met / partial, with the reviewer's *own* evidence), evidence it
   personally reproduced, any claim it could not independently confirm,
   regression risks its inspection surfaced, and exactly what would need to
   change for anything less than a clean PASS.
4. Only after that verdict exists does it read the implementer's own report,
   to reconcile — so its independent conclusion cannot be anchored on the
   implementer's framing.

**What a verdict means.** PASS marks a fix "individually reviewed," not
"done" — it still owes integration testing and physical verification below.
PASS WITH CONDITIONS is not accepted as-is: it goes back to a follow-up
implementer agent, addressing the reviewer's named conditions specifically,
before the fix is treated as reviewed-clean. This has already happened once
this round (§5).

**Before any merge**, I report which worktrees touch overlapping files and
in what order they should land, rather than merging in whatever order
agents happen to finish.

**After merging, still owed** (not yet run this round, pending every fix
reaching reviewed-clean first): an integration gate against the *combined*
tree — full suites, both builds, cross-feature/shared-state checks, render
checks — and physical-device verification, before anything is called
TestFlight-ready.

## 4 · Roles, concretely, this round

| Role | Who | Gets |
|---|---|---|
| Implementer | fresh agent, isolated worktree | the defect, real evidence of it, doctrine bounds, required proof shape |
| Reviewer | a *different* fresh agent, its own isolated worktree | the issue + doctrine + criteria + diff — not the implementer's prose |
| Follow-up implementer | fresh agent (or the original, resumed) | the reviewer's exact named conditions, nothing softened |
| Orchestrator (me) | — | everything; owns sequencing, overlap, merge order, and final acceptance |

No agent reviews its own work. No reviewer's verdict is accepted from
having read the implementer's account first.

## 5 · What this has already caught

Concrete evidence the contract is doing real work, not just adding
process: an implementer's watch/today single-flight fix was independently
confirmed to actually work — race-safe under 200 trials of concurrent
callers — and the *same* review still returned **PASS WITH CONDITIONS**,
because it found the fix duplicates an existing, already-tested
single-flight mechanism elsewhere in the codebase (a real violation of this
project's "one owner per question" rule), ships with no test reaching the
new code at all, and cites a component in its own comment that does not
exist on this platform. All three were true *and* the underlying fix
worked — which is exactly the gap a self-review would not have caught. A
follow-up agent is now addressing those specific findings before the fix
counts as reviewed-clean.

## 6 · Honest limits of this setup

- Reviewers run on the same underlying model as implementers; independence
  here means separate context and an enforced ordering (own investigation
  before seeing the implementer's account), not a different reasoning
  system. It catches a different class of error than self-report, not
  every class.
- Simulator/device resources have been shared across concurrently-running
  agents at least once this round, causing transient cross-contamination
  that was caught and re-verified rather than missed — but it is a real
  operational risk of running several device-touching agents in parallel
  that this setup has not fully engineered around yet.
- The integration gate and physical-device verification stage (state 3–5
  above) have not run yet this round. Everything currently reported is, at
  best, "individually reviewed" — the combined-tree and on-device
  guarantees are still owed before anything ships.
