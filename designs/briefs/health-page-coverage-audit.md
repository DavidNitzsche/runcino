# Audit · Health page coverage vs backend vs Research

**For:** David + design agent
**From:** backend
**Date:** 2026-06-01
**Status:** Recommendation · what we already have, what we're missing

---

## TL;DR

Backend has **19 sample types** in production for David right now.
The mockup surfaces **9**. We're sitting on a pile of signals the
runner never sees · including some that Research/ explicitly says
should drive readiness decisions (HRV CV, wrist temp, cardiac
decoupling).

This is mostly a design question: which signals to surface, how
densely, and where on the page. The data plumbing for almost
everything below already works.

---

## Three coverage buckets

### Bucket 1 · in mockup AND backend (rendering today)

| Metric | Backend status | Mockup status |
|---|---|---|
| Readiness score | ✓ computed | ✓ main gauge |
| Sleep hours | ✓ 38 samples | ✓ "5.9h target 7.5h" |
| HRV | ✓ 61 samples | ✓ "44ms baseline 55" |
| RHR | ✓ 61 samples | ✓ "47bpm baseline 50" |
| ACWR load | ✓ computed | ✓ "1.70 acute 11.1 chronic 6.5" |
| HR Recovery | ✓ 6 samples (was broken on Health · just fixed) | ✓ "no data yet" |
| 7-day readiness trend | ✓ snapshots | ✓ bar strip |
| Weight | ✓ 6 samples (84.9kg = 187lb) | ✓ "187.0 lb steady" |
| VO2 max | ✓ 11 samples (61.78) | ✓ "62.0 on target" |
| Cadence | ✓ 30 samples | ✓ "162 spm target 170" |
| Ground contact | ✓ 30 samples (243ms) | ✓ "246 ms aim 235" |
| Vertical oscillation | ✓ 30 samples (10.23cm) | ✓ "10.1 cm aim 8.5" |
| Stride length | ✓ 30 samples (1.26m) | ✓ "1.14 m on target" |

All rendering correctly (well, HR Recovery was broken on Health · I
fixed it earlier today in commit `c92f2c9d`).

### Bucket 2 · in backend, NOT in mockup (free wins · sitting on the floor)

These are samples already landing in `health_samples`. Surfacing
them costs only design + frontend render time. Each has a real story.

| Metric | Backend | Doctrine | Suggested treatment |
|---|---|---|---|
| **Wrist temp** | 27 samples (35.9°C nightly avg) | Research/00b §recovery · skin-temp deviation is a fast illness/overtraining flag | Tile in BODY section · trend chart + "baseline 35.7°C" |
| **SpO2** | 42 samples (97% avg) | Research/15 §SpO2 · drops at altitude / when sick | Small chip in BODY · usually 97-99, alarm when < 95 |
| **Respiratory rate** | 46 samples (16.4/min) | Research/15 §RR · rises before runners feel sick by 24-48h | Tile · "16/min · baseline 15" with overshoot alarm |
| **Body fat %** | 6 samples (13.7%) | Research/13 + 14 · trend matters more than value | Small tile in BODY · trend over 30/90d |
| **Lean mass** | 6 samples (73.3 kg) | Research/07 §strength · maintaining lean mass through a build is the strength-recommender's job | Tile in BODY · paired with weight + body fat |
| **Max HR** | 46 samples (141.57 most recent) | Research/03 §HR zones · informs HRR + zone math | Already in pipeline · could surface as small chip |
| **Vertical ratio** | 30 samples (8.18%) | Research/16 §form · vertical / stride = bouncing inefficiency | Already in form pipeline · add tile next to vert osc |
| **Run power** | 31 samples (288 W avg) | Research/16 §power · economy at threshold pace = aerobic fitness | New FORM tile · "288 W at threshold pace" |
| **Active energy** | 35 samples (977 kcal) | Research/19 §hydration · proxy for daily energy expenditure | Could feed into daily kcal tile + fueling decisions (iPhone-side bug noted earlier · undersampled) |

**Quick wins to add right now (all data exists):**
- Wrist temp tile (real Plews-style overtraining signal)
- Respiratory rate tile (rises before HRV does when illness brewing)
- SpO2 chip (small space, real signal at altitude/when sick)
- Vertical ratio tile in FORM
- Run power tile in FORM

### Bucket 3 · doctrine says we SHOULD have, neither shows

These need new computation or new ingest paths. Tier 1 = highest
research-backed value.

#### Tier 1 · real signals doctrine treats as primary

| Signal | Research | What it would tell the runner |
|---|---|---|
| **HRV CV (coefficient of variation)** | Research/15 §HRV Plews approach · "early functional overreach signal · CV rises 24-72h before HRV drops" | Plews's specific framework. Already computing in backend (lib/coach/readiness-history.ts §hrvPlews.cv) · just not surfaced. Tile: "HRV CV 4.2% · destabilization band" |
| **Aerobic decoupling on long runs** | Research/15 §cardiac decoupling · "pace-to-HR drift on Z2 efforts > 5% = poor aerobic fitness · < 5% = ready for race" | Compute from any long run with steady-state HR · big aerobic fitness signal. Surface as a tile or chip on run-detail. |
| **Sleep stages (deep / REM / light / wake)** | Research/00b §recovery · "deep sleep early in night drives parasympathetic recovery · REM in second half drives motor memory consolidation" | Apple Watch ships these. We don't ingest them yet. Adds ~4x more sleep insight than the bare "5.9h total" we show today. |
| **Sleep consistency (bedtime variability)** | Research/00b · "bedtime drift > 1h/night = chronic circadian stress equivalent to a 5h night" | Compute from sleep_hours start times. Tile: "Bedtime ±42min over 7d · drifting" |
| **HRR 60s + HRR 2min** | Research/03 + 15 · "60s drop = parasympathetic snapback · 2min drop = full ANS recovery" | Already getting 60s (hr_recovery). 2min would add granularity. |

