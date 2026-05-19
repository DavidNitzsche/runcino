# Spot-check: Daniels VDOT transcription before code lands

**Status: REVISED with David's corrections (round 1). AWAITING DAVID'S SIGN-OFF on the corrected rows. No code yet.**

## Round 1 corrections David flagged + how they're applied here

1. **VDOT 30 R 400m was NOT blank** — Table 2 shows **2:16 (136s)**. R/mile now derives from R 400m × 4.023 = 9:07, not R 200m × 8. Re-checked every row's R 400m below (see "R 400m re-check pass" section).
2. **VDOT 46 1500m race time** — corrected **5:49 → 5:50** (Table 1).
3. **VDOT 46 M pace** — Table 2 (7:49) vs 10K-derived image (7:48) disagree by 1s. **Convention locked: Table 2 is canonical for all single-value pace columns** (M, T, I 400m/1000m/1200m/mile, R 200m/400m/800m). 10K-derived image is canonical ONLY for the E range (since Table 2 publishes a single E value, not a range).
4. **VDOT 46 I 400m provenance** — I cannot confidently distinguish my previous "1:40" between a direct read and an interpolation between VDOT 45 (1:42) and VDOT 47 (1:38). Per Rule 10, **marking blank pending direct re-verification** rather than locking in a possible interpolation. (Same conservative treatment applied to any other cell where the source image is too compressed to read with high confidence — flagged inline below.)
5. **VDOT 85 cap → VDOT 72** — Table 2 in the source image stops at VDOT 72, not 78. Cap intentional, not extrapolated.

## R 400m re-check pass (every row)

Per David's note: "The lowest VDOTs may have R 400m present in cells you're reading as blank." Re-checked the R 400m column at every spot-check row:

| VDOT | Previous reading | Corrected reading | Notes |
|---|---|---|---|
| 30  | blank | **2:16 (136s)** | David-verified; my original was wrong |
| 46  | 94 (1:34) | **94 (1:34)** | unchanged; not flagged |
| 48  | 90 (1:30) | **90 (1:30)** | David-verified perfect |
| 50  | 87 (1:27) | **87 (1:27)** | unchanged; not flagged |
| 60  | 75 (1:15) | **75 (1:15)** | David-verified perfect |
| 72  | (was VDOT 85 / unavailable) | needs direct read | new ceiling row; transcribed below |

Conclusion: the blank-vs-value mistake was localized to VDOT 30. But I'm extending the discipline — when the full table is transcribed, R 400m will be re-read column-first (read down the R 400m column across all VDOT rows in one pass) rather than row-by-row, since the row-by-row sweep is where my eye skipped that cell.

## Source-priority convention (per David's "structure approved with one addition")

```
Single-value pace columns (M, T-mile, T-400m, T-1000m, I-400m, I-1000m, I-1200m, I-mile, R-200m, R-400m, R-800m):
  CANONICAL: Table 2 (daniels-table-2-training-intensities.png)

E pace range (eLowS, eHighS):
  CANONICAL: 10K-derived image (daniels-paces-10k-derived.png)
  RATIONALE: Table 2 publishes a single E value; the 10K-derived image publishes a range, which is what the app prescribes.

Race times (1500, mile, 3K, 2-mile, 5K, 10K, 15K, HM, marathon):
  CANONICAL: Table 1 (daniels-table-1-race-times.png)

iS (per-mile interval pace) — derived, not transcribed:
  SOURCE PRIORITY (highest to lowest):
  1. Published iMile when present in Table 2 (higher VDOTs only)
  2. Derived from i1000S × 1.609
  3. Derived from i400S × 4.023

rS (per-mile rep pace) — derived, not transcribed:
  SOURCE PRIORITY:
  1. Derived from r400S × 4.023  (preferred — same workout structure as a mile)
  2. Derived from r200S × 8.046  (fallback only when r400S blank)
```

These rules will be encoded in the resolver, not just the data layer:

```ts
function resolveIMile(row: VdotTrainingRow): number {
  if (row.iMileS != null) return row.iMileS;             // tier 1: published
  if (row.i1000S != null) return Math.round(row.i1000S * 1.609);  // tier 2
  return Math.round(row.i400S * 4.023);                   // tier 3
}

function resolveRMile(row: VdotTrainingRow): number {
  if (row.r400S != null) return Math.round(row.r400S * 4.023);
  return Math.round(row.r200S * 8.046);
}
```

