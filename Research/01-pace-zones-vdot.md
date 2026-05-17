# 01 — Pace Zones, VDOT, and Training Pace Calculation

Reference for converting a recent race time plus environmental conditions into prescribed training paces. Coach reads this at runtime to produce exact pace ranges for any workout.

## Core terms

- **VDOT** — A pseudo-VO2max value derived from a race time. Indexes both aerobic capacity and running economy in a single number. Range: ~30 (beginner) to 85+ (elite).
- **VO2max** — The maximum rate of oxygen uptake during exhaustive exercise, in mL O2 per kg body mass per minute.
- **vVO2max** — The running velocity at which VO2max is reached. Sustainable for ~6–11 minutes by trained runners.
- **Lactate threshold (LT)** — The exercise intensity at which blood lactate begins accumulating faster than it can be cleared. Typically 83–88% VO2max, ~88–92% HRmax, sustainable ~60 minutes flat-out.
- **HRmax** — Highest heart rate observed during maximal effort.
- **HRR (heart rate reserve)** — HRmax minus resting HR. Karvonen formula uses HRR to scale intensity.
- **Marathon pace (MP)** — The runner's current goal or equivalent marathon race pace.
- **Easy pace (E)** — Conversational aerobic running, typically 65–78% HRmax.
- **Tempo / threshold (T)** — Pace held at lactate threshold; "comfortably hard."
- **Interval (I)** — VO2max-stress pace; 3–5 min repeats with equal-or-half recovery.
- **Repetition (R)** — Faster-than-VO2max pace for economy and speed; 200–600m repeats with full recovery.
- **GAP (grade-adjusted pace)** — Equivalent flat-ground pace for a given grade.

---

## Jack Daniels' VDOT system

VDOT translates a race performance into a single fitness number, then maps that number to training paces. Daniels developed it with exercise physiologist Jimmy Gilbert; it is the most widely used pace-prescription system in distance running.

### How VDOT is calculated

Two physiological equations underpin VDOT:

**1. Oxygen cost of running (Daniels & Gilbert)**

```
VO2 = -4.60 + 0.182258·v + 0.000104·v²
```

where `v` is velocity in meters per minute. The quadratic term captures the disproportionate cost of faster running (air resistance, biomechanical inefficiency).

**2. Fraction of VO2max sustainable for time `t` (in minutes)**

```
%VO2max = 0.8 + 0.1894393·e^(-0.012778·t) + 0.2989558·e^(-0.1932605·t)
```

For a known race distance D (meters) and time T (minutes):

```
v = D / T                                  (m/min)
VO2_demand = -4.60 + 0.182258·v + 0.000104·v²
fraction   = 0.8 + 0.1894393·e^(-0.012778·T) + 0.2989558·e^(-0.1932605·T)
VDOT       = VO2_demand / fraction
```

The result is a "VO2max" the runner *would need* to produce that race performance — incorporating economy, heat tolerance, and pacing as a black-box composite. This is why VDOT is more useful for prescription than a lab-measured VO2max.

### When VDOT works and when it doesn't

| Scenario | Reliability |
|---|---|
| Race distance 1500m–half marathon, ≤6 weeks old, well-paced | High |
| Marathon time → predicting shorter | High |
| 5K time → predicting marathon (without marathon-specific training) | Lower; over-predicts marathon fitness |
| Race run in heat, on hills, or as solo time trial | Apply environmental adjustment first |
| Race aborted or paced unevenly | Do not use |

Two rules of thumb:
- Predictions are most accurate when the target distance is within 2–4× the input race distance.
- Marathon-specific fitness lags VDOT by ~1.5–3 VDOT points if the runner has not done marathon-specific endurance work.

---

## VDOT lookup table

Race times at each VDOT tier, computed from the Daniels & Gilbert equations. Times shown as `h:mm:ss` for marathon and half; `mm:ss` for shorter distances.

