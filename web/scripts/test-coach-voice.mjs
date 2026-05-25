/**
 * test-coach-voice.mjs · Iteration script for the TODAY-page coach voice.
 *
 * Loads ANTHROPIC_API_KEY from web/.env.local, calls Claude with the
 * new voice doctrine (anchored to David's gold-sample), and dumps the
 * generated briefings for a fixed set of scenarios.
 *
 * No prod side effects — pure read of /scenarios/ structure → write to
 * stdout. Iterate the prompt + samples until they land, then port the
 * prompt to web/coach/llm.ts as the production daily-briefing call.
 *
 * Run: cd web && node scripts/test-coach-voice.mjs
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

// ── env ───────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const apiKey = (envText.match(/^ANTHROPIC_API_KEY=(.+)$/m) || [])[1];
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY not found in web/.env.local');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey });

// ── voice doctrine v2 — anchored to David's gold sample ───────────
const SYSTEM_PROMPT = `You are the runner's coach for the faff.run training app. A veteran club coach who's been around the sport for decades. You have all of the runner's training data, plan, recovery signals, and race calendar available. You operate from truth — never invent.

Your voice is conversational and personal. Like a coach texting a runner you've worked with for years. The runner reads what you write on their TODAY page. It should feel like a coach who watched the run, knows the plan, and is talking to them about it.

# THE GOLD STANDARD

This is what David wrote when asked what coaching he wants to receive:

"""
Great run today. 12.1 miles at an easy pace is the perfect execution. cadence was a bit low but thats okay for an easy run, it actually helps. this week gets us back into speed. Time to start pushing to hit that goal for AFC. Its possible, but we need to be strategic.

Also, you're doing great with sustaining milage, going to up it a bit next week. Let me know how it feels.
"""

Embody this voice. Specifically:

- **Open with specific warmth.** "Great run today" — anchored to what actually happened. Never generic. Never "Hey buddy!" or "You got this!"
- **Notice ONE thing about the run and contextualize it.** "Cadence was a bit low but for easy that's fine, it actually helps." One observation, named, with the coach's read on whether it matters. NOT a list of metrics.
- **Use "we" and "us".** Collaborative. The coach is IN this with the runner, not a system reporting at them.
- **Name the goal by name.** "for AFC" / "for CIM" / "for the half". Never "your next race."
- **State intent, don't announce phases.** "We're going to start pushing" / "going to up it a bit next week" — coach is ACTING, not labeling a phase.
- **Be honest about challenge.** "It's possible, but we need to be strategic." Confidence without bravado.
- **Read meta-patterns.** "You're doing great sustaining mileage" — recognize the BEHAVIOR, not just quote the number.
- **Ask for feedback.** "Let me know how it feels." Loop closed — relationship, not broadcast.

# HARD RULES

- **Never invent.** If the plan says X tomorrow, you say X. If you don't know, don't say. If a number is flagged as unreliable, speak qualitatively ("you're well over plan") instead of numerically.
- **Never recite numbers the page already shows.** The page shows distance, time, pace, HR, splits as evidence. The coach interprets that evidence — doesn't read it back.
- **No coach-textbook jargon.** "Aerobic engine", "stimulus", "absorption window", "compound off one good day", "the engine showing up", "the work landing" — all banned. They sound like a textbook, not a coach.
- **No clichés.** "You got this", "let's crush it", "trust the process", "great job", "send it", "lock in", "go time" — all banned.
- **No em dashes.** Use periods or commas.
- **No exclamation marks.**
- **Don't open with "Today's session is" or any template.** Find the real sentence.

# LENGTH

Adaptive to the day's weight:
- **Long run / quality session reflection** — 3-4 short paragraphs.
- **Easy weekday post-run** — 2-3 sentences.
- **Pre-run framing** — 1-3 sentences.
- **Rest day** — 2-3 short sentences, focused on the week shape and what's coming.
- **Skipped / partial** — 2-3 sentences, honest acknowledgment + tomorrow's intent.

# OUTPUT

Just the coach's text. No headings, no labels, no markdown. Plain prose, paragraph breaks where natural. Nothing else.`;

// ── scenarios ─────────────────────────────────────────────────────
const scenarios = [
  {
    name: 'A · TODAY (Sunday post-long-run, David\'s real data)',
    user: `RUNNER: David. Training for AFC Half on Aug 16 (84 days out). Most recent A-race: Sombrero Half on May 3 (3 weeks ago, clean execution).

TODAY: Sunday May 24, 6:00 PM local time.

PLAN: Long run, 12 mi at easy / Zone 2.

ACTUAL: Run completed. 11.1 mi at 8:50/mi avg pace, 1:38:10 moving time, 140 avg HR (Zone 2, right in the easy band the whole way), 160 spm cadence. His baseline cadence is ~170, so today was a bit low.

SLEEP LAST NIGHT: 7.7h.

WEEK SO FAR: Mileage well over plan (the dedup pipeline is flagging some duplicate runs so the exact number is unreliable — speak qualitatively about volume, not numerically).

WEATHER: 60°F, 83% humidity, 3 mph wind, partly cloudy.

CHECK-IN: 5/5 energy, 1/5 soreness, 1/5 stress.

PLAN AHEAD: Tomorrow Monday is easy 4 mi (NOT rest). Tuesday is quality (tempo 4 x 1mi). Next Sunday is the long run, slightly longer than today.

WRITE THE COACH'S TODAY VOICE.`,
  },
  {
    name: 'B · TUESDAY post-quality (hypothetical)',
    user: `RUNNER: David. Training for AFC Half on Aug 16 (82 days out).

TODAY: Tuesday May 26, 7:30 AM local time.

PLAN: Quality session, tempo 4 x 1mi at threshold pace (target 7:00-7:10/mi), 1 mi warm-up + 1 mi cool-down.

ACTUAL: Run completed. 6.2 mi total. The 4 tempo reps came in at 7:04, 7:06, 7:08, 7:09 (clean, holding the band). Avg HR for the reps was 168, drifted 4 bpm from rep 1 to rep 4 (normal cardiac drift).

SLEEP LAST NIGHT: 6.8h (a bit short).

WEEK SO FAR: 4.5 mi yesterday (Monday easy).

WEATHER: 58°F, 60% humidity, calm.

PLAN AHEAD: Wednesday is easy 5. Thursday is easy 5. Friday rest. Saturday shake-out. Sunday long run, 13 mi.

WRITE THE COACH'S TODAY VOICE.`,
  },
  {
    name: 'C · THURSDAY rest (hypothetical, mid-week)',
    user: `RUNNER: David. Training for AFC Half on Aug 16 (80 days out).

TODAY: Thursday May 28, 8:00 AM local time.

PLAN: Rest day. No run scheduled.

ACTUAL: N/A (rest day).

SLEEP LAST NIGHT: 7.4h.

WEEK SO FAR: 18 mi banked (Mon easy 4 + Tue tempo 6.2 + Wed easy 5 + today rest + Sat shake-out 3 + Sun long 13 = 31.2 planned, 18 in).

WEATHER: 62°F.

CHECK-IN: 4/5 energy, 2/5 soreness (some quad heaviness from Tuesday), 2/5 stress.

PLAN AHEAD: Tomorrow Friday is also rest (this plan has two rest days mid-week). Saturday 3 mi shake-out. Sunday 13 mi long run.

WRITE THE COACH'S TODAY VOICE.`,
  },
  {
    name: 'D · MONDAY after partial run + bad sleep (hypothetical)',
    user: `RUNNER: David. Training for AFC Half on Aug 16 (76 days out).

TODAY: Monday June 1, 7:00 PM local time (the run was supposed to be this morning).

PLAN: Easy 5 mi.

ACTUAL: 2.8 mi at 9:20/mi pace. HR was high (155, normally his easy is around 140-145). Run was cut short — no specific reason logged, just stopped at 2.8 mi.

SLEEP LAST NIGHT: 5.2h.

WEEK SO FAR: This was the first run of the week.

WEATHER: 71°F, 88% humidity (mugginess flag).

CHECK-IN: 2/5 energy, 3/5 soreness, 4/5 stress.

PLAN AHEAD: Tuesday is quality session, tempo 4 x 1mi. Wednesday easy 4. Long run Sunday.

WRITE THE COACH'S TODAY VOICE.`,
  },
];

// ── run ───────────────────────────────────────────────────────────
async function main() {
  for (const s of scenarios) {
    console.log('\n' + '═'.repeat(76));
    console.log(s.name);
    console.log('═'.repeat(76));
    const start = Date.now();
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: s.user }],
    });
    const text = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    console.log('\n' + text + '\n');
    console.log(`  · ${((Date.now() - start) / 1000).toFixed(1)}s · ${resp.usage.input_tokens} in / ${resp.usage.output_tokens} out`);
  }
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
