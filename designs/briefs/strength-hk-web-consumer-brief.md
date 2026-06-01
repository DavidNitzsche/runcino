# Brief · strength HK · web consumer surface

**For:** web frontend agent
**From:** backend / coach-engine agent
**Date:** 2026-06-01
**Status:** Backend ready · web consumes through FaffSeed
**Companion to:** `designs/briefs/strength-hk-ingest-brief.md` (iPhone side)

---

## TL;DR

iPhone-side HK strength ingest is the iPhone agent's job. **What you
render is on FaffSeed today.** Three new things to consume + two
behavior shifts you'll see in production.

---

## What's new on the seed

### `glance.strengthWeekStatus` (NEW)

Already shipped at commit `5240ed5a`. Per-week reconcile of
`recommendedStrengthDays` (recommender output) against what was
actually logged in `strength_sessions` (manual + HK + watch + strava).

```ts
strengthWeekStatus: {
  weekStartISO: string;          // Monday of the current week
  weekEndISO: string;
  recommended: string[];         // ISO dates the recommender picked
  confirmed: Array<{             // session logged on a recommended day
    date: string;
    sessionId: number | null;
    source: 'manual' | 'apple_health' | 'watch' | 'strava' | null;
    durationMin: number | null;
    sessionType: string | null;
  }>;
  skipped: string[];             // recommended date that passed (≤today) with no session
  bonus: Array<{                 // session on a NON-recommended day
    date: string; sessionId; source; durationMin; sessionType;
  }>;
  summary: string;               // "2/2 this week + 1 bonus" / "1/2 · 1 skipped"
} | null
```

Null when no recommendation produced yet (cold path). Otherwise always populated.

**The `summary` field is render-ready** for a chip. The full arrays
are there if you want richer surfaces.

### `session.source` per row (extended)

`GET /api/strength?days=14` now returns `source` + `hk_uuid` on every
row:

```ts
{
  id: number;
  date: string;
  session_type: string | null;
  duration_min: number | null;
  notes: string | null;
  source: 'manual' | 'apple_health' | 'watch' | 'strava';
  hk_uuid: string | null;
  created_at: string;
}
```

Render hook · small provenance badge on each row in a strength history view:

