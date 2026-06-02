# Brief · Backend → Web · GET /api/plan/diff endpoint shipped

**From:** backend agent
**To:** web agent
**Re:** "SEE THE NEW PLAN ›" link on `PlanProposalCard`
**Date:** 2026-06-02
**Status:** Backend endpoint shipped · web work outstanding

---

## TL;DR

David flagged that the "SEE THE NEW PLAN ›" link on the auto-applied
`PlanProposalCard` does nothing (`e.preventDefault()` + `router.refresh()`
in `PlanProposalCard.tsx:201`). Backend has shipped a `/api/plan/diff`
endpoint · web's job is to:

1. Build a `/training/plans/<newPlanId>/diff?from=<oldPlanId>` route
   that consumes the API
2. Update `PlanProposalCard.tsx` to actually navigate there

---

## Endpoint

`GET /api/plan/diff?from=<oldPlanId>&to=<newPlanId>`

Auth · session-required. Both plans must belong to the caller · 403 if
either is foreign. 404 if either plan id doesn't exist.

### Response shape

```ts
{
  ok: true,
  from: {
    id: string;
    label: string;
    authoredIso: string | null;
    archivedIso: string | null;
    totalMiles: number;     // sum of plan_workouts.distance_mi
    weekCount: number;      // distinct plan_weeks
  },
  to: { /* same shape */ },
  byDate: [
    {
      date: string;          // 'YYYY-MM-DD'
      old: WorkoutRow | null;
      new: WorkoutRow | null;
      changeKind:
        | 'unchanged'
        | 'distance'   // type same, distance differs > 0.1 mi
        | 'type'       // type changed (tempo → easy)
        | 'sub_label'  // type + distance same, label changed
        | 'added'      // exists only in new
        | 'removed';   // exists only in old
    },
    ...
  ],
  summary: {
    daysChanged: number;
    milesDelta: number;       // signed · positive = new plan adds miles
    qualityDaysChanged: number;
  }
}

interface WorkoutRow {
  date: string;
  type: string;             // 'easy' | 'long' | 'tempo' | 'threshold' | 'intervals' | 'rest' | ...
  distanceMi: number;
  subLabel: string | null;
  isQuality: boolean;
  isLong: boolean;
  workoutSpec: Record<string, unknown> | null;  // jsonb from plan_workouts
}
```

### Errors

| Status | Body                                                | When |
|--------|-----------------------------------------------------|------|
| 400    | `{ error: 'from + to plan ids required' }`          | Missing query params |
| 401    | (requireUserId fallthrough)                          | No auth |
| 404    | `{ error: 'plan <id> not found or not yours' }`     | One of the plans is missing or belongs to another user |

---

## Web work · what to build

### 1. New page · `/app/training/plans/[planId]/diff/page.tsx`

Server component. Reads `?from=<oldPlanId>` from search params, calls
the API, renders a structured comparison.

**Layout (suggested):**
- Header · "PLAN UPDATED" eyebrow + the old → new plan label
- Summary chip row · `daysChanged` · `milesDelta` (signed) ·
  `qualityDaysChanged`
- Per-week sections · group `byDate` entries by ISO week (`getISOWeek`)
- Within a week · one row per date. Row shape:
  - Date label
  - Old (left) · `type · distanceMi mi · subLabel`
  - Arrow (→ or =)
  - New (right) · same shape
  - Change kind badge (color-coded)

**Color-coding suggestion (use existing tokens):**
- `unchanged` · muted line · no row weight
- `distance` · amber accent on the changed number
- `type` · ember accent on the type chip
- `sub_label` · subtle italic on the label
- `added` · teal "NEW" badge
- `removed` · red "DROPPED" badge

### 2. Update PlanProposalCard.tsx

Currently:
```tsx
<a
  href={`/training`}
  onClick={(e) => {
    e.preventDefault();
    router.refresh();
  }}
>
  SEE THE NEW PLAN ›
</a>
```

Change to:
```tsx
<a href={`/training/plans/${proposal.newPlanId}/diff?from=${proposal.previousPlanId ?? ''}`}>
  SEE THE NEW PLAN ›
</a>
```

(Drop the `preventDefault` · let Next router handle it.)

### 3. Need backend to add `previousPlanId` on the proposal

The current `PlanProposalSeed.newPlanId` is the rebuilt plan. The diff
needs the OLD plan id too. Backend will add `previousPlanId` to the
seed shape and populate it on `auto_applied` proposals · web agent
should read `proposal.previousPlanId` from there.

I'll patch the proposal builder in a follow-up commit · ping me if
you need it sooner than tomorrow's session.

---

## Cache + caveats

- The endpoint is dynamic (`force-dynamic`) · no caching at this
  layer. The plans don't change after authoring (each rebuild
  produces a new plan id with `authored_iso` baked in), so feel free
  to cache on the client side or via `Cache-Control: private, max-age=300`
  on the page-level fetcher.
- Both plans may be archived · the endpoint doesn't filter by status.
  Renders the full comparison even if the "new" plan got superseded
  by a third rebuild.

---

## Smoke test

```
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://runcino.fly.dev/api/plan/diff?from=<oldId>&to=<newId>" | jq
```

Expect `byDate` to be an array sorted ascending by date, with
`changeKind` populated on every row.

---

## Related

- `web-v2/app/api/plan/diff/route.ts` · the endpoint (this brief)
- `web-v2/components/faff-app/cards/PlanProposalCard.tsx:198-217` ·
  the link to update
- `designs/briefs/backend-state-2026-06-01-landed.md` · prior auto-rebuild
  brief that this completes
