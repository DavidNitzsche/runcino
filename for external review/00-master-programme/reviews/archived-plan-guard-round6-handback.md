# Archived-plan mutation guard · round 6 handback

**Branch** `fix/archived-plan-guard-status-and-ledger-honesty`
**Commit** `473b61cdc` (pushed)
**Base** `efd08b218` (chain `f0b83e13f` → `55fbe8bac` → `8ff90216f`, off `origin/main@a79c5c86d`)
**Date** 2026-09-13

Round 5's verdict was "CONFIRMED WITH NOTES, one short follow-up commit away."
This is that commit. Both moderate findings are fixed and falsified; F3 is
deferred with a stated reason; F4 and F5 are confirmed and characterised.

---

## F1 · STATUSCARRY-1 — the refusal's status did not survive the last hop

### Root cause, confirmed

`refusalFor()` in `web-v2/lib/plan/mutation-refusal.ts` resolves
`{ code, reason, violations, status, retryable }`. Nine callers:

| Caller | Read `status`? |
|---|---|
| `app/api/coach/proposal/route.ts` | yes |
| `app/api/plan/restore/route.ts` | yes |
| `app/api/plan/workout/route.ts` | yes |
| `app/api/plan/workout/[id]/accept-standing/route.ts` | yes |
| `app/api/today/reschedule/route.ts` | yes |
| `lib/plan/reschedule.ts` (2 sites) | **no** |
| `lib/plan/replan-scenarios.ts` | **no** |
| `lib/brain/proposal/accept.ts` | **no** |
| `lib/brain/proposal/undo-apply.ts` | **no** |

The four returning callers returned `{ code, reason, violations }` and dropped
`status`/`retryable`. Six routes then re-derived the status from a hand-written
`STATUS` record. Verified by parsing each map out of its own source: **none of
the three `STATUS` maps contains any of the four codes this work introduced**
(12 misses across 3 maps). Three fell through to `?? 400`
(`/api/plan/change`, `/api/plan/reschedule`, `/api/plan/move`) and two to `409`
(`/api/plan/replan`, `/api/plan/workout-proposals/[id]/undo`).

`lib/brain/orchestration/move-orchestrator.ts` is a fifth, forwarding hop
between `applyReschedule`/`undoReschedule` and `/api/plan/move`; it forwarded
`code`/`reason`/`violations` and dropped the other two as well.

**Live today.** Migration 166 is not applied to production, so
`landDecisionInTransaction` refuses every structural mutation.
`applyReschedule` used to return `'rejected'` (mapped to 409); it now returns
`plan_verification_failed`, which no map knows, so Move-a-Run answers **400**
on the production app — the strongest "your request is at fault, do not retry"
signal — over a refusal `refusalFor` itself marks `retryable: true`.

### The fix

Two new exports in `mutation-refusal.ts`, the file whose own header already
warns against exactly this duplication:

- `carriedRefusal(refusal, code, reason?)` builds the lib-level return shape.
  `status` and `retryable` are **required** on its return type, so a caller
  cannot silently drop them again. The `code` parameter exists because three
  callers publish `rejected` where the resolver says `plan_invariant_violation`
  — vocabulary, not policy; the status is carried verbatim either way.
- `httpStatusForRefusal(out, routeLocal, fallback)` spends the carried status
  when present and consults the route's map only for codes the resolver never
  produces (`bad_request`, `sealed`, `immovable`, `not_found`,
  `authority_refused`, `no_record_table`). The maps are demoted to fallbacks
  and documented as such in each route's header, rather than deleted — they
  still answer a real, different question.

Files changed: `mutation-refusal.ts`, `reschedule.ts` (2 sites + both outcome
types), `replan-scenarios.ts`, `brain/proposal/accept.ts`,
`brain/proposal/undo-apply.ts`, `brain/orchestration/move-orchestrator.ts`
(both limbs), and the six routes.

### One deliberate behaviour change beyond the reported finding

A `no_plan` **raised by `mutatePlan`** now answers **409** rather than 404 on
change / reschedule / move. The five routes that already call `refusalFor`
directly have answered 409 for it all along, so the three maps' 404 was the
second answer to one question (Rule 16). Each module's *own* "there is no
active plan" early return (`reschedule.ts:2001`, `replan-scenarios.ts:1481`
and `:1797`) carries no status and still reads the map's 404, unchanged.

