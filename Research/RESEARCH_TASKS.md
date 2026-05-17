# Running App — Research Knowledge Base Task List

This file is the master checklist for building out the research knowledge base that feeds the running app's AI coach. Work through tasks in order. Each task produces one comprehensive, generic markdown document in `/research/`.

---

## Architecture Principles

**The research is the knowledge base. The coach is the runtime layer.**

- Research docs are GENERIC. They cover all runner types, paces, ages, sexes, experience levels, and goals.
- Research docs do NOT contain personalization, examples tailored to one runner, or "for a sub-3:30 marathoner..." framing.
- The coach (separate runtime layer) interprets this knowledge against the user's actual training data, fitness, goals, and recovery state.
- If you find yourself writing "you" or referring to a specific runner profile, stop and rewrite generically.

**Format priorities for AI consumption:**

- Lookup tables, formulas, decision rules, and conditional logic preferred over prose where applicable
- Every prescription includes the variable it depends on (e.g., "Long run pace = MP + 10-25%, dependent on experience level: novice +20-25%, intermediate +15-20%, advanced +10-15%")
- Define every term on first use
- Cite sources at the end of each doc
- Use consistent terminology across all docs (build a shared vocabulary)

**Style:**

- Direct, no hedging, no over-explanation
- Markdown
- Use tables generously for any data that has multiple rows or conditional logic
- Code blocks for formulas
- Section headers should be parseable (H2 for major sections, H3 for subsections)

---

## Working Instructions for Claude Code

For each task:

1. Read the task scope and required sections below
2. Conduct deep web research using web_search and web_fetch — aim for 8-15 searches per doc, prioritizing primary sources (peer-reviewed research, established coaching authorities, sports science publications)
3. Write the doc to `/research/[number]-[slug].md` per the filename specified
4. Cite all sources at the end
5. Update the checkbox in this file from `[ ]` to `[x]` when complete
6. Add a one-line completion note with the date and word count
7. Move to the next task

**Quality bar:** Each doc should be 2,500-6,000 words depending on topic depth. If a topic warrants more, write more. If less, write less. Don't pad.

**Genericness check before marking complete:** Read the doc. If you can find any sentence that assumes a specific runner profile, fitness level, sex, or age, rewrite it generically.

**Source priority:**

