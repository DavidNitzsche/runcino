# Audit passes · 2026-05-19 round 2 (post-L7)

Three audits David requested after L7 landed. Each maps the
relevant surface to its current behavior, flags any holdouts, and
either fixes the holdouts inline or queues them with a diagnosis.

---

## A1 · Every adaptive banner follows the same shape

**Spec:** suspect-ceiling is the template. Each banner must include
evidence + reasoning + math + recommendation + falsifier + user
agency (Apply / Keep current / suppress).

**Banners found in the app:**

| Banner | Location | Shape verdict |
|---|---|---|
| MaxHrValidationBanner | `web/app/profile/MaxHrValidationBanner.tsx` | ✅ canonical — this IS the template. Evidence (top peaks + race anchor) + reasoning + math (avg/0.90 derivation) + recommendation (suggested bpm) + falsifier ("We'd reconsider if...") + Apply/Dismiss. |
| AdaptiveVdotBanner | `web/app/profile/AdaptiveVdotBanner.tsx` | ✅ matches (built tonight in L7). Evidence panel with workout list + paces + HRs, reasoning paragraph, math (bump-points formula), suggested VDOT, falsifier with "What would change our mind:" preface, Apply/Dismiss buttons. |
| PaceMigrationBanner | `web/app/profile/PaceMigrationBanner.tsx` | ⚠️ **PARTIAL — one-time-migration variant.** Has reasoning + new before/after table (V4 polish). Doesn't have a falsifier because the migration is a correction, not a hypothesis. Has Confirm button (Apply equivalent). Missing: explicit "Dismiss / 30D suppress" path — by design, this banner stays until acknowledged because the canonical Daniels values are objectively correct. The shape divergence is intentional. |
| ConnectBannerIsland / ConnectBanner | `web/app/training/ConnectBannerIsland.tsx`, `web/app/components/v4/ConnectBanner.tsx` | ✅ different category — these are infrastructure prompts ("connect Strava"), not adaptive recommendations. The shape requirement doesn't apply. |

**Verdict:** Two adaptive banners (MaxHrValidation, AdaptiveVdot)
match the template. PaceMigrationBanner is intentionally simpler
(one-time correction, no falsifier needed). ConnectBanner is
infrastructure, not adaptive — exempt from this pattern.

**No holdouts to fix.** Future adaptive surfaces (Signal 2/3 banners
from L7, ongoing-shift large-shift guard banner, readiness score
banner) should follow the MaxHrValidationBanner / AdaptiveVdotBanner
template.

---

## A2 · Every VDOT-derived surface reads from aggregate, not stale values

**Spec:** After L7 introduced `users.vdot_manual_override`, every
surface displaying anything VDOT-derived (pace bands, race
feasibility, projections, prescriptions) must read from the current
`computeAggregateVdot` output, not from cached or stale values.

**Surfaces that consume VDOT directly or via fitness-resolver:**

| Surface | Source | Verdict |
|---|---|---|
| `pacesFromVdot` (web/lib/vdot.ts) | takes VDOT param, no caching | ✅ pure function · always fresh |
| `resolveTrainingPaces` (web/lib/training-paces-resolver.ts) | takes VDOT param, no caching | ✅ pure function · always fresh |
| `resolveFitness` (web/lib/fitness-resolver.ts) | calls `computeAggregateVdot` per invocation | ✅ fresh per call |
| `/profile` Coach Reads | calls resolveFitness on every server render | ✅ fresh per render |
| `/races/[slug]` readiness | calls computeAggregateVdot in scope | ✅ fresh per render |
| `/api/fitness` | calls resolveFitness | ✅ fresh per request |
| `/api/plan-range` | uses fitness.paces from resolveFitness | ✅ fresh per request |
| `/api/runs/by-date` | uses fitness.paces from resolveFitness | ✅ fresh per request |
| `/workout/[date]` | calls pacesFromVdot(vdotLib.vdot) where vdotLib is resolved per render | ✅ fresh per render |
| `validate-race-feasibility.ts` | calls computeAggregateVdot internally | ✅ fresh per call |
| `lib/coach-state.ts` | calls computeAggregateVdot in gatherCoachState | ✅ fresh per call |
| `lib/workout-descriptions.ts` | takes resolved fitness as param, no caching | ✅ caller passes fresh |
| `lib/adaptive-vdot-signals.ts` (L7) | takes currentVdot param, no caching | ✅ caller passes fresh |
| `lib/legacy-paces.ts` | display-only, uses vdotRow lookup | ✅ static reference data |

