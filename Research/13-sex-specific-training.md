# 13 — Sex-Specific Training Considerations

Generic reference doc on how training, screening, and risk profiles differ between female and male runners across the lifespan. Female-specific physiology has been historically under-researched and under-applied in coaching; this doc compiles what is established, what is contested, and what crosses sexes.

Definitions used throughout:
- **Female / male**: refers to biological sex (chromosomal/gonadal/hormonal). Training considerations track biology, not gender identity.
- **Eumenorrheic**: regular menstrual cycle of 21–35 days with ovulation.
- **Cycle phases** (28-day reference cycle): follicular (Day 1 to ovulation), ovulatory (≈ Day 12–16), luteal (ovulation to menses).
- **Estradiol (E2)**: dominant ovarian estrogen.
- **Progesterone (P4)**: dominant luteal-phase steroid.
- **LH / FSH**: pituitary luteinizing / follicle-stimulating hormones.
- **OCP**: oral contraceptive pill. **HC**: hormonal contraception (any).
- **RED-S**: Relative Energy Deficiency in Sport.
- **LEA**: Low Energy Availability (the upstream cause of RED-S).
- **EA (kcal/kg FFM/day)**: Energy Availability = (energy intake − exercise energy expenditure) / fat-free mass.

## 1. The Menstrual Cycle and Training

### 1.1 Phases (28-day reference)

| Phase | Days | E2 | P4 | Body temp | Notes |
|---|---|---|---|---|---|
| Early follicular | 1–5 | low | low | low | Menses; iron loss; "lowest hormone" state |
| Mid–late follicular | 6–12 | rising → peak | low | low | Estrogen-dominant |
| Ovulatory | ≈ 13–15 | peak then drop | rising | rising | LH surge; transient |
| Early luteal | 16–22 | secondary rise | peak | elevated +0.3–0.5 °C | High-hormone phase |
| Late luteal | 23–28 | falling | falling | still elevated | PMS window if symptomatic |

Cycle length varies (normal range 21–35 d); phase day-numbers above are anchors. Luteal length is most stable (~14 d); follicular length drives total cycle length.

### 1.2 Physiological Effects Relevant to Running

| System | Follicular (low hormone) | Luteal (high P4 ± E2) |
|---|---|---|
| Core temperature | Baseline | +0.3–0.5 °C; sweat threshold delayed |
| Plasma volume | Higher (relative) | Lower (P4 natriuretic effect) |
| Substrate use | More carb-favored | Slightly more fat oxidation; greater protein catabolism |
| Ventilation | Baseline | Mildly increased (P4 is a respiratory stimulant) |
| Connective tissue laxity | Rises with E2 peak | Lower than ovulatory |
| Iron loss | Heaviest at menses | None |

These differences are real and measurable. Whether they materially change *performance* is the contested part — see § 1.4.

### 1.3 Cycle-Tracking Methods

| Method | What it tracks | Phase resolution | Notes |
|---|---|---|---|
| Calendar / period app | Day count from menses | Coarse | Cheap; fine for regular cycles |
| Basal body temperature (BBT) | Wake-up temp | Confirms ovulation post-hoc | +0.3 °C sustained = luteal |
| LH urine strips | LH surge | Predicts ovulation 24–36 h ahead | Used by trying-to-conceive market; works for athletes |
| Cervical mucus | Estrogen rise | Mid-cycle | Subjective |
| Wearable HRV / resting HR | Indirect via P4 | Trends with phase | Signal often swamped by training/sleep noise |
| Continuous glucose / temp rings (Oura, Whoop) | Multi-signal | Decent for confirming ovulation | Algorithm-dependent |
| Serum hormones (E2, P4, LH) | Direct | Gold standard | Lab; cost-prohibitive for routine training |

Practical minimum for programming: log menses start date + symptoms (energy, sleep, RPE, GI, cramping). Research-grade phase ID uses BBT + LH strips + ovulation confirmation (Schmalenberger 2021).

### 1.4 Training Adaptations by Phase — Honest Equipoise

This is the area of greatest popular confidence and weakest evidence.

**McNulty 2020** (*Sports Medicine* — 78 studies, the canonical synthesis): exercise performance **might** be trivially reduced in early follicular vs other phases; quality of evidence is **low**, heterogeneity high, effect size small (SMD ≈ 0.06–0.15 — below within-day noise). The authors explicitly recommend **against** generic phase-based prescription.

Supporting reviews: Janse de Jonge 2003/2019 (methodological problems dominate); Elliott-Sale 2021 (~9 % of female-only studies use rigorous phase verification); Colenso-Semple 2023 (no phase-based difference in resistance-training adaptation).

Established (higher confidence):
- Luteal phase imposes a **thermal cost**: core temperature starts higher; performance in heat suffers, especially uncompensable heat.
- Luteal phase elevates submaximal HR ~3–5 bpm (P4-driven plasma volume drop).
- Late-luteal **PMS symptoms** (when present) reduce training quality — symptom-driven, not phase-deterministic.
- Menstrual symptoms reduce training quality in 50–70 % of athletes who menstruate (Bruinvels 2021); addressing symptoms matters more than phase-targeting.

