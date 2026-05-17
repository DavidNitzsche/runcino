# Review Notes — Running Research Knowledge Base

This file flags issues a maintainer or the coaching engine should be aware of. None of these are blockers — the docs are usable as-is — but each represents a tension, gap, or weak-evidence area. References are by doc number and section; line ranges are approximate to the version reviewed (May 2026).

Scope reviewed: 24 docs (`00a`, `00b`, `01`–`22`) plus `RESEARCH_TASKS.md`. Reviewer skim-read, did not verify every cited source.

---

## Cross-doc contradictions

### 1. Carb-load amount for marathon
- **00a** (`00a-distance-running-training.md`, line 437): "Daily intake | 10–12 g carb/kg/d for 36–48 h"
- **08** (`08-pacing-and-race-week.md`, lines 350, 456): "8-12 g/kg/day for 24-48 h pre-race"; marathon = "8-12 g/kg/day for 36-48 h"
- **Resolution:** 8–12 g/kg is the broader contemporary range (and what the Australian Institute of Sport / Burke literature supports). 10–12 is the upper-end "classical" carb-load. Coach should default to the 08 range and treat 10–12 as the upper target. Update 00a to "8–12 g/kg/d" to match.

### 2. CWI temperature window
- **00a** (line 453): "10–15 min at 5–15°C"
- **00b** (line 132, 523): "10–15°C, 11–15 min"
- **Resolution:** 00a's lower bound (5°C) is colder than 00b's. The 10–15°C / 11–15 min protocol in 00b matches the Stephens/Versey meta-analyses. Tighten 00a to remove the 5°C lower bound (which is closer to cold-plunge / cryotherapy territory and not what the cited running-recovery literature uses).

### 3. Super shoe lifespan
- **00a** (line 480, 508): "200–400 km" (≈ 124–249 mi)
- **17** (`17-footwear.md`, line 279): "150–250 mi (240–400 km); benefit decays after ~150 mi"
- **Resolution:** 17 is the authoritative doc and tracks current Outside Online / Believe in the Run testing. 00a's lower bound is too low. Standardize on 17's range; 00a should cite 17.

### 4. ACWR risk zones (consistent, but the framing diverges)
- **00a** (lines 729–736) and **15** (`15-wearable-data.md`, lines 215–224) report identical numerical thresholds (0.8–1.3 sweet spot, ≥1.5 high).
- **15** explicitly flags the Impellizzeri/Tenan critique that ACWR has been challenged as an injury predictor and recommends treating it as "directional sanity check, not a stop-light."
- **00a** hedges weaker ("a heuristic, not a rule") but still presents the table.
- **Resolution:** Not a contradiction in numbers, but the **strength of recommendation** differs. The coaching engine should adopt 15's softer stance globally; 00a's table risks being read as deterministic.

### 5. Easy-pace HR ceilings (drift)
- **00a** (line 232, 242): recovery 60–70% HRmax, easy 65–75% HRmax
- **01** (line 14): "Easy pace … typically 65–78% HRmax"
- **04** (line 49): "Daniels E … 65–79% HRmax"
- **03** (lines 132, 301): "Aerobic / Tempo 70–80% HRmax"; "cap ~75% HRmax for true easy pace"
- **Resolution:** Defensible drift across ±3–4% reflecting different schools (Daniels vs. Pfitz vs. Friel), but the coach will hit edge cases. Pin a canonical band: easy = 65–78% HRmax (covering the union); recovery = ≤70% HRmax. Leave the school-specific bands in their respective system tables but use the canonical band when no system is specified.

### 6. Nutrition: protein ratio post-run
- **00a** (line 425): "1.0–1.2 g carb/kg + 0.25–0.30 g protein/kg" in the 0–60 min window; carb:protein "~3–4:1"
- **00b** (line 115): "0.8–1.2 g/kg/h carbohydrate continued"
- Numbers don't conflict but the windows are different (immediate post vs. continued through 4 h). No fix needed; flag for INDEX clarity.

### 7. Riegel exponent
- **02** (line 27, 165) gives the canonical 1.06.
- **02** later notes (line 172, 291): recreational averages run 1.07–1.12; modern women's road WR fits 1.04.
- This is **internally consistent** within doc 02 but should propagate into doc 22 (plan-templates) and doc 01 (pace-zones). Both 01 and 22 implicitly assume Riegel-style equivalence without flagging the runner-type adjustment.

