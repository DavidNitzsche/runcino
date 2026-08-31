/**
 * lib/plan/_goal_immutability.test.ts · GOALIMMUT-1
 *
 * THE GATE BEHIND THE OWNER'S OLDEST UNGATED RULE:
 *
 *   the coach PROJECTS, it never RENEGOTIATES a stated goal via a card or a
 *   button. A verdict is not a trigger.
 *
 * That rule lived only in project memory. On 2026-08-28 a cron violated it
 * silently into his live account — `plan_proposals` row 57, kind
 * `goal_renegotiation`, source `goal_gap_cron`, whose copy read "Set the
 * revised target to race off the fitness you have" and whose `accept_path` was
 * `PATCH /api/race/cim { goalSec, source: 'renegotiate' }`. Two web surfaces
 * shipped that button. The phone shipped the verb. Nothing failed.
 *
 * Closing that one instance is worth very little; a rule with no check is a
 * hypothesis (Rule 18). This gate holds the SHAPE shut, in both surfaces, at
 * five independent seams, and every scanner states how many files it read and
 * fails on zero rather than reporting clean because it looked at nothing.
 *
 * WHAT WOULD REOPEN IT, and which guard names it:
 *
 *   a writer puts an endpoint in a proposal payload      → GUARD 1
 *   the goal route accepts a non-runner source again     → GUARD 2
 *   a card or panel PATCHes a goal directly              → GUARD 3
 *   an informational kind is given an accept verb        → GUARD 4
 *   the server stops refusing accept on those kinds      → GUARD 5
 *   a writer stamps a retired kind again                 → GUARD 6
 *   the note recomputes its own projection (Rule 16)     → GUARD 7
 *   the copy grows an imperative about the goal          → GUARD 8
 *
 * FALSIFIED IN BOTH DIRECTIONS before it was trusted — see the run log in the
 * commit message. Each guard was made to fail by reintroducing the real
 * violation, and the stale-exemption branch was made to fail by adding an
 * exemption whose target is clean.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  GOAL_MUTATION_ROUTES,
  RUNNER_INITIATED_GOAL_SOURCES,
  RETIRED_GOAL_SOURCES,
  INFORMATIONAL_PROPOSAL_KINDS,
  RETIRED_PROPOSAL_KINDS,
  GOAL_OUTLOOK_KINDS,
  isGoalOutlookKind,
  isInformationalProposalKind,
} from './goal-immutability';
import { composeGoalOutlookMessage } from './goal-outlook-copy';

const WEB = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(WEB, '..');
const NATIVE_CARD = path.join(
  REPO, 'native-v2/Faff/Faff/Components/CoachDecisionCard.swift',
);

/* ── file walking ─────────────────────────────────────────────────────────
   Scanned trees. `lib` holds the writers, `app` the routes, `components` the
   renderers — the violation had a limb in all three, which is exactly why a
   single-directory scan would have reported clean. */
const TREES = ['lib', 'app', 'components'].map((d) => path.join(WEB, d));

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const ALL_FILES = TREES.flatMap((t) => walk(t));

/** Shipped source. Test files are excluded from the source scans because they
 *  quote the defect on purpose — this file's own `it('… accept_path …')` title
 *  tripped guard 1 on its first run, which is a gate failing on its own
 *  description of the bug rather than on the bug. Nothing in a `.test.ts`
 *  reaches a runner; the guards below are about what ships. */
const SHIPPED = ALL_FILES.filter((f) => !/\.test\.tsx?$/.test(f));

/** Strip line and block comments so prose ABOUT the defect never trips a
 *  guard, while the defect itself always does. Every guard below reads code
 *  lines only — the same posture `_race_projection.test.ts` takes, and the
 *  reason this file can describe the violation in full without failing. */
function codeLines(src: string): Array<{ n: number; text: string }> {
  const out: Array<{ n: number; text: string }> = [];
  let inBlock = false;
  src.split('\n').forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const close = line.indexOf('*/');
      if (close === -1) return;
      line = line.slice(close + 2);
      inBlock = false;
    }
    for (;;) {
      const open = line.indexOf('/*');
      if (open === -1) break;
      const close = line.indexOf('*/', open + 2);
      if (close === -1) { line = line.slice(0, open); inBlock = true; break; }
      line = line.slice(0, open) + line.slice(close + 2);
    }
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    const slash = line.indexOf('//');
    if (slash !== -1) line = line.slice(0, slash);
    if (line.trim().length === 0) return;
    out.push({ n: i + 1, text: line });
  });
  return out;
}