Flagging it explicitly rather than burying it: this is a wire-visible change
the round-5 review did not ask for. The full set of moves is asserted by name
in the test, not counted, precisely so a change like this cannot slide past as
a number.

| code | before | after |
|---|---|---|
| `plan_verification_failed` | 400 | 503 |
| `ledger_unrecorded` | 400 | 503 |
| `mutation_failed` | 400 | 503 |
| `duplicate` | 400 | 409 |
| `no_plan` (from `mutatePlan`) | 404 | 409 |

### Falsification

`web-v2/lib/plan/_mutation_status_carry.test.ts`, 34 tests. Every route
`STATUS` map is **parsed out of the live source at run time** (Rule 18 — a
check that hardcodes both sides only proves it agrees with itself), and a
liveness assertion fails if the parser reads an empty map.

Falsified against the fixed tree by breaking each half on purpose:

1. Restored `{ status: STATUS[out.code] ?? 400 }` in `app/api/plan/move/route.ts`
   → `app/api/plan/move/route.ts · no longer keys an HTTP status off a raw map lookup` **FAILED**. Restored.
2. Removed `carriedRefusal` from **one** of `reschedule.ts`'s two call sites →
   the first version of the caller scan (file-level) **passed**, which is the
   exact half-fix shape this round is correcting. The scan was rewritten to run
   **per `refusalFor` call site**; it then **FAILED** with
   `lib/plan/reschedule.ts at char 109196: this refusalFor result is returned without status/retryable`. Restored.

That second falsification found and fixed a real weakness in my own gate before
it shipped, which is the point of Rule 18.

---

## F2 · LEDGERHONESTY-1 — a false claim written into a permanent record

### Root cause, confirmed by tracing the validator

Round 5 justified refusing on a failed `loadMutationContext` read by claiming a
null `trainingDaysPerWeek` "disables a real safety gate" (a frequency cap).

**There is no frequency cap in `validate.ts`.** `ctx.trainingDaysPerWeek` has
exactly ONE consumer in that file, `validate.ts:932`:

```ts
if (ctx.trainingDaysPerWeek != null && ctx.trainingDaysPerWeek <= 1) continue;
```

It **SKIPS** §5's quality-coverage check for a one-day-a-week runner. The
field's own doc comment at `validate.ts:294-297` says so in as many words. A
null therefore means the skip does **not** fire — the validator gets
**STRICTER**, the exact opposite of the claim. (The "frequency cap" that does
exist is a composer-side invariant in `generate.ts`, asserted by
`_audit_placement.test.ts` inv9; it is not a validator check and does not read
this context.)

Secondary claim, also false: "26.2 is the loosest distance cap." `longRunCapMi`
reads 5K 14 / 10K 17 / HM 14–22 / **marathon 25** / **ultra 32**. The 26.2
fallback is looser than every shorter row and **tighter** than ultra.

For completeness, the parts that ARE true and are kept: `raceDistanceMi`
falling back to 26.2 does loosen §1 for every non-ultra runner, and
`level: null` loosens §1's HM cap for a beginner (20 mi where `'beginner'`
reads 14). `level: null` does **not** loosen §3 —
`GENERAL_RAMP_CEILING[null ?? 'intermediate']` is 1.15 against a beginner's
1.20.

### Where the false sentence had reached

Seven sites in the working tree, six added by round 5 and one pre-existing:

| Site | Reach |
|---|---|
| `mutate.ts` `MutationContextReadFailure` header | comment |
| `mutate.ts` `loadMutationContext` header | comment |
| `mutate.ts` `PlanVerificationFailure` doc bullet | comment |
| `mutate.ts` `PLAN_VERIFICATION_REASON['mutation-context']` | **`plan_mutation_rejections.violations` — persisted** |
| `mutate.ts` `land(...)` `mutation-context` explanation | **`plan_decision_ledger.explanation` — persisted** |
| `mutate.ts` step-4 refuse comment | comment |
| `mutate.ts` `RUNFREQ-OWNER-1` comment (2026-09-07, pre-existing) | comment |
| `_mutation_read_honesty.db.test.ts:348` | assertion message |
| `mutate.ts` `raceDistanceMi` return comment ("most PERMISSIVE") | comment |

All corrected. The two persisted strings now state only what was established:
the read failed, so the doctrine check could only have run against substituted
values never established for this runner, and it was not run.