| VDOT | Mile  | 3K    | 5K    | 10K     | 15K     | Half     | Marathon |
|------|-------|-------|-------|---------|---------|----------|----------|
| 30   | 8:30  | 17:27 | 30:40 | 63:46   | 1:38:14 | 2:21:04  | 4:49:17  |
| 32   | 8:01  | 16:30 | 29:05 | 60:26   | 1:33:07 | 2:13:49  | 4:34:59  |
| 34   | 7:36  | 15:38 | 27:39 | 57:26   | 1:28:31 | 2:07:16  | 4:22:03  |
| 36   | 7:14  | 14:53 | 26:22 | 54:44   | 1:24:23 | 2:01:19  | 4:10:19  |
| 38   | 6:54  | 14:12 | 25:12 | 52:17   | 1:20:38 | 1:55:55  | 3:59:35  |
| 40   | 6:35  | 13:35 | 24:08 | 50:03   | 1:17:13 | 1:50:59  | 3:49:45  |
| 42   | 6:19  | 13:02 | 23:09 | 48:01   | 1:14:06 | 1:46:27  | 3:40:43  |
| 44   | 6:03  | 12:31 | 22:15 | 46:09   | 1:11:14 | 1:42:17  | 3:32:26  |
| 45   | 5:56  | 12:17 | 21:50 | 45:16   | 1:09:53 | 1:40:20  | 3:28:26  |
| 46   | 5:49  | 12:04 | 21:25 | 44:25   | 1:08:34 | 1:38:27  | 3:24:39  |
| 48   | 5:36  | 11:36 | 20:39 | 42:50   | 1:06:08 | 1:35:01  | 3:17:29  |
| 50   | 5:24  | 11:11 | 19:57 | 41:21   | 1:03:46 | 1:31:35  | 3:10:49  |
| 52   | 5:13  | 10:47 | 19:17 | 39:59   | 1:01:38 | 1:28:31  | 3:04:36  |
| 54   | 5:03  | 10:25 | 18:40 | 38:42   | 0:59:39 | 1:25:40  | 2:58:47  |
| 55   | 4:58  | 10:14 | 18:22 | 38:06   | 0:58:44 | 1:24:18  | 2:56:01  |
| 56   | 4:53  | 10:04 | 18:05 | 37:31   | 0:57:50 | 1:22:59  | 2:53:20  |
| 58   | 4:44  | 9:45  | 17:33 | 36:24   | 0:56:09 | 1:20:30  | 2:48:14  |
| 60   | 4:36  | 9:27  | 17:03 | 35:22   | 0:54:35 | 1:18:09  | 2:43:25  |
| 62   | 4:29  | 9:11  | 16:34 | 34:23   | 0:53:07 | 1:15:58  | 2:38:54  |
| 64   | 4:22  | 8:55  | 16:07 | 33:28   | 0:51:43 | 1:13:54  | 2:34:38  |
| 65   | 4:18  | 8:48  | 15:54 | 33:01   | 0:51:03 | 1:12:55  | 2:32:35  |
| 66   | 4:15  | 8:41  | 15:42 | 32:35   | 0:50:24 | 1:11:56  | 2:30:36  |
| 68   | 4:09  | 8:27  | 15:18 | 31:46   | 0:49:09 | 1:10:05  | 2:26:47  |
| 70   | 4:03  | 8:15  | 14:55 | 30:59   | 0:47:58 | 1:08:21  | 2:23:10  |
| 72   | 3:58  | 8:02  | 14:34 | 30:16   | 0:46:51 | 1:06:42  | 2:19:44  |
| 74   | 3:52  | 7:51  | 14:13 | 29:34   | 0:45:48 | 1:05:08  | 2:16:29  |
| 75   | 3:50  | 7:45  | 14:03 | 29:14   | 0:45:18 | 1:04:23  | 2:14:55  |
| 76   | 3:47  | 7:40  | 13:54 | 28:55   | 0:44:48 | 1:03:39  | 2:13:23  |
| 78   | 3:43  | 7:30  | 13:35 | 28:18   | 0:43:53 | 1:02:13  | 2:10:27  |
| 80   | 3:38  | 7:21  | 13:18 | 27:42   | 0:43:01 | 1:00:54  | 2:07:38  |
| 82   | 3:34  | 7:12  | 13:01 | 27:09   | 0:42:11 | 0:59:39  | 2:04:57  |
| 84   | 3:30  | 7:04  | 12:46 | 26:38   | 0:41:24 | 0:58:27  | 2:02:24  |
| 85   | 3:28  | 7:00  | 12:38 | 26:23   | 0:41:01 | 0:57:53  | 2:01:11  |

