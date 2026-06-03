# Onboarding · master spec · EXECUTION brief

**Pairs with:** `designs/briefs/onboarding-master.md` (design spec)
**Status:** ready to build
**Author:** backend agent
**For:** web agent + iPhone agent + backend (me)

This brief tells you HOW to ship what the master spec says WHAT. Read the design brief first for the user-facing rationale + visual layout. This covers the engineering work split: backend modules + endpoints, frontend component changes, page wiring, build order, verification.

---

## What's already shipped · don't redo

Per the design brief inventory, the Lilian deck is built but unwired. **The bulk of frontend work is already done.** This brief mostly extends what exists.

| Concern | Existing module | What it gives you |
|---|---|---|
| URL state codec | `lib/onboarding/state.ts` | Refresh-safe state across all steps |
| Atomic write | `POST /api/onboarding/complete` | profile + users + user_prefs txn + race row + plan generation |
| Lilian deck UI | `components/onboarding/*` | LandingHero + Shell + Step1-3 + Completion · all chips, all responsive |
| Strava OAuth | `/api/auth/strava` | Round-trip works for connection · returnTo broken (see B5) |
| Race-prep plan | `lib/plan/generate.ts` | Full periodized plan from raceSlug |
| Maintenance plan | `lib/plan/seed-from-onboarding.ts` | 16-week base block from chip answers |
| T2 physiology capture | Step 3 backend | birthday / sex / height_cm wired through complete/route.ts |

Everything else in this brief is **new work or extension.**

---

## Backend work · 9 tasks

### TASK B1 · Wire `/onboarding` to the Lilian deck

**Problem:** `app/onboarding/page.tsx` currently does `redirect('/today')`. No new user can reach onboarding.

**Fix:**

```ts
// app/onboarding/page.tsx
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';
import { LandingHero } from '@/components/onboarding/LandingHero';
import { Step1Goal } from '@/components/onboarding/Step1Goal';
import { Step1bGoalDetails } from '@/components/onboarding/Step1bGoalDetails';
import { Step2Signals } from '@/components/onboarding/Step2Signals';
import { Step3Confirm } from '@/components/onboarding/Step3Confirm';
import { CompletionScreen } from '@/components/onboarding/CompletionScreen';
import { parseOnboardingParams } from '@/lib/onboarding/state';
import { loadStravaHistoryForOnboarding } from '@/lib/onboarding/strava-history';
import { resolveInitialName } from '@/lib/onboarding/initial-name';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const state = parseOnboardingParams(searchParams);
  const intent = intentFor(state);
  const stepNumber = stepNumberFor(state.step);

  return (
    <OnboardingShell state={state} variant={state.step === 'done' ? 'done' : 'new'}
      intent={intent} backHref={backHrefFor(state)} stepNumber={stepNumber}>
      {state.step === 'landing' && <LandingHero />}
      {state.step === 'goal' && <Step1Goal initial={state} />}
      {state.step === 'goal-details' && (
        <Step1bGoalDetails initial={state}
          stravaHistory={await loadStravaHistoryForOnboarding(state)} />
      )}
      {state.step === 'signals' && <Step2Signals initial={state} />}
      {state.step === 'confirm' && (
        <Step3Confirm initial={state} initialName={await resolveInitialName(state)} />
      )}
      {state.step === 'done' && <CompletionScreen state={state} />}
    </OnboardingShell>
  );
}
```

**Auth gate:** if `requireUserId(req)` returns a NextResponse (= unauthenticated), the Strava sign-in flow handles it. First-time users are pre-authed because the flow only opens AFTER sign-up/sign-in (Strava OAuth gives us the user_uuid).

**Delete:** `components/onboarding/OnboardingFlow.tsx` (legacy 4-step deck · dead code).

---

### TASK B2 · `lib/onboarding/strava-history.ts` (new · ~80 lines)

Loads avgWeeklyMi + longestRecentMi from Strava when connected. Used by Step1bGoalDetails pre-fill.

