# Where the live-data fix actually stands right now

Written plainly, for you, not as a status row. Everything here is checked against the real code and real logs, not assumed. **Updated once already, with your own corrections folded in — you caught real gaps in the first version, listed at the bottom so nothing gets quietly smoothed over.**

## The short version

The real fix for the offline/missing-data problem is written, and the core of it has been checked hard and holds up. It is not on your phone yet. Real progress since the last version of this brief: four of the six required tests now exist, not one. Two remain.

## What actually happened, in order

1. You'd been hitting the same failure for days — the app saying it's offline when it isn't, a finished run not showing up. Several real fixes went in earlier (a too-small database connection limit, a few client bugs) and none of them made it stop, because none of them were the full cause.
2. You told us to stop everything else and figure out the real architecture problem. A dedicated session did the research, you wrote your own brief and a precise step-by-step plan, and that became the priority.
3. The first attempt at the fix was a smaller, safer interim change — it shrank how much the app asks for at once, but by its own admission didn't remove the underlying problem.
4. You reproduced the failure again, live, on your own phone, after that interim change had already shipped. That was the right test and it told us the interim fix wasn't enough.
5. You captured a real trace of exactly what the app was doing during that failure. That trace is what let a real cause be found, instead of guessed at: three separate parts of the app were each independently trying to fetch a wide window of data the moment you opened it or changed screens, all at the same time, with none of them aware of the others. That pile-up is a **confirmed major cause of the request storm** — proven directly from the code, not theory.
6. A fix for that — removing the redundant fetching, having the app read from the one source it already keeps up to date instead — was written and checked into a branch, not put into the main app.
7. It's had real scrutiny since: the person who wrote it caught a real mistake in their own first draft (a needed background sync had gotten silently dropped) by actually trying to break their own safety check rather than just trusting it worked, then fixed it. An independent reviewer then read the actual code line by line, ran the tests themselves, and confirmed the core of it is correct — and separately found and fixed one more small thing that had been quietly making the original problem slightly worse. **That review covered the core implementation as it stood at that point — it does not automatically cover what's been added since, or the final version. More on that below.**
8. Since then, work has continued on the branch: four required tests have been written and added (covering: a normal app launch only reads what it should, moving across 30+ days doesn't hit the network when it shouldn't, and Retry only re-fetches the one thing that actually failed, plus the earlier safety check against the redundant-fetching bug coming back). Two required tests remain — one for how the app handles regaining focus/foreground, one for cancelling a request cleanly mid-flight.
9. You personally caught two more things that should have been caught here first: a mistake in how a document counted its own required tests, and made sure the process log stays a permanent record rather than a one-off. Both fixed. You then reviewed this brief itself and corrected it further — see the note at the bottom.
10. Separately, you started getting real crash messages on your own Mac. That turned out to be a different, mundane cause — 25 old test simulators had been left running in the background for days, never shut down after use. Those are cleaned up now. Whether that was the whole story for your crashes isn't confirmed from here — worth telling me if it happens again.

## What's genuinely done vs. not — no rounding up

**Done and verified:**
- Three uncoordinated eager-load paths, all firing at once, are a confirmed major cause of the request storm — proven from the code, not assumed.
- The fix for that is written and lives on its own branch.
- The core of it has been checked hard — read directly by an independent reviewer, tested independently, and a reviewer deliberately tried to break it and couldn't.
- Four of the six required tests exist and pass.

**Not done yet:**
- The fix is not merged into the main app.
- Two required tests remain: foreground-signal handling, and cancellation.
- **The independent review that's happened so far covered the code as of one earlier point — it has not yet reviewed everything added since, or the final, complete version. That still needs to happen, against one exact, frozen version, before this merges.**
- No build carrying this fix has reached a phone yet — not yours, not anyone's.
- Nobody has tried the actual fix on a real, signed-in account yet, only in a test environment without your login. That's the one thing that still needs your phone specifically, once a build exists.
- The repeated-retry behavior your trace showed (see below) is still unexplained.

## What "done" actually means here, in your own words, so nobody moves the goalposts

1. Finish the two remaining tests (foreground-coalescing, cancellation).
2. Run the complete required test suite, all of it, together.
3. Freeze it — one final, exact version, nothing added after.
4. Independent review of that exact final version, including everything added since the earlier review.
5. Merge it, and cut a real build for your phone.
6. Do the same real-device trace you did before, again.
7. Only call it fixed if the request storm is actually gone and the database has real headroom left — not just "looks better."

## The retry mechanism — a named, owned open question, not a footnote

Your trace showed something separate from the three-mechanism pile-up: a kind of automatic retry that climbed over a session (generation 3, then 4, then 5), re-firing a whole batch each time. The current fix should reduce how bad this looks, just by cutting down how much the app asks for in the first place — but **nobody has tracked down why this retry behavior happens at all, and it is not being called "the same problem" as a way of avoiding a separate investigation.** It does not need to hold up the current fix unless real evidence shows it's making that fix worse. But it stays open and owned, not something that quietly disappears until you notice it again.

## What changed in this version — your own corrections, applied directly

You reviewed the first version of this brief and sent back precise corrections. Applied here, not softened:
- The branch had advanced further than reported — four of six tests exist now, not one. (Checked directly: the branch's real current tip is `cc9625e44`, one commit past the SHA you named, `d4a8f4447` — the retry-ownership test is what that last commit adds, matching your own count of four done.)
- "The actual cause" was too strong — changed to "a confirmed major cause," since the repeated-retry mechanism is still unexplained and may be contributing too.
- Added the distinction between the earlier review (real, but of an earlier point in the code) and the final review still needed (of the exact, complete, frozen version before merge).
- The retry mechanism is now named as its own tracked, owned question rather than a closing caveat.
- Replaced the step list with your own exact sequence.