### 8. Long-run cap framing
- **00a** (lines 184, 217, 333): "Long run cap: 25–30% of weekly volume; long-run absolute time <3.0–3.5 h for marathoners"
- **00a** (line 752): also "Single long run should not exceed 110% of the longest run in the prior 30 days" (the BJSM 2025 spike rule)
- **04** (line 84): "Base long run | 90 min – 2:30; up to 22 mi for marathoners"
- These three rules can collide for a 60-mpw marathoner targeting a 22-mi long run (37% of weekly). The 25–30% cap is a guideline, not a hard rule, but the coaching engine needs a tiebreaker: prefer the **110% spike rule** as the absolute gate, treat 25–30% as a plan-design heuristic.

---

## Terminology inconsistencies

### "Threshold" vs. "tempo" vs. "LT2"
- **00a** uses LT1/LT2 + Z1/Z2/Z3 framing (3-zone Norwegian school).
- **01** and **04** use Daniels' E/M/T/I/R.
- **03** mixes %HRmax 5- and 7-zone systems.
- **08** uses "marathon pace / threshold / VO2max" prose.
- Same physiology, four naming conventions. **No single doc maps them all together.** Recommend a `GLOSSARY.md` that includes a 1-page conversion matrix (LT1/LT2 ↔ Daniels E-M-T-I-R ↔ Pfitz GA/EN/MP/LT/VO2 ↔ %HRmax/%LTHR/%HRR ↔ RPE).

### "Recovery run" vs. "easy run"
- **00b** (line 64) draws a sharp distinction (different effort, different duration cap, different stimulus).
- **00a** (lines 230–246) treats recovery and easy as separate categories but the pace-bands overlap (60–70% vs. 65–75% HRmax).
- **04** (lines 27, 43) distinguishes them but defines recovery as "easier than easy."
- The distinction is real but inconsistently anchored. Pin recovery as ≤70% HRmax and ≤45 min duration cap.

### "B-race" definition
- **00b** (line 215): B-race = "Hard but not depleted; 1-week taper; 7–10 days taper before; 60–70% of A-race recovery duration."
- **22** (`22-plan-templates.md`, line 503): "B race | 1-week taper, partial recovery."
- Consistent, but **08** doesn't reuse this taxonomy when discussing pacing for B races. Standardize the A/B/C framing across 08, 22, and 00b.

### "Super shoe" vs. "carbon-plated shoe"
- Used interchangeably in 00a, 00b, 17. No inconsistency, but worth a one-line note in GLOSSARY.

### Cadence units
- All docs use "spm" (steps per minute). 16 explicitly defines step vs. stride (line 109). No issue, just confirm coaching engine never confuses spm with stride frequency (half).

---

## Numerical inconsistencies

### Sodium per hour in heat
- **06** (`06-weather-adjustments.md`, line 518): "300–700 mg Na+/hr; up to 1,000 mg/hr for salty sweaters"
- **08** (line 523): "cool 300–500 mg/h; hot/humid 500–800 mg/h; salty sweaters up to 1000 mg/h"
- **18** (line 224): "Add 250–500 mg sodium per hour above baseline in hot/humid conditions"; salty-sweater table tops out at "1200+ mg/hr"
- **19** (lines 165–176): "ACSM baseline 300–600 mg/hr"; example calc reaches 1,344 mg/hr replacement
- All four are defensible but the upper bound drifts from 1,000 → 1,200 → 1,344. Coach should anchor on **19** (which has the per-athlete sweat-test calculation) for personalized targets, and on **06/08** for default-in-heat values.

### Carb intake per hour for marathon
- **00a** (line 397): "60–90 g/h"
- **08** (line 515): "Marathon | 60-90 g/h"
- **18** (lines 17–19): "1–2.5 hr | 30–60 g/hr; 2.5–3 hr | 60–90 g/hr; >3 hr (trained gut) | 90–120 g/hr"
- Consistent. Note that 18's framing is by **duration** not race distance, which is the more useful framing — the coaching engine should follow 18.

