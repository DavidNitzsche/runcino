# Brief · no citations rule locked broader · restore endpoint UUID cast bug

**For:** backend / coach-engine + plan-adapter agents
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Two issues bundled · David's "no citations" rule needs to
broaden, and a real Postgres error is leaking through the restore
endpoint.

---

## 1 · No citations · anywhere · for any reason

David, 2026-06-01: **"No citations, every anywhere for any reason."**

Earlier I filed `designs/briefs/no-research-citations-and-confounder-noise-brief.md`
asking backend to stop emitting `Research/XX says ...` clauses in
composed coach-voice strings. David's new rule is broader · it covers
**every form of internal-doctrine citation**, not just `Research/XX`:

- `Research/00b says single short nights don't matter ...`
- `per Research/15 §HRV approach`
- `docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.3`
- `§Subjective Measures` standalone
- `Research/04 finds ...`

None of these surface to the runner. Doctrine lives in code comments
and engine logic. The runner's screen carries the conclusion in human
language, never the citation.

### What needs to change backend-side

Sweep every composed string. Strip:
- All `Research/X` references regardless of suffix
- All `docs/<any-md-file>` references
- All standalone `§Section` markers
- Any `per <doctrine-pointer>` inline clause

Fields known to carry citations today (audit + remove):
- `ReadinessBriefSeed.headline`
- `ReadinessBriefSeed.oneLineMover`
- `ReadinessBriefSeed.pillars[].meaning`
- `ReadinessBriefSeed.streaks[].short` + `streaks[].meaning`
- `ReadinessBriefSeed.trendNote`
- `ReadinessBriefSeed.watchTomorrow[]`
- `ReadinessBriefSeed.subjectiveOverride.advice`
- `ReadinessBriefSeed.coldStart.note`
- `ReadinessBriefSeed.gapReport.headline`
- `ReadinessBriefSeed.gapReport.whatClosesIt[]`
- `ReadinessBriefSeed.gapReport.riskFlags[]`
- `ReadinessBriefSeed.gapReport.alternativeRanges.a/b/c.label`
- `ReadinessBriefSeed.gapReport.citation` ← whole field should be dropped
- `coach_intents.body`
- `plan_proposals.message` + `reasons` keys

Also confirm: `pillars[].citation` is documented as "do not render"
and is already not rendered. Keep that contract.

Frontend `stripCitations()` has been broadened to handle these
patterns defensively (commit landing with this brief). It's a
backstop, not the structural fix.

### Validation

```bash
grep -rE "Research/|docs/|§" web-v2/lib/coach/ web-v2/lib/plan/ \
  | grep -v "^//\|^ \*\| \* " \
  | grep -E "(['\"`]).*(Research/|docs/|§)"
```

Should return zero matches inside string literals after the sweep.

---

## 2 · `/api/plan/restore` · UUID cast bug

David hit this in production: tapped "Restore original" on the hero
adaptation banner, frontend POSTed `{ workoutId: <uuid-string> }`,
backend returned:

```
"operator does not exist: text = uuid"
```

That's a Postgres type-mismatch error · the `WHERE id = $1` clause
compares the text parameter against the `plan_workouts.id` UUID
column without an explicit cast. Frontend was leaking the raw message
to the runner ("Could not restore: operator does not exist: text =
uuid"). Frontend now maps the message to a friendly fallback, but the
underlying query still fails so the runner can't actually restore.

### Likely fix

Add `::uuid` to the WHERE clause (and any other UUID column refs in
the restore endpoint):

```sql
UPDATE plan_workouts
   SET type             = COALESCE(original_type, type),
       sub_label        = COALESCE(original_sub_label, sub_label),
       distance_mi      = COALESCE(original_distance_mi, distance_mi),
       date_iso         = COALESCE(original_date_iso, date_iso),
       is_quality       = ...,
       original_type           = NULL,
       original_sub_label      = NULL,
       original_distance_mi    = NULL,
       original_date_iso       = NULL
 WHERE id = $1::uuid                       -- ← add explicit cast
   AND plan_id IN (
     SELECT id FROM training_plans WHERE user_uuid = $2 AND archived_at IS NULL
   )
```

Same for the SELECT that reads the row before mutation, and the
coach_intents INSERT that references the workoutId.

### Side question · why didn't this fire in smoke?

Your reply brief at `designs/briefs/restore-original-workout-endpoint-landed.md`
said you ran a smoke against David's actual Tue 6/02 workout
(`id=5584dbff-c3e8-4c74-9b1b-c47b9d257c76`). That should have
exercised the same code path that's now failing in production. Two
possibilities:

- The smoke ran against a different code path (direct SQL vs API
  endpoint).
- The smoke wired the workoutId differently (parameterized as uuid
  directly rather than text).

Worth verifying. If the API path was never end-to-end-tested with a
real fetch from the frontend, that's the test-harness gap to fix.

---

## How to respond

1. Confirm sweep complete · `stripCitations` should become a no-op
   if backend ships clean copy.
2. Confirm UUID cast fix shipped + smoke against the real API path.
3. PR links when shipped.
4. If `pillars[].citation` field is staying for diagnostics, confirm ·
   we don't render it but want to know if it's structural.

---

## Related briefs

- `designs/briefs/em-dash-copy-sweep-brief.md` · same shape, different
  copy rule. Locked principle: copy rule lives at the copy layer.
- `designs/briefs/no-research-citations-and-confounder-noise-brief.md` ·
  the narrower precursor to rule #1 here.
- `designs/briefs/restore-original-workout-endpoint-landed.md` · the
  reply that confirmed the restore endpoint shipped (commit d8a4082d).
  The UUID cast bug is in that endpoint.
