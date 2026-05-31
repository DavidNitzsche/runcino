# Backend payloads now available · for the design agents

**As of commit `31b8519e` · 2026-05-31**

The backend exposes new structured signals that web + iPhone haven't designed treatments for yet. This brief tells you what's there, where to fetch it, what the shape looks like, and where it naturally wants to land.

You are not required to render any of this. The intent is to surface what's available so the next design pass can decide whether (and how) each signal earns a place on a screen.

---

## What changed

Two backend systems landed today and one bug got fixed:

1. **Canonical run model** · `lib/runs/canonical.ts` + `lib/runs/merge.ts`. ONE row per actual run; multiple providers (Faff watch app, Apple Watch via HK, Apple Health, Strava) enhance the same row instead of duplicating. Source priority is **watch > manual > apple_watch > apple_health > strava**. Per-field attribution lives in `strava_activities.provenance` jsonb.
2. **Purpose + recap engine** · `lib/coach/run-purpose.ts`, `lib/coach/run-recap.ts`, `lib/coach/weather-adjust.ts`. Deterministic coach layer that produces "WHY THIS RUN" (pre) and "WHAT THIS RUN DID" (post) from workout type + phase + execution + conditions, with research citations.
3. **Weather over run duration** · `lib/weather/openmeteo.ts`. Was a single-point snapshot at start. Now samples every hour bucket the run touches and produces `temp_f_start / temp_f_end / temp_f_peak / temp_f_mean`. Recap engine prefers `temp_f_peak` for judgment.

---

## New API endpoints

### `GET /api/today/purpose?date=YYYY-MM-DD`

Returns the **pre-run "WHY THIS RUN"** payload for today (or any date). Used to replace the hardcoded `planVerdict(d.type)` / `planRecap(d.type)` strings in `components/faff-app/views/TodayView.tsx`.

```jsonc
{
  "ok": true,
  "date": "2026-05-31",
  "type": "long",              // easy | long | tempo | threshold | intervals | recovery | shakeout | race | rest | unplanned
  "phase": "BASE",             // BASE | BUILD | PEAK | TAPER | RECOVERY | OFF | null
  "plannedMi": 12.1,
  "raceDistanceMi": 26.2,
  "weeksToRace": 11,
  "verdict": "Build the base.",
  "facts": [
    "Marathon-specific aerobic stimulus. Long efforts above ~8 mi push mitochondrial biogenesis, slow-twitch oxidative capacity, and the fat-oxidation pathways your last 10K depends on.",
    "Fuel early and often. Run the first half by feel and let it settle in · pick up the final third only if everything is clicking."
  ],
  "citations": [
    { "slug": "research-04-workout-vocabulary",        "label": "Research/04 · Workout Vocabulary" },
    { "slug": "research-00a-distance-running-training", "label": "Research/00a · Distance Running Training" },
    { "slug": "research-01-pace-zones-vdot",            "label": "Research/01 · Pace Zones VDOT" }
  ]
}
```

**Verdicts are short (3-5 words).** Facts are 1-2 short sentences each. Citations are stable slugs into `learn_articles` so the UI can deep-link into the in-app reader.

### `GET /api/runs/[id]/recap`

Returns the **post-run "WHAT THIS RUN DID"** payload for a specific canonical run.

```jsonc
{
  "ok": true,
  "runId": "-16421550262950",
  "date": "2026-05-31",
  "type": "long",
  "phase": "BASE",
  "verdict": "Banked the long.",
  "facts": [
    "Long aerobic stimulus banked · 12.4 mi at 8:00/mi, avg HR 154. The mitochondrial and capillary work doesn't care about the last-mile split — what counts is the time the slow-twitch fibers spent under load.",
    "HR climbed 13 bpm from first half (150) to last (163) — cardiovascular drift at this temperature is expected, not a fitness signal. You did the right thermoregulatory work; the engine stayed honest."
  ],
  "conditions_note": "69°F → 78°F (peak 78°F) · extreme heat stress · dewpoint 50°F · Maughan/Ely model expects ~20.7% honest slowdown vs 50°F.",
  "coach_tip": "Reschedule hard sessions out of this window · the slowdown is large enough that quality work loses its purpose. Heat acclimation across 10-14 days is the real prep if you're racing in conditions like these.",
  "citations": [
    { "slug": "research-04-workout-vocabulary",   "label": "Research/04 · Workout Vocabulary" },
    { "slug": "research-15-wearable-data",        "label": "Research/15 · Wearable Data" },
    { "slug": "research-06-weather-adjustments",  "label": "Research/06 · Weather Adjustments" }
  ]
}
```

**`conditions_note` is null when conditions were neutral** — don't render the row at all in that case. Same for `coach_tip`.

---

## Surfaces that should consume these

### Web

| Surface | Endpoint | Where to wire |
|---|---|---|
| `/today` UPCOMING right card | `/api/today/purpose` | `components/faff-app/views/TodayView.tsx` · `PlannedHeroV2` · replaces the hardcoded `planVerdict(d.type)` + `planRecap(d.type)` calls. The verdict goes in the heading, facts go in the body, citations earn a small "Why this run · Research/04" footer. |
| `/today` COMPLETED hero | `/api/runs/[id]/recap` | `CompletedHeroV2` in the same file. Pull when `d.done && d.activityId`. Verdict + facts replace the current static post-run copy; conditions_note + coach_tip earn their own treatment (think compact callout, not paragraph). |
| Activity drawer (the modal that pops on a week-strip click) | `/api/runs/[id]/recap` | Same payload. Currently shows splits + route + zones — the recap belongs above the splits section as the "what just happened" framing. |