(Values reproduce Daniels' published tables; rounded to nearest second.)

### How to look up VDOT from a race

1. Take the runner's recent race time at any standard distance.
2. Find the closest matching time in that distance's column.
3. Read off VDOT in the leftmost column.
4. Interpolate linearly between rows if needed.

Worked example: a 21:25 5K maps to VDOT 46 → predicts 44:25 10K, 1:38:27 half, 3:24:39 marathon.

---

## Daniels training paces (E, M, T, I, R)

Each pace targets a distinct adaptation. Definitions, percentage of VDOT-derived velocity, and dosing rules:

| Code | Name        | %VO2max | %HRmax | %vVO2max (pace) | Purpose                              |
|------|-------------|---------|--------|-----------------|--------------------------------------|
| E    | Easy        | 59–74   | 65–78  | 59–74%          | Aerobic base, recovery, capillarization, mitochondrial density |
| M    | Marathon    | 75–84   | 80–85  | 75–84%          | Marathon-specific muscular endurance and fueling |
| T    | Threshold   | 83–88   | 88–92  | ~86–88%         | Lactate threshold elevation, sustained tempo |
| I    | Interval    | 95–100  | 95–100 | 95–100%         | VO2max ceiling, oxygen-delivery system |
| R    | Repetition  | 105–120 | n/a    | 105–120%        | Running economy, neuromuscular speed |

### Pace conversion from a race time

Approximate paces relative to race performances (within ±2 sec/mi for VDOT 35–70):

| Pace | Relationship                                          |
|------|-------------------------------------------------------|
| E    | ~MP + 60–90 sec/mi (or 5K pace + 90–150 sec/mi)       |
| M    | Marathon race pace                                    |
| T    | ~half-marathon pace to 15K pace (faster runners use HM, slower runners use 15K) |
| I    | ~3K to 5K race pace (often 3K race pace)              |
| R    | ~mile race pace, or ~6 sec/400m faster than I         |

### Dosing rules — Daniels' caps

| Pace | Single-workout cap                       | Weekly cap          | Rep length range | Recovery between reps |
|------|------------------------------------------|---------------------|-----------------|-----------------------|
| E    | None                                     | 70–80% of weekly volume | n/a         | n/a                   |
| M    | The lesser of 18 mi or 20% of weekly mi  | n/a                 | 4–18 mi        | n/a                   |
| T    | 10% of weekly mi (typically 4–6 mi at T) | 10% of weekly mi    | 5–15 min reps; 20–60 min cumulative | 1 min jog per 5 min T |
| I    | 8% of weekly mi (max 10K cumulative)     | 8% of weekly mi     | 3–5 min (max 11 min) | Equal duration jog (≥0.5× rep) |
| R    | 5% of weekly mi (max 8K cumulative)      | 5% of weekly mi     | 200–600m, ≤2 min     | 2–3× duration of rep  |

Polarized distribution Daniels recommends: 70–80% E, 10–15% M+T, 10–15% I+R.

### Why three "threshold-ish" paces matter

T, I, and R sit on different physiological axes. T improves how long lactate clearance can hold; I lifts the ceiling of aerobic power; R targets economy and recruitment. Substituting one for another wastes the workout.

---

## Pfitzinger pace ranges

Pete Pfitzinger ("Advanced Marathoning," with Scott Douglas) uses a marathon-pace-anchored system rather than a VDOT lookup. Six primary zones plus speedwork.

| Zone               | Pace anchor                         | %HRmax | %HRR   | Typical use |
|--------------------|-------------------------------------|--------|--------|-------------|
| Recovery           | MP + ≥3:00/mi (very easy)           | <76%   | <70%   | 4–7 mi the day after a hard session |
| General Aerobic    | MP + 15–25%                         | 70–81% | 62–75% | Standard 6–10 mi mid-week run |
| Endurance / Long   | MP + 10–20%                         | 74–84% | 65–78% | 11+ mi medium-long and long runs |
| Marathon Pace      | Goal MP exactly                     | 80–85% | 73–84% | MP segments inside long runs (5–14 mi) |
| Lactate Threshold  | 15K to half-marathon race pace      | 82–91% | 77–88% | 20–60 min continuous tempo |
| VO2max             | 5K race pace (5K–3K)                | 93–98% | 91–98% | 600–1600m repeats, 2–4 min recovery |
| R / Speed          | Mile race pace and faster           | n/a    | n/a    | 100–300m strides, neuromuscular |

Notes:
- Slower runners (≥4-hour marathon) anchor LT to **15K race pace**; faster runners anchor to **half-marathon pace**.
- Pfitzinger long-run pace is faster than Daniels E pace in absolute terms — closer to mid-E to low-M.
- Marathon-pace miles are explicitly worked into long runs (e.g., 14 with 12 @ MP), unlike Daniels' purer separation.

---

## McMillan pace methodology

Greg McMillan's calculator uses a Riegel-style equivalent-performance model and produces six training zones. Distinguishing feature: splits the threshold range into three sub-zones for greater resolution.

### Zone structure

| Zone | Name                              | %HRmax  | %HRR   | Pace anchor              |
|------|-----------------------------------|---------|--------|--------------------------|
| 1    | Recovery Jogs                     | 60–70%  | 55–65% | Very easy; conversational |
| 2    | Endurance / Long Runs             | 65–82%  | 55–78% | Easy/long pace           |
| 3    | Steady State / Early Threshold    | 83–87%  | 75–80% | Just below LT; ~marathon-to-15K pace zone |
| 4    | Lactate Threshold (Tempo)         | 85–90%  | 80–85% | LT pace; ~half-marathon to 15K |
| 5    | High Threshold / Cruise Intervals | 88–92%  | 82–87% | Slightly above LT; 10K pace |
| 6    | Speed and Sprint (VO2max+)        | 93–100% | 90–100%| 5K pace and faster       |

### Calculator engine

McMillan uses a modified **Riegel formula** for race-time equivalency:

```
T2 = T1 · (D2 / D1)^k        with k ≈ 1.06 (Riegel's "fatigue exponent")
```

McMillan flattens k slightly toward longer distances (some sources cite ~1.05 for marathon predictions) to correct Riegel's tendency to over-predict at long range.

Each zone is then assigned a pace **range** (not a single number) calibrated to typical training-stress responses at that fitness level. Ranges are wider than Daniels'.

### McMillan's six-step training system

The calculator output is paired with a workout system:
1. **Endurance** zone — base mileage
2. **Stamina** zone — tempo and steady state
3. **Speed** zone — VO2max work
4. **Sprint** zone — neuromuscular
Plus race-specific blocks and recovery weeks.

---

## Hansons pace methodology

The Hansons-Brooks Distance Project method (Keith and Kevin Hanson, Luke Humphrey) is built around a single goal-marathon pace. All other paces are offsets from MP.

| Workout Type | Pace                              | Notes |
|--------------|-----------------------------------|-------|
| Recovery     | MP + 90–120 sec/mi                | Minimum allowable easy pace |
| Easy         | MP + 60–90 sec/mi                 | Routine mileage |
| Long Run     | MP + 30–60 sec/mi                 | Capped at 16 mi |
| Strength     | MP – 10 sec/mi                    | Long marathon-pace work on tired legs |
| Tempo / MP   | Goal MP exactly                   | 5–10 mi at MP |
| Speed        | 5K–10K race pace (early plan: 5K; late: ~MP – 25 sec/mi or 10K pace) | 600m–1600m repeats |

Distinct from Daniels:
- **Cumulative fatigue** philosophy. The 16-mile long-run cap is intentional; long runs are run on already-fatigued legs from the prior week.
- **Strength workouts** have no Daniels equivalent. They're 6–10 mi at MP–10/mi after warm-up — sub-threshold but very long.
- Speed work doesn't scale precisely with fitness for very fast runners — the fixed "MP – 10" gap shrinks proportionally.

---

## Cross-system conversions

Pace ranges across systems for the same fitness level. Use this table to translate when a runner moves between programs.

| Concept            | Daniels      | Pfitzinger        | McMillan zone      | Hansons          |
|--------------------|--------------|-------------------|--------------------|------------------|
| Recovery           | E (slow end) | Recovery          | 1                  | Recovery         |
| Easy / aerobic     | E            | General Aerobic   | 2                  | Easy             |
| Long-run pace      | E (mid–high) | Endurance / Long  | 2 (upper)          | Long             |
| Marathon pace      | M            | Marathon Pace     | 3 (upper) / 4 lower| Tempo / MP       |
| Tempo / threshold  | T            | Lactate Threshold | 4                  | (no direct equiv)|
| Cruise intervals   | T (broken)   | LT intervals      | 5                  | Strength         |
| 10K pace           | between T & I| (not a zone)      | 5–6 boundary       | (not a zone)     |
| VO2max / 5K        | I            | VO2max            | 6                  | Speed            |
| Repetition / mile  | R            | Speed / R         | 6 (top)            | Speed (top)      |

### Numerical equivalencies (for a VDOT 50 runner; 5K = 19:57, MP ≈ 7:18/mi)

| Pace zone     | Pace (min/mi) | Pace (min/km) |
|---------------|---------------|---------------|
| Daniels E     | 8:35–9:27     | 5:20–5:52     |
| Daniels M     | 7:17          | 4:32          |
| Daniels T     | 6:51          | 4:15          |
| Daniels I     | 6:18 (per mi; reps timed) | 3:55 |
| Daniels R     | 5:50 (per mi) | 3:38          |
| Pfitz GA      | 8:24–9:08     | 5:13–5:40     |
| Pfitz LT      | 6:51–7:00     | 4:15–4:21     |
| Hansons Long  | 7:48–8:18     | 4:51–5:09     |
| Hansons Strength | 7:08       | 4:26          |

---

## Pace prescription by workout type

Single-source-of-truth lookup: workout type → pace zone → effort target.

| Workout                          | Daniels zone | Pace anchor                           | RPE (1–10) | %HRmax  | Typical duration / volume |
|----------------------------------|--------------|---------------------------------------|------------|---------|---------------------------|
| Recovery jog                     | E (slow)     | E pace + 30 sec/mi                    | 2–3        | 65–72%  | 20–45 min                |
| Easy / aerobic run               | E            | E pace                                | 3–4        | 70–78%  | 30–90 min                |
| Long run (general)               | E            | E pace, optionally fading to M last 20% | 4–5      | 70–82%  | 90 min – 3 hr            |
| Long run with MP segments        | E + M        | E base, then MP for 4–14 mi           | 4–7        | 70–85%  | 2–3 hr                   |
| Marathon-pace tempo              | M            | MP                                    | 6–7        | 80–85%  | 5–14 mi                  |
| Steady state / sub-threshold     | T (slow end) | MP – 10 to MP – 20 sec/mi             | 6–7        | 83–87%  | 30–60 min                |
| Tempo (continuous)               | T            | T pace                                | 7–8        | 88–92%  | 20–40 min                |
| Cruise intervals                 | T            | T pace                                | 7–8        | 88–92%  | 4–6 × 1mi @ T, 1 min jog |
| 10K pace work                    | between T/I  | 10K race pace                         | 8          | 90–93%  | 3–5 × 2km                |
| VO2max intervals                 | I            | I pace (~3K–5K pace)                  | 8–9        | 95–100% | 4–6 × 800m or 5 × 1000m  |
| Long VO2max intervals            | I            | I pace                                | 9          | 95–100% | 4 × 1200m or 3 × 1mi     |
| Hill repeats (short)             | R/I effort   | Effort-based; flat-equiv ~mile pace   | 9          | varies  | 6–12 × 60–90 sec         |
| Hill repeats (long)              | I effort     | Effort-based; ~5K pace                | 8–9        | 92–98%  | 4–6 × 3–5 min            |
| Repetitions (200/400m)           | R            | R pace                                | 9          | n/a     | 8 × 200m or 6 × 400m     |
| Strides                          | R            | R pace, controlled                    | 8 (relaxed)| n/a     | 4–8 × 20 sec, full rec   |
| Race-pace simulation (HM/marathon)| race pace    | Goal race pace                        | varies     | varies  | event-specific           |

Default pace **range width** (lower–upper bound) by zone: see the next section.

---

## How to recalibrate paces

Paces drift as fitness changes. The coach must know **when** to retest and **how** to update VDOT.

### Triggers to retest

Retest VDOT/threshold and update zones immediately if any of these are true:

| Trigger                                                                 | Action                          |
|-------------------------------------------------------------------------|---------------------------------|
| New race result (any distance, all-out, well-paced, ≤2 weeks old)       | Update VDOT from race           |
| Tempo runs feel notably easier at the same target pace                  | Add 1 VDOT point; re-derive paces; field-test within 2 weeks |
| Last race beat predicted time by >30 sec/mi                             | Add 2–3 VDOT points; field-test |
| HR is 5+ bpm lower at the same workout pace, sustained ≥2 weeks         | +1 VDOT, field-test             |
| Tempo runs unexpectedly hard for ≥2 sessions; HR elevated               | –1 to –2 VDOT; check overtraining |
| Returning from layoff ≥2 weeks                                          | Drop ~3–5 VDOT; rebuild         |
| Returning from layoff ≥6 weeks                                          | Drop 5–8 VDOT; rebuild from base |
| Calendar trigger: 6–8 weeks since last test or race                     | Field-test                      |

### Field-test protocols (when no recent race exists)

| Test                          | Protocol                                                        | Output                              |
|-------------------------------|-----------------------------------------------------------------|-------------------------------------|
| 30-min time trial             | After 15-min warm-up: run as far as possible in 30 min (flat course or track). Average pace of last 20 min ≈ LT pace. HR last 20 min ≈ LT HR. | T pace; LTHR                        |
| 5K time trial (solo)          | Same logistics as a race. Treat as race result, but VDOT may under-read by 1–2 points (no competition) | VDOT (apply +1 correction)          |
| Cooper test                   | 12-min run for distance. Coarse VO2max estimate.                | VO2max; less accurate than VDOT     |
| 3K + 5K combined              | Two time trials on separate days. Take VDOT from the better one.| VDOT                                |
| Lactate threshold (lab)       | Graded treadmill protocol; gold standard if available           | LT velocity; LTHR                   |

### Update logic

```
on_new_race(distance, time):
    new_VDOT = compute_VDOT(distance, time)
    if abs(new_VDOT - current_VDOT) >= 1:
        current_VDOT = new_VDOT
        regenerate_all_paces()

on_field_test(LT_pace_observed):
    derive_VDOT_from_T_pace(LT_pace_observed)   # T pace → VDOT lookup
    regenerate_all_paces()

on_calendar_check(weeks_since_last):
    if weeks_since_last >= 6:
        prompt_field_test_or_race()
```

### Marathon-specific correction

Marathon performance is more sensitive to long-run training and fueling than VDOT alone. If a runner's most recent race is a 5K or 10K, derive VDOT from that, then **subtract 1.5 VDOT points** for marathon-pace prescription if they have not done a marathon-specific block (≥6 weeks of long runs ≥18 mi and MP work ≥6 mi).

---

## Pace zone width and lock-in rules

How much variance to allow within a prescribed pace.

| Pace | Default range (sec/mi) | Lock to specific pace? |
|------|------------------------|------------------------|
| E    | ±30 sec/mi (wide)      | Never. Prescribe a window. |
| M    | ±5 sec/mi              | Yes for race-simulation; window for general MP segments |
| T    | ±3 sec/mi              | Yes — narrow window required for adaptation |
| I    | ±3 sec per rep         | Yes — by interval time, not by per-mile pace |
| R    | ±1–2 sec per rep       | Yes — by rep time |

### When to lock to a specific pace vs. give a range

| Situation                        | Pace prescription style |
|----------------------------------|-------------------------|
| Easy day, base mileage           | Wide range; effort-anchored |
| Marathon-pace dress rehearsal    | Lock to single pace     |
| Tempo / threshold session        | Narrow ±3 sec window    |
| VO2max intervals on track        | Lock to lap split       |
| Hilly course                     | Use HR/effort, not pace |
| Trail / soft surface             | Use HR/effort, allow +20–60 sec/mi |
| Heat, humidity, wind, altitude   | Apply environmental adjustment to pace target; or switch to HR |

Rule: **the harder the workout, the tighter the lock**. Easy work is effort-based; threshold and faster work is pace-based; all work uses HR as a guardrail.

---

## Course terrain adjustments

### Hills (Grade-Adjusted Pace)

Use the **Minetti energy cost equation** for accurate GAP across grades –20% to +20%:

```
EC(g) = 155.4·g⁵ − 30.4·g⁴ − 43.3·g³ + 46.3·g² + 19.5·g + 3.6
```

where `g` is grade as a decimal (e.g., +0.05 for 5% uphill). EC is in J·kg⁻¹·m⁻¹.

GAP factor = EC(g) / EC(0). Multiply observed pace by this factor to get equivalent flat pace; divide target flat pace by it to get a hill-adjusted target.

Practical lookup (multiply *target pace* by these to get hill-adjusted target on a continuous grade):

| Grade | Pace multiplier | sec/mi adjustment at 8:00 base |
|-------|-----------------|--------------------------------|
| –6%   | 0.83            | –82 sec (faster)               |
| –4%   | 0.88            | –58 sec                        |
| –2%   | 0.94            | –29 sec                        |
| 0%    | 1.00            | 0                              |
| +2%   | 1.10            | +48 sec (slower)               |
| +4%   | 1.21            | +101 sec                       |
| +6%   | 1.34            | +163 sec                       |
| +8%   | 1.49            | +236 sec                       |
| +10%  | 1.66            | +317 sec                       |

Simpler rule (Daniels, for ≤6% grade): each 1% uphill costs ~12–15 sec/mi at 5K–10K pace, ~10–12 sec/mi at marathon pace. Downhills give back roughly 60–70% of the loss for the same grade.

### Trails / soft surfaces

Hard-pack trail: ~+10–20 sec/mi at the same effort.
Technical singletrack or wet leaves: ~+30–60 sec/mi.
Sand or deep mud: +60–120 sec/mi.

For trail workouts, the coach should **default to HR or RPE** rather than pace.

---

## Weather adjustments

### Heat + humidity

The simplest validated rule combines **temperature (°F) + dew point (°F)**:

```
heat_index_sum = T_degF + dew_point_degF
```

| Sum (°F) | Pace adjustment | Notes |
|----------|-----------------|-------|
| ≤100     | 0%              | Optimal conditions |
| 101–110  | 0–0.5%          | Negligible          |
| 111–120  | 0.5–1.0%        | Mild               |
| 121–130  | 1.0–2.0%        | Noticeable          |
| 131–140  | 2.0–3.0%        | Moderate; hydrate aggressively |
| 141–150  | 3.0–4.5%        | Significant         |
| 151–160  | 4.5–6.0%        | Hard sessions reduced or moved |
| 161–170  | 6.0–8.0%        | Easy only           |
| 171–180  | 8.0–10.0%       | Hard running not advised |
| >180     | n/a             | Cancel hard work    |

Alternative formula (when only temperature and humidity % are known):

```
adjustment_pct = max(0, 0.4·(T_degF − 60)) + max(0, 0.2·(humidity_pct − 60))
```

Apply the adjustment to **target pace**:

```
adjusted_target_pace = base_pace × (1 + adjustment_pct/100)
```

Heat sensitivity scales with intensity. Multiply the table value by:
- 1.0 for easy/aerobic
- 1.2 for tempo/threshold
- 1.4 for VO2max intervals
- 1.5 for race effort

Additional rules:
- Below dew point 60°F, no adjustment.
- Acclimatized runners (≥10 days exposure) reduce the adjustment by ~30%.
- First hot day of the season: increase adjustment by ~25%.

### Cold

| Air temp (°F) | Adjustment |
|---------------|------------|
| 30–60         | 0%         |
| 20–29         | +1–2%      |
| 10–19         | +2–3% (footing-dependent) |
| 0–9           | +3–5%      |
| <0            | +5–8%; consider indoor |

Wind chill: subtract 5°F per 10 mph headwind for adjustment lookup.

### Wind

Sustained headwind:

| Wind speed (mph) | Sec/mi added (headwind) |
|------------------|-------------------------|
| 5                | +1–2                    |
| 10               | +5–8                    |
| 15               | +10–15                  |
| 20               | +18–25                  |
| 25               | +25–35                  |
| 30+              | +35–50                  |

Tailwind returns ~50% of the equivalent headwind cost. Crosswinds: ~25% of headwind cost.

### Altitude

Altitude reduces VO2max ~3% per 1000 ft above ~4000 ft. Pace impact is intensity-dependent.

| Elevation (ft) | E pace adj. | T pace adj. | I pace adj. | Race adj. |
|----------------|-------------|-------------|-------------|-----------|
| <3000          | 0           | 0           | 0           | 0         |
| 4000           | +3 sec/mi   | +5–7        | +8–10       | +1–2%     |
| 5000           | +5–7        | +8–10       | +12–15      | +3–5%     |
| 6000           | +8–10       | +12–15      | +18–22      | +5–7%     |
| 7000           | +12–15      | +15–18      | +25–30      | +6–9%     |
| 8000           | +18–22      | +22–28      | +35–45      | +9–12%    |
| 10000          | +30–40      | +45–60      | +60–90      | +12–18%   |

Acclimatization timeline:
- Day 1–3: maximum impact; reduce intensity 20–30%.
- Day 4–10: significant adaptation; resume tempo work cautiously.
- Day 11–21: most adaptation complete; near-normal training possible.
- Sea-level race after altitude block: expect supercompensation lasting ~10–14 days.

### Combined conditions

Add adjustments multiplicatively, not additively:

```
final_pace = base_pace × (1 + heat_adj) × (1 + altitude_adj) × hill_factor × (1 + wind_adj)
```

Or combine sequentially: apply each adjustment in turn.

---

## Treadmill vs. outdoor pace conversion

### The 1% incline rule and its limits

At the same belt speed and 0% grade, treadmill running has *less* metabolic cost than outdoor running because there's no air resistance to overcome. Setting the belt to 1% grade restores the air-resistance equivalent — but only at faster paces.

**Jones & Doyle (1996):** 1% grade ≈ outdoor flat at speeds ≥8.4 mph (≤7:09/mi).

**Speed-dependent rule:**

| Treadmill pace | Recommended grade for outdoor equivalent |
|----------------|------------------------------------------|
| ≥8:00/mi (slow)  | 0%                                     |
| 7:00–8:00/mi    | 0.5%                                   |
| 6:30–7:00/mi    | 1.0%                                   |
| 6:00–6:30/mi    | 1.0–1.5%                               |
| <6:00/mi        | 1.5–2.0%                               |

### General incline → outdoor pace conversion

Each 1% of treadmill grade adds ~3% to metabolic cost relative to flat at the same belt speed.

```
equivalent_outdoor_speed = treadmill_speed × (1 + 0.03 · grade_pct)
```

In pace terms (working backward from speed):

| Treadmill grade | Equivalent outdoor pace adjustment |
|-----------------|-------------------------------------|
| 0%              | Treadmill pace − ~0% (0–10 sec/mi gift on slow paces) |
| 1%              | ≈ outdoor flat                      |
| 2%              | Outdoor flat – ~10 sec/mi (treadmill harder) |
| 3%              | Outdoor flat – ~20 sec/mi           |
| 5%              | Outdoor flat – ~40 sec/mi           |
| 8%              | Outdoor flat – ~70 sec/mi           |
| 10%             | Outdoor flat – ~95 sec/mi           |

**ACSM running VO2 equation** (for any speed/grade):

```
VO2 (mL/kg/min) = (0.2 · S) + (0.9 · S · G) + 3.5
```

where S = speed in m/min and G = grade as decimal.

### Treadmill workout-specific notes

- **VO2max intervals on treadmill**: 0.5–1% grade, full goal pace. Belt acceleration takes 5–10 sec; build that into rep timing.
- **Tempo on treadmill**: 1% grade for runners ≤7:30/mi pace; 0% for slower.
- **Long runs on treadmill**: 0% is fine (boredom > air-resistance correction).
- **Hill repeats on treadmill**: 4–8% grade, pace = T to I effort.
- **Calibration**: many consumer treadmills mis-report speed by ±5%. Verify with a known-distance test if precision matters.

### Cooling penalty

Indoor air is still. Without airflow, heat dissipation is severely impaired. Add ~2–4% to the pace adjustment for treadmill at temperatures >68°F or with no fan. Place a fan; effective cooling restores most of the gap.

---

## Putting it all together: prescribing a workout pace

Pseudo-code the coach can follow for any workout:

```
function prescribe_pace(runner_VDOT, workout_type, conditions):
    base_pace = lookup_pace(runner_VDOT, workout_type)
    
    # environmental
    pace = base_pace × (1 + heat_adjust(T, dew_point, intensity))
    pace = pace × (1 + altitude_adjust(elevation_ft))
    pace = pace × hill_factor(grade)
    pace = pace + wind_adjust(wind_speed_mph, direction)
    
    # surface
    if surface == "trail":     pace += 10–60 sec/mi
    if surface == "treadmill": pace = treadmill_convert(pace, grade_setting)
    
    # window
    range_width = zone_width(workout_type)
    return (pace - range_width/2, pace + range_width/2)
```

Default fallback if any input is missing: prescribe an **effort target** (RPE + HR range) and a **wide pace window** (E ±60 sec/mi; T ±10 sec/mi).

---

## VDOT context — tiers, freshness, and how to test

The lookup table maps VDOT to race times, but the number on its own
("VDOT 47.1") is contextless. This section documents what a VDOT
score *means* relative to the running population, how long a given
VDOT remains a valid signal of current fitness, and how to test
deliberately when no recent race fits the window.

### Tier classification (consensus interpretation)

Daniels' published tables span VDOT 30–85. The community-standard
tier interpretation (used by VDOT calculators, training plans, and
running-software UIs across the industry) breaks the range into
four levels keyed to 5K race-time benchmarks:

| Tier             | VDOT range | 5K time benchmark | Marathon benchmark |
|------------------|------------|-------------------|--------------------|
| **Novice**       | 30–40      | ~30:00+ 5K        | ~4:30+ marathon    |
| **Intermediate** | 40–50      | ~21:00–30:00 5K   | ~3:10–4:30 marathon|
| **Advanced**     | 50–60      | ~17:00–21:00 5K   | ~2:35–3:10 marathon|
| **Sub-elite/Elite** | 60+     | sub-17:00 5K      | sub-2:35 marathon  |

These labels are interpretive — Daniels himself uses a numeric
"performance level 1–10" framework in *Daniels' Running Formula*,
where levels 4–6 are described as "pretty darn good" and levels
7–10 represent sub-elite to elite. The tier names above are how
the VDOT score is most commonly communicated to recreational
runners; they do not correspond 1:1 to Daniels' performance
levels but track the same monotone scale.

**Caveats:**
- Tiers are descriptive, not prescriptive. An "intermediate" runner
  doesn't get easier paces — VDOT-derived paces are absolute.
- Age and sex shift relative competitiveness substantially. A 50-year-old
  male VDOT 47 is more competitive within his age/sex cohort than a
  25-year-old male at the same VDOT. **Age-grading and sex-grading
  are documented separately** (see Research doc on grading) and apply
  on top of the raw VDOT, not as replacements.
- The exact tier boundaries are conventional, not bright lines —
  VDOT 39.8 and 40.2 represent essentially identical fitness even
  though one labels as "novice" and the other "intermediate."

### Freshness window — when does a VDOT signal expire?

VDOT computed from a race result represents *current fitness on
race day*. Fitness drifts (up during builds, down during taper or
detraining), so the older the race, the staler the signal.

| Time since race | Validity for current fitness                                  |
|-----------------|---------------------------------------------------------------|
| 0–4 weeks       | Fresh signal. Use without adjustment.                         |
| 4–8 weeks       | Slightly stale. Still usable, but next race or test should refresh. |
| 8–12 weeks      | Stale. The runner's fitness has likely moved meaningfully — taper, base, layoff, or further build. Use only as a floor, prompt for a fresh test. |
| 12+ weeks       | Expired. Don't anchor pace prescription on this VDOT. Use field test or recent race instead. |

**Operative rule:** within the last 8 weeks (≤56 days), the strongest
race result is the canonical VDOT input. Beyond that, the Coach should
prompt for a fresh test rather than continue prescribing paces against
a stale anchor.

### Testing cadence — how often to deliberately test

Daniels recommends reassessing fitness every 4–6 weeks during a
build block. Most build cycles produce natural test opportunities
(tune-up race, hard tempo session) — when they don't, prescribe a
deliberate test.

| Trigger                                    | Recommended action                  |
|--------------------------------------------|-------------------------------------|
| ≥6 weeks since last race or test           | Schedule a 5K time trial or 30-min TT |
| Tempo runs feel notably easier (sustained) | +1 VDOT estimated; field-test within 2 weeks |
| Tempo runs unexpectedly hard for 2+ sessions | -1 to -2 VDOT estimated; check overtraining; field-test |
| Returning from layoff ≥2 weeks             | Drop 3-5 VDOT estimate; rebuild then test |
| Returning from layoff ≥6 weeks             | Drop 5-8 VDOT estimate; rebuild from base then test |

### Field-test selection for the Coach

When the Coach plans a test (no recent race available, or VDOT is
stale), the preferred protocols rank as:

1. **5K time trial** — most accurate, simplest. Run all-out on a
   flat course or track, with a 15-minute warm-up. Apply +1 VDOT
   correction for solo effort (no competition tax).
2. **30-minute time trial** — surfaces threshold pace directly
   (last 20 min average pace ≈ LT pace), and VDOT can be back-derived.
   Less psychologically demanding than a 5K all-out.
3. **3K + 5K combined** — two TTs on separate days, take the
   better-fit VDOT. Use when the runner wants higher confidence.
4. **Cooper test (12-min run)** — coarse, less accurate; only when
   the above aren't feasible.

The Coach should plan the test as a *workout* in the runner's week
(replacing a quality session, not added on top), and surface why:
"VDOT is from 9 weeks ago; let's lock in your current fitness."

### Implementation notes for the engine

- **Window** — use ≤56 days as the canonical freshness window.
  `pickStrongestRecentRace` should walk all races + Strava activities
  in this window, not just the engine's 28-day "recent" view (which
  exists for heavy-block detection).