Contested / not established:
- Larger follicular-phase strength gains (Reis 1995; replications failed; Colenso-Semple 2023 null).
- Cluster high-intensity in follicular phase — no high-quality generic evidence.
- Higher carb intake in luteal phase — rationale reasonable, performance evidence thin.

Practical decision rule:

```
if symptoms reduce training quality on a given day:
    adjust THAT day (lower intensity, swap session, reduce volume)
else:
    train the planned program; do not preemptively de-load by phase
```

Phase-based periodization is an **N=1 hypothesis to test individually**, not a generic prescription.

### 1.5 Symptom-Driven Adjustments

| Symptom | Evidence-based adjustment |
|---|---|
| Heavy menstrual bleeding (HMB) — soaking pad/tampon hourly, clots > 1 inch | Refer for ferritin + hemoglobin; gynecologic eval; do not "train through" |
| Dysmenorrhea (cramping) impairing sessions | NSAIDs (per medical guidance); easier session that day; not a programming constraint |
| Mid-cycle (Mittelschmerz) pain | Acknowledge; rarely affects training |
| PMS — mood, fatigue, GI | Reduce intensity if quality suffers; protect sleep; consider extra carb pre-session |
| Bloating in late luteal | Hydration; weigh-in noise — don't interpret as fat gain |

## 2. Hormonal Contraception and Performance

Three classes are used in athletes; effects differ.

### 2.1 Combined Oral Contraceptive (COC / OCP)

Synthetic estrogen (ethinyl estradiol, EE) + progestin; suppresses ovulation. Placebo-week withdrawal bleed is **not** a true menstrual cycle — endogenous E2 stays low across active-pill weeks.

| Performance variable | Effect | Confidence |
|---|---|---|
| VO2max | Small reduction (~4–5 %) on COC vs. eumenorrheic — Elliott-Sale 2020 meta-analysis | Moderate |
| Endurance performance | Trivial-to-small negative effect (~ −0.6 % time-trial) | Low–moderate |
| Strength | No clear effect | Moderate |
| Bone | EE doses ≥ 30 µg suppress IGF-1 and may attenuate bone accrual in young athletes (Hartard, Allaway) | Moderate |
| Iron | Reduced menstrual loss → ferritin higher | Established |
| Cycle predictability | High (28-day artificial) | Established |

The performance hit is small in absolute terms and overshadowed by training, sleep, nutrition. Choose COC on health grounds, not performance.

### 2.2 Progestin-Only Methods

Mini-pill (POP), etonogestrel implant (Nexplanon), DMPA injection, hormonal IUD (levonorgestrel — Mirena, Kyleena, Liletta).

- Bleeding patterns range from amenorrhea to irregular spotting; cycle is no longer phase-interpretable.
- **Hormonal IUDs**: localized progestin, low systemic absorption; ovulation often continues; performance effect probably negligible.
- **DMPA**: substantially reduces estradiol; measurable BMD loss; **avoid in athletes with bone-stress-injury risk** when alternatives exist.
- POPs / implants: thin performance literature; clinical signal neutral.

### 2.3 Copper IUD (Non-Hormonal)

Preserves natural cycle. May increase menstrual flow and dysmenorrhea — relevant for ferritin and training-quality screening.

### 2.4 Decision Frame

```
HC choice = clinical need (contraception, dysmenorrhea, HMB, endometriosis, acne)
            + side-effect tolerance
            + bone-density risk profile
            + athlete preference
            -- NOT performance optimization
```

## 3. Pregnancy and Running

### 3.1 ACSM / ACOG Guideline Summary

The ACOG Committee Opinion 804 (2020, reaffirmed 2022) and ACSM exercise-in-pregnancy guidance (Mottola 2018 Canadian Guideline; ACSM 2021 update) converge:

- **Default**: pregnant athletes without contraindications should accumulate ≥ 150 min/week moderate-intensity aerobic activity, with light-to-moderate strength training. Vigorous activity in previously trained athletes is acceptable when tolerated.
- The old **220 − age × 60–70 % HR cap** is obsolete. Use **RPE** (talk test, "somewhat hard" ceiling) and symptom-monitoring instead.

### 3.2 Absolute Contraindications (do not run)

- Hemodynamically significant heart disease
- Restrictive lung disease
- Incompetent cervix / cerclage
- Multiple gestation at risk for preterm labor
- Persistent 2nd/3rd-trimester bleeding
- Placenta previa after 26 weeks
- Premature labor in current pregnancy
- Ruptured membranes
- Pre-eclampsia / pregnancy-induced hypertension
- Severe anemia

### 3.3 Relative Contraindications (clinician sign-off)

Anemia, cardiac arrhythmia, chronic bronchitis, poorly controlled type 1 diabetes, extreme morbid obesity or underweight (BMI < 12), extremely sedentary baseline, intrauterine growth restriction, poorly controlled hypertension, orthopedic limitations, poorly controlled seizure disorder, poorly controlled hyperthyroidism, heavy smoker.

