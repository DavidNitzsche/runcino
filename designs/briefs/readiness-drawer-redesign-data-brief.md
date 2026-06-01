# Brief · readiness drawer redesign · data the surface must carry

**For:** David (designing the redesigned readiness drawer)
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Data-only brief · no layout proposals, no visual treatment

---

## What this surface answers

One question, asked first thing in the morning:

> "Should I do today's planned session, ease off, or push harder?"

Everything in this drawer either supports that decision or shows the trend behind it. If a piece of data doesn't help answer the question (today or over the next 7 days), it belongs somewhere else.

The drawer opens from the readiness ring at the top of Today. It's the **single source of body-state context** in the app.

---

## Data inventory · everything available right now

All fields live on `seed.readinessBrief` (type `ReadinessBriefSeed` in `web-v2/components/faff-app/types.ts`). The backend composes this nightly from 5 pillars + Plews HRV + streak detection. Null when the runner has no recoverable health-data signal yet.

### Top-level

| Field | Type | What it carries |
|---|---|---|
| `date` | `YYYY-MM-DD` | The day this brief is for. |
| `score` | `0-100` | The composite readiness score. Same number that drives the ring. |
| `band` | `'sharp'\|'ready'\|'moderate'\|'pull-back'\|'no-data'` | Color-coded band. 5 states. |
| `label` | string | Human label of the band, e.g. `READY`, `PULL BACK`, `SHARP`. |
| `headline` | string | Coach-voice one-liner framing today. "SLEEP below for 8 days. Trend matters more than today's number." |
| `oneLineMover` | string \| null | Biggest day-vs-day delta as one phrase. "HRV down 8 pts vs yesterday." Null when nothing moved enough. |
| `scoreTrend` | `Array<{date, score, band}>` | 14 daily snapshots. Most recent last. Drives the trend strip. |
| `pillars` | `Array<Pillar>` | 5 entries · sleep, hrv, rhr, load, hr_recovery. Detail below. |
| `streaks` | `Array<Streak>` | 3+ day persistence events. Empty array when no streaks active. |
| `movers` | `Array<Mover>` | Biggest signed deltas vs yesterday across all 5 pillars. |
| `subjectiveOverride` | `{...} \| null` | Self-reported wellness override per Saw et al. UI deferred · slot null for now. See "what's not built" below. |
| `watchTomorrow` | `string[]` | 0-3 forward-looking callouts the runner should be aware of tomorrow. |

### Per pillar (5 of them: sleep, hrv, rhr, load, hr_recovery)

```ts
{
  key: 'sleep' | 'hrv' | 'rhr' | 'load' | 'hr_recovery';
  label: string;                  // 'Sleep' / 'HRV' / 'Resting HR' / 'Load' / 'HR Recovery'
  weightPct: number;              // 0-100 · the pillar's weight in today's composite score
  observedValue: string;          // e.g. '5.9h', '44ms', '47 bpm', '1.25 ACWR', '44 bpm drop'
  observedSub: string;            // e.g. '7-night avg', 'acute 6.4 · chronic 5.1 mi/day'
  baseline: string;               // e.g. 'target 7.5h', '55ms', '50 bpm', 'sweet spot 1.0-1.3'
  band: same 5-state enum;        // per-pillar band, can differ from composite
  weightContribution: number;     // signed pts this pillar contributed to today's score
  meaning: string;                // coach voice · one sentence
  confounders: Array<{ pillar, explanation, likely }>;
                                  // when this pillar is anomalous, which OTHER pillars
                                  // could explain it. Drives the "is this signal or noise" question.
  trend: Array<{ date, value }>;  // 14-day sparkline data for THIS pillar
  citation: string;               // e.g. 'Research/00b' · doctrine reference
}
```

### Per streak

```ts
{
  pillar: string;                 // which pillar is on a streak
  direction: 'above' | 'below';   // above/below baseline
  days: number;                   // length of the streak
  startDate: string;
  meaning: string;                // coach voice · why this matters
}
```

### Per mover