```ts
export interface StravaOnboardingHistory {
  avgWeeklyMi: number;
  longestRecentMi: number;
  runCount: number;
  oldestRunDate: string;
}

export async function loadStravaHistoryForOnboarding(
  state: OnboardingState
): Promise<StravaOnboardingHistory | null> {
  if (!state.stravaConnected) return null;
  // Read last 8 weeks of runs from `runs` table
  // Dedupe via canonicalMileageByDay
  // Return null if < 5 runs (light-history threshold)
  // ...
}
```

The < 5 runs threshold drives "light history" UX (per design brief path map).

---

### TASK B3 · `lib/onboarding/initial-name.ts` (new · ~30 lines)

Server-side best-effort name pull. Used by Step3Confirm.

```ts
export async function resolveInitialName(state: OnboardingState): Promise<string | null> {
  // 1. URL ?name= wins (back-button workflow)
  if (state.name) return state.name;
  // 2. Strava token → firstname from athlete profile
  // 3. Existing profile.full_name (returning user · shouldn't happen but safe)
  // 4. null
}
```

---

### TASK B4 · Race history capture (new)

Per design brief Tier 3 / Race history section. New section on Step 1b (between TT goal and weekly target).

**Backend additions:**

```sql
-- Migration · new column on profile
ALTER TABLE profile ADD COLUMN race_history JSONB DEFAULT '[]'::jsonb;
-- Shape: [{distance, timeSec, raceDate, source}, ...]
```

```ts
// lib/onboarding/state.ts · add to OnboardingState
raceHistory: Array<{
  distance: '5k' | '10k' | 'half' | 'marathon' | 'other';
  otherDistanceMi?: number;
  timeSec: number;
  whenRaced: '<6mo' | '6-12mo' | '1-2yr' | '2+yr';
}>;
```

URL codec encodes as compact `rh=5k:1320:lt6mo;10k:2840:6_12mo` (semicolon-separated tuples). Decoder validates each tuple.

**Frontend:** new `RaceHistorySection` component in Step1bGoalDetails, between TT goal and weekly target. "No, first race" → empty array · "Yes" → expandable entry form (distance chip + time chip ladder + when chips).

**Persistence:** `/api/onboarding/complete` reads `body.raceHistory`, validates each entry, writes to `profile.race_history`.

---

### TASK B5 · Strava callback returnTo (fix open bug)

**Problem:** Step2Signals.tsx comment notes the Strava OAuth round-trip drops the runner on `/today` instead of returning to `/onboarding?step=signals&strava=connected`. They have to navigate back.

**Fix:** thread a `returnTo` param through the OAuth handler.

```ts
// app/api/auth/strava/route.ts · GET handler
const returnTo = url.searchParams.get('returnTo');
if (returnTo) {
  // Encode into state param (Strava preserves it through round-trip)
  state = JSON.stringify({ csrf, returnTo });
}

// callback handler
const stateObj = JSON.parse(decodeStateOrEmpty(callbackState));
const dest = stateObj.returnTo && isValidReturnTo(stateObj.returnTo)
  ? stateObj.returnTo
  : '/today';
return NextResponse.redirect(new URL(dest, req.url));
```

`isValidReturnTo` allowlist: `/onboarding`, `/today`, `/settings`. Prevents open-redirect.

Step2Signals.tsx then calls:

```ts
fetch('/api/auth/strava?action=connect&returnTo=/onboarding?step=signals&strava=connected')
```

---

### TASK B6 · Voice band scoring (new · ~120 lines)

**Module:** `lib/coach/voice-band.ts`

```ts
export type VoiceBand = 'calibration' | 'guided' | 'challenge';

export interface VoiceBandReason {
  band: VoiceBand;
  confidence: number;            // 0-1
  reasons: string[];             // ["first race ever", "<14 days HRV history", ...]
}

export async function computeVoiceBand(userUuid: string, state: CoachState): Promise<VoiceBandReason> {
  const raceHistory = await loadRaceHistory(userUuid);
  const vdotConfidence = await loadVdotConfidence(userUuid);
  // ... weighting per design brief band definitions
}
```

