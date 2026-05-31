# Web agent · Implement the sign-in surface

## TL;DR

Implement the Faff web sign-in screen from `designs/faff-web-signin.html` against
the existing `web-v2/` backend. Apple sign-in already works. Build Google +
email/password to match.

## Read these in order before writing any code

1. **`designs/faff-web-signin.html`** · the canonical pixel spec, self-contained
2. **`designs/faff-web-design-bundle/CLAUDE.md`** · project rules (no em dashes,
   etc.)
3. **`designs/faff-web-design-bundle/HANDOFF.md`** · type system + color rules
4. **`designs/faff-web-design-bundle/colors_and_type.css`** · token source of
   truth · drop these tokens into `web-v2/app/globals.css` if not already there
5. **`designs/faff-web-design-bundle/color-system.md`** · canonical color export
6. **`docs/data-architecture-2026-05-30.html`** · backend data + auth contract
7. **`docs/AUDIT_FINAL_2026-05-30.html`** · what's working / what's not
8. **`web-v2/app/api/auth/apple/route.ts`** · the cookie/session-mint pattern to
   mirror (line 159 is where the cookie gets set — copy that exact pattern)
9. **`web-v2/lib/auth/session.ts`** · `requireUserId` / `requireUserIdFromCookies`
   helpers · use these everywhere

## Hard rules

- **Type system locked**: Anton = brand wordmark only · Oswald = display +
  ALL numerics · Inter = body / labels / buttons
- **NO em dashes** anywhere in code, comments, copy, UI text. Periods, commas,
  or middot `·`. En dashes only for numeric ranges
- **NO inventing accent colors** · pull from `colors_and_type.css` or
  `color-system.md`
- **NO LLM** in the auth flow · everything deterministic
- **NO breaking the probe suite** · all 10 must still pass after your work:
  - `_sim_cold_start_full`
  - `_verify_david_intact`
  - `_audit_orphans`
  - `_verify_uuid_unification`
  - `_verify_niggle_trigger`
  - `_verify_workout_library`
  - `_smoke_weather_lookup`
  - `_sim_unauthenticated`
  - `_sim_ssr_unauthenticated`
  - `_verify_fueling_clamp`

## What to build

### 1. Route `web-v2/app/(auth)/login/page.tsx`

Match `designs/faff-web-signin.html` pixel-perfectly. Server Component is fine
since there's no auth state to read. Wrap the auth buttons in a Client Component
where the `onClick` handlers need to live.

Visual checklist (verify against the standalone HTML):
- Two-column layout · left rail 44% · right panel 56%
- Animated teal effort mesh background (the 5-blob system at the top of
  `faff-web-signin.html`)
- `Faff·Run` wordmark in Anton with gradient sweep, dot in `--amber-gold`
- Eyebrow `RUN WITH INTENT` · 12px Inter 700 letter-spacing 3px opacity .72
- Display headline in Oswald 74px 600 line-height .9 letter-spacing -.5px ·
  the word `coached.` uses the amber gradient
- Sub copy 17px Inter 500 line-height 1.5 opacity .86
- Temperature bar gradient (cool to hot, the effort temperature)
- Glass panel right · `rgba(17,20,26,.92)` · 22px radius · 16px blur
- `SIGN IN` label top-right of the panel
- Apple button white background · Google button glass · email button text-only
- Fine-print bottom · agreement copy
- Subtle grain overlay (the SVG-encoded fractal noise) and the bottom-fade

### 2. New API route `POST /api/auth/email`

Email/password sign-in. Pattern after `web-v2/app/api/auth/apple/route.ts`.

Request body:
```ts
{ email: string; password: string }
```

Steps:
1. Validate shape (zod or manual)
2. `SELECT id, password_hash, status, onboarding_complete FROM users WHERE email = $1`
3. If no row OR status != 'active' OR no password_hash → 401
4. `bcrypt.compare(password, password_hash)` · if false → 401 (use `bcryptjs`
   for Edge compatibility; if Node-runtime, regular `bcrypt` is fine)
5. INSERT a `sessions` row with token + expires_at (mirror apple route line ~140)
6. `res.cookies.set('faff_session', sess.token, { httpOnly: true, secure: prod,
   sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 })`
7. Update `users.last_login_at = NOW()`
8. Return `{ ok: true, redirect: onboarding_complete ? '/today' : '/onboarding' }`

### 3. New API route `POST /api/auth/google`

OAuth flow. Use NextAuth or `@auth/core` if it's already a dependency; otherwise
direct OAuth (lighter). On callback:
1. Verify Google ID token (via `google-auth-library` or jwks endpoint)
2. Look up `users WHERE email = $googleEmail` · if not found, INSERT new row
   (`status='active'`, `is_admin=false`, `onboarding_complete=false`)
3. Mint session + set cookie exactly like email route
4. Redirect to `/today` or `/onboarding`

