# C7 — Content Inventory: Ancillary Pages

Surfaces covered: **Plan Builder**, **Gear**, **Routes**, **Settings / Profile**.

These are the smaller, lower-traffic web surfaces — visited rarely (Plan Builder once per cycle; Settings during setup or troubleshooting) or as ambient reference (Gear, Routes). They must work cold: the user often arrives months between visits and needs to find or do one specific thing without re-learning the page.

Sources: APP_FEATURE_SPEC.md (Web Pages 8–11); Research/17-footwear.md (rotation, mileage, degradation); Research/22-plan-templates.md (canonical plan scaffolds); related docs as cited per row. KB ref column uses doc-number shorthand (e.g. `KB-17` = Research/17-footwear.md).

---

## 1. Plan Builder (Web Page 8)

### Job-to-be-done

> "Build me a plan for the race I just signed up for — or modify the plan I have. Show me what I'm committing to before I commit."

The Plan Builder is a wizard, not a dashboard. It runs end-to-end maybe 4–10 times in a runner's life with this app (one per training cycle). Bias is hard toward defaults that work and a preview that's honest about what the next 12–18 weeks will demand.

It also acts as a plan **modifier** — re-opening it for an existing plan should re-seed answers from the current plan, change one or two inputs, and regenerate from a chosen point forward, not from scratch.

### Element inventory

| Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|
| Wizard step indicator (1/N + back/next) | P0 | UI state | — | Users abandon long forms without progress signal |
| Goal type selector (race / fitness / base build / comeback) | P0 | User input | KB-22 §6, §7, §14, §15 | Whole plan branches on this — race vs. base vs. return |
| Race picker (existing Race entity or "add new") | P0 | Race entity | KB-22 §11 | Plan must be tied to a Race for date/distance/conditions |
| Race distance + date (if no Race entity yet) | P0 | User input | KB-22 §1–4 | Drives template selection and length |
| Goal time field (optional, with "I'm not sure" affordance) | P0 | User input | KB-02 | Drives intensity targets; null = "finish" plan |
| Recent race / field test / VDOT input | P0 | User input + Race history | KB-01, KB-02 | Calibrates current fitness; pre-fills from Race entity if available |
| Auto-suggested goal time (predicted from VDOT + race-equivalent) | P1 | Computed | KB-02 | Sanity-check on user's typed goal |
| Days/week (3–7 + "double-day OK?" toggle) | P0 | User input | KB-22 §10 | Hard constraint; selects template family |
| Peak weekly mileage tolerance (slider with last-cycle peak shown) | P0 | User input + history | KB-22 all | Hard cap for plan generation |
| Max long run preference (hours OR miles) | P1 | User input | KB-22 §1–4 | Some runners cap LR by time, not distance |
| Must-skip days (multi-select Mon–Sun) | P0 | User input | — | Real-life constraint; pushes quality off blocked days |
| Must-have days (long run on Sat? quality on Tue?) | P1 | User input | — | Common request; preserves user's existing rhythm |
| Equipment available (treadmill, track access, gym, hills, pool) | P1 | User input | KB-22 §12 | Affects workout selection (intervals indoors? hills?) |
| Strength preference (none / 1×/wk / 2×/wk / runner-strength block) | P1 | User input | KB-07 | Plan integrates strength sessions on chosen days |
| Cross-training preference (none / substitute / additive) | P1 | User input | KB-09 | Affects how XT counts toward volume |
| Plan template selector (Auto / Pfitzinger / Hansons / Daniels / Higdon / Furman FIRST / Custom) | P1 | Static + KB | KB-22 all | "Auto" is the default; users with strong preferences can override |
| Plan length (auto from template, override allowed) | P1 | Computed | KB-22 §1–4 | Override needed when race is closer/farther than ideal |
| Tune-up race scheduling (zero / one / two within cycle) | P2 | Race entity | KB-22 §15 BQ | Pfitzinger template assumes a HM tune-up |
| Heat/cold-season override (auto-detected from race date) | P2 | Computed + KB-12 | KB-22 §12 | Adjusts LR by time vs. distance, intervals indoors |
| Travel / known disruption windows | P2 | User input | KB-12 | Dropped-volume weeks pre-baked into plan |
| Multi-race planning toggle (chain plans for A/B/C races) | P2 | Race entity | KB-22 §11 | Spring + fall marathon, three-halves pattern |
| **Preview: phase breakdown (base / build / peak / taper)** | P0 | Generated | KB-22 §1–15 | The "what am I committing to" answer |
| **Preview: week-by-week thumbnail (volume bars + key workout chip)** | P0 | Generated | KB-22 sample weeks | Glanceable; shows ramp shape |
| Preview: peak week detail (Mon–Sun expanded) | P0 | Generated | KB-22 sample peak weeks | Shows hardest week up-front — honesty |
| Preview: predicted race time + confidence band | P1 | Computed | KB-02 | Honest ranges, not a single number |
| Preview: total time commitment (hr/wk avg + peak) | P1 | Computed | — | "What does my calendar look like?" |
| Warnings panel (volume jump >10%/wk, peak LR % of race, taper too short, missed workout density) | P0 | Validation | KB-22 §14, §15 | Coach safety net before user accepts |
| Warning: "you're 14 wk out from a marathon and have never run >10 mi" | P0 | Validation | KB-22 §4 | Aggressive plans need explicit acknowledgement |
| "Customize" affordances on preview (drag to swap days, swap workout type, regenerate week) | P1 | Editor | — | Plan rarely accepted as-is |
| "Regenerate from week N" (for plan modification mid-cycle) | P0 | Generator | — | When life intervenes — illness, travel, missed quality |
| Save as draft (not yet committed) | P1 | Plan entity | — | Users compare 2–3 plans before accepting |
| Compare plans side-by-side (2 drafts) | P2 | Plan entity | — | "Pfitzinger 18/55 vs. 18/70" decision support |
| Accept & activate | P0 | Plan entity | — | Commits plan, archives previous if any |
| Plan summary export (PDF or share link) | P3 | Generated | — | Coach/training partner review |