function rel(f: string): string { return path.relative(WEB, f); }

/**
 * Every `body: JSON.stringify(...)` payload in a file, with its line number
 * and balanced-paren text.
 *
 * Guard 3 needs the REQUEST BODY specifically. Matching `goalSec` anywhere in
 * a file that also calls `fetch` is how the first cut of that guard reported
 * five arithmetic expressions and a type annotation as violations — and a
 * guard that cries wolf earns an allowlist entry per false positive until it
 * means nothing (Rule 18 clause 4, arrived at from the other direction).
 */
function requestBodies(src: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  const marker = /body\s*:\s*JSON\.stringify\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    out.push({
      line: src.slice(0, m.index).split('\n').length,
      text: src.slice(m.index + m[0].length, i - 1),
    });
  }
  return out;
}

/* ── the violating conditions, named once ────────────────────────────────
   Each guard's predicate lives here so the STALENESS check can ask the exact
   same question the guard asks. The first cut of this file asked a looser
   one — "does the file contain `goalSec:` anywhere" — and a deliberately
   stale exemption pointing at a module whose only `goalSec:` is a TYPE
   ANNOTATION read as "still violating" and passed. The harness caught it;
   the lesson is Rule 18 clause 3 from the other side: an exemption must be
   guarded by the VIOLATING CONDITION, not by something that merely
   resembles it. */