### 3.4 Trimester-by-Trimester Heuristics

| Trimester | Typical adjustments |
|---|---|
| 1 (0–13 wk) | Volume largely preserved if energy/nausea allow. Heat caution (especially first 6 wk; avoid hot yoga, hot environments — neural-tube risk if core temp > 39 °C). Fatigue and nausea drive de-loads more than physiology. |
| 2 (14–27 wk) | Most stable trimester. Volume often reduces 20–40 % spontaneously. Belt or support garment may help. Watch for **round ligament pain**, **pelvic girdle pain (PGP)**. Switch to elliptical/aqua/bike if running becomes painful. Avoid supine exercise > 5 min after ~20 wk (vena cava compression). |
| 3 (28–40 wk) | Many runners shift entirely to walking, swimming, cycling. Relaxin peaks; joint laxity is real. Pelvic floor pressure may force the change. RPE/talk test, hydration, and stopping criteria are paramount. |

### 3.5 Stop-Immediately Warning Signs (any trimester)

Vaginal bleeding, regular painful contractions, amniotic fluid leakage, dyspnea before exertion, dizziness, headache, chest pain, calf pain or swelling, muscle weakness affecting balance.

### 3.6 Generic Programming Notes

- Prefer softer surfaces (treadmill, trail) as belly grows.
- Drop intervals; preserve easy aerobic + light strength.
- Hydration target pale-yellow urine; session weight loss > 2 % body mass is excessive.
- Pelvic-floor physio is sensible prenatally, not just postpartum.
- Diastasis prevention: avoid loaded crunching; train deep-core / transverse abdominis and breath patterning.

## 4. Postpartum Return to Running

### 4.1 The Goom 2019 Framework

Goom, Donnelly & Brockwell (2019) is the most-cited clinical framework. Key positions:

- **Return to running is not recommended before 12 weeks postpartum.**
- The 6-week postnatal check is necessary but not sufficient.
- Postpartum pelvic-health physiotherapy assessment **prior** to return is recommended.

### 4.2 Clearance Self-Tests (Goom checklist; pass without symptoms)

| Test | Pass criterion |
|---|---|
| Walking 30 min | No pain, no leakage, no heaviness |
| Single-leg balance | 10 s each side |
| Single-leg squat | 10 reps each side |
| Jog on the spot | 1 minute |
| Forward bounds | 10 reps |
| Hop in place | 10 reps each side |
| Single-leg "running man" | 10 reps each side |

Plus strength benchmarks (single-leg calf raise ≥ 20 reps, single-leg bridge ≥ 20 reps, side plank ≥ 20 s, plank ≥ 20 s, squat / forward lunge / jump squat / step-up ≥ 20 reps each).

Stop signs during return: pelvic heaviness/dragging, urinary leakage, fecal incontinence, ongoing bleeding (lochia) past return, pelvic / SIJ / low-back pain, doming or coning of the abdomen.

### 4.3 Tissue Recovery Timeline (orientation only)

| Tissue | Approximate recovery |
|---|---|
| Uterus involution | 6–8 weeks |
| Lochia (bleeding) | 4–6 weeks |
| Diastasis rectus abdominis (DRA) closure | most resolve by 8 wk; ~ 30 % persist past 12 wk |
| Pelvic floor neuromuscular control | 4–6 months |
| C-section scar — full tensile load | 12 weeks minimum; many surgeons say longer |
| Breastfeeding hormonal milieu (lower E2, higher relaxin) | duration of lactation |
| Bone mineral density — breastfeeding loss | 3–7 % loss; recovers 6–12 mo post-wean |

### 4.4 Pelvic Floor and Diastasis Screening

- **Diastasis recti**: inter-rectus distance > 2 finger-widths at rest or doming on curl-up; persistent past 12 wk → physio.
- **Stress urinary incontinence**: leakage with cough/laugh/run. Common (~ 30 % of postpartum runners) but not normal and treatable.
- **Pelvic organ prolapse**: dragging, bulging, pressure → refer immediately.
- **Pelvic girdle pain**: SIJ / pubic symphysis pain; persistent > 3 months → physio.

### 4.5 Return-to-Running Progression (generic template)

```
Wk 0–6:   Walking, breathing/core re-education, pelvic floor Kegels.
Wk 6–10:  Increased walking volume; basic strength (bridges, squats, calf raises).
Wk 10–12: Pelvic-floor physio check. Goom self-tests.
Wk 12+:   Walk-jog ratios (e.g. 1 min jog : 2 min walk × 6) if all clearances pass.
          +1 min jog block / week; cap weekly mileage at < pre-pregnancy.
Wk 16–20: Continuous easy running 20–30 min.
Wk 20–26: Return of strides; no quality work yet.
Wk 26+:   Reintroduce structured intensity if asymptomatic.
```

C-section, complicated delivery, perineal tearing > grade 2, prolapse, or persistent DRA push the timeline back.

## 5. Perimenopause and Menopause