### VO2max decline per decade
- **00a** (line 624): "5% per decade in trained masters; up to 10% per decade if training drops"
- **14** (`14-age-considerations.md`, lines 132, 191–193): "5–7% per decade in trained athletes vs. 10–12% per decade in sedentary"
- **14** is more granular (5% elite, 5–7% trained, 10–12% sedentary, up to 46% in reduced-training masters). 00a's tighter band is fine as a summary but should cite 14.

### Heat acclimation timeline
- **00a** (lines 542–565): 10–14 days; 7-day option ~70–80% benefit.
- **06** (lines 154–197): 10–14 days; 7-day option similar.
- Consistent. Good.

### Altitude living-altitude range
- **00a** (line 577): "2000–2500 m"
- **06** (line 344): "2,000–2,500 m (6,500–8,200 ft)"
- **11** (`11-course-specific-training.md`): consistent.
- Good.

### Treadmill incline correction
- **01** (`01-pace-zones-vdot.md`, lines 532–550): only doc that addresses this. 1% incline rule only applies at faster paces; "Each 1% adds ~3% metabolic cost relative to flat at the same belt speed."
- No conflict; the absence of cross-reference from 09 or 22 is a gap (see below).

---

## Coverage gaps

### 1. GLP-1 agonists and athletes
- Not mentioned anywhere in the corpus.
- Real coaching question: a recreational-athlete user on Ozempic/Wegovy/Mounjaro will have altered fueling tolerance, sweat dynamics, and resting metabolic rate. RESEARCH_TASKS.md doesn't request it, but it's a foreseeable user question in 2026.
- **Recommended action:** add a short section to either 18 (fueling) or 13 (sex-specific is the wrong place but the closest fit), or spawn a new mini-doc.

### 2. Heat acclimation decay
- **00a** mentions "Plasma volume reverts in 1–2 wk without exposure" (line 565).
- **06** has the acclimation timeline but doesn't tabulate decay.
- The coach needs a decay table for users who acclimate, then stop. Currently spread thin.

### 3. Pregnancy + iron status interaction
- **13** covers pregnancy (§3) and iron deficiency (§8) separately but doesn't merge them. Postpartum iron is a known issue; coach will get questions.

### 4. Resistance-trained masters athletes returning to running
- **14** has "returning to running at older ages" (line 319) and **22** has "Comeback Plans" (line 626).
- Neither addresses the user who has been lifting heavily but not running for years — fitness baseline is unusual (high strength, low aerobic). Coach defaults will under-prescribe.

### 5. Concurrent training during a marathon block
- **07** (`07-strength-programming.md`, lines 508–518) covers the interference effect generically.
- **00a** has a strength section.
- Neither walks through "what does a marathon training week with 2 strength days actually look like?" The week-by-week plans in 22 omit strength sessions entirely. **This is a real coverage gap.** A user importing a 22 plan and a 07 strength program will have no guidance on how to combine them in a single week.

### 6. Running while sick (URTI, COVID, vaccination)
- **00b** mentions "spotting illness early" and **15** has an "illness early" section.
- Neither says "you have a head cold — should you run?" There's no return-to-run protocol for illness analogous to the injury protocols in 05.

### 7. Mental health beyond performance psychology
- **20** (`20-mental-training.md`) covers race-day arousal, post-race blues, and DNF decisions.
- ED screening sits in **13** (§13).
- Anxiety/depression as ongoing comorbidities are not covered. Probably out of scope, but flag for future expansion.

### 8. Treadmill-specific training
- **01** has the conversion table.
- **22** plan templates assume outdoor running with no treadmill substitution guidance.
- **09** (cross-training) doesn't list the treadmill as a separate modality (it's just "indoor running").
- A user training through winter on a treadmill needs better integration. Currently the coach will fall through.

### 9. Race-day shoe break-in conflict with no-new-things rule
- **17** (line break-in section): super shoes "always run at least 5–15 mi before race day."
- **08** (race-week): "nothing new on race day."
- These align in spirit but no doc gives a clean rule for "you bought your race shoes 4 days ago."