### iPhone

| Surface | Endpoint | Notes |
|---|---|---|
| `TodayView` pre-run brief card | `/api/today/purpose` | Native swiftUI render; do NOT web-view-wrap. Match the Today hero's verdict/facts treatment. |
| `TodayView` post-run brief card | `/api/runs/[id]/recap` | When the day has flipped to DONE. Conditions note + coach tip earn their own visual treatment so the runner spots them. |
| `RunDetailView` | `/api/runs/[id]/recap` | The recap is the headline above the route map + splits. |
| Watch `SummaryView` (FaffWatch) | — | Verdict-only, no fetch · the watch sends `WatchCompletion` and renders its own quick summary. If the verdict eventually flows back via WCSession reply it'd be nice, but not required for first pass. |

### Honest spots where we don't yet design

- **History list rows** · could show the verdict as a one-liner subtitle but mostly that's noise · the runner is scanning dates. Probably skip.
- **Weekly digest** · once we have N runs, the engine can roll multiple recaps into a week summary. Out of scope here.

---

## What "rooted in research" means in the payload

Every fact comes from the deterministic engine reading **doctrine**, not boilerplate. Examples:

- **"mitochondrial biogenesis, slow-twitch oxidative capacity"** for a marathon long-run is paraphrased from `Research/00a § Aerobic Base Development` and `Research/04 § Long Runs`.
- **"Maughan/Ely model expects ~20.7% honest slowdown"** is a direct lookup against the `Research/06 § Heat Adjustment by Air Temperature` table (RunnersConnect dewpoint multiplier applied).
- **"cardiovascular drift at this temperature is expected"** is `Research/15 § Wearable Data`'s framing of the HR-drift signal.
- **"Heat acclimation across 10-14 days"** comes from `Research/06 § Heat Acclimation`.

The `citations` array is stable. The runner should be able to tap a citation chip and land in the in-app reader on the matching article (already implemented at `/learn/[slug]` for some surfaces).

---

## Heat-aware coach voice · what changed today

The engine treats heat as **doctrine, not a vibe**. Three things to know:

1. **The "WHAT" comes from `weather.temp_f_peak`, not `weather.temp_f`**. The headline reads "69°F → 78°F (peak 78°F)" when the climb was material (≥3°F). Single-temp display is fine when the run sat in one bucket.

2. **HR drift gets re-framed as physiology when conditions earn it.** Same +13 bpm drift reads differently in cool weather ("fueling + hydration cadence are the usual culprits") vs hot weather ("cardiovascular drift at this temperature is expected, not a fitness signal").

3. **Coach tips are forward-looking.** Not "you should have done X." More like "next time when possible, start earlier" or "if you're racing in these conditions, 10-14 day heat acclimation is the real prep."

There's a `heatBand` field on the engine output (`neutral | warm | hot | extreme`) — if you want a visual treatment (e.g., flame-color the conditions chip), that's the lever.

---

## Doctrine + design contract for these payloads

To keep the coach feeling like one voice:

- **One sentence ≤ one idea.** If a fact's 30+ words, split it.
- **No prescription verbs in the recap.** "You should have…" / "Try…" is for the coach_tip slot. Recap states what landed; tip suggests what to consider.
- **Cite or be silent.** Every claim should have a citation backing it. If you write copy that the engine doesn't produce, you're inventing.
- **Heat language is honored.** When `conditions_note` is non-null, do NOT show a generic "you faded in the back half" frame elsewhere on the screen. The recap already explained it.
- **The verdict is the headline, not a label.** Treat it visually like a sentence, not a tag.

---

## What's still gap

These are real but not on this commit:

- **Mile-level HR + pace data** in `data.splits[]` is sometimes missing for watch-source rows (HK doesn't always populate per-split HR). The engine's drift detection silently degrades when it sees too few HR-tagged splits. Worth a follow-up in the watch ingest path.
- **Mid-run weather** (rain started halfway, wind shifted) is rolled into the span sample but the recap doesn't yet narrate "rain started at mile 8." Future enhancement.
- **The hardcoded `planVerdict` / `planRecap` strings** in `TodayView.tsx` are still in the codebase. They're effectively dead code once the web surface fetches from the endpoint, but they're the safe fallback while the wiring happens.

---

## Quick smoke test

Hit the endpoints with a session cookie:

```bash
# Pre-run
curl https://www.faff.run/api/today/purpose \
  -H "Cookie: faff_session=<token>"

# Post-run (use any canonical run id)
curl https://www.faff.run/api/runs/-16421550262950/recap \
  -H "Cookie: faff_session=<token>"
```

iPhone uses Bearer auth: `Authorization: Bearer <token>` on both.

---

## Files for reference (in case design wants to read the source)

```
web-v2/lib/coach/run-purpose.ts        · the "why" engine
web-v2/lib/coach/run-recap.ts          · the "what" engine
web-v2/lib/coach/weather-adjust.ts     · heat / dewpoint / sun-load doctrine
web-v2/lib/weather/openmeteo.ts        · span-aware enrichment + polyline decode
web-v2/app/api/today/purpose/route.ts  · pre-run endpoint
web-v2/app/api/runs/[id]/recap/route.ts · post-run endpoint
```

That's the whole payload surface. Open question for the design pass: should `coach_tip` get its own card or fold into the conditions row? That's a design call, not a doctrine call.