Definitions (Stages of Reproductive Aging Workshop, STRAW + 10):
- **Perimenopause**: from first cycle-length variability of ≥ 7 days to 12 months after final menstrual period; typically mid-40s to early 50s; lasts 4–8 years.
- **Menopause**: 12 consecutive months of amenorrhea, average age ~51.
- **Postmenopause**: thereafter.

### 5.1 Physiological Shifts

| System | Change |
|---|---|
| Estradiol | Declines, becomes erratic in peri, low after meno |
| Bone | Accelerated loss in late peri / early post-meno (~ 1–3 %/yr for ~5 yr) |
| Body composition | Visceral fat ↑; lean mass ↓ (sarcopenia accelerates) |
| Connective tissue | Tendon/ligament repair slows; tendinopathy risk ↑ |
| Thermoregulation | Vasomotor symptoms; altered sweat thresholds |
| Sleep | Fragmented; affects recovery |
| Recovery | Inter-session recovery lengthens |

### 5.2 Training Adjustments

- **Heavy strength training**, 2–3 × /week (load, not bodyweight) — best-supported intervention for bone, lean mass, tendon.
- **Plyometrics / jump training**: 2 × /week, low volume, high intent.
- **Protein** 1.6–2.0 g/kg/day, distributed across meals (anabolic resistance).
- **Heat tolerance** declines; vasomotor flushes disrupt sessions — hydration and cooling matter more.
- HRV / RHR baselines shift; recalibrate.
- **Recovery extension**: cross-train an easy day; add full rest if markers regress.
- **MHT (menopausal hormone therapy)**: clinical decision; maintains BMD; athlete performance evidence sparse.

## 6. RED-S — Relative Energy Deficiency in Sport

### 6.1 Concept

RED-S is the syndrome arising from **Low Energy Availability (LEA)** — chronic mismatch between energy intake and exercise expenditure relative to FFM. It is systemic (not just menstrual / bone). The IOC consensus (Mountjoy 2014, 2018, 2023) replaced and broadened the older "Female Athlete Triad" model.

### 6.2 Energy Availability Thresholds (research-based, applied with caution)

```
EA (kcal/kg FFM/day) = (energy intake − exercise energy expenditure) / fat-free mass
```

| EA | Status |
|---|---|
| ≥ 45 | Energy availability adequate; optimal physiology |
| 30–45 | Subclinical LEA; metabolic adaptations possible |
| < 30 | Clinical LEA threshold; increased RED-S risk |

Thresholds derive from short-term lab studies in young eumenorrheic women (Loucks). Real-world precision is poor — **trends and clinical signs trump the calculation.**

### 6.3 Affected Systems (IOC 2023)

Menstrual function, bone health, endocrine, metabolic, hematological, growth/development, psychological, cardiovascular, gastrointestinal, immunological, and **performance** (decreased endurance, training response, judgment, coordination, concentration, irritability, depression).

### 6.4 IOC 2023 Update — What Changed

- Clarifies RED-S occurs in **both sexes**.
- Introduces severity / risk stratification (low / moderate / high / very high; red/yellow/green return-to-sport categories).
- Distinguishes **adaptable vs. problematic LEA**: brief mild EA reductions (taper, race week) ≠ RED-S.
- Strengthens male-athlete evidence base.
- Integrates mental-health and disordered-eating screening.

### 6.5 Screening Tools

| Tool | Use | Notes |
|---|---|---|
| LEAF-Q (Low Energy Availability in Females Questionnaire) | Female-specific RED-S screen | Score ≥ 8 indicates risk |
| EDE-Q (Eating Disorder Examination Questionnaire) | DE/ED screen | Validated; clinical |
| SCOFF | Quick ED screen (5 items) | Score ≥ 2 of 5 = referral |
| Brief ED in Athletes Questionnaire (BEDA-Q) | Athletic population | |
| RED-S CAT2 (IOC 2023) | Clinical assessment / return-to-play | Practitioner tool |
| Triad Cumulative Risk Assessment (Female Athlete Triad Coalition) | Triad-specific | Pre-IOC framework, still in use |

### 6.6 Red-Flag Signs (refer)

- Amenorrhea > 3 months or oligomenorrhea (cycles > 35 d) without clear cause
- Stress fracture, especially at low-load site (sacrum, femoral neck, pubic ramus)
- ≥ 2 stress reactions in 12 months
- Resting HR < 40 bpm (untrained baseline) with fatigue/cold intolerance
- Body weight loss > 5 % unexplained
- BMI < 17.5 in adult athlete
- Cold hands/feet, hair loss, lanugo, dry skin, GI dysfunction
- Disordered-eating screen positive
- Iron deficiency unresponsive to repletion
- Recurrent illness, slow wound healing, prolonged DOMS

### 6.7 Return-to-Training Frame

```
Treatment: increase EA → first by reducing exercise expenditure
                       and/or increasing intake.
Timeline:  menstrual recovery typically 3–12 months after EA correction.
           Bone density recovery is slower; may be incomplete.
Care team: physician, sports dietitian, mental-health professional, coach.
```

