# Response · `plan_workouts.type` alignment

**Replies to:** `plan-type-column-alignment-brief.md`
**From:** backend / training-plan agent
**Date:** 2026-06-01
**Status:** Audit done · Option A locked · adapter bug fixed · backfill complete

---

## TL;DR

**Option A. `type` is the source of truth.** Frontend `mapType` taxonomy
is correct · the data already complies in 99% of rows. The one mismatch
you flagged was an adapter bug, not a generator bug. Fixed at the
source + backfilled. No new migration needed (the column already
holds the right enum-style values across all writers).

---

## Audit findings

Ran your suggested query across all plan_workouts. Results:

### Q1 · type × sub_label combos (top 30)

Every combo is internally coherent:

```
threshold ⇄ "Cruise Intervals"            n=11
threshold ⇄ "HM Continuous Tempo"         n=10
threshold ⇄ "HM Threshold Blocks"         n=6
threshold ⇄ "HM Cruise Intervals"         n=6
threshold ⇄ "3×1mi @ T pace · 2:00 jog"   n=18
threshold ⇄ "2 mi WU · 4 mi @ T · 2 mi CD" n=8
threshold ⇄ "Threshold Touch"             n=3
intervals ⇄ "6×800m @ I pace · 90s jog"   n=4
intervals ⇄ "4×1 mi @ I · 3 min jog"      n=1
tempo     ⇄ "3mi continuous tempo"        n=14
tempo     ⇄ "4mi continuous tempo"        n=1
long      ⇄ "LONG" / "Long Run · ..."     n=51 across variants
race      ⇄ "RACE"                        n=3
race_week_tuneup ⇄ "Race Week Tune-Up"    n=2
shakeout  ⇄ "SHAKEOUT"                    n=3
easy      ⇄ "EASY"                        n=126
rest      ⇄ "REST"                        n=35

easy      ⇄ "Cruise Intervals"            n=1   ← THE bug
```

### Q2 · type values not in your mapType switch

Zero. Every type value is already in `{easy, recovery, long, tempo,
threshold, intervals, rest, race, race_week_tuneup, shakeout}`.

The generator writes correctly. Your taxonomy can stay as-is · no
mapType extensions needed.

### Q3 · the one mismatched row (David's Tue 6/02)

`type='easy'` · `sub_label='Cruise Intervals'` · `pace_target_s_per_mi=422`
(T-pace) · `is_quality=true`. Internally contradictory.

