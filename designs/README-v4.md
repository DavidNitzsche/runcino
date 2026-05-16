# Runcino v4 — Local Build

The v4 redesign, wired together so you can open it locally and navigate the whole thing.

## How to test

Open `designs/runcino.html` in a browser (or serve via `localhost:4040` and visit `/designs/runcino.html`). That's the single entry point.

You'll land on the Overview page. The nav at the top of every page links between:

- **Overview** — today's workout hero, readiness, this week's training strip
- **Training** — full 14-week schedule, phase arc, calendar grid, paces
- **Races** — A-race hero, upcoming-races timeline, recent results, PRs
- **Health** — readiness hero, training-load chart, vitals tiles, check-in timeline, insights

Two pages also exist in the nav but aren't approved yet:

- **Log** — draft / unpolished
- **Profile** — draft / unpolished

## Data

The pages all carry **real values** — pulled from production API earlier in the design process and embedded into the HTML. Things you'll see:

- Today = `2026-05-16` (Saturday)
- AFC Half = Aug 16, 2026, 93 days away, goal 1:35:00
- Training Week 1 of 14 (Base phase)
- Recent races: Sombrero, Big Sur, Point Magu, LA Marathon (Mar 15 — Marathon PR), Mouse, Rose Bowl
- Upcoming: AFC Half, Dodgers 10K, Run Malibu, CIM, LA Marathon 2027

If you want fresher data, `designs/runcino-live.js` tries to fetch `/api/overview` from `runcino-production.up.railway.app` on each page load. Currently the production API doesn't set CORS headers, so the fetch is blocked from local origins. The embedded snapshot is used.

The CORS fix is already committed in `web/middleware.ts` — once the v4 redesign is pushed live, the middleware sets `Access-Control-Allow-Origin: *` on `/api/*` and live fetching from the local mockups starts working.

## Next step

When the local build is approved, the "push live" work is to port `designs/*-v4.html` markup into the corresponding `web/app/*/page.tsx` Next.js page components, replacing the current production pages. The Next.js routes already have the API plumbing; we just swap in the new templates.
