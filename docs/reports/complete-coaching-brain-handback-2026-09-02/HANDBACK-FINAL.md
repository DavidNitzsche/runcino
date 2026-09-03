# Faff · complete handback

**Status: sections 7 and 8 in flight.** Everything else is complete and
verified. Two agents are working the last two items; this document is otherwise
final and is sent now rather than held.

---

## 0 · What this is

One document covering the whole programme: what was found, what was changed,
what is proved, what is not, and what remains. It supersedes the three interim
handbacks, which stay in this directory as the record of how it went.

**The live plan has not been rebuilt.** No production write of any kind, proved
by checksum rather than asserted.

---

## 1 · The one-paragraph version

The app's plan generator was reading a dozen inputs that could soften, re-phase
or veto training — daily training form, readiness, sleep, HRV, resting heart
rate, illness, injury, a mislabelled goal-realism flag, and an experience level
the runner typed about himself at onboarding. Those authorities are gone. Three
threshold cliffs were measured and two removed. Two real defects that had
quietly halved the block's marathon-specific work were found and fixed by
recalculation. A race-plus-long-run weekend that had been available to every
runner by accident is now a typed, athlete-specific transaction with an authored
purpose. Race rows update as one coherent contract instead of one number inside
an incompatible structure. What remains is one system: adaptation.

---

## 2 · The plan as it composes today

| Wk | Start | Mi | Long | Notable | Flags |
|---|---|---|---|---|---|
| 0 | 08-24 | 46.0 | 14.5 | | |
| 1 | 08-31 | 50.0 | 15.0 | | |
| 2 | 09-07 | 24.4 | RACE 6.2 | Santa Monica 10k · B | cutback |
| 3 | 09-14 | 48.0 | 16.5 | | |
| 4 | 09-21 | 56.2 | 17.0 | **Dodgers C + long · 23.21 mi across the pair** | |
| 5 | 09-28 | 42.0 | 13.0 | | cutback |
| 6 | 10-05 | 59.5 | 18.5 | | |
| 7 | 10-12 | **60.0** | 19.0 | `LONG · 4mi @ M + 2mi @ T` | |
| 8 | 10-19 | 45.0 | 14.0 | | cutback |
| 9 | 10-26 | 59.5 | **20.5** | **`LONG · 11mi @ MP`** | |
| 10 | 11-02 | 44.6 | RACE 13.1 | Run Malibu HM · B | cutback |
| 11 | 11-09 | 40.5 | 16.0 | post-race | cutback |
| 12 | 11-16 | 49.0 | 18.0 | | |
| 13 | 11-23 | 36.0 | 13.0 | | |
| 14 | 11-30 | 44.2 | RACE 26.2 | **CIM · A** | race week |

| | live | rebuilt |
|---|---|---|
| peak week | 61.0 | 60.0 |
| peak long | 21.5 | 20.5 |
| marathon-pace miles, total | 23.0 | **33.0** |
| MP embedded in long runs | 5.0 | **15.0** |
| block total | 695.4 | 704.9 |

The races, prescribed through the complete production authoring path:

| Date | Race | Role | Stated goal | Projection | Prescribed |
|---|---|---|---|---|---|
| 09-13 | Santa Monica 10k | B | none | 42:59 | 43:00 · 6:56 |
| 09-26 | Dodgers 10K | **C** | 45:00 | 43:04 | **45:00 · 7:15, ceiling 44:30** |
| 11-08 | Run Malibu HM | B | 1:30:00 | 1:36:02 | 1:32:10 · 7:02 |
| 12-06 | **CIM** | A | **3:00:00** | 3:23:50 | **3:13:30 · 7:23** |

Four distinct paces, each with one owner. Your stated goal is untouched at
10800 s and is never renegotiated:

> "Your goal (3:00:00) is faster than the likely range's fast edge (3:13:27) ·
> race to the edge; the goal stays yours."

---

## 3 · What no longer influences the plan

| Removed | What it could do before |
|---|---|
| readiness · sleep · HRV · resting HR | soften a session; `AdaptationVerdict.veto` forced PROTECT in the **live** progression gate |
| illness · injury · niggle | the same, plus the walk-run ladder |
| **daily training form (TSB)** | re-phased 7 of 15 weeks — 16.0 mi on one week, 6.0 mi on one long run |
| goal-realism flag | a 15% VDOT screen wearing a feasibility name |
| self-declared experience band | a 65-90 mi/wk band against a measured 48.5 best week |

Enforced by `_authoring_input_surface.test.ts`: every one of `ComposePlanInput`'s
fields must be classified against an allowed input, and the removal list is a
ratchet where a **stale** entry fails as loudly as a new violation.