## 7. Female Athlete Triad — Historical Context

The Female Athlete Triad (Yeager 1993; ACSM 1997, 2007) defined a triangle of (1) disordered eating / LEA, (2) menstrual dysfunction, (3) low BMD. This was the dominant framework for ~20 years. RED-S (IOC 2014) **subsumed and broadened** it: same etiology (LEA) but recognizes systemic effects beyond bone/menses and applies to males. Both terms remain in use; the Female and Male Athlete Triad Coalition preserves the original triangle for adolescent and female-specific contexts. Academic disagreement persists between groups; operationally, the implication for coaches is identical — screen for LEA early.

## 8. Iron Deficiency in Female Runners

### 8.1 Why It's Common

Menstrual blood loss + foot-strike hemolysis + sweat losses + GI micro-bleeds + training-induced hepcidin spikes all push iron negative. Vegetarian/vegan diets common in distance running compound the risk. **Up to 30–60 %** of female endurance athletes have iron deficiency at some point; iron-deficiency anemia in ~ 15–35 % (Bruinvels et al.).

### 8.2 Screening — Ferritin Thresholds

There is no single agreed cutoff. Working categories used in sports medicine:

| Ferritin (ng/mL) | Stage | Action |
|---|---|---|
| > 50 (some say > 35) | Replete | Maintain |
| 30–50 | Iron-deficient non-anemic Stage I (storage depletion) | Dietary; recheck |
| 20–30 | Stage II (transport iron falling; sTfR rising) | Dietary + likely supplementation |
| < 20 (with symptoms) or < 12 | Iron-deficiency anemia possible | Confirm with full panel; treat |

Always order: ferritin, hemoglobin, hematocrit, MCV, transferrin saturation, soluble transferrin receptor (sTfR), and **CRP** (ferritin is an acute-phase reactant — interpret upward in inflammation).

Some sport scientists argue performance is impaired below ~ 35–40 ng/mL even without anemia (Pasricha 2014; Burden 2015 meta-analysis showed performance benefit of iron treatment in non-anemic deficient athletes).

### 8.3 Treatment Frame (clinician-led)

- **Oral iron** 60–200 mg elemental, **alternate days** (Stoffel 2017 — better absorption, less GI than daily). Take with vitamin C; avoid coffee, tea, calcium, dairy within 1 h.
- Recheck ferritin at 8–12 weeks.
- **IV iron** for oral failure, GI intolerance, or rapid repletion (clinician decision).
- Maintenance dosing during high-training periods is common after repletion.

### 8.4 Male Iron

Men can also become iron-deficient (especially high-mileage, vegetarian, or with GI bleeding). Less common but **not screened often enough**. Test if symptoms or unexplained performance regression.

## 9. Bone Density Considerations

### 9.1 Why Female Runners Are Higher-Risk

Lower peak bone mass than males (~ 10–15 %); estrogen withdrawal during amenorrhea drives high-turnover loss; endurance-only training is weakly osteogenic (modest lower-limb stimulus, minimal spine/hip); LEA suppresses bone formation via low IGF-1, low T3, high cortisol.

### 9.2 DEXA — When to Order

| Situation | Recommendation |
|---|---|
| ≥ 1 high-risk stress fracture (sacrum, femoral neck, pelvis, anterior tibia) | DEXA |
| ≥ 2 low-risk stress fractures in 12 months | DEXA |
| Amenorrhea > 6 months | DEXA |
| Adolescent/adult with high RED-S risk | DEXA |
| Postmenopausal female athlete with low body weight, prior fracture, or family hx | DEXA per general guidelines |

Z-score interpretation in athletes (Triad Coalition):
- Z ≤ −1.0 in weight-bearing athlete = **low BMD for athlete** (not normal — athletes should be **above** general-population norms because of mechanical loading)
- Z ≤ −2.0 = **osteoporosis** in young athlete

### 9.3 Calcium and Vitamin D

- Calcium: 1000–1500 mg/day (athletes with LEA / amenorrhea: 1500 mg/day per ACSM)
- Vitamin D: target 25-OH-vitamin D **30–50 ng/mL** (75–125 nmol/L); supplement 1000–2000 IU/day if low
- Sunlight, fortified foods, fatty fish; serum testing recommended in northern latitudes

### 9.4 Mechanical Loading

Bone responds to **novel, high-magnitude, multi-directional, dynamic** loads. For a running-only athlete, adding heavy resistance training (≥ 80 % 1RM) and plyometric loading (2 × /week, 50–100 ground contacts, varied directions) is the strongest non-pharmacologic stimulus. This applies particularly to spine and hip BMD.

## 10. Strength Training for Female Runners

### 10.1 Bottom Line

The adaptive response to resistance training is **not meaningfully sex-different** at matched relative intensity (Roberts 2020; Colenso-Semple 2023). Programming principles transfer directly. The *case* for strength training is stronger for female runners because of lower baseline absolute strength, higher rates at certain injury sites (ACL, stress fracture, patellofemoral pain), greater per-session bone-density benefit, and perimenopausal sarcopenia protection.

