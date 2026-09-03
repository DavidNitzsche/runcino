# Handback 3 · the simplified plan

Everything since Handback 2. **The live plan has not been rebuilt.** No
production write of any kind, verified by checksum rather than asserted.

`main` at `fc483a59` · CI green · **deploy status `success`**

---

## 1 · In one paragraph

Five workstreams landed. The plan generator no longer reads daily training
form, readiness, sleep, HRV, resting HR, illness, injury, a goal-realism flag,
or — on the paths corrected so far — a self-declared experience level. Two Rule
9 cliffs were removed rather than smoothed, and a third was found while
measuring. Marathon-pace work is restored by recalculation, not by copying the
old plan back. The Dodgers weekend is now a typed, athlete-specific transaction
with an authored purpose. Race rows update as one contract instead of one number
inside an incompatible structure. Two items remain open and are in flight.

---

## 2 · The plan as it now composes

| Wk | Start | Mi | Long | Notable | Flags |
|---|---|---|---|---|---|
| 0 | 08-24 | 46.0 | 14.5 | | |
| 1 | 08-31 | 50.0 | 15.0 | | |
| 2 | 09-07 | 24.4 | RACE 6.2 | Santa Monica 10k | cutback |
| 3 | 09-14 | 48.0 | 16.5 | | |
| 4 | 09-21 | 56.2 | 17.0 | **Dodgers + long, 23.21 across the pair** | |
| 5 | 09-28 | 42.0 | 13.0 | | cutback |
| 6 | 10-05 | 59.5 | 18.5 | | |
| 7 | 10-12 | **60.0** | 19.0 | `LONG · 4mi @ M + 2mi @ T` | |
| 8 | 10-19 | 45.0 | 14.0 | | cutback |
| 9 | 10-26 | 59.5 | **20.5** | **`LONG · 11mi @ MP`** | |
| 10 | 11-02 | 44.6 | RACE 13.1 | Run Malibu HM | cutback |
| 11 | 11-09 | 40.5 | 16.0 | post-race | cutback |
| 12 | 11-16 | 49.0 | 18.0 | | |
| 13 | 11-23 | 36.0 | 13.0 | | |
| 14 | 11-30 | 44.2 | RACE 26.2 | **CIM** | race week |

| | live | rebuilt |
|---|---|---|
| peak week | 61.0 | 60.0 |
| peak long | 21.5 | 20.5 |
| **marathon-pace miles, total** | 23.0 | **33.0** |
| **MP embedded in long runs** | 5.0 | **15.0** |
| block total | 695.4 | 704.9 |

`validateComposedPlan`: **no violations.** One advisory dosing finding, a taper
M session at 22.45% of the week against a 20% cap, unenforced under doctrine's
taper exemption.

---

## 3 · What no longer influences the plan

`docs/PLAN_SIMPLIFICATION_DOCTRINE.md` is locked and `_authoring_input_surface.test.ts`
enforces it: every one of `ComposePlanInput`'s fields must be classified against
one of your allowed inputs, and the removal list is a ratchet where a **stale**
entry fails as loudly as a new violation.

| Removed | What it could do |
|---|---|
| readiness, sleep, HRV, resting HR | soften a session; `AdaptationVerdict.veto` forced PROTECT in the **live** progression gate |
| illness, injury, niggle | same, plus the walk-run ladder |
| **daily training form (TSB)** | re-phased 7 of 15 weeks; 16.0 mi on one week, 6.0 mi on one long run |
| goal-realism flag | a 15% VDOT screen wearing a feasibility name |
| self-declared experience band | a 65-90 mi/wk band against a measured 48.5 best week |

Injury is **sealed three ways** — no writer, no acceptor, and `buildInjuryPlan`
refuses as its first statement before any DB read, so a hand-inserted row cannot
archive your marathon block. The four `INJURY.*` doctrine claims stay live, and
a guard asserts they do, since they are the stated reason the module survives.

**Deliberate consequence, recorded not discovered:** removing pullbacks removed
the 48-hour brake on upward adaptation. It was replaced by an **ACWR < 1.3**
gate (`Research/15`, Gabbett) that fails closed on an unreadable *and* a
not-yet-computable ratio — so missing data produces **less** upward movement,
never more. That is invariant 11.

---

## 4 · Three cliffs, measured

| Cliff | Verdict |
|---|---|
| `resolveRampBase.lifted` | **Not a cliff for you.** `baseMi = max(liftedBase, heldMi)` and your `heldMi` is 44, so the flag is inert. CLAUDE.md's Rule 9 table entry is stale on this account. It *is* a 1-mile non-monotone cliff where it can bind; fixed as a maximum. |
| the restore ladder | **A real one, found while measuring.** `held 32.44` → block 662.5; `held 32.46` → block 672.0. **9.5 block miles and 5.5 miles on one week for 0.02 mi of input.** Its boundary sat exactly on doctrine's own resume level. Replaced with doctrine's integer rung count. Post-fix: 0.0 mi. |
| `cutbackCadence(tsb)` | **The largest, and removed rather than smoothed.** `tsbAtStart` is deleted from `ComposePlanInput`; authoring no longer calls `computeTrainingForm` at all. Cadence is authored once and inherited via `authored_state.cutback_every_n` — which recovers **3** from your live block, so a rebuild preserves your established calendar. Walk from −30 to +5: **identical plan at every point.** |

