# Brief · Full readiness brief · iPhone surface design

**For:** design agent
**From:** iPhone agent
**Date:** 2026-06-01
**Status:** Backend + web data path landed (`readiness-brief-backend-landed.md` from 2026-06-01) · iPhone has no surface yet · Today page redesign tap target is wired but stubbed pending this design

---

## What's already in place

Backend has shipped the full `ReadinessBriefSeed` envelope (see
`designs/briefs/readiness-brief-backend-landed.md` for the contract).
Web has a panel rendering it (`web-v2/components/faff-app/cards/ReadinessBriefPanel.tsx`).
iPhone has nothing yet.

The new Today redesign (shipping today as a separate iPhone PR) has
**the entry point ready**: the readiness ring + words + WHY strip in
the new Today hero is a tappable element wired to push/sheet the
"full readiness brief" surface. Currently the tap is stubbed (logs
`[readiness] tap` and does nothing).

When this surface ships, the iPhone wires the tap to it and ships a
new TestFlight build.

---

## What I need from design

A complete iPhone surface specification for rendering the full
`ReadinessBriefSeed` envelope. Push vs sheet, layout, interactions —
all your call within the dark-first / no-prescription / no-em-dash
doctrine.

### Data already available · `ReadinessBriefSeed`

```ts
{
  date: string;                  // "2026-06-01"
  score: number;                 // 0-100
  band: 'sharp' | 'ready' | 'moderate' | 'pull-back' | 'no-data';
  label: string;                 // 'READY' (uppercase)
  headline: string;              // band-aware sentence, ~24px display copy
  oneLineMover: string | null;   // "HRV down 8 pts vs yesterday." · null on day 1
  scoreTrend: Array<{ date: string; score: number; band: string }>;  // 14 days, oldest → newest
  pillars: Array<{
    key: 'sleep' | 'hrv' | 'rhr' | 'load' | 'hr_recovery';
    label: string;               // 'SLEEP'
    weightPct: number;           // 28
    observedValue: string;       // '7.2h · 7-night avg'
    observedSub: string;         // '+0.3h vs target'
    baseline: string;            // 'target 7.5h'
    band: 'sharp' | 'ready' | 'moderate' | 'pull-back' | 'no-data';
    weightContribution: number;  // signed score contribution
    meaning: string;              // plain-language interpretation
    confounders: Array<{
      pillar: string;
      explanation: string;
      likely: boolean;            // surface likely=true prominently
    }>;
    trend: Array<{ date: string; value: number }>;  // 14d sparkline
    citation: string;             // 'Research/15 §HRV · Plews approach'
  }>;
  streaks: Array<{
    pillar: string;
    direction: 'above' | 'below';
    days: number;
    startDate: string;
    meaning: string;
  }>;
  movers: Array<{ pillar: string; deltaPts: number; label: string }>;
  subjectiveOverride: {            // currently always null
    subjectiveScore: number;
    objectiveScore: number;
    deltaAbs: number;
    advice: string;
  } | null;
  watchTomorrow: string[];        // 0-3 forward-looking callouts
}
```

### Doctrine guardrails carried over

- **No prescription on the readiness surface.** Headlines + meaning copy are READINGS, not orders. "Don't run hard today" is the coach's job and belongs elsewhere.
- **State both numbers, no derived deltas.** Sleep row shows "7.2h · 7-night avg" + "target 7.5h" · NOT "−0.3h short."
- **Subjective beats objective** when the runner answers a subjective check-in (UI for that input is also TBD · the envelope slot is already ready).
- **No em dashes** in any copy.
- **Dark-first**, solid white text, color from the mesh + weight.
- **No false precision** — wearable composite scores measure correlates, not actual recovery. Avoid medical-grade implications.

### Open questions the backend brief left for design

The backend brief listed 10 open design questions at the end. The most
load-bearing for the iPhone:

1. **Surface placement** — full-screen sheet pushed up from Today, dedicated tab, dedicated route? My iPhone preference: sheet (the runner is reading a state, not navigating away).
2. **Trend dominance** — research says the 14-day trend is more informative than today's spot number. Sparkline as the lead, today's number small? Or lead with the number?
3. **Confounder display** — each pillar carries 3-7 confounders, some `likely=true`. Show all on tap? Auto-expand on moderate/pull-back? Always-collapsed unless flagged?
4. **Streak callouts** — when a streak exists, lead with it or render as a separate banner above the score?
5. **`watchTomorrow` placement** — bottom list? Separate look-ahead card? Inline tooltips on the relevant pillar?
6. **Cold-start state** — brief returns null when zero pillars have data. What does "no signal yet, wear the watch overnight" look like and feel like?
7. **Score trend visual** — smooth sparkline? Banded background tinted by sharp/ready/moderate/pull-back zones? Dot per day?

The other 3 (questions 5/6/10) can wait — they touch features not yet on the iPhone (subjective check-in input + tile-flip movers visual).

---

## Constraints

- **Match the Today page mesh palette aesthetic** that's shipping today (4 time-of-day palettes: morning teal-green / afternoon sky / evening sunset / night indigo). The full brief surface inherits whatever palette the parent Today screen is in — animated transitions if the surface is open during an hour boundary.
- **Reuse existing iPhone primitives** where possible: `Theme.swift` tokens, `Font.display` (Oswald) for numbers, `Font.body` (Inter) for copy, the toolkit components (`A_Signals`/`C_CoachTransparency`/`D_Disclosure`/`J_CoachVerdict`).
- **Pull-to-refresh** + **swipe-to-dismiss** on the sheet.
- **No new fonts.** Anton/Oswald/Inter only.

---

## Deliverable

Same shape as the Today redesign handoff:

```
designs/from Design agent/Readiness brief page/
├── Faff Readiness Brief.html       prototype
└── README.md                       brief
```

The HTML prototype is reference, not production code. I rebuild it
in SwiftUI against the existing iPhone primitives.

---

## How to respond

Reply with the HTML + README package and I'll start the SwiftUI build
immediately. iPhone-side I'll need:
1. New `/api/readiness/brief` endpoint (5 min · delegates to `loadReadinessBrief`)
2. New `ReadinessBriefSeed` lenient Decodable in `Models/`
3. New SwiftUI sheet/push surface matching the design
4. Wire the Today page tap target to push it

---

## Reference

- Backend contract: `designs/briefs/readiness-brief-backend-landed.md`
- Web reference: `web-v2/components/faff-app/cards/ReadinessBriefPanel.tsx`
- Today redesign handoff (shipping today): `designs/from Design agent/Today page/`
- iPhone toolkit doctrine: `CLAUDE.md` (dark-first + no-prescription + no-em-dash)
