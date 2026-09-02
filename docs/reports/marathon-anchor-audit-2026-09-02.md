# Audit · the 7:55/mi marathon-training anchor · 2026-09-02

**Question.** Is 7:55/mi (475 s/mi) the runner's current marathon effort, an overly conservative estimate, or a mislabelled steady pace? Trace every observation behind the exponent 1.087, compare with the runner's real sustained pace/HR evidence, run the sensitivity, and change the model only if it is admitting, weighting or interpreting performances incorrectly — never to chase the 3:00 goal.

**Verdict.** 7:55 is a **defensible estimate of current marathon effort, at the conservative end of what the evidence supports, produced by an evidence model that has two real admission defects — and correcting those defects moves the anchor about 4 s/mi SLOWER, not faster.** It is not a mislabelled steady pace: the same anchors put the long-run band at 8:22–8:57 and the easy ceiling at 8:22, and 7:55 costs this runner 89–92% of LTHR in summer, which is the marathon band. What makes it conservative relative to his sub-marathon training is exactly the durability gap his one marathon demonstrated: a 1:34:54 half five weeks before a 3:31:40 marathon is 7.4% slower than Riegel 1.06 predicts, which doctrine (`Research/02` §7.1) classes as a speed-biased runner (exponent 1.10–1.13). The app shrinks that toward the population prior and lands on 1.087. **No change was made** (reasons in §8); the corrected-model number is precomputed so the decision can be taken with the effect known.

All numbers are read-only from production at the deployed commit; scripts in the scratchpad (`mp-audit*.ts`) call the same library functions the app calls.

---

## 1 · How 7:55 is derived (the trace)

```text
threshold capacity        430 s/mi (7:10) · VDOT 47.8 · direct · confidence 0.84
                          evidence: -258355938987883 (09-01 4×1 mi), -87627419857791 (07-07), -2351254210708 (06-23)
threshold anchor distance 60 min at 430 s/mi = 8.37 mi   (THRESHOLD_ANCHOR_MINUTES = 60, Research/01: T ≈ one-hour race pace)
endurance exponent        1.087 = 0.655 × 1.101 (raw fit) + 0.345 × 1.06 (population prior)   (resolveRaceExponent → resolveDurability)
marathon-training pace    430 × (26.22 / 8.37)^(1.087 − 1) = 474.8 s/mi = 7:55   (marathonPaceFromDurability)
```

Every input is the canonical owner's: threshold from the Runner Model, exponent from the durability anchor, formula from Pace Prescription. Nothing reads the goal.

## 2 · The five race observations behind exponent 1.087

`loadRaceObservationsForDurability` admits graded (A/B/C) races with a confirmed rung-1/2 time, weighted by declared priority only (A 1.0 · B 0.65 · C 0.35), capped by a runner-reported tier. Eleven race rows exist; five qualify.

| Race | Date | Distance | Time · pace | Priority → weight | Splits (first half → second half, HR) | The app's own representativeness read (`assessRaceRepresentativeness`, anchor VDOT 47.8) |
|---|---|---|---|---|---|---|
| Rose Bowl half | 2026-01-18 | 13.11 | 1:38:38 · 7:31 | A → 1.0 | 7:25 → 7:22 · HR 156 → 164 | **compromised**, authority 0.35: raced on training legs, no taper (doctrine grades it a C effort) |
| Disney half | 2026-02-01 | 13.11 | 1:34:54 · 7:14 | A → 1.0 | 7:00 → 7:11 · HR 158 → 167 | **representative**, authority 1.0: "a real step up in fitness" (VDOT 47.9) |
| LA Marathon | 2026-03-08 | 26.22 | 3:31:40 · 8:04 | A → 1.0 | **7:19 → 8:31 · HR 161 → 163** (first half at 96% of LTHR) | **compromised**, authority 0.54: pacing (splits varied 11.1% vs 10% normal, "1.1% lost to how it was run") + no taper (0.29) |
| Sombrero half | 2026-05-03 | 13.16 | 1:40:57 · 7:40 | C → 0.35 | 7:16 → 7:47 · HR 162 → 164 | **unrepresentative**, authority 0.21: 209 ft, 62°F, no taper |
| America's Finest City half | 2026-08-16 | 13.10 | 1:41:53 · 7:47 | A → 1.0 | HR 166 → 171 (100% of LTHR) | **unrepresentative**, authority 0.28: 722 ft of climbing (−86 s) + 69°F (−3.3%) + humidity |

Excluded correctly: Big Sur marathon (`hilly-excluded`, 3:36:55, 7:57 → 8:22 at 92% LTHR), the two future 10Ks, Malibu, CIM, LA 2027.

**What the fit sees.** Two distinct distances only. The weighted log-log regression therefore passes exactly through the (weighted) half-marathon cluster and the single marathon point — the marathon's residual is 0.0% by construction, and the exponent is entirely "how much slower was the one marathon than the halves":

