# Stage 5 · the canonical Adaptation Engine — promote or hold

**VERDICT: HOLD — but the blocker has changed, and the previous one is gone.**

The earlier verdict (same day, earlier session) said hold because the engine
could not read enough evidence to ever push. That was true, and it was our
fault, not the runner's. Two engine defects have been found and fixed. The
engine now proposes increases on his real history.

What remains before live authority is no longer a defect. It is a shadow-log
confirmation period on production and one simultaneous change to retire the
legacy writers — and the decision itself is David's, because it is authority
over his training.

---

## RECONCILED (later the same day) · "PROGRESS 14" IS NOT WHAT IT SOUNDS LIKE

The number was challenged and it does not survive contact. This section
corrects everything below it; where they disagree, this one is right.

### What 14 actually counts

**Fourteen PROGRESS *proposals*. ONE applied.**

| | |
|---|---|
| PROGRESS records in the as-run replay | **14** |
| of those, carrying an arbitration suppression note | **13** |
| **proposals that actually moved the belief** | **1** |

| × | Suppressed by |
|---|---|
| 10 | `WEEKLY_VOLUME` · "the threshold evidence supports this change, but this week already contains enough change" |
| 3 | `PLAN_LOAD` · "the evidence is recorded. Changes to the plan are arbitrated at the weekly boundary" |
| 1 | — applied |

The one that applied: **2026-06-22, threshold 7:22 → 7:19/mi, −3 s/mi**, on two
corroborating sessions (06-18 at 7:05/mi, 06-11 at 7:17/mi, both SUBSTANTIAL).

Every later record re-proposes the SAME move from the SAME belief, because the
belief never advanced. Reading the count as fourteen anchor movements is exactly
the misreading it invites.

### What the belief actually did

```
2026-06-22   threshold  7:22 -> 7:19      (the only upward threshold move)
2026-07-20   weekly     43.5 -> 41.3 mi   (DOWN)
2026-08-03   long       12.0 -> 12.1 mi   (up 0.1)
2026-08-17   weekly     41.3 -> 39.2 mi   (DOWN)

seed 2026-06-03  threshold 442s · weekly 43.5 · long 12.0
end  2026-09-02  threshold 439s · weekly 39.2 · long 12.1
```

**Four belief movements in three months. Net threshold change: 3 s/mi.**

### A correction to this document's own claim

The section below says *"the anchor walks 7:22 → 7:16, six seconds a mile"*.
**That never happened.** It reached 7:19 and stopped; every 7:19 → 7:16 proposal
was suppressed. The claim was read off proposals rather than off the belief
trail — the same error as counting 14 movements.

### As-run or counterfactual?

**As-run.** All 14 come from the replay's own walk over the real snapshot. The
counterfactual ladder is a separate instrument and none of it is counted here.

