# 06 — Weather Adjustment Rules

Reference doc: pace, effort, and goal adjustments for environmental conditions. Numbers below are population averages from peer-reviewed marathon datasets and applied-coaching syntheses; individual variation is large (slower runners and unacclimatized runners are penalized more).

## Definitions

- **Tair**: Dry-bulb air temperature (the reading on a normal thermometer).
- **RH**: Relative humidity. Percent of water vapor relative to saturation at current Tair. Changes with Tair even when absolute moisture is constant.
- **Td (dewpoint)**: Temperature at which air becomes saturated. Stable measure of absolute atmospheric moisture; better predictor of evaporative cooling capacity than RH.
- **Tw (wet-bulb)**: Temperature read by a thermometer wrapped in wet cloth in moving air. Reflects evaporative cooling potential.
- **WBGT**: Wet Bulb Globe Temperature. Composite outdoor heat index combining Tw, Tg (black-globe radiation), and Tair.
- **PM2.5**: Particulate matter ≤2.5 µm — the most performance- and health-relevant air-pollution metric for runners.
- **AQI**: U.S. EPA Air Quality Index, 0–500 scale.
- **GAP**: Grade-Adjusted Pace.
- **Equivalent neutral pace**: Pace that produces the same physiological cost in 50–55°F / Td <50°F / sea-level / no-wind reference conditions as the observed pace in adverse conditions.

## Optimal Conditions Reference

```
Optimal Tair (men):     ~42–46°F  (5.9–7.7°C)
Optimal Tair (women):   ~46–50°F  (7.7–10°C)
Acceptable range:       35–55°F   (2–13°C)
Optimal Td:             <50°F     (<10°C)
Optimal solar load:     overcast, no direct sun
Optimal wind:           <5 mph, calm
Optimal altitude:       <1,000 ft (<300 m)
```

Above these ranges, performance degrades non-linearly. Cold deviations are less costly than equivalent-magnitude warm deviations.

---

## Section 1 — Heat Adjustment by Air Temperature

### Maughan / Ely / Vihma synthesis: marathon slowdown by Tair

Aggregated pattern across marathon datasets (Boston, Berlin, Chicago, NYC, Stockholm, Twin Cities). Slowdown is relative to the same runner's expected time at 50°F.

| Tair (°F) | Tair (°C) | Elite slowdown | 3:30 marathoner | 4:30+ marathoner |
| --- | --- | --- | --- | --- |
| 40 | 4 | 0% | 0% | 0% |
| 50 | 10 | 0% (optimum) | 0% (optimum) | 0% (optimum) |
| 60 | 16 | 0.5% | 1.5% | 2.5% |
| 65 | 18 | 1.0% | 2.5% | 4.0% |
| 70 | 21 | 1.5% | 4.0% | 6.0% |
| 75 | 24 | 2.5% | 5.5% | 8.5% |
| 80 | 27 | 3.5% | 7.5% | 11.5% |
| 85 | 29 | 4.5% | 10.0% | 15.0% |
| 90 | 32 | 6.0% | 13.0% | 19.0% |

### Per-mile adjustment (continuous running, dry conditions, Td <55°F)

```
seconds_per_mile_added ≈ pace_seconds_per_mile × slowdown_pct / 100
```

Quick lookup at slowdown rates above 55°F:

| Pace | +5°F over 55 | +10°F | +15°F | +20°F | +25°F | +30°F |
| --- | --- | --- | --- | --- | --- | --- |
| 6:00/mi | +2 s | +5 s | +8 s | +12 s | +18 s | +25 s |
| 7:00/mi | +4 s | +8 s | +13 s | +20 s | +28 s | +38 s |
| 8:00/mi | +6 s | +12 s | +20 s | +30 s | +42 s | +56 s |
| 9:00/mi | +9 s | +18 s | +30 s | +45 s | +62 s | +82 s |
| 10:00/mi | +12 s | +25 s | +42 s | +62 s | +85 s | +110 s |

Rule: faster runners accumulate less heat over the race; slower runners accumulate more total heat load and slow disproportionately.