Injury is sealed three ways — no writer, no acceptor, and `buildInjuryPlan`
refuses as its first statement before any DB read, so a hand-inserted row cannot
archive the block.

**A deliberate consequence, recorded not discovered:** removing pullbacks removed
the 48-hour brake on upward adaptation. Replaced by an **ACWR < 1.3** gate
(`Research/15`, Gabbett) failing closed on an unreadable *and* a
not-yet-computable ratio, so missing data produces **less** upward movement.

---

## 4 · Three cliffs, measured

| Cliff | Verdict |
|---|---|
| `resolveRampBase.lifted` | **Not a cliff for this runner.** `baseMi = max(liftedBase, heldMi)`, `heldMi` 44, flag inert. CLAUDE.md's Rule 9 table entry is stale on this account. A 1-mile non-monotone cliff where it *can* bind; fixed as a maximum. |
| the restore ladder | **Real, found while measuring.** 9.5 block miles and 5.5 on one week for **0.02 mi** of input, its boundary sitting exactly on doctrine's own resume level. Replaced with doctrine's integer rung count. Post-fix 0.0. |
| `cutbackCadence(tsb)` | **Largest; removed, not smoothed.** Authoring no longer calls `computeTrainingForm`. Cadence authored once, inherited via `authored_state.cutback_every_n` — recovering **3** from the live block, so a rebuild preserves the established calendar. Walk −30 → +5: identical plan at every point. |

A missing run sync can no longer reorganise the calendar, by construction.

**One trade, written down:** a genuinely returning runner no longer gets
doctrine's tighter 3-week cycle from a *new* block; it survives only by
inheritance. The alternative measured red on four gates.

---

## 5 · The two defects behind the collapsed marathon work

**The long run.** `smoothLongWoW` capped week 9's long against the **cutback
week** beside it. The validator has bridged planned deloads since 2026-08-28;
the authoring pass that actually cuts never got the exemption. Invisible because
a validator reports what is *illegal*, and a long trimmed *below* the limit is
legal.

**Marathon pace.** `racePaceLongThisWeek` knew about deloads but not races. A
race replaces the long run on the runner's own long day, so the cadence anchored
on a deload, stepped once onto the raced week, and stopped — giving the whole
four-week race-specific phase **zero** MP long runs. The engine wrote
`racePaceLongsInPhase: 0` into `authored_state` and nothing read it.

The longest run is now chosen from evidence and the choice persisted:

```json
{"ceilingMi":21.5,"demonstratedLongMi":21.5,"recentNormalLongMi":18,
 "cycleGrowth":1.15,"tierBandTopMi":24,"boundBy":"demonstrated_long_run"}
```

Races excluded — without that it read 26.8, which is Big Sur.

---

## 6 · The Dodgers weekend

`priority` is load-bearing. **Typing a 43:00 goal now yields 44:30, not 43:00** —
the restraint no longer depends on having typed a soft number.

HR band 168-176 → **161-168**, abort 179 → **171**, "Goal pace" → "Controlled
effort · 7:15/mi", closing-push split removed, *"Push the final mile on feel"*
gone, **3 easy days follow (was 1)**.

**The root defect was larger than the one it was sent after:**
`raceConsumesLongRunSlot('C')` returned false, so every C race in front of every
runner's long run was accepted at full dose with no reference to that runner.

Condition 8 landed as ruled: detect and record, nothing mutates. The `shave`
path was **deleted**, not disabled.

---

## 7 · The load progression contract · IN FLIGHT

The plan peaks at 60.0 mi against an evidence-derived band whose top is ~55.
Not a live defect — the band bounds *adaptation*, which is disabled, not
authoring. But the two authorities contradict each other, and if the adaptation
seam is ever opened the upward path returns **inert**, which is the Rule 21
failure this programme exists to stop.

The instruction that unlocked it was the runner's, not mine. I had been treating
~55 as a ceiling the plan was violating. It is not a ceiling — it is an answer
to a question nobody asked precisely:

> *"A marathon plan may prescribe 60 miles later in the block even if
> approximately 55 is the load supported today, provided the intervening weeks
> deliberately build and demonstrate the capacity required for that peak."*

So one canonical, time-aware contract shared by authoring and adaptation,
separating what is supported today, what may be authored next, what may be
planned for later, and what evidence must accumulate before that planned load
becomes actionable. 60 survives only if all eight of his conditions are proved;
otherwise it is reduced and the reason stated. The same contract moves the
demonstrated envelope forward as weeks are completed, which is what stops
adaptation being inert when it is eventually promoted.

## 8 · Removing the self-declared level · IN FLIGHT

`declaredLevel: "advanced"` still sits inside the Dodgers grant's `evidence`
object. His ruling is the whole task: *"Do not merely stop reading it while
continuing to persist it as purported evidence."* A field in a structure named
`evidence` asserts authority whether or not anything reads it.

