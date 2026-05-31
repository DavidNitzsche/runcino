# iPhone agent · Implement Sign In With Apple

## TL;DR

Implement the Faff iPhone sign-in screen from `designs/faff-iphone-signin.html`
in the canonical iPhone app at `native-v2/Faff/Faff/`. Apple is the only
working path. Render Google + email buttons at full visual fidelity per the
design but they fire toasts only (no functional handler).

## Coverage protocol · maintained by you as you work

`docs/BACKEND_FRONTEND_COVERAGE.html` is a running log of every backend
capability and whether it's surfaced in a frontend client. **You append to
it** as you discover backend capabilities the design doesn't render. Plain
English, sorted by app surface, with a recommendation (design tweak needed
vs. can add inline vs. safe to leave). Read the "How to use this doc"
section at the top of that file before you start · the append format is
locked there. Don't delete other entries · only add. The web agent appends
too · sometimes you'll see entries marked "found by WEB" · note them and
move on, or add a "also found by IOS" annotation if relevant on your
platform.

This protocol exists because today's audit caught fueling computed-and-
discarded, weather pipeline silently broken, 21 doctrine rows queryable
with no /learn page. Without this feedback loop, every backend capability
not in your design becomes silent dead code. Catch it as you write.

## Read these in order before writing any code

1. **`designs/faff-iphone-signin.html`** · the canonical pixel spec, self-contained
2. **`designs/faff-iphone-design-bundle/CLAUDE.md`** · project rules (no em dashes)
3. **`designs/faff-iphone-design-bundle/HANDOFF.md`** · the full iPhone build
   spec · includes the SwiftUI `Color+Faff` scaffold and §7 font bundling steps
4. **`designs/faff-iphone-design-bundle/tokens.css`** · iPhone-specific token
   subset · mirrors what's already in `Theme.swift`
5. **`designs/faff-iphone-design-bundle/color-system.md`** · canonical color export
6. **`docs/data-architecture-2026-05-30.html`** · backend data + auth contract
7. **`docs/AUDIT_FINAL_2026-05-30.html`** · what's working / what's not
8. **`web-v2/app/api/auth/apple/route.ts`** · the existing backend endpoint
   the iPhone calls. Reads the Apple ID token, mints a session, returns
   `{ token, user_uuid, expires_at }`. Also sets `faff_session` cookie so
   web SSR lights up automatically on the same Apple account.
9. **`web-v2/lib/auth/session.ts`** · `requireUserId(req)` reads
   `Authorization: Bearer <token>` from the header · this is the iPhone path
10. **`native-v2/Faff/Faff/TokenStore.swift`** · the existing session store ·
    currently uses UserDefaults; the file has its own TODO to migrate to
    Keychain when multi-user goes live · **migrate it as part of this PR**

## Hard rules · locked from `designs/faff-iphone-design-bundle/`

- **Type system locked**: Anton = brand wordmark only · Oswald = display +
  ALL numerics · Inter = body / labels / buttons
- **NO em dashes** anywhere in code, comments, copy, UI text. Periods, commas,
  or middot `·`. En dashes only for numeric ranges
- **NO inventing accent colors** · pull from `Theme.swift` (which mirrors
  `colors_and_type.css`)
- **NO web-views** · this is locked in user memory (`feedback_iphone_no_webviews.md`,
  2026-05-27). No WKWebView wrapping. SwiftUI native, no exceptions
- **NO breaking the backend probe suite** · all 10 must still pass · the iPhone
  agent doesn't change backend, but if you add a route or migration, run them
- **Effort temperature is the visual signature** · per
  `designs/faff-iphone-design-bundle/HANDOFF.md` §3 · sign-in screen uses the
  teal mesh palette (cool · welcoming entry-point) · later onboarding shifts to
  warm/amber/red

## What to build

### 1. Bundle the 3 fonts in the app target (per HANDOFF.md §7)

1. Download Anton, Oswald, Inter from `fonts.google.com/specimen/{Anton,Oswald,Inter}`
2. Add the `.ttf`s to `native-v2/Faff/Faff/Resources/Fonts/` (or wherever the
   existing Resources go)
3. Register in `native-v2/Faff/Faff/Info.plist` under `UIAppFonts`
4. Use via `Font.custom("Oswald-SemiBold", size:)` etc · the existing
   `Fonts.swift` may already wrap this · extend or replace as needed

Validate: a smoke test in the simulator showing the wordmark in Anton
(skewed, gradient sweep) confirms registration worked.

