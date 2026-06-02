# Brief · Health page data is fully wired · design once

**For:** design agent
**From:** backend
**Date:** 2026-06-01
**Status:** Backend complete · `c2fc5b26` shipped · data is on
`seed.health.body[]`, `seed.health.form[]`, and
`seed.readinessBrief.hrvCv` · render as you see fit

---

## What's on the seed now

Per David's "design once" directive, backend wired everything before
sending you a brief so you can compose the Health page in one pass
without round-tripping.

### `seed.health.body[]` · 11 tiles

| Key | Label | Unit | Source |
|---|---|---|---|
| `hrv` | HRV | ms | health_samples.hrv |
| `rhr` | RHR | bpm | health_samples.resting_hr |
| `sleep` | SLEEP | h | health_samples.sleep_hours |
| `weight` | WEIGHT | lb | health_samples.body_mass |
| **NEW** `wrist_temp` | WRIST TEMP | °C | health_samples.wrist_temp |
| **NEW** `resp_rate` | RESP RATE | /min | health_samples.respiratory_rate |
| **NEW** `spo2` | SPO₂ | % | health_samples.spo2 |
| **NEW** `body_fat` | BODY FAT | % | health_samples.body_fat_pct |
| **NEW** `lean_mass` | LEAN MASS | lb | health_samples.lean_mass (kg→lb) |
| **NEW** `hrv_cv` | HRV CV | % | readinessBrief.hrvCv.pct |
| `hr_recovery` | HR RECOVERY | bpm | (already wired) |

Each tile carries `{ k, label, unit, current, target, dom, series,
status, decimals }` · same shape as the existing tiles. Status is
`good | warn | neutral`.

### `seed.health.form[]` · 6 tiles

| Key | Label | Unit | Source |
|---|---|---|---|
| `cadence` | CADENCE | spm | runs.avgCadence (prefers runs over HK) |
| `gct` | GROUND CONTACT | ms | health_samples.ground_contact_time |
| `vosc` | VERTICAL OSC | cm | health_samples.vertical_oscillation |
| `stride` | STRIDE LENGTH | m | health_samples.stride_length |
| **NEW** `vratio` | VERT RATIO | % | health_samples.vertical_ratio |
| **NEW** `power` | RUN POWER | W | health_samples.run_power |

### `seed.readinessBrief.hrvCv` (envelope-level)

Surfaces Plews's early-overreach signal as its own field for treatment
elsewhere on the page:

```ts
hrvCv: {
  pct: number;            // CV %
  band: 'stable' | 'watch' | 'destabilizing';
  swcMs: number | null;   // smallest worthwhile change in ms
} | null
```

Already rendered as a body tile · but you can also hero it in the
"WHAT IS DRIVING IT" section if you want it more prominent.

### `seed.health.maxHr` · single integer

True 30-day max heart rate (not single most-recent reading). 175 for
David. Drop into a small chip if useful.

---

## Real values for David right now

Smoke-tested against production:

```
WRIST TEMP   35.80 °C
RESP RATE    15.0 /min
SPO₂         95 %
BODY FAT     13.7 %
LEAN MASS    161.6 lb
MAX HR       175 bpm
VERT RATIO   8.8 %
RUN POWER    268 W
HRV CV       computed nightly · current band typically 'stable'
```

All flow from real health_samples · the Quick Wins from the audit doc
are live without iPhone work.

---

## What stayed null / pending

These four are *not* shipping today and don't have data carriers:

1. **Sleep stages** (deep / REM / light / awake) · brief filed with
   iPhone agent (`iphone-health-ingest-expansion-brief.md` · commit
   `ccd28f98`). Wait for iPhone PR.
2. **Menstrual cycle phase** · same brief. Wait for iPhone PR.
3. **Aerobic decoupling on long runs** · backend follow-up · not
   urgent since it requires per-second pace+HR which we don't store.
4. **Sleep consistency (bedtime variability)** · computed in
   health-state but `recorded_at` from HK is all midnight UTC · the
   helper returns null rather than fake `±0`. Will populate when
   iPhone agent fixes the timestamp.

For all four, the seed carrier exists but reads null today. Don't
render placeholders for these tiles; we'll wire them when iPhone PR
lands.

---

## Things that changed for honesty

### Baseline correction
The "Baseline 53 · today 42 · −11" bug from your previous brief is
fixed (`46320e82`). `seed.readiness.baseline` now reads from
`readinessBrief.composition.baseline` (rolling 14d avg of READINESS
scores, not HRV ms). See `readiness-baseline-correction-design-brief.md`.

### MAX HR fix
Was rendering 58 bpm (single most-recent sample from a low-effort
walk). Now uses `MAX(value) FROM health_samples WHERE sample_type =
'max_hr' AND sample_date >= NOW() − 30d`. 175 for David.

---

## Label copy you flagged

Your audit doc noted these labels need sharpening:

> - HRV "BELOW TARGET 53" — target is rolling baseline, not fixed
> - Sleep "BELOW TARGET" — target scales with training load
> - Cadence "WATCH" — ambiguous

These are renderer-side decisions you own. Backend exposes
`{ current, target, status }` per tile · how you frame the human
copy ("below baseline", "below scaled 8.0h target (ACWR 1.7)",
"lower than your typical 170 spm") is your call. If you want backend
to author the strings instead, say the word and we'll add a
`statusCopy` field to the tile shape.

---

## What's NOT on the seed (yet)

Per the audit doc's Bucket 3 (Tier 1):

- Sleep stages → iPhone brief shipped
- Menstrual phase → iPhone brief shipped
- Aerobic decoupling → not implemented (deferred)

---

## How to respond

1. Design the Health page across the now-real data set.
2. If any tile needs different `status` thresholds or different
   `dom` (chart range), call it and backend will adjust the
   helper.
3. If you need authored status copy on the tile shape, ask and
   backend will add `statusCopy: string` to each tile.
4. When sleep stages land (iPhone PR), you'll get a follow-up brief
   with the new tile keys.

---

## Related

- `designs/briefs/health-page-coverage-audit.md` · the original
  audit (backend → David → design)
- `designs/briefs/iphone-health-ingest-expansion-brief.md` ·
  parallel iPhone ingest work
- `designs/briefs/readiness-baseline-correction-design-brief.md` ·
  the bug-fix brief that you've already seen
- `web-v2/lib/coach/health-state.ts` · data loader
- `web-v2/components/faff-app/seed.ts:957` · `adaptHealth()`
  composer
- `web-v2/lib/coach/readiness-brief.ts:120` · `composition` shape ·
  same envelope now carries `hrvCv` at line 128

---

## Commits in this wave

- `46320e82` · honest readiness baseline (fixed the 53 bug)
- `7eb20b71` · readiness baseline correction brief
- `b01b39d8` · health page coverage audit
- `ccd28f98` · iPhone HK ingest expansion brief
- `c2fc5b26` · 8 new tiles + HRV CV + MAX HR fix

All on `main`. Design with full confidence the data is honest.
