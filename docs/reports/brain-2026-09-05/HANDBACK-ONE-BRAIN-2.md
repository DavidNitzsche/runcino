# Handback · the consolidation, and a correction to the 9/21 gate

Everything below is on `main` and deployed (`c0d6d131` SUCCESS, 20:15 UTC).
`AUTOMATIC_ADAPTATION_AUTHORITY` is still the literal `false`. No plan row of
yours was written. No migration was applied to production.

---

## 1 · The 9/21 gate document is wrong on its own key finding

You gave me `CIM0921GATE.md`. Its condition 7 says the 09-21 week violates
`Research/00a`'s one-stressor-at-a-time rule, that this "fails **today**, on the
plan as authored", and that the fix is to convert the 09-22 tempo to an easy 7.

I wired the sequence detector to your live block and ran it read-only. **The
week does not violate the rule.** Here is the engine's own arithmetic:

```
09-21 baseline window (trailing 3 weeks)
   2026-08-31   46.5 mi   3 stressors   [threshold, interval, long]
   2026-09-07   24.4 mi   2 stressors   [tempo, race]
   2026-09-14   46.8 mi   2 stressors   [threshold, long]
   baselineMi = 46.8       baselineStressors = 3

   the week      55.2 mi   3 stressors   [tempo, race, long]
   volumeStep = +17.9%     addsIntensity = 3 > 3 = FALSE
```

The volume half is confirmed — +17.9% against the doc's +18.0%, same number.
The intensity half is not. The document read "2 to 3" by comparing to the week
immediately before it. The detector compares to the **maximum over the trailing
three weeks**, and 08-31 already carried three stressors.

That difference is not a detail, it is the exact defect the detector was fixed
for. Comparing to the previous week alone makes a cutback the baseline, which is
Rule 8 one level down — and it is the mistake I made twice earlier in this work,
once by using the previous week and once by filtering race weeks out and thereby
deleting your biggest week from the comparison.

**So mutation A is not required by condition 7.** The 09-21 week's real finding
is the volume reach alone: +17.9% on your trailing max, which is ALLOWED and not
SUPPORTED. That is a weaker claim than the document makes and it does not on its
own justify taking a tempo session out of your block.

Run across the whole 15-week block, the sequence gate reports **zero**
one-at-a-time violations. Your block is cleaner than the document said.

I also found and fixed a defect in my own version of this before it could
mislead you: my first loader excluded an ordinary long run from the stressor
count, which made 09-21 read 2 instead of 3 and produced "no finding" for the
wrong reason. It did not disagree loudly — it reported clean. The layer's own
tests pin the counting (`['Dodgers 10k', 'tempo', '17 mi long']`), the loader
now matches them, and a gate fails if it drifts again.

---

## 2 · The mileage question, and what changed

**Does running more than prescribed update later weeks?** It did not. The only
response to extra mileage was `volume_overshoot`, a 17% cut to the next seven
days. `tryAdaptiveBump` — the one upward volume lever — returned `null` on its
first line.

Rule 21 measured that at 309 production intents and zero upward adaptations. The
mechanism was three bugs in series, and any one of them left standing makes the
other two pointless:

1. `PROPOSABLE_KINDS` held no upward kind, so an upgrade could only be applied
   or dropped, never **offered**.
2. `tryAdaptiveBump` refused before reading anything, so the detector had no
   consumer at all — not a writer, not a proposer.
3. The proposal payload had no field for a target distance, so a `mark_upgrade`
   that *was* written produced a card the accept path could not act on.

All three are closed. A closed seam now routes to `proposeAdaptiveBump`, which
runs the same detector with the same doctrine caps and the same pull-back guard
and **raises a card**. It does not import `applyAdaptations`, and a gate reads
the module's source to prove it.

**Sealed from writing is not sealed from asking.** Your ruling is that upward
adaptation cannot change the live plan. Proposing does not.

One gate had to move for this and you should know which: `_bump_pullback_guard`
section 3 asserted the sealed bump issued **no database read at all**. That is
stricter than the ruling, which is about writes, and keeping it means you can
never be offered a push. The invariant is now "reports no bump and writes no
plan row". The section carries a paragraph naming the one line to delete if you
want the strict form back.

