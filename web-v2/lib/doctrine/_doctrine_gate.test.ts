/**
 * lib/doctrine/_doctrine_gate.test.ts · THE doctrine gate.
 *
 * `_maint_invariants.test.ts` and `_sweep_allusers.test.ts` check that a plan
 * is well-FORMED. This file checks that the engine's training-science constants
 * still say what the research says. Those are different questions, and only the
 * first one had a test before 2026-08-17.
 *
 * Three failures are possible and they mean different things:
 *
 *   · CITATION LOST   — the doctrine passage moved, was reworded, or was
 *                       deleted. Go read the doc. Re-anchor, or change the
 *                       constant if doctrine genuinely changed.
 *   · CLAIM BROKEN    — the constant drifted away from what doctrine says.
 *                       Fix the constant, not the claim.
 *   · EXEMPTION STALE — a recorded violation no longer reproduces, i.e.
 *                       somebody fixed it. Delete the exemption.
 *
 * There is no fourth option where you relax the claim to get to green.
 */
import { describe, it, expect } from 'vitest';
import { DOCTRINE_REGISTRY } from './registry';
import { resolveCitation } from './resolve';
import type { ClaimContext } from './types';

describe('DOCTRINE GATE · every physiology constant is bound to its citation', () => {
  it('claim ids are unique and well-formed', () => {
    const ids = DOCTRINE_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size, `duplicate claim id: ${ids.filter((v, i) => ids.indexOf(v) !== i)}`).toBe(ids.length);
    for (const id of ids) expect(id, `claim id "${id}" must read AREA.claim-in-kebab`).toMatch(/^[A-Z0-9]+\.[a-z0-9-]+$/);
  });

  it('every claim declares what it binds and what doctrine says', () => {
    for (const c of DOCTRINE_REGISTRY) {
      expect(c.binds.length, `${c.id} binds nothing · a claim with no engine binding guards nothing`).toBeGreaterThan(0);
      for (const b of c.binds) expect(b, `${c.id} binding "${b}" should read path#symbol`).toContain('#');
      expect(c.claim.length, `${c.id} needs a plain-English claim, not a stub`).toBeGreaterThan(40);
      expect(c.anchor, `${c.id} must anchor on quoted text, never a line number`).not.toMatch(/^\s*\d+([-:]\d+)?\s*$/);
    }
  });

  it.each(DOCTRINE_REGISTRY.map((c) => [c.id, c] as const))('%s · citation resolves', (_id, claim) => {
    // Throws with the doc, the anchor and what to do when the passage has moved.
    const cite = resolveCitation(claim.doc, claim.anchor);
    expect(cite.section.length).toBeGreaterThan(0);
  });

  it.each(DOCTRINE_REGISTRY.map((c) => [c.id, c] as const))('%s · engine satisfies the claim', (_id, claim) => {
    const cite = resolveCitation(claim.doc, claim.anchor);
    const used = new Set<string>();
    const ctx: ClaimContext = {
      cite,
      exempt(key) {
        if (!claim.exempt || !(key in claim.exempt)) return false;
        used.add(key);
        return true;
      },
    };
    try {
      claim.check(ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `DOCTRINE · ${claim.id}\n` +
          `  binds:  ${claim.binds.join(', ')}\n` +
          `  cite:   ${claim.doc} · "${claim.anchor}" (line ${cite.line})\n` +
          `  claim:  ${claim.claim}\n` +
          `  broke:  ${msg}\n\n` +
          '  Fix the engine constant, not the claim. If doctrine itself changed, change the\n' +
          '  doc first and re-derive the constant from it. If this is a real violation you are\n' +
          '  not fixing right now, add a key to this claim\'s `exempt` map with an honest\n' +
          '  reason — never widen the claim to swallow it.',
      );
    }
  });

  it('no exemption is stale · a recorded violation that no longer reproduces must be deleted', () => {
    const stale: string[] = [];
    for (const claim of DOCTRINE_REGISTRY) {
      const keys = Object.keys(claim.exempt ?? {});
      if (keys.length === 0) continue;
      const cite = resolveCitation(claim.doc, claim.anchor);
      for (const key of keys) {
        // Re-run the check with THIS key denied. If it now passes, the violation
        // it was recording has been fixed and the exemption is lying.
        const ctx: ClaimContext = {
          cite,
          exempt: (k) => k !== key && k in (claim.exempt ?? {}),
        };
        let stillViolates = false;
        try {
          claim.check(ctx);
        } catch {
          stillViolates = true;
        }
        if (!stillViolates) stale.push(`${claim.id} · ${key}`);
      }
    }
    expect(
      stale,
      `these exemptions no longer reproduce — the violation was fixed, so delete the entry:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every exemption carries a reason someone can act on', () => {
    for (const claim of DOCTRINE_REGISTRY) {
      for (const [key, reason] of Object.entries(claim.exempt ?? {})) {
        expect(reason.length, `${claim.id} · ${key} needs a real reason, not a placeholder`).toBeGreaterThan(60);
      }
    }
  });

  it('reports the known violations it is currently carrying', () => {
    const rows = DOCTRINE_REGISTRY.flatMap((c) =>
      Object.entries(c.exempt ?? {}).map(([k, v]) => `  ${c.id} · ${k}\n    ${v.replace(/\s+/g, ' ')}`),
    );
    // Not an assertion · this prints in CI so a violation cannot be carried silently.
    console.log(`\n=== DOCTRINE · ${DOCTRINE_REGISTRY.length} claims · ${rows.length} recorded violations ===\n${rows.join('\n')}\n`);
    expect(DOCTRINE_REGISTRY.length).toBeGreaterThan(0);
  });
});
