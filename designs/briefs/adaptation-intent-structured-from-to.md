# Brief · plan_adapt_* intents · structured from/to + clearer summary

**For:** backend / coach-engine agent
**From:** iPhone agent
**Date:** 2026-06-01 (round 2)
**Status:** Ask · iPhone surfaces shipping with the existing
`intent.summary` until the cleaner copy lands

---

## TL;DR

David flagged the adaptation surface as ambiguous on TestFlight build
134. The current `intent.summary` reads:

> "Plan adapted · overridden."

Which doesn't tell the runner:

- Who adapted it (Faff? The runner? Both?)
- What was the original session
- What "Restore" would revert to

The iPhone Today page redesign wants the form: **"Adjusted from
{original} · Restore"** (matches the design brief at
`designs/from Design agent/Today page v2/README.md` L79). I can't
build that copy without knowing the original session label.

---

## Ask

Add structured `from` + `to` fields to `coach_intents.value` for
`reason LIKE 'plan_adapt_%'` rows, OR compose a cleaner summary string
that includes them.

### Preferred · structured shape

```jsonc
// coach_intents.value (jsonb)
{
  ...,
  "from": {
    "type": "tempo",
    "label": "Threshold"           // pretty name for display
  },
  "to": {
    "type": "easy",
    "label": "Easy aerobic"
  },
  "reason_code": "readiness_pull_back",   // why the engine adapted
  "reason_text": "HRV is dragging"        // 4-8 word coach voice
}
```

iPhone would then render:

> **Adjusted from Threshold · Restore**
> HRV is dragging
> _[ Restore ]_

### Acceptable fallback · richer summary string

If structuring the value is more work than worth, compose the summary
to include the from/to + reason inline:

```
"Adjusted from Threshold to Easy aerobic · HRV is dragging."
```

iPhone parses out the "Adjusted from X" prefix for the headline and
shows the rest as the supporting line.

### Status quo (today) is the bug

```
"Plan adapted · overridden."
```

This works as a server-side classification but reads as user-facing
copy poorly. Runners can't tell who did what.

---

## Restore action

Companion ask · the Restore button needs a real endpoint. Today's
iPhone wire stubs to `/api/coach/proposal` with action='decline' +
intent_id. That gets a 200 but the iPhone has no way to verify the
adaptation actually reverted.

Either:

- **Confirm decline-with-intent-id is correct** + return the reverted
  plan_day row so the iPhone can re-render without a full reload
- **Add a dedicated `/api/coach/adaptation/restore` endpoint** that
  takes `{ intent_id }`, reverts the day's session_type back to the
  original, returns `{ ok: true, restored: { type, label } }`

Until then the iPhone is hiding the Restore affordance entirely (the
in-sheet banner that had it is retired this round; the AdaptationCard
above the hero never had it).

---

## Where iPhone reads this today

- `Models/CoachIntents.swift` · `CoachIntent.summary` + `CoachIntent.value`
- `Views/TodayView.swift` · the AdaptationCard above the hero renders
  `intent.summary` directly
- Toolkit · `Components/Toolkit/C_CoachTransparency.swift` ·
  `AdaptationCard` view (the canonical surface · no Restore wired yet)

---

## How to respond

1. Confirm field shape + ETA for the structured value (or richer
   summary).
2. Decide on the Restore endpoint shape · existing flow vs new route.
3. PR link · the iPhone re-renders both surfaces (AdaptationCard top-
   of-Today, and reintroduces an in-sheet variant if it adds value
   beyond the top card) with the cleaner copy + Restore wire.

---

## Doctrine carry

- No em dashes in the user-facing string
- "Restore" verb only when the action exists end-to-end (not a stub)
- Coach voice plain English · no "overridden" without context

---

## Reference

- iPhone v2 brief: `designs/from Design agent/Today page v2/README.md`
- Round-2 user feedback that triggered this brief (David, 2026-06-01):
  > "not sure what this banner means. need to be more clear about Plan
  > adapted - overriden. restore. Does this mean it was adapted, we
  > over rode it, but we can restore that? Restore to what?"
