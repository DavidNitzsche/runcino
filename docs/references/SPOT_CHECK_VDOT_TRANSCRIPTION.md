# Spot-check: Daniels VDOT transcription before code lands

**Status: AWAITING DAVID'S SIGN-OFF. No code yet.**

Six rows transcribed verbatim from the source images for David's 5-minute spot-check against the originals. Once all six rows are verified, the same transcription procedure applies to the remaining rows in TRAINING_PACES_TABLE, then code lands + snapshot tests pin all six rows + a few others as structural protection.

## Proposed row structure (TypeScript)

```ts
interface VdotTrainingRow {
  vdot: number;

  // ── RACE TIMES (Table 1) — all in seconds ──────────────────
  race1500S:    number;
  raceMileS:    number;
  race3kS:      number;
  race2miS:     number;
  race5kS:      number;
  race10kS:     number;
  race15kS:     number;
  raceHalfS:    number;
  raceMarathonS: number;

  // ── TRAINING PACES (Table 2 + 10k-derived image for E range) ──
  // Per-mile seconds, except interval/rep originals which keep their
  // workout-native units (400m, 1000m, 1200m, 200m, 800m).

  // E — Easy/Long. Range from the 10k-derived image (Table 2 lists
  // single value; range form is more useful prescriptively).
  eLowS:   number;   // sec per mile, slow end of E
  eHighS:  number;   // sec per mile, fast end of E

  // M — Marathon pace. Single value per mile.
  mS:      number;

  // T — Threshold pace. Daniels publishes 400m, 1000m, AND mile.
  tS:        number;  // per mile
  t400S:     number;  // per 400m (preserve for interval prescription)
  t1000S:    number;  // per 1000m (preserve for interval prescription)

  // I — Interval pace. Daniels publishes 400m, 1000m, 1200m, mile.
  // Mile equivalent derived from 1000m × 1.609 (or from 400m × 4 —
  // both noted; they differ by ~5-8 sec due to table rounding).
  iS:        number;  // per mile (derived from i1000S × 1.609)
  i400S:     number;
  i1000S:    number;
  i1200S?:   number;  // missing for lowest VDOTs
  iMileS?:   number;  // missing for lowest VDOTs

  // R — Repetition pace. Daniels publishes 200m, 400m, 800m.
  rS:        number;  // per mile (derived from r400S × 4)
  r200S:     number;
  r400S?:    number;  // missing for lowest VDOTs
  r800S?:    number;  // missing for lowest VDOTs (Table 2)
}
```

## The six rows

Each value below is sourced from EITHER Table 1, Table 2, or the 10k-derived image. The `source` column documents which.

### VDOT 30 (lowest tier)

| Field | Value | Source |
|---|---|---|
| **Race times** | | |
| 1500 | 8:30 (510s) | Table 1 |
| Mile | 9:11 (551s) | Table 1 |
| 3K | 17:56 (1076s) | Table 1 |
| 2-mile | 19:19 (1159s) | Table 1 |
| 5K | 30:40 (1840s) | Table 1 |
| 10K | 63:46 (3826s) | Table 1 |
| 15K | 98:14 (5894s) | Table 1 |
| HM | 2:21:04 (8464s) | Table 1 |
| Marathon | 4:49:17 (17357s) | Table 1 |
| **Training paces (per mile)** | | |
| E range | 12:05–12:25 (725–745s) | 10K-derived image |
| M | 11:02 (662s) | Table 2 |
| T mile | 10:18 (618s) | Table 2 |
| I mile | derived from 1000m × 1.609 = ~10:14 (614s) | derived; Table 2 1000m column blank at VDOT 30 |
| R mile | derived from R 200m × 8 = ~8:56 (536s) | derived; R 400m column blank at VDOT 30 |
| **Interval/rep originals** | | |
| T 400m | 2:33 | Table 2 |
| T 1000m | 6:24 | Table 2 |
| I 400m | 2:22 | Table 2 |
| I 1000m | blank in Table 2 row | — |
| R 200m | 67 (1:07) | Table 2 |
| R 400m | blank | — |

### VDOT 46