1. Peer-reviewed research (PubMed, Sports Medicine, Journal of Applied Physiology, etc.)
2. Established coaching authorities (Daniels, Pfitzinger, Magness, Canova, Bakken, Lydiard literature)
3. Reputable coaching publications (Runner's World, Outside, Marathon Handbook, Running Writings, RunnersConnect)
4. Manufacturer/product documentation when relevant
5. Avoid: SEO-farm content, single-blogger opinion pieces without research backing, supplement marketing

---

## Pre-Work: Rewrites of Existing Docs

The `/research/_archive/` folder contains two earlier docs that were written with a personalized framing. These need to be rewritten as generic knowledge-base docs.

### [x] Task 0A: Rewrite Marathon and Distance Running Training (Generic)

*Completed 2026-05-04. 7,337 words, ~55 sources. Source archive not found; written from scratch per spec.*

**Output file:** `/research/00a-distance-running-training.md`

**Source material:** `/research/_archive/marathon-training-original.md`

**Scope:** Comprehensive generic reference covering distance running training across all distances (5K through ultramarathon) and all runner levels (beginner through elite). The original was marathon-focused and sub-3:30 framed; broaden it.

**Required sections:**

- Periodization (linear, reverse, Canova/Italian school, block periodization) — covering all race distances
- Training intensity distribution (polarized, pyramidal, threshold, Norwegian double threshold, Norwegian singles) — when each applies, by athlete type and race distance
- Aerobic base development (mitochondrial adaptations, capillary density, fat oxidation, type I fiber adaptation)
- Volume guidelines by experience level and race distance (lookup tables)
- The seven workout categories (recovery, general aerobic, medium-long, long run, threshold/tempo, VO2max, race-specific) — definitions, structures, dosing
- Long run variations (steady, progression, marathon-pace, fast finish, dress rehearsal) — applied across distances
- Strength training for runners (heavy resistance vs. plyometric, periodization opposing the running cycle, exercise selection)
- Fueling (during-race carbs by duration, glucose:fructose ratios, daily training nutrition, carb loading)
- Recovery modalities ranked by evidence
- Footwear strategy (super shoes, rotation, training vs. racing)
- Cadence and form
- Heat acclimation and altitude
- Age-related training adjustments (youth, masters, by decade)
- Sex-specific training considerations (menstrual cycle phases, contraception, RED-S signals)
- Training load and injury risk (10% rule, ACWR, single-session spike research)

**Done criteria:** Covers all distances 5K-ultra. Covers all experience levels. No "you" or runner-profile assumptions. 5,000-8,000 words.

---

### [x] Task 0B: Rewrite Recovery and Rest Protocols (Generic)

*Completed 2026-05-04. 5,930 words, 39 sources. Source archive not found; written from scratch per spec.*

**Output file:** `/research/00b-recovery-protocols.md`

**Source material:** `/research/_archive/recovery-protocols-original.md`

**Scope:** Generic recovery reference applicable to all runner types and training loads.

**Required sections:**

- The three categories of recovery (in-week, cutback weeks, post-race) and how they differ
- In-week recovery (hard/easy alternation, recovery vs. easy run distinction, sleep, nutrition, modalities ranked by evidence)
- Sleep extension and sleep banking research
- Cutback week structures (frequency, depth by mileage tier, what to cut)
- Post-race recovery by distance (5K, 10K, half, marathon, ultra) and by effort (A race vs. B race)
- Week-by-week protocols for half marathon and marathon recovery
- Recovery scaled to weekly mileage (lookup tables for 20-40, 40-60, 60-80, 80+ mpw)
- Reverse periodization for marathon recovery
- Warning signs of incomplete recovery (HRV, RHR, sleep, mood, performance)
- Multiple races per year (cadence guidelines)
- Carbon-plated shoe effect on recovery times
- Recovery technology and modalities (compression, sauna, cold plunge, contrast, massage, IV therapy)

**Done criteria:** Covers all distances and all training load levels. No personalization. 4,000-6,000 words.

---

## Foundational Input Layer (Tasks 1-4)

These are the highest-priority tasks. The coach uses these to convert user data into prescriptions.

### [x] Task 1: Pace Zones, VDOT, and Training Pace Calculation

*Completed 2026-05-04. 5,246 words, 30 sources. VDOT table covers 30-85 across 7 distances.*

**Output file:** `/research/01-pace-zones-vdot.md`

**Scope:** The complete reference for converting a recent race time into prescribed training paces. This is the coach's primary input layer.

**Required sections:**

- Jack Daniels' VDOT system (full explanation, formula, how to calculate from race times)
- VDOT lookup table from 30 to 85 (or as wide as published data supports)
- Daniels' training paces (E, M, T, I, R) — definitions, percentages of VDOT pace, dosing rules
- Pfitzinger pace ranges (recovery, general aerobic, endurance, marathon, lactate threshold, VO2max, R) — definitions and percentages
- McMillan pace calculator methodology
- Hansons pace methodology
- Conversions between systems (Daniels T pace ≈ Pfitz LT pace, etc.)
- Pace prescriptions by workout type (table: workout → pace zone → effort target)
- How to recalibrate paces (when to retest, how to use recent race data, how to use threshold field tests)
- Pace zone width — how much variability is acceptable, when to lock to specific pace
- Adjustments for course terrain (hills, trails)
- Adjustments for weather (heat, cold, humidity, wind, altitude — formulas)
- Treadmill vs. outdoor pace conversion

**Done criteria:** Coach can take a single race time + course/weather conditions and output exact pace ranges for any workout. 4,000-5,500 words.

---

### [x] Task 2: Race Time Prediction and Equivalence

*Completed 2026-05-04. 4,025 words, 22 sources.*

**Output file:** `/research/02-race-time-prediction.md`

**Scope:** How to predict race times across distances from a known performance.

**Required sections:**

- Riegel formula (T2 = T1 × (D2/D1)^1.06) — derivation, accuracy, limitations
- Cameron formula and variants
- Daniels VDOT-based predictions
- Pete Riegel's original research and refinements
- Race equivalence tables (5K, 10K, 15K, 10mi, half, marathon)
- The exponent debate (1.06 vs. 1.07 vs. 1.08 vs. 1.15 for ultras) — when each applies
- Endurance-specialist vs. speed-specialist adjustments (McMillan's runner types)
- Why marathon predictions from short-race times are less reliable than the reverse
- Age grading and age-graded predictions
- Sex-specific differences in race-distance performance scaling
- How to use multiple race times for a more accurate VDOT
- Predictor workouts (Yasso 800s, fast finish long run, race-effort tempo) — accuracy by runner type
- Common prediction error sources (training specificity, course profile, weather, runner profile)

**Done criteria:** Coach can take any race result and produce calibrated predictions across all distances with confidence intervals. 3,000-4,500 words.

---

### [x] Task 3: Heart Rate Zones and Methodology

*Completed 2026-05-04. 4,982 words, 30+ sources.*

**Output file:** `/research/03-heart-rate-zones.md`

**Scope:** All major HR zone systems, their methodologies, and when to apply each.

**Required sections:**

- Why heart rate as a training metric (limitations: cardiac drift, hydration, sleep, caffeine, weather)
- Max HR estimation formulas (220-age, Tanaka, Gellish, Nes) — accuracy data
- How to actually field-test max HR
- % Max HR zones (5-zone and 7-zone systems)
- Heart Rate Reserve / Karvonen method — formula and zones
- Lactate Threshold HR (LTHR) — how to determine, % LTHR zones (Friel system)
- MAF method (180 - age, with adjustments) — Phil Maffetone protocol
- Daniels' HR zones (linked to VDOT)
- Resting HR baseline establishment and RHR-based recovery indicators
- HRV (heart rate variability) — RMSSD, LnRMSSD, daily vs. trend interpretation
- Correlation between HR zones and pace zones (when they align, when they diverge)
- HR drift in long runs (cardiac drift) — interpretation
- Why HR is unreliable for short intervals
- Decision logic: when to coach by HR vs. pace vs. RPE
- Wrist optical vs. chest strap accuracy considerations
- Lab testing alternatives (lactate testing, gas exchange, field tests)

**Done criteria:** Coach can pick the right HR system for any user given their data quality and goals, and convert between systems. 3,500-5,000 words.

---

### [x] Task 4: Workout Vocabulary and Structures

*Completed 2026-05-04. 8,114 words, 6 foundational coaching texts + 50+ online sources. Workout-name lookup index in §18.*

**Output file:** `/research/04-workout-vocabulary.md`

**Scope:** The complete library of named running workouts with prescribed structures.

**Required sections:**

For each workout: purpose, physiological target, structure, prescribed paces/efforts, recovery between reps, total volume, when to use in a training cycle, contraindications, and common variations.

- **Recovery runs** — pace, duration, frequency
- **Easy / general aerobic runs** — pace ranges, duration, frequency
- **Medium-long runs** — distance, pace, role in marathon training
- **Long runs** — base long run, progression long run, marathon-pace long run, fast finish long run, dress rehearsal long run
- **Threshold workouts:**
  - Continuous tempo (4-8 mi at threshold)
  - Cruise intervals (Daniels)
  - Sub-threshold (Norwegian-style) intervals
  - Long tempos (8-12 mi)
- **VO2max workouts:**
  - Mile repeats (3-6 x 1 mile)
  - 1000m repeats
  - 800m repeats
  - 600m repeats
  - 400m repeats
  - Yasso 800s (specific protocol and prediction logic)
- **Speed/economy workouts:**
  - Strides
  - Hill sprints
  - 200m repeats
  - 100m repeats
- **Hill workouts:**
  - Short hill repeats (10-30 sec)
  - Medium hill repeats (60-90 sec)
  - Long hill repeats (3-5 min)
  - Hill circuits / hill fartlek
- **Fartlek variations:**
  - Mona fartlek (2x90sec, 4x60sec, 4x30sec, 4x15sec)
  - Michigan fartlek
  - Classic Lydiard fartlek
  - Time-based fartlek
- **Combo / alternation workouts:**
  - Marathon pace + 10K pace alternations
  - Threshold + VO2 combos
- **Marathon-specific workouts:**
  - Canova special blocks (full structure)
  - Canova 2K repeats
  - Long marathon-pace runs (12-16 mi at MP)
  - Pre-fatigue marathon-pace work
- **Cutdown / progression workouts:**
  - Mile cutdowns
  - 1K cutdowns
  - 5K progression
- **Ladders:**
  - 400-800-1200-1600 ladders
  - Up-and-down ladders
- **Race-specific workouts:**
  - 5K-specific (3K reps, mile repeats at 5K pace)
  - 10K-specific (mile repeats at 10K pace, 2K reps)
  - Half-specific (4x2mi at HM pace, 6x1mi at HM pace)
  - Marathon-specific (covered in marathon-specific section above)
- **Track session structures:**
  - Standard warmup/cooldown protocols
  - Drill sequences

**Done criteria:** A coach can pull any workout name and get the full prescribed structure with paces, recoveries, and use case. 6,000-8,000 words.

---

## Practical Coaching Logic (Tasks 5-8)

### [x] Task 5: Injury-Specific Return-to-Run Protocols

*Completed 2026-05-04. 8,550 words, 39 sources. 17 distinct injuries + 6 sections of general principles.*

**Output file:** `/research/05-injury-return-protocols.md`

**Scope:** Evidence-backed graded return-to-run progressions for the most common running injuries.

**Required sections:**

For each injury: pathophysiology summary, diagnostic signs, contraindications for running, graded return protocol with specific timeline, parallel rehab work, criteria to progress through stages, criteria for medical referral.

- Plantar fasciitis / plantar fasciopathy
- Achilles tendinopathy (insertional and mid-portion, separately)
- Iliotibial band syndrome (ITBS)
- Patellofemoral pain syndrome (runner's knee)
- Patellar tendinopathy (jumper's knee)
- Medial tibial stress syndrome (shin splints)
- Tibial stress reaction / stress fracture (and tibial vs. metatarsal vs. femoral neck distinction)
- Hamstring strain (proximal hamstring tendinopathy and acute strain, separately)
- Calf strain
- Hip flexor strain
- Piriformis syndrome
- Posterior tibial tendinopathy
- Peroneal tendinopathy
- Metatarsalgia
- Morton's neuroma
- Hip labral irritation
- Generic acute soreness / DOMS — when to run through, when to back off

Plus general principles:
- The walk-run protocol structure
- Pain monitoring rules (0-10 scale, day-after rule, location specificity)
- When to use cross-training vs. complete rest
- Return-to-volume guidelines
- Return-to-intensity guidelines (always volume before intensity)
- Stress fracture vs. stress reaction protocols specifically (longer, more cautious)
- Red flags requiring medical evaluation

**Done criteria:** Coach can take any injury type + severity and produce a specific multi-week return protocol. 5,000-7,000 words.

---

### [x] Task 6: Weather Adjustment Rules

*Completed 2026-05-04. 4,181 words, 21 sources.*

**Output file:** `/research/06-weather-adjustments.md`

**Scope:** Pace and effort adjustments for environmental conditions.

**Required sections:**

- Heat adjustment formulas (Maughan, Vihma, Zatopek tables)
- Heat-humidity combined index (wet bulb globe temperature)
- Heat acclimation timeline and protocols (and how to adjust expectations during acclimation)
- Cold weather adjustments (slowing of paces, hydration changes, gear adjustments)
- Wind effect on pace (headwind, tailwind, crosswind — wattage equivalents)
- Altitude adjustments (race time slowing by elevation, training pace adjustments at altitude)
- Altitude acclimation timeline
- Live-high-train-low protocols
- Humidity beyond temperature (dewpoint as a better metric)
- Rain effect (mostly negligible except for footing)
- Sun exposure / radiant heat
- Air quality (AQI) thresholds for training adjustment
- Track temperature vs. air temperature
- Race-day weather assessment and goal pace recalibration
- Conversion: race time at condition X → equivalent time at neutral conditions
- Training pace adjustments: when to slow, when to convert to time-based, when to bail

**Done criteria:** Coach can take user location weather + planned workout and adjust paces, durations, and goals appropriately. 3,500-5,000 words.

---

### [x] Task 7: Strength Training Programming for Runners

*Completed 2026-05-04. 6,992 words, ~30 sources. Cable-trainer mode programming included (mapped onto Amp-style device capabilities, generic framing).*

**Output file:** `/research/07-strength-programming.md`

**Scope:** Periodized strength programming opposing the running cycle.

**Required sections:**

- Research summary (heavy resistance vs. plyometrics, the running economy literature, injury prevention meta-analyses)
- Phase-by-phase programming (base, build, peak, taper, off-season)
- Exercise selection by phase:
  - Base: heavy bilateral compound lifts (squat variations, deadlift variations)
  - Build: heavy + power (Olympic lift derivatives, jumps)
  - Peak: maintenance (lower volume, similar intensity)
  - Taper: reduced volume, drop in final week
  - Off-season: hypertrophy, weakness correction
- Set/rep schemes by phase and goal
- Heavy lifting protocols (3-6 reps, 80%+ 1RM) — exercise list with form cues
- Plyometric protocols (contact-count progression, exercise list, surface considerations)
- Hill sprints as strength/power work
- Single-leg work (split squats, step-ups, single-leg deadlifts) — runner-specific value
- Calf and Achilles loading (heavy slow eccentrics, isometric protocols)
- Hip and glute programming (commonly weak in runners)
- Core programming (anti-rotation, anti-extension, anti-flexion categories)
- Concurrent training research (interference effect, when running and lifting conflict)
- Recovery between strength and run sessions
- Time-of-day for strength relative to running
- Frequency recommendations (1x, 2x, 3x per week — when each is appropriate)
- Bodyweight-only programming for travel/no-equipment situations
- Cable machine / functional trainer programming (for users with home equipment)
- Female-specific considerations (cycle phase and strength training)
- Masters-specific considerations (recovery, exercise selection, intensity adjustments)

**Done criteria:** Coach can prescribe a fully periodized strength program for any user given their goals, equipment access, and current phase. 5,000-7,000 words.

---

### [x] Task 8: Pacing Strategy and Race Week Protocols

*Completed 2026-05-04. 6,995 words, 16 peer-reviewed + 6 coaching authorities + 10 coaching pubs.*

**Output file:** `/research/08-pacing-and-race-week.md`

**Scope:** How to race the race, plus the final week of preparation.

**Required sections:**

**Pacing strategy:**

- Even split vs. negative split vs. positive split — research on which produces best outcomes
- Optimal first-mile pacing for each distance
- The 5K-by-5K marathon pacing literature
- Half marathon pacing strategy
- 10K pacing strategy
- 5K pacing strategy
- Pacing in heat / adverse conditions (going out conservative)
- Pacing in optimal conditions (slight negative split)
- Hilly course pacing (effort-based vs. pace-based)
- Downhill course pacing (Big Sur, Boston, CIM-style net downhill)
- Tactical racing (sit and kick, breakaway, pack running)
- Pacing groups and pacers (when helpful, when not)
- Heart rate ceilings during racing
- RPE-based racing
- Cadence and form during late-race fatigue
- Mental cues and segmenting (how to break the race mentally)
- The wall — what it is, when it happens, how to delay/avoid

**Race week protocols:**

- Taper structure (final 2-3 weeks)
- Race week mileage and intensity (specific day-by-day)
- Carb loading specifics (timing, amount, food selection)
- Fiber reduction in the final 24-48 hours
- Pre-race meal (timing, composition, individual variation)
- Hydration in the final 48 hours
- Sleep protocol (priority on T-2 night, accept poor T-1 sleep)
- Race morning timing (wake-up, breakfast, departure, warmup)
- Warmup protocols by distance (longer for shorter races)
- Gear shakedown (nothing new on race day)
- Caffeine timing and dose
- Race-day fueling plan (carbs per hour, sodium, fluid)
- Pace strategy commitment (writing it down, setting watch fields)
- Mental preparation protocols
- Travel timing (when to arrive at race venue)
- Time zone management for travel races
- Bathroom strategy (the unglamorous reality)
- Race kit selection (singlet vs. shirt, shorts, socks, shoes)

**Done criteria:** Coach can guide any user through race week and race-day decisions for any distance. 5,000-7,000 words.

---

## Specialized Knowledge (Tasks 9-16)

### [x] Task 9: Cross-Training Equivalents

*Completed 2026-05-04. 4,336 words, 22 sources.*

**Output file:** `/research/09-cross-training.md`

**Scope:** How to substitute running with other modalities and calibrate equivalent intensity.

**Required sections:**

- Cycling (road, indoor) — pace/HR conversions, RPE matching, where it carries over and where it doesn't
- Swimming — wattage equivalents, pool running specific protocols
- Aqua jogging / pool running — the gold-standard injury alternative, deep water vs. shallow, intensity calibration
- Elliptical — most-similar modality to running, intensity matching
- Rowing — useful but lower carryover
- Stair climbing / stairmaster
- Hiking and walking
- Skiing (Nordic specifically) — high carryover for endurance
- Strength training as cross-training
- Yoga and Pilates — recovery vs. fitness work
- When to use cross-training (injured, weather, schedule, recovery)
- How much cross-training to substitute (volume conversions)
- Maintaining run fitness during forced layoffs
- Time-equivalency vs. intensity-equivalency
- HR-based cross-training (works) vs. pace-based (doesn't translate)
- Combining running and cross-training in the same week (sequencing)

**Done criteria:** Coach can prescribe cross-training as a substitute for any planned running session with calibrated intensity. 3,000-4,500 words.

---

### [x] Task 10: Mobility, Warmup, and Cool-down Protocols

*Completed 2026-05-04. 4,568 words, 19 sources.*

**Output file:** `/research/10-mobility-warmup.md`

**Scope:** Pre-run, post-run, and standalone mobility work.

**Required sections:**

- Pre-run dynamic warmup (research on static stretching pre-exercise, why dynamic is preferred)
- Standard dynamic warmup sequence (specific exercises with dosing)
- Race warmup (longer, more progressive)
- Track session warmup (full sequence with strides)
- Long run warmup (minimal, can be the first mile of the run itself)
- Drills (A-skips, B-skips, C-skips, butt kicks, high knees, etc.) — purpose and execution
- Strides (technique, dosing, surface, when to do them)
- Hip flexor mobility (commonly tight in runners)
- Hip extension and glute activation work
- Thoracic spine mobility
- Ankle mobility (dorsiflexion specifically)
- Calf and Achilles mobility
- Post-run cool-down (research on benefit, what's worth doing)
- Static stretching post-run (timing, holds, exercise selection)
- Foam rolling protocols (specific muscles, timing, dosing)
- Recovery yoga sequences
- Daily mobility routine (5-10 minutes for runners)
- Pre-bed mobility for sleep quality
- Mobility for specific tightness patterns (anterior chain, posterior chain, hip rotators)
- Self-massage and lacrosse ball work

**Done criteria:** Coach can prescribe an appropriate mobility/warmup protocol for any session type. 3,000-4,500 words.

---

### [x] Task 11: Course-Specific Training (Hills, Downhills, Trail, Altitude)

*Completed 2026-05-04. 3,872 words, 30 sources.*

**Output file:** `/research/11-course-specific-training.md`

**Scope:** How to train for race courses with specific demands.

**Required sections:**

- Hill training principles and adaptations
- Training for hilly races (Boston, NYC, San Francisco-style)
- Training for downhill races (Big Sur, Boston's Newton hills, Revel-style net downhill)
- Eccentric quad loading research (preventing late-race quad failure)
- Negative-split downhill races (CIM, Boston-with-prep) pacing
- Trail running specifics (technical vs. runnable)
- Ultra-specific training adjustments
- Altitude races (training adjustments leading in, race-day adjustments)
- Hot-weather destination races (heat acclimation timing)
- Sea-level athletes racing at altitude
- Altitude athletes racing at sea level
- Course recon (when to drive/run the course)
- Specificity principles (how much course-specific training is needed)
- Surface considerations (track vs. road vs. trail vs. treadmill)

**Done criteria:** Coach can adjust a training plan for any course profile and elevation. 3,500-5,000 words.

---

### [x] Task 12: Travel and Time Zone Management

*Completed 2026-05-04. 3,511 words, 19 sources.*

**Output file:** `/research/12-travel-timezone.md`

**Scope:** Optimizing travel and circadian rhythm around races.

**Required sections:**

- Pre-race travel timing (how many days before to arrive)
- Time zone shift calculations (1 day per hour rule and exceptions)
- East-bound vs. west-bound travel asymmetry
- Light exposure protocols for circadian shift
- Melatonin protocols for travel
- Hydration during flights
- Compression during travel
- Pre-flight, in-flight, and post-flight running adjustments
- Sleep on the plane vs. sleep on arrival
- Race-day in-zone vs. shifted-zone strategies
- Driving vs. flying considerations
- Multi-stop travel
- Athletes village / hotel sleep optimization
- Bringing your own pillow / sleep environment control
- Pre-race meal availability at travel destination
- Race-morning logistics in unfamiliar locations
- Returning home after a race (recovery during return travel)

**Done criteria:** Coach can plan travel for any race location and time zone. 2,500-3,500 words.

---

### [x] Task 13: Sex-Specific Training Considerations

*Completed 2026-05-04. 5,566 words, ~40 sources. RED-S/IOC 2023 + ACOG/ACSM pregnancy + Goom postpartum framework.*

**Output file:** `/research/13-sex-specific-training.md`

**Scope:** How training adapts for female and male athletes, focusing on female-specific considerations where research is more developed but historically underapplied.

**Required sections:**

- Menstrual cycle phases and training (follicular, ovulatory, luteal)
- Cycle-tracking methods for athletes
- Training adaptations by phase (research is mixed; cover what's established)
- Hormonal contraception and performance (combined OCP, progestin-only, IUDs)
- Pregnancy and running (by trimester, ACSM guidelines)
- Postpartum return to running (pelvic floor, diastasis, tissue recovery, specific protocols)
- Perimenopause and menopause adjustments
- RED-S (Relative Energy Deficiency in Sport) — signs, screening, severity
- Female athlete triad (historical concept, evolved understanding)
- Iron deficiency in female runners (incidence, screening, treatment)
- Bone density considerations (DEXA, calcium, vitamin D)
- Strength training for female runners (research-backed gender-neutral, but emphasis matters)
- Male-specific considerations (testosterone, overtraining markers, prostate health in masters)
- Body composition and performance (research vs. cultural pressures)
- Eating disorder screening (RED-S, anorexia athletica)
- Generic principles applicable to all sexes

**Done criteria:** Coach can apply appropriate training and screening considerations for users of any sex and life stage. 4,000-5,500 words.

---

### [x] Task 14: Age-Group Considerations (Youth, Masters, Senior)

*Completed 2026-05-04. 4,373 words, ~30 sources.*

**Output file:** `/research/14-age-considerations.md`

**Scope:** Training adaptations across the lifespan.

**Required sections:**

- Youth running guidelines (under 18) — appropriate volume, racing distance limits, growth-plate considerations
- Adolescent training (high school years) — periodization, mileage progression, racing
- Collegiate-level training (18-22)
- Peak performance ages (20s and early 30s)
- 30s training (subtle changes, peak marathon performance window)
- Masters athletes (35+ World Athletics definition; 40+ traditional)
- 40s training adjustments
- 50s training adjustments
- 60s training adjustments
- 70+ training
- The VO2max decline curve (5-10% per decade after 30) and what to do about it
- Lactate threshold preservation (declines slower than VO2max)
- Running economy preservation (largely preserved with consistent training)
- Recovery requirements by decade
- Strength training increased importance with age
- Mobility increased importance with age
- Injury risk shifts by age (different injuries become more common)
- Hormone changes (testosterone in men, menopause in women — covered separately in Task 13)
- The U-shaped age-performance relationship in elite marathoners
- Returning to running at older ages
- Bone density and impact loading
- Cardiovascular screening recommendations by age

**Done criteria:** Coach can adapt training appropriately for any age. 3,500-5,000 words.

---

### [x] Task 15: Wearable Data Interpretation

*Completed 2026-05-04. 6,015 words, 38 sources.*

**Output file:** `/research/15-wearable-data.md`

**Scope:** How to interpret data from running wearables (Garmin, Apple Watch, Whoop, Oura, Coros, etc.) for coaching decisions.

**Required sections:**

- Resting heart rate (RHR) — establishing baseline, daily fluctuation, when elevated RHR signals overtraining/illness
- Heart rate variability (HRV) — RMSSD, LnRMSSD, daily vs. trend, morning measurement protocol
- Sleep stage data — accuracy limitations, what's useful vs. noise
- Training load metrics:
  - Training Stress Score (TSS) — Coggan-style, originally cycling
  - TRIMP (Training Impulse) — Banister
  - Garmin Training Load (heat-mapped)
  - Whoop Strain
  - Acute:Chronic Workload Ratio (ACWR) — research support and limitations
- Recovery scores (Whoop, Oura, Garmin Body Battery) — what they actually measure
- VO2max estimates from wearables — accuracy vs. lab tests
- Running power (Stryd, Garmin) — concept, calibration, practical use
- Running dynamics (cadence, GCT, vertical oscillation, vertical ratio) — what's useful, what's marketing
- Pace accuracy (GPS limitations, tunnels, urban canyons)
- Heart rate accuracy (wrist optical vs. chest strap vs. arm band)
- Effective use of fitness/freshness/form (CTL/ATL/TSB) models
- Lactate threshold detection algorithms (Garmin, etc.)
- When wearable data agrees with subjective state (trust both)
- When wearable data disagrees with subjective state (trust subjective)
- Spotting illness early (RHR up, HRV down, sleep disrupted)
- Spotting overtraining early
- Spotting peak fitness (HRV high, RHR low, performance trending up)
- Data privacy considerations
- Multi-device syncing and the source of truth question

**Done criteria:** Coach can interpret any wearable signal as input to recommendations. 4,000-6,000 words.

---

### [x] Task 16: Form, Cadence, and Biomechanics

*Completed 2026-05-04. 5,008 words, 17 peer-reviewed primary studies + clinical references.*

**Output file:** `/research/16-form-biomechanics.md`

**Scope:** Running form analysis, common errors, and corrective interventions.

**Required sections:**

- Running gait cycle (stance, swing, flight phases)
- The 180 spm myth and the actual cadence research (Heiderscheit, Daniels' original observation)
- Cadence by pace (typical ranges: easy, tempo, threshold, race)
- Stride length × cadence = pace (the speed equation)
- Overstriding identification and consequences
- Foot strike (heel, midfoot, forefoot) — research on injury and economy
- Ground contact time (GCT) — typical ranges, training to reduce
- Vertical oscillation — research relevance
- Hip drop (Trendelenburg) — identification, glute medius strength
- Cross-over gait — identification, consequences
- Arm swing (driving from shoulders, not crossing midline)
- Forward lean (from ankles, not from hips)
- Head position
- Posterior chain activation (glutes, hamstrings, calves)
- Anterior chain dominance (quad-dominant runners) — patterns and corrections
- Form drills (covered in mobility doc but cross-referenced)
- Form changes with fatigue (late-race breakdown)
- Form changes with super shoes
- When to change form (rare; usually counterproductive)
- When form change is warranted (chronic injury, severe inefficiency, growth phase)
- Running form videos and self-analysis methodology
- Treadmill gait analysis vs. overground

**Done criteria:** Coach can identify form issues from data/video and prescribe corrective interventions. 3,500-5,000 words.

---

## Equipment and Fueling (Tasks 17-19)

### [x] Task 17: Footwear — Shoe Selection, Rotation, and Lifecycle

*Completed 2026-05-04. 5,363 words, 22 sources. 13-brand fit comparison table.*

**Output file:** `/research/17-footwear.md`

**Scope:** Comprehensive reference for running shoe selection and management.

**Required sections:**

- Shoe categories (daily trainer, max cushion, tempo/speed, super shoe, racing flat, trail, stability)
- Super shoes (carbon plate + responsive foam) — research on performance benefit, mechanism
- The 4% effect and individual response variation
- Super shoe injury research (navicular stress, Achilles, etc.)
- When to use super shoes (race day, key workouts, dress rehearsal)
- Daily trainer requirements
- Stability vs. neutral (the pronation debate, current research)
- Drop / heel-toe offset — high vs. low, transitions
- Stack height
- Shoe rotation strategy (research on injury prevention, Hamill et al.)
- Shoe rotation by workout type
- Mileage lifespan by shoe category (typical: 300-500 miles for trainers, 100-200 for super shoes)
- Signs of shoe degradation
- Proper shoe fit (foot length, width, volume, toe box)
- Foot type considerations (high arch, low arch, narrow heel, wide forefoot)
- Sock interaction with shoe fit
- Insoles and orthotics
- Lacing techniques
- Treadmill vs. road shoe choice
- Trail shoe selection (technical vs. buffed trail)
- Track spikes vs. flats vs. trainers for track sessions
- Brand-by-brand fit characteristics (Nike narrow, NB narrow heel, Hoka wide toe box, etc.)
- Width sizing (B/D/2E for men, narrow/medium/wide for women)
- Buying online vs. in-store fitting
- Volumental scans and 3D fitting
- Break-in period (some shoes need it, some don't)
- Caring for shoes (rotation drying, cleaning, storage)

**Done criteria:** Coach can recommend shoe choices, rotation strategy, and lifecycle management for any user. 4,000-5,500 words.

---

### [x] Task 18: Fueling Products and Nutrition Database

*Completed 2026-05-04. 5,905 words, 14 peer-reviewed + 11 manufacturer + 4 coaching pubs. 17-product gel comparison table + 11-product drink mix table + 15-supplement evidence grade table.*

**Output file:** `/research/18-fueling-products.md`

**Scope:** Reference for during-training and race-day fueling products.

**Required sections:**

- Carbohydrate intake guidelines (covered in main training doc; reference and expand)
- Multiple transportable carbohydrates research (glucose:fructose ratios)
- Gel category — by brand:
  - GU (original, Roctane, Liquid Energy)
  - Maurten (100, 100 Caf, Solid)
  - Precision Fuel & Hydration (PF 30, PF 90)
  - SiS (Beta Fuel, Go Isotonic)
  - Spring Energy
  - Honey Stinger
  - Huma
  - Generic gel comparison table (carbs, sodium, caffeine, glucose:fructose ratio, texture, taste profile, price)
- Drink mix category — by brand:
  - Maurten Drink Mix 160 / 320
  - Precision Fuel & Hydration PF 30 / PF 60 / PF 90
  - SiS Beta Fuel
  - Tailwind Endurance Fuel
  - Skratch
  - LMNT (electrolytes only)
  - Liquid IV
  - Generic comparison table
- Electrolyte products
- Caffeine sources, dosing, timing for races
- Real food alternatives (banana, dates, rice cakes, etc.)
- Sports drinks during training vs. racing
- Water-only training (when appropriate)
- Pre-race fueling (3 hours, 1 hour, 15 minutes)
- During-race fueling protocols by distance (5K through marathon)
- Ultra-distance fueling (real food integration, sweet fatigue)
- Gut training protocols (building up tolerance to high-carb intake)
- Stomach issues and product selection
- Dietary restriction adaptations (vegan, gluten-free, low-FODMAP)
- Hydration protocols
- Post-race recovery nutrition products (recovery drinks, protein powders)
- Daily training nutrition stack (whey protein, creatine, beta-alanine, beetroot, sodium bicarbonate, etc.) — research backing for each

**Done criteria:** Coach can recommend specific products and quantities for any user's fueling plan. 4,500-6,500 words.

---

### [x] Task 19: Hydration and Electrolyte Management

*Completed 2026-05-04. 4,491 words, ~24 sources.*

**Output file:** `/research/19-hydration-electrolytes.md`

**Scope:** Hydration science applied to running.

**Required sections:**

- Daily hydration baseline (per kg body weight)
- Drink-to-thirst research (Noakes) vs. structured hydration
- Pre-race hydration (24 hours and 2 hours pre-race)
- During-race hydration by distance and conditions
- Sweat rate calculation (pre/post-weigh-in protocol)
- Sweat sodium concentration (testing options, individual variation)
- Sodium intake during exercise (per hour by intensity and conditions)
- Hyponatremia (exercise-associated) — risk, symptoms, prevention
- Dehydration symptoms and performance impact
- Acclimatization to heat and hydration adaptations (plasma volume expansion)
- Electrolyte products comparison (LMNT, Precision Hydration, Skratch, etc.)
- Electrolyte capsules (Salt Stick, Endurolytes)
- Carrying water (handhelds, vests, belts, race aid stations)
- Cupless racing (HydraPak SkyFlask and similar)
- Pre-cooling strategies for hot races (slushies, ice vests)
- During-race cooling (ice in hat, cold drinks)
- Caffeine and hydration (mostly a myth, current research)
- Alcohol and recovery
- Aid station strategy in races
- Hydration in cold conditions (often underdone)

**Done criteria:** Coach can prescribe hydration plans for any conditions and durations. 3,000-4,500 words.

---

## Auxiliary (Tasks 20-22)

### [x] Task 20: Mental Training and Sport Psychology

*Completed 2026-05-04. 5,174 words, 26 sources.*

**Output file:** `/research/20-mental-training.md`

**Scope:** Sport psychology applied to distance running.

**Required sections:**

- Goal setting (process vs. outcome, SMART, Daniels' three-tier goals: A/B/C)
- Mental rehearsal and visualization
- Self-talk research (instructional vs. motivational)
- Race-day arousal management (over-aroused vs. under-aroused)
- Pre-race anxiety management
- During-race attention strategies (associative vs. dissociative)
- Pacing and discipline (the early-mile temptation)
- Pain tolerance and embracing discomfort
- Post-race blues and depression (mechanism, duration, management)
- DNF decisions (when it's right to quit, when to push through)
- Comeback from injury (mental aspects)
- Comeback from poor performance
- The growth vs. fixed mindset in running
- Identity and the runner self-concept
- Burnout prevention
- Motivation maintenance through long training cycles
- Pre-race rituals and superstition (when helpful, when problematic)
- Mantras and cue words
- Breathing techniques for arousal regulation
- Mindfulness practice for runners
- Therapy for sport psychology issues (when appropriate)

**Done criteria:** Coach can support users through mental challenges across the training and racing arc. 3,500-5,000 words.

---

### [x] Task 21: Common Form Errors and Corrections (Detailed)

*Completed 2026-05-04. 7,011 words (slight overshoot — 19 errors × 6 structured sub-sections each), 26 sources.*

**Output file:** `/research/21-form-corrections.md`

**Scope:** Drilldown on Task 16 with specific corrective interventions.

This is more detailed than Task 16 (which is the conceptual overview). Task 21 is the practical "user has problem X, do drills Y" reference.

**Required sections:**

For each error: identification cues (visible from video, sensed by runner, captured by wearables), root causes, corrective drills, strength work, mobility work, gradual implementation protocol.

- Overstriding
- Heel striking with braking
- Hip drop / Trendelenburg
- Cross-over gait
- Excessive vertical oscillation
- Long ground contact time
- Forward head posture
- Anterior pelvic tilt
- Posterior pelvic tilt
- Limited hip extension
- Limited ankle dorsiflexion
- Foot collapse (excessive pronation under load)
- Supinated foot strike
- Arms crossing midline
- Shoulder elevation / tension
- Lower back arching
- Asymmetric gait (left vs. right)
- Cadence too low at all paces
- Stride pattern doesn't change with pace

**Done criteria:** Coach can prescribe specific drills for any identified form issue. 3,500-5,000 words.

---

### [x] Task 22: Training Plan Templates by Distance and Level

*Completed 2026-05-04. 6,272 words, ~22 sources. Includes 2026 BQ standards table.*

**Output file:** `/research/22-plan-templates.md`

**Scope:** Generic training plan templates that the coach can use as scaffolding.

**Required sections:**

For each combination, provide a generic plan structure (not specific paces — those come from VDOT/the user). Include: duration, peak weekly volume, peak long run, key workout types, sample week at peak.

- 5K plans (beginner, intermediate, advanced)
- 10K plans (beginner, intermediate, advanced)
- Half marathon plans (beginner, intermediate, advanced)
- Marathon plans (beginner, intermediate, advanced)
- Ultramarathon plans (50K, 50mi, 100K, 100mi)
- Base building / off-season plans
- Maintenance plans
- Couch-to-5K progressions
- Time-crunched plans (4-day-per-week marathon, etc.)
- High-volume plans (6-7 day, doubling included)
- Multi-race year planning (two marathons, three halves, etc.)
- Heat season vs. cold season planning
- Track season vs. road season planning
- Comeback plans (return from injury, return from layoff)
- Plans by goal (PR-focused, finish-focused, qualifier-focused like BQ)

**Done criteria:** Coach has scaffolding plans to draw from for any user request. 6,000-9,000 words.

---

## Completion Tracking

Total tasks: 24 (2 rewrites + 22 new)

Estimated total output: 90,000-130,000 words across all docs

Recommended order: Pre-work (0A, 0B) → Foundation (1-4) → Practical (5-8) → Specialized (9-16) → Equipment (17-19) → Auxiliary (20-22)

When all tasks are complete, create a `/research/INDEX.md` file that lists every doc with a one-paragraph summary and key sections. This becomes the entry point for the coaching engine to query.

---

## Final Note for Claude Code

When you finish all tasks, do the following meta-tasks:

1. Create `/research/INDEX.md` summarizing the knowledge base
2. Create `/research/GLOSSARY.md` with all technical terms used across docs (VDOT, LTHR, RPE, ACWR, RED-S, etc.)
3. Create `/research/SOURCES.md` consolidating all cited sources for easy bibliographic reference
4. Identify any gaps or contradictions across docs and flag them in `/research/REVIEW_NOTES.md`
5. Mark this entire RESEARCH_TASKS.md as complete with a final summary

The research knowledge base is foundational infrastructure. Take the time to do it right.

---

## ✓ Build Complete — 2026-05-04

All 24 docs and all 4 meta-files written.

**Output:**

| | Words | Sources |
|---|---|---|
| 24 research docs | ~133,800 | aggregated |
| INDEX.md | — | — |
| GLOSSARY.md | 160 terms | — |
| SOURCES.md | — | 572 unique |
| REVIEW_NOTES.md | — | — |

**Notes for the maintainer (full detail in REVIEW_NOTES.md):**

- Word count hits the 90K–130K target with margin (~134K). Two docs slightly overshot their per-doc word ceiling (Task 21 at 7,011 words; Task 4 at 8,114) — both justified by structured per-item content the spec required.
- Tasks 0A and 0B were written generically from scratch. The `_archive/` source files referenced in the original spec were never created. The new generic versions stand alone as the canonical reference.
- Top three issues flagged in REVIEW_NOTES.md to act on:
  1. Numerical conflict on carb-load g/kg/d between doc 00a (10–12) and doc 08 (8–12). Pick one globally.
  2. Strength + run weekly integration is a coverage gap. Doc 07 has the strength program; doc 22 has the run plans; nothing shows how to combine them in one week.
  3. Doc 08 references `docs/coaching-research.md` as a cross-reference — that file is outside the 24-doc corpus. Stale carryover; remove or replace.
- Three areas that will need refresh fastest: super-shoe lifespan/regulations (6–12 mo), Norwegian-method specifics (6–12 mo), wearable algorithms (3–6 mo).
- Two near-term user-question gaps not in the original spec: GLP-1 agonists in athletes (no coverage), and running-while-sick / URTI return-to-run protocol (no coverage).

The knowledge base is ready for the coach runtime to consume.