function hasAcceptPath(src: string): boolean {
  return codeLines(src).some((l) => /\baccept_path\b|\baccept_endpoint\b/.test(l.text));
}
function hasRetiredSource(src: string): boolean {
  return codeLines(src).some((l) =>
    RETIRED_GOAL_SOURCES.some((r) => l.text.includes(`'${r}'`) || l.text.includes(`"${r}"`)));
}
function hasGoalWriteBody(src: string): boolean {
  if (!/\bfetch\s*\(/.test(src)) return false;
  return requestBodies(src).some((b) => /\bgoal(Sec|Display|Safe)?\s*:/.test(b.text));
}
function writesRetiredKind(src: string): boolean {
  if (!/INSERT\s+INTO\s+plan_proposals/i.test(src)) return false;
  return codeLines(src).some((l) =>
    /VALUES/i.test(l.text)
    && RETIRED_PROPOSAL_KINDS.some((k) => l.text.includes(`'${k}'`)));
}

const GUARD_PREDICATE: Record<1 | 2 | 3 | 6, (src: string) => boolean> = {
  1: hasAcceptPath,
  2: hasRetiredSource,
  3: hasGoalWriteBody,
  6: writesRetiredKind,
};

/* ── exemptions · a RATCHET ───────────────────────────────────────────────
   May shrink, never grow, and every entry carries an argued reason. An entry
   whose target no longer trips ITS OWN guard's predicate fails until it is
   deleted — Rule 18 clause 4, and the reason this list is a liability rather
   than a convenience.

   Empty on landing. That is the point: the violations were removed, not
   excused. */
type Exemption = { file: string; guard: 1 | 2 | 3 | 6; reason: string };
const GOAL_IMMUTABILITY_EXEMPTIONS: Exemption[] = [];

/** Files exempted from a given guard. Applied INSIDE each guard so the
 *  exempted file is the only thing excused and every other file still runs
 *  (Rule 18 clause 3 — a `return` above an assertion switches the whole
 *  claim off, which is how PACE.interval-offset stopped meaning anything). */
function exemptFor(guard: 1 | 2 | 3 | 6): Set<string> {
  return new Set(GOAL_IMMUTABILITY_EXEMPTIONS.filter((e) => e.guard === guard).map((e) => e.file));
}

/* ── GUARD 3 allowlist · where a goal write legitimately originates ────────
   A goal is runner-stated. These are the surfaces where the runner TYPES it,
   which is the only origin the rule permits. Same ratchet: a new entry needs
   an argument, and one that stops writing a goal fails until deleted. */
const GOAL_EDITOR_FILES = [
  // The race edit sheet's web twin. The runner types name/date/goal into a
  // form and saves it. No verdict, no engine-picked number, no coach copy.
  'components/faff-app/views/RaceView.tsx',
] as const;

describe('GOALIMMUT-1 · the coach projects, it never renegotiates', () => {
  it('the scanner still reads real source (liveness)', () => {
    // Rule 18 clause 2. Two gates in this repo have shipped green because they
    // scanned nothing, and both reported confidence while doing it.
    expect(ALL_FILES.length).toBeGreaterThan(300);
    for (const t of TREES) {
      expect(walk(t).length, `${rel(t)} scanned zero files`).toBeGreaterThan(0);
    }
    // And the trees really do contain the modules this gate is about, so a
    // future reorganisation that moves them out cannot make it silently pass.
    const names = ALL_FILES.map(rel);
    expect(names).toContain('lib/plan/goal-outlook.ts');
    expect(names).toContain('lib/coach/decision-cards.ts');
    expect(names).toContain('app/api/plan/proposal/route.ts');
    expect(fs.existsSync(NATIVE_CARD), 'native CoachDecisionCard.swift').toBe(true);
  });

  /* ── GUARD 1 ─────────────────────────────────────────────────────────────
     A proposal payload may not name an endpoint for its own accept.

     `accept_path: "PATCH /api/race/cim { goalSec, source: 'renegotiate' }"` is
     the field that made three renderers wire the same mutation without any of
     them deciding to. Kill the field and the shape has nowhere to live. */
  it('guard 1 · no proposal payload carries an accept_path', () => {
    const hits: string[] = [];
    let scanned = 0;
    const exempt = exemptFor(1);
    for (const f of SHIPPED) {
      scanned++;
      if (exempt.has(rel(f))) continue;
      for (const { n, text } of codeLines(fs.readFileSync(f, 'utf8'))) {
        if (/\baccept_path\b|\baccept_endpoint\b/.test(text)) {
          hits.push(`${rel(f)}:${n} · ${text.trim()}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(300);
    expect(hits, `a payload names its own accept endpoint:\n${hits.join('\n')}`).toEqual([]);
  });

  /* ── GUARD 2 ─────────────────────────────────────────────────────────────
     The goal-write routes accept runner-initiated sources only.

     Read out of the DECLARATION at run time rather than hardcoded here, so
     this proves the route agrees with the rule rather than proving the test
     agrees with itself (Rule 18's closing clause). */
  it('guard 2 · the goal-write routes accept only runner-initiated sources', () => {
    expect(GOAL_MUTATION_ROUTES.length).toBeGreaterThan(0);
    let checked = 0;
    for (const route of GOAL_MUTATION_ROUTES) {
      const full = path.join(WEB, route);
      expect(fs.existsSync(full), `${route} is declared a goal-write route but does not exist`).toBe(true);
      const src = fs.readFileSync(full, 'utf8');
      const code = codeLines(src);
      checked++;

      // No retired source may be accepted, compared against, or normalised to.
      for (const retired of RETIRED_GOAL_SOURCES) {
        const bad = code.filter((l) => l.text.includes(`'${retired}'`) || l.text.includes(`"${retired}"`));
        expect(
          bad.map((l) => `${route}:${l.n} · ${l.text.trim()}`),
          `${route} still handles the retired source '${retired}'`,
        ).toEqual([]);
      }

      // A route that reads `body.source` must validate against the shared set,
      // not against its own literals. `/api/profile/goal` carries no source at
      // all, which is also compliant — nothing to validate.
      const readsSource = code.some((l) => /body[.?[\]'"\w]*\bsource\b/.test(l.text));
      if (readsSource) {
        expect(
          src.includes('RUNNER_INITIATED_GOAL_SOURCES'),
          `${route} reads body.source but does not validate against RUNNER_INITIATED_GOAL_SOURCES`,
        ).toBe(true);
      }
    }
    expect(checked).toBe(GOAL_MUTATION_ROUTES.length);
    // The allowed set means "a human typed it". If that stops being true the
    // rule has been widened by the back door.
    expect([...RUNNER_INITIATED_GOAL_SOURCES].sort()).toEqual(['manual', 'onboarding']);
  });

  /* ── GUARD 3 ─────────────────────────────────────────────────────────────
     No coach-authored surface issues a goal write.

     This is the guard that caught the SECOND violation, which nobody had
     reported: `GapPanel.tsx`'s RebuildDoor fired on the `planUnderBuilt`
     verdict and PATCHed /api/race with an engine-picked goal string. Guards 1,
     2, 4 and 5 all read clean on it — it never touched a proposal row. The
     shape is "a client sends a goal value", and that is what this looks for. */
  it('guard 3 · no card, panel or notification writes a goal', () => {
    const hits: string[] = [];
    let scanned = 0;
    let bodiesRead = 0;
    const exempt = new Set<string>([...GOAL_EDITOR_FILES, ...exemptFor(3)]);
    for (const f of SHIPPED) {
      const name = rel(f);
      // Routes ARE the write; guard 2 covers them. This guard is about callers.
      if (name.startsWith('app/api/')) continue;
      scanned++;
      const src = fs.readFileSync(f, 'utf8');
      if (!/\bfetch\s*\(/.test(src)) continue;
      // Read the actual REQUEST BODY, not every line that mentions a goal.
      // The first cut of this guard matched `goalSec:` anywhere and reported
      // five arithmetic lines and a type annotation — a gate that cries wolf
      // gets an allowlist entry per false positive and stops meaning anything.
      for (const body of requestBodies(src)) {
        bodiesRead++;
        if (!/\bgoal(Sec|Display|Safe)?\s*:/.test(body.text)) continue;
        if (exempt.has(name)) continue;
        hits.push(`${name}:${body.line} · ${body.text.replace(/\s+/g, ' ').slice(0, 160)}`);
      }
    }
    expect(scanned).toBeGreaterThan(100);
    // Liveness for the extractor itself: if `requestBodies` stops matching the
    // codebase's fetch style it would report clean by reading nothing.
    expect(bodiesRead, 'requestBodies() found no fetch payloads · the extractor has rotted')
      .toBeGreaterThan(20);
    expect(
      hits,
      `a non-editor surface sends a goal write:\n${hits.join('\n')}\n` +
      'A goal is runner-stated. If this really is a goal EDITOR, add it to ' +
      'GOAL_EDITOR_FILES with an argument. If it is a coach card, delete the ' +
      'button and state the observation instead.',
    ).toEqual([]);
  });

  /* ── GUARD 4 ─────────────────────────────────────────────────────────────
     An informational kind carries no accept verb, on either surface.

     Web and phone keep separate maps, so this reads both and also checks they
     agree about WHICH kinds are informational — the divergence would otherwise
     be invisible until it shipped on one platform. */
  it('guard 4 · no informational kind has an accept verb (web and phone)', () => {
    expect(INFORMATIONAL_PROPOSAL_KINDS.length).toBeGreaterThan(0);

    const webSrc = fs.readFileSync(path.join(WEB, 'lib/coach/decision-cards.ts'), 'utf8');
    const webVerbs = webSrc.slice(webSrc.indexOf('const PLAN_ACCEPT_VERB'));
    const nativeSrc = fs.readFileSync(NATIVE_CARD, 'utf8');
    const nativeVerbs = nativeSrc.slice(nativeSrc.indexOf('planAcceptVerbs'));

    for (const kind of GOAL_OUTLOOK_KINDS) {
      const webCode = codeLines(webVerbs).filter((l) => l.text.includes(`${kind}:`));
      expect(webCode.map((l) => l.text.trim()),
        `PLAN_ACCEPT_VERB declares an accept verb for informational kind '${kind}'`).toEqual([]);
      const natCode = codeLines(nativeVerbs).filter((l) => l.text.includes(`"${kind}"`));
      expect(natCode.map((l) => l.text.trim()),
        `planAcceptVerbs declares an accept verb for informational kind '${kind}'`).toEqual([]);
    }

    // Cross-surface parity: the phone's own list must be the TS declaration.
    const natSet = nativeSrc.slice(
      nativeSrc.indexOf('informationalPlanKinds'),
      nativeSrc.indexOf('planAcceptVerbs'),
    );
    expect(natSet.length, 'native lost informationalPlanKinds').toBeGreaterThan(0);
    for (const kind of GOAL_OUTLOOK_KINDS) {
      expect(natSet, `native informationalPlanKinds is missing '${kind}'`).toContain(`"${kind}"`);
    }
    // Comments stripped first: the doc block above `planAcceptVerbs` names
    // "goal_renegotiation" in prose, and reading it as a set member made the
    // parity check fail on its own explanation of the fix.
    const natSetCode = codeLines(natSet).map((l) => l.text).join('\n');
    const natKinds = [...new Set([...natSetCode.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))].sort();
    expect(natKinds, 'native informationalPlanKinds has drifted from the TS declaration')
      .toEqual([...GOAL_OUTLOOK_KINDS].sort());
  });

  /* ── GUARD 5 ─────────────────────────────────────────────────────────────
     The server refuses the accept, so a UI edit cannot reopen it.

     Ordering matters and is asserted: the refusal must come BEFORE the generic
     accept branch that rebuilds a plan. A guard placed after it is decoration. */
  it('guard 5 · POST /api/plan/proposal refuses accept for informational kinds', () => {
    const p = path.join(WEB, 'app/api/plan/proposal/route.ts');
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toContain('isInformationalProposalKind');
    const code = codeLines(src);
    const guardAt = code.find((l) => /isInformationalProposalKind\s*\(/.test(l.text))?.n ?? -1;
    expect(guardAt, 'the refusal is gone').toBeGreaterThan(0);
    // It must be conditioned on accept — a guard that fires on dismiss too
    // would strand the note pending forever.
    const guardText = code.filter((l) => Math.abs(l.n - guardAt) <= 1).map((l) => l.text).join(' ');
    expect(guardText).toMatch(/action\s*===\s*'accept'/);
    // And it must precede the rebuild.
    const rebuildAt = code.find((l) => /generatePlan\s*\(/.test(l.text))?.n ?? Number.MAX_SAFE_INTEGER;
    expect(guardAt).toBeLessThan(rebuildAt);
  });

  /* ── GUARD 6 ─────────────────────────────────────────────────────────────
     No writer stamps a retired kind. Readers may still name it — the owner's
     row is still in prod and must still render — so this looks for the INSERT
     specifically, not for the word. */
  it('guard 6 · nothing writes a retired proposal kind', () => {
    const hits: string[] = [];
    let scanned = 0;
    const exempt = exemptFor(6);
    for (const f of SHIPPED) {
      const src = fs.readFileSync(f, 'utf8');
      if (!/INSERT\s+INTO\s+plan_proposals/i.test(src)) continue;
      scanned++;
      if (exempt.has(rel(f))) continue;
      // The kind literal on an INSERT's VALUES line.
      for (const { n, text } of codeLines(src)) {
        for (const retired of RETIRED_PROPOSAL_KINDS) {
          if (/VALUES/i.test(text) && text.includes(`'${retired}'`)) {
            hits.push(`${rel(f)}:${n} · ${text.trim()}`);
          }
        }
      }
    }
    expect(scanned, 'no plan_proposals writer found · the scan predicate has rotted').toBeGreaterThan(0);
    expect(hits, `a writer still stamps a retired kind:\n${hits.join('\n')}`).toEqual([]);
  });

  /* ── GUARD 7 · RULE 16 ───────────────────────────────────────────────────
     The note's number comes from the shared resolver and nowhere else.

     The old copy said "Evidence says 3:31:48" while every other surface said
     3:22:17 for the same race under the same word. `race-projection.ts` exists
     to stop that; a behavioural test cannot catch a caller that stops calling
     it, so the source is read directly. */
  it('guard 7 · the outlook resolves its projection through the shared resolver', () => {
    const p = path.join(WEB, 'lib/plan/goal-outlook.ts');
    const src = fs.readFileSync(p, 'utf8');
    expect(src, 'goal-outlook.ts must import the shared resolver')
      .toMatch(/import\s*\{[^}]*resolveRaceProjection[^}]*\}\s*from\s*'@\/lib\/training\/race-projection'/);
    const code = codeLines(src);
    // It may not compute its own. `predictRaceTime` is the raw equivalence;
    // `gap.trajectorySec` is the snapshot wearing the trajectory's name.
    const own = code.filter((l) =>
      /\bpredictRaceTime\s*\(/.test(l.text) || /\btrajectorySec\b/.test(l.text));
    expect(own.map((l) => `${l.n} · ${l.text.trim()}`),
      'goal-outlook.ts computes its own projection instead of resolving one').toEqual([]);
    // And the payload must carry the resolver's basis, so prose beside the
    // number can never assert a basis the number does not have.
    expect(src).toContain('projection_basis');
  });

  /* ── GUARD 8 ─────────────────────────────────────────────────────────────
     The copy states; it does not instruct. Behavioural, over the real
     composer, including the exact sentence that shipped. */
  describe('guard 8 · the sentence asks for nothing', () => {
    const OWNER = {
      projectedSec: 12137,          // 3:22:17 · the resolver's answer for CIM
      basis: 'trajectory' as const,
      goalSec: 10800,               // 3:00:00 · his stated ambition
      weeksRemaining: 14,
    };

    it('names the projection, keeps the goal, and instructs nothing', () => {
      const m = composeGoalOutlookMessage(OWNER);
      expect(m).toContain('3:22:17');
      expect(m).toContain('3:00:00');
      expect(m).toContain('season ambition');
      // The imperative that shipped, and its neighbours.
      expect(m).not.toMatch(/set the revised target/i);
      expect(m).not.toMatch(/recommended race target/i);
      expect(m).not.toMatch(/\bmove (the|your) (target|goal)\b/i);
      expect(m).not.toMatch(/\blower\b/i);
      // The wrong quantity must never appear: 3:31:48 is today's equivalence.
      expect(m).not.toContain('3:31:48');
      // Coach voice.
      expect(m).not.toMatch(/[!—]/);
    });

    it('a retired row prints no figure rather than the wrong one', () => {
      // What `synthesizeMessage` passes for a `goal_renegotiation` row: its
      // stored `trajectory_sec` is a different quantity, so it is not read.
      const m = composeGoalOutlookMessage({
        projectedSec: null, basis: null, goalSec: 10800, weeksRemaining: 14,
      });
      expect(m).toContain('3:00:00');
      expect(m).toContain('season ambition');
      expect(m).not.toMatch(/3:31:48|3:22:17/);
      expect(m).not.toMatch(/set the revised target/i);
    });

    it('says "Today\'s fitness" only when that is genuinely the basis', () => {
      expect(composeGoalOutlookMessage({ ...OWNER, basis: 'equivalence' }))
        .toMatch(/Today's fitness projects/);
      expect(composeGoalOutlookMessage(OWNER)).toMatch(/This build projects/);
    });
  });

  /* ── the declaration itself ───────────────────────────────────────────── */
  it('the kind predicates cover the live kind AND the retired one', () => {
    // The retired kind must keep resolving, or the owner's standing row stops
    // forcing BEHIND and stops rendering as a note the moment this deploys.
    expect(isGoalOutlookKind('goal_outlook')).toBe(true);
    expect(isGoalOutlookKind('goal_renegotiation')).toBe(true);
    expect(isGoalOutlookKind('volume_drift')).toBe(false);
    expect(isGoalOutlookKind(null)).toBe(false);
    expect(isInformationalProposalKind('goal_renegotiation')).toBe(true);
    expect(isInformationalProposalKind('staleness')).toBe(false);
  });

  /* ── the ratchet ──────────────────────────────────────────────────────── */
  it('every exemption is argued, and a stale one fails until deleted', () => {
    for (const e of GOAL_IMMUTABILITY_EXEMPTIONS) {
      expect(e.reason.length, `exemption for ${e.file} carries no argument`).toBeGreaterThan(40);
      const full = path.join(WEB, e.file);
      expect(fs.existsSync(full), `exemption names a file that no longer exists: ${e.file}`).toBe(true);
      // Rule 18 clause 4 · an exemption whose target is CLEAN must be deleted,
      // asked with the exact predicate of the guard it excuses.
      const stillViolates = GUARD_PREDICATE[e.guard](fs.readFileSync(full, 'utf8'));
      expect(stillViolates,
        `STALE EXEMPTION · ${e.file} no longer trips guard ${e.guard}. Delete the entry.`).toBe(true);
    }
    // The allowlist is a ratchet too.
    for (const f of GOAL_EDITOR_FILES) {
      const full = path.join(WEB, f);
      expect(fs.existsSync(full), `GOAL_EDITOR_FILES names a missing file: ${f}`).toBe(true);
      const body = codeLines(fs.readFileSync(full, 'utf8')).map((l) => l.text).join('\n');
      expect(/\bgoal\b/.test(body),
        `STALE ALLOWLIST · ${f} no longer writes a goal. Delete the entry.`).toBe(true);
    }
  });
});