---

## 3 · One brain · before and after

| | before | after |
|---|---|---|
| Action vocabulary | 3 fields: `newType`, `newDate`, `shaveFraction` | one versioned union, 21 kinds |
| Pace / dose / coordinated changes | could not be expressed at all | `PACE_CHANGE`, `QUALITY_DOSE_CHANGE`, `COORDINATED` |
| Card direction | 5-kind switch, unknown → silently withheld | total map; a new kind fails to compile |
| Stale proposals | applied over a rebuilt plan | refused, before acceptance |
| Pace re-anchor | unattended cron wrote 77 rows | raises one card; hold deleted |
| Decision record | `{"n": 1, "ts": ...}` | 36-column ledger, direction **measured** from before/after |
| Lever ordering | one static array, every phase | per phase, each row citing its own source |
| `planVersion` | 4 independent copies | one resolver |
| Adjudication layer | no live entry point | reads your block, reports findings |

Retired, not kept alongside: the three-field payload (one-way upgrade for the
seven existing rows), the hand-written direction switch, the static
`ARBITRATION_PRIORITY`, the three `planVersion` constructions, the hold in
`reanchor-plan.ts` and `recompute-paces.ts`.

---

## 4 · Defects the existing gates caught in my own work

Worth listing because they are the argument for the gates:

- The swallow ratchet caught me writing `.catch(() => ({ rows: [] }))` in a new
  loader — the exact shape I had just removed from the accept route.
- The orphan gate caught two new modules with no caller. Both were wired rather
  than exempted.
- The coercion ratchet noticed the `planVersion` consolidation removed a
  collapse, and made me tighten it 176 → 175.
- Falsifying my own action-schema gate found a hole: deleting `newDistanceMi`
  from the payload writer broke **nothing**, because every test read a payload
  that already had the field.
- My first replacement for the seal gate was **vacuous** — injecting a literal
  `UPDATE plan_workouts` into the offer path did not fail it, because the
  detector returns early on a stubbed database.

And one I nearly shipped: reconstructing a proposal's before-state filled
unrecorded fields with `null`, so the staleness check read every live value as a
change. **The Accept button would have refused every card on your phone.**
Absent and null are now different facts, falsified in both directions.

---

## 5 · What is not done, plainly

- **Nothing raises a schema action yet.** The engine still writes the five
  legacy kinds and the new union reads them through one bridge. The lane can
  carry every lever; the engine has not been taught to use most of them.
- **The reprice card has never been rendered on device.** No reprice proposal
  exists in production and manufacturing one needs a production write. The wire
  shape is proven, the pixels are not. This is a Rule 13 gap and I am calling it
  one rather than claiming verification.
- **The adjudication layer is one finding wired, not the layer.**
  `checkPromotion` grades eleven dimensions; the live entry point spends one.
- **Limiter and hard-stop are unreachable in production** — nothing persists a
  Coaching Thesis limiter or a Safety verdict, so those inputs are UNKNOWN and
  NORMAL. `live-input.ts` carries a marker that Safety must be wired before this
  engine ever proposes to a runner. I did not wire it.
- **A card raised is not a plan changed.** With the seam closed the upward lever
  can only ask, and if you never open the card nothing happens. The ledger
  records which of the two occurred; do not read "the lever fired" as "the plan
  went up".

---

## 6 · What needs your approval

1. **Migrations 166 and 167** (`plan_decision_ledger`, `reassessment_schedule`).
   Applied to a scratch database only, twice each, idempotently. Statement by
   statement with rollback SQL in `MIGRATION-PACKET.md`. Enabling them allows
   nothing that writes a plan.
2. **The seal gate relaxation** in §2 — reversible in one line.
3. **The 9/21 decision itself.** On the evidence above I would leave the 09-22
   tempo alone. The week is a volume reach, not a doctrine violation, and
   removing a threshold session eleven weeks out on a mistaken reading of your
   own history is a worse error than running a 55-mile week.
