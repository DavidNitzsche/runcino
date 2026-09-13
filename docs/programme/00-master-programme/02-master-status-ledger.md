# 02 — Master Status Ledger (Section-15 Product Master List)

Status grammar per mandate §6. Default status for anything not touched below is **UNINVESTIGATED** — this is a skeleton populated as Waves 1-4 produce real evidence, not a pre-filled audit. Per the mandate's own closing instruction ("do not produce another giant audit that nobody implements"), this file is deliberately thin at takeover and grows only as implementer/reviewer handbacks land in `handbacks/`.

| # | Area | Status | Evidence | Notes |
|---|---|---|---|---|
| 1 | Today | UNINVESTIGATED | — | |
| 2 | Pre-run | UNINVESTIGATED | — | |
| 3 | Run execution | UNINVESTIGATED | — | |
| 4 | Post-run | CONFIRMED FINDING (partial) | `[SRC]` | Lane A (recovery/intentional-advance) HELD — see `06-integration-waves.md` Wave 1 item 4 |
| 5 | Activity/history | UNINVESTIGATED | — | |
| 6 | Block/plan experience | CONFIRMED FINDING (partial) | `[SRC]` | Marathon Plan Quality Phase 1/2 fixes exist unmerged (db9db751e, 1506981b5); Phase 3 CIM redesign explicitly incomplete |
| 7 | Adaptation experience | UNINVESTIGATED — verification in flight | `[BLOCKED]` pending Task #8 agent | Mandate disputes PACE/VOLUME/DURATION/DENSITY claims; do not trust prior reports |
| 8 | Move a Run / schedule mgmt | UNINVESTIGATED | — | |
| 9 | Coaching voice | CONFIRMED FINDING (partial) | `[SRC]` | Natural Coaching branch addresses "hard session"/"quality session" harmonization + several copy issues; full 7-surface sweep not yet independently confirmed by this ledger |
| 10 | Progress and fitness | CONFIRMED FINDING | `[SRC]` | Threshold (430s/mi) vs marathon-training (~472s/mi) vs goal (412s/mi) vs VDOT (47.8 race-carried / 46.6 stale profile) contradiction flagged by mandate §9 — Wave 2 |
| 11 | Race page | UNINVESTIGATED | — | |
| 12 | Race morning | UNINVESTIGATED | — | |
| 13 | Post-race | UNINVESTIGATED | — | |
| 14 | Shoes | UNINVESTIGATED | — | |
| 15 | Health and runner metrics | CONFIRMED FINDING (partial) | `[SRC]` | No `runner_injuries` record reported for the Oct-2025 femur stress reaction — not independently confirmed by this session (no DB access) |
| 16 | Profile and settings | UNINVESTIGATED | — | |
| 17 | Notifications | UNINVESTIGATED | — | |
| 18 | Reliability and synchronization | UNINVESTIGATED | — | |
| 19-27 | Later expansion items | UNINVESTIGATED, explicitly not blockers per mandate §15 | — | |

## How this file will be updated

Every implementer/reviewer handback in `handbacks/` must update its row here with a real status transition (UNINVESTIGATED → CONFIRMED FINDING → SCOPED → IMPLEMENTING → IMPLEMENTED → SELF-VERIFIED → INDEPENDENTLY REVIEWED → PUSHED → MERGE-READY → MERGED → DEPLOYED → SIMULATOR-VERIFIED → DEVICE-VERIFIED). No row moves backward silently, and no row reaches MERGED/DEPLOYED without this session having pushed it through an authorized wave (see `05-decisions-and-authority.md`).