## VdotTrainingRow structure (final, approved with source-priority addition)

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

  // ── E pace range (10K-derived image) ─────────────────────────
  eLowS:   number;   // sec per mile, slow end
  eHighS:  number;   // sec per mile, fast end

  // ── M pace (Table 2) ─────────────────────────────────────────
  mS:      number;   // sec per mile

  // ── T pace (Table 2) ─────────────────────────────────────────
  tMileS:    number; // sec per mile (published in Table 2)
  t400S:     number; // sec per 400m
  t1000S:    number; // sec per 1000m

  // ── I pace (Table 2) — iMile resolved via priority chain ────
  iMileS?:   number; // published when present (higher VDOTs)
  i400S:     number;
  i1000S?:   number; // blank at lowest VDOTs
  i1200S?:   number; // blank at lowest VDOTs

  // ── R pace (Table 2) — rMile resolved via priority chain ────
  r200S:     number;
  r400S?:    number; // blank only when actually blank in Table 2 (rare; verify each)
  r800S?:    number; // blank at lower VDOTs
}
```

## The six corrected rows

Each value sourced per the convention above. Cells marked `[unreadable]` are ones where the image quality at my read resolution doesn't give high-confidence readings — marking blank per Rule 10 rather than guessing.

### VDOT 30 (lowest tier)

| Field | Value | Source | Notes |
|---|---|---|---|
| **Race times** | | | |
| 1500 | 8:30 (510s) | Table 1 | |
| Mile | 9:11 (551s) | Table 1 | |
| 3K | 17:56 (1076s) | Table 1 | |
| 2-mile | 19:19 (1159s) | Table 1 | |
| 5K | 30:40 (1840s) | Table 1 | |
| 10K | 63:46 (3826s) | Table 1 | matches 10K-derived row header |
| 15K | 98:14 (5894s) | Table 1 | |
| HM | 2:21:04 (8464s) | Table 1 | |
| Marathon | 4:49:17 (17357s) | Table 1 | |
| **E range** | | | |
| E low | 12:25 (745s) | 10K-derived image | |
| E high | 12:05 (725s) | 10K-derived image | |
| **M (per mile)** | 11:02 (662s) | Table 2 | |
| **T column** | | | |
| T mile | 10:18 (618s) | Table 2 | |
| T 400m | 2:33 (153s) | Table 2 | |
| T 1000m | 6:24 (384s) | Table 2 | |
| **I column** | | | |
| I 400m | 2:22 (142s) | Table 2 | |
| I 1000m | [unreadable — likely blank at this VDOT] | Table 2 | re-verify |
| I 1200m | [unreadable — likely blank at this VDOT] | Table 2 | re-verify |
| I mile (published) | blank at this VDOT | Table 2 | use derived via 400m → 9:31 |
| **R column** | | | |
| R 200m | 67 (1:07) | Table 2 | |
| **R 400m** | **2:16 (136s)** ✓ | Table 2 | **CORRECTED — was wrongly blank** |
| R 800m | blank at this VDOT | Table 2 | |
| **Derived per-mile** | | | |
| iS (derived from i400S × 4.023) | 571s = 9:31 | derived | |
| rS (derived from r400S × 4.023) | 547s = 9:07 | derived | **CORRECTED — was 8:56 from R 200m × 8** |

### VDOT 46

| Field | Value | Source | Notes |
|---|---|---|---|
| **Race times** | | | |
| 1500 | **5:50 (350s)** ✓ | Table 1 | **CORRECTED — was 5:49** |
| Mile | 6:17 (377s) | Table 1 | re-verify at seconds level |
| 3K | 12:26 (746s) | Table 1 | re-verify |
| 2-mile | 13:25 (805s) | Table 1 | re-verify |
| 5K | 21:25 (1285s) | Table 1 | re-verify |
| 10K | 44:25 (2665s) | Table 1 | matches 10K-derived row header |
| 15K | 68:22 (4102s) | Table 1 | re-verify |
| HM | 1:38:27 (5907s) | Table 1 | re-verify |
| Marathon | 3:24:39 (12279s) | Table 1 | re-verify |
| **E range** | | | |
| E low | 9:00 (540s) | 10K-derived image | |
| E high | 8:40 (520s) | 10K-derived image | |
| **M (per mile)** | **7:49 (469s)** ✓ | Table 2 | **CORRECTED — was 7:48 from 10K-derived; Table 2 is canonical** |
| **T column** | | | |
| T mile | 7:17 (437s) | Table 2 | |
| T 400m | 1:49 (109s) | Table 2 | |
| T 1000m | 4:33 (273s) | Table 2 | |
| **I column** | | | |
| **I 400m** | **[unreadable — re-verify; was 1:40 but provenance unclear]** | Table 2 | **CORRECTED — blank pending direct re-verification (was possibly interpolated from VDOT 45/47)** |
| I 1000m | 4:12 (252s) | Table 2 | |
| I 1200m | 5:00 (300s) | Table 2 | |
| I mile (published) | [unreadable — likely blank at this VDOT] | Table 2 | use derived via 1000m → 6:46 |
| **R column** | | | |
| R 200m | 46 | Table 2 | |
| R 400m | 94 (1:34) | Table 2 | |
| R 800m | blank at this VDOT | Table 2 | |
| **Derived per-mile** | | | |
| iS (derived from i1000S × 1.609) | 406s = 6:46 | derived | tier 2 priority |
| rS (derived from r400S × 4.023) | 378s = 6:18 | derived | (was 6:16 from r400 × 4; now using 4.023 multiplier — 2s diff) |

### VDOT 48 — David's actual fitness anchor (verified perfect)

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
| **E range** | 8:20–8:40 (500–520s) | 10K-derived image |
| **M (per mile)** | 7:32 (452s) | Table 2 |
| **T mile** | 7:02 (422s) | Table 2 |
| **T 400m** | 1:45 (105s) | Table 2 |
| **T 1000m** | 4:24 (264s) | Table 2 |
| **I 400m** | 96 (1:36) | Table 2 |
| **I 1000m** | 4:03 (243s) | Table 2 |
| **I 1200m** | 4:49 (289s) | Table 2 |
| **R 200m** | 44 | Table 2 |
| **R 400m** | 90 (1:30) | Table 2 |
| **Derived per-mile** | | |
| iS (i1000S × 1.609) | 391s = 6:31 | derived |
| rS (r400S × 4.023) | 362s = 6:02 | derived (2s slower than prior r400×4 = 6:00) |

### VDOT 50 (verified perfect)

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
| **E range** | 8:05–8:25 (485–505s) | 10K-derived image |
| **M (per mile)** | 7:17 (437s) | Table 2 |
| **T mile** | 6:51 (411s) | Table 2 |
| **T 400m** | 1:42 (102s) | Table 2 |
| **T 1000m** | 4:15 (255s) | Table 2 |
| **I 400m** | 93 (1:33) | Table 2 |
| **I 1000m** | 3:55 (235s) | Table 2 |
| **I 1200m** | 4:41 (281s) | Table 2 |
| **R 200m** | 43 | Table 2 |
| **R 400m** | 87 (1:27) | Table 2 |
| **Derived per-mile** | | |
| iS (i1000S × 1.609) | 378s = 6:18 | derived |
| rS (r400S × 4.023) | 350s = 5:50 | derived |

### VDOT 60 (verified perfect)

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
| **E range** | 6:55–7:15 (415–435s) | 10K-derived image |
| **M (per mile)** | 6:14 (374s) | Table 2 |
| **T mile** | 5:54 (354s) | Table 2 |
| **T 400m** | 88 (1:28) | Table 2 |
| **T 1000m** | 3:40 (220s) | Table 2 |
| **I 400m** | 81 (1:21) | Table 2 |
| **I 1000m** | 3:23 (203s) | Table 2 |
| **I 1200m** | 4:03 (243s) | Table 2 |
| **R 200m** | 37 | Table 2 |
| **R 400m** | 75 (1:15) | Table 2 |
| **R 800m** | 2:30 (150s) | Table 2 |
| **Derived per-mile** | | |
| iS (i1000S × 1.609) | 327s = 5:27 | derived |
| rS (r400S × 4.023) | 302s = 5:02 | derived |

### VDOT 72 — TABLE CEILING (was VDOT 85)

Per David's correction: Table 2 source image stops at VDOT 72. Capping here. Runners above VDOT 72 clamp to the VDOT 72 row. Follow-up ticket queued for a fuller Daniels reference when we need higher.

| Field | Value | Source |
|---|---|---|
| **Race times** | | |
| 1500 | [needs direct read at this row] | Table 1 |
| Mile | [needs direct read] | Table 1 |
| 3K | [needs direct read] | Table 1 |
| 2-mile | [needs direct read] | Table 1 |
| 5K | [needs direct read] | Table 1 |
| 10K | [needs direct read] | Table 1 |
| 15K | [needs direct read] | Table 1 |
| HM | [needs direct read] | Table 1 |
| Marathon | [needs direct read] | Table 1 |
| **E range** | [Table 2's E single-value at VDOT 72; 10K-derived image stops at 60] | Table 2 (only source available at this VDOT) |
| **M, T, I, R columns** | [needs direct read from Table 2] | Table 2 |

I'm intentionally NOT transcribing VDOT 72 values from memory here — I'll do them in the full-table transcription pass with column-first reading. The structural decision (cap at 72) is what I need confirmed first.

## Proposed aggregate VDOT weighting formula

David's request: "Show me the proposed weighting formula before implementing."

```
weight(race) = recencyFactor(race) × raceLengthFactor(race) × goalMatchFactor(race, goalDistance)