### 10. Multi-day stage racing / ultras with day-by-day recovery
- **22** lists ultra plans (50K–100mi) but assumes single-day events.
- **00b** covers post-race recovery for ultra but not within-event between-stage recovery.
- Not in RESEARCH_TASKS scope, but a foreseeable user question.

---

## Aggregated weak-evidence areas

The coaching engine should hedge in these areas. Each is a weak-evidence flag drawn from the docs themselves.

| Topic | Doc | Why hedge |
|---|---|---|
| ACWR as injury predictor | 15 (line 222), 00a | Impellizzeri/Tenan critiques; mathematical artefact concerns; meta-analyses show variable predictive power. Treat as directional only. |
| 220-age formula for HRmax | 03 | Tanaka/Gellish materially better; 220-age has ±10–12 bpm SD. Never default to 220-age. |
| Wrist-optical HR for intervals | 03 (line 522), 15 (line 407) | "Frequently 20–40 bpm off" at high intensity. Unreliable for VO2max and threshold sessions. |
| Yasso 800s as marathon predictor | 04 (line 319), 02 | "Overpredicts for slower marathoners and underpredicts for faster ones." VDOT is more accurate. Treat Yasso as a workout, not a predictor. |
| Riegel for marathon from short race | 02 (line 46, 157) | Vickers & Vertosick 2016: at least 10 min too fast for half of runners extrapolating from HM. |
| Stability vs. neutral shoe pronation theory | 17 (line 155) | Knapik military RCTs found no benefit to arch-based prescription. Pronation-based shoe selection is largely debunked. |
| Foot strike pattern as injury/economy predictor | 16 (line 186, 208), 00a | "Footstrike pattern alone does not predict economy or injury." Single small Harvard XC study sometimes overgeneralized. |
| 180 spm cadence target | 00a (line 528), 16 (lines 44–98), 21 | Daniels' original observation was at race pace among elites. Translation to all-pace, all-runner target is unsupported. Use **+5–10% relative shift**, never absolute 180. |
| Menstrual cycle phase-based periodization | 00a (line 663), 13 (§1) | "Current best evidence shows no advantage to phase-based periodization vs. standard programming." Track individually if symptoms are consistent. |
| Static stretching pre-run for injury prevention | 10 | Performance impairment is real for short post-stretch windows; injury-prevention claim is weak. |
| Sauna's recovery effect (vs. its adaptation effect) | 00b (line 514) | "Recovery effect itself is modest; performance adaptation is the main benefit." Don't sell sauna as a recovery tool. |
| Cryotherapy chambers | 00a, 00b (line 560) | Weaker evidence than CWI for recovery; mostly perceptual. |
| Foam rolling for performance | 00a (line 458), 10 | Mobility +, performance =. |
| Manual massage for performance | 00a (line 455) | Perceptual, not performance. |
| Sleep stage data from wearables | 15 (lines 125–157) | "Accuracy limitations." Total sleep time and consistency are useful; specific REM/deep stage breakdowns are noise. |
| HRV daily fluctuation | 15 (line 101), 00b | Single-day readings noisy. Trend (7-day rolling) is the only reliable signal. |
| Recovery-score readiness from Whoop/Oura | 15 (lines 228–254) | Brand-specific algorithms are opaque and not validated against running performance. Use as one input. |
| GAP across grades >±15% | 01 (line 389) | Minetti equation validated −20% to +20%; extrapolation to steep trail (Vert > 1500 m / race) is uncalibrated. |
| Carb intake of 90–120 g/h without gut training | 18 (line 23, lines 415–449) | Requires Costa-style 2-week protocol. Untrained gut at this rate causes GI distress in most runners. |
| Cold plunge for adaptive sessions | 00a (line 466), 00b (line 132) | "May blunt some adaptive signaling (e.g., hypertrophy response)." Avoid routinely after key adaptive sessions. |
| Drink-to-thirst vs. structured hydration | 19 (lines 51–67) | Genuine equipoise. Coach should match approach to athlete profile (slow runners → thirst-led; high-sweat-rate → structured). |
| Altitude responder/non-responder split | 00a (line 583), 11 | "Substantial individual response; some athletes are non-responders." Don't promise altitude gains. |
| Triad vs. RED-S framework | 13 (§7) | "Academic disagreement persists." Operationally identical for coaches; just don't get tangled in the terminology. |

