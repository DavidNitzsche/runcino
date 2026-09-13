# Archived-plan guard · round 8 handback (final round)

**Branch** `fix/archived-plan-guard-undo-twin-final`
**Base** `9b1656ff1` (on `origin/main@a79c5c86dfe9856bbc3a093649a1663531d8d030`)
**Scope** N9, N7 (corrected), N8. No merge authority exercised.

---

## 1 · N9 · the undo twin still fabricated a false sentence

### Root cause

Round 6 (`STATUSCARRY-1`) gave `POST /api/plan/workout-proposals/[id]/undo` the
**status** half of the refusal carry. Round 7 (`ACCEPTTWIN-1`) then proved on the
sibling *accept* route that the status half alone does not close the hole, and
added `reason`. That second half never reached the undo twin.

The status half cannot cover it, and this is the whole point:

- A **doctrine rejection** is a genuine 409. Carrying the status changes nothing
  for it — 409 before, 409 after.
- The route answered that 409 with `{ ok, error, detail }`. `detail` interleaves
  the boundary's violation strings, which name `plan_workouts` row ids, and
  `APIV5`'s own doc comment forbids printing it near a runner.
- `APIV5.undoProposal` did not even decode the body: it returned `(ok, status)`
  and discarded `data` entirely.
- So `HostsV5.swift:4800`'s `if answered.status == 409` printed a sentence the
  phone wrote itself:

  > "Something else has moved this session since. Taking it back now would write
  > over that change."