**Triggers per design brief:**

- 0 race history OR vdot.confidence < 0.4 → calibration
- 1 recent race OR vdot.confidence 0.4-0.7 → guided
- 2+ recent races OR vdot.confidence > 0.7 → challenge

**Adjustments:**

- New race result lands → recompute (typical: step up)
- Goal time >10% off projected for 14+ days → step down
- Subjective check-in disagrees with objective 5+ days → soft-cap at guided

**Surface:** add `voiceBand: VoiceBandReason` to `CoachState`. Brief envelope reads it for headline + preRunCue copy authoring.

---

### TASK B7 · Calibration session (new)

Per design brief decision #3 — "let's pace your first easy run together."

**New table:**

```sql
CREATE TABLE calibration_sessions (
  id SERIAL PRIMARY KEY,
  user_uuid UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  run_id TEXT,                         -- references runs.data->>'id'
  calibrated_easy_pace_s_per_mi INT,
  confidence DECIMAL(3,2),             -- 0-1
  pillars JSONB                        -- { hrDrift, paceVariance, ... }
);
CREATE INDEX ON calibration_sessions (user_uuid);
```

**Trigger surfaces:**

1. Today screen banner when `voiceBand === 'calibration'` AND no completed `calibration_session` exists
2. iPhone watch app prompt at start of first run

**Engine:**

```ts
// lib/coach/calibration.ts
export async function startCalibrationSession(userUuid: string): Promise<{id: number}>;
export async function completeCalibrationSession(userUuid: string, runId: string): Promise<{
  calibratedEasyPaceSPerMi: number;
  confidence: number;
}>;
```

`completeCalibrationSession` reads:
- avg pace over miles 2-3 (skip mile 1 · warmup variance)
- HR drift (mile 3 HR vs mile 1 HR · should be small on Z2)
- pace variance across the run

Calibrated easy pace = mile-2-3 avg pace, ±15s confidence band tightens to ±5s after 3 successful easy runs.

**Coach intent on completion:** `calibration_completed` · field `easyPaceSPerMi` · value derived band. The brief reads this and transitions voice band calibration → guided automatically.

**Voice copy on calibration run:**

```
Today's Day 1 · calibration run.

Run 3 miles however feels easy. We'll learn your pace from the first
3 miles and tune everything from there. No targets — just an honest
easy effort.
```

---

### TASK B8 · Ultra distance support

Per design brief distance coverage section.

**Type extension:**

```ts
// lib/onboarding/state.ts
export type RaceDistance =
  | '5k' | '10k' | 'half' | 'marathon'
  | 'ultra-50k' | 'ultra-50mi' | 'ultra-100k' | 'ultra-100mi'
  | 'none';
```

**Generator changes (`lib/plan/generate.ts`):**

- New `distanceMiOf` cases:
  - `ultra-50k` → 31.07
  - `ultra-50mi` → 50.0
  - `ultra-100k` → 62.14
  - `ultra-100mi` → 100.0
- New plan templates in `lib/plan/templates/ultras.ts`:
  - `template_ultra_50k_v1` (Magness-leaning)
  - `template_ultra_50mi_v1` (Magness + Koop)
  - `template_ultra_100k_v1` (Koop · experimental)
  - `template_ultra_100mi_v1` (Koop · experimental)
- `template_id` propagates to plan_workouts for telemetry
- Plans 100K+ write a coach intent `experimental_template_active` on creation · surfaces a chip on /today

**Onboarding label mapping (complete/route.ts):**