---

## Cross-reference targets that don't exist (or could be tightened)

- **18** (line 30) says "Cross-reference Task 0A for full hourly targets by event distance." 0A does have this; OK. But 18 itself duplicates a different version of the table. Reconcile or pick one as canonical.
- **18** (line 502) refs "Task 19 for full sweat-rate testing." 19 has it. OK.
- **16** (lines 3, 291, 421) refs Task 21 for drills. 21 exists. OK.
- **14** (line 95, 302) refs Task 13 for RED-S / menopause. 13 covers this. OK.
- **09** (line 345) refs Task 7. OK.
- **22** (line 3) refs "doc 01" for paces. OK.
- **08** (line 690) refs Task 12. OK.
- **08** (line 823) refs `docs/coaching-research.md` (sections 7, 8, 9, 14). **This file is not part of the 24-doc knowledge base.** It's a stale reference to an older runtime doc. Either remove or rewrite to point at the actual KB doc numbers.
- **No doc cross-references the upcoming `INDEX.md`, `GLOSSARY.md`, or `SOURCES.md` files** that RESEARCH_TASKS.md (line 947) requires. Those three meta-files don't yet exist; the cross-references should be added once they're created.
- Many docs use the phrase "see Task X" but the docs are filenamed `NN-slug.md`, not `taskNN.md`. This is fine for humans but the coaching engine should normalize "Task 13" → `13-sex-specific-training.md`.

---

## Areas that will need future updates

| Topic | Why fast-moving | Approximate horizon |
|---|---|---|
| Super shoes | New plate geometry, foam blends, stack rules every season. World Athletics revised the 40 mm stack rule recently; further changes likely. Lifespan estimates are based on 1st-gen Vaporfly and may not generalize to 2026+ models. | 6–12 months |
| Norwegian double-threshold method | Rapidly evolving research base; Bakken / Ingebrigtsen-camp updates regularly. The 2.0–3.5 mmol/L cap is current consensus but Marius Bakken's site updates often. | 6–12 months |
| GLP-1 agonists in athletes | Not in corpus. Will become a coach question. Expect peer-reviewed performance/recovery data 2026–2027. | 12–24 months |
| HRV norms and wearable algorithms | Garmin, Whoop, Oura update algorithms quarterly; published norms lag. Confidence intervals stated in 15 may shift. | Ongoing |
| ACWR replacement metrics | Active research into alternatives (relative training stress balance, exponentially weighted models). The "sweet spot" framing may be deprecated within 2 years. | 12–24 months |
| Menstrual cycle research (especially elite/training-load interaction) | A handful of new studies per year; current "no group-level effect" consensus is fragile. | 12 months |
| Postpartum return-to-run protocols | RED-S / pelvic-floor literature growing rapidly. Doc 13 §4 will likely need updates. | 12–18 months |
| Carbon-plated trail / ultra shoes | New category; current super-shoe research is mostly road. | 12–24 months |
| AI/wearable coaching algorithms | Garmin Coach, Apple Watch coaching, Whoop AI features change quarterly. Doc 15's listed "recovery scores" may be out of date within months. | 3–6 months |
| Heat-acclimation passive protocols (sauna, hot tub, hot water immersion) | Active research; current 7-vs-14 day curves likely to be refined. | 12–24 months |
| Nicotine, ketones, sodium bicarbonate timing | Edge ergogenic literature. Doc 18's stack section will need updates. | 12 months |
| RED-S diagnostic criteria | IOC consensus revised every ~5 years; 2023 is current. | 24+ months |
| Footwear stack height / racing legality | World Athletics rules in flux. Doc 17's regulations will need check-in each season. | 6 months |

---

## Style and formatting variations across docs

These are not problems for human readers but the coaching engine's parser will hit edge cases.

### Header numbering
- Most docs use unnumbered `## Section Name`.
- **02, 04, 08, 13, 16, 21** number their H2s (`## 1. Foo`, `## 2. Bar`).
- **06** uses `## Section 1 — Foo`.
- Inconsistent. The parser should be tolerant; the coaching engine should not depend on header numbering.