- **Selection** — pick the highest derived VDOT, not the most recent.
  A 6-week-old PR is a better fitness signal than a heat-affected
  race last weekend.
- **Quality flag** — future: tag races as "well-paced / heat-affected /
  tactical" in `state.races.recent`. Heat-affected races should be
  deprioritized in VDOT selection. Currently we don't have this signal
  and treat all races equally.
- **Stale UI state** — when VDOT is fresh (≤4w) show clean. When 4-8w
  show "stale soon." When >8w or absent, show a "test prompt" surface
  with the field-test selection above.

---

## Sources

### Primary

- Daniels, J. (2014). *Daniels' Running Formula*, 3rd ed. Human Kinetics. (Source for VDOT system, training paces, dosing rules.)
- Daniels, J. T., & Gilbert, J. (1979). *Oxygen Power: Performance Tables for Distance Runners.* (Original VDOT tables and equations.)
- Pfitzinger, P. & Douglas, S. (2019). *Advanced Marathoning*, 3rd ed. Human Kinetics. (Pace zones, %HRmax/%HRR ranges.)
- McMillan, G. *YOU (Only Faster).* (Six-step training system, six-zone calculator methodology.)
- Humphrey, L., Hanson, K., & Hanson, K. (2012). *Hansons Marathon Method.* VeloPress. (Pace structure, strength workouts, cumulative-fatigue principle.)
- Riegel, P. (1981). "Athletic records and human endurance." *American Scientist* 69:285–290. (Race-time prediction formula.)
- Jones, A. M. & Doyle, J. (1996). "A 1% treadmill grade most accurately reflects the energetic cost of outdoor running." *Journal of Sports Sciences* 14:321–327.
- Minetti, A. E. et al. (2002). "Energy cost of walking and running at extreme uphill and downhill slopes." *Journal of Applied Physiology* 93:1039–1046.
- American College of Sports Medicine. *ACSM's Guidelines for Exercise Testing and Prescription* (running VO2 equation).
- Mantzios, K. et al. (2022). Marathon performance under heat stress (data underpinning Running Writings heat model).

