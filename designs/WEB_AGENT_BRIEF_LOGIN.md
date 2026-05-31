# Web agent · Implement the sign-in surface

## TL;DR

Implement the Faff web sign-in screen from `designs/faff-web-signin.html` against
the existing `web-v2/` backend. **Apple is the only working path.** Render the
Google + email buttons as the design shows (visual parity) but mark them as
deferred · no functional handler yet.

## Coverage protocol · maintained by you as you work

`docs/BACKEND_FRONTEND_COVERAGE.html` is a running log of every backend
capability and whether it's surfaced in a frontend client. **You append to
it** as you discover backend capabilities the design doesn't render. Plain
English, sorted by app page, with a recommendation (design tweak needed
vs. can add inline vs. safe to leave). Read the "How to use this doc"
section at the top of that file before you start · the append format is
locked there. Don't delete other entries · only add.

This protocol exists because today's audit caught fueling computed-and-
discarded, weather pipeline silently broken, 21 doctrine rows queryable
with no /learn page. Without this feedback loop, every backend capability
not in your design becomes silent dead code. Catch it as you write.

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

### 2. Google + Email buttons · visual only, no handler

The Google and email buttons stay in the design for visual fidelity but are
not wired in this PR. `onClick` for both → small toast "Coming soon · use
Continue with Apple for now." Style them at full opacity (don't grey them ·
the design treats all three buttons as equally polished) · they're functional
no-ops, not visibly disabled.

No `/api/auth/email` or `/api/auth/google` routes get built in this PR.

### 3. New probe `web-v2/scripts/_sim_login_surface.mjs`

Static-audit probe that asserts:
- `/login` page exists and contains `data-test="signin-apple"`, `signin-google`,
  `signin-email` markers (add these to the buttons even though Google and
  email are deferred · future PRs will need to find them)
- Apple route still works (don't break it)
- Cookie name is `faff_session` (consistent with SSR loaders)
- The Google and email buttons fire a toast but make no fetch

The probe runs in static mode (file-existence + route-signature checks) by
default; pass `--live` to actually exercise the Apple flow with a synthetic
session.

## What you do NOT have to build (out of scope)

- `/forgot-password` flow · the design references it as "later in
  /forgot-password-v4.html" but it's not in this scope
- Onboarding screens (role pick · connect sources · target · projection) · those
  exist as later steps in `Faff Web App.html` lines 1726-1749 but are a
  separate workstream
- Email verification flow · `email_verified_at` stays NULL for now
- Magic-link auth · explicitly not in this design
- Two-factor · not in this design

## How David signs in

Click "Continue with Apple." His Apple ID is `dnitch85@me.com` which matches
his `users.email`. The existing `/api/auth/apple` route looks up by email,
finds his row, mints session, sets cookie, redirects to `/today`. **Click →
done.** No script · no password · no setup. His 91-workout marathon-prep plan
renders on first paint.

## Acceptance criteria

The PR is complete when:

1. `npx tsc --noEmit` passes in `web-v2/`
2. All 10 backend probes still pass
3. `_sim_login_surface.mjs` passes
4. The `/login` route renders pixel-close to `designs/faff-web-signin.html`
   (open both in a browser side-by-side; the production version drops the
   `.win` mockup wrapper — full viewport instead)
5. David clicks "Continue with Apple" and lands on `/today` with his data
   visible (8/8 david-intact pass post-login). The Google and email buttons
   fire a toast but don't break the flow.
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
feat(auth): web sign-in screen wired to Apple

Implements designs/faff-web-signin.html. Apple is the working path;
Google + email buttons render at full visual fidelity per the design
but fire "Coming soon" toasts in this PR (deferred to future work).

New: /login route + _sim_login_surface probe. All 10 backend probes
+ tsc still pass.

Closes: web sign-in surface gap flagged in docs/AUDIT_FINAL_2026-05-30.html
```

Push to main. Pre-push hook will reject if tsc fails.

Don't open a PR · the repo's workflow is push-to-main, verified by hooks.
