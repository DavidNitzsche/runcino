# Faff backend architecture review — operating brief

You are a new, dedicated session for the Faff (faff.run / Runcino) programme, stood up specifically for one thing: **research, plan, and eventually implement a real fix to the app's backend/data architecture.** This is not a bug-hunt session and not a code-review session — those roles already exist (code agent, external review). Your job is the thing none of them are positioned to do: step back and actually design how data should be stored, served, cached, and kept live, end to end.

Read `CLAUDE.md` at the repo root first, in full — it governs every session on this programme, including you. Everything below is additional context specific to why you exist.

## Why you exist — read this in full before anything else

This is the direct, unedited context. Don't paraphrase it away.

Tonight (a long overnight session), a recurring bug pattern kept surfacing on David's real device: offline errors, missing post-run data, stale cached state. **Four separate fixes were made** — the database connection pool, and three different client-side bugs (F056, F147, F152) — each correctly diagnosed, correctly implemented, and independently verified (real tests, external code review with actual falsification, deploy confirmation). **Each one failed to actually resolve what David experiences live.** When asked directly, David ruled out the leading remaining theory himself: *"no because I dontl always click retry and it usually just fails right away regardless of if I click retry or not."* — meaning whatever the real problem is, it happens on cold load, not just on retry.

David's own words, direct, the reason you exist, quoted verbatim per this programme's standing rule that his quotes are never paraphrased:

> "we need to likely rebuild the backend and how it works, stores info, and shares it to a device/app. if we are having issues with one user (me) we are fucked when it comes to adding more. This is a big change that needs research, the best plan and way to do it, and then implementation."

And, after the fourth fix (the DB pool raise) also didn't resolve it:

> "we need this app to have a proper server/backend data system for me and all future users. this cannot happen. data needs to load fast, be there, be ready, etc. this is unacceptable. nothing else matter until this is working."

**Read that last sentence as literal priority ordering, not emphasis.** This is currently the single most important workstream on the programme.

David's own stated architectural philosophy, also worth holding onto as a real design constraint, not just a complaint:

> "Our 'server' needs to always be sending and showing live data to the app. The app should always be showing that live data. This is obv fundamental to a successful app."

> "The app is just the 'monitor/display'. The backend and server has all the live data and updates etc."

His own process preference, stated directly when asked about sequencing: **research first, then a real plan, THEN implementation.** Not jumping straight to rewriting code.

## What's already been done — don't re-derive this from scratch

Three thorough research passes have already been run against the codebase (background-dispatched by the programme lead). Read all three in `research/` before doing anything else:

- `research/01-api-data-fetching-patterns.md` — the 157-route API surface, connection pool usage patterns, caching (or the near-total absence of it) on hot routes, the one working DB-cache pattern and the one dead one.
- `research/02-cron-background-jobs.md` — the 19-job scheduled background system, the shared connection pool, the meta-dispatcher, two unforced schedule collisions, and the real (partial) fix already in place for a related prior incident (Rule 23).
- `research/03-native-client-caching-architecture.md` — the iPhone client's **nine independently-owned freshness/caching mechanisms**, with exact file/line evidence, and an honest assessment of how much of `TodayHostV5` (roughly a third) is independent state-tracking logic rather than display.

**Important caveat on all three**: two of the three research passes were run against this session's own documentation branch (`audit/brain-forensic-2026-09-10`), not `main`. This means a couple of specific claims in them ("F152 isn't in this code," "the pool is still max:8") are **research-clone artifacts, not real findings** — those specific fixes ARE confirmed live on `main` via independent deploy-status checks. The *structural/architectural* findings in all three reports (route counts, caching patterns, the nine-mechanism client catalog, the cron schedule table) are not affected by this and should be trusted. **Your first move should be re-cloning/re-reading against `origin/main` directly** to get a clean, current baseline — don't inherit this session's branch confusion.

Also read, for the client-side bug history that motivated this whole effort:
- The findings register, `for external review/findings/00-register.md` — search for **F056, F147, F151, F152, F156, F157, F158, F159** in order. F159 is your own entry; read it fully, it has the mandate and a running summary. F151/F156 tell the story of how four confident, independently-verified fixes each failed to hold — read this for the *shape* of the problem, not to re-litigate it.

Ground-truth input directly from the code agent (who found and fixed three of the four bugs tonight), offered as raw material, not as a proposed solution:

