# Runcino v4 — Local Build

The v4 redesign, wired together as a functional local app. Open `designs/runcino.html` in a browser (or hit `localhost:4040/designs/runcino.html`) to launch it.

## What's working

### Single entry point
`runcino.html` is a thin SPA wrapper that iframes the v4 site. You land on Overview; the nav inside each page drives between Overview → Training → Races → Health (and the unapproved Log / Profile drafts).

### Central data hub
**`designs/runcino-store.js`** is the data layer. localStorage-backed, cross-tab synced, exposed as `window.RuncinoStore`. One source of truth that every page reads on load.

```js
RuncinoStore.getState()          // full state
RuncinoStore.logCheckIn({ energy: 7, soreness: 3, stress: 2 })
RuncinoStore.todayCheckIn()      // null or { energy, soreness, stress, loggedAt }
RuncinoStore.recentCheckIns(14)  // array of { date, log } over the last 14 days
RuncinoStore.currentWeekPlan()   // this week's days from the plan
RuncinoStore.todayWorkout()      // today's day from the plan
RuncinoStore.subscribe(fn)       // re-fires when any tab updates state
RuncinoStore.resetState()        // wipe and reseed (debug)
```

The seed state is the current production snapshot — same data the four approved pages were designed around.

### Cross-page check-in
The most visible piece of the central hub:

1. Open Overview → adjust check-in sliders → click **Log Check-In**.
2. Navigate to Health (via the nav). The page loads, reads the store, and reflects the log everywhere:
   - Mini check-in form on the top-right is locked and shows your values
   - The 14-day Check-In Timeline has today's column filled in with three colored bars proportional to your values
   - The hero "Check-In" trend row flips from "Not logged" grey to green with your values

It works in either direction (log on Health → see it on Overview). Cross-tab too — if you open Overview and Health in two tabs, logging in one updates the other live via the `storage` event.

### Best-effort live data
**`designs/runcino-live.js`** tries to fetch `/api/overview` from production on each page load. Currently the production API doesn't set CORS headers, so the fetch is blocked and the embedded snapshot is used. **`web/middleware.ts`** is committed locally with the CORS fix — once the v4 redesign is deployed, live fetching from local mockups starts working.

## Known not-yet-wired

These are date/plan aware in the data, but not yet rendered dynamically (the page markup still has hardcoded values for):

- **Coach-strip date labels** (e.g., "FRI MAY 15 · BASE WEEK 1") — text is hardcoded; needs JS to read `store.today` + `store.plan.currentWeek` and update on load
- **Today's workout hero** on Overview — still shows the Friday Easy + S layout; in a fully dynamic build it would query `RuncinoStore.todayWorkout()` and render rest-day / workout-day / race-day variants
- **This Week strip** on Overview — Mon-Sun columns are hardcoded; would render from `RuncinoStore.currentWeekPlan().days`
- **Training calendar** — should render from `store.plan.weeks` once the full 14-week plan is in the seed (currently only Week 1 is curated)
- **Races / Recent Races** — should render from `store.races`

The store has all this data ready. The page markup just needs to switch from static HTML to template rendering. This is the next-pass refactor — at that point the local build is genuinely functional and ready for the Next.js port.

## File map

```
designs/
  runcino.html             — single entry SPA wrapper
  runcino-store.js         — central state hub (the data layer)
  runcino-live.js          — best-effort live API refresh
  README-v4.md             — this file
  overview-v4.html         — Overview page (approved)
  training-v4.html         — Training page (approved)
  races-v4.html            — Races page (approved)
  health-v4.html           — Health page (approved)
  log-v4.html              — Log page (draft, unapproved)
  profile-v4.html          — Profile page (draft, unapproved)
  race-plan-v4.html        — Race-plan detail (needs trim pass)
web/
  middleware.ts            — CORS for /api/* (sets up live fetch when deployed)
```

## Push live, when approved

The "push live" step is to port `designs/*-v4.html` markup into the corresponding `web/app/*/page.tsx` Next.js components, swap in the API plumbing already wired in the production app, and deploy. The `runcino-store.js` patterns translate cleanly to a Zustand or Context store in React.