| | |
|---|---|
| Raw fitted exponent | 1.101 |
| Evidence score | 0.655 (count 0.75 · spread 0.62 · quality 0.87 · consistency 0.40) |
| Shrunk value spent | **1.087** |
| Confidence (with freshness) | 0.62 |
| RMS log residual among halves | 2.5% (loose band 8%) |
| Leave one out | without LA marathon: **refuses** (one distance) · without AFC 1.121 · without Sombrero 1.104 · without Rose Bowl 1.101 · without Disney 1.077 |
| Pairwise marathon vs each half | AFC 1.054 · Sombrero 1.074 · Rose Bowl 1.102 · **Disney 1.157** |

The pairwise spread (1.054 to 1.157) is the fitness change between the February PR half and the August heat half being read as curve shape. The fit pools January–August at equal weight; doctrine's fit rule is "two RECENT races at different distances… best when both are recent, on flat courses, in similar weather" and "discard any race run in heat > 18 °C, on a hilly course, or in a depleted state without correction" (`Research/02` §11.2, §11.4).

## 3 · The runner's real sustained evidence (≥ 10 mi, canonical rows, heat-normalised to a 50 °F race day)

`coherentPace` (moving basis), `avgHr` against LTHR 168, `applyHeatToPace` inverted to the 50 °F equivalent.

| Date | Dist | Pace (moving) | HR · % LTHR | Temp | 50 °F-equivalent | Note |
|---|---|---|---|---|---|---|
| 04-05 | 20.0 | 7:58 | 151 · 90% | 64 | **7:47** | 20-miler, second-half HR 160 |
| 04-12 | 14.3 | 8:03 | 150 · 89% | 55 | 7:59 | 971 ft |
| 05-31 | 12.4 | 8:01 | 154 · 92% | 74 | 7:37 | |
| 06-21 | 13.2 | 7:27 | 141 · 84% | 60 | **7:21** | cool day, HR 134 → 143 |
| 07-12 | 12.6 | 8:18 | 160 · 95% | 71 | 7:58 | |
| 07-25 | 18.0 | 8:01 | 155 · 92% | 72 | **7:40** | second-half HR 162 |
| 08-09 | 12.4 | 7:21 | 157 · 93% | 71 | **7:04** | |
| 08-23 | 11.0 | 8:01 | 147 · 88% | 74 | **7:38** | AFC recovery window |
| 08-30 | 13.5 | 7:37 | 159 · 95% | 74 | **7:15** | marathon-pace segments, second-half HR 165 |

Read at the marathon band proper (88–92% of LTHR, `RACE_HR_PCT_LTHR.m` = 0.88–0.95): the last six weeks put the runner's cool-equivalent sustained pace at **7:38–7:47 over 11–20 miles**, and at 93–95% (the top of the band, sustainable for a half, not a marathon) at 7:04–7:15. The four efforts the race-HR guidance found "comparable" to a 7:31 race pace ran at 141, 157, 159 and 163 bpm — a spread that says 7:31 is a 93–97% effort for him in summer, not marathon effort.

**Against that, 7:55:** the 06-23 8-mile tempo at 7:55 cost 149 bpm (89%), the 05-31 and 07-25 efforts at 8:01 cost 154–155 (92%). So 7:55 IS inside his marathon HR band in summer conditions, and about 10–15 s/mi slower than the cool-day marathon-band evidence over 12–20 miles.

## 4 · Sensitivity

MP = T × (26.22 / D60)^(b − 1):

| T \ exponent | 1.05 | 1.06 (prior) | 1.07 | 1.08 | **1.087** | 1.10 (raw) | 1.11 |
|---|---|---|---|---|---|---|---|
| 425 (7:05) | 7:30 | 7:35 | 7:40 | 7:45 | 7:49 | 7:56 | 8:01 |
| **430 (7:10)** | 7:35 | 7:40 | 7:46 | 7:51 | **7:55** | 8:02 | 8:08 |
| 435 (7:15) | 7:41 | 7:46 | 7:52 | 7:57 | 8:01 | 8:08 | 8:14 |

Exponent ±0.03 moves the anchor ±17 s/mi; threshold ±5 s/mi moves it ±6; the 60-minute anchor convention (50 → 65 min) moves it 8:02 → 7:52. Reference points: Daniels M at VDOT 47.8 = 7:33 (a combo runner); Riegel from his best half at 1.06 = 3:17 (7:31/mi) versus his actual 3:31:40 (8:04).

Alternative admissions of the same races:

| Admission | Raw · spent exponent | MP at T 430 |
|---|---|---|
| As deployed (5 races, priority weights, raw times) | 1.101 · 1.087 | **7:55** |
| Weights × the app's representativeness authority | 1.125 · 1.096 | 8:00 |
| Times corrected by the app's explained seconds (course/heat/pacing) | 1.110 · 1.094 | 7:59 |
| Both | 1.122 · 1.096 | 8:00 |
| Both, unrepresentative races dropped (Sombrero, AFC) | 1.126 · 1.094 | 7:58 |
| Most recent half + the marathon only (AFC, LA) | 1.054 · 1.057 | 7:39 |
| LA marathon excluded | refuses (one distance) → prior 1.06 | 7:40 |
| LA with its first half doubled (3:11:40 — what the fade cost, not an observation) | 0.958 · 0.993 | 7:07 |