### 2. New view `native-v2/Faff/Faff/Views/SignInView.swift`

Match `designs/faff-iphone-signin.html` pixel-close · adapted to a 393×852
iPhone safe area. Use SwiftUI native components · no HTML rendering.

Layout checklist:
- ZStack with 5 floating teal blobs as the bottom layer (Canvas or
  multiple Circle().blur() ZStacks · re-use the existing mesh code if any
  exists in `native-v2/Faff/Faff/Components/`)
- Subtle grain overlay (texture image or `Canvas` noise)
- Dark scrim gradient from top + bottom
- VStack content over the mesh:
  - Brandmark: `FAFF·RUN` in Anton with the 6-stop gradient sweep, skewed
    `-9°` per HANDOFF.md §7
  - Hero: "Your\nrunning,\ncoached." in Oswald 50pt 900 weight (display)
  - Sub copy: "A plan that adapts every day, built from your own training.
    Let's find your starting line." in Inter 16pt 600 opacity 0.78
  - Auth stack:
    - **"Continue with Apple"** · `SignInWithAppleButton` (the official
      `AuthenticationServices` button) · white background · the bundled
      one, not a custom recreation
    - **"Continue with Google"** · custom styled button per the design ·
      glass background `Color.white.opacity(0.12)` · onClick fires a toast
      (no Google sign-in flow in this PR)
    - **"Sign in with email"** · text-only button · onClick fires a toast
  - Fine print: "By continuing you agree to Faff's Terms & Privacy Policy."
    in Oswald 10pt 600 opacity 0.5 · `Terms` and `Privacy Policy` are
    underline-only links · no actual route in this PR

### 3. Wire Sign In With Apple

Use the native framework, NOT a third-party. Imports:
```swift
import AuthenticationServices
```

Flow:
1. User taps `SignInWithAppleButton`
2. `ASAuthorizationAppleIDProvider().createRequest()` with `.fullName + .email`
   scopes
3. Present via `ASAuthorizationController`
4. On `.success(let auth)`:
   - Extract `auth.credential as? ASAuthorizationAppleIDCredential`
   - Get the `identityToken: Data` (JWT from Apple, signed by Apple's keys)
   - POST it to `POST /api/auth/apple` on the backend with body:
     ```json
     { "identityToken": "<base64-of-token-data>", "user": "<credential.user>",
       "fullName": "<optional first+last>", "email": "<optional>" }
     ```
   - The backend verifies the token, looks up `users WHERE email = $appleEmail`
     (your case: matches `dnitch85@me.com`), mints a session row, returns:
     ```json
     { "ok": true, "token": "<opaque session>", "user_uuid": "<uuid>",
       "expires_at": "<iso>" }
     ```
5. Save to `TokenStore.shared`:
   ```swift
   await TokenStore.shared.save(
     token: response.token,
     userUuid: response.user_uuid,
     expiresAt: response.expires_at
   )
   ```
6. `FaffApp` should observe `TokenStore.shared.isSignedIn` and route to
   `ContentView` (Today) once `true`

### 4. Migrate TokenStore from UserDefaults to Keychain

The file at `native-v2/Faff/Faff/TokenStore.swift` has its own TODO comment
saying "move to Keychain when multi-user goes live." Multi-user is live now
(see `docs/AUDIT_FINAL_2026-05-30.html` · 54 routes hardened · cold-start
verified). Migrate.

Pattern:
- Use `SecItem*` calls or wrap with a small Keychain helper
- Service: `"run.faff.session"`
- Account: `"current"` (single-account device)
- Migrate on first launch: if a token is in UserDefaults, write it to
  Keychain, then `removeObject(forKey:)`
- All `@Published` properties stay; the backing store changes

### 5. Update `API.swift` to attach Bearer on every call

Verify (and fix if missing) that every request in `API.swift` includes:
```swift
if let token = await TokenStore.shared.token {
  req.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
}
```

The watch endpoints `/api/watch/today` and `/api/watch/workouts/complete`
now require Bearer auth and reject `?user_id` query params (per Agent B's
audit fix). The iPhone-watch sync via WatchConnectivity should already pass
the iPhone's session token to the watch, which then includes it as Bearer
on its own API calls. **Verify this still works**.

### 6. 401 handling

Any 401 response from the backend → clear `TokenStore`, route to
`SignInView`. Surface a small toast: "Session expired · sign in again."

### 7. New probe `native-v2/Faff/FaffTests/SignInFlowTests.swift`

XCTest that:
1. Mocks the Apple identity token flow (use a fixture JWT, expected by
   the test-only DI of the network layer)
2. Asserts POST to `/api/auth/apple` happens with the right body shape
3. Asserts `TokenStore.shared.token` is non-nil after success
4. Asserts `FaffApp` routes to ContentView (Today)
5. Asserts API calls now include `Authorization: Bearer` header

## What you do NOT have to build (out of scope)

- Google sign-in functional flow (just the button visual + toast)
- Email/password flow (the legacy `LoginView.swift` at
  `legacy/native/Faff/Faff/LoginView.swift` is reference only; not ported)
- Forgot password / password reset
- Email verification (`email_verified_at` stays NULL)
- Two-factor
- Sign-out UI (Settings already has a row · backend route exists)
- The onboarding flow that fires AFTER signin (rolepick → connect → target →
  projection) · separate workstream

## How David signs in

He clicks "Continue with Apple" on the iPhone. His Apple ID is
`dnitch85@me.com` which matches his existing `users.email`. The Apple
framework returns the identity token, the iPhone POSTs to
`/api/auth/apple`, the backend finds his existing row, mints a session,
returns the token. `TokenStore` saves it. `FaffApp` routes to Today.

**Bonus**: the same Apple route ALSO sets the `faff_session` cookie if
called via web. So if he later opens Safari to `faff.run`, the web SSR
loaders find his cookie and he's signed in there too. One sign-in, both
clients.

## Acceptance criteria

The PR is complete when:

1. The 3 fonts are bundled and `Font.custom("Anton-Regular", size:)` resolves
2. `SignInView.swift` matches `designs/faff-iphone-signin.html` pixel-close
   (open both side-by-side in Xcode preview + browser)
3. `Sign In With Apple` flow completes end-to-end against production:
   David taps button → Apple flow → POST to `/api/auth/apple` →
   `{ ok: true, token, user_uuid: "0645f40c-..." }` → `TokenStore` saves →
   routes to Today
4. Today shows David's 91-workout marathon-prep plan (proves the session
   token is valid for downstream calls)