### Coaching references

- [Jack Daniels VDOT Calculator (vdoto2.com)](https://vdoto2.com/calculator)
- [Coaches Education — Determining Current Level of Fitness (Daniels)](https://www.coacheseducation.com/endur/jack-daniels-nov-00.php)
- [Kalamazoo Area Runners — VDOT Conversion Table](https://kalamazooarearunners.org/vdot-conversion-table)
- [Daniels One-Sheet (sdtrackmag.com PDF)](https://sdtrackmag.com/DanielsOneSheet.pdf)
- [Fellrnr — Jack Daniels' Running Formula](https://fellrnr.com/wiki/Jack_Daniels_Running_Formula)
- [Sweat Elite — Understanding the Jack Daniels Running Formula](https://articles.sweatelite.co/understand-the-jack-daniels-running-formula-in-15mins/)
- [McMillan Running — Six-Step Training System](https://www.mcmillanrunning.com/mcmillans-six-step-training-system/)
- [McMillan Running — Heart Rate Zones](https://www.mcmillanrunning.com/running-heart-rate-zones/)
- [Pfitzinger Marathon Training summary (Dave's Running Blog)](https://davesrunningblog.wordpress.com/2018/04/13/p-d-pfitzinger-douglas-marathon-training/)
- [Run Regimen — Lactate Threshold Calculator (Pfitzinger zones)](https://runregimen.com/tools/lactate-threshold-calculator)
- [Luke Humphrey Running — Marathon Strength Workouts (Hansons)](https://lukehumphreyrunning.com/marathon-strength-workouts/)
- [Luke Humphrey Running — Treadmill Grade](https://lukehumphreyrunning.com/treadmill-running-whats-grade-got-to-do-with-it/)
- [RunFitMKE — Hot Weather Pace Adjustment Table](https://www.runfitmke.com/blog/how-to-calculate-pace-adjustment-for-hot-weather-running)
- [Running Writings — Heat-Adjusted Pace Calculator](https://apps.runningwritings.com/heat-adjusted-pace/)
- [Running Writings — GAP Calculator (Minetti)](https://apps.runningwritings.com/gap-calculator/)
- [V.O2 News — Adjusting Training Paces for High Temperatures](https://news.vdoto2.com/2015/07/adjust-your-training-paces-for-high-temperatures/)
- [V.O2 News — Threshold Pace at Altitude](https://news.vdoto2.com/2011/03/ask-a-coach-how-do-you-adjust-threshold-pace-at-altitude/)
- [HillRunner — Treadmill Pace Conversions](https://www.hillrunner.com/calculators/treadmill-pace-conversions/)
- [PMC — Validation of Treadmill Speed Incline Conversion Chart](https://pmc.ncbi.nlm.nih.gov/articles/PMC10707652/)
- [RunnersConnect — Riegel Formula Accuracy](https://runnersconnect.net/race-calculators/)
- [RunnersConnect — How to Calculate Lactate Threshold](https://runnersconnect.net/how-to-calculate-your-lactate-threshold/)