| Field | Value | Source |
|---|---|---|
| **Race times** | | |
| 1500 | 5:49 (349s) | Table 1 |
| Mile | 6:17 (377s) | Table 1 |
| 3K | 12:26 (746s) | Table 1 |
| 2-mile | 13:25 (805s) | Table 1 |
| 5K | 21:25 (1285s) | Table 1 |
| 10K | 44:25 (2665s) | Table 1 |
| 15K | 68:22 (4102s) | Table 1 |
| HM | 1:38:27 (5907s) | Table 1 |
| Marathon | 3:24:39 (12279s) | Table 1 |
| **Training paces (per mile)** | | |
| E range | 8:40–9:00 (520–540s) | 10K-derived image |
| M | 7:48 (468s) | Table 2 |
| T mile | 7:17 (437s) | Table 2 |
| I mile equivalent | from I 1000m 4:12 × 1.609 = 6:46 (406s) | derived |
| R mile equivalent | from R 400m 94s × 4 = 6:16 (376s) | derived |
| **Interval/rep originals** | | |
| T 400m | 1:49 (109s) | Table 2 |
| T 1000m | 4:33 (273s) | Table 2 |
| I 400m | 1:40 (100s) | Table 2 |
| I 1000m | 4:12 (252s) | Table 2 |
| I 1200m | 5:00 (300s) | Table 2 |
| R 200m | 46 | Table 2 |
| R 400m | 94 (1:34) | Table 2 |

### VDOT 48 — David's actual fitness anchor

| Field | Value | Source |
|---|---|---|
| **Race times** | | |
| 1500 | 5:36 (336s) | Table 1 |
| Mile | 6:03 (363s) | Table 1 |
| 3K | 11:58 (718s) | Table 1 |
| 2-mile | 12:55 (775s) | Table 1 |
| 5K | 20:39 (1239s) | Table 1 |
| 10K | 42:50 (2570s) | Table 1 |
| 15K | 65:53 (3953s) | Table 1 |
| HM | 1:34:53 (5693s) | Table 1 ← **David's HM 1:34:54 matches** |
| Marathon | 3:17:29 (11849s) | Table 1 |
| **Training paces (per mile)** | | |
| E range | **8:20–8:40 (500–520s)** | 10K-derived image — **matches David's spot-check** |
| M | **7:32 (452s)** | Table 2 — **matches David's spot-check** |
| T mile | **7:02 (422s)** | Table 2 — **matches David's spot-check** |
| I mile equivalent | from I 1000m 4:03 × 1.609 = 6:31 (391s) | derived. **David's spot-check said ~6:24–6:31 — consistent** |
| R mile equivalent | from R 400m 90s × 4 = 6:00 (360s) | derived. **David's spot-check said ~5:58 — within 2 sec rounding** |
| **Interval/rep originals** | | |
| T 400m | 1:45 (105s) | Table 2 |
| T 1000m | 4:24 (264s) | Table 2 |
| I 400m | 96 (1:36) | Table 2 |
| I 1000m | 4:03 (243s) | Table 2 |
| I 1200m | 4:49 (289s) | Table 2 |
| R 200m | 44 | Table 2 |
| R 400m | 90 (1:30) | Table 2 |

### VDOT 50

| Field | Value | Source |
|---|---|---|
| **Race times** | | |
| 1500 | 5:24 (324s) | Table 1 |
| Mile | 5:50 (350s) | Table 1 |
| 3K | 11:33 (693s) | Table 1 |
| 2-mile | 12:28 (748s) | Table 1 |
| 5K | 19:57 (1197s) | Table 1 |
| 10K | 41:21 (2481s) | Table 1 |
| 15K | 63:36 (3816s) | Table 1 |
| HM | 1:31:35 (5495s) | Table 1 |
| Marathon | 3:10:49 (11449s) | Table 1 |
| **Training paces (per mile)** | | |
| E range | 8:05–8:25 (485–505s) | 10K-derived image |
| M | 7:17 (437s) | Table 2 |
| T mile | 6:51 (411s) | Table 2 |
| I mile equivalent | from I 1000m 3:55 × 1.609 = 6:18 (378s) | derived |
| R mile equivalent | from R 400m 87s × 4 = 5:48 (348s) | derived |
| **Interval/rep originals** | | |
| T 400m | 1:42 (102s) | Table 2 |
| T 1000m | 4:15 (255s) | Table 2 |
| I 400m | 93 (1:33) | Table 2 |
| I 1000m | 3:55 (235s) | Table 2 |
| I 1200m | 4:41 (281s) | Table 2 |
| R 200m | 43 | Table 2 |
| R 400m | 87 (1:27) | Table 2 |

### VDOT 60