### Vihma Stockholm Marathon (1980–2008) finding

For elite men, Tair shift from 10°C → 25°C added ~5 minutes; for 4-hour marathoners the same shift added ~23 minutes. The slowdown ratio (slow:elite) is roughly 4–5×.

---

## Section 2 — Humidity and Dewpoint

### Why dewpoint, not RH

RH varies through the day at constant absolute humidity. Td is a stable indicator of how much moisture the air can absorb — i.e., how well sweat evaporates. Sweat evaporation provides ~80% of cooling at moderate intensity; when Td approaches skin temperature (~91°F), evaporation stalls.

### Dewpoint impact table (RunnersConnect framework, validated against Maughan/Otani lab data)

| Td (°F) | Td (°C) | Easy run | Quality session | Pace adjustment |
| --- | --- | --- | --- | --- |
| <50 | <10 | Normal | Normal | 0% |
| 50–54 | 10–12 | Normal | Normal | 0–0.5% |
| 55–59 | 13–15 | Normal | Slightly harder | 0.5–1% |
| 60–64 | 16–18 | Slightly harder | Harder | 1–3% |
| 65–69 | 18–21 | Hard | Very hard | 3–5% |
| 70–74 | 21–23 | Very hard | Convert to time-on-feet | 5–8% |
| 75–79 | 24–26 | Survival | Postpone or move indoors | 12–15% |
| ≥80 | ≥27 | Skip or run early | Skip | Run by HR/effort only |

### Combined Tair + Td index (Hadley/Maximum Performance Running)

Add Tair (°F) + Td (°F). The sum drives a single percentage adjustment. Validated pattern matches Maughan-style heat-stress data better than Tair alone.

| Tair + Td (°F) | Pace adjustment | Notes |
| --- | --- | --- |
| ≤100 | 0% | Neutral conditions |
| 101–110 | 0–0.5% | Imperceptible |
| 111–120 | 0.5–1.0% | Easy runs unaffected |
| 121–130 | 1–2% | Workouts feel slightly harder |
| 131–140 | 2–3% | Adjust quality paces |
| 141–150 | 3–4.5% | Adjust all paces |
| 151–160 | 4.5–6% | Workouts compromised |
| 161–170 | 6–8% | Run by effort |
| 171–180 | 8–10% | Easy only or postpone |
| >180 | Stop | Hard running not recommended |

### Interval-vs-continuous rule

For repeats with ≥1:1 work:rest, apply **half** the continuous-run adjustment — recovery periods allow partial cooling.

```
adjustment_intervals = adjustment_continuous × 0.5
```

---

## Section 3 — WBGT (Wet Bulb Globe Temperature)

### Computation

```
Outdoor (sun):  WBGT = 0.7 × Tw + 0.2 × Tg + 0.1 × Tair
Indoor/shade:   WBGT = 0.7 × Tw + 0.3 × Tair
```

Tg = black-globe temperature (≈Tair + 5–25°F depending on solar load).

### Approximation when only Tair, RH, and sun are known

```
WBGT_approx (°F) ≈ Tair − ((100 − RH) / 5) + solar_correction
solar_correction: full_sun = +5°F, partial = +2°F, overcast = 0°F
```

### Race / training thresholds (ACSM + Korey Stringer Institute, temperate-acclimatized runners)

| WBGT (°F) | WBGT (°C) | Flag | Action |
| --- | --- | --- | --- |
| <50 | <10 | White | Optimal. Normal training and racing. |
| 50–64 | 10–18 | Green | Low risk. Normal sessions. |
| 65–72 | 18–22 | Yellow | Moderate risk. Reduce hard-session volume 5–10%. |
| 73–82 | 23–28 | Red | High risk. Reduce intensity 10–20%, shorten quality. Consider rescheduling races. |
| 83–86 | 28–30 | Black | Extreme risk. Cancel competitive racing. Easy only, early/late only. |
| >86 | >30 | Black | Cease outdoor sessions. |

Regional-acclimatization adjustment: hot-climate runners can shift each threshold +2–4°F (Korey Stringer Institute / UGA regional categories).

---