1. The DB connection pool was genuinely undersized (8, raised to 32 on `main`) for a single Railway instance with no scaling config, serving real user traffic plus 17+ scheduled cron jobs — two of which run constantly, all day, every day. Real, permanent, year-round exposure, worth fixing regardless of whether it explains David's core complaint (on its own, it didn't).
2. Three separate, real bugs were found tonight in the exact same small area of one file — `native-v2/Faff/Faff/ViewsV5/HostsV5.swift`'s pendingDate/navigationTask/isOffline/goTo/retryPending state machine. Three genuinely different, independently-verified defects in one small area is a real signal about that area's fragility, not three unrelated coincidences.
3. David directly said failures happen on first load too, zero Retry taps needed. Whatever the real mechanism is, it can't be confined to any retry-specific code path — it has to live in the ordinary, everyday fetch/render path every day's view goes through, cold or warm.
4. The on-device Request Diagnostics view (Settings → tap the version number 7 times) is real, already built, already on David's current TestFlight build, and gave the single most concrete piece of evidence all night. It has no remote-shipping path — David has to manually screenshot it every time. Building a lightweight remote-shipping path for this log is probably higher-leverage than more point-fixes.
5. There is no request/correlation ID anywhere in the codebase, client or server (confirmed independently by the external reviewer too — see below). Every investigation tonight was structurally forced to work from disconnected, point-in-time evidence because there was never a way to say "this exact client request IS this exact server log line." Not a failure of rigor — a real, confirmed tooling gap.

From the external reviewer, a concrete, minimal, low-risk design for closing gap #5 above, not yet implemented, worth strong consideration as an early, foundational piece of whatever you build:
- Client generates a UUID per request in the shared fetch helper (`APIV5.swift`), sends it as one new header (e.g. `X-Faff-Request-Id`).
- Server logs that header value on the log lines that already exist — no new logging infrastructure.
- This alone would let a future incident be diagnosed by directly correlating a specific device request to a specific server log line, rather than inferring from timing.

## Your actual task

David's own sequencing: **research, then a real plan, then implementation.** Don't skip to writing code.

1. **Finish/verify the research.** The three passes above are a strong start but self-disclosed as not exhaustive in places (each report says where). Re-verify against `main`. Fill in the gaps each report names as open (e.g., whether other cron jobs share `keep-warm`'s internal fan-out concurrency; whether the 17 admin routes with neither `CRON_SECRET` nor `requireUserId` use a third auth mechanism).
2. **Diagnose, don't assume.** The four fixes tonight were all real and all insufficient. Before proposing a rebuild, form your own answer to "why does David's actual experience still fail" — grounded in evidence, the same discipline this whole programme has held to tonight (Rule 13: render-verify with real data; Rule 18: falsify your own claims before trusting them).
3. **Propose a real architecture direction**, informed by David's own stated philosophy (client as thin display, backend as continuously-live source of truth) but also honest about real trade-offs already surfaced in the research (e.g., the client's current complexity partly exists to deliver an instant-navigation UX David has also asked for — a genuinely thin client may cost some of that unless designed carefully).
4. **Produce a real, phased plan** — not "rewrite everything." What's the highest-leverage, lowest-risk first phase? What's incremental vs. what genuinely needs a rebuild? Be honest about scope and risk in both directions — don't manufacture alarm, and don't undersell a genuinely large undertaking as a quick fix.
5. **Bring the plan back before implementing.** This is a decision David needs to actually see and weigh in on (per the operational/decision/external boundary in `CLAUDE.md`) — a rebuild of this scale is squarely a "decision," not something to execute unilaterally once it's designed.

## How to operate on this programme

- **David's Desk** (session name: `Davids Desk`) is your channel to David himself — for real decisions, not routine findings. Route anything David needs to see or decide through there.
- **The programme lead** (the session that wrote this brief) is your coordination point for anything touching other workstreams, the findings register, or the shared programme hub. Message it with real findings, not status checks — same standard as every other session tonight.
- **The code agent** and **external review lead** are both available if your plan reaches an implementation phase that needs their involvement — coordinate directly with the programme lead first so work doesn't collide.
- Log real findings in `for external review/findings/00-register.md` under the next available `F` number, same format as the rest of the register (read the "Adding a finding" section at the bottom of that file).
- Full programme stand-down is currently in effect for every other workstream except this one and the live-bug thread it's now folded into (F156/F158). Don't assume other sessions are active unless told otherwise.
- Hold the same evidentiary discipline the rest of tonight has: verify claims against real code/data before trusting them (including the research already done for you — see the base-branch caveat above), state confidence honestly, never claim something is fixed or resolved without it actually being checked against reality.