The gate is a behavioural comparison rather than a grep: compose with each
experience level **and with it absent**, and require byte-identical output
across plan volume, peak mileage, long-run progression, race prescriptions,
race-plus-long-run permission, cutback placement, adaptation eligibility, and
any coaching explanation presented as evidence. Testing *absent* matters as much
as the values — a sweep of present values cannot see a path that defaults when
the field is missing.

### 8a · A third instance, found while this was in flight

The same defect exists in a different field name, and it reaches the runner.
`lib/plan/strategy-contracts.ts:331-341` still returns, as the prerequisite
evidence justifying a weekly-volume increase:

```ts
{ kind: 'READINESS',
  statement: 'No readiness pull-back is active.',
  owner: 'lib/coach/readiness.ts#scoreReadiness' },
```

Composing today, **week 4 (2026-09-21, 48 → 56.2 mi) is presented to him with
"No readiness pull-back is active" as one of the two prerequisites justifying
the step up.** Readiness pull-backs no longer exist. And `scoreReadiness` does
not exist either — the `owner` field names a deleted function.

That is Rule 20's corollary in the place it does most harm: a claim nothing
verifies, in prose the runner reads, stopping the next person from checking. It
was found on the FIRST owner string checked, which says little for the other
four, so the gate is being extended to assert that every `owner` resolves to a
symbol that exists. **A dangling owner should fail loudly** — that is what would
have caught this at the moment readiness was deleted, rather than it surfacing
hours later in composed output.

This matters because the explanations are otherwise good, and he will read them:

> **Why the longest run is what it is** · "20.5 mi is the longest run, the week
> of 2026-10-26. It is set from the longest runs you have actually completed and
> what one training cycle adds to them, not from a category."

> **How it prepares race effort** · "The long runs build the hours; the 33 mi at
> marathon pace inside and beside them build the effort. Running 20.5 mi easy
> proves you can cover the distance. Holding race pace late in a long run is
> what proves you can race it."

An explanation that cites deleted machinery as its justification is worse than
no explanation.

---

## 9 · Race rows update as one contract

One pure function decides the whole row; the SQL applies it mechanically; every
path passes `coherentOrRefused`, so an incoherent row is **refused whole**
rather than half-written. All four races: **0 contract violations**.

Fixed: a note reading "Target 6:52/mi" over a row at 7:02; the 12-01 tune-up
keeping 6:41 reps after being repriced to marathon pace; two coach-set tables
40 s apart; the Santa Monica brief 404; `NOTE.race` naming distances a
6.21-mile race does not have.

---

## 10 · Process, including what went wrong

**Main stopped deploying for three commits.** Two parallel branches collided —
one retired an identifier and added a ratchet asserting it was gone, the other
branched from an older base and still read it. The ratchet caught it.

**Then the verification itself was found wanting.** `verify-commit.sh` ran
`npx next build` directly, bypassing the npm `prebuild` lifecycle, so none of
the twenty gates Railway runs were in its scope — a gate failure passed
verification and failed the deploy. It now runs them first, falsified by
reintroducing the identifier that caused the outage. A second instance of the
same collision class was then caught by the input-surface ratchet *before* it
reached the deploy.

**Corrections to my own statements, carried forward:**

1. Claiming the earlier programme complete when the evidence contradicted it.
2. Telling the runner his run data was complete when it was not.
3. Claiming a render verified a fix when the app had not fetched in 11 hours.
4. Diagnosing a watch-versus-phone pace gap that did not exist.
5. Recommending against the rebuild on reasoning he correctly overturned.
6. **Advising that peak volume be pushed toward the "advanced" band's floor** —
   reasoning from a label he typed rather than from his record of 35 weeks with
   a 48.5 best and zero weeks at 50+.

**Seals, re-verified byte-identical** across five agents and a dozen merges:
seven past plan rows `df8b2ae4…`, eight completed runs `d8ad8b19…`, 103 rows on
the live plan.

---

## 11 · What is not verified

- **The Swift Block screen rendering** the new per-week explanations. It
  compiles (223 watch test cases, and that check caught a real decoder defect
  first). The simulator was not run, and the live plan predates
  `block_strategy.answers`, so the screen shows nothing until re-authoring.
- **The persisted result of a rebuild.** Everything here is composed in memory.
- **Anything the adaptation engine decides.** It remains the last system.

---

## 12 · What remains

Adaptation consolidation: one canonical engine, legacy mutators removed, every
proposed change carrying evidence, confidence, magnitude limits and reasons,
refusal preserved as a legitimate outcome, upward adaptation shadow-only until
promotion criteria are met, and one decision explained identically on phone,
watch, plan, post-run and race outlook.

Everything else in this document is done.