## Section 4 — Heat Acclimation

### Adaptation timeline (Périard 2021, Tipton-related ACSM consensus)

| Day | Plasma volume | Sweat onset | Sweat rate | HR @ workload | Core temp | Performance |
| --- | --- | --- | --- | --- | --- | --- |
| 1–3 | +5–8% | Earlier | Modest ↑ | −5 bpm | −0.2°C | Begins improving |
| 4–7 | +10–12% | Much earlier | +20–30% | −10 bpm | −0.4°C | ~50% gains realized |
| 8–10 | +12% | Optimized | Plateaued | −10–15 bpm | −0.5°C | ~70–80% gains |
| 11–14 | Stable | Stable | Stable | −15 bpm | −0.5–0.7°C | Full acclimation |
| 14+ | Sweat Na+ ↓ | — | — | — | — | Refines |

### Protocol (Marathon Handbook / RunnersConnect / Périard synthesis)

```
Duration:    10–14 days minimum, 14–21 days preferred
Frequency:   5–6 sessions/week (3 days/week maintains)
Session:     60–90 min @ moderate intensity in hot environment
Heat dose:   Tair ≥85°F or WBGT ≥75°F; or post-run sauna 25–40 min @ 175–195°F
Goal:        Core temp ≥38.5°C (101.3°F) for ≥30 min
Decay:       Gains lose 2–3% per day after stopping; ~50% lost in 1 week
```

### Pacing during acclimation

| Day in protocol | Workout pacing |
| --- | --- |
| 1–3 | −10 to −15% (run very easy, target time-on-feet) |
| 4–7 | −5 to −10% |
| 8–10 | −3 to −5% |
| 11–14 | Hit normal heat-adjusted paces |
| 14+ | Race-ready |

### Sauna alternative (cold-climate runners)

```
Post-run sauna: 25–35 min @ 175–195°F (80–90°C)
Frequency:      4–5 sessions/week × 3 weeks
Hydration:      Replace 100–125% of mass loss
Expected:       70–80% of full heat-acclimation effect
```

---

## Section 5 — Cold Weather Adjustments

### Performance impact (asymmetric — much smaller than heat)

| Tair (°F) | Tair (°C) | Slowdown vs. 50°F | Notes |
| --- | --- | --- | --- |
| 35–45 | 2–7 | 0–0.5% | Often optimal range |
| 25–35 | −4 to 2 | 0.5–1% | Slight slowdown from warmup cost |
| 15–25 | −9 to −4 | 1–2% | Heavier clothing, footing issues |
| 5–15 | −15 to −9 | 2–4% | Bronchospasm risk in some |
| −5 to 5 | −20 to −15 | 4–7% | Restrict outdoor quality |
| <−5 | <−20 | 7–15% | Indoor or skip; frostbite risk |

### Cold physiology

- Carbohydrate oxidation ↑, fat oxidation ↓ at given intensity → fueling matters more.
- Lactate accumulates earlier at given pace.
- Muscle contraction force ↓ ~5% per 10°C tissue cooling.
- Respiratory water loss: 1–2 L/hr at very cold temps. Hydrate despite low thirst.

### Wind chill thresholds

| Wind chill (°F) | Action |
| --- | --- |
| >0 | Normal session with appropriate layers |
| 0 to −18 | Cover all skin; limit hard outdoor efforts to ≤30 min |
| −19 to −31 | Frostbite ≤30 min on exposed skin; restrict to easy continuous |
| <−31 | Frostbite <10 min; move indoors |

### Cold-weather layering rule

```
target_clothing_temp = Tair + 15 to 20°F (for active running)
```

| Felt-as temp | Layers |
| --- | --- |
| 50–60°F | Singlet/T + shorts |
| 40–50°F | Long sleeve + shorts/light tights |
| 30–40°F | Long sleeve + tights + light gloves + hat |
| 20–30°F | Base + mid + tights + gloves + hat + buff |
| 10–20°F | Base + mid + wind shell + thermal tights + heavy gloves + balaclava |
| <10°F | + insulated outer, double gloves, goggles, cover all skin |

### Cold hydration