```ts
{
  pillar: string;
  deltaPts: number;               // signed · positive = today better than yesterday
  label: string;                  // coach voice · "HRV down 8 ms"
}
```

---

## Doctrine · NON-NEGOTIABLE constraints on the design

These are locked product calls from earlier briefs. The design must hold them.

### 1. No prescription on this panel · readings only

The panel surfaces the body's state and the trend. It does NOT tell the runner what to do. The coach voice prescribes from a different surface (coach intents, plan proposals, the actual planned workout). If this drawer says "skip today's threshold" AND a coach intent says "downgraded due to fatigue", you create contradictions. Keep them separate.

Allowed copy on this panel:
- Descriptions: "HRV down 8 pts."
- Trends: "Sleep below baseline 8 days running."
- Magnitude framing: "Cumulative debt compounds."
- Forward-looking observations: "Watch tomorrow if SLEEP stays below."

Forbidden copy on this panel:
- Imperatives: "Skip today's quality." / "Ease the load." / "Take a rest day."
- Conditional prescriptions: "If you do today's session, expect..."

The coach voice across the app lives elsewhere. This drawer is the diagnostic instrument.

### 2. State both numbers · never derived deltas

Always show: `observedValue` AND `baseline`. Never compute a delta like "−0.3h short" on the panel. Reasoning: a delta forces interpretation onto the panel that's better done in the runner's head with two numbers visible. Same applies to streaks (days + direction, not "days into the danger zone").

Allowed:
- "5.9h · 7-night avg" + "target 7.5h"
- "44ms" + "baseline 55ms"
- "1.25 ACWR" + "sweet spot 1.0-1.3"

Forbidden:
- "Sleep -0.3h short"
- "HRV 11 pts under baseline"
- "Load 0.25 over sweet spot"

### 3. Subjective beats objective

When the subjective wellness override slot fires (UI not built yet), its advice OVERRIDES the objective composite band. Per Saw et al. self-reported wellness is the strongest single recovery signal we have. The design should reserve a slot for this · when it lands, it sits ABOVE the objective composite, with the objective composite still visible but visually demoted.

### 4. No em dashes anywhere

