# Practical setup · what David needs ready before native development starts

Everything required on David's end before Swift code is written.  Ordered
by **what has the longest lead time first** — some of this propagates
through Apple's systems for days, so worth kicking off in parallel
while backend gap work proceeds.

**Total cost · year 1**: $99 (Apple Developer Program) + likely $0
(D-U-N-S if needed is free in the US).

---

## Step 0 · Architecture decision · individual vs business enrollment

**Decide before enrolling.  Switching later is painful.**

### Option A · Individual ($99/year)
- Fastest path · usually approved 24-48 hours
- Apps published under "David Nitzsche" (your legal name) in App Store
- Cannot easily move apps to a business account later — requires
  republishing under a new bundle ID, losing reviews/ratings
- Fine for solo developer with no immediate business plans

### Option B · Organization (business · $99/year)
- Apps published under a legal entity (e.g., "Workprint LLC")
- Required if more than one developer should have access to certs / TestFlight
- Required to use a non-personal name in the App Store
- Requires **D-U-N-S Number** (free from Dun & Bradstreet) tied to the
  legal entity · 1-2 business days to assign if not already on file
- Cleanly assignable to other team members later

### Decision factors

| If you intend to ... | Pick |
|---|---|
| Ship under "Workprint" or any business name | **Organization** · do this once, never refactor |
| Ever bring on a developer collaborator | **Organization** |
| Ship under personal name, single dev | **Individual** is fine |
| Stay flexible | **Organization** if Workprint LLC exists; otherwise Individual now and migrate later (with cost) |

**Recommendation**: if Workprint LLC is a real entity you're using or
plan to use commercially, enroll as organization.  The D-U-N-S step
adds 1-2 days but the migration cost later is much higher.

**Time cost · Step 0**: 10 minutes to decide.

---

## Step 1 · D-U-N-S Number (organization path only)

Skip if enrolling as individual.

1. Go to https://developer.apple.com/enroll/duns-lookup/ — Apple's
   own D-U-N-S lookup tool
2. Search for "Workprint LLC" (or whatever the legal entity is)
3. If found · use that D-U-N-S number in step 2
4. If not found · request a new one through the same tool · free · 1-2 business days