### The decision is unchanged

Refusing on a failed context read is still correct and still lands. Rule 11
carries it on its own — "the read failed" is not "the value is absent" — and
the overstated safety argument was never needed. Only the reason changes,
because a decision defended on a false premise is one nobody can check.

### Falsification

Three assertions in `_mutation_status_carry.test.ts`, all reading the real
source at run time:

1. **The direction, falsified by RUNNING the validator.** A one-week
   QUALITY-phase plan with no quality day is validated twice.
   `trainingDaysPerWeek: 1` → no §5 violation (the skip fires).
   `trainingDaysPerWeek: null` → §5 violation raised. That is the claim
   inverted, demonstrated rather than argued.
   *Falsified:* changing `validate.ts:932` to `== null || <= 1` — the world in
   which the round-5 claim would be true — made this test **FAIL**. Restored.
2. **One consumer, and it is a skip.** Counts `ctx.trainingDaysPerWeek`
   occurrences in `validate.ts` and asserts exactly 1, containing `continue`
   and `<= 1`. It fails loudly if a second consumer ever appears, with a
   message telling the next reader to re-check whether the explanations may
   finally name a cap.
3. **Ultra is looser.** Parses `longRunCapMi`'s rows out of `validate.ts` and
   asserts `ultra > m > 10k`, with a liveness check that the parser read a real
   table.
   *Falsified:* restoring `STRICTLY MORE PERMISSIVE` into
   `PLAN_VERIFICATION_REASON` made two tests **FAIL**. Restored.

The persisted-string assertions check both directions (Rule 18: an
absence-only assertion is satisfied by garbage) — the false claims are absent
**and** the true sentences are present.

---

## F3 · `derivedTrainingDaysPerWeek` outside the `readFailed` mechanism — DEFERRED

**Confirmed real.** `generate.ts:2400`'s `derivedTrainingDaysPerWeek` collapses
three facts into one `null` at lines 2415/2417: the `runs` read failed
(`rowOrNull` → `null`), no row came back (`undefined`), and a genuine rank-3 of
zero. `loadMutationContext` calls it and has no way to set `readFailed`. That
is a Rule 11 collapse.

**Deferred, and why.** It is not the small obviously-correct change the review
hoped for:

- It needs a new reading shape exported from `generate.ts`, whose existing
  export is also on the authoring path (`generate.ts:17723`).
- `MutationContextReadFailure` gains a third field, which `readFailed`'s
  spread-so-the-key-is-absent contract and the db-suite assertions both see.
- Most importantly it forces a **posture decision** that the F2 trace above
  materially changes. `if (ctx.readFailed) return refuseUnverifiable(...)`
  refuses. But a null `trainingDaysPerWeek` makes §5 *stricter*, so the
  substituted value here is the safe one and refusing on it costs a runner a
  structural mutation over a transient `runs` read. Refuse-vs-proceed is a
  judgment call, not an obvious fix, and picking it silently inside a
  follow-up commit is how the round-5 overstatement happened.

A factual comment naming the gap and the posture question is at the call site
(`mutate.ts`, in `loadMutationContext`). It asserts no invariant — per Rule 20
a comment is documentation, not enforcement — it states a known limitation and
names what the next person has to decide first.

## F4 · the phone and `retryable` — CONFIRMED, native-side, out of scope

Read `native-v2/Faff/Faff/ViewsV5/SurfaceStoreV5.swift:707`
(`v5RefusalSettlement`). The phone decides "permanent refusal, no Retry" on the
**presence of a `refusal` string key in a 4xx body**. It never reads
`retryable`, and `refusalBody()` emits `{ ok, error, reason, retryable,
violations }` — no `refusal` key. So:

- A `plan_invariant_violation` (409, `retryable: false`) reaches the phone as
  `.didNotLand` and **renders a Retry**, which is the mismatch the review
  named. Confirmed.
- The direction is the safe one (over-offering Retry, not suppressing it), and
  the phone's own header says the opt-in is deliberate: *"a route that has not
  learned this contract cannot accidentally suppress a Retry."*

**Not fixed here.** Two routes to close it — teach the phone to read
`retryable`, or have `refusalBody` emit `refusal` when `retryable === false` —
and both are wire-contract decisions about when the phone stops offering a
Retry. The first is a native change and out of scope for a web-only branch; the
second is a web change but is a product call, not a defect fix, and the review
did not ask for it. Named in `_mutation_status_carry.test.ts`'s Rule 22 header
as something that file structurally cannot fail on.