| source | Suggested chip |
|---|---|
| `manual` | (none · default · don't clutter) |
| `apple_health` | "from Apple Fitness" |
| `watch` | "from Apple Watch" |
| `strava` | "from Strava" |

### `POST /api/strength` accepts the new fields

Manual log (unchanged · what LogNonRunSheet on iOS sends today):
```json
{ "date": "2026-06-01", "session_type": "compound lift",
  "duration_min": 45, "notes": "..." }
```

HK ingest (iPhone-only path · not your concern but listed for context):
```json
{ "date": "2026-06-01", "session_type": "strength",
  "duration_min": 45, "source": "apple_health", "hk_uuid": "ABC-123" }
```

Web manual-log forms (if any) should keep posting WITHOUT source ·
defaults to `'manual'`. If you want web to explicitly tag its origin,
post `source: 'manual'` · functionally identical, just explicit.

**Validation rule** · `source='apple_health'` requires `hk_uuid` ·
backend returns 400 otherwise. Web-side manual paths never trip this
since they don't send source.

---

## Behavior shifts you'll see in production

### 1. Strength chip lights up for Apple-Fitness lifters

Before HK ingest, a runner doing 2 sessions/week via Apple Fitness
showed:
- Chip: "0/2 this week"
- Recommender habit: `dormant` (false positive)
- Dormant coach intent fires (annoying)

After (once iPhone agent ships HK importer):
- Chip: "2/2 this week" (or with bonus)
- Habit: `on_track`
- Dormant intent doesn't fire

If you have copy that says "log your strength" or similar prompts,
they'll fire less. That's correct · the runner IS logging, just
through Apple Fitness instead of LogNonRunSheet.

### 2. ACWR ticks up for strength-heavy weeks

Backend folded `strength_sessions.duration_min × 0.07 mi/min` into
ACWR at commit `9ad0d31b`. Heavy strength weeks will show higher
ACWR than they did before · the LOAD pillar on the readiness brief
becomes more accurate. Visible in:

- `glance.loadAcwr` (ticks up)
- Readiness brief's LOAD pillar tile (may shift band)
- Form view's ACWR display
- Adapter behavior (slightly more likely to fire `readiness_pullback`
  on heavy-strength weeks)

David has 0 logged sessions right now so it's a no-op for him today.

---

## What to render · concrete suggestions

### Today view · the strength chip near the week strip

Use `strengthWeekStatus.summary` directly. Examples:

```
2/2 this week              ← all confirmed, no bonus
2/2 this week + 1 bonus    ← bonus day on top of recommendation
1/2 this week · 1 skipped  ← one missed
0/2 this week · 2 skipped  ← week-failed pattern
3 bonus sessions this week (none scheduled)  ← race week with off-script lifts
```

Tap the chip to expand · render `confirmed[]` + `skipped[]` + `bonus[]`
as three sub-sections with per-day rows. Each row gets:
- Date pill
- Session type label
- Duration
- Source chip (when not 'manual')

### Strength history list · the per-row provenance badge

If you have a "strength sessions" list view (Activity or Profile),
add a small text badge under each row when source is non-manual:

```
Mon 5/26 · Compound lift · 45 min       MANUAL
Wed 5/28 · Strength · 38 min            FROM APPLE FITNESS
Fri 5/30 · Functional strength · 30 min FROM APPLE FITNESS
```

Tells the runner where the row came from without making them dig.

### Adapter / coach voice · "we skipped today" surfacing

`coach_intents` already carries the `strength_skip` rows the recommender
writes when it suppresses or caps strength due to readiness signals
(shipped at commit `f5a94d3f`). Your existing coach-intent reciter
should already be picking these up.

If you have a "yesterday recap" or "what happened" surface, the
`skipped[]` array gives you the data: "Strength didn't land Tue ·
sleep streak triggered the suppression."

---

## Edge cases to handle in the renderer

| Case | Behavior in the data | Render call |
|---|---|---|
| Recommender returned empty days (race week) | `strengthWeekStatus.recommended = []`, `summary = "No strength surfaced this week"` | Hide chip entirely or render the summary string |
| Bonus session same day as a confirmed one | `confirmed[i]` has the first session, `bonus[]` has the second | Show both, group by date if rendering chronologically |
| Apple Fitness session for a quality-conflict day | Session lands as `bonus` (recommender wouldn't have recommended that day) | Renders the way every bonus session does · no special case |
| Runner deletes a manual log | `sessions` list shrinks by one, `strengthWeekStatus` recomputes on next render | Standard re-fetch · no special handling |
| Future · iPhone implements HK DELETE | Could remove a `confirmed[]` row mid-week, flipping it to `skipped[]` | Render handles this via the standard data path; consider an "Apple Fitness removed this" toast if you want to be explicit |

---

## Endpoints you might call

```
GET  /api/strength?days=14           list recent · returns source + hk_uuid
POST /api/strength { date, session_type, duration_min, notes }
                                      manual log · LogNonRunSheet pattern
GET  /api/strength?days=90           backfill / habit-trend longer window
```

No DELETE endpoint currently. If you want one for the manual UI's
"undo log" affordance, file a quick brief and I'll add `DELETE
/api/strength?id=N` · ~5 min.

---

## What's already done · no action needed

- `seed.strengthRecommendation` (recommender output · already wired)
- `seed.strengthRecommendation.coachIntent` (dormant habit · already wired)
- Coach-intents `strength_skip` + `strength_resume` events (briefing reads them)
- ACWR fold (transparent · backend handles it)
- The recommender → readiness brief coupling

The web rendering layer is largely already in place · you just need to
consume `strengthWeekStatus` (new) + the `source` field on individual
sessions (new) + decide on the provenance badge copy.

---

## How to respond

Reply with:
1. Confirmation that `strengthWeekStatus.summary` is enough chip copy ·
   or push back with a richer shape you want.
2. Whether you want a DELETE endpoint for manual logs.
3. Any per-source rendering decisions (e.g. "Apple Watch sessions get
   a different chip than Apple Fitness ones") so I can tighten the
   source enum if needed.

---

## Related briefs

- `designs/briefs/strength-hk-ingest-brief.md` · iPhone side (HK importer)
- `designs/briefs/strength-recommender-backend-landed.md` · recommender contract
- `designs/briefs/backend-state-2026-06-01-landed.md` · today's full landings

---

## File map

```
web-v2/app/api/strength/route.ts                 GET + POST · accepts/returns new fields
web-v2/lib/coach/strength-status.ts              ⭐ reconciler · loadStrengthWeekStatus
web-v2/lib/coach/glance-state.ts                 surfaces strengthWeekStatus on glance
web-v2/db/migrations/133_strength_sessions_hk.sql  schema · already applied
```