Locked across the app · em dash `—` never appears in copy. Use periods, commas, or middot `·` separators. (The current backend headline copy has one em dash · we will fix backend-side. If you write copy specs in this brief's response, follow the rule.)

### 5. Dark first

The panel lives on the dark Today surface. Per-day effort-mesh background runs behind. Text stays `--txt` (solid white-ish), never auto-inverts. Color hierarchy comes from typographic weight + accent dots, not background blocks.

---

## Edge cases the design must handle

| State | What happens |
|---|---|
| `band === 'no-data'` | Fresh runner, no HK sync yet. Panel renders an empty state · "Connect Apple Health to start tracking" or similar, with the existing ProfileGapCard CTA. Don't render fake pillars. |
| `pillars[].band === 'no-data'` | One pillar missing (e.g. no HRV readings). Tile renders with `observedValue = '·'`, baseline shown, weightPct 0. Other pillars render normally. |
| `streaks` empty | Drop the section entirely · don't render "no streaks active" as a chrome row. |
| `movers` empty | Same · drop the section. |
| `watchTomorrow` empty | Same · drop. |
| `subjectiveOverride !== null` | Reserve a slot at the top (data shape future-proofed; UI not in this iteration). |
| `oneLineMover === null` | Skip that subline. |
| Score went from 70 yesterday to 42 today (today's screenshot) | The `band` reflects today only. The `scoreTrend` shows the drop. The `headline` + `oneLineMover` should call out the drop. The visual treatment of the trend should make the drop legible. |

---

## Adjacent data the drawer could reference (frontend can wire if you want)

Not on `readinessBrief` itself, but already on the seed envelope. Consider whether to mention any of these from this surface:

1. **`seed.form.acwr`** — same number that lands in the LOAD pillar but as a top-level number. Probably redundant; LOAD pillar is the canonical surface.

2. **`seed.planProposals`** with `kind === 'volume_drift'` — if there's a pending volume-drift proposal, it relates to LOAD. The drawer could surface a "VOLUME PROPOSAL pending" line that links to the card on Today. Or NOT and keep the panel diagnostic only.

3. **Coach intents stream (`/api/coach/intents`)** — already wired and surfaces on the briefing surface. The drawer COULD list the most recent 1-2 readiness-driven intents inline. Or NOT and rely on the existing CoachActivityTimeline for that.

4. **`seed.readiness.drivers`** — the existing 5-driver contribution rows in the current drawer (SLEEP/HRV/RHR/LOAD/HR with +pts/-pts bars). This is the SAME information as `pillars[].weightContribution` but in a different visual form (signed bars). Pick one representation, not both.

If you keep the existing "WHAT IS DRIVING IT" bars + a separate 5-pillar tile grid + a trend strip + streaks + movers + watchTomorrow, that's 6 sections of partially-overlapping data. Tight design culls duplication.

---

## Recommended sections of THIS data the drawer should carry, in my opinion (drop if you disagree)

Not a layout proposal · a content-priority list, ordered by what the runner needs to know to answer "should I do today's session, ease off, or push."

1. **Today's composite** · score, band, label, headline.
2. **Why** · per-pillar observed + baseline + weight contribution. The 5 tiles, OR the contribution bars · pick one.
3. **Trend** · scoreTrend over 14 days. Drop length / direction is the question runners care about.
4. **Persistence** · streaks (when present). Single bad nights don't matter, sustained dips do · the streak row is the framing for that.
5. **Forward callouts** · watchTomorrow (when present).

I'd consider dropping:
- `oneLineMover` if the headline already tells the story.
- `movers` if the 5-pillar tiles show contributions.
- Per-pillar `confounders` deep dive · likely belongs in a tap-deeper view, not the top-level drawer.

But this is your call · I'm telling you what's available, not what to ship.

---

## What's NOT built yet (worth knowing before you design)

1. **Subjective wellness 1-10 capture UI.** Slot exists in the data shape. When you decide to design it, file a separate brief and backend will plumb the capture flow.
2. **Per-pillar tap-deeper drill.** Currently `pillar.confounders` and `pillar.trend` (the 14-day sparkline of that one pillar) are unrendered. If your design wants tap-pillar → expand to show the pillar's own trend + confounders, frontend can build that.
3. **Adaptation provenance** ("today's quality was downgraded · sleep streak"). Adaptation-visibility brief is in flight backend-side. Once landed, the drawer could weave the adaptation into the headline. Optional.

---

## What's deliberately NOT in this brief

- **The Today header readiness ring** stays as-is regardless of what you do with the drawer. The ring is the always-visible summary; the drawer is the detail.
- **The Health view's readiness section** lives on its own surface (HealthView.tsx). Not in scope here. Same data may render differently there.
- **The right-side drawer chrome** (X button, overlay scrim, animations). That's pure design; this brief is about data only.
- **Mobile vs desktop.** Both should work; same data, layout may shift. Not specifying breakpoints here.

---

## How to use this brief

Write your design (mockup, HTML prototype, Figma frame · whatever shape your design process uses) referencing the field names above. Mark any sections where you want data the backend doesn't yet expose · I'll route those asks to the backend agent.

When ready, drop the design under `designs/from Design agent/readiness-drawer/` or wherever you prefer · I'll implement against it.

If you decide to keep some of the existing drawer's content (drivers bars, COACH line, View full health link) and only swap parts, that's fine · the new design just needs to specify what stays vs what's replaced.

---

## Related context

- `designs/briefs/readiness-brief-backend-landed.md` — the backend composer's full contract (the source of all this data).
- `designs/briefs/backend-state-2026-06-01-landed.md` — the catch-up, includes the doctrine guardrails this brief mirrors.
- `web-v2/components/faff-app/cards/ReadinessBriefPanel.tsx` — the inline panel I shipped today, dormant if you say to unmount it. Some bits (the pillar tile shape, the 14-day sparkline render) may be reusable in your redesign.
- `web-v2/components/faff-app/overlays/Drawer.tsx` — the existing drawer code (currently mounted on the readiness ring tap). What you're redesigning.