### Glossary placement
- **00a, 00b, 04, 06, 09, 10, 11, 12, 14, 15, 19, 21** open with a `## Definitions` or `## Glossary` table.
- **01** opens with prose-style `## Core terms`.
- **08, 13** put the glossary later (or in §1).
- **17, 18, 20, 22** have no top-of-doc glossary.
- Recommend adding a glossary to 17, 18, 20, 22 for parser consistency.

### Citation style
- Most docs end with `## Sources` and a flat list of links + journal references.
- **05** (injury) is the most thorough — full citations with year, journal, DOI/URL.
- **22** has only a short sources block.
- **17** has the longest sources list, but mixes peer-reviewed (PubMed) with retailer blogs (Fleet Feet, REI) without distinguishing.
- Recommend a tag like `[evidence: peer-reviewed | coaching-authority | manufacturer | blog]` per source. Easier for the coach to weight.

### Cross-reference convention
- Some docs say "see Task 7" (using the RESEARCH_TASKS.md numbering).
- Some say "see doc 01."
- Some say "Cross-reference Task X."
- One (08) refs an external file (`docs/coaching-research.md`) that isn't part of this corpus.
- Standardize on "see doc NN" or "see `NN-slug.md`" once INDEX.md exists.

### Pace notation
- **04** uses Daniels shorthand (E, M, T, I, R) heavily.
- **22** uses Daniels shorthand for plan zones.
- **08** uses prose ("marathon pace," "5K pace").
- **00a** uses %HRmax + RPE + pace-relative-to-MP.
- All defensible; coach should be able to translate. Glossary should map.

### Use of em-dashes vs. en-dashes vs. hyphens
- **00a, 00b, 13** use em-dash (—) heavily.
- **01, 02, 04** use en-dash (–) for ranges.
- **17, 22** mix.
- Cosmetic. Not a parser issue if regex is tolerant.

### "Generic" voice compliance
- The RESEARCH_TASKS spec required no "you" or runner-profile assumptions. Spot-check:
  - **00a**: Compliant. Generic throughout.
  - **08**: Mostly compliant; section 14 ("Pace Strategy Commitment") slips into second-person occasionally.
  - **20** (mental training): hard to write without "you" — has some lapses but stays mostly generic.
  - **17, 18**: occasional "you should" and "your shoe."
  - **21**: explicit "user has problem X" framing, which is fine.
  - **22**: very compliant; uses "the runner" / "the user."
- Worth a sweep, not a re-write. The coaching engine will personalize anyway.

### Word count vs. spec
- RESEARCH_TASKS.md gave per-task ranges. Spot-check a few:
  - **01** (target 4,000–5,500): ~6,000 words. Slightly long.
  - **04** (target 6,000–8,000): ~9,000+ words (longest doc). At/over upper bound.
  - **05** (target 5,000–7,000): ~9,000 words. Over.
  - **12** (target 2,500–3,500): ~3,500. On target.
- No doc is suspiciously short. Several are over-length, which is preferable to under-length.

---

## Recommended follow-ups for the maintainer

1. **Create the missing meta-files**: `INDEX.md`, `GLOSSARY.md`, `SOURCES.md` (RESEARCH_TASKS.md line 947 requires these, and they don't exist as of this review).
2. **Reconcile the carb-load range (8–12 vs. 10–12 g/kg)** in 00a vs. 08.
3. **Reconcile the super-shoe lifespan range** in 00a vs. 17 — adopt 17's numbers globally.
4. **Tighten the CWI temperature window** in 00a (5°C lower bound is cold-plunge, not the cited running-recovery literature).
5. **Add the strength + run weekly integration table** missing from both 07 and 22.
6. **Add a heat-acclimation decay table** to 06 or 00a.
7. **Add a "running while sick" protocol** to 00b or 05 (closest fit).
8. **Fix the stale `docs/coaching-research.md` reference** in 08 line 823.
9. **Add a treadmill-substitution section** to 09 or 22.
10. **Spawn a GLP-1 agonists mini-doc** when peer-reviewed athlete data emerges (12–24 months out).
11. **Quarterly check-in** on super-shoe regulations, Norwegian-method updates, and wearable-algorithm changes (the 3 fastest-moving areas in the corpus).
12. **Sweep "you" and personalized voice** in 08 §14, 17, 18, 20.