### Plan Builder special section

#### Wizard inputs (canonical list)

| Input | Type | Default behavior | Constraint propagation |
|---|---|---|---|
| Goal | enum (race / fitness / base / comeback) | "race" | Selects template family |
| Race (existing or new) | foreign key + nested form | most-recent upcoming Race | Locks distance + date |
| Distance | enum (5K, 10K, HM, M, 50K, 50mi, 100K, 100mi, custom) | from Race | Selects KB-22 section |
| Race date | date | from Race | Sets plan length (back-calc) |
| Goal time | duration (or "finish") | predicted from VDOT | Sets intensity zones |
| Current fitness | recent race / field test / VDOT estimate | latest Race or last field test | Calibrates pace targets |
| Days/week | int 3–7 | matches recent training history | Selects template variant |
| Doubles allowed | bool | false unless mileage > 50 mpw | Enables high-volume templates (KB-22 §10) |
| Peak mileage tolerance | int (mpw) | last cycle peak × 1.10 | Caps generation |
| Max long run | duration OR distance | 2:30 OR 22 mi (marathon) | Bounds LR progression |
| Must-skip days | set of weekdays | empty | Hard constraint |
| Must-have days (LR / quality) | weekday assignments | LR=Sat, Q1=Tue, Q2=Thu | Soft constraint |
| Equipment | multi-select | (treadmill, gym) | Workout substitutions |
| Strength | enum (0 / 1 / 2 / block) | 2× during base, 1× peak | Slots strength days |
| Cross-training | enum (none / substitute / additive) | substitute | Counts toward volume? |
| Template | enum (auto / Pfitz / Hansons / Daniels / Higdon / Furman / custom) | auto | Plan scaffold |
| Plan length | int (weeks) | template default | Back-calc from race date |
| Tune-up races | array of Race ids | one HM tune-up if marathon plan ≥16wk | Calibration races |

#### Wizard outputs

| Output | Detail |
|---|---|
| **Phase breakdown** | Bar showing weeks per phase (e.g., 4 base / 6 build / 4 peak / 3 taper) |
| **Week-by-week preview** | Grid of N week-cards: volume number, peak workout chip, LR distance |
| **Peak-week detail** | Mon–Sun table with named sessions (e.g., "WU + 6×1mi @T + CD") |
| **Predicted race time** | Point estimate + 80% CI band; calls out assumptions ("assumes 90% adherence, no missed quality") |
| **Confidence** | Low / Medium / High based on volume ramp aggressiveness, prior cycle adherence, time-to-race |
| **Warnings** | Any of: weekly volume jump > 10%, peak LR > 24 mi, taper < 2 wk, missed-quality density > 30%, unrealistic goal time vs. current VDOT, race date too close for chosen template |
| **Customize affordances** | Drag-swap weekday position; swap workout (Tue I → Tue T); regenerate week N+; replace LR with MLR + medium long; insert/remove cutback week |
| **Multi-race output** | Chained plans with bridge weeks visualized (KB-22 §11); recovery + reset windows explicit |

#### Re-entry behavior (plan modification)

When the user opens Plan Builder with an existing active plan:

- All inputs pre-fill from current plan
- "Regenerate from" dropdown defaults to "next Monday"
- Past completed weeks are read-only and excluded from regeneration
- New plan replaces old as a new version (Plan entity is versioned, not overwritten — see Data Model Implications)

### Quick competitor scan

- **Runna** — Conversational onboarding; few inputs; opinionated; minimal preview (week 1 only, full plan unlocks after subscribe). Strong mobile-first wizard. Weak on user customization mid-cycle.
- **McMillan Running Plans** — PDF-style canonical plans; user picks template + level; little personalization beyond pace; high authority, low flexibility.
- **Garmin Coach** — Fixed coach personas (Greg, Amy, Jeff); limited inputs; weekly delivery to watch; cannot preview full plan; modifications limited to skipping/rescheduling.
- **TrainingPeaks** — Buy a plan from a coach (marketplace) or build manually with workout builder; no AI generation; high power-user ceiling.
- **Final Surge / Stryd** — Pace/power-target driven; plans assume specific gear; technical UX.

faff.run's differentiator: full plan preview before commit, including peak week detail and warnings; explicit phase breakdown; predicted race time with confidence; and mid-cycle regenerate-from-week-N (most competitors require manual plan rebuild).

### Open questions

- Default to "auto" template or always show template choice up-front?
- Should goal time be a single number or a range (A/B/C goals)? KB-22 §15 distinguishes finish/PR/BQ goals — surface this?
- How aggressively should warnings block accept vs. only inform? Hard block on >2× peak LR jump from prior cycle?
- Multi-race chaining: build all cycles up-front, or only the next + placeholder for following?
- When user has no run history (first cycle), how does the "current fitness" assessment work? Field test wizard? Couch-to-5K detection (KB-22 §8)?
- How are tune-up races inserted — auto-suggest from races user has already entered, or as constraint slots ("schedule a HM 4–6 wk before")?

### Data model implications

- **Plan** entity must be versioned (v1, v2…) with `regenerated_from_week` pointer to the previous version's last completed week
- **Plan** must store wizard inputs as JSON snapshot for re-entry
- **Workout** entities are children of Plan; "regenerate from week N" replaces all Workouts dated ≥ that week, leaves earlier ones as historical
- Plan ↔ Race is many-to-one for chained plans (one race per plan); a multi-race "season" is a list of Plans
- Plan should record `predicted_finish_time` + `confidence` at generation time so it can be compared to actual

---

## 2. Gear (Web Page 9)