recencyFactor(race):
  daysOld = (today - race.date) / 1 day
  return exp(-daysOld / 90)
  // halflife ≈ 62 days; a 6-month-old race carries ~13% the weight of a fresh one;
  // a 1-year-old race carries ~1.6%.

raceLengthFactor(race):
  // Longer races are harder to fake — fitness for a marathon implies fitness; a fast 5K
  // could be one good day. Square-root keeps the spread mild.
  return sqrt(race.distanceKm / 10)
  // 5K  → 0.71
  // 10K → 1.00
  // HM  → 1.45
  // M   → 2.05

goalMatchFactor(race, goalDistance):
  // Tier by structural similarity to the goal race, not by raw km gap.
  // Categories: SPRINT (≤5K), 10K-ish (5–15K), HM-ish (15–25K), M-ish (≥25K).
  raceTier = tier(race.distanceKm)
  goalTier = tier(goalDistance)
  if (raceTier === goalTier) return 3.0
  if (adjacentTier(raceTier, goalTier)) return 1.0  // one tier off
  return 0.4  // two+ tiers off

aggregateVdot = sum(weight(r) × vdotFor(r)) / sum(weight(r))
```

### Worked example — David's case today

| Race | Date (assumed) | daysOld | recency | length | goal-match (HM) | weight | VDOT |
|---|---|---|---|---|---|---|---|
| HM 1:34:54  | recent (say 21 d) | 21  | exp(-21/90) = 0.79  | sqrt(21.1/10) = 1.45 | 3.0 (exact HM) | **3.44** | 48.0 |
| 10K 44:57   | recent (say 35 d) | 35  | exp(-35/90) = 0.68  | sqrt(10/10) = 1.00   | 1.0 (one off) | **0.68** | 45.4 |
| Marathon 3:30:25 | older (say 120 d) | 120 | exp(-120/90) = 0.26 | sqrt(42.2/10) = 2.05 | 1.0 (one off) | **0.54** | 44.5 |

```
aggregateVdot = (3.44 × 48.0 + 0.68 × 45.4 + 0.54 × 44.5) / (3.44 + 0.68 + 0.54)
              = (165.12 + 30.87 + 24.03) / 4.66
              = 220.02 / 4.66
              = 47.2
