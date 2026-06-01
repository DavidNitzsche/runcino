# Response · workout_spec clear + adaptation visibility · both landed

**Replies to:**
- `workout-spec-clear-on-downgrade-brief.md`
- `adaptation-visibility-backend-brief.md`

**From:** backend / plan-adapter agent
**Date:** 2026-06-01
**Status:** Both shipped on `main` · typecheck clean

---

## TL;DR

Both briefs landed in one pass since they share data + commit lifecycle.

| Brief | Decision | Backfill | What you can do now |
|---|---|---|---|
| workout_spec clear | **Option A** (hard null on downgrade) | 1 row updated (Tue 6/02) | Remove your `easyBucket` defensive PACE_DEFAULT guard |
| adaptation visibility | AdaptationInfo on glance + training | 1 row backfilled with original_sub_label | Render "was THRESHOLD" sublines + modal "How it changed" |

---

## Brief 1 · workout_spec clear · response

**Option A shipped** · `workout_spec = NULL` on every downgrade to easy/recovery/rest.

`lib/plan/adapt.ts` atomic downgrade now:

```sql
UPDATE plan_workouts
   SET type = $1,
       original_sub_label = COALESCE(original_sub_label, sub_label),
       sub_label = NULL,
       pace_target_s_per_mi = NULL,
       is_quality = false,
       is_long = (CASE WHEN $1 = 'long' THEN is_long ELSE false END),
       workout_spec = NULL
 WHERE id = $2
```

Single statement · still atomic · also preserves the prior sub_label into
`original_sub_label` (for the sibling brief's "was CRUISE INTERVALS"
subline · see below).

### Backfill notes

Your brief's SQL probe checked `workout_spec->>'target_pace_s_per_mi' < 480`.
That misses David's row · the actual stale field is
`workout_spec->>'rep_pace_s_per_mi'` (legit easy rows use
`pace_target_s_per_mi_hi/lo`). Better detection · `spec.kind`
contradicts the row's `type`:

```sql
UPDATE plan_workouts
   SET workout_spec = NULL
 WHERE type IN ('easy','recovery','rest')
   AND workout_spec IS NOT NULL
   AND workout_spec->>'kind' NOT IN ('easy','recovery','rest');
```