```ts
function raceDistanceLabel(distance: string): string {
  switch (distance) {
    case '5k':           return '5K';
    case '10k':          return '10K';
    case 'half':         return 'Half Marathon';
    case 'marathon':     return 'Marathon';
    case 'ultra-50k':    return 'Ultra 50K';
    case 'ultra-50mi':   return 'Ultra 50 Mile';
    case 'ultra-100k':   return 'Ultra 100K';
    case 'ultra-100mi':  return 'Ultra 100 Mile';
    default:             return distance.toUpperCase();
  }
}
```

`distanceMiOf` in race resolution needs the same updates (it parses race meta.distanceLabel).

---

### TASK B9 · Schedule constraints + niggle + strength habit capture

Three Tier-3 inputs from the design brief. All optional, all on Step 1b (or Step 2 for strength).

**Schedule constraints:**

```ts
// OnboardingState additions
scheduleConstraints: 'weekends_ok' | 'weekdays_only' | 'specific_days' | null;
allowedDows: number[] | null;  // [1,3,5] for MWF when specific_days
```

**`POST /api/onboarding/complete` mapping:**

```ts
if (scheduleConstraints === 'weekdays_only') {
  qualityDows = [2, 4];        // Tue/Thu
  longRunDow = 5;              // Fri
  restDow = 6;                 // Sat
} else if (scheduleConstraints === 'specific_days' && allowedDows) {
  // Map quality + long + rest within allowedDows
  // ...
} else {
  // default Sun long / Tue+Thu quality / Sat rest
}
```

Writes to `user_prefs.long_run_dow`, `user_prefs.quality_dows`, `user_prefs.rest_dow`.

**Niggle capture (Step 1b):**

```
NIGGLE OR INJURY · optional

  [ Nothing right now ]
  [ Yes — let me describe ]

When "Yes" tapped:
  Body part chips: knee · shin · calf · foot · hip · back · other
  Severity chips:  mild · moderate · flare
  Side chips:      left · right · both
  Status chips:    just started · few days · weeks
```

Writes a `niggles` row on onboarding completion. Existing `lib/coach/standing-recommendation.ts` + `lib/faff/glance-adapter.ts` already read active niggles → no engine changes needed.

**Strength habit (Step 2 · below the three signal tiles):**

```
DO YOU DO STRENGTH TRAINING? · optional

  [ Not yet ]  [ Sometimes ]  [ 1-2x/week ]  [ 3+x/week ]
```

Writes to new column `profile.strength_habit_at_onboarding`. Strength recommender reads this to decide whether to surface recommendations from day 1 ("Not yet" → suppressed for first 2 weeks; "3+x/wk" → 2 days/wk recommended immediately).

---

## Frontend work · 6 tasks

### TASK F1 · Update Step1Goal · add ultra distances

```tsx
const DISTANCES = [
  { value: '5k',          label: '5K' },
  { value: '10k',         label: '10K' },
  { value: 'half',        label: 'Half' },
  { value: 'marathon',    label: 'Marathon' },
  { value: 'ultra-50k',   label: 'Ultra 50K' },
  { value: 'ultra-50mi',  label: 'Ultra 50mi' },
  { value: 'ultra-100k',  label: 'Ultra 100K', experimental: true },
  { value: 'ultra-100mi', label: 'Ultra 100mi', experimental: true },
  { value: 'none',        label: 'No specific race', wide: true },
];
```

Experimental chips render with a small "EXPERIMENTAL" badge on hover/long-press. Grid changes from 2-col to 3-col on desktop to fit · stays 2-col on phone.

---

### TASK F2 · Step1bGoalDetails · 3 new sections

Add (in this order, between existing sections):

1. **Race history** (NEW section between TT goal and weekly target)
2. **Niggle / injury** (NEW section between weekly target and history)
3. **Schedule constraints** (NEW section above weekly target)

Each section uses the existing `Section` + `Chip` primitives. No new layout primitives needed.

---

### TASK F3 · Step2Signals · strength habit chip group

Below the three signal tiles, above Continue:

```tsx
<Section header="DO YOU DO STRENGTH TRAINING?" optional>
  <ChipRow>
    {['not_yet', 'sometimes', '1-2', '3+'].map(...)}
  </ChipRow>
</Section>
```

Same chip pattern as Step1b.

---

### TASK F4 · Step3Confirm · coaching style picker

Above the T2 physiology block:

```tsx
<FormRow label="COACHING STYLE" hint="HOW MUCH BACKGROUND DO YOU WANT?">
  <div style={{ display: 'flex', gap: 10 }}>
    {[
      { value: 'minimal', label: 'Just the plan' },
      { value: 'standard', label: 'Plan + why' },
      { value: 'full', label: 'Tell me everything' },
    ].map(...)}
  </div>
</FormRow>
```

Writes to `profile.coaching_style`. Voice envelope reads it to decide rendered verbosity (existing render-side filter on brief composition).

---

### TASK F5 · CompletionScreen · render real plan

**Remove the fudge.** The plan IS generated by `/api/onboarding/complete` (race-prep or maintenance). Surface the real numbers.

```tsx
interface CompletionScreenProps {
  state: OnboardingState;
  /** Plan summary fetched from `/api/plan/summary?planId=X` after completion. */
  planSummary: {
    mode: 'race-prep' | 'maintenance' | 'starter';
    weeksGenerated: number;
    peakMpw: number;
    phases: Array<{ label: string; startWeekIdx: number; endWeekIdx: number; peakMpw: number }>;
    firstWorkout: {
      dateISO: string;
      type: string;
      mi: number;
      paceTarget: string | null;
      subLabel: string | null;
    };
    daysToRace: number | null;
  } | null;
}
```

**Backend addition:** `GET /api/plan/summary?planId=X` returning the above shape. Internal, no auth issues (the runner just created the plan).

**Skip-all variant:** when `planSummary.mode === 'starter'`, render the "first 2 weeks calibration" framing.

---

### TASK F6 · Today screen · first-morning meta-line

When `coach_state.is_first_morning === true`, the readiness card prepends a meta-line above the headline:

```
Based on [your 18 Strava runs / your chip answers / first-run defaults], I'm
assuming your easy pace is around 8:45. I'll tighten this after your first
easy run — tell me if it feels wrong.
```

Source variables:
- `state.recentRuns.length > 5` → "your 18 Strava runs" (real count)
- `state.histAvg` non-null + no Strava → "your chip answers"
- Neither → "first-run defaults"

**Backend addition:** `CoachState.isFirstMorning: boolean` · true when `profile.onboarded_at` was today AND `coach_intents` has no prior morning brief render for this user. Cleared automatically after first render OR after midnight.

---

## iOS work · 3 tasks

### TASK iOS1 · Onboarding entry point

iPhone currently has no native onboarding · runners hit a web flow via Safari from the iPhone app's "Get started" link. **iPhone agent confirms preference: keep onboarding web-flow-only for v1.**

Per the locked "iPhone stays fully native · no web-views" rule, the iPhone app should NOT embed the web onboarding in WKWebView. Instead:

- Tap "Get started" on iPhone → opens Safari to `/onboarding` (system browser)
- Onboarding completion writes the user_uuid + auth cookie
- Runner returns to iPhone via universal link `runcino://today` (Safari banner offers this) or manual app switch
- iPhone polls `/api/coach/today` and detects the new user_uuid · loads /today natively

The web-onboarding-then-native-app pattern is industry standard (Strava, Whoop, etc.) and keeps the iPhone agent's "professional and serious" bar.

### TASK iOS2 · First-morning meta-line decoding

Add to the iPhone's brief Decodable struct (lenient default false):

```swift
struct BriefEnvelope: Codable {
  // ...
  let isFirstMorning: Bool?

  enum CodingKeys: String, CodingKey {
    case isFirstMorning = "is_first_morning"
    // ...
  }
}
```

Render the meta-line above the headline when `isFirstMorning == true`.

### TASK iOS3 · Calibration session prompt on watch

