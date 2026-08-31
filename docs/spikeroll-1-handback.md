# SPIKEROLL-1 · the 110% spike rule, bound every week — HELD BACK

**UPDATE 2026-09-01: landed.** Commit `ecb5972c` (`feat(spikeroll-1): land
the 110% single-run spike guard, held back one cycle`) shipped this for
real — `enforceSpikeRule()` is called live in `generate.ts` (`void
enforceSpikeRule;` is gone), with an argued, cited exemption for anchors
under a 5-mile "coherence floor" (see `SPIKE_MIN_COHERENT_ANCHOR_MI` in
`generate.ts`). The four protected keys named below as the hold-back reason
are confirmed green as of this update: `_sweep_allusers.test.ts` (0 firm
failures, 11,598 archetypes), `_dosing_sweep_gate.test.ts` (0 enforced
breaches), `_audit_long_ramp.test.ts` and `_audit_periodization.test.ts`
both pass. A dedicated standing gate now watches this directly —
`_spike_rule_gate.test.ts` (SPIKEROLL-1) — which also parses the 110%
figure out of `Research/00a` at run time per Rule 7, rather than asserting a
second hardcoded copy of the number. Rest of this document is the original
hold-back writeup, kept as the historical record of why it waited one cycle.

**Status (as of original write-up, now superseded above): written, verified
against the owner's live block, NOT landed on `main`.**
The code sits inert in `web-v2/lib/plan/generate.ts` as `enforceSpikeRule`, with a
`void enforceSpikeRule;` beneath it so it compiles and is impossible to miss.

The owner has ruled: *"Let's not breach. So adjust."* This is the adjustment. It is
held back for one reason and one only — **it moves four protected answer keys**, and
the brief for this work says that is a stop-and-report condition rather than
something to rebaseline. Every number below is measured, not estimated.

---

## 1 · What it fixes, on his real block

Authored at the real cron instant (`CRON_AUTHOR_INSTANT`, `todayISO 2026-08-30`) via
`_probe_cim_block.test.ts` against production rows, RO credentials. Anchor is the
BLENDED one — the longest single run in the prior 30 days, his real AFC half (13.2 on
2026-08-16) seeded in, races counted as anchors, race day excluded from the check.

| date | type | before | anchor | % | after | anchor | % | verdict |
|---|---|---|---|---|---|---|---|---|
| 2026-08-30 | long | 14.5 | 13.2 | 110% | 14.5 | 13.2 | 110% | ok |
| 2026-09-06 | long | 15.0 | 14.5 | 103% | 15.0 | 14.5 | 103% | ok |
| 2026-09-13 | race | 6.2 | 15.0 | 41% | 6.2 | 15.0 | 41% | excluded |
| 2026-09-20 | long | 12.0 | 15.0 | 80% | 12.0 | 15.0 | 80% | ok |
| 2026-09-26 | race | 6.21 | 15.0 | 41% | 6.21 | 15.0 | 41% | excluded |
| 2026-09-27 | long | 15.5 | 15.0 | 103% | 15.5 | 15.0 | 103% | ok |
| **2026-10-04** | long | **19.0** | 15.5 | **123%** | **17.0** | 15.5 | **110%** | **BREACH → ok** |
| 2026-10-11 | long | 20.0 | 19.0 | 105% | 18.5 | 17.0 | 109% | ok |
| 2026-10-18 | long | 15.0 | 20.0 | 75% | 15.0 | 18.5 | 81% | ok |
| 2026-10-25 | long | 19.5 | 20.0 | 98% | 19.5 | 18.5 | 105% | ok |
| 2026-11-01 | long | 21.5 | 20.0 | 108% | 21.0 | 19.5 | 108% | ok |
| 2026-11-08 | race | 13.1 | 21.5 | 61% | 13.1 | 21.0 | 62% | excluded |
| 2026-11-15 | long | 16.0 | 21.5 | 74% | 16.0 | 21.0 | 76% | ok |
| 2026-11-22 | long | 20.0 | 21.5 | 93% | 19.5 | 21.0 | 93% | ok |
| 2026-11-29 | long | 14.0 | 21.5 | 65% | 13.5 | 21.0 | 64% | ok |
| 2026-12-06 | race | 26.22 | 20.0 | 131% | 26.22 | 19.5 | 134% | excluded |

**The breach is closed at exactly the predicted value — 17.0.**

### Two corrections to the expectation, both worth having

1. **The later weeks DO move**, where the brief expected 20.0 / 19.5 / 21.5 untouched.
   10-11 goes 20.0 → 18.5, 11-01 21.5 → 21.0, 11-22 20.0 → 19.5, 11-29 14.0 → 13.5.
   That is the guard working as specified, not an error: trimming 10-04 to 17.0 lowers
   the anchor every following week is measured against. Net cost **5.0 miles across
   fourteen weeks**, not ~2, and a peak long of **21.0 instead of 21.5** — still inside
   `Research/22`'s 20-24 marathon band.

2. **2026-09-06 does not read as a breach at authoring time**, where the corrected
   measurement had it at 111%. At authoring the plan's own 08-30 long is 14.5, so
   15.0 / 14.5 = 103%. The 111% figure uses his SEALED ACTUAL for that day (13.49). See
   §4 — this is the authoring-vs-flex question, and it is the real one.

---

## 2 · Where it had to go, and where it must not

`layoutWeek`'s `rampCeiling` was tried FIRST, and the anchor it can read is wrong in
the permissive direction. Instrumented on his block:

```
SPIKE wi=0 prior=[]                anchor=13.5 ceil=14.5
SPIKE wi=3 prior=[16,15,14.5]      anchor=16   ceil=17.5
SPIKE wi=5 prior=[17.5,15,16,15]   anchor=17.5 ceil=19     ← authorises the 19.0
```