Drink 4–6 oz every 20–30 min on runs >60 min despite low thirst. Use insulated bottles below 25°F (water freezes in ~30 min at 20°F).

---

## Section 6 — Wind

### Physical model

Drag scales with the **square** of relative airspeed. Cost is asymmetric: a headwind costs roughly 2× what an equal tailwind gives back.

```
Δ_cost ∝ (v_runner + v_wind)² − v_runner²    (headwind)
Δ_benefit ∝ v_runner² − (v_runner − v_wind)²  (tailwind, smaller magnitude)
```

### Headwind / tailwind seconds-per-mile (flat, dry, head-on/dead-aft)

| Wind | Headwind cost (6:00 pace) | Headwind cost (8:00 pace) | Tailwind benefit (6:00) | Tailwind benefit (8:00) |
| --- | --- | --- | --- | --- |
| 5 mph | +3 s | +5 s | −1.5 s | −2 s |
| 10 mph | +12 s | +18 s | −6 s | −9 s |
| 15 mph | +24 s | +35 s | −12 s | −17 s |
| 20 mph | +40 s | +58 s | −20 s | −28 s |
| 25 mph | +60 s | +85 s | −30 s | −42 s |
| 30 mph | +85 s | +120 s | −42 s | −58 s |

### Crosswind

Pure crosswind costs ~25–30% of equivalent headwind (still adds drag and balance cost).

### Out-and-back rule of thumb

A point-to-point with steady wind ≈ flat-wind course minus 30–40% of headwind cost (asymmetry). Plan for **net loss** on out-and-back routes.

### Drafting

```
draft_savings ≈ 80% of wind-resistance cost
metabolic ≈ 6% VO2 reduction at race pace in close pack
```

Workout adjustment in wind ≥15 mph: convert intervals to **effort/HR-based** or run loops to alternate exposures.

---

## Section 7 — Altitude

### Race performance loss by elevation (sea-level acclimatized)

| Elevation (ft) | Elevation (m) | Acute (day 1–3) | After 3 weeks acclimatization | Endurance event slowdown |
| --- | --- | --- | --- | --- |
| 1,000 | 305 | <1% | <0.5% | Negligible |
| 2,500 | 760 | 1–2% | 0.5–1% | ~1% |
| 4,000 | 1,220 | 3–5% | 1.5–2.5% | ~2.5% |
| 5,000 | 1,525 | 5–8% | 2–4% | ~4% |
| 6,000 | 1,830 | 7–10% | 3–5% | ~5–6% |
| 7,000 | 2,135 | 10–14% | 4.5–7% | ~7–8% |
| 8,000 | 2,440 | 13–18% | 6–9% | ~10% |
| 9,000 | 2,745 | 16–22% | 8–12% | ~12–14% |
| 10,000 | 3,050 | 20–28% | 10–15% | ~15–18% |

### Per-mile training pace adjustment (acute, threshold/interval pace)

| Elevation (ft) | Easy/aerobic | Threshold / 5K-pace |
| --- | --- | --- |
| 3,000 | 0–3 s/mi | 4–6 s/mi |
| 4,000 | 3–6 s/mi | 7–10 s/mi |
| 5,000 | 5–10 s/mi | 10–15 s/mi |
| 6,000 | 8–14 s/mi | 14–20 s/mi |
| 7,000 | 12–18 s/mi | 18–25 s/mi |
| 8,000 | 16–24 s/mi | 24–32 s/mi |
| 9,000 | 22–32 s/mi | 30–42 s/mi |
| 10,000 | 28–40 s/mi | 38–55 s/mi |

Rule: above 3,000 ft, **easy paces** are minimally affected; **VO2max-paced** work is most affected (5K pace > threshold > marathon pace > easy).

### Altitude acclimatization timeline

