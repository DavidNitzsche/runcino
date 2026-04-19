# Runcino · Overnight Status (2026-04-19 → 2026-04-20)

Everything that landed while you were asleep. Read top-down.

---

## Headlines

1. **Pipeline works end-to-end.** GPX → Minetti GAP → 6 phases → 23
   IntervalSteps → `.runcino.json` v1.1.0. Tests: 55/55 green. Output
   drifts 0 seconds from the goal finish time.

2. **Fact-safety system in place.** Every landmark that reaches the
   Watch has a primary-source citation. Unverified claims (like the
   Hurricane Point drummers rumor) are flagged and excluded. Research
   system + CLI for any future race.

3. **Web app is live.** Run `cd web && npm run dev`. Open
   `localhost:3000`. Upload GPX, enter fitness, click "Ask Claude for a
   goal" (uses stub without API key), click "Build plan" → downloads
   valid .runcino.json.

4. **iOS source is written.** Swift files in `ios/Runcino/`. Can't
   compile here. `ios/README.md` has the 15-minute Xcode setup.

5. **M1, M2, M3, and research mockups all shipped.** Beautiful,
   real-data pitch deck for every upcoming phase so you can approve
   them whenever we're ready to build.

6. **Two fact errors caught and fixed.** Bixby Bridge was at mile 10
   in my earlier mockups (wrong — it's at 13.1). GAF at +5% was
   listed as "1.8× as hard" (folk wisdom, not Minetti — real value
   is 1.30×). Both live in no code path now.

---

## The fact-safety story (read this first)

You flagged the risk directly: "it makes me nervous to be learning
this stuff on something I provided. We need a failproof fact system."

Here's what's in place:

- **`web/data/courses/big-sur-marathon.json`** — every phase and
  landmark carries a `sources` array with URL, confidence tier,
  verified date, and where possible a verified_quote. Nothing reaches
  the Watch without a `primary_source_verified` citation.
- **`lib/course-facts.ts`** — `shippableLandmarks()` filters out
  secondary-source and unverified claims. Only primary-source facts
  become Watch haptics.
- **Pre-flight validation** — when you import your real 2024 GPX,
  `validateGpxAgainstCourse` compares parsed distance + gain against
  the known course values. Off by more than tolerance → pipeline
  aborts unless you pass `--force`.
- **Claude prompts** — all three API routes (/api/goal, /api/brief,
  /api/course-research) carry strict system prompts forbidding
  invention of course facts. Claude interprets; it never asserts
  "what's at mile X."
- **Manual verification gate** — `docs/PRE_RACE_CHECKLIST.md` has you
  cross-check every landmark against the official course PDF before
  race day.

**Errors I already caught and fixed in my own work:**
- Bixby Bridge at mile 10 → corrected to mile 13.1 with
  primary-source citation to bigsurmarathon.org
- "Japanese drummers at Hurricane summit" → flagged as
  `unverified_rumor`, removed from shipping landmarks
- GAF at +5% stated as 1.80 → corrected to 1.30 (the measured Minetti
  value)

---

## What works right now

### Tests
```
cd web && npm test
# 7 test files, 55 tests — all pass
```

### The pipeline (CLI)
```
cd web && npm run build-plan
```
Outputs human-readable summary + writes `.runcino.json`.
Use `--force` if running against the synthetic GPX (it's shorter on
elevation than the real course; your 2024 GPX will pass cleanly).

### The web app
```
cd web && cp .env.example .env.local  # see below
npm run dev
# open localhost:3000
```

Drag in `web/public/sample-bigsur.gpx` (or a real one) → fill fitness
→ Ask Claude → Build plan → Download.

### The course research CLI
```
export ANTHROPIC_API_KEY=sk-...
cd web && npm run research-course -- --race "California International Marathon" \
    --url https://www.runsra.org/california-international-marathon \
    --distance 26.22
```
Writes `web/data/courses/california-international-marathon.draft.json`
for you to review. Then `mv` `.draft.json` → `.json` to promote.

---

## File tree (what landed)

```
runcino/
├── STATUS.md                    ← this file
├── README.md                    ← updated for the expanded vision
├── docs/
│   ├── MASTER_PLAN.md           ← one app, phased capability, 12-month roadmap
│   ├── CHECKLIST.md             ← 7-day Big Sur sprint (scoped correctly)
│   ├── SCHEMA.md                ← .runcino.json v1.1.0 (intervals, brief, fitness)
│   ├── ALGORITHM.md             ← Minetti math walkthrough
│   ├── example.runcino.json     ← regenerated from the real pipeline
│   ├── PRE_RACE_CHECKLIST.md    ← ← ← READ THIS SATURDAY
│   └── PROJECT_MAP.md
├── mockups/
│   ├── index.html               ← pitch deck (fixed GAF values)
│   ├── web-upload.html
│   ├── web-plan.html            ← fixed Bixby mile 13.1
│   ├── goal-setting.html
│   ├── ios-plan.html            ← fixed fueling context + landmarks
│   ├── watch-race.html          ← fixed landmark sequence
│   ├── m1-retrospective.html    ← post-race analysis (NEW)
│   ├── m2-integrations.html     ← HealthKit / Strava / Calendar / NOAA (NEW)
│   ├── m3-training.html         ← weekly plan + periodization + daily workouts (NEW)
│   ├── research.html            ← course-facts research workflow (NEW)
│   └── assets/styles.css
├── web/
│   ├── package.json             ← Next 16, React 19, Tailwind 4, Anthropic SDK, vitest
│   ├── app/
│   │   ├── page.tsx             ← single-page workflow, 5-step form
│   │   ├── layout.tsx
│   │   ├── globals.css          ← design system in @theme
│   │   └── api/
│   │       ├── goal/route.ts       ← Claude goal recommender + stub
│   │       ├── build-plan/route.ts ← full pipeline endpoint
│   │       └── brief/route.ts      ← race-morning narrative
│   ├── lib/
│   │   ├── types.ts             ← shared types
│   │   ├── time.ts              ← formatters + unit conversions
│   │   ├── gpx.ts               ← parser, haversine, smoothing
│   │   ├── minetti.ts           ← cost-of-running + GAF
│   │   ├── pacing.ts            ← segmentation + effort scaling (3 strategies)
│   │   ├── grouping.ts          ← facts-driven phase assignment
│   │   ├── fueling.ts           ← gel scheduling
│   │   ├── export.ts            ← .runcino.json v1.1.0 assembly
│   │   ├── course-facts.ts      ← citation-bearing facts loader + validator
│   │   ├── course-research.ts   ← Claude-driven research for any race
│   │   └── __tests__/           ← vitest, 55 tests
│   ├── scripts/
│   │   ├── make-big-sur-gpx.mjs ← synthesized Big Sur GPX
│   │   ├── build-plan.ts        ← CLI pipeline
│   │   └── research-course.ts   ← CLI research for new races
│   ├── data/courses/
│   │   └── big-sur-marathon.json ← hand-verified, cited
│   ├── public/
│   │   ├── sample-bigsur.gpx    ← synthesized (swap for real tomorrow)
│   │   └── big-sur-3-50.runcino.json  ← example output
│   └── vitest.config.ts
└── ios/
    ├── README.md                ← Xcode setup instructions
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

## What needs your attention tomorrow morning

### 1. Swap in your real 2024 Big Sur GPX (5 min, highest priority)

```
cp /Users/david/Downloads/gpx_20240428_id8679_race1_20250117093547.gpx \
   /home/user/runcino/web/public/sample-bigsur.gpx
git add web/public/sample-bigsur.gpx
git commit -m "Use real 2024 Big Sur GPX"
git push
```

Then `cd web && npm run build-plan` — it should pass the geometry
validation cleanly without `--force`.

### 2. Add your Anthropic API key (2 min)

```
cd web
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env.local
```

This turns on real Claude responses (goal recommendation, morning
brief). Without it, stubs run — functional for dev but not real
reasoning.

### 3. Open iOS in Xcode, build, sideload (~60 min first time)

Follow `ios/README.md` — create a new iOS app project in Xcode,
drag in the Swift files, configure WorkoutKit + HealthKit entitlements,
build to your iPhone.

Expect API drift — WorkoutKit's constructor names have shifted across
iOS 17 betas. If `CustomWorkout(activity:, location:, displayName:, ...)`
red-lines, report the exact error and we'll patch.

### 4. Walk through the pre-race checklist (45 min Saturday)

`docs/PRE_RACE_CHECKLIST.md` — the final sanity pass before race day.
Verifies every Watch haptic against the official BSIM course PDF.

---

## What I didn't do

- **Did not compile the iOS code.** No Xcode on Linux. You'll catch any
  API drift on first build and we fix.
- **Did not verify Claude API responses live.** No API key here. Stub
  flows are tested; real Claude calls haven't been.
- **Did not test the web UI in a browser other than curl.** Visual
  rendering looks right in the HTML, but I can't click through it.
  First time you open it, check: drop zone works, Ask Claude flow
  populates, Build plan downloads.
- **Did not touch the LA Marathon fitness summary numbers as "your
  real data."** The values in the form (38 mpw, -4 trend, 18 mi long
  run, 48 resting HR) are placeholders that read plausibly. Update
  them to match reality before hitting "Ask Claude" for a real
  recommendation.

---

## Scope of changes to approve / merge

- **Branch:** `claude/build-runcino-app-OIRJr`
- **Pushed:** continuously — last push is all-green
- **PR:** opening against `main` now (next commit)

If everything looks right:
- Merge to `main`
- Delete the feature branch
- M0 sprint officially in Day 1 (web scaffold) state, one day ahead

If something is wrong:
- Call it out in the PR
- We fix, push again, same PR

---

## Day-by-day from here (7 days to Big Sur)

- **Day 1 (today, Sun 4/19):** you wake up, read this, pull the repo,
  swap in the real GPX, add API key, verify the web UI, open iOS in
  Xcode, report any compile errors
- **Day 2 (Mon 4/20):** iOS API fixups if needed, first sideload
- **Day 3 (Tue 4/21):** short training run using the plan on Watch,
  fix anything awkward
- **Day 4 (Wed 4/22):** race-morning brief dry run, refine Claude
  prompts if responses aren't quite right
- **Day 5 (Thu 4/23):** final polish, commit the plan as frozen
- **Day 6 (Fri 4/24):** pre-race checklist (docs/PRE_RACE_CHECKLIST.md)
- **Day 7 (Sat 4/25):** travel to Carmel, one last plan generation
  with updated weather
- **Sun 4/26:** Big Sur. Run the race. The tool's work is done.

---

Built while you slept. Check the mockups first — M1/M2/M3/research are
all pitch-deck-quality and ready to approve whenever you want to start
building them.

— C.