Those priors are the PRE-FINALISATION curve. The FINAL longs for the same weeks are
14.5 / 15 / 6.2 / 12 / 15.5, because the composer embeds tune-up races, re-shapes
cutbacks and rescales the taper AFTER `layoutWeek` returns. Every pre-final value is
higher than what the runner will actually run, so a ceiling derived from them is
looser than doctrine's — looser by exactly enough to wave the breach through.
**A guard has to read the plan that ships.** Hence `finalizeComposedPlan`.

The `rampCeiling` half of the diagnosis is still correct and is NOT in this hand-back:
`seed` is bounded by the spike rule, `stepCeil` and `linearTarget` are not, and the
enclosing `Math.max` lets the larger win — so the guard applied to week 0 and was
bypassed from week 1. Both halves want fixing together.

**The injury guard is untouched, deliberately.** `spikeAnchorLongMi` still carries the
LITERAL prior-30-day maximum per Rule 8's corollary, the habit half stays filtered, and
no ceiling was raised anywhere to make a curve fit (Rule 21).

---

## 3 · WHY IT IS HELD BACK · four protected keys, measured

| gate | on `main` | with SPIKEROLL-1 |
|---|---|---|
| `_sweep_allusers` | 0 firm failures | **334** firm failures, 16 types |
| `_dosing_sweep_gate` | 0 enforced breaches | **12** |
| `_audit_long_ramp` | green | **red** — "expected 15 to be ≥ 18" |
| `RAMP.single-session-spike` (doctrine) | green | **red** |
| `_audit_periodization` FROZEN snapshot | stable | moves |

None of these is a bug in the implementation. Each is a real conflict, and two of them
say something the owner should see:

**a · The sweep's 334 are almost all "Taper bottoms at N mi, X% below peak" on the
SMALLEST runners** (`L0-3`, `m0`/`m5`). Cause: on a half-mile grid,
`floor(anchor × 1.10 × 2) / 2` equals the anchor itself for any anchor below 5 mi —
`floor(2 × 1.1 × 2)/2 = 2.0`. So the long CANNOT GROW AT ALL, the block's peak never
rises, and the taper arithmetic degenerates. Doctrine and the grid genuinely disagree
below five miles. Options, none of which is mine to pick:
   * exempt anchors under a stated coherence floor (~5 mi) as CONVENTION, and say so;
   * let the ceiling round UP to the grid for small anchors, which is a real breach
     (a 3.0 → 3.5 step is 117%);
   * give beginners a different long-run mechanism entirely, which `Research/22`
     §"Return from Long Layoff" and the base-building rules arguably already do.

**b · `_audit_long_ramp` encodes a curve that breaches the rule.** Its case is
"recent long 5 → reaches the peak late", asserting a late long of **≥ 18**. From 5 mi,
even an unrounded 10%-per-week climb over the full 13 climbing weeks reaches
5 × 1.1¹³ = **17.36**. The test therefore requires the ramp to exceed 10%/week
somewhere, which is precisely what the spike rule forbids. **This is the finding, not
a side effect:** the engine's A1 long-run ramp for a low-capacity runner is designed
to breach `Research/00a:752`, and a test has been asserting that it does.

---

## 4 · Authoring only, or the flex path too?

**This binds at AUTHORING, using planned values. It does not bind on the flex path,
and that is where it actually protects him.**

The anchor is `max(actual runs in the window, planned longs in the window)`. At
authoring the "actual" half is one number — `spikeAnchorLongMi`, the literal
prior-28-day max — and everything after week four is plan-only. Once a day is SEALED
with a different actual, the anchor changes: his 2026-08-30 was authored at 14.5 and
run at 13.49, which turns 09-06 from 103% into 111%. Under the settled architecture —
the block authored whole, pace and distance flexing on weeks not yet run — this guard
is exactly the kind of thing that should be **re-evaluated as the weeks land**, not
frozen at authoring. That half is not written.

---

## 5 · What is still owed

* The standing assertion across the whole block, as a gate (Rule 18), with the 110%
  figure parsed out of `Research/00a` at run time (Rule 7) rather than hardcoded.
  Not written, because a gate for a mechanism that is held back would be a gate that
  has to be held back with it.
* Falsification against `main` — partly done: the breach is reproducible on `main` at
  2026-10-04 (19.0 vs 15.5) and is gone with this code, both measured through
  `_probe_cim_block.test.ts` at the real cron instant.
* The `rampCeiling` half (see §2).

---

## 6 · Is this the same defect as the long-run sizing cliff at ~3489?

**No. Two separate defects, in the same function, ten lines apart.**

* **LONGSIZE-CONTINUOUS-1** (landed, `cb2af079`) was a CONTINUITY defect: two different
  formulas selected by a threshold on `peakWeeklyMi`, where crossing upward could only
  ever make the long SHORTER. It is about the DERIVATIVE — the plan changing in kind
  for a hair of input. Corpus-wide it was worth 46 drops larger than a rounding step,
  the worst a 10K beginner's week-13 long falling 9 → 6 mi for half a mile of base.
* **SPIKEROLL-1** (this) is a LEVEL defect: the authored long is too big relative to
  what the legs have absorbed, at any input, continuously. It is about the VALUE.

A plan can pass either and fail the other, and his did: the block that breached at
2026-10-04 had a perfectly continuous long-run curve.

The two Rule 9 candidates relayed alongside this — `layoutWeek`'s easy-day divisor and
`heldByCurrent`'s 6.0 mi opening-week jump — are **both already fixed and live**, in
`81bf30eb` (RULE12-RESIDUAL-1 and ENTRY-CONTINUOUS-1 respectively). Neither is the same
defect as the long-run sizing cliff either; all four are separate.