| Time at altitude | Adaptation | Performance |
| --- | --- | --- |
| Hours 0–24 | Hyperventilation, ↑HR, plasma loss (hemoconcentration) | Worst |
| Days 2–5 | Bicarbonate buffer drop, sleep disruption, VO2max nadir | Still poor |
| Days 6–14 | EPO release, early RBC formation, Hbmass +1–3%, ventilatory acclimation | Noticeable improvement |
| Days 14–21 | Hbmass +3–6%, capillary density adapting, lactate handling improves | ~70% recovery |
| Days 21–28 | Continued Hbmass gain, full ventilatory acclimation | ~80–90% |
| 4–6 weeks | Full hematological adaptation (rule: ~11.4 days × altitude_km) | Asymptote |

### Arrival timing rule (Stellingwerff, Chapman)

Two viable strategies for racing **at moderate altitude** from sea level:

```
Strategy A: arrive ≤24 h before race  (avoid acute-phase decline)
Strategy B: arrive ≥14 days before    (capture acclimatization gains)
Strategy AVOID: arrive 2–7 days before (worst window: hyperventilation + bicarbonate loss without RBC gain)
```

### Live-High-Train-Low (LHTL)

```
Live altitude:        2,000–2,500 m  (6,500–8,200 ft)  optimal range
Train altitude:       <1,200 m       (sea-level paces preserved)
Hypoxic dose:         ≥12 h/day @ ≥2,100 m, for ≥3 weeks
Total exposure:       ≥250–300 h continuous-equivalent
Expected gains:       Hbmass +3–6%, sea-level VO2max +1–4%, time-trial +1–3%
Detraining:           gains decay over 2–4 weeks at sea level
```

LHTL outperforms Live-High-Train-High (LHTH) for sea-level events because training velocity is preserved. Not all responders gain; ~30% are non-responders by Hbmass criterion.

### Sea-level → altitude race conversion

```
T_altitude = T_sealevel × (1 + slowdown_pct/100)
```

Use the "After 3 weeks" column in the elevation table for acclimatized targets; "Acute" column for travel-day racing.

---

## Section 8 — Rain, Sun, Track Surface

### Rain

| Condition | Performance impact |
| --- | --- |
| Light rain, mild Tair | Often **net positive** (cooling, reduced solar) |
| Heavy rain, mild Tair | Slight negative: shoe weight gain (~3–5%), footing |
| Cold rain (<45°F) | Significant: hypothermia risk, layer wetting; +1–2% slowdown |
| Rain on race surface | +1–3 s/mi from footing on roads; +5–10 s/mi on trails |

Rain itself is mostly footing and gear management. Pace impact is small unless cold.

### Sun / radiant heat

Direct sun adds **~5–10°F effective heat load** versus shade at the same Tair.

| Sky condition | Tair adjustment for WBGT/heat-stress estimate |
| --- | --- |
| Heavy overcast | 0°F |
| Partly cloudy | +2°F |
| Bright cloudy / hazy | +4°F |
| Full sun, midday, summer | +8 to +12°F |
| Full sun + asphalt + low wind | +12 to +18°F |

Mitigation: white/reflective gear, hat with brim, sunglasses, ice in cap/bandana, route selection (shaded streets, north-side of east-west roads in northern hemisphere).

### Track / surface temperature

```
Surface_temp ≈ Tair + (5 to 50°F) depending on color, sun, wind
```

Black asphalt at 95°F Tair: 130–145°F surface. Concrete: 110–125°F. Track rubber: 115–135°F. The radiant load to the runner from hot surfaces adds an effective +3–8°F to body heat input. On hot afternoons, prefer dirt, grass, or shaded paths.

---

## Section 9 — Air Quality

### AQI thresholds for runners

| AQI | Category | PM2.5 (µg/m³) | Easy run | Quality session | Long run |
| --- | --- | --- | --- | --- | --- |
| 0–50 | Good | 0–12 | Normal | Normal | Normal |
| 51–100 | Moderate | 12–35 | Normal | Normal (sensitive: monitor) | Normal |
| 101–150 | USG* | 35–55 | Normal (≤60 min) | Reduce intensity 10% | Caution; avoid if respiratory hx |
| 151–200 | Unhealthy | 55–150 | ≤30 min, easy only | Move indoors | Move indoors |
| 201–300 | Very Unhealthy | 150–250 | Indoors only | Indoors only | Indoors only |
| 301+ | Hazardous | >250 | Skip / indoors with HEPA | Skip | Skip |

