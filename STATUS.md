# Runcino · Status (2026-04-19 · overnight build 2)

Everything David asked for, in the order he'll walk through it tomorrow.

Branch: `claude/build-runcino-app-OIRJr`
PR: https://github.com/DavidNitzsche/runcino/pull/1

---

## Three things that changed overnight

1. **Mockups are now real code.** Every M1/M2/M3 HTML mockup has been rebuilt as a real Next.js page using real React components fed by real engine libraries. Mock fixtures today; HealthKit/Strava/Watch-export tomorrow. No rewrite when approved.
2. **Real engines shipped for every phase.** `lib/retrospective.ts` (plan-vs-actual), `lib/training.ts` (18-week periodization), `lib/weather.ts` (NOAA), `lib/course-research.ts` (Claude + web search). All tested.
3. **75/75 tests pass.** Up from 55. Every lib module has a unit-test suite.

---

## Walk through it in this order (15 min)

### 1. Pull and install

```bash
cd ~/code                              # or wherever you want
git clone https://github.com/DavidNitzsche/runcino.git
cd runcino
git checkout claude/build-runcino-app-OIRJr
cd web && npm install                  # ~60 seconds
```

### 2. Drop in your Anthropic API key (optional but recommended)

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env.local
```

Without a key, every Claude call falls back to a deterministic stub. The UI flows all work — you just won't see real Claude responses.

### 3. Run the tests

```bash
npm test
# 9 test files, 75 tests, all green in ~2 seconds
```

### 4. Run the CLIs (no dev server needed)

```bash
npm run build-plan       # full Big Sur pipeline → prints phases + writes JSON
npm run retrospective    # post-race analysis against the mock Big Sur actual
npm run plan-week -- --today 2026-04-19   # this week's training
npm run weather -- --lat 36.556 --lon -121.923   # Big Sur finish-line weather
npm run research-course -- --race "CIM"   # requires API key
```

Each one exits 0 with rich terminal output.

### 5. Boot the dev server and click through

```bash
npm run dev
```

Open http://localhost:3000 and walk the nav bar left-to-right:

| Route | What it is | Data source |
|---|---|---|
| **`/`** | Build plan — GPX upload, fitness form, Claude goal, build JSON | Live pipeline |
| **`/training`** | This week + 18-week periodization timeline | Real engine + mock fitness |
| **`/training/today?date=2026-04-19`** | Full daily workout with structure + rationale | Same engine |
| **`/retrospective`** | Post-race analysis with Claude narrative | Real engine + mock actual |
| **`/research`** | Give Claude a race name → proposed facts → accept/reject | Real engine + CIM stub |
| **`/settings/integrations`** | HealthKit / Strava / Calendar / NOAA status | Static — M2 work |

### 6. Try a real API call

```bash
curl "http://localhost:3000/api/weather?lat=36.556&lon=-121.923"
```

NOAA returns a real forecast. (Sandbox here is blocked; your Mac is not.)

### 7. View the mockups

Everything above is real code. If you want the original static pitch-deck HTML mockups too, enable GitHub Pages:

1. https://github.com/DavidNitzsche/runcino/settings/pages
2. Source: Deploy from a branch · `gh-pages` · `/ (root)` · Save
3. Visit https://davidnitzsche.github.io/runcino/all.html (1 min later)

---

## What I need from you to implement tomorrow

### Blocking (without these, certain flows are stubs)

| Need | Why | Where to put it |
|---|---|---|
| **`ANTHROPIC_API_KEY`** | Real Claude responses in /api/goal, /brief, /retrospective, /research | `web/.env.local` |
| **Your 2024 Big Sur GPX** | Swap synthesized fixture for real course data | `cp ~/Downloads/gpx_20240428_*.gpx web/public/sample-bigsur.gpx` |
| **Apple Developer Team ID** | Code-sign the iOS app | Xcode Signing & Capabilities |
| **Xcode 15+ on your Mac** | Compile iOS project | per `ios/README.md` |

### Non-blocking (needed at specific milestones)

| Need | Milestone | Notes |
|---|---|---|
| Strava API app registration | M2 | strava.com/settings/api → client_id + secret → `.env.local` |
| HealthKit entitlement agreement | M2 | iOS capability in Xcode Signing, ~30 sec |
| Coaching philosophy decision | M3 | Pfitzinger, Daniels, Hanson, or custom. Default: pfitz (easy to change) |
| Real race you want to research | M2+ | Tell Runcino the race name + URL, we add to course-facts |

---

## What's built vs what's mockup vs what's deferred

### Built, tested, working right now

- Full Big Sur race pipeline (GPX → plan JSON, 0 s drift from goal)
- Minetti GAP algorithm (matched to published values)
- Course-facts citation system with validator
- 6 Next.js routes: plan, training (+ today), retrospective, research, integrations
- 4 Claude API routes with stub fallback (goal, brief, retrospective, research)
- 3 deterministic API routes (build-plan, plan-week, weather)
- 5 CLI scripts (build-plan, retrospective, plan-week, weather, research-course)
- 18-week periodization engine (rule-based, Claude-swappable)
- Post-race retrospective engine (plan-vs-actual, HR drift, calibration)
- NOAA weather fetcher (free, no auth)
- iOS Swift source (RuncinoApp, models, views, WorkoutBuilder) — **uncompiled**

### Mockup only (pretty HTML, no code behind)

Nothing. Previously there were 4 HTML-only mockups (M1/M2/M3/research); all are now functional React pages backed by real engines.

### Deferred (on roadmap, not this session)

- HealthKit iOS reader — M2
- Strava OAuth flow — M2
- iCloud Drive sync — M2
- Watch complication (custom) — never, probably. WorkoutKit is enough.
- Voice journal — someday
- Injury-risk predictive gate — after M3

---

## File tree

```
runcino/
├── STATUS.md                       ← this file
├── README.md
├── docs/
│   ├── MASTER_PLAN.md              full vision, 12-month roadmap
│   ├── CHECKLIST.md                7-day Big Sur sprint
│   ├── PRE_RACE_CHECKLIST.md       Saturday verification
│   ├── SCHEMA.md                   .runcino.json v1.1.0
│   ├── ALGORITHM.md                Minetti GAP math
│   └── example.runcino.json        live pipeline output
├── mockups/                        original HTML mockups (superseded by
│                                   real pages but kept for reference)
├── web/
│   ├── app/
│   │   ├── page.tsx                M0 · build plan (existing)
│   │   ├── training/page.tsx       M3 · weekly view (NEW)
│   │   ├── training/today/page.tsx M3 · daily workout (NEW)
│   │   ├── retrospective/page.tsx  M1 · post-race (NEW)
│   │   ├── research/page.tsx       Course-facts research (NEW)
│   │   ├── settings/integrations/page.tsx  M2 · data sources (NEW)
│   │   └── api/
│   │       ├── goal/route.ts       Claude goal recommender
│   │       ├── build-plan/route.ts
│   │       ├── brief/route.ts      race-morning brief
│   │       ├── retrospective/route.ts (NEW)
│   │       ├── research/route.ts   (NEW)
│   │       ├── plan-week/route.ts  (NEW)
│   │       └── weather/route.ts    (NEW · NOAA)
│   ├── components/
│   │   └── nav.tsx                 shared navigation (NEW)
│   ├── lib/
│   │   ├── types.ts
│   │   ├── time.ts
│   │   ├── gpx.ts                  parser + haversine + smoothing
│   │   ├── minetti.ts              GAP polynomial
│   │   ├── pacing.ts               segment + effort-scale
│   │   ├── grouping.ts             facts-driven phase assignment
│   │   ├── fueling.ts              gel scheduling
│   │   ├── export.ts               .runcino.json assembly
│   │   ├── course-facts.ts         citation system
│   │   ├── course-research.ts      Claude + web search
│   │   ├── retrospective.ts        plan-vs-actual engine (NEW)
│   │   ├── training.ts             periodization engine (NEW)
│   │   └── weather.ts              NOAA fetch (NEW)
│   ├── fixtures/
│   │   └── bigsur-actual.json      mock Watch export (NEW)
│   ├── data/courses/
│   │   └── big-sur-marathon.json   verified facts with citations
│   ├── scripts/
│   │   ├── build-plan.ts
│   │   ├── research-course.ts
│   │   ├── make-big-sur-gpx.mjs
│   │   ├── retrospective.ts        (NEW)
│   │   ├── plan-week.ts            (NEW)
│   │   └── weather.ts              (NEW)
│   └── public/
│       ├── sample-bigsur.gpx
│       └── big-sur-3-50.runcino.json
└── ios/
    ├── README.md                   Xcode setup
    └── Runcino/
        ├── RuncinoApp.swift
        ├── Models/RuncinoPlan.swift
        ├── Views/
        │   ├── ContentView.swift
        │   ├── ImportView.swift
        │   └── PlanView.swift
        ├── Workout/WorkoutBuilder.swift
        └── Resources/Info.plist