**Verdict:** No surface caches VDOT or pace bands. Every
consumer reads from a fresh `computeAggregateVdot` call (or a
fresh resolveFitness composition) per server render or API
request. After L7 lands and `vdot_manual_override` is set, the
next request to any of these surfaces will reflect the new
value without staleness.

**No holdouts to fix.** Risk to watch: if React Query or
SWR-style client caching gets added to /profile or /races, the
priority/override change endpoints will need to invalidate
those caches. Queued as S3 in earlier deck.

---

## A3 · Every race-effort-level consumer honors the weight multiplier

**Spec:** U1 introduced 6 effort levels (A=1.0, B=0.7, C=0.4,
tune-up=0.4, training-run=0.2, hilly-excluded=0.0). The weighting
must apply in every place race performance feeds an aggregate
calculation.

**Race-effort consumers:**

| Consumer | Honors effort multiplier? | Verdict |
|---|---|---|
| `compute-vdot.ts` `aggregateVdotFromInputs` | reads `meta.priority` from races, applies `PRIORITY_WEIGHT[priority]` as `eFactor`, multiplies into total weight | ✅ honors |
| Hilly-excluded filter (compute-vdot.ts) | skips bests with `priority === 'hilly-excluded'` BEFORE entering the aggregation loop. Zero weight = not a contributor. | ✅ honors |
| `validate-race-feasibility.ts` | uses agg.sources from computeAggregateVdot (sources are already weighted) | ✅ transitive |
| `fitness-resolver.ts` `resolveVdot` | uses agg.value + agg.sources from computeAggregateVdot | ✅ transitive |
| `/races/page.tsx` Recent Races | displays priority as a pip (visual only); doesn't aggregate | ✅ no aggregation, no math to honor |
| `/races/page.tsx` Personal Records (PR card) | reads from races table, picks fastest per canonical distance. **Race-effort-level not applied** because PRs are about absolute time, not effort-weighted contribution. | ⚠️ **INTENTIONAL** — David's L5 spec: "LA is the marathon PR by simple MIN. Don't overthink it." PR display is absolute time; aggregate-VDOT is the effort-weighted surface. |
| `/races/[slug]/page.tsx` readiness | reads computeAggregateVdot.value | ✅ transitive |
| `/races/data.ts` SeasonMarker | reads `meta.priority` for pip color; collapses tune-up/training-run/hilly-excluded → 'C' for the visual treatment | ✅ visual only, no aggregation |
| `lib/coach-state.ts` | reads listRacesDB; filters past races by `actualResult` presence; doesn't aggregate by effort level (defers to computeAggregateVdot for the aggregate signal) | ✅ doesn't double-aggregate |

**Verdict:** The effort multiplier is honored in the one place it
matters: `compute-vdot.ts`. Other consumers either rely on
computeAggregateVdot transitively or display priority as visual
metadata without re-aggregating. The PR card intentionally ignores
effort-level because PRs are about absolute time per David's L5
spec.

**No holdouts to fix.**

---

## Editorial summary

Three audits cleared with zero code fixes required. The patterns
locked in across rounds 1 and 2 (banner shape, races-first
source-of-truth, pure-function resolvers with no caching, single
weighting point in compute-vdot) are holding under L7's expansion.

What this audit pass enables for round 3:
- L7's banner inherits the shape contract; if Signal 2/3 land,
  their banners automatically match
- The vdot_manual_override mechanism propagates through every
  consumer without per-call updates
- New race-effort-level types can be added by extending
  PRIORITY_WEIGHT — every downstream consumer picks up the
  multiplier automatically

**Audit re-run trigger:** any time a new banner, new VDOT consumer,
or new race-effort-level surface lands.