*USG = Unhealthy for Sensitive Groups.

### Practical race-week rule

- AQI ≤100 throughout last 21 days: race target unchanged.
- AQI 100–150 multiple days in last 21: expect ~5–10 s slower per race-mile (per Marr et al. collegiate runner data: 12.8 s slower in race per +5 µg/m³ PM2.5 over 21 d).
- AQI >150 with smoke (wildfire): consider rescheduling.

### Ozone

O3 >70 ppb: avoid hard sessions in afternoon (peak); shift to early morning. Effects compound with heat.

---

## Section 10 — Race-Day Recalibration

### Decision flow

```
1. Look up Tair, RH, Td, wind, sun, AQI, elevation for race start time and +2h.
2. Compute Td-based pace adjustment (Section 2 table) or WBGT (Section 3).
3. Apply altitude adjustment (Section 7) if elevation >3,000 ft.
4. Apply wind adjustment (Section 6) for net wind on course.
5. Apply AQI gate (Section 9): race-day cancellation if AQI >200.
6. Sum percentages; convert to per-mile target.
7. Pace early miles 5–10 s/mi slower than total adjusted pace; reassess at 5K and 10K.
```

### Combined adjustment formula (additive approximation)

```
total_slowdown_pct ≈ heat_pct + altitude_pct + wind_pct + aqi_pct
```

Heat and altitude slightly compound (not strictly additive); when both >5%, reduce expected gains by ~10% — i.e., a 6% heat + 6% altitude condition ≈ 11% (not 12%).

### Race time conversion to neutral equivalent

```
T_neutral ≈ T_observed / (1 + total_slowdown_pct/100)
```

Use this to:
- Compare a hot/altitude race against a cool/sea-level PR
- Set fitness from a non-ideal time trial
- Re-rank race performances across conditions

Worked example:
```
Observed marathon = 3:30:00 in Td 70°F, Tair 78°F (sum 148, ~3.5% adj), full sun (+1%), 10 mph net headwind on out-and-back (+0.5%), 2,500 ft (+1%) → total ~6%
T_neutral = 3:30:00 / 1.06 ≈ 3:18:08
```

---

## Section 11 — Training Pace Adjustments and Bail Triggers

### When to slow paces

```
Apply Td/Tair table whenever (Tair + Td) > 110°F or Td > 60°F
Apply altitude table whenever elevation > 3,000 ft
Apply wind table whenever sustained wind > 10 mph
```

### When to convert to time-on-feet (drop pace targets)

| Trigger | Action |
| --- | --- |
| Td ≥70°F | Quality sessions: time-based, RPE-driven |
| WBGT ≥80°F | All hard sessions: convert to easy time-on-feet |
| Wind ≥20 mph sustained | Intervals: time-based or move to track loops |
| Altitude >7,000 ft + first 7 days | Time-on-feet only; no quality |
| AQI 151–200 | Easy time-on-feet ≤30 min or indoors |

### Hard bail triggers (cancel/postpone)

| Trigger | Reason |
| --- | --- |
| WBGT >86°F (>30°C) | ACSM black flag |
| Td ≥80°F | Evaporative cooling fails |
| Wind chill < −18°F (<−28°C) | Frostbite within 30 min |
| AQI >200 | Acute health risk |
| Wildfire smoke visible / smell | PM2.5 spikes uncorrelated with reported AQI |
| Lightning within 10 mi | Defer 30 min from last strike |
| Ice / black ice on route | Footing > pace concern |

### Heat-illness early-warning signs (stop immediately)

```
- Cessation of sweating with continued heat exposure
- Pace drift >10% with stable RPE
- HR drift >15 bpm at constant pace beyond drift baseline
- Goosebumps, chills, headache, confusion
- Nausea or cramping at >20 min in heat
```

### Hydration adjustment by condition