5. `TokenStore` reads from Keychain (not UserDefaults) post-migration
6. `npx swift build` (or Xcode `Cmd+B`) passes
7. `SignInFlowTests` passes
8. The 10 backend probes still pass (run from `web-v2/`)

## Things that will trip you up

- The `SignInWithAppleButton` API requires a `Color.Scheme` button style ·
  pass `.white` for the dark mesh background to keep contrast
- Anton fonts on iOS render LARGER per pt than Inter/Oswald · the design's
  CSS sizes won't 1:1 map · use Xcode preview, dial in by eye to match the
  pixel spec
- The skew transformation on the wordmark needs `.rotation3DEffect` or a
  `GeometryEffect` · `.scaleEffect(x:y:)` doesn't skew
- The blob mesh is animated at 22–30s loops · Canvas-based animation is
  expensive · pre-render gradients into PNG or use `TimelineView`
- `Color.gradient` doesn't sweep · animate the linear gradient manually with
  `phase` parameter against `Animation.linear.repeatForever`
- `AuthenticationServices` does NOT auto-handle the credential persistence ·
  you persist via `TokenStore`
- Background-launched API calls (notifications, watch sync) must read the
  token from Keychain · UserDefaults-only token will appear nil to
  background contexts that have a different `BundleID` / extension target

## When you're done

Commit and push to main:

```
feat(ios): wire Sign In With Apple to existing backend

Implements designs/faff-iphone-signin.html in native-v2/Faff/Faff/.

- Bundles Anton, Oswald, Inter (per HANDOFF.md §7)
- SignInView.swift renders the teal-mesh sign-in per the design
- AuthenticationServices Sign In With Apple flow wired to
  POST /api/auth/apple
- TokenStore migrated from UserDefaults to Keychain (its own TODO)
- API.swift confirmed to send Authorization: Bearer on every call
- Google + email buttons render at full design fidelity but fire
  "Coming soon" toasts in this PR (deferred)

David's Apple ID dnitch85@me.com matches existing users.email row;
first launch on TestFlight = sign in → Today populated with his
91-workout AFC marathon prep plan.

Closes: iPhone sign-in surface (paired with web sign-in landed earlier)
```

Push to main. Don't open a PR · push-to-main workflow.
