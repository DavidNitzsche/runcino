# 24 — VDOT Age and Sex Grading

This doc covers how to interpret a VDOT score *relative to peers* —
adjusting for the fact that an absolute number ("VDOT 47.1") means
different things at age 25 vs age 55, and means different things for
men vs women relative to their respective elite standards.

The base VDOT computation in [01 — Pace Zones, VDOT, and Training
Pace Calculation](./01-pace-zones-vdot.md) produces an **absolute**
VDOT — a sex-and-age-blind value derived from a race time. Pace
prescription is keyed off this absolute number; that's intentional
(running 7:00/mile is the same physiological work for everyone).

Grading layers on top to answer two different questions:

1. **Age-graded VDOT** — "What VDOT would a 25-year-old need to
   match my performance for my age?" Used to track personal
   progression as the runner ages, and to communicate "how strong
   is this VDOT for this age."

2. **Sex-cohort context** — "Where does my VDOT land within my
   sex-cohort distribution?" Used for tier interpretation
   ("intermediate male" vs "advanced female" — a VDOT 50 lands
   differently in each cohort because the elite ceilings differ).

---

## Age grading (simplified Daniels model)

The full **World Masters Athletics (WMA) age-grading tables** are
the gold standard — they map a race time at any (age, sex, distance)
to a standardized "performance level" percentage, where 100% is the
world-record-equivalent for that cohort. They're maintained by the
governing body and used in every age-graded race result.

WMA tables are the right long-term fix. For now we use a simpler
**Daniels age-adjustment model** that approximates the same idea
with a single per-year VDOT decline rate. It's less precise but
adequate for surfacing "age-graded VDOT" alongside raw VDOT until
WMA tables are vendored.

### Daniels VDOT decline by age (men, simplified)

| Age range | Annual VDOT decline | Cumulative (from age 30) |
|-----------|---------------------|---------------------------|
| 20–30     | 0 (peak window)     | 0                         |
| 30–40     | ~0.3/yr             | ~3                        |
| 40–50     | ~0.6/yr             | ~9                        |
| 50–60     | ~0.9/yr             | ~18                       |
| 60–70     | ~1.2/yr             | ~30                       |
| 70+       | ~1.5/yr             | ~45+                      |

Source: extrapolated from Daniels' performance-level guidance + 
masters running literature. The decline is non-linear because
both VO2max and running economy degrade with age, and the rate
of degradation accelerates after 50.

For women, the same shape holds with slightly slower decline rates
in the 30–50 window (women lose VDOT more gradually pre-menopause)
and slightly steeper rates post-50.

### Computing age-graded VDOT

```
ageGradedVDOT(rawVDOT, age, sex):
    declineFromAge30 = sum_of_per_year_declines(30 → age, sex)
    if age < 30:
        return rawVDOT                    # peak window — no adjustment
    return rawVDOT + declineFromAge30     # what a 30yo would run
```

**Interpretation:**

- **Raw VDOT** drives pace prescription (always).
- **Age-graded VDOT** drives self-comparison and "how strong is
  this for my age" framing in the Coach voice.

A 55-year-old man with raw VDOT 47.1 has age-graded VDOT ~58.6
— i.e., his performance relative to his age cohort is in the
"advanced/sub-elite for masters" range, even though his absolute
VDOT lands in the open-class "intermediate" tier.

---

## Sex-cohort context

Daniels' VDOT system itself is sex-blind by design — the math
takes a race time, returns a number. But interpreting that
number as a *competitive level* requires a sex reference because
the population distributions differ.

### Cohort ceilings (approximate world-class VDOTs)

| Distance  | Men (elite) | Women (elite) | Ratio (W/M) |
|-----------|-------------|---------------|-------------|
| 5K        | ~85         | ~78           | 0.92        |
| 10K       | ~84         | ~78           | 0.93        |
| Half      | ~83         | ~77           | 0.93        |
| Marathon  | ~82         | ~76           | 0.93        |

Across distances, the men's elite VDOT ceiling sits about 7–8
percentage points above the women's. Tier interpretation should
account for this:

- **Open-class tiers** (Novice / Intermediate / Advanced / Elite,
  per [Research/01](./01-pace-zones-vdot.md)) use absolute VDOT
  ranges and don't adjust for sex.
- **Sex-cohort tiers** apply when communicating "how strong is
  this VDOT for someone in your cohort."

For the typical recreational runner the open-class tier is what
matters for pace prescription. The sex-cohort context is most
useful for race-day pacing expectations and goal-setting.

### Sex-cohort tier shifts

Apply this offset when communicating tier within a sex cohort:

| Sex      | Tier offset vs open-class |
|----------|---------------------------|
| Male     | 0 (open-class is male-anchored)  |
| Female   | +7 VDOT                          |

A woman with raw VDOT 50 sits in the open-class "advanced" tier
(50–60). For sex-cohort communication, treat as VDOT 57 — closer
to the high-advanced / approaching-elite range within the women's
distribution.

---

## Implementation notes

- **Profile fields needed:** birth year (computed → age) + sex
  (male / female / other / prefer-not-to-say). Both optional —
  when absent, surface raw VDOT only.
- **Storage:** localStorage keyed `faff:profile` is sufficient
  for now. Server-side persistence (Postgres user table) is a
  future migration.
- **UI surface:** dashboard VDOT tile shows raw VDOT + tier badge
  by default. When age/sex are known, add a secondary line
  beneath the source row: "Age-graded VDOT 58.6 · advanced for
  masters."
- **Voice integration:** the Coach brief can use age-graded VDOT
  in framing ("for someone competing in the M50 division, your
  fitness is solidly competitive"), but pace targets always flow
  from raw VDOT.
- **Other / prefer-not-to-say:** sex grading falls back to no
  cohort offset; tier label uses open-class only.

---

## Future work

1. **Vendor full WMA tables** — replace the Daniels-style decline
   approximation with the official age-grading factors. WMA tables
   are public domain and maintained by World Masters Athletics.
2. **Server-side profile** — migrate from localStorage to a Postgres
   user table once authentication lands.
3. **Trans + nonbinary inclusivity** — current male/female cohort
   model is binary by necessity (the underlying physiology data is
   sex-distribution-anchored). When trans-runner-specific research
   matures, revisit.
4. **Performance-level percentage** — surface a single 0–100%
   "performance level" that combines age + sex + distance into a
   universal score. Standard in the age-graded race-result world
   but requires the WMA tables.

---

## Sources

### Primary

- Daniels, J. (2014). *Daniels' Running Formula*, 3rd ed. Human
  Kinetics. (Chapter 5: VDOT; performance-level discussion in
  Chapter 4.)
- World Masters Athletics. *Age-Grading Tables.*
  [https://world-masters-athletics.com](https://world-masters-athletics.com)

### Secondary

- USA Track & Field. *Age-Graded Performance Tables.*
- Mastersrecords.eu. *Comprehensive masters running standards.*