When `voiceBand === 'calibration'` and no completed calibration session exists, the watch app's "Start workout" screen surfaces:

```
TODAY · CALIBRATION RUN

Run 3 mi at easy effort. We'll learn your pace.

[ Start ]    [ Just run ]
```

Tap "Start" → calls `POST /api/coach/calibration/start` → creates session
Tap "Just run" → starts normal workout, calibration completes anyway on run write

---

## Build order · 4 phases

### Phase 1 · MVP unblock (David's wife · today/tomorrow)

Goal: any runner can complete onboarding from web and land on /today with a real plan.

1. **B1** wire `/onboarding/page.tsx` to Lilian deck
2. **B2** strava-history loader (so Step 1b pre-fill works)
3. **B3** initial-name loader
4. **B5** Strava callback returnTo fix
5. **F1** ultra distance chips (optional for wife · she's 5K/10K, but cheap)
6. **F5** CompletionScreen real-plan render
7. **F6** Today first-morning meta-line + backend `isFirstMorning` flag

Verify: David's wife signs up via web, picks 5K, gets a real plan, lands on /today.

### Phase 2 · Voice + calibration

Goal: first-time runners get calibration + adaptive voice.

1. **B6** voice band scoring
2. **B7** calibration session (backend + table)
3. **iOS3** watch calibration prompt
4. **F4** Step3 coaching style picker

Verify: cold-start user with no race history sees calibration banner on /today, taps to start, run completes, voice transitions calibration → guided automatically.

### Phase 3 · Coverage breadth

Goal: every input from the design brief Tier 0-3 is captured.

1. **B4** race history capture
2. **B9** schedule constraints + niggle + strength habit
3. **F2** Step1b 3 new sections
4. **F3** Step2 strength habit chip group
5. **B8** ultra distance support (full plan templates)

Verify: 6 personas (cold-start, light-history, returning, ultra, no-race, skip-all) all generate honest plans.

### Phase 4 · Returning runner polish

Goal: existing users get gap-prompts.

1. iOS2 forward-compat decoding
2. "We don't have your birthday — tap to add" gap chip on /today for returning users with missing T2 fields
3. Settings UI parity with onboarding inputs (existing settings page already has most)

---

## Verification matrix · 6 personas × every input

| Persona | Strava | HK | Race goal | Goal time | History chips | Niggle | Schedule | Strength | Expected outcome |
|---|---|---|---|---|---|---|---|---|---|
| **Wife** (5K/10K, no Strava, light HK, some race history) | ✗ | partial | 5K | optional | yes | no | weekends-ok | sometimes | Race-prep 5K plan · calibration mode voice (no Strava) · light-history pre-fill skipped · readiness pillars partial |
| **David** (returning, 100+ runs, full HK, marathon goal) | ✓ | ✓ | marathon | yes | auto from Strava | no | weekends-ok | 3+ | Race-prep marathon plan · challenge mode voice · full readiness · plan honors Strava peak long-run |
| **Cold-start beginner** (no connections, first race ever, 5K goal) | ✗ | ✗ | 5K | aspirational | required | no | weekends-ok | not-yet | Race-prep 5K plan · calibration mode voice · banner: "Day 1 calibration run" · skip-all-style framing |
| **Ultra runner** (returning, Strava+HK, picks 100K) | ✓ | ✓ | ultra-100k | yes | auto from Strava | no | weekends-ok | 3+ | Ultra-100K plan (experimental v1) · challenge voice · "experimental template" chip on /today · back-to-back long runs in week structure |
| **Maintenance runner** (HK only, no race) | ✗ | ✓ | none | no | required (chips) | no | weekdays-only | 1-2 | Maintenance plan · guided voice · weekday-only schedule · 35 mpw target |
| **Skip-all** (no connections, no race, just name + tz) | ✗ | ✗ | none | no | chips: 15mi/3 days | no | weekends-ok | not-yet | Starter block · calibration mode voice · readiness card empty with connect prompt · first-morning meta-line: "based on first-run defaults" |

### Per-persona acceptance criteria

For each persona:

- [ ] Completes onboarding without errors
- [ ] Lands on /today with a generated plan (or honest deferral message)
- [ ] First morning brief renders with appropriate voice band
- [ ] Meta-line cites correct data source ("Strava runs" / "chip answers" / "defaults")
- [ ] Plan is non-empty on /plan
- [ ] Readiness card behaves correctly (full / partial / empty)
- [ ] No console errors
- [ ] No 500s on `/api/coach/today`, `/api/glance`, `/api/coach/recovery-brief`

---

## Database migrations summary

```sql
-- Migration · race history JSONB
ALTER TABLE profile ADD COLUMN race_history JSONB DEFAULT '[]'::jsonb;

-- Migration · onboarding-derived fields
ALTER TABLE profile ADD COLUMN coaching_style TEXT;          -- 'minimal' | 'standard' | 'full'
ALTER TABLE profile ADD COLUMN strength_habit_at_onboarding TEXT;  -- 'not_yet' | 'sometimes' | '1-2' | '3+'

-- Migration · calibration sessions
CREATE TABLE calibration_sessions (
  id SERIAL PRIMARY KEY,
  user_uuid UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  run_id TEXT,
  calibrated_easy_pace_s_per_mi INT,
  confidence DECIMAL(3,2),
  pillars JSONB
);
CREATE INDEX idx_cal_sessions_user ON calibration_sessions (user_uuid);

-- Migration · voice band cache (optional · for performance)
ALTER TABLE profile ADD COLUMN voice_band TEXT;              -- 'calibration' | 'guided' | 'challenge'
ALTER TABLE profile ADD COLUMN voice_band_computed_at TIMESTAMPTZ;
```

---

## API surface additions

```
POST /api/coach/calibration/start        · creates calibration_session
POST /api/coach/calibration/complete     · marks complete (auto-fired on run write)
GET  /api/plan/summary?planId=X          · returns plan summary for CompletionScreen
GET  /api/coach/voice-band               · returns current band + reasons (debug + iPhone)
```

---

## Universal applicability · NON-NEGOTIABLE

Per the locked doctrine codification (`docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md` § Universal applicability), every rule shipped here must:

- [ ] Read from `user_uuid` — never a hardcoded UUID
- [ ] Activate on any user matching the trigger conditions, not "if David"
- [ ] Have a code location, activation surface, and applies-to column
- [ ] Be unit-testable across the 6 verification personas

**Anti-patterns explicitly banned:**

- `if (userUuid === '0645f40c-...')` branches
- `DEFAULT_USER_ID` inside any onboarding code
- Persona carve-outs ("if this is the wife persona, skip step X")

---

## Citations

- `docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md` · Rules 1-15 + universal applicability
- `Research/15-acwr-load-management.md` · load progression doctrine
- `Research/00b-recovery-protocols.md` · sleep + recovery
- Daniels Running Formula 3e · VDOT + pace tables (cap 85)
- Pfitzinger Faster Road Racing · marathon templates
- Magness · 50K/50mi templates
- Koop · 100K/100mi experimental
- `lib/onboarding/state.ts` · existing URL codec contract
- `app/api/onboarding/complete/route.ts` · existing atomic txn pattern

---

## Open dependencies

None blocking phase 1. Phase 2 calibration session depends on watch app updates · iPhone agent should review.
Phase 3 ultra template authoring is the largest single piece · ~3 days for v1 50K/50mi + ~5 days for 100K/100mi experimental.

---

## What this brief is NOT

- Not a redesign of the Lilian deck visuals · those are locked
- Not a chat-onboarding spec · the deck is chip-driven, no LLM conversation
- Not coverage for ages <13 / non-runners / multi-sport · scope is running, 13+
- Not a settings parity sweep · existing settings page is out of scope