Strong recommendation: stub the Google route as `501 NOT IMPLEMENTED` in this
PR and hide the button (or grey it with a "Coming soon" hover) if OAuth setup
adds too much scope. The user is iPhone-first; Apple is the primary path. Don't
block the PR on Google.

### 4. Helper script `web-v2/scripts/_reset_user_password.mjs`

Idempotent password-reset utility for the user (and any future user setup).
Reads email + password from STDIN (NOT command-line args, to avoid shell
history). Bcrypts the password. Updates `users.password_hash`. Verifies the
hash works by running `bcrypt.compare` round-trip.

Usage:
```
node scripts/_reset_user_password.mjs
> email: dnitch85@me.com
> password: ******
✓ password_hash updated for user 0645f40c-...
```

This is how David sets his own password without typing it into git or chat.

### 5. New probe `web-v2/scripts/_sim_login_surface.mjs`

Static-audit probe that asserts:
- `/login` page exists and contains `data-test="signin-apple"`, `signin-google`,
  `signin-email` markers (add these to the buttons)
- `POST /api/auth/email` exists and returns 401 on bad creds, 200 on good
- `POST /api/auth/google` exists (even if 501)
- Apple route still works (don't break it)
- Cookie name in all three is `faff_session` (consistent with SSR loaders)

The probe runs in static mode (file-existence + route-signature checks) by
default; pass `--live` to actually POST to the routes with synthetic creds.

## What you do NOT have to build (out of scope)

- `/forgot-password` flow · the design references it as "later in
  /forgot-password-v4.html" but it's not in this scope
- Onboarding screens (role pick · connect sources · target · projection) · those
  exist as later steps in `Faff Web App.html` lines 1726-1749 but are a
  separate workstream
- Email verification flow · `email_verified_at` stays NULL for now
- Magic-link auth · explicitly not in this design
- Two-factor · not in this design

## How to set David's account up for first login

After your code is merged, run from the project root:

```bash
cd web-v2
node scripts/_reset_user_password.mjs
# email: dnitch85@me.com
# password: <choose interactively>
```

David's `users` row already exists (`id 0645f40c-…`, `is_admin true`,
`onboarding_complete true`). After this script runs, he can sign in with the
new email path immediately and land on `/today` with all his data visible.

## Acceptance criteria

The PR is complete when:

1. `npx tsc --noEmit` passes in `web-v2/`
2. All 10 backend probes still pass
3. `_sim_login_surface.mjs` passes
4. The `/login` route renders pixel-close to `designs/faff-web-signin.html`
   (open both in a browser side-by-side; the production version drops the
   `.win` mockup wrapper — full viewport instead)
5. David runs `_reset_user_password.mjs`, then submits the email form, then
   lands on `/today` with his data visible (8/8 david-intact pass post-login)
6. Cold-start user (no session) hitting `/login` sees the form. Hitting any
   protected route (e.g. `/today`) redirects them to `/login`
7. The middlware / SSR cookie check from `web-v2/components/faff-app/seed.ts`
   already redirects unauthenticated visitors away from `/faff/*` · confirm it
   sends them to `/login` (not a guest state) post-build

## Things that will trip you up

- The session-cookie name MUST be exactly `faff_session` · the SSR loaders
  in `lib/auth/session.ts:userIdFromCookies` look for this exact name
- `requireUserId` returns `string | NextResponse` · the API routes need
  `if (auth instanceof NextResponse) return auth;` (or wrap in the
  AcceptOk/AcceptErr pattern like `app/api/coach/proposal/[id]/accept/route.ts`)
- `users.email` is typed as `citext` (case-insensitive) · don't toLowerCase()
  before query · the DB handles it
- The Anton font is wordmark-only · don't use it for anything else
- All numerics in the design use Oswald, not a monospace · if you see numbers
  rendering in Inter or JetBrains Mono in your build, you've got the wrong font
- `colors_and_type.css` is the source of truth · don't pick alternative HEX
  for buttons / borders / accents
- The `--win` wrapper in the standalone HTML is mockup-only · drop it for
  production · `.gate` fills the viewport
- The mesh palette for sign-in is `PAL.teal` (cool · welcoming entry) · later
  onboarding steps shift to `warm` / `amber` / `red` as the user commits ·
  for THIS scope, only teal matters

## When you're done

Commit and push to main with a single commit message:

```
feat(auth): web sign-in screen + email/password + Google stub

Implements designs/faff-web-signin.html. Three auth paths:
  - Apple: existing /api/auth/apple (unchanged)
  - Email: new /api/auth/email (bcrypt password, sets faff_session cookie)
  - Google: new /api/auth/google (501 stub for now; button shown but greyed)

New: /login route · _reset_user_password.mjs helper · _sim_login_surface
probe. All 10 backend probes + tsc still pass.

Closes: web sign-in surface gap flagged in docs/AUDIT_FINAL_2026-05-30.html
```

Push to main. Pre-push hook will reject if tsc fails.

Don't open a PR · the repo's workflow is push-to-main, verified by hooks.