**Time cost**: 15 min to request · 1-2 business days to receive
**$ cost**: $0 (request through Apple's tool · never pay third parties for this)

---

## Step 2 · Apple Developer Program enrollment

https://developer.apple.com/programs/enroll/

1. Sign in with Apple ID (your iCloud account) · this becomes the
   Apple Developer account · keep it tied to a real email you read
2. Pick Individual or Organization (per Step 0)
3. If Organization · enter the D-U-N-S Number from Step 1 + legal
   entity details
4. Pay $99 via Apple's checkout
5. Apple sends a verification email · click through
6. Wait

**Time cost**: 30 minutes to submit
**Wait time**: 24-48 hours individual · 1-3 business days organization
**$ cost**: $99/year

Until this completes you cannot register an App ID, generate signing
certs, or upload to TestFlight.  Everything else below depends on
this being done.

---

## Step 3 · Verify Xcode + macOS versions

Required for watchOS 11 development (current watchOS):

- **Xcode 16+** (free from Mac App Store · ~12 GB download · 30-60 min depending on connection)
- **macOS Sonoma 14.5+** (required for Xcode 16) or Sequoia (recommended)

Check current versions:

```bash
sw_vers          # macOS version
xcodebuild -version  # Xcode version (only works if Xcode is installed)
```

**Action**: install Xcode now, in parallel with the enrollment wait.
First launch will install command-line tools + Apple Watch + iOS
simulator (additional ~10 GB).

**Time cost**: 1-2 hours including downloads
**$ cost**: $0

---

## Step 4 · Bundle ID strategy · reserve before code starts

Bundle IDs are reverse-domain identifiers globally unique across all
Apple Developer accounts.  Pick now so naming doesn't bikeshed during
development.

### Recommended structure (companion app pattern)

```
com.workprint.runcino                    · iOS app (parent)
com.workprint.runcino.watchkitapp        · watchOS app
com.workprint.runcino.watchkitapp.watchkitextension  · watchOS extension (legacy projects only · Xcode 16 single-target watch apps don't need this)
group.com.workprint.runcino              · App Group (shared storage between iOS + watchOS)
```

**Pick the parent name carefully** — once an app ships under a bundle
ID it cannot be renamed in the App Store.  Options to consider:

- `com.workprint.runcino` · current domain match
- `com.runcino.app` · simpler, requires owning runcino.com (you do · faff.run is a redirect, runcino is the brand)
- `run.faff.app` · matches user-facing domain · slightly unconventional
- `com.workprint.faff` · if you wanted to brand on "faff"

**Recommendation**: pick the brand name you'll keep · don't optimize
for "looks current."

**Where to reserve**: developer.apple.com → Certificates, Identifiers
& Profiles → Identifiers → "+" → App IDs → App.  Register the parent
ID first; child IDs (watchOS app) get registered when Xcode auto-
creates them on first build.

**Time cost**: 15 min once enrollment completes

---

## Step 5 · Capabilities (entitlements) · enable before App Store review later

Each capability requires explicit enrollment + sometimes a usage
description in Info.plist when the app actually requests permission.
Enable these on the App ID now so they propagate cleanly when code is
ready.

### 5a · HealthKit (essential)
**What it enables**: read/write Health data (sleep, HRV, resting HR,
workout details, VO2max).

**App ID step**: enable "HealthKit" capability on
`com.workprint.runcino` App ID (in Apple Developer portal).

**Code-time step (later)**: add `NSHealthShareUsageDescription` and
`NSHealthUpdateUsageDescription` strings to Info.plist explaining WHY
you read/write each data type.  App Store review reads these strings
carefully; vague descriptions get rejections.

**App Store review nuance**: HealthKit is the most-scrutinized
capability.  Your usage description must be specific (e.g., "Runcino
reads your resting HR to compute training zones") not vague ("for
improved experience").  Plan for one re-review cycle if it's a first
submission.

### 5b · HealthKit Background Delivery
**What it enables**: receive HealthKit updates while app is backgrounded.

Enabled alongside HealthKit capability.  Required for the watchOS app
to push workout completion data back to iPhone (and hence backend)
without the iPhone app being open.

### 5c · Workout Processing (watchOS-specific)
**What it enables**: HKWorkoutSession can run in the background on
Apple Watch (otherwise the workout app dies when the user lowers
their wrist).

**App ID step**: enable "Background Modes" → "Workout processing" on
the watchOS App ID (auto-created when Xcode first builds the watch
target).

### 5d · App Groups
**What it enables**: iOS app + watchOS app share UserDefaults / Keychain
data.

**App ID step**: enable "App Groups" capability, create group
`group.com.workprint.runcino`, assign both iOS and watchOS App IDs
to it.

### 5e · Push Notifications (later · don't need for v0)
**What it enables**: APNs push to iPhone (and via iPhone to watch).

Defer per the reframed priority order.  Enable when the work item
opens up.

### 5f · Sign in with Apple (optional but recommended)
**What it enables**: native Apple ID authentication, no password
required.  Bypasses the entire token-auth flow on the client side
for users who pick this path.

**Recommendation**: enable now even if not used in v0.  Cheaper to
have it ready than to bolt on later.

### 5g · Associated Domains (later · for deep links)
**What it enables**: tapping `https://faff.run/profile` on iPhone
opens the iOS app instead of Safari.

Enable when deep-linking is added · post-MVP.

**Time cost**: 30 min total to enable all 7 in the portal once App ID
is registered

---

## Step 6 · Signing certificates and provisioning profiles

In Xcode 16 with "Automatically manage signing" enabled (default),
this is mostly hands-off.  But understand what's happening:

1. **Development certificate** · for running on your own devices ·
   auto-generated on first Xcode build
2. **Distribution certificate** · for TestFlight / App Store builds ·
   auto-generated on first Archive
3. **Provisioning profile** · ties App ID + certificate + device list ·
   auto-managed by Xcode

**Manual escape hatch**: developer.apple.com → Certificates, Identifiers
& Profiles → Profiles · you can create + download manually if Xcode's
auto-signing misbehaves.  Doesn't usually happen.

**Time cost**: $0 if auto-signing works · 30-60 min if you hit a
provisioning issue

---

## Step 7 · Register your physical devices

Required to build-and-install on your actual Apple Watch + iPhone.

1. Plug iPhone into Mac via cable (USB-C or Lightning)
2. Xcode → Devices and Simulators → trust the device
3. Apple Watch enrolls automatically when paired with a trusted iPhone

You can have up to **100 devices per device class per year** on a
developer account.  Plenty.

**Time cost**: 10 min

---

## Step 8 · App Store Connect setup

https://appstoreconnect.apple.com/

Activated automatically when your developer enrollment completes.

For TestFlight + eventual App Store submission you'll need:

- **App record** · create at App Store Connect → My Apps → "+" → pick
  iOS + watchOS, bundle IDs from step 4
- **App icon** · 1024×1024 PNG · required for TestFlight (placeholder
  ok for v0)
- **TestFlight internal testers** · add yourself as internal tester
  (immediate · no review)
- **App privacy details** · disclose what data Runcino collects · be
  honest (HealthKit data, training data, no analytics if true)

**Time cost**: 1 hour for initial setup · placeholders fine for icon
**$ cost**: $0 (included with developer enrollment)

---

## Step 9 · TestFlight distribution to yourself

Once code exists and a build is archived in Xcode:

1. Xcode → Product → Archive
2. Organizer → "Distribute App" → "App Store Connect" → "Upload"
3. App Store Connect → TestFlight → Internal Testing → add yourself
4. Install TestFlight app on iPhone, sign in, install Runcino
5. Watch app auto-installs to paired Apple Watch

**Time cost per build**: 10-20 min upload + processing wait

---

## Order of operations summary

```
Day 0 (today):
  · Decide individual vs organization (Step 0)
  · If organization · request D-U-N-S (Step 1)
  · Start Xcode + macOS verification (Step 3) in parallel
  · Pick bundle ID strategy (Step 4) — write it down, don't reserve yet

Day 1-2 (D-U-N-S wait if needed):
  · Submit Apple Developer enrollment (Step 2)
  · Confirm Xcode 16+ installed

Day 2-3 (after enrollment approval):
  · Reserve bundle IDs (Step 4)
  · Enable capabilities (Step 5)
  · Register physical devices (Step 7)
  · Create App Store Connect app record (Step 8)

Day 3+ · ready for code.
```

Total elapsed time before first code commit · 3-5 days assuming
no D-U-N-S delays or enrollment review snags.

---

## Apple-account decisions that affect architecture downstream

1. **Individual vs Organization** (Step 0) · most important · hard to
   reverse.

2. **Bundle ID parent name** (Step 4) · once shipped, locked.  Pick
   the brand you'll keep.

3. **HealthKit vs not** · committing to HealthKit means committing to
   App Store review scrutiny + maintaining usage descriptions
   forever.  Worth it (HealthKit is the watch's whole value), but
   know the ongoing review cost.

4. **Sign in with Apple offered or not** · if you offer it once, App
   Store policy requires you to keep offering it.  No downside to
   enabling, so do it.

5. **iCloud / CloudKit** (not used yet · noting for completeness) ·
   if Runcino ever uses CloudKit for sync, that's tied to the Apple
   Developer account permanently.  Not in the v0 scope; flag if
   considering later.

---

## What's NOT on this list

- **APNs Auth Key** (push notifications) · deferred per reframed
  priority order.  When push lands, generate the auth key in App
  Store Connect → Keys → "+" · stash in backend env vars · use with
  any APNs library.

- **App Store review** itself · doesn't block development; only
  blocks public release.  TestFlight internal testing has no review.

- **Beta testers beyond yourself** · TestFlight external testing
  requires a lighter "beta app review" (typically 1-2 days, much
  lighter than full release review).  Skip until you want >1 user.

---

## Open question for David

Individual vs Organization enrollment.  If you have Workprint LLC
already set up and plan to use it for Runcino, go organization.
Otherwise, individual is fine for v0 — accept the eventual migration
cost when/if you incorporate.

Once that's decided + enrollment kicks off, the rest is mechanical.