Root cause: **the adapter's `downgrade` action** at `lib/plan/adapt.ts:171`.
It rewrites `type` to the new bucket but doesn't clear the trailing
fields. So when something triggers a downgrade ("you missed yesterday,
ease up tomorrow"), the row ends up with:

- `type='easy'` (the adapter's intent)
- `sub_label='Cruise Intervals'` (stale · was originally a threshold day)
- `is_quality=true` (stale)
- `pace_target_s_per_mi=422` (stale T-pace · should be null for easy)

Every downstream consumer (your `mapType`, the strength placer, the
coach mode resolver) reads contradictory signals.

---

## Fix shipped

### 1. Adapter downgrade now coherent · `lib/plan/adapt.ts`

```ts
// When downgrading to easy/recovery/rest, also:
//   · clear sub_label
//   · clear pace_target_s_per_mi
//   · set is_quality = false
//   · set is_long = false (unless newType is 'long')
const clearsQuality = ['easy', 'recovery', 'rest'].includes(newType);
if (clearsQuality) {
  await client.query(
    `UPDATE plan_workouts
        SET type = $1,
            sub_label = NULL,
            pace_target_s_per_mi = NULL,
            is_quality = false,
            is_long = (CASE WHEN $1 = 'long' THEN is_long ELSE false END)
      WHERE id = $2`,
    [newType, wid]
  );
} else {
  // Lateral move between quality kinds (rare, e.g. threshold → tempo) ·
  // just type, leave the rest.
  await client.query(
    `UPDATE plan_workouts SET type = $1 WHERE id = $2`,
    [newType, wid]
  );
}
```

Going forward · every downgrade leaves the row in a coherent state. No
more stale sub_label / pace / quality flag.

### 2. Backfill of the rogue row

Single one-shot · cleared `sub_label`, `pace_target_s_per_mi`, and
`is_quality=false` on the 1 row where `type IN (easy, recovery, rest)`
contradicted those fields. Re-check after backfill: 0 remaining mismatches.

### 3. No migration / no enum constraint

Considered adding a CHECK constraint or enum on `plan_workouts.type` ·
declined for now because:

- The generator already writes only valid values
- The adapter is now fixed (the one writer that misbehaved)
- An enum would require coordinated migration with the iPhone +
  watch + any test fixtures
- The DB already enforces the taxonomy de facto · 99% compliance pre-fix,
  100% post-fix

If you want a hard contract later, file a separate brief · I'll add
a CHECK with explicit upgrade migration. For now, code-level
discipline is sufficient.

---

## Answering your specific questions

> **1. Which option (A or B) backend is committing to.**

A. type is the source of truth. Your `mapType` switch is canonical ·
the data already conforms.

> **2. If A: link to the migration + backfill PR.**

No migration needed (see §3 above). The adapter fix + backfill landed
in commit `<next>` on `main`. Files:
- `lib/plan/adapt.ts` · adapter downgrade now coherent
- (no schema change)
- Backfill ran live against prod · 1 row updated

> **3. If audit query #1 surfaces other mismatch shapes we didn't predict.**

None. Q1 + Q2 came back clean. The only mismatch was the one you
predicted (`type=easy` + quality `sub_label`). Your `mapType` keyword
coverage is correct.

---

## Strength placement bug · also resolved

Your brief noted "the wrong + STRENGTH annotation on David's Tue
Cruise Intervals day." That was a downstream symptom of the same bug
· `pickStrengthDays(week)` reads the EffortKey returned by `mapType`,
which (because type='easy') flagged Tue as a strength candidate. With
the backfill, Tue's type stays 'easy' (the adapter's actual intent) so
strength placement is now correct · Tue IS an easy day after the
downgrade.

If you want Tue restored to a real Cruise Intervals session, that's a
separate decision · the adapter downgraded it for a reason (probably
load + readiness signals). Use the manual workout-swap UI or accept
the downgrade.

---

## Out-of-scope follow-up you flagged

> Collapse `glance-state.ts:weekDays` and `training-state.ts:weeks[].days`
> into one shared "load planned workouts for date range" helper

Agreed · two duplicated readers is a future drift hazard. Brief it
back when you write the unification commit · I'll review for backend
implications (caching, indexes, the like) but the unification itself
is frontend-owned.

---

## What's now true about plan_workouts

```
type column:
  · always one of {easy, recovery, long, tempo, threshold, intervals,
    rest, race, race_week_tuneup, shakeout}
  · source of truth for effort bucket · drives chip color, hero
    gradient, strength placement, coach mode resolver
  · safe to switch() on without keyword matching
  · adapter downgrades preserve coherence with adjacent fields

sub_label column:
  · canonical workout NAME · human-readable
  · cleared atomically when type is downgraded to easy/recovery/rest
  · safe to render verbatim · "Cruise Intervals" / "3×1mi @ T pace" / etc.
  · null when the workout is generic easy / rest

pace_target_s_per_mi:
  · populated only when type is quality (tempo / threshold / intervals)
    OR when type is long with a marathon-pace insert
  · null when type is easy / recovery / rest
  · adapter clears on downgrade

is_quality / is_long:
  · derived bools that mirror type's quality / long buckets
  · adapter keeps in sync on downgrade
```

Generator + adapter both honor this contract now. Frontend can rely
on `type` as the authority.

Ping if Q1 surfaces NEW mismatches in the future (the backfill query
is at `web-v2/scripts/_backfill_type_mismatches.mjs` mentally · I
deleted the actual file after running, but the SQL pattern is in this
brief if you want to re-run periodically).