```
Cool (Tair <60°F):           400–600 mL/hr
Warm (60–75°F):              500–800 mL/hr
Hot (>75°F or Td >65°F):     600–1,000 mL/hr (cap ~1,200 mL/hr to avoid hyponatremia)
Cold (<35°F):                300–500 mL/hr (overcome low thirst drive)
Sodium target in heat:       300–700 mg Na+/hr; up to 1,000 mg/hr for salty sweaters
```

---

## Section 12 — Quick Reference: Single-Number Slowdown

If only one number is available for a given runner, use this fallback table for marathon pace, mid-pack runner, full sun, sea level, calm wind:

| Tair (°F) | Slowdown |
| --- | --- |
| 35–55 | 0% |
| 60 | 1% |
| 65 | 2% |
| 70 | 4% |
| 75 | 6% |
| 80 | 8% |
| 85 | 11% |
| 90 | 14% |
| 95 | 18% |

Then add: +0.5% per 1,000 ft above 3,000 ft (acclimatized) or +1% per 1,000 ft (acute), and +1% per 10 mph net headwind, and +1% per 10°F dewpoint above 60°F.

---

## Sources

- Maughan RJ. Distance running in hot environments: a thermal challenge to the elite runner. *Scand J Med Sci Sports* 2010;20(Suppl 3):95–102.
- Maughan RJ, Otani H, Watson P. Influence of relative humidity on prolonged exercise capacity in a warm environment. *Eur J Appl Physiol* 2012;112:2313–2321.
- Vihma T. Effects of weather on the performance of marathon runners. *Int J Biometeorol* 2010;54:297–306.
- Ely MR, Cheuvront SN, Roberts WO, Montain SJ. Impact of weather on marathon-running performance. *Med Sci Sports Exerc* 2007;39(3):487–493.
- Cheuvront SN, Kenefick RW, Montain SJ, Sawka MN. Mechanisms of aerobic performance impairment with heat stress and dehydration. *J Appl Physiol* 2010;109:1989–1995.
- Sawka MN, Cheuvront SN, Kenefick RW. High skin temperature and hypohydration impair aerobic performance. *Exp Physiol* 2012;97(3):327–332.
- Périard JD, Eijsvogels TMH, Daanen HAM. Exercise under heat stress: thermoregulation, hydration, performance implications, and mitigation strategies. *Physiol Rev* 2021;101(4):1873–1979.
- Périard JD, Racinais S, Sawka MN. Adaptations and mechanisms of human heat acclimation. *Scand J Med Sci Sports* 2015;25(Suppl 1):20–38.
- Tipton MJ, Bradford C. Moving in extreme environments: open water swimming in cold and warm water. *Extrem Physiol Med* 2014;3:12.
- Castellani JW, Young AJ. ACSM Expert Consensus Statement: Injury Prevention and Exercise Performance during Cold-Weather Exercise. *Curr Sports Med Rep* 2021.
- Stellingwerff T, Peeling P, Garvican-Lewis LA, et al. Nutrition and altitude: strategies to enhance adaptation, improve performance and maintain health. *Sports Med* 2019;49(Suppl 2):169–184.
- Chapman RF, Stickford JL, Levine BD. Altitude training considerations for the winter sport athlete. *Exp Physiol* 2010;95(3):411–421.
- Levine BD, Stray-Gundersen J. "Living high–training low": effect of moderate-altitude acclimatization with low-altitude training on performance. *J Appl Physiol* 1997;83(1):102–112.
- Marr LC, Ely MR. Effect of air pollution on marathon running performance. *Med Sci Sports Exerc* 2010;42(3):585–591.
- ACSM. Heat and Cold Illnesses During Distance Running, Position Stand. *Med Sci Sports Exerc.*
- Korey Stringer Institute. WBGT regional categories and activity modification guidelines.
- RunnersConnect. Dew point chart and pace adjustment framework. https://runnersconnect.net/dew-point-effect-running/
- Hadley M (Maximum Performance Running). Temperature + dew point pace adjustment table.
- Running Writings (J Burgess). Heat–humidity marathon pace calculator and methodology, 2025.
- Marathon Handbook. Ideal marathon temperature and acclimation protocols.
- AirNow / U.S. EPA. Air Quality Index (AQI) Basics.