### 10.2 Programming Defaults

| Variable | Default for runners |
|---|---|
| Frequency | 2 × /week year-round |
| Format | Compound bilateral + unilateral; lower body emphasis |
| Load | Build to 75–90 % 1RM for top sets; 3–6 reps |
| Volume | 2–4 working sets per exercise |
| Plyometrics | 2 × /week, 50–100 contacts, vary directions |
| In-season | Maintain (1 × /week heavy); never drop entirely |

Common myths to dispel: "lifting heavy will make me bulky" (hypertrophy at endurance training volumes is small); "do high reps with light weight" (insufficient stimulus for bone, tendon, neural strength).

## 11. Male-Specific Considerations

### 11.1 Testosterone

- Healthy male reference: ~ 300–1000 ng/dL (assay-dependent).
- Distance training does **not** chronically suppress testosterone in well-fueled athletes.
- High-volume training with LEA can produce **exercise-hypogonadal male condition** (EHMC; Hackney): low testosterone, low LH, low libido, fatigue. Screen with morning total T, free T, LH, FSH, SHBG, prolactin.
- Distinguish EHMC from age-related decline (~ 1 %/yr after 30) and other causes (medications, primary hypogonadism, pituitary disease).

### 11.2 RED-S in Male Endurance Athletes

IOC 2023 strengthens the male evidence base. Markers in males: reduced morning total / free testosterone; reduced libido or ED; reduced BMD; stress-fracture history; cold intolerance with low RHR and fatigue; reduced performance and training response. Body-composition culture in elite male distance running drives under-fueling more than is openly acknowledged; screening male athletes for RED-S/LEA is a default.

### 11.3 Overtraining Markers (Male, Generic)

Sustained fatigue + ≥ 2 of:
- Resting morning HR drift > 5 bpm above baseline for ≥ 5 days
- HRV regression
- Performance decline of ≥ 5 % in standardized session
- Sleep disturbance
- Mood disturbance (POMS, BRUMS)
- Resting cortisol elevated, T:C ratio depressed
- Low morning testosterone (males)
- Recurrent minor illness

### 11.4 Masters Male Considerations

- **Testosterone decline** is gradual; symptomatic hypogonadism warrants endocrine workup, not assumed normal.
- **Prostate / BPH**: urinary frequency increases with age; long runs and dehydration aggravate. PSA screening is a shared-decision conversation with primary care.
- **Cardiovascular**: standard risk-factor screen; CAC scoring is increasingly used in masters athletes. Atrial fibrillation prevalence is elevated in long-term high-volume endurance males (Andersen 2013) — refer to cardiology if symptomatic.
- **Tendinopathy / stiffness**: longer warm-ups, more strength work, more recovery between hard sessions.

## 12. Body Composition and Performance

This is a high-risk topic. Be careful.

### 12.1 What's Established

- At elite distance-running level, leaner athletes are on average faster — a population correlation, not a per-athlete causal lever.
- **Forced or rapid leaning** typically reduces performance and frequently triggers LEA / RED-S.
- Training, technique, durability, and consistency dominate body composition as performance variables.
- Adolescent athletes should not be subjected to body-composition manipulation; growth and bone accrual are the priorities.

### 12.2 Cultural Pressures

Endurance-running culture (female and elite male alike) carries documented body-image pressure. Coach behaviors that matter: don't routinely weigh athletes; don't publicly discuss weight, body fat, or appearance; frame fueling around training quality, not body shape; refer body-composition concerns to a sports dietitian.

### 12.3 Generic Frame

```
Performance ← consistent training ← durability ← adequate fueling ← psychological safety
```

If body composition becomes the lever, the chain has already broken upstream.

## 13. Eating Disorder and Anorexia Athletica Screening

### 13.1 Definitions

- **Anorexia nervosa (AN)**: DSM-5; restrictive eating, body-image distortion, fear of weight gain, low body weight.
- **Bulimia nervosa (BN)**: binge-purge cycle.
- **Anorexia athletica** (Sundgot-Borgen 1994): subclinical sport-specific pattern — restrictive intake, exercise compulsion, performance-driven, may not meet AN criteria but is functionally pathological. Used clinically; not a DSM diagnosis.
- **OSFED / atypical AN**: DSM-5 categories that capture athletes with AN-like symptoms at non-low BMI (common in athletes — leanness can mask disease).

### 13.2 Prevalence

In endurance and lean-sport athletes, point prevalence of disordered eating runs **20–45 % female / 10–25 % male**, several-fold higher than the general population (Sundgot-Borgen, Bratland-Sanda).

### 13.3 Screening

| Tool | Notes |
|---|---|
| SCOFF (5 items) | Quick; ≥ 2 = positive |
| BEDA-Q | Athletes |
| EDE-Q | Validated, longer |
| LEAF-Q | RED-S–specific |
| Clinical interview | Gold standard |

### 13.4 Coach Behaviors