A missing run sync can no longer reorganise the calendar, by construction, and
that is asserted rather than argued.

**One trade, written down rather than buried:** a genuinely returning runner no
longer gets doctrine's tighter 3-week cycle from a *new* block. It survives only
by inheritance. The alternative measured red on four gates.

---

## 5 · Why the long run and marathon pace had collapsed

Both were real defects with precise causes, not tuning.

**The long run.** `smoothLongWoW` capped week 9's long against the **cutback
week** beside it. `validateComposedPlan` has bridged planned deloads since
2026-08-28; the authoring pass that actually cuts never got the same exemption.
Invisible because a validator reports what is *illegal*, and a long run trimmed
*below* the limit is legal.

**Marathon pace.** `racePaceLongThisWeek` knew about deloads but not races. A
race replaces the long run on your Sunday, so the cadence anchored on a deload,
stepped once onto the raced week, and stopped — giving the whole four-week
RACE-SPECIFIC phase **zero** MP long runs. The engine wrote
`racePaceLongsInPhase: 0` into `authored_state` and nothing read it.

**The longest run is now chosen from evidence and the choice is persisted:**

```json
{"ceilingMi":21.5,"demonstratedLongMi":21.5,"recentNormalLongMi":18,
 "cycleGrowth":1.15,"tierBandTopMi":24,"boundBy":"demonstrated_long_run"}
```

`max(21.5 demonstrated, 18 × 1.15)`. **The band was not binding.** Races are
excluded — without that it read 26.8, which is Big Sur. The block reaches 20.5,
one mile under its ceiling, and SPIKEROLL-1's 110%/30-day rule legitimately
spends that mile.

---

## 6 · The Dodgers weekend

`priority` is now load-bearing. The proof: **typing a 43:00 goal yields 44:30,
not 43:00.** The restraint no longer depends on your having typed a soft number.

HR band **168-176 → 161-168**, abort **179 → 171**, label "Goal pace" →
"Controlled effort · 7:15/mi", closing-push split removed, *"Push the final mile
on feel"* gone. **3 easy days follow, was 1.** Long run 17.0, pair 23.21.

> "The race is the quality session and the long run the next morning is the
> point of it. Racing controlled, then running long on tired legs, is
> marathon-specific work you cannot get from either day alone."

**The root defect it fixed was bigger than the one it was sent after:**
`raceConsumesLongRunSlot('C')` returned false, so every C race in front of every
runner's long run was accepted at full dose with no reference to that runner —
already the universal permission you forbade.

Your condition 8 landed as you ruled it: detect and record, nothing mutates. The
agent had built a `shave` path that trimmed the long run and **deleted** it
rather than disabling it.

---

## 7 · Race rows now update as one contract

One pure function decides the whole row and the SQL applies it mechanically;
every path passes through `coherentOrRefused`, so an incoherent row comes back
**refused whole** rather than half-written. All four races pass the complete
production authoring path with **0 contract violations**.

Fixed: the frozen note reading "Target 6:52/mi" over a row at 7:02; the 12-01
tune-up keeping 6:41 reps after being repriced to marathon pace (it now reports
`unchanged` and loses the race band and mid-race abort it should never have
had); two coach-set tables 40 s apart; the Santa Monica brief 404; and
`NOTE.race` naming distances a 6.21-mile race does not have.

---

## 8 · Two items open, both in flight

**The 60-mile peak against a ~55 evidence ceiling.** The plan peaks above its
own stated band. Not a live defect — the band bounds *adaptation*, which is
disabled — but if the seam is ever opened the upward path returns **inert**,
which is the Rule 21 failure this programme exists to stop. Being resolved as
one canonical, time-aware load contract shared by authoring and adaptation,
distinguishing what is supported today from what may be planned for later and
earned. 60 stands only if all eight of your conditions are proved; otherwise it
is reduced and the reason stated.

**`declaredLevel: "advanced"` inside the Dodgers grant's `evidence` object.** A
field in a structure named `evidence` asserts authority whether or not anything
reads it. Being removed everywhere, with the behavioural gate you asked for:
compose with each experience level **and with it absent**, require
byte-identical output across all eight dimensions.

---

## 9 · Process

**Main stopped deploying for three commits.** Two parallel branches collided —
one retired an identifier and added a ratchet asserting it was gone, the other
branched from an older base and still read it. The gate caught it. Then
`verify-commit.sh` was found to run `npx next build` **directly**, bypassing the
npm `prebuild` lifecycle, so none of the twenty gates Railway runs were in its
scope. It now runs them first, and that was falsified by reintroducing the
identifier that caused the outage.

A second instance of the same collision class was caught by the input-surface
ratchet before it could reach the deploy.

**Both seals re-verified, byte-identical**, across five agents and a dozen
merges: seven past plan rows `df8b2ae4…`, eight completed runs `d8ad8b19…`, 103
rows on the live plan.

**Not verified, stated rather than glossed:** the Swift Block screen renders the
new per-week explanations. `check-watch.sh` proves it compiles (223 test cases,
and it caught a real decoder defect first); the simulator was not run, and your
live plan predates `block_strategy.answers`, so the screen will show nothing
until the plan is re-authored. Per Rule 13 that is not a claim that it renders.
