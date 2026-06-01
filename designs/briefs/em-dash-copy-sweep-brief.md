# Brief · em dashes in backend-authored copy

**For:** backend / coach-engine agent
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Copy bug · visible to David today on the morning brief

---

## The rule (locked across the app)

> No em dashes anywhere in copy or UI text. Periods, commas, or middot `·` separators only. En dashes only for numeric ranges (e.g. `5–10 reps`).

This is from `CLAUDE.md` + the running-app design brief. Applies to every string that surfaces to a runner · whether composed by frontend, backend, plan generator, or coach voice.

## The bug

David's morning brief on Today renders this headline:

> "SLEEP below for 8 days — the trend matters more than today's number."

The em dash (`—`) is in the backend's `readinessBrief.headline` string. Frontend renders it verbatim because the headline is coach-voice copy and the frontend shouldn't be rewriting it.

Likely also affects:
- Per-pillar `meaning` strings
- `streaks[].meaning`
- `movers[].label`
- `watchTomorrow` callouts
- Any other freeform copy the brief composer generates
- Coach intent bodies (`coach_intents.body`)
- Plan proposal `reason` and `message` strings

## What we need

Sweep every string composer in `web-v2/lib/coach/` and `web-v2/lib/plan/` for `—` characters and replace with the appropriate alternative:

| Use case | Replace with |
|---|---|
| Clause separator within a sentence ("8 days — the trend matters") | `·` (middot, surrounded by spaces) |
| Pause / appositive ("Sleep, the cumulative signal — matters") | comma or period, depending on flow |
| Numeric range ("8–10 reps") | en dash `–` (these are OK to keep) |

The middot pattern matches the visual language of the rest of the app. The runner already sees middots as the separator everywhere (chip metadata, conditions lines, citations).

## Where to look

A grep should find the source strings quickly:

```bash
grep -rn "—" web-v2/lib/coach/ web-v2/lib/plan/
```

Likely files:
- `web-v2/lib/coach/readiness-brief.ts` (the composer that built the visible string)
- `web-v2/lib/coach/readiness-history.ts`
- `web-v2/lib/plan/adapt.ts` (coach intent body composition)
- `web-v2/lib/plan/auto-rebuild.ts` (rebuild reason copy)
- Any string-template files / copy banks

## Why we're not fixing this client-side

We considered a frontend defensive sweep — replace all em dashes in any string we receive before rendering. Rejected because:
1. It strips legitimate em dashes from runner-authored content (notes, race comments) — those are user input, not coach copy, and we shouldn't sanitize them.
2. The rule lives at the COPY LAYER. Backend authors the copy, backend follows the rule. Frontend rewriting backend output is the wrong shape · same reason we don't have a frontend "fix typos in coach voice" layer.
3. It hides the bug. If the rule is broken at the source, we want it visible so it can be fixed at the source.

## Validation

After the sweep, run the grep again and confirm zero matches in `lib/coach/` and `lib/plan/`. Add a unit test or lint rule if you want a permanent guard (suggested test asserts no em-dash characters appear in composed brief output for a fixture user).

## How to respond

1. Confirm sweep complete.
2. Link the commit.
3. Flag any strings where you weren't sure of the right replacement — frontend will weigh in.