**Provably false on that limb.** `movedSinceAccept` runs *before* the boundary
and returns `error: 'stale'` when it finds movement. By construction a
`rejected` from this route is a refusal in which the session did **not** move.
The one sentence the phone printed is the one thing that could not be true — on
the control the whole proposal lane rests on ("approval is not the control
mechanism; reversibility is").

### Fix

Four files, the established pattern, nothing invented:

| File | Change |
|---|---|
| `web-v2/lib/brain/proposal/undo-apply.ts` | `carriedRefusal()` replaces three hand-written field copies; `reason` added to `UndoOutcome`'s refusal branch, carrying `refusalFor`'s wording verbatim |
| `web-v2/app/api/plan/workout-proposals/[id]/undo/route.ts` | emits `reason` beside the existing `detail` + guarded `retryable` spread |
| `native-v2/.../DesignV5/APIV5.swift` | `undoProposal` decodes `V5Refusal` and returns `reason: String?` (optional — Rule 11: two limbs of that route carry no reason) |
| `native-v2/.../ViewsV5/HostsV5.swift` | prints the engine's sentence when present |

The Swift half is **required**, not scope creep: the backend carrying `reason`
into a client that discards the body is the "wired, tested and inert" failure
CLAUDE.md names. The phone's own 409 sentence is kept but is now reachable
**only** by the `stale` limb, which raises its own refusal, carries no `reason`,
and is the case that sentence was always true for. Its wording was corrected
from "something else has moved" to "the session has moved", since that limb also
fires when the session left the active plan entirely.

### Falsifying test

`web-v2/lib/brain/proposal/_undo_twin_reason.test.ts` (10 tests). Forces the
real condition through the **real** `applyUndo` with `mutatePlan` mocked to the
live production refusals (`rejected`, `ledger_unwritten`,
`plan_verification_failed`) and `readLiveRows` returning an **unmoved** row, so
`movedSinceAccept` passes and the boundary is genuinely reached. Reasons are
read out of `refusalFor` at run time, never retyped (Rule 18).

**Falsified against `9b1656ff1`** (undo-apply, undo route and both Swift files
restored from the base commit):

```
Tests  6 failed | 4 passed (10)
```

The 4 that passed are the status assertions round 6 already fixed — which is
precisely why this survived a round. Against the fixed tree: 10/10 pass.

---

## 2 · N7 · the reprice limb · the deferral reasoning was wrong

### Root cause

`POST .../accept` has three limbs. Round 7 fixed the **action** limb. The
**reprice** limb kept:

```ts
const res = await applyReanchorProposal(...);
if (res == null) {
  return NextResponse.json({ ok: false, error: 'apply_refused' }, { status: 409 });
}
```

A 4xx with no `reason` and no `refusal` — the exact shape that sends
`APIV5.answerProposal` into its own 409 branch:

> "This session has changed since the coach proposed it, so the decision no
> longer fits. It will be raised again against the session as it stands."

A repricing is not about a session at all; it is one decision over the whole
block. And "it will be raised again" is a promise the route cannot keep for a
card whose plan no longer exists.

**Why it survived.** A prior round examined this limb and deferred it, believing
`applyReanchorProposal`'s `null` was an *uncharacterised* refusal that would
require inventing coach copy. The 7th reviewer's correction is confirmed: that
was false. The function had **four** distinct `return null` sites, each reasoned
about at its own site, two of them already carrying a written `console.error`
sentence.

### Fix — a return-type split, not new copy

`applyReanchorProposal` now returns `ReanchorApplyOutcome`:

| code | fact | status | retryable | sentence source |
|---|---|---|---|---|
| `stale_card` | the named plan is archived/rebuilt | 409 | false | **`refusalFor`'s existing `no_plan` copy, verbatim** |
| `no_anchor` | the card carries no usable anchor VDOT | 409 | false | one short sentence for a fact already written down |
| `deferred` | the adapter re-priced inside its window | 409 | **true** | renders `deferred_to_adapter_recompute` |
| `not_applied` | the arm ran and wrote nothing | 503 | true | says only what is true of it |

The stale-card case invents nothing at all — a card whose plan was rebuilt *is*
a `no_plan`, and the shared resolver has owned that sentence since
`CALLERHONESTY-1`. A test asserts the sentence is read from the resolver and
that no second hand-written copy of it exists.

**Both** callers updated (Rule 16 — the same applier is reached twice):
`app/api/plan/workout-proposals/[id]/accept/route.ts` (reprice limb) and
`lib/brain/proposal/accept.ts` (`REPRICE_APPLY` / COORDINATED). Both now carry
`reason`, `status` and `retryable`; both throw-catch limbs read `refusalFor`'s
default sentence rather than hardcoding one.

### Honestly stated residue (Rule 11)

`null` from an arm is **still two facts** — the gate found nothing worth moving,
and `mutatePlan` refused. Telling them apart means widening `ReanchorOutcome`
itself, which `reanchorActivePlan` and `forceReanchorActivePlan` also read. So
`not_applied` says only what is true of both ("that repricing was not applied,
so your paces are unchanged") and explicitly does **not** say the coach refused —
which is the fabrication this pass exists to remove. Named in
`repriceApplyOutcome`'s header and in the test's Rule 22 block rather than
papered over.

### Falsifying test

`web-v2/lib/plan/_reprice_reason.test.ts` (9 tests). Drives the **real**
`applyReanchorProposal` with only `pool.query` mocked, forcing each refusal:
empty plan row (stale card), `toVdot` null / 0 / -1 / NaN (no anchor). Also
asserts every producible sentence is free of the word "session", of em dashes
and of exclamation marks.

**Falsified against `9b1656ff1`**:

```
Tests  8 failed | 1 passed (9)
```

Against the fixed tree: 9/9 pass.

---

## 3 · N8 · the LEDGERHONESTY-1 strike-marker check was vacuous

### Root cause

The check was `flat.includes('LEDGERHONESTY-1')` — **file** level. `mutate.ts`
carries that marker at 20+ sites, so the condition was satisfied before the scan
started. The check was therefore vacuous on the very file it was written for,
while its own failure message claimed it would name exactly the case it could
not see.

### Fix

Proximity. For each occurrence of a false claim in the flattened text, a
`LEDGERHONESTY-1` marker must appear within **400 characters**. The window was
measured, not guessed: the six real occurrences sit 95, 133, 168, 168, 189 and
223 characters from their marker. A second `LIVENESS` test asserts the widest
real gap stays below 75% of the window, so the check cannot quietly drift back
into being file-level. Both the window and its rationale are in the file header.

Stated in the header per Rule 22: it **cannot** catch a claim placed
deliberately inside an existing strike note's window; the two "the corrected text
says the true thing" assertions stand behind that case.

### Falsification, in both directions

A bare, unmarked `NO CAP AT ALL` was injected into `mutate.ts` at line 30 —
~20,000 flattened characters from the nearest marker.

| gate | result |
|---|---|
| **old** (file-level, from `9b1656ff1`) | `Tests 56 passed (56)` — **clean. Vacuous, confirmed.** |
| **new** (proximity) | `2 failed` — `states "NO CAP AT ALL" at offset(s) 1480 with no LEDGERHONESTY-1 strike note within 400 characters` |

`mutate.ts` restored byte-identical afterwards (verified by `git diff --stat`).

---

## 4 · Regression suite — exact

Run serially, `vitest run --no-file-parallelism`, in this worktree.

**Environmental caveat, stated rather than glossed.** This worktree has no
`.env.local`, so no `DATABASE_URL` / `DATABASE_URL_RO`. The round-7 baseline
(12336 passed / 8 failed / 146 skipped) was measured with database access; 7 of
those 8 failures are DB-gated and **skip** here rather than fail. The counts are
therefore not comparable to that baseline. `.env.local` was deliberately not
copied in: some `.db.test.ts` suites write, and CLAUDE.md's read-only-by-default
rule plus "data writes need a separate explicit go" make that a decision I do not
own.

So the base commit was re-run **in this same environment** for an
apples-to-apples delta:

| tree | passed | failed | skipped | expected-fail | files |
|---|---|---|---|---|---|
| `9b1656ff1` (base, same env) | 12247 | 1 | 242 | 1 | 618 passed / 1 failed / 51 skipped (670) |
| this branch | **12267** | **1** | **242** | 1 | 620 passed / 1 failed / 51 skipped (672) |

**Delta: +20 passing, 0 new failures.** +20 is exactly the new coverage: 10
(`_undo_twin_reason`) + 9 (`_reprice_reason`) + 1 (the new N8 window-liveness
test).

The 1 failure is identical on both trees and is not a flake:
`lib/plan/_authoring_shadow_compare.audit.test.ts > liveness` fails *by design*
because `DATABASE_URL_RO` is absent — it refuses to report green for a check
that looked at nothing (Rule 18). It is an environment gate, not a defect, and
it is present at the base.

## 5 · tsc / prebuild / native build

| check | result |
|---|---|
| `tsc --noEmit` | exit **0**, no output |
| `npm run prebuild` (31 scripts) | exit **0** |
| `xcodebuild -scheme Faff -destination 'platform=iOS Simulator,id=…'` | **BUILD SUCCEEDED** |

The native build is included because this round changes Swift. Note for whoever
runs it next: passing `-sdk iphonesimulator` on the command line breaks the watch
target's `WatchKit` resolution and produces a misleading failure. Drop `-sdk`
and let the destination decide.

### Rule 13 · what is NOT verified

**The undo refusal is not render-verified.** Reaching it on a real account needs
a genuinely accepted proposal *and* a boundary rejection, which cannot be forced
without DB writes I do not have a go for; and per the standing note, the
simulator build points at `localhost:3111` and serves a 12h cache, so a
screenshot would prove nothing. The Swift half is verified by a full app build,
`swiftc -parse` on both files, and source assertions in the test suite. That is
weaker than a render and is stated as such here rather than claimed as done.

## 6 · Completeness assessment

**My honest read: yes, this chain is complete.**

The accept/undo pair is now symmetric. Every limb of both routes that can carry
a `refusalFor` refusal carries `code`, `reason`, `status` and `retryable`, and
the phone reads `reason` on both. The three fabrication sites this chain has
been chasing — accept action limb (N1), accept reprice limb (N7), undo (N9) —
are closed, and the fourth thing that made them survivable (a strike-marker gate
that could not fail) is closed too.

What I looked for and did **not** find: no other route under `app/api/plan/**`
answers a `mutatePlan` refusal without going through `httpStatusForRefusal`; the
`RETRYABLE_SITES` ratchet in `_accept_twin_status.test.ts` still balances at its
pinned counts.

Three things I did find and deliberately did **not** fix, so they are decisions
rather than omissions:

1. **The undo route's `not_undoable` 422 renders as an outage on the phone.**
   `HostsV5.undo(_:)` sends any non-409, non-2xx to `state = .failed`, which
   draws `OutageBodyV5` ("we could not reach your coach") over an honest,
   runner-readable refusal — the `ACCEPTVOICE-1` defect class, one route over.
   Real, small, and a different finding from this one; folding it in would have
   widened a round that was meant to close.
2. **`not_applied` still collapses two facts** (see §2). Fixing it means widening
   `ReanchorOutcome` for three callers. Named in code.
3. **`retryable` is still not read by the phone at all** —
   `SurfaceStoreV5.v5RefusalSettlement` keys permanence on the presence of a
   `refusal` string. Round 6 already recorded this in
   `_mutation_status_carry.test.ts`'s Rule 22 block; unchanged, and a native-side
   question.

None of those three is the lie this chain was about. **Merge yes.**