The corrected model moves the anchor slower because the hot, hilly halves get faster when their conditions are priced out (AFC 1:41:53 → 1:36:55) while the marathon's pacing loss is priced at only 1.1% — the module treats an 11% split variation as barely outside the 10% it calls normal for this standard. The only admissions that move the anchor faster remove the marathon or replace it with a counterfactual.

## 5 · Doctrine check

- `Research/02` §6–7: 1.09–1.12 is "speed-biased runners; insufficient long-run base; marathon target"; a runner whose marathon underperforms Riegel by 5–10% is a Speedster and should be projected at ~1.10 or +3–5%. His Disney → LA underperformance is 7.4%. The spent 1.087 is inside doctrine and slightly kinder than the raw read.
- `Research/02` §11.2/§11.4: fit from recent, flat, similar-weather races, or correct before fitting. The deployed fit pools seven months and corrects nothing. **This is the admission defect.**
- Brief 06: "Do not treat a two-race exponent as established physiology. Partially pool… based on amount of evidence, distance spread, recency, context quality, repeatability." Amount, spread and repeatability are in the evidence score; **context quality is not** (priority only); recency is in confidence only, by design.
- `Research/01` §Marathon Pace: MP = "goal or equivalent marathon race pace", with MP segments inside long runs at 80–85% HRmax / 73–84% HRR. The anchor is being used as today's equivalent race pace, which is the right reading.

## 6 · Findings (the evidence model, not the number)

1. **Second truth on race authority.** The durability loader weights by declared priority and ignores `assessRaceRepresentativeness`, the canonical effort-class pipeline CLAUDE.md's race-data checklist and `EVIDENCE.race-authority-is-the-effort-class` make authoritative. AFC (authority 0.28, hot and 722 ft) enters at 1.0; LA (0.54, no taper, pacing) enters at 1.0. Times are raw, against `Research/02` §11.2's "correct or discard".
2. **A single long-distance observation fixes the exponent and the fit cannot see it.** With two distinct distances the marathon's residual is zero by construction; the count score credits five races; leaving the marathon out refuses. The whole 7:55 versus 7:40 difference is one race run at 96% of LTHR for the first half. Brief 06 lists long-run fade, decoupling onset and sustained race-specific work as durability evidence; the app reads decoupling (6.4% over nine runs, confidence 0.9) but it never enters the exponent, only the durability component's confidence.
3. **Pacing is under-priced.** A 72 s/mi positive split is charged 1.1%. `Research/08` §2 gives elite CV 1.5–3%; the module's "10% normal for this standard" is a convention that lets a blow-up read as durability. This one cuts the other way from finding 1: correcting it would move the exponent DOWN. It needs a doctrine-cited number before it is touched.
4. **Not a defect:** the threshold anchor (430, three corroborated sessions) and the 60-minute anchor convention are sound; the formula is the durability owner's; the goal is nowhere in the chain (the goal-isolation proof in the handback shows identical 7:55 for 2:30, 3:00, 3:30 and no goal).

## 7 · Answer to the three hypotheses

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Current marathon effort | **Yes, at the conservative end.** | 7:55 sits at 89–92% LTHR in summer; the runner's only marathon says his fade is large (Speedster class); Daniels' population number (7:33) assumes a fade he has not shown. |
| Overly conservative | **Partly — by 10–15 s/mi against cool-day sub-marathon evidence, and that gap is the unproven marathon fade, not a modelling error in the goal's favour.** | 12–20 mi at 88–92% LTHR heat-normalise to 7:38–7:47; correcting the model's admission defects moves the anchor to 7:58–8:00, not faster. |
| Mislabelled steady pace | **No.** | Long-run band 8:22–8:57 and easy ceiling 8:22 from the same anchors; 7:55 is 27 s/mi inside the long-run band's fast edge and costs marathon-band HR. |

## 8 · What was not changed, and the change that is ready

No constant, weight or admission rule was altered in this audit. The two defects in §6 are real and the doctrine-cited fix is one file — `loadRaceObservationsForDurability` spending `assessRaceRepresentativeness().authority` in the weight and removing `explainedPct` from the time before the fit — but its effect on this runner is **+3 to +5 s/mi (7:55 → 7:58–8:00)** with confidence 0.59–0.64, inside the model's own ±17 s/mi exponent sensitivity, and applying it tonight would reprice the live race rows and the CIM outlook that the completion handback just recorded against `f967cab1`. It is the right change and the wrong moment; it should go in with the next canonical push, together with an evidence-score term for "one long-distance observation" so the fit says what it cannot see.

What WOULD move the anchor faster, legitimately: a marathon or a 20+ mile race-pace long run executed at marathon HR with an even split. The plan already prescribes those (11 mi @ MP on 11-17, 7 mi @ MP on 11-24, 16 mi with 4 @ M on 11-15); a controlled 11 miles at 7:55 and 148–155 bpm would be the first durability evidence at the distance the exponent is being asked about.