### Job-to-be-done

> "Track my equipment — especially shoes — so I know what to wear, what's wearing out, and what to reorder."

Centered on **shoe rotation tracking** because that's the strongest evidence-backed equipment behavior in distance running (KB-17 §"Shoe Rotation": Malisoux et al. 2013/2015 showed ~39% lower injury rate with multi-shoe rotation). Other equipment is secondary. Fueling inventory matters because gels expire and gut-trained brands matter on race day (KB-18).

### Element inventory

| Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|
| **Active rotation grid** (cards: photo, name, current mileage, % to retire, role chip) | P0 | Shoe entity + Activity links | KB-17 §"Rotation by workout type" | The core view — what's in current use |
| Add shoe (model, brand, purchase date, starting mileage, role tag) | P0 | Shoe entity | KB-17 | Primary write |
| Auto-mileage attribution (from Activity → Shoe) | P0 | Activity ↔ Shoe link | KB-17 §"Mileage Lifespan" | Manual mileage tracking dies fast |
| Manual mileage edit / correction | P1 | Shoe entity | — | Required for treadmill mile-counter mismatches, missing imports |
| Shoe role tag (easy / daily / tempo / race / trail / stability) | P0 | Shoe entity | KB-17 §"Rotation by workout type" | Coach uses this when suggesting shoes per workout |
| Replacement reminder (per-category lifespan from KB-17) | P0 | Computed | KB-17 §"Mileage Lifespan" | Threshold alerts (75%, 90%, 100% of category lifespan) |
| Lifespan modifiers (body mass, surface, treadmill use) | P2 | User profile + Activity | KB-17 §"Modifiers" | Personalized lifespan estimate |
| Press-test prompt (when shoe approaches retirement) | P2 | Computed | KB-17 §"Signs of Shoe Degradation" | "Time to do the press test on the Endorphin Speed" |
| Shoe history (archived shoes with lifetime mileage, retire date, retire reason) | P1 | Shoe entity | KB-17 | Pattern analysis: "I always retire daily trainers around 420 mi" |
| **Per-shoe analytics**: total miles, miles by week, avg pace, fastest run, weather worn in | P1 | Activity aggregation | KB-15 | Justifies the "race shoe" decision and gut-checks fit |
| Per-shoe analytics: surface mix (road/track/trail/treadmill) | P2 | Activity tags | KB-17 §"Treadmill vs. Road" | Wear patterns differ by surface |
| Per-shoe analytics: routes most run in (link to Routes page) | P2 | Activity ↔ Route | — | Surfaces preferences |
| Shoe pairing rules (auto-assign shoe to workout based on type + weather + role) | P2 | Coach engine | KB-17 §"Rotation by workout type" | "Tempo Tuesday → Endorphin Speed" |
| Shoe notes / review (free text + 1–5 stars + tags: bunion-friendly, narrow heel, sloppy, etc.) | P1 | Shoe entity | KB-17 §"Foot type considerations" | Decision support for next purchase |
| Cost tracking (purchase price, $/mile when retired) | P2 | Shoe entity | — | Cost-conscious runners; super-shoe ROI math |
| Sock notes + thickness (links to size adjust) | P3 | Equipment | KB-17 §"Sock Interaction" | Affects fit; rarely tracked |
| Insole / orthotic per shoe | P3 | Equipment | KB-17 §"Insoles and Orthotics" | Some users swap insoles between pairs |
| Lacing technique per shoe (heel-lock, gap-lace, etc.) | P3 | Shoe notes | KB-17 §"Lacing Techniques" | Niche but real |
| **Other equipment** (watches, HR straps, headphones, hydration vests, GPS pods, race kit, sunglasses) | P1 | Equipment entity | — | Lower stakes than shoes; track for warranty / loss / replacement |
| Equipment status (active / archived / lost / broken) | P2 | Equipment | — | Inventory management |
| Equipment usage log (HR strap last used, vest last washed) | P3 | Activity link | — | "When did I last replace the HR strap battery?" |
| **Fueling inventory** (gels, chews, drink mix, salt tabs by brand × flavor × count × expiration) | P0 | FuelingPlan inventory | KB-18 | Gels expire; race day demands tested products |
| Fueling expiration tracker (sort by soonest; warn at 60-day) | P0 | Computed | KB-18 | Hard quality issue otherwise |
| Fueling reorder reminder (low-stock threshold per item) | P1 | Computed | — | "You're down to 4 SiS gels — race in 5 wk" |
| Fueling gut-tolerance log (per product: GI score 1–5 by run) | P1 | FuelingPlan + SubjectiveLog | KB-18 | Race-day product selection |
| Fueling rotation in long runs (which gel, when, in which run) | P1 | FuelingPlan | KB-18 | Gut training |
| **Wishlist** (shoes / gear to research, with notes + estimated price) | P2 | Wishlist entity | — | Reduces impulse, captures intent |
| Wishlist → purchase flow (mark as bought → moves to active rotation) | P2 | Wishlist + Shoe | — | Closes the loop |
| Cost analytics dashboard (annual gear spend, $/mile lifetime, category breakdown) | P3 | Aggregation | — | Year-end review niche |
| Brand fit notes (cross-brand size table; from KB-17 brand cross-fit) | P3 | Static + user override | KB-17 §"Sizing rules" | Helps "Brooks 9.5 = Hoka 9 in this user's foot" |
| Storage notes (which shoes in garage vs. closet; degradation flag) | P3 | Shoe entity | KB-17 §"Storage degradation" | Heat-stored shoes degrade faster |

### Gear special section

#### Shoe rotation tracker

The active rotation view should show, per KB-17:

- **Slot fulfilled?** (Easy / Daily / Tempo / Race / Stability / Trail) — a coverage matrix shows which roles have a shoe assigned
- **Mileage bar** colored by category lifespan zone (KB-17 §"Mileage Lifespan"):
  - Daily trainer: green 0–350, yellow 350–450, red 450+, retire ≥500
  - Super shoe (PEBA): green 0–100, yellow 100–180, red 180+, retire ≥250
  - Tempo trainer: 0–250 / 250–350 / retire ≥400
  - Trail: 0–350 / 350–450 / retire ≥500
- **Drying-rotation indicator**: shoes worn in last 24 hr flagged so user grabs a different pair for tomorrow's run (KB-17 §"Drying rotation")
- **Recommended rotation size for current weekly mileage** (KB-17 §"Recommended rotation size"): runner doing 45 mpw should have 3 pairs; show coverage gap if only 2.

#### Per-shoe analytics

| Metric | Source | Notes |
|---|---|---|
| Total mileage | Activity → Shoe sum | Auto-attributed |
| Avg pace | Activity aggregation | Identifies "fast" vs. "slow" shoes |
| Pace distribution | Activity aggregation | Histogram |
| Weather mix worn in | Activity weather tag | "I wear these in rain" |
| Surface mix | Activity surface tag | Road/trail/treadmill |
| Best workout in shoe | Activity rank | "PR'd HMP tempo in these" |
| Days since last worn | Computed | Drying rotation hint |
| Estimated mileage remaining | Computed from KB-17 lifespan + modifiers | Replacement planning |

#### Other equipment categories

| Category | Tracked attrs | KB ref |
|---|---|---|
| GPS watch | Model, FW version, battery age, paired sensors, last sync | KB-15 |
| HR strap | Model, battery type, last battery change, last washed | KB-15 |
| Optical HR (band/arm) | Model, accuracy notes | KB-15 |
| Headphones | Model, IP rating, sweat damage notes | — |
| Hydration vest | Capacity, used in races | KB-19 |
| Handheld bottles | Capacity, count | KB-19 |
| GPS foot pod / Stryd | Model, calibration factor | KB-15 |
| Sunglasses, hat, gaiter, gloves | Inventory only | — |
| Race kit (bib belt, shoe clips, throwaway layers) | Inventory + race assignment | — |

#### Fueling inventory

Tracked per item: brand, product line, flavor, caffeine mg, sodium mg, carb g, count owned, expiration, gut-tolerance score (running avg 1–5 from per-run logs), purchase source. Reorder threshold per item. Cross-reference with planned races + long runs to surface "you'll need 18 gels for the buildup, you have 11."

### Quick competitor scan

- **Strava Gear** — Single-shoe attribution per activity; manual mileage; basic odometer; no role tags, no replacement model awareness, no fueling, no analytics.
- **Garmin Connect Gear** — Auto-attribution from device; multi-shoe support; manual lifetime cap; no drying rotation, no analytics by pace/weather, no fueling.
- **Runkeeper / Nike Run Club** — Minimal gear; mostly an activity tag.
- **Stryd** — Tracks shoe-specific power offsets; hardware-tied; not a general gear manager.
- **Final Surge / TrainingPeaks** — Equipment tags exist but are afterthoughts.

faff.run opportunity: KB-grounded category-aware lifespans, role-coverage gaps, drying rotation, fueling expiration, gut-tolerance log — none of which the incumbents do.

### Open questions

- Default rule for shoe attribution: "shoe most-recently used for this workout type" or "user's pre-set workout-type → shoe map"?
- Should the app suggest *what shoe to wear today*, or just track? (Coach integration question.)
- Fueling: do we track product lots/batches for recall events?
- When a shoe is retired, prompt for retire reason (mileage / dead foam / upper / pain / preference) for pattern analysis?
- Should wishlist link to retailer URLs or stay neutral (no commerce)?
- Cost tracking: opt-in or default-on?

### Data model implications

- **Shoe** entity: `model`, `brand`, `colorway`, `category` (enum from KB-17), `roles[]` (multi), `purchase_date`, `purchase_price_cents`, `starting_miles`, `retire_date`, `retire_reason`, `notes`, `rating_1_5`, `is_active`
- **Activity ↔ Shoe** join with mileage attributed (handles half-and-half: split run between two pairs)
- **Equipment** entity: generic, with `category`, `model`, `attrs` JSON, `acquired`, `retired`, `notes`
- **FuelingItem** entity (inventory): `brand`, `product`, `flavor`, `count`, `carb_g`, `sodium_mg`, `caffeine_mg`, `expiration`, `reorder_threshold`, `tolerance_score_avg`
- **FuelingLog** (per-run consumption): `activity_id`, `item_id`, `count_consumed`, `gi_score_1_5`, `notes`
- **WishlistItem** entity: `category`, `name`, `price_estimate`, `notes`, `priority`, `purchased_to_id` (back-link if converted)

---

## 3. Routes (Web Page 10)

### Job-to-be-done

> "Show me where to run today, save my favorites, and remember how each one usually goes."

Routes is reference material. The unique value for a personal app is **per-route history** — the user has run their 6-mile loop 47 times; show the pace distribution, the seasons, the weather, the time-of-day patterns. Most competitors treat routes as a discovery layer; here, the saved-route ledger is primary.

### Element inventory

| Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|
| **Saved routes list** (cards: name, distance, elevation, surface, last run, run count) | P0 | Route entity | — | Primary view — user's library |
| Add route from completed activity ("save this as a route") | P0 | Activity → Route | — | Most common create path |
| Add route from GPX upload | P1 | Route entity | — | Imports from Strava, Garmin, Komoot |
| Add route by drawing on map | P2 | Route editor | — | Power-user feature |
| Route attributes (name, distance, elevation gain, surface mix, loop/OAB/PTP, location) | P0 | Route entity | — | Filterable by all |
| Surface tag (road / track / trail / treadmill / mixed / unpaved) | P0 | Route entity | KB-17 §"Treadmill vs. Road" | Coach uses surface for shoe assignment |
| Elevation profile preview (sparkline + max grade + total gain) | P0 | GPX parse | KB-11 | Decision support: "do I want hills today?" |
| Route map preview (static image; click for interactive) | P0 | Map tiles | — | Visual recognition |
| Route safety flags (lighting, traffic, isolation, dog risk, surface hazard) | P1 | User-tagged | — | Time-of-day decision support |
| Best time-of-day (user-tagged: dawn / day / dusk / night-OK) | P1 | User-tagged | — | Race-pace / dark-run filter |
| Weather preference (shaded / sheltered / open) | P2 | User-tagged | KB-06 | Hot day → shaded route |
| Route tags (free text: hilly, fast, scenic, work-from, race-prep) | P2 | User-tagged | — | User's mental model |
| Last run on route (date, pace, conditions, link to Activity) | P0 | Activity ↔ Route | KB-15 | "How did this go last time?" |
| **Pace history per route** (chart: avg pace over time, by season, by weather) | P0 | Activity aggregation | KB-06 | Personal app's edge — fitness signal that controls for course |
| Route segment splits (per-segment median + recent run vs. median) | P1 | Activity aggregation | — | Pacing accountability — "you went out 20s/mi too fast on the first mile" |
| Strava segment overlay (Strava segments crossing this route + PR + last attempt) | P1 | Strava integration | — | Strava users live in segments |
| Route notes (free text + per-run notes accumulated) | P1 | Notes entity | — | "Construction at mile 3 in spring 2025" |
| Run count on route | P0 | Activity aggregation | — | Identifies the warhorses |
| **Route library / suggestions** (filter by distance, elevation, surface, time-of-day, weather-suitable) | P1 | Saved routes + future external | — | "I need a 6-mi flat shaded loop near home" |
| Suggestion chip: "your usual long-run loop" | P2 | Activity pattern detection | — | Friction reducer |
| Suggestion chip: "for today's weather" | P2 | Routes + weather | KB-06 | Hot day → shaded; windy → sheltered |
| Suggestion chip: "for today's workout" | P2 | Routes + planned Workout | KB-22 | Tempo workout → flat known route |
| **Route generator** (radius from start, target distance, loop preference, hill preference) | P2 | Komoot/external API | — | New-area discovery |
| Komoot integration (import Komoot routes; export faff.run routes to Komoot) | P2 | OAuth integration | — | Trail/cycling overlap user base |
| Strava routes integration (import Strava routes; one-tap save) | P2 | OAuth integration | — | Path of least friction for Strava users |
| Garmin Course Creator integration (push route → watch as course) | P2 | Garmin Connect IQ | — | On-watch turn cues |
| Apple Maps / Google Maps export ("get me there") | P2 | OS link | — | Routing to start point |
| Route sharing (share link to specific route) | P3 | Public link | — | Send to training partner |
| Route weather forecast inline (when planning) | P2 | Weather API | KB-06 | Decision support |
| Race route tag (mark "I'm running this race on this route" — links to Race entity) | P2 | Race ↔ Route | — | Course-specific training (KB-11) |
| Heatmap of all runs (personal; aggregated route GPX overlay) | P3 | Activity aggregation | — | Pretty + reveals coverage gaps |

### Routes special section

#### Saved routes (the core)

Sortable table + map. Each row: name, distance, elevation gain, surface, loop/OAB/PTP, last run date, run count, avg pace, fastest pace.

Filter chips: distance bands (1–3, 3–6, 6–10, 10+), surface, loop type, "near me" (proximity to current location or saved start point), "shaded", "lit at night".

#### Per-route history

The differentiator. For each route:

- **Run-count timeline** — bar chart of monthly runs on this route
- **Pace-over-time** — line chart, with a moving avg; controls for season + weather
- **Seasonal split** — same route, summer vs. winter pace distribution
- **Weather-controlled pace** — pace at 50–60°F vs. 70–80°F; hint at fitness signal
- **Recent-vs-baseline** — last run pace vs. 30-day median for that route, called out as "today's run was 12s/mi slower than your baseline on this route" (the kind of signal that's only meaningful with a known course)

#### Route suggestions

Scoring inputs: planned workout type (KB-22), weather forecast (KB-06), available time, recent route variety (avoid running the same loop 10× in a row → injury risk per KB-17), surface availability, time-of-day safety. Output: ranked top 3 with one-line "why."

#### Strava segment integration

Per route, list segments crossing it with: user's PR, segment leader, recent attempts, last attempt vs. PR. Optional overlay on the elevation profile.

#### Route safety

User-flagged attrs surfaced when planning runs that match risk:

- Lit / unlit
- Traffic level (low / medium / high)
- Sidewalk / road shoulder / multi-use path
- Isolation (busy area / quiet / remote)
- Surface hazard (icy in winter / muddy after rain / construction)
- Dog risk (off-leash hotspot)
- Time-of-day notes ("OK pre-dawn solo," "avoid after dark")

These compose into a "safety score" for current conditions, but the score is advisory — tags are the primary surface.

### Quick competitor scan

- **Strava Routes** — Strong route generator; uses heatmap data; one-tap save from popular routes; export to watch. Weak per-route personal history (Strava emphasizes leaderboards over personal trends).
- **Komoot** — Best multi-modal route planner (especially trail/gravel); turn-by-turn voice; offline maps; weak running-specific UX.
- **Garmin Course Creator** — Tied to ecosystem; popularity-based routing; pushes to watch; weak filtering and weak historical analytics.
- **Suunto / Wikiloc** — Trail-runner heavy; community-driven; less polish.
- **Footpath / RunGo** — Mobile-first route drawing; voice cues; one-shot use rather than library.

faff.run angle: per-route fitness signal (controlled-course pace tracking); weather/workout-aware suggestions from *your own* route library; safety tagging that's actually used in suggestions; tight loop with planned Workouts.

### Open questions

- Build our own route generator or rely on Komoot/Strava? (Building is heavy; integrating is brittle.)
- How is "the same route" detected from raw GPX? (Tolerance matching, start point + total distance + elevation hash, or explicit user "save as route X.")
- Auto-save common routes (run the same loop 3+ times → prompt to save) yes/no?
- Map tile provider (Mapbox / MapLibre / Apple MapKit JS / Google Maps)?
- Privacy: routes near home — auto-fuzz start/end like Strava's privacy zones?
- Sharing: public link, team link, or only export-to-GPX?

### Data model implications

- **Route** entity: `name`, `geo` (encoded polyline + GPX), `distance_m`, `elevation_gain_m`, `surface`, `route_type` (loop/OAB/PTP), `start_point`, `tags[]`, `safety_attrs` JSON, `weather_pref`, `is_favorite`, `share_token` nullable
- **Activity ↔ Route** link with `match_confidence` (auto-detected vs. user-confirmed)
- Activity-aggregated cached fields per Route: `run_count`, `last_run_at`, `pace_p50`, `pace_p10`, `pace_p90`, `last_pace`, `seasonal_aggs` JSON
- **Notes** entity attaches to Route id for free-text history
- Race entity has optional `course_route_id` for course-specific training

---

## 4. Settings / Profile (Web Page 11)

### Job-to-be-done

> "Manage my account, integrations, and preferences. I'm here because something needs to be fixed or set."

Settings is a forensic page. Most visits are to troubleshoot a sync, change a notification, or update a baseline after a field test. Information density and clear status indicators matter more than aesthetics.

### Element inventory

| Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|
| Settings nav (Profile, Fitness, Preferences, Integrations, Notifications, Coach, Privacy, Subscription, Data, Account) | P0 | UI | — | Discoverability across many sections |
| **Profile**: name, display name, avatar | P0 | User entity | — | Identity |
| Profile: date of birth (drives age-graded calcs, BAA standards) | P0 | User entity | KB-22 §15 BQ, KB-14 | Required for several features |
| Profile: sex (drives sex-specific training; HR & sweat-rate models) | P0 | User entity | KB-13 | Required for many models |
| Profile: height | P0 | User entity | — | Body comp + sweat rate baseline |
| Profile: weight (current + goal) | P0 | User entity / HealthMetric | KB-19 | Used in plan and fueling models |
| Profile: body composition targets (body fat, lean mass — optional) | P2 | HealthMetric | KB-13 | Not all users want this surfaced |
| Profile: time zone + home location (privacy-sensitive) | P0 | User entity | KB-12 | Drives quiet hours, weather, route start |
| **Fitness baselines**: VDOT (manual override + auto-suggested) | P0 | User entity + Race | KB-01, KB-02 | Drives every pace zone |
| Fitness baseline: max HR (manual + auto-detected) | P0 | User entity + Activity peaks | KB-03 | HR zones |
| Fitness baseline: LTHR | P1 | User entity + field test | KB-03 | Threshold-based zones |
| Fitness baseline: resting HR (auto from wearable trend) | P1 | HealthMetric | KB-15 | Recovery model |
| Fitness baseline: HRV baseline (auto trend) | P1 | HealthMetric | KB-15 | Recovery model |
| Fitness baseline: sweat rate (mL/hr) + sodium concentration (mg/L) | P1 | User-input or sweat test | KB-19 | Hydration plan |
| Fitness baseline: critical pace / power (Stryd users) | P3 | Stryd integration | KB-15 | Power-based training niche |
| Field-test launcher (5K time trial, ramp test, 30-min critical effort) | P2 | Workout template | KB-01 | Updates baselines |
| Baseline change-history log | P2 | Audit | — | "When did my VDOT jump in 2024?" |
| **Preferences**: units (mi/km, ft/m, lb/kg, °F/°C) — independent toggles | P0 | User prefs | — | US users mix mi + lb + °F |
| Preferences: time format (12 / 24 hr) | P0 | User prefs | — | Standard |
| Preferences: week start day (Mon / Sun) | P0 | User prefs | KB-22 sample weeks | Plan layout |
| Preferences: easy pace target style (range / target / "by feel") | P1 | User prefs | KB-01, KB-04 | Display choice on planned easy runs |
| Preferences: HR display preference (zones / bpm / %max) | P2 | User prefs | KB-03 | Watch + web display |
| Preferences: pace display (min/mi vs. min/km vs. m/s vs. min/400) | P2 | User prefs | KB-01 | Track runners think in min/400 |
| Preferences: dark mode / contrast | P2 | User prefs | — | Visual |
| Preferences: language / locale | P3 | User prefs | — | Future |
| **Wearable connections** (Apple Watch, Garmin, Coros, Polar, Suunto, Wahoo) — status, last sync, FW, battery if available | P0 | Integration state | KB-15 | Multi-watch users common |
| Wearable: read/write per data type (workouts read, structured workouts write, …) | P1 | Granular permissions | KB-15 | Power user |
| Wearable: troubleshoot / re-sync button | P0 | Integration | — | Most-used button on this page |
| **Service connections** (Strava, Apple HealthKit, Garmin Connect, Coros, Whoop, Oura, Stryd, Komoot) | P0 | OAuth state | — | Core integrations |
| Service: connection status (connected / expired / error / disconnected) | P0 | Integration | — | At-a-glance health |
| Service: OAuth scopes granted vs. requested (per service) | P1 | OAuth state | — | "Why isn't Garmin pulling sleep?" → scope missing |
| Service: read/write toggles per data type | P1 | Granular permissions | — | "Strava pull-only, no auto-post" |
| Service: granular HealthKit categories (workouts, HR, HRV, RHR, sleep, weight, body fat, menstrual, mindful minutes, blood oxygen, VO2max, etc.) | P0 | HealthKit | KB-13, KB-15 | iOS users have detailed control needs |
| Service: last sync timestamp + manual refresh | P0 | Integration | — | Troubleshooting |
| Service: sync error log (last N errors with timestamps + actionable hints) | P1 | Integration | — | Debug aid |
| Service: dedupe preference (which is source of truth on conflict) | P1 | Integration | — | KB-15 — multi-source same workout |
| Service: disconnect / revoke | P0 | Integration | — | Safety + privacy |
| **Notifications**: per category (daily message, workout reminder, race countdown, plan changes, recovery alert, gear reminder, fueling reminder, missed workout, achievement) | P0 | Notification prefs | — | Granular control prevents fatigue |
| Notifications: channel per category (push / email / web / iPhone widget / watch only) | P1 | Notification prefs | — | Different signals for different categories |
| Notifications: quiet hours (start/end + days) | P0 | Notification prefs | KB-12 | Sleep + travel |
| Notifications: race-day mode override (always-on; never quiet on race morning) | P1 | Notification prefs | — | Race day must break quiet hours |
| Notifications: time-of-day for daily message (morning / pre-workout / custom) | P1 | Notification prefs | — | When does the user want it? |
| Notifications: travel-aware (auto-shift to local time zone) | P2 | Computed | KB-12 | Travel timezone management |
| **Coach personality**: tone (analytical / encouraging / blunt / minimalist) | P1 | User prefs | — | Coach voice |
| Coach: verbosity (brief / standard / deep) | P1 | User prefs | — | "Just tell me the workout" vs. "explain why" |
| Coach: when to surface unsolicited advice (always / when significant / never — only on ask) | P2 | User prefs | — | Inbox-zero users vs. coach-led users |
| Coach: language / pronouns | P2 | User prefs | — | Personalization |
| **Privacy**: profile visibility (private / friends / public — likely private-only for personal app) | P1 | Privacy | — | Trust signal even if all-private |
| Privacy: data sharing for product improvement (opt-in/out) | P1 | Privacy | — | Standard |
| Privacy: analytics opt-out | P1 | Privacy | — | Standard |
| Privacy: home / start-location fuzzing radius for any external sharing | P2 | Privacy | — | Routes privacy zones |
| Privacy: granular sensitive data (menstrual cycle, body comp, injury, mental health) opt-out from coach context | P2 | Privacy | KB-13 | Sensitive data scope |
| **Subscription** (single tier or family; minimal for personal) | P3 | Subscription | — | "Personal" build implies one-user; placeholder |
| Subscription: status, plan, next renewal | P3 | Subscription | — | If billing exists |
| Subscription: manage / cancel link | P3 | Subscription | — | Required for any paid product |
| **Data export**: GPX (per activity / batch / all) | P0 | Export | — | Portability |
| Data export: CSV (activities, workouts, races, health metrics, shoes, notes) | P0 | Export | — | Spreadsheet users |
| Data export: JSON (full account dump for portability / GDPR) | P0 | Export | — | Compliance + paranoia hedge |
| Data export: scheduled / one-shot | P2 | Export | — | "Send me a snapshot every quarter" |
| Data export: per-surface (just races, just shoes, just plan) | P2 | Export | — | Backup partial |
| Data import (from Strava / Garmin / Final Surge / TrainingPeaks) | P2 | Import | — | New-user onboarding |
| **Account**: email, password change, 2FA setup, active sessions list, sign-out all, delete account (with confirm + grace period) | P0 | Auth | — | Standard |
| Account: device list (which devices logged in, last seen) | P1 | Auth | — | Security |
| Account: legal (terms, privacy policy) | P1 | Static | — | Required |
| Account: app version + build, "check for update" | P2 | Static | — | Support |
| Account: support contact + bug report | P1 | Support | — | Feedback loop |

### Settings / Profile special section

#### Profile basics

Demographics (DOB, sex, height, weight, time zone) drive: age-graded performance, BAA Boston qualifying standard (KB-22 §15), max-HR estimates (KB-03), sweat-rate baselines (KB-19), pace zone calibration. All editable; some (DOB, sex) require gentle-but-clear explanation of what depends on them.

#### Fitness baselines

Each baseline has: current value, source (manual / latest race / wearable trend / field test), confidence (how recent, how derived), last updated, and a "redo field test" launcher. Crucial for trust — if the user thinks VDOT is wrong, they should immediately see why it's that number.

| Baseline | Default source | KB ref |
|---|---|---|
| VDOT | Latest Race within 12 wk; else recent time trial | KB-01, KB-02 |
| Max HR | Highest 10-sec HR in last 90 days, capped at age-predicted + 10 | KB-03 |
| LTHR | Field test (30-min TT avg of last 20 min HR), or 90% of MaxHR fallback | KB-03 |
| Resting HR | 7-day trough avg from wearable | KB-15 |
| HRV baseline | 30-day rolling avg from wearable | KB-15 |
| Sweat rate | Sweat test (weigh-in/weigh-out long run); else estimate by mass + temp | KB-19 |
| Sodium concentration | Sweat test; else 800 mg/L default | KB-19 |

#### Wearable + service connections

Status taxonomy (single status per integration):

| Status | Meaning | Action |
|---|---|---|
| Connected | OAuth valid, syncing, last sync < 24 hr | None |
| Stale | Connected but no sync in 24+ hr | "Try refresh" |
| Expired | Token expired | "Reconnect" |
| Error | Last sync errored | Show error + remediation |
| Disconnected | Never connected or revoked | "Connect" |

Per-service expanded panel: scopes, sync history (last 10 attempts), data-type toggles, dedupe preference, disconnect.

HealthKit deserves its own granular UX (iOS Settings-style scoped permissions list — checkbox per data type — because the OS forces granularity; matching that mental model in-app reduces confusion).

#### Notifications

Matrix layout (rows = categories; columns = channels). Plus quiet hours block, plus race-day override, plus time-of-day for daily message.

Categories at minimum: Daily coach message; Workout reminder (T-30 min); Plan change; Race countdown (race week); Race morning checklist; Recovery alert (poor HRV / RHR spike); Gear reminder (shoe near retirement, fueling expiring); Missed workout follow-up; Field-test reminder; Achievement.

#### Coach personality

Beyond tone/verbosity, useful prefs: praise threshold (silent / minor PRs / only big PRs); honesty level (sugar-coated / direct / brutal); explanation depth ("tell me why" toggle).

#### Privacy

Personal app means most "social" privacy is moot. The real privacy surface here:

- HealthKit category opt-outs (some users want to exclude menstrual or mental health data from coach context entirely — KB-13)
- Sensitive metrics not surfaced in shareable exports (e.g., body comp excluded by default)
- Home location fuzzing for any GPX/route shared externally
- Coach context exclusion: "don't reference my weight in advice" toggle

#### Data export

Three formats serve three needs:

- **GPX** — interoperability (per-activity export to other apps)
- **CSV** — spreadsheet/manual analysis (one CSV per entity type)
- **JSON** — full-fidelity portability (every entity, all fields, including notes and computed-then-cached aggregates)

Bulk export should be async ("we'll email a download link"). Should include a manifest with schema version. GDPR-style "download all my data" requirement satisfied by JSON full export.

#### Account management

Standard. Notable: delete-account flow should explain what's deleted vs. anonymized vs. retained (e.g., aggregate analytics may retain anonymized records); 30-day grace period with restore option; 2FA strongly encouraged but not forced.

### Quick competitor scan

- **Strava Settings** — Heavy on social privacy; notification matrix is decent; data export is thin (CSV of activities only); HealthKit toggles minimal.
- **Garmin Connect Settings** — Sprawling, hard to navigate; deep data control; weak on integration troubleshooting UX.
- **Standard SaaS pattern** — Clean nav (Profile, Account, Billing, Notifications, Integrations, Privacy, Data); good models: Linear, Notion, 1Password, Mercury.
- **HealthKit permissions UX** — iOS forces granular per-type permission with clear "what's this for?" copy. Mirror that pattern in-app for read/write toggles.
- **Whoop / Oura settings** — Strong integration status pages; clear "last sync" indicators; weak data export.

faff.run angle: integration troubleshooting clarity (status taxonomy, error logs, scope visibility); HealthKit-style granular toggles applied across all integrations; baseline confidence + provenance; sensitive-data exclusion from coach.

### Open questions

- Single-tier subscription or free with paid upgrade? (Spec says "minimal for personal" — placeholder.)
- Account deletion: hard delete vs. anonymize-and-retain — what's the right default?
- Multi-account support (family members)? Spec implies no, but the data model should not preclude it.
- Should users be able to import historical data from Strava/Garmin? At what depth (just activities, or workouts + plans + gear)?
- Privacy zones and home-location fuzzing: do we ever share routes externally, or is everything always private?
- Field test results — auto-update VDOT/LTHR or always confirm?
- Where does HealthKit live on Watch app vs. iPhone vs. Web? (Web settings can show granted scopes but can't grant — that's iOS-only.)

### Data model implications

- **User** entity: demographics + preferences (units, time format, week start, easy-pace style) + fitness baselines (each with source + confidence + last_updated) + privacy flags
- **Integration** entity: per-service OAuth state (`service`, `status`, `scopes_granted`, `last_sync_at`, `last_sync_status`, `error_log[]`, `data_type_toggles` JSON, `dedupe_priority`)
- **NotificationPref** entity: matrix of `category × channel`, plus `quiet_hours`, `race_day_override`, `daily_msg_time`, `tz_aware`
- **CoachPref** sub-doc on User: `tone`, `verbosity`, `proactivity`, `excluded_topics[]`
- **PrivacyPref** sub-doc on User: `analytics_opt_in`, `data_share_opt_in`, `home_fuzz_radius_m`, `sensitive_excluded[]`
- **AuditLog** entity: baseline changes, integration connect/disconnect, data exports, account changes — for the user's own change history view
- **Export** job entity: `format`, `scope`, `requested_at`, `completed_at`, `download_url`, `expires_at`

---

## Cross-surface notes

| Pattern | Where used | Implication |
|---|---|---|
| Auto-attribution with manual override | Shoes ↔ activities, routes ↔ activities, baselines from races | Need confidence + provenance metadata everywhere |
| Per-entity history / audit log | Plan versions, baseline changes, integration syncs | Audit pattern across many entities |
| Granular permissions | HealthKit, Strava, notifications | Matrix UX pattern reused; centralize |
| Suggestion engine | Plan templates, route picks, shoe-for-workout | Common engine, different inputs |
| Validation warnings before commit | Plan accept, shoe retire, account delete | Reusable warning panel component |
| Cards-with-status (good/warn/bad) | Shoes (mileage), integrations (sync), routes (last run freshness) | Reusable status-card pattern |

---

## Summary of element counts (P0 + P1 + lower)

| Surface | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|---|
| Plan Builder | 14 | 9 | 7 | 1 | 31 |
| Gear | 10 | 9 | 12 | 6 | 37 |
| Routes | 11 | 6 | 11 | 2 | 30 |
| Settings / Profile | 28 | 19 | 14 | 6 | 67 |

Settings dominates by element count because it's the catch-all for prefs + integrations + account. Plan Builder is dense per-input but shorter overall. Gear is the most KB-grounded surface (every shoe-related row maps to KB-17). Routes has the most "future" elements (P2/P3 dominate) because the differentiated value — per-route history — depends on having activity volume to mine.