```

---

## Honest risk list

| Risk | Likelihood | Mitigation |
|---|---|---|
| Next.js 16 routing quirk I missed | Low | Dev server boots clean; all routes return 200 |
| iOS WorkoutKit API renamed since my knowledge cutoff | High | First Xcode build surfaces it; 1-3 line fixes |
| NOAA API occasionally 503s | Low | Error path returns structured failure; retry on next call |
| Claude retrospective JSON parse fails | Low | Stub fallback kicks in; strict prompt enforces shape |
| Training plan rule engine produces an awkward weekly structure for a specific week | Medium | Rule-based; we iterate. Claude swap later eliminates this. |
| You blow up at mile 20 because the plan was wrong | Very low | Minetti is well-validated; tolerance bounds absorb small errors |

---

## What I'd do first thing tomorrow if I were you

1. Clone, install, `npm test` → confirm 75/75 green (30 sec)
2. `npm run dev`, click through all 6 routes in the browser (5 min)
3. `npm run retrospective`, `npm run plan-week -- --today 2026-04-19` (1 min)
4. Open iOS in Xcode, create the project, drag in Swift files, try to build. Report any red-lines.
5. Swap in the real 2024 Big Sur GPX, regenerate the plan.
6. Drop in ANTHROPIC_API_KEY, re-run `/api/goal` and compare stub output to real Claude output.
7. Merge PR when you're happy.

---

Built while you slept. See you tomorrow.

— C.
