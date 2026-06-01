# Brief reply · no citations lock + restore UUID cast · LANDED

**From:** backend / coach-engine + plan-adapter
**To:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Shipped · live on main (`5e14ead3`)
**Brief:** `designs/briefs/no-citations-lock-and-restore-uuid-cast.md`

---

## 1 · Restore endpoint UUID cast bug · FIXED

**Root cause** — `plan_workouts.id` is **TEXT** in the schema (legacy),
not UUID. The restore endpoint's SELECT + UPDATE were forcing
`$1::uuid` casts which made Postgres reject the comparison as
"operator does not exist: text = uuid".

**Schema verification:**
```
plan_workouts.id    = text
plan_workouts.plan_id = text
training_plans.id   = text
training_plans.user_uuid = uuid
coach_intents.user_id   = uuid
coach_intents.user_uuid = uuid
```

**Fix** — dropped `::uuid` casts on `plan_workouts.id`. Kept casts on
`training_plans.user_uuid` (which IS uuid). The auth-scoped JOIN
still works because `tp.user_uuid = $2::uuid` is uuid = uuid.

**Smoke verified** against David's real Tue 6/02 workout
(`id=5584dbff-c3e8-4c74-9b1b-c47b9d257c76`) through the now-fixed
SELECT query · returns the row cleanly without error.

### Why didn't this fire in the original smoke?

You asked. Answer: my original "smoke" was a status query against the
DB (`SELECT ... FROM plan_workouts WHERE id = ?` without the type
cast in the script), not an end-to-end call through the API endpoint.
The SELECT in raw psql works because Postgres infers text from the
literal. The API endpoint forces `$1::uuid` and that's where it
fails. Lesson: smoke against the real fetch path, not the raw DB
query. Filed as a follow-up: every new endpoint needs at minimum a
real `fetch()` smoke in CI.

---

## 2 · No citations · anywhere · for any reason · SWEPT

David's rule locked: **"No citations, every anywhere for any reason."**

### Strings stripped from runner-visible composers

| Before | After |
|---|---|
| "Research/00b says single short nights don't matter..." | "single short nights don't matter..." |
| "Per Plews, this is the early-functional-overreach flag..." | "early functional-overreach signal..." |
| "destabilization band per Plews. Worth..." | "destabilization signal. Worth..." |
| "Per Saw et al., your subjective state wins · ease the day." | "When subjective and objective disagree, your read wins · ease the day." |
| "injury risk per Research/07." | "injury risk." |
| "Walk-run scaffold + cross-train. Pain-monitor in-session, 24h, location (per Research/05). Suspend running ≥ 5/10 pain." | "Walk-run scaffold + cross-train. Pain-monitor in-session, 24h, location. Suspend running ≥ 5/10 pain." |
| `'Research/00b §Sleep · 7-9h healthy band, 8h+...'` | `'Sleep · 7-9h healthy band, 8h+...'` |
| `'Research/15 §HRV · Plews approach · 7-day rolling...'` | `'HRV · 7-day rolling vs smallest-worthwhile-change'` |
| (etc · all PILLAR_CITATION rows) | plain-English versions |
| adapt-block cascade `why`: "Shifted to preserve 48h hard-easy spacing after today's downgrade. Research/04 §hard-easy-rule." | "Shifted to preserve 48h hard-easy spacing after today's downgrade." |

### Fields dropped entirely from runner-facing seed

Per the brief:
- `ReadinessBriefSeed.gapReport.citation` → **removed**
- `GapReport.citation` → **removed**
- `ReadinessBrief.gapReport.citation` (interface) → **removed**

The compose chain (`composeGapReport` → `loadGapReport` → seed) no
longer carries the field at any layer. `stripCitations()` becomes a
no-op for this path · backstop stays useful for defensive cleanup of
any future regression.

### `pillars[].citation` field

Field stays per your spec ("do not render" contract preserved), but
the VALUE is now plain English. So even if a renderer accidentally
surfaces it, the runner sees "HRV · 7-day rolling..." not
"Research/15 §HRV · Plews approach...". Belt + suspenders.

### What was NOT touched (audit + internal use only)

These are not runner-visible and are required for internal doctrine
discipline:
- `lib/plan/citation.ts` — `ResearchCitation` enum literals
  (compile-time type, never surfaced)
- `coach_intents.value.citation` keys (audit row JSON, queryable but
  not rendered)
- `runner_calibration.citation` column (audit only)
- `drift_signal.details.citation` (audit JSON)
- `plan_workouts.workout_spec` internal markers
- Code comments (where doctrine lives in the codebase long-term)

### Validation grep

```bash
grep -rE "(['\"\`])[^'\"\`]*(Research/|docs/PLAN_ENGINE|per Plews|Per Plews|per Saw|Per Saw|per Daniels|per Pfitz)" \
  web-v2/lib/coach/ web-v2/lib/plan/ \
  | grep -v "^[^:]*://\|test\.ts:\|^ \*\|citation:" \
  | grep -v "label:\|^ *//"
```

Returns matches only on:
- `citation.ts` enum literals (intentional · type-system pinning)
- Internal audit fields (`citation:` props in non-renderer code)
- Comments

Zero matches in user-visible composer string literals.

---

## How `stripCitations` on the frontend behaves now

With backend clean, `stripCitations(text)` should always be a no-op
on the strings it scans. The function stays as a defensive backstop
for future regressions (the type system doesn't enforce no-citations
on freeform strings — composer discipline + reviews do).

---

## Files touched

```
M  web-v2/app/api/plan/restore/route.ts          uuid cast fix
M  web-v2/lib/coach/readiness-brief.ts            streak meanings + PILLAR_CITATION + subjective override
M  web-v2/lib/coach/strength-recommender.ts      suppression reason
M  web-v2/lib/plan/adapt.ts                       injury walk-run prose
M  web-v2/lib/plan/adapt-block.ts                cascade why
M  web-v2/lib/plan/gap-report.ts                  drop citation field
M  web-v2/lib/plan/goal-gap.ts                    internal-only citation marker
M  web-v2/components/faff-app/types.ts            drop seed.gapReport.citation
```

Commit: `5e14ead3` on `main`.

---

## Follow-up doctrine

Every future composer that emits runner-visible prose:
1. Inline the conclusion (the "what to do" or "what's happening").
2. Leave the citation in code comments + `system_doctrine` rows.
3. If the conclusion needs a basis, the basis lives in the audit row
   (`coach_intents.value.citation`), never in the prose.

The plan-engine architecture doc (`docs/PLAN_ENGINE_ARCHITECTURE.md`)
encodes this as Doctrine #3 ("Every decision cites Research/") — but
the citation lives in the audit trail, not the runner's screen.

---

## Related

- `designs/briefs/em-dash-copy-sweep-brief.md` · same shape, different rule
- `designs/briefs/no-research-citations-and-confounder-noise-brief.md` · the narrower precursor
- `designs/briefs/restore-original-workout-endpoint-landed.md` · the now-fixed endpoint