`_upward_bar.test.ts` reports `actualProgress: 4` over the SAME points and
snapshot. Both are as-run; they model different loops — `real-replay` moves the
belief on PROGRESS **and** REGRESS (the engine's arbitrated loop), while
`_upward_bar` applies only upward moves so it can measure the bar without the
downward path moving the target underneath it. Quoting either without saying
which loop it walked is a Rule 16 failure, and this document did that.

### The finding that matters more than the count

Over three months the engine credits **3 s/mi**. His actual production threshold
anchor today is **7:10/mi (430 s)** — nine seconds a mile faster than the replay
ever reached, arrived at through the race-anchored VDOT path, not adaptation.

Different mechanisms, so this is not "the engine is wrong". But it is the number
that decides whether promotion helps. **Rule 21's asymmetry has not gone away —
it has moved**, from "the upward path cannot fire" to "the upward path fires and
is then arbitrated away almost every time."

That is an ARBITRATION question, not a readability one. The readability work did
what it claimed: the evidence is visible now. What happens to it next is a
different mechanism with its own doctrine.

### Required proofs

| Category | Proof | File |
|---|---|---|
| no run at all | "a runner we cannot see gets normal + low confidence, never marginal or poor" | `_adaptation_model.test.ts` |
| | "and SAYS it could not see · the verdict names itself a refusal, not a read" | same |
| no HR data | "not penalised for the missing dimension"; "unknown dimensions carry zero weight" | same |
| MISSED | excluded from the score entirely | `adaptation-model.ts:446` |
| telemetry-compromised | scores **exactly** like the miss it replaced (RULE8CLOSE-1) | `_adaptation_model.test.ts` |
| flatlined HR | a work phase whose samples are all identical is refused | `_hr_trace.test.ts` |
| unreadable ≠ zero | "an unreadable week is not a week at zero"; "key sessions that established nothing are missing evidence, not a pass"; "unreadable thirds are a refusal that NAMES the cause" | `_lever_contracts.test.ts` |

None can satisfy an upgrade either: `GRADES_THAT_COUNT_AS_EVIDENCE` is
`{FULL, SUBSTANTIAL}` and every category lands outside it or is excluded before
grading. **625 tests / 25 files in `lib/adaptation/`, all passing.**

**No legacy writer can mutate alongside the engine.** `_promotion_contract.test.ts`:
the shadow claim is true (writes nothing, nothing calls it on a live path); the
ONE SEAM `lib/plan/adaptation-authority.ts` exists and is default-OFF; every
legacy mutator still exists and is still live. Two engines cannot both write
today because one writes nothing — and the contract fails the moment that
changes without the legacy paths being retired in the same commit.

### THE ARBITRATION BLOCKER, LOCATED PRECISELY — and it is a doctrine choice

Traced to two lines. `lib/adaptation/canonical/arbitration.ts`:

```ts
const increasesDemand = s.demandShare > 0;                       // ANY increase
if (loadLeverHeld && increasesDemand && s.material && ...) suppress
```

and `contract-constants.ts`:

```ts
export const MATERIAL_SHARE_OF_ORDINARY_STEP = 0.5;   //  threshold: half of 3 s/mi = 1.5
```

The ordinary threshold step **is** 3 s/mi, and the engine only ever proposes 3
or the larger 5. So `s.material` is **true for every threshold proposal that can
exist**, and `demandShare > 0` is true for any increase at all.

`arbitration.ts`'s rule 2 says, in its own words:

> "It does NOT automatically suppress a threshold-pace proposal. The word doing
> the work is AUTOMATICALLY: a small pace correction that preserves the intended
> stimulus may proceed, and only a MATERIAL demand increase is caught by rule 1.
> … A suppression rule with no exception is a freeze."

**That exception is effectively inert.** Corrected from a first draft that said
"unreachable", which was too strong: `THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI`
is 1, below the 1.5 bar, so a 1 s/mi proposal *would* proceed. The accurate
statement is narrower and still damning — **the window in which the exception
can fire is [1, 1.5) s/mi, narrower than a single ordinary step**, and across
the owner's entire real history all fourteen proposals were the ordinary 3.
Reachable in principle, reached zero times in practice. Wired, tested and inert
— this codebase's signature failure, in the file that names the failure. And it is
exactly what that file's Rule 22 note says its own gate cannot catch: *"It
cannot fail on the materiality threshold being set wrong. Every test here
constructs proposals that are clearly above or clearly below the bar."*

Measured consequence: **10 of 13 suppressed threshold proposals** cite
`WEEKLY_VOLUME`.

#### Why I did NOT just fix it

The obvious fix — make rule 1 ask about DEMAND materiality (a threshold step
moves weekly total "well under one percent", by the constants file's own
admission) — is blocked by a genuine conflict inside the contract. The same
`contract-constants.ts` comment records that demand-share materiality was tried
first and rejected, because it made the contract's own acceptance sentence
unreachable:

> "Your threshold evidence supports a faster threshold pace, but this week
> already contains enough total demand, so the change is deferred."

So the contract contains **two sentences that cannot both be satisfiable**:

| Reading | Acceptance sentence | Rule 2's exception |
|---|---|---|
| **A — today** · materiality in own units | reachable | **inert** |
| **B** · materiality as a share of demand | **unreachable** | reachable |

Each makes one sentence dead. Choosing between them changes what David is
actually told and how often his paces move, so it is a coaching decision, not an
engineering one, and I have not made it.

#### My recommendation, if asked

**Neither A nor B — reading C.** Rule 1's question is *"is this week already at
its demand ceiling"*, not *"is this proposal big"*. Suppress a pace change when
the week's demand is at or over its own bound, whatever the proposal's size; let
it through when the week has headroom, whatever the proposal's size. That keeps
the acceptance sentence sayable (it is said on a full week, which is when it is
true) AND keeps rule 2 live (a pace correction proceeds on a week with room).
The two sentences stop competing because they stop measuring the same thing.

Cost: it needs a defensible "week is at its ceiling" bound, which the volume
lever already owns, so it reuses an existing doctrine number rather than
inventing one.

**This is the single highest-value open item in the engine.** Everything else in
the upward path now works.

### VERDICT: HOLD — same word, better-understood reason

**Removed as a blocker:** evidence readability. Genuinely fixed (34/40 → 14/40).

**Remaining, in order:**

1. **Arbitration, not readability.** One applied move per quarter against
   evidence supporting three times that. `WEEKLY_VOLUME` suppressed 10 of 13
   threshold proposals with "this week already contains enough change" — a
   threshold anchor and a volume target are different quantities and it is not
   obvious one should crowd out the other. **Next engineering task; needs no
   decision from David.**
2. A live shadow period — calendar time, not code.
3. Legacy retirement in the same change as promotion.
4. David's decision on live authority.

**Live automatic mutation remains disabled.**

---

## What changed · PROGRESS 0 → 14

| | Before | After |
|---|---|---|
| PROGRESS | **0** | **14** |
| HOLD | 63 | 64 |
| REGRESS | 4 | **4 (unchanged)** |
| REFUSE | 53 | 38 |

REGRESS unchanged at 4 is the load-bearing number. **Nothing about the
downward path moved.** No bar was lowered, no threshold widened, no tolerance
stretched. What changed is that correctly-executed sessions can now be seen.

### Readable counts, per gate, before and after

| Lever / gate | Blocked before | Blocked after |
|---|---|---|
| `THRESHOLD_PACE / T2-direction` | **34 of 40 (85%)** | **14 of 40 (35%)** |
| `LONG_RUN / L4-durability-readable` | 26 of 40 | 26 of 40 |
| `LONG_RUN / L2-admissible` | 6 of 40 | 6 of 40 |
| `WEEKLY_VOLUME / V5-something-to-move` | 8 of 40 | 8 of 40 |

And the bars themselves:

| Gate | Ever met · before | Ever met · after |
|---|---|---|
| `T1-corroboration` (≥2 sessions) | YES (2) | YES (**4**) |
| `T2-direction` (≥2 faster) | **NO** — closest 1 | **YES** — closest 2 |
| `T3-meaningful-step` (≥1 s/mi) | YES | YES (32) |
| `V2-week-completion` (≥0.95) | **NO** — 0.9023 | **NO** — 0.9023 |

`V2-week-completion` is untouched and still unmet. It is an honest bar: his
worst week in the best three-week run completed 90.2% of prescribed, and the
lever asks for 95%. That is a thing to go and earn.

---

## The two defects

### HRCEILING-1 · threshold work graded against an easy-day HR cap

Every threshold session in June and July was graded against an HR ceiling of
**149 bpm**. His LTHR is **168**.

```
2026-06-11 tempo   DIFFERENT · mean work HR 162 against ceiling 149
2026-06-18 tempo   DIFFERENT · mean work HR 163 against ceiling 149
2026-06-23 tempo   DIFFERENT · mean work HR 160 against ceiling 149
2026-06-25 tempo   DIFFERENT · mean work HR 155 against ceiling 149
2026-07-07 tempo   PARTIAL   · mean work HR 167 against ceiling 149
2026-07-09 tempo   PARTIAL   · mean work HR 163 against ceiling 149
2026-07-14 tempo   PARTIAL   · mean work HR 156 against ceiling 149
2026-07-21 tempo   PARTIAL   · mean work HR 159 against ceiling 149
```

149 is the *easy-day aerobic cap*. Threshold work is run at or just under
LTHR, so 155–167 against 168 is the session doing exactly what it was for. The
engine read every one as "completed at clearly excessive effort" —
`gradeStimulus`'s DIFFERENT branch — and DIFFERENT and PARTIAL are both outside
`GRADES_THAT_COUNT_AS_EVIDENCE`.

**The rule was not invented for this fix.** ZONEBAND-1 (2026-09-03) had already
ruled that "a quality HR target belongs to threshold/interval work, never to an
easy or long block", and fixed the AUTHORING side. Verified on the live plan:
`intervals`, `tempo`, `threshold`, `race`, `race_week_tuneup` all carry
`hr_cap_bpm = null`; `easy`, `long`, `shakeout` carry 151. ZONEBAND-1 fixed
what the runner READS. Nothing reached what the engine GRADES.

Fixed by one shared resolver, `lib/adaptation/canonical/work-hr-ceiling.ts`,
called by BOTH the production shadow builder and the replay harness — so the
replay can never be more or less permissive than the engine it replays.

### HRCHANNEL-1 · and the one that would have bitten every future session

`gradeStimulus`'s "HR is not a channel for this session" escape was gated on
`!hrReliable` — a dead strap. It did not cover an **absent ceiling**.

That is the state of *every quality session authored since ZONEBAND-1*. So a
perfectly executed threshold session — pace on target, work complete, no late
collapse, clean HR trace — fell past every branch onto the final `DIFFERENT`
and could never corroborate a faster anchor.

**A correct fix to the authoring side had silently made every future quality
session unable to serve as evidence, and nothing connected the two.** Rule 11
exactly: "don't know" is not "failed". An absent ceiling is a missing channel,
not a breached one, and the doctrine for a missing channel was already written
two branches above — it costs the larger 5 s/mi step and nothing else.

---

## What training behaviour earns progress, and how much

Stated plainly, because Rule 21 asks for exactly this:

> **Two threshold sessions on separate days inside 28 days**, each completed at
> or near its prescribed work, each faster than the current anchor, and
> outnumbering any slower sessions two to one. That buys the **ordinary step of
> 3 s/mi**.

Every one of the 14 proposals is that ordinary step. **Not one reaches the
larger 5 s/mi step**, which requires FULL grades — stronger and more numerous
evidence.

The magnitude is the reassurance. Across two months of real training the anchor
walks **7:22 → 7:16 — six seconds a mile**, held there by the
one-step-per-cutback-cycle contract. His actual production anchor today is
**7:10/mi**, so the replayed engine stays *behind* where his fitness really
went rather than running ahead of it.

Sample proposals, verbatim:

```
2026-06-19  THRESHOLD_PACE  -3 s/mi  7:22 → 7:19 · 2 sessions on separate days ran faster than the anchor
2026-06-24  THRESHOLD_PACE  -3 s/mi  7:19 → 7:16 · 3 sessions on separate days ran faster than the anchor
2026-06-26  THRESHOLD_PACE  -3 s/mi  7:19 → 7:16 · 4 sessions on separate days ran faster than the anchor
```

---

## Falsification

Both fixes were reverted independently, against the real snapshot:

| Reverted | Result |
|---|---|
| HRCHANNEL-1 alone | PROGRESS **14 → 0** |
| HRCEILING-1 alone | PROGRESS **14 → 0** |

Each is load-bearing; neither is redundant.

The pinned assertions did their job and had to be argued down rather than
edited quietly. `_upward_bar.test.ts` guard 1 failed with *"expected 4 to be
0"*; `real-replay.test.ts`'s distribution pin failed; and the block titled
**"THE FINDING · the engine never proposes an increase on his real data"** —
which said of itself *"the day a change makes it push, THIS TEST FAILS and the
person who made it has to come and delete this block"* — was deleted by the
person who made it, and replaced with the new observation and its reasoning.

A dedicated gate, `lib/adaptation/canonical/_hr_ceiling.test.ts`, now holds
both rules independently of the replay, including the two loopholes the fix
must not open: a session run over a REAL ceiling still grades DIFFERENT, and an
incomplete session still grades PARTIAL.

---

## What remains before promotion

1. **A shadow-log confirmation period on production, with the fixed grader.**
   The nightly shadow path now writes decisions that can actually move. Those
   need to accumulate and be compared against what the legacy writers do, on
   live data, for long enough to be evidence. This is the only remaining
   *technical* precondition and it takes calendar time, not code.

2. **Retire the three legacy mutators IN THE SAME CHANGE.**
   `_promotion_contract.test.ts` names them and enforces the simultaneity:

   - `lib/plan/adapt.ts` — reschedules, downgrades and drops sessions
   - `lib/plan/adaptive-ramp.ts` — the volume bump
   - `app/api/cron/plan-drift/route.ts` — fires `fireAutoRebuild`

   **They are deliberately NOT retired here.** Retiring them while the canonical
   engine is still shadow-only would leave the runner with no adaptation at all
   — a regression wearing a fix's clothes. The contract's own rule is that
   retirement and promotion are one change, and promotion is not authorised.

3. **David's decision.** Promotion is live authority over his training. That is
   a doctrine call, not an engineering one, and this session stops there.

**Live automatic mutation remains disabled. Nothing in this work enabled it.**
The production write barrier was exercised during this session and refused a
shadow-log INSERT against production, reporting `posture: "skipped"` with its
reason — Rule 11 in the persistence layer, under a real attempt.

---

## The four required outcomes

| Outcome | Demonstrated on real history |
|---|---|
| progress | **YES — 14, on his own season, each corroborated, each the ordinary step** |
| hold | YES — 64, with named reasons |
| regress | YES — 4, unchanged by this work |
| refuse | YES — 38, and refusals still distinguish "unreadable" from "not earned" |

A suite containing only hold/refuse cases would fail this stage. It no longer
does, and the pass is on the runner's real training rather than on a
counterfactual rung of a ladder.