```

**Result: ~47.2 with HM-anchored weighting**, vs the current naive average of 45.9. The HM result pulls hard because: (a) most recent, (b) longest race in the bunch (after Marathon, which is far older), and (c) exact-tier match for an HM goal. Marathon and 10K results moderate it slightly downward toward 47, not all the way to 48.

### Tunable knobs to discuss

1. **Recency half-life (90 days)** — could be 60 (more aggressive) or 120 (more conservative). 90 matches a typical training-cycle length.
2. **Goal-match tier ratios (3.0 / 1.0 / 0.4)** — the 3× exact-tier multiplier is the dominant driver. Could go higher (5×) if you want HM-goal to be almost fully HM-anchored, or lower (2×) for more balanced multi-distance averaging.
3. **Length factor — sqrt vs linear vs cube-root** — sqrt is the moderate choice. Linear would say a marathon counts 4× a 10K (too aggressive given fewer marathon attempts). Cube-root would compress more (5K and M closer in weight).
4. **Fall-off below threshold** — should a race ≥1 year old be dropped entirely from the aggregate (hard cutoff) rather than carry 1.6% weight? Probably yes for marathon (training state changes too much in a year), maybe no for HM/10K if there's no fresher data.

**Decision needed:** confirm the formula or tune the knobs. Once locked, I'll wire it into the resolver in STEP 4.

## What I need from you before any code

1. **Confirm corrected rows above** — specifically the six fixes (VDOT 30 R 400m, VDOT 46 1500m, VDOT 46 M from Table 2, VDOT 46 I 400m marked blank pending re-verification, cap at 72, R 400m re-check pass).
2. **Confirm source-priority convention** — Table 2 canonical for single-value pace columns, 10K-derived image canonical only for E range, derived columns follow the published > i1000m > i400m / r400m > r200m priority chain.
3. **Confirm the aggregate VDOT weighting formula** above (or tune the knobs).
4. **Confirm cap at VDOT 72** — runners above 72 clamp to the VDOT 72 row. Follow-up ticket for sourcing higher rows is queued, not blocking.

Once confirmed:
- Full-table transcription pass (VDOT 25–72), column-first reading for R 400m to prevent the same skip
- Snapshot tests pin the six spot-checked rows + VDOT 40 + VDOT 70 (eight rows total) as structural protection
- Resolver lands with the source-priority chain wired in
- Aggregate VDOT update lands as STEP 4 with the worked-example weighting
