# Before-side findings · what the live plan already shows

Measured read-only against production on 2026-09-02, before any rebuild.
Each is verified, not inferred, and each is carried into the preview rather
than smoothed over.

## 1 · Proof 10 already holds — the goal is not renegotiated

The CIM row keeps the stated goal untouched and prescribes a separate
execution target beside it:

| Field | Value |
|---|---|
| `stated_goal_sec` | 10800 · **3:00:00**, byte-identical to what he set |
| `target_sec` | 11610 · 3:13:30 @ 7:23/mi |
| `source` | `stated_goal_clamped_to_range_edge` |
| `feasibility` | `unlikely_currently` |
| `likely_range_sec` | [11607, 12410] |
| reason | *"Your goal (3:00:00) is faster than the likely range's fast edge (3:13:27) · race to the edge; the goal stays yours."* |

The 2026-11-08 half is the same shape: goal 5400, target 5530, goal preserved.

Two things follow. The no-renegotiation rule is being kept at the point where
it is hardest to keep — a goal the engine privately rates `unlikely_currently`
— and the execution number is *closer* to the goal than it was when the
handback was written (3:17:00 @ 7:31 then, 3:13:30 @ 7:23 now), because the
evidence moved. That is the upward direction working on the pace axis.

## 2 · One stale record, verified as provenance rather than a second owner

`authored_state.prescribed_race_pace` on the live plan still holds
`pace_s_per_mi: 436` (3:10:30, `ceiling_vdot 47.1`) from `achievableRaceTarget`,
while the race row carries 443 (3:13:30) from the canonical outlook. Two CIM
targets exist in the database right now.

**It is not a live defect, and I checked rather than assuming.** The B2 change
on 2026-09-02 stopped the composer seeding itself from this field. The only
remaining reader is `generate.ts:12520`, and it takes `goal_sec` (10800 — the
stated goal, correct and stable), never `pace_s_per_mi`. The shadow-compare
reader is a comparator, not a consumer.

So the stale 436 is what the runway said when the block was authored on 08-30.
A rebuild refreshes it, which removes a misleading row from the record. Worth
doing; not a reason on its own to rebuild.

## 3 · Week 0 cannot be rebuilt without regenerating history

The first week holds **five rows, no rest days, and two dates missing
entirely** (08-25 and 08-29 have no row at all). A rebuild that composes a
normal seven-day week there would be writing new prescriptions onto dates
already past — precisely what proof 3 forbids. The correct behaviour is to
carry week 0 untouched, holes included.

Its `plan_weeks.rationale` also reads `QUALITY · week 1` while the week
contains no quality session. A labelling defect, not a training one.

## 4 · Past rows are correctly frozen at the old anchor

Easy HR caps step **145 → 151** exactly at the 08-31 week boundary, where the
LTHR re-anchor 162 → 168 landed. The past rows kept the anchor they were
authored under. That is Rule 10 behaving as intended: history records what was
prescribed at the time, and is not reinterpreted.

## 5 · Two weeks share the peak, one carries the flag

Weeks 6 and 9 are both 61.0 mi; only week 6 has `is_peak`. The longest run,
21.5 mi, sits in week 9. If the rebuild resolves this differently that is a
legitimate change, but it must be named and justified under proof 6 rather
than passed over as noise.

## 6 · No placement compromises were recorded

`authored_state` carries no `placement_compromises` key, so the 08-30 authoring
run reported no forced placement. That is the honest answer to the refusal
question for the before side — nothing was refused or compromised, and the
absence is recorded here so the after side has something to be compared to.

## Sealed, for proofs 2–4

- seven plan rows before today · `df8b2ae4976ef24f8733765b16c96731499499f0a35475ff4b25bfcbecf9d144`
- eight completed runs, 55.84 mi · `d8ad8b196287f1c7228f975ce69b8c48560d13a7367aa17f962209d29f320b20`