Don't diagnose. Do screen. Refer. The coach is rarely the right primary intervener — the multidisciplinary team is. Complete removal from sport can be counter-therapeutic and is a clinician decision. Document concerns and conversations.

### 13.5 Refer-Now Triggers

Suicidal ideation, self-harm, syncope, electrolyte abnormality, bradycardia + hypotension, rapid weight loss, food rituals dominating life, secrecy / isolation, exercise compulsion overriding injury or illness.

## 14. Generic Principles That Apply to All Sexes

1. **Fuel the work**. Energy availability is foundational across sex, age, and event.
2. **Sleep is non-negotiable**. 7–9 hours; consistency > duration.
3. **Strength train**. Year-round, 2 × /week, real loads.
4. **Periodize recovery, not just stress**. Build → recover cycles work for everyone.
5. **Screen iron, vitamin D, and (when indicated) hormones**. Don't guess.
6. **Listen to symptom data**. Phase, age, trimester — symptoms beat algorithms.
7. **Mental health is performance health**. Same screening priority as physical.
8. **Refer early**. Most red-flag patterns are reversible if caught early; advanced RED-S, advanced bone loss, and advanced ED are not.

## 15. When to Refer — Quick Reference

| Pattern | Refer to |
|---|---|
| Heavy menstrual bleeding, severe dysmenorrhea | Gynecology |
| Amenorrhea > 3 months not on HC | Sports physician + gynecology + dietitian |
| Stress fracture | Sports medicine + DEXA per § 9.2 |
| Suspected RED-S / LEA | Sports physician + sports dietitian + mental health |
| Disordered eating screen positive | Mental health (ED-experienced) + dietitian |
| Iron deficiency / low ferritin | Sports physician / primary care |
| Pregnancy with running questions | OB/GYN + pelvic-floor physio |
| Postpartum return clearance | Pelvic-floor physiotherapist |
| Pelvic floor symptoms (leakage, prolapse, pain) | Pelvic-floor physiotherapist |
| Perimenopausal symptoms affecting training | Primary care + menopause-specialist physician |
| Suspected EHMC / low T in male endurance athlete | Sports endocrinology |
| Cardiovascular symptoms in masters athlete | Sports cardiology |

## Sources

### Menstrual cycle and performance
- McNulty KL, Elliott-Sale KJ, Dolan E, et al. The effects of menstrual cycle phase on exercise performance in eumenorrheic women: a systematic review and meta-analysis. *Sports Medicine* 2020;50(10):1813–1827.
- Janse de Jonge XAK. Effects of the menstrual cycle on exercise performance. *Sports Medicine* 2003;33(11):833–851.
- Janse de Jonge X, Thompson B, Han A. Methodological recommendations for menstrual cycle research in sports and exercise. *Med Sci Sports Exerc* 2019;51(12):2610–2617.
- Elliott-Sale KJ, Minahan CL, de Jonge XAKJ, et al. Methodological considerations for studies in sport and exercise science with women as participants. *Sports Medicine* 2021;51(5):843–861.
- Colenso-Semple LM, D'Souza AC, Elliott-Sale KJ, Phillips SM. Current evidence shows no influence of women's menstrual cycle phase on acute strength performance or adaptations to resistance exercise training. *Front Sports Act Living* 2023;5:1054542.
- Schmalenberger KM, Tauseef HA, Barone JC, et al. How to study the menstrual cycle: practical tools and recommendations. *Psychoneuroendocrinology* 2021;123:104895.
- Stachenfeld NS. Sex hormone effects on body fluid regulation. *Exerc Sport Sci Rev* 2008;36(3):152–159.
- Bruinvels G, Goldsmith E, Blagrove R, et al. Prevalence and frequency of menstrual cycle symptoms... *Br J Sports Med* 2021;55(8):438–443.

### Hormonal contraception
- Elliott-Sale KJ, McNulty KL, Ansdell P, et al. The effects of oral contraceptives on exercise performance in women: systematic review and meta-analysis. *Sports Medicine* 2020;50(10):1785–1812.
- Hartard M, Kleinmond C, Wiseman M, et al. Detrimental effect of oral contraceptives on parameters of bone mass and geometry in adolescent gymnasts. *Bone* 2007;40(2):444–450.
- Allaway HCM, Misra M, Southmayd EA, et al. Are the effects of oral and vaginal contraceptives on bone formation in young women mediated via the growth hormone–IGF-I axis? *Front Endocrinol* 2020;11:334.

### Pregnancy and postpartum
- ACOG Committee Opinion 804. Physical activity and exercise during pregnancy and the postpartum period. *Obstet Gynecol* 2020;135(4):e178–e188 (reaffirmed 2022).
- Mottola MF, Davenport MH, Ruchat SM, et al. 2019 Canadian guideline for physical activity throughout pregnancy. *Br J Sports Med* 2018;52(21):1339–1346.
- Davenport MH, Ruchat SM, Mottola MF, et al. 2019 Canadian guideline for physical activity throughout pregnancy: methodology. *J Obstet Gynaecol Can* 2018;40(11):1468–1481.
- Goom T, Donnelly G, Brockwell E. Returning to running postnatal — guidelines for medical, health and fitness professionals managing this population. 2019 (open clinical guideline).
- Donnelly GM, Moore IS, Brockwell E, et al. Reframing return-to-sport postpartum: the 6 R's framework. *Br J Sports Med* 2022;56(5):244–245.