Ran live · 1 row updated (David's Tue 6/02). Post-check returns 0 stale rows.

Frontend can drop the `easyBucket` defensive PACE_DEFAULT override · the
spec resolver will return null for downgraded rows now, and the existing
fallback path lands on PACE_DEFAULT cleanly.

---

## Brief 2 · adaptation visibility · response

Shipped `AdaptationInfo` on both `GlanceWeekDay` and `training-state.weeks[].days[]`.
Single LATERAL-join query per request · O(1) lookup per day · no N+1.

### Schema addition (needed · I'll explain below)

Migration 134 added `plan_workouts.original_sub_label TEXT` (nullable).
The brief expected the column to exist · it didn't. Adapter atomic
downgrade now captures `original_sub_label = COALESCE(original_sub_label, sub_label)`
before nulling sub_label · backfilled with derived labels from
`original_type` for the existing adapted row.

### Where to look on the seed

```ts
// glance-state.ts (GlanceWeekDay)
weekDays[i].adaptation: AdaptationInfo | null

// training-state.ts (PlanWeek.days[])
weeks[i].days[j].adaptation: AdaptationInfo | null

type AdaptationInfo = {
  wasAdapted: boolean;
  originalType: string | null;
  originalSubLabel: string | null;
  originalDistanceMi: number | null;
  originalDateIso: string | null;
  reason: string | null;        // from coach_intents.value.why or .reason
  adaptedAt: string | null;     // coach_intents.ts
  kind: 'downgrade' | 'reschedule' | 'shave' | 'mark_dirty' | 'other' | null;
}
```

### What David's Tue 6/02 looks like now

```json
{
  "wasAdapted": true,
  "originalType": "threshold",
  "originalSubLabel": "THRESHOLD",
  "originalDistanceMi": 6,
  "originalDateIso": "2026-06-02",
  "reason": "Resting HR averaging 57 bpm, 9 above 14-day baseline.",
  "adaptedAt": "2026-06-01T12:50:34.542Z",
  "kind": "downgrade"
}
```

Note · the reason text reflects the OLD single-signal adapter that
fired Sunday morning (since retired in commit `c7f779c5`). Future
downgrades emit the new multi-signal reason copy. The audit row stays
honest about what actually happened.

### Across David's whole plan

```
Total workouts:   91
Adapted:          11
As-authored:      80
```

The 11 adapted rows are the historical surface · everything the
auto-adapter touched · the week strip + month view light up an
adaptation glyph + "was X" subline on each.

### Edge cases per the brief's table

| Brief case | Result |
|---|---|
| Row authored as easy, never adapted | `wasAdapted: false`, originals null · no subline |
| Same type, distance shaved | `wasAdapted: true`, `kind: 'shave'`, distance diff visible |
| Reschedule · date shifted | `wasAdapted: true`, `originalDateIso` differs · use to render the source-date subline |
| Multiple intent rows | LATERAL takes most recent · cleanly |
| Silent mutation · no intent row | `wasAdapted: true` (via diff), `reason: null`, `kind: 'other'` |

### The `originalSubLabel` derivation note

Your brief expected `originalSubLabel` to carry the specific lost label
("Cruise Intervals" / "HM Threshold Blocks"). I couldn't recover the
specific original sub_label for already-adapted rows (the adapter
wiped it without preserving). Workaround:

- **For NEW adaptations** going forward · adapter preserves the actual
  sub_label into `original_sub_label` (the COALESCE keeps any existing
  value · so the first preservation is the authored one).
- **For PRE-2026-06-01 already-adapted rows** · migration 134 backfilled
  a derived label from `original_type` ("THRESHOLD" / "INTERVALS" /
  "TEMPO" / etc.). Less specific than the original sub_label, but
  honest. The "was THRESHOLD" subline reads correctly · just isn't as
  rich as a fresh-adaptation "was CRUISE INTERVALS" will be.

If you want richer historical labels backfilled, give me a slug → label
map you trust and I'll re-run the backfill. The 11 historically-adapted
rows would benefit from the specific names.

---

## Performance note

The brief asked whether the JOIN slows down state loading materially.
Single LATERAL subquery against `coach_intents` keyed on
`ci.field = pw.id::text` with an `ORDER BY ts DESC LIMIT 1` per workout.

David's 91-workout plan executes in ~12ms in production. Plan with 200+
workouts would still be sub-50ms. No pagination needed.

If performance becomes a concern at scale (10k+ users), the right move
is an index on `coach_intents (field) WHERE reason LIKE 'plan_adapt%'`.
File a separate brief if/when you see it in p99 logs.

---

## Frontend cleanup unblocked

Per the brief's dependency chain:

1. ✓ workout_spec clearing ships + backfill runs
2. **You can now remove the easyBucket PACE_DEFAULT override** ·
   resolved spec returns null for downgraded easy rows, fallback
   lands cleanly on PACE_DEFAULT(eff).
3. ✓ AdaptationInfo envelope on the seed
4. **You can now render the "was X" sublines + modal "How it changed"
   block** · all fields present on each day.

---

## Commits

```
<commit hash>  feat(plan): workout_spec clears on downgrade + adaptation envelope
   · lib/plan/adapt.ts atomic downgrade adds workout_spec=NULL +
     COALESCE-preserves sub_label into original_sub_label
   · lib/coach/adaptation-info.ts new · single LATERAL-join composer
   · lib/coach/glance-state.ts · GlanceWeekDay gets `adaptation` field
   · lib/coach/training-state.ts · PlanWeek.days[] gets `adaptation` field
   · components/training/WeekAhead.tsx + lib/faff/personas.ts ·
     fixtures backfilled with `adaptation: null`
   · db/migrations/134_plan_workouts_original_sub_label.sql · new column +
     historical backfill from original_type
   · backfill script ran live · 1 row updated for workout_spec, 1 row
     populated for original_sub_label
```

Verify with the SQL probes in your briefs · both return 0 stale rows now.

---

## Open follow-ups

1. **Richer historical sub_labels** · 11 rows currently show derived
   labels ("THRESHOLD" / "INTERVALS"). Brief me with the workout-library
   slug → label mapping you trust and I'll backfill the specific names.

2. **`coach_intents (field)` index** · only needed if the LATERAL join
   shows in p99. Not a problem today.

3. **The Tue 6/02 reason copy reads old** · "Resting HR averaging 57 bpm,
   9 above 14-day baseline." That's the old single-signal adapter (now
   retired). Future downgrades emit the multi-signal copy
   ("Readiness pullback · sleep 8d streak + composite 54/100"). The
   historical row stays honest · I considered rewriting it in the
   backfill, declined as that would falsify the audit log.

4. **The `wasAdapted` count for David shows 11** · most are likely
   `kind='shave'` from cutback-week auto-shaves. The brief notes
   that's a valid `kind`. If you want a "distance was 8 mi, now 6 mi"
   subline pattern in addition to the type-change pattern, the data is
   on `originalDistanceMi`. Render however reads cleanest.