#### Tier 2 · contextual signals doctrine treats as confounders

| Signal | Research | Source |
|---|---|---|
| **Menstrual cycle phase** | Research/13 §sex-specific · "luteal phase HRV runs lower regardless of fitness · don't pull back when biology explains it" | Manual log OR HK ingest (Apple Health has it). Big for half our future user base. |
| **Time zone / travel** | Research/12 §travel · "1 timezone = 1 day jet lag; performance dips 10-15% per zone for 3-5 days" | Detect from device timezone changes. |
| **Subjective check-in** | Research/15 §Saw et al. · "subjective wellness > objective markers when they disagree" | Already in backend brief (subjectiveCheckin · readiness-brief.ts) · just not exposed on Health page. |
| **Alcohol log** | Research/00b · "1 drink raises overnight HR ~4 bpm · 3+ blunt next-day quality work" | Manual log only. Would need entry surface. |
| **Stress (subjective)** | Research/00b · "life stress confounds the same HRV reading" | Manual log. |

#### Tier 3 · form / biomechanics richness

| Signal | Research | Notes |
|---|---|---|
| **Left/right asymmetry** | Research/16 §form · "10%+ imbalance = strong injury risk + economy cost" | Apple Watch has it. Not ingested. |
| **Cadence under fatigue** | Research/16 §form · "cadence drop on closing splits = neuromuscular fatigue marker" | Compute from runs splits. |
| **Pace-HR drift across run** | Research/15 §wearables · "HR climb with steady pace = aerobic decay or heat or fatigue" | Compute from per-mile splits. |
| **Running economy (kJ/km)** | Research/16 §form · "best objective fitness improvement signal" | Strava ships this if power data is there. |

---

## Recommended additions (priority order)

If David picks a single batch to ship next:

### Quick wins (data already in DB · just render)

1. **Wrist temp tile** in BODY section · adds a real overtraining
   signal that runners often miss
2. **Respiratory rate tile** in BODY · 24-48h early-warning for
   illness per Research/15
3. **SpO2 small chip** in BODY · usually quiet but alarms when low
4. **Vertical ratio tile** in FORM · vertical/stride efficiency
5. **Run power tile** in FORM · economy at threshold pace

These 5 are free · backend has the data, just needs render.

### Mid-effort (need computation work)

6. **HRV CV** prominent in WHAT IS DRIVING IT · Plews early-overreach
   signal · backend already computes, just not surfaced
7. **Aerobic decoupling** on long-run detail · compute pace-to-HR
   drift over the run
8. **Sleep consistency** tile · compute bedtime variability from
   sleep_hours start times

### Bigger ingest work

9. **Sleep stages ingest** · pull deep / REM / light / wake from HK
10. **Menstrual cycle ingest** · pull cycle phase from HK
11. **Time zone change detection** · compare device tz day-over-day
12. **Manual entry for alcohol / stress** · adds confound context to
    readiness explanations

---

## What I'd cut

Honestly nothing on the current mockup needs to go. The 9 surfaced
metrics are all primary signals.

But the **"BELOW TARGET / ON TARGET / WATCH"** labels could be
sharper. Some thoughts:

- **HRV "BELOW TARGET 53"** · the target is your own rolling baseline,
  not a fixed number. "Below baseline (was 53, now 44)" reads
  cleaner.
- **Sleep "BELOW TARGET"** · same · the target scales with training
  load. Saying "Below scaled target 8.0h (ACWR 1.7)" is honest.
- **Cadence "WATCH"** · ambiguous (watching what?). "Below typical
  170 spm" or "Lower than your typical 170 spm" is clearer. Same for
  GCT, vertical osc.

---

## Honest framing

The mockup is solid as a v1. The opportunity is that we have a
serious data layer already running and the runner sees about 50% of
it. The Research/ doctrine specifically calls out HRV CV, wrist
temp, and respiratory rate as early-warning signals that matter
before HRV itself flags. The current design surfaces HRV but not
the leading indicators.

For your specific case today (sleep streak + high ACWR), if we'd
shown wrist temp + RR alongside, the "back-off day protects the
week" message would have additional confirming signals visible.
Right now those signals exist but go to /dev/null on the page.

---

## Doctrine note

This audit was done against Research/00b (recovery), 03 (HR zones),
13 (sex-specific), 15 (wearables), 16 (form). No citations on
runner-facing copy per the locked rule.

---

## How to respond

1. Pick the tier you want to ship next. The Quick Wins block is
   ~half a day of frontend work and adds 5 real signals.
2. For sleep-stage ingest (the highest-value Tier 1 addition), I'd
   need to coordinate with the iPhone agent to pull from HK.
3. If you want me to write the per-tile copy for the new signals,
   say the word.

---

## Related

- `docs/PLAN_ENGINE_ARCHITECTURE.md` · the closed-loop architecture
  this feeds
- `lib/coach/readiness-brief.ts` · the composer
- `lib/coach/state-loader.ts` · where most of these signals already
  load from health_samples
- `lib/coach/health-state.ts` · the per-pillar baseline computers