### Perimenopause and menopause
- Harlow SD, Gass M, Hall JE, et al. Executive summary of the Stages of Reproductive Aging Workshop +10 (STRAW + 10). *Menopause* 2012;19(4):387–395.
- Sims ST, Yeager S. *Next Level: Your Guide to Kicking Ass, Feeling Great, and Crushing Goals Through Menopause and Beyond.* Rodale, 2022. (Practitioner pub; cite for framing only.)

### RED-S and Triad
- Mountjoy M, Sundgot-Borgen J, Burke L, et al. The IOC consensus statement: beyond the Female Athlete Triad — Relative Energy Deficiency in Sport (RED-S). *Br J Sports Med* 2014;48:491–497.
- Mountjoy M, Sundgot-Borgen JK, Burke LM, et al. IOC consensus statement on Relative Energy Deficiency in Sport (RED-S): 2018 update. *Br J Sports Med* 2018;52:687–697.
- Mountjoy M, Ackerman KE, Bailey DM, et al. 2023 International Olympic Committee's (IOC) consensus statement on Relative Energy Deficiency in Sport (REDs). *Br J Sports Med* 2023;57:1073–1097.
- Loucks AB, Kiens B, Wright HH. Energy availability in athletes. *J Sports Sci* 2011;29(Suppl 1):S7–S15.
- De Souza MJ, Nattiv A, Joy E, et al. 2014 Female Athlete Triad Coalition consensus statement on treatment and return to play of the Female Athlete Triad. *Br J Sports Med* 2014;48:289.
- Melin A, Tornberg ÅB, Skouby S, et al. The LEAF questionnaire: a screening tool for the identification of female athletes at risk for the female athlete triad. *Br J Sports Med* 2014;48:540–545.

### Iron
- Bruinvels G, Burden RJ, McGregor AJ, et al. Sport, exercise and the menstrual cycle: where is the research? *Br J Sports Med* 2017;51:487–488.
- Burden RJ, Morton K, Richards T, et al. Is iron treatment beneficial in iron-deficient but non-anaemic (IDNA) endurance athletes? A meta-analysis. *Br J Sports Med* 2015;49:1389–1397.
- Pasricha SR, Low M, Thompson J, Farrell A, De-Regil LM. Iron supplementation benefits physical performance in women of reproductive age: a systematic review and meta-analysis. *J Nutr* 2014;144:906–914.
- Stoffel NU, Cercamondi CI, Brittenham G, et al. Iron absorption from oral iron supplements given on consecutive vs alternate days. *Lancet Haematol* 2017;4:e524–e533.

### Bone
- Ackerman KE, Misra M. Bone health and the female athlete triad in adolescent athletes. *Phys Sportsmed* 2011;39(1):131–141.
- Ackerman KE, Cano Sokoloff N, De Nardo Maffazioli G, et al. Fractures in relation to menstrual status and bone parameters in young athletes. *Med Sci Sports Exerc* 2015;47:1577–1586.
- Tenforde AS, Carlson JL, Sainani KL, et al. Sport and triad risk factors influence bone mineral density in collegiate athletes. *Med Sci Sports Exerc* 2018;50(12):2536–2543.

### Male endurance physiology
- Hackney AC. Hypogonadism in exercising males: dysfunction or adaptive-regulatory adjustment? *Front Endocrinol* 2020;11:11.
- Hackney AC, Lane AR. Low testosterone in male endurance-trained distance runners: impact of years in training. *Hormones (Athens)* 2018;17:137–139.
- Andersen K, Farahmand B, Ahlbom A, et al. Risk of arrhythmias in 52 755 long-distance cross-country skiers. *Eur Heart J* 2013;34:3624–3631.

### Strength training
- Roberts BM, Nuckols G, Krieger JW. Sex differences in resistance training: a systematic review and meta-analysis. *J Strength Cond Res* 2020;34(5):1448–1460.
- Blagrove RC, Howatson G, Hayes PR. Effects of strength training on the physiological determinants of middle- and long-distance running performance: a systematic review. *Sports Medicine* 2018;48:1117–1149.

### Eating disorders / disordered eating
- Sundgot-Borgen J, Torstveit MK. Aspects of disordered eating continuum in elite high-intensity sports. *Scand J Med Sci Sports* 2010;20(Suppl 2):112–121.
- Bratland-Sanda S, Sundgot-Borgen J. Eating disorders in athletes: overview of prevalence, risk factors and recommendations for prevention and treatment. *Eur J Sport Sci* 2013;13:499–508.
- Martinsen M, Sundgot-Borgen J. Higher prevalence of eating disorders among adolescent elite athletes than controls. *Med Sci Sports Exerc* 2013;45:1188–1197.