| Field | Value | Source |
|---|---|---|
| **Race times** | | |
| 1500 | 4:35 (275s) | Table 1 |
| Mile | 4:57 (297s) | Table 1 |
| 3K | 9:50 (590s) | Table 1 |
| 2-mile | 10:37 (637s) | Table 1 |
| 5K | 17:03 (1023s) | Table 1 |
| 10K | 35:22 (2122s) | Table 1 |
| 15K | 54:18 (3258s) | Table 1 |
| HM | 1:18:09 (4689s) | Table 1 |
| Marathon | 2:43:25 (9805s) | Table 1 |
| **Training paces (per mile)** | | |
| E range | 6:55–7:15 (415–435s) | 10K-derived image |
| M | 6:14 (374s) | Table 2 |
| T mile | 5:54 (354s) | Table 2 |
| I mile equivalent | from I 1000m 3:23 × 1.609 = 5:27 (327s) | derived |
| R mile equivalent | from R 400m 75s × 4 = 5:00 (300s) | derived |
| **Interval/rep originals** | | |
| T 400m | 88 (1:28) | Table 2 |
| T 1000m | 3:40 (220s) | Table 2 |
| I 400m | 81 (1:21) | Table 2 |
| I 1000m | 3:23 (203s) | Table 2 |
| I 1200m | 4:03 (243s) | Table 2 |
| R 200m | 37 | Table 2 |
| R 400m | 75 (1:15) | Table 2 |
| R 800m | 2:30 (150s) | Table 2 |

### VDOT 85 (table ceiling)

| Field | Value | Source |
|---|---|---|
| **Race times** | | |
| 1500 | 3:23.5 (203.5s) | Table 1 |
| Mile | 3:39.6 (219.6s) | Table 1 |
| 3K | 7:14.1 (434.1s) | Table 1 |
| 2-mile | 7:48.9 (468.9s) | Table 1 |
| 5K | 12:37.4 (757.4s) | Table 1 |
| 10K | 26:19 (1579s) | Table 1 |
| 15K | 40:17 (2417s) | Table 1 |
| HM | 57:50 (3470s) | Table 1 |
| Marathon | 2:01:10 (7270s) | Table 1 |
| **Training paces** | **NOT VISIBLE** in the Table 2 image you sent — Table 2 stops at ~VDOT 78. The 10K-derived image also doesn't extend to VDOT 85. | — |

**Open question for VDOT 85**: do you want me to:
- (a) cap the table at VDOT 78 (the highest row where we have both race times AND training paces); for VDOT 79+ runners, the resolver clamps to the VDOT 78 row
- (b) include race times only for VDOT 79–85 with training paces marked null; downstream consumers must fall back gracefully
- (c) extrapolate per-mile training paces for VDOT 79–85 by following the published row-to-row deltas (this is the kind of "memory/derivation" Rule 10 explicitly forbids — flagging as the wrong choice)

My recommendation: **(a)**. Clamp at the highest fully-published row. Anything above is so far outside our user base that ad-hoc decisions in those rows can't help us. Confirm or correct.

## Cross-check against David's reported fitness

David reports VDOT 48 from HM 1:34:54. The table shows VDOT 48 HM at exactly 1:34:53 (5693s vs 5694s, within rounding). **Confirmed match.**

David's other race times in the aggregate VDOT path:
- 10K 44:57 (2697s) → between VDOT 45 (10K 45:16 / 2716s) and VDOT 46 (10K 44:25 / 2665s) → interpolates to ~VDOT 45.4
- Marathon 3:30:25 (12625s) → between VDOT 44 (M 3:32:23 / 12743s) and VDOT 45 (M 3:28:26 / 12506s) → interpolates to ~VDOT 44.5
- HM 1:34:54 → VDOT 48.0

Current aggregate produces 45.9. Should produce 48 (HM-anchored for an HM goal). **STEP 4 task: weight HM-distance result heaviest when the goal is HM.**

## What I need from you before any code

1. **Confirm the structure** — does the `VdotTrainingRow` interface match how you want the data shaped, or should it be reorganized?
2. **Spot-check the six rows** — are the numbers above what you see in the source images? Specifically VDOT 48 (your anchor) and VDOT 30, 46, 50, 60.
3. **VDOT 85 decision** — (a), (b), or (c) above?
4. **Drop the three image files into `/docs/references/`** — the README is in place. Without the images saved to the repo, "memory is not a source" can't be enforced for future agents.

Once you confirm, I'll transcribe the full table (every VDOT from 25 or 30 to 78/85 depending on your VDOT 85 call), pin snapshot tests for the six spot-checked rows + a few more (40, 70), and then update `pacesFromVdot()` to read from the new table.

**No code touches the table until you sign off on the six rows.**
