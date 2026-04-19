# Project Map

The full repo layout, with the purpose of every directory and every
file we plan to create. Current state noted in the right column.

```
runcino/
├── README.md                    ← project overview           [DONE]
├── .gitignore                                                [DONE]
│
├── docs/                        ← specs & planning
│   ├── PROJECT_MAP.md           ← this file                  [DONE]
│   ├── CHECKLIST.md             ← day-by-day plan            [DONE]
│   ├── SCHEMA.md                ← .runcino.json contract     [DONE]
│   ├── ALGORITHM.md             ← Minetti GAP math           [DONE]
│   └── example.runcino.json     ← Big Sur 3:50 example       [DONE]
│
├── mockups/                     ← HTML pitch-deck mockups
│   ├── index.html               ← pitch deck / landing       [DONE]
│   ├── web-upload.html          ← web: upload & config       [DONE]
│   ├── web-plan.html            ← web: plan + chart + export [DONE]
│   ├── ios-import.html          ← iOS: share-sheet import    [DONE]
│   ├── ios-plan.html            ← iOS: plan + watch sync     [DONE]
│   └── assets/
│       └── styles.css           ← shared design tokens       [DONE]
│
├── web/                         ← Phase 1 — NOT YET BUILT
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx             ← upload screen
│   │   ├── plan/
│   │   │   └── page.tsx         ← plan output
│   │   └── api/
│   │       └── (none — all client-side)
│   ├── lib/
│   │   ├── gpx.ts               ← GPX parser
│   │   ├── minetti.ts           ← GAP cost curve
│   │   ├── pacing.ts            ← segment → phase logic
│   │   ├── grouping.ts          ← auto-group into 6–8 phases
│   │   └── export.ts            ← emit .runcino.json
│   ├── lib/__tests__/
│   │   ├── minetti.test.ts
│   │   ├── pacing.test.ts
│   │   └── grouping.test.ts
│   ├── components/
│   │   ├── UploadCard.tsx
│   │   ├── PlanTable.tsx
│   │   ├── ElevationChart.tsx   ← hand-rolled SVG, no chart lib
│   │   └── DownloadButton.tsx
│   └── public/
│       └── sample-bigsur.gpx    ← fixture for dev/tests
│
└── ios/                         ← Phase 2 — NOT YET BUILT
    ├── Runcino.xcodeproj/
    │   └── project.pbxproj
    ├── Runcino/
    │   ├── RuncinoApp.swift     ← @main, WindowGroup
    │   ├── Info.plist           ← UTTypes for .runcino.json
    │   ├── Assets.xcassets/
    │   ├── Views/
    │   │   ├── ImportView.swift ← .fileImporter
    │   │   ├── PlanView.swift   ← phases + paces
    │   │   └── SyncView.swift   ← "Add to Apple Watch" CTA
    │   ├── Models/
    │   │   ├── RuncinoPlan.swift    ← Codable mirror of JSON
    │   │   └── PlanDocument.swift   ← FileDocument for import
    │   └── Workout/
    │       ├── WorkoutBuilder.swift ← CustomWorkout assembly
    │       └── PaceGoal.swift       ← IntervalStep.pace wrapper
    └── RuncinoTests/
        └── WorkoutBuilderTests.swift
```

## File ownership by phase

**Phase 1 (web) touches:** `web/*`, `docs/SCHEMA.md`,
`docs/example.runcino.json`.

**Phase 2 (iOS) touches:** `ios/*`. Consumes `docs/SCHEMA.md` as
the contract. Does not modify the schema.

**Bundle ID:** `com.davidnitzsche.runcino`.