## F5 · `lineage-unknown:` permanence — CONFIRMED as an accepted limitation

`lib/brain/ledger/decision-ledger.ts:295-313` already states the permanence
plainly in its own header: *"nothing afterwards can tell the two cases apart to
repair it"*, and the marker is deliberately `NOT NULL`, prefixed and greppable
*"so a reader looking for 'did this rebuild break the chain' can find these."*
That is an accurately described, knowingly accepted limitation with a
deliberate discovery affordance, not an omission. No design work attempted, as
instructed.

---

## Verification

All runs in this worktree, `--no-file-parallelism`, per the convention this
review chain established. `node_modules` symlinked from the root checkout.

**Regression suite — `lib/plan lib/brain lib/audit`, before/after on this exact base:**

| | Test files | Tests | Failed |
|---|---|---|---|
| BEFORE (`efd08b218`, clean detached worktree) | 251 passed, 1 failed, 20 skipped (272) | 4135 passed, 1 failed, 113 skipped (4249) | 1 |
| AFTER (`473b61cdc`) | 252 passed, 1 failed, 20 skipped (273) | 4169 passed, 1 failed, 113 skipped (4283) | 1 |

Delta: **+1 file, +34 tests**, exactly the new falsifier. No test changed state.

The single failure is identical before and after and is **environmental**:
`lib/plan/_authoring_shadow_compare.audit.test.ts` deliberately fails its own
liveness assertion when `DATABASE_URL_RO` is unset and `ALLOW_AUDIT_SKIP=1` is
not given — a Rule 18 "do not report green for a check that looked at nothing"
guard, working as designed. Not caused by, and not affected by, this change.

**One failure I did cause, and fixed:** the first full run had **two** failures.
`lib/audit/_decision_ledger_gate.test.ts` GUARD 1 flagged
`return fail(outcome, [reason], [], planIdForRow)` as bypassing the ledger —
my 6-line correction comment inside the `land(...)` argument list had pushed
the exit past the gate's 30-line lookback. The gate's own message says *"Do NOT
widen LOOKBACK_LINES to make this pass"*, so the comment moved above the
`refuseUnverifiable` declaration instead, with a note saying why it lives
there. Green after. Worth recording as a gate doing its job on a comment-only
edit.

**Typecheck:** `tsc --noEmit` exit 0.

**Prebuild:** `npm run prebuild` (31 scripts) exit **0**. Notable lines:
`check-decision-ledger · 9 mutatePlan exits, 12 ledger writes, 5 COMMITs each preceded by one of 5 in-transaction writes, both migrations additive, 165 refuses to apply`;
`belief-owners OK · 12 quantities · 16 owners`;
`check-race-week-canonical-reads · PASS`.

**Not verified:** Rule 13 device rendering. This change alters HTTP status
codes and comment/ledger text; nothing the runner reads on screen changes
wording. The one runner-visible consequence — a refused Move-a-Run now
answering 503 instead of 400 — could only be rendered honestly against
production with migration 166 still unapplied, and I did not have a device
loop. Stating that plainly rather than substituting a fixture.

---

## Readiness

**I believe this is genuinely ready for a final review round.** Both moderate
findings are fixed at the root (one shared resolver, not six synchronised
copies), both are falsified in both directions, the suite moved only by the
tests I added, and prebuild is clean.

Three things a final reviewer should look at, none of which I think blocks:

1. **The `no_plan` 404 → 409 change** is wire-visible and wider than the
   reported finding. I took it because Rule 16 leaves no room for two answers,
   and the five direct-route callers had already been answering 409. If that
   reasoning is wrong, the fix is to give `refusalFor` a 404 for `no_plan` —
   one line, one owner — not to re-add the map row.
2. **F3 is open** and I would rather it were decided than fixed quickly. The
   posture question (refuse or proceed on a failed derived-frequency read) is
   genuinely open and the F2 trace makes "refuse" less obviously right than it
   looked in round 5.
3. **F4 leaves a real mismatch live** — the phone offers a Retry on a doctrine
   rejection that can never succeed. Harmless in direction, wrong in fact, and
   it needs a native-side change or an explicit decision to opt these routes
   into the phone's `refusal`-key contract.

No merge authority exercised. Branch pushed, not merged.
