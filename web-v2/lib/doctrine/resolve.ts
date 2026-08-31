/**
 * lib/doctrine/resolve.ts · resolve a doctrine citation against the real file.
 *
 * The doctrine gate's job is to make a training-science NUMBER and its
 * JUSTIFICATION unable to drift apart. That only works if the test reads the
 * justification at run time instead of trusting a number a human copied out of
 * a table months ago.
 *
 * So citations anchor on VERBATIM TEXT, never on line numbers. Line numbers rot
 * the moment anyone edits a Research/ doc — the incident this gate exists to
 * prevent was itself described by a line range (`00b:196-204`) that will be
 * wrong after the next paragraph is inserted above it. A quoted table header
 * survives every edit that doesn't change what the table says, and when it
 * DOESN'T survive, that is exactly the moment a human should re-read the claim.
 *
 * Nothing here touches the database or the network. Pure fs + string work, so
 * it runs in prebuild on a cold container.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Repo root · the directory that contains `Research/`. */
export function repoRoot(): string {
  if (process.env.FAFF_REPO_ROOT) return process.env.FAFF_REPO_ROOT;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'Research', 'INDEX.md'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(
    'DOCTRINE · cannot locate the repo root (no Research/INDEX.md found walking up from ' +
      `${process.cwd()}). Set FAFF_REPO_ROOT if you are running from an unusual cwd.`,
  );
}

/**
 * Read an engine source file as text, repo-relative.
 *
 * Used by claims that bind a constant which is module-local (not exported).
 * A text binding is weaker than importing the symbol — prefer exporting the
 * constant when you can — but it is far better than leaving a number that
 * asserts physiology with nothing watching it.
 */
export function sourceOf(repoRelPath: string): string {
  const abs = path.join(repoRoot(), repoRelPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`DOCTRINE · bound source file does not exist: ${repoRelPath}`);
  }
  return fs.readFileSync(abs, 'utf8');
}

/**
 * Pull the numbers out of a source literal, e.g.
 * `matchLiteral(src, /const taperFactor = .*?0\.45.*?;/)`.
 * Fails loudly (naming the claim's binding) when the literal has been
 * refactored away, because a claim bound to code that no longer exists is a
 * claim that silently stopped guarding anything.
 */
export function matchLiteral(source: string, re: RegExp, binding: string): RegExpMatchArray {
  const m = source.match(re);
  if (!m) {
    throw new Error(
      `DOCTRINE · bound literal not found for ${binding}\n  pattern: ${re}\n` +
        '  The code this claim watches has been refactored. Re-point the claim at the new\n' +
        '  expression (and prefer exporting the constant so the claim can import it).',
    );
  }
  return m;
}

/** A markdown table lifted out of a doctrine file, addressed by column name. */
export interface DoctrineTable {
  headers: string[];
  /** Cells keyed by header text, in document order. */
  rows: Record<string, string>[];
  /**
   * The row whose FIRST cell matches `label` (case-insensitive, punctuation and
   * whitespace normalised). Throws with the available labels when absent — a
   * doc edit that renames a row must not silently pass.
   */
  row(label: string): Record<string, string>;
  /** `row(label)[column]`, with the same loud failure on a renamed column. */
  cell(label: string, column: string): string;
}

/** What an assertion sees: the doctrine passage, already located. */
export interface ResolvedCitation {
  doc: string;
  /** 1-based line the anchor was found on · for failure messages only. */
  line: number;
  /** Every line of the file from the anchor to the end of its section. */
  section: string[];
  /** The first markdown table at or after the anchor. */
  table(): DoctrineTable;
  /** Raw text of the section, joined. */
  text(): string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[*`]/g, '').replace(/\s+/g, ' ');

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim().replace(/^\*\*|\*\*$/g, ''));
}

const isTableRow = (l: string) => /^\s*\|/.test(l);
const isDividerRow = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l);

function buildTable(lines: string[], doc: string, anchor: string): DoctrineTable {
  const start = lines.findIndex(isTableRow);
  if (start < 0) {
    throw new Error(
      `DOCTRINE · no markdown table follows the anchor in ${doc}\n  anchor: ${anchor}`,
    );
  }
  const block: string[] = [];
  for (let i = start; i < lines.length && isTableRow(lines[i]); i++) block.push(lines[i]);
  const headers = splitRow(block[0]);
  const body = block.slice(1).filter((l) => !isDividerRow(l));
  const rows = body.map((l) => {
    const cells = splitRow(l);
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => (rec[h] = cells[i] ?? ''));
    return rec;
  });

  const findCol = (column: string) => {
    const hit = headers.find((h) => norm(h) === norm(column));
    if (!hit) {
      throw new Error(
        `DOCTRINE · column "${column}" is gone from the table in ${doc}\n` +
          `  anchor:  ${anchor}\n  columns: ${headers.join(' | ')}\n` +
          '  Re-read the table and update the claim — do not guess a replacement column.',
      );
    }
    return hit;
  };
  const row = (label: string) => {
    const hit = rows.find((r) => norm(r[headers[0]]) === norm(label));
    if (!hit) {
      throw new Error(
        `DOCTRINE · row "${label}" is gone from the table in ${doc}\n` +
          `  anchor: ${anchor}\n  rows:   ${rows.map((r) => r[headers[0]]).join(' · ')}\n` +
          '  Re-read the table and update the claim — do not guess a replacement row.',
      );
    }
    return hit;
  };
  return { headers, rows, row, cell: (label, column) => row(label)[findCol(column)] };
}

/**
 * Find `anchor` verbatim in `doc` and return the section that follows it.
 *
 * `anchor` is matched as a plain substring of a single line — no regex, no
 * normalisation. If it appears more than once the FIRST hit wins and the
 * caller is told, because an ambiguous anchor is a weak anchor.
 */
export function resolveCitation(doc: string, anchor: string): ResolvedCitation {
  const abs = path.join(repoRoot(), doc);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `DOCTRINE · cited file does not exist: ${doc}\n` +
        '  Either the doc moved (update `doc:` on the claim) or the claim is stale.',
    );
  }
  const all = fs.readFileSync(abs, 'utf8').split('\n');
  const hits = all.reduce<number[]>((acc, l, i) => (l.includes(anchor) ? [...acc, i] : acc), []);
  if (hits.length === 0) {
    throw new Error(
      `DOCTRINE · anchor text is no longer in ${doc}\n` +
        `  anchor: ${anchor}\n` +
        '  The doctrine passage this claim binds to has moved, been reworded, or been\n' +
        '  deleted. Do NOT relax the claim to make this pass. Open the doc, find what the\n' +
        '  passage says now, and either (a) re-anchor the claim on the new wording and\n' +
        '  re-check that the engine constant still satisfies it, or (b) if doctrine really\n' +
        '  changed, change the engine constant first and then the claim.',
    );
  }
  const at = hits[0];
  // Section = anchor through the next markdown heading of the same or higher
  // level.
  //
  // 2026-08-30 · a `#` inside a FENCED CODE BLOCK is a comment, not a heading.
  // Research/15 §"Acute:Chronic Workload Ratio (ACWR)" opens with a fenced
  // block whose second line is `# both can be rolling averages or ...`, which
  // truncated the section three lines in and hid the zone table underneath it
  // from `table()` entirely. A resolver that silently hands a claim the wrong
  // slice of the doc is the Rule 18 failure mode — the claim still passes, it
  // just stops meaning anything — so fences are tracked rather than the anchor
  // being moved to dodge one.
  let end = all.length;
  let inFence = false;
  const fenceAt = (i: number) => /^\s*(```|~~~)/.test(all[i]);
  const headingAt = (i: number) => !inFence && /^#{1,6}\s/.test(all[i]);
  for (let i = at + 1; i < all.length; i++) {
    if (fenceAt(i)) {
      inFence = !inFence;
      continue;
    }
    if (headingAt(i) && i > at + 1) {
      end = i;
      break;
    }
  }
  const section = all.slice(at, end);
  return {
    doc,
    line: at + 1,
    section,
    text: () => section.join('\n'),
    table: () => buildTable(section, doc, anchor),
  };
}

/**
 * Read a numeric band out of doctrine prose: `10–14`, `20-30%`, `≤25–30%`,
 * `~86–88%`, `4`, `<60%`. Returns `[lo, hi]` (equal when a single number).
 *
 * En-dash vs hyphen is the trap here — the Research/ docs use both, sometimes
 * in the same table. Normalise before parsing, never after.
 */
export function parseBand(cell: string): [number, number] {
  const cleaned = cell
    .replace(/[–—−]/g, '-')
    .replace(/[~≈≤≥<>%*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .trim();
  const m = cleaned.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
  if (m) return [Number(m[1]), Number(m[2])];
  const one = cleaned.match(/(-?\d+(?:\.\d+)?)/);
  if (one) return [Number(one[1]), Number(one[1])];
  throw new Error(`DOCTRINE · no number in doctrine cell "${cell}"`);
}

/** `parseBand` for percentage cells, returned as fractions: `30-50%` → `[0.3, 0.5]`. */
export function parsePctBand(cell: string): [number, number] {
  const [lo, hi] = parseBand(cell);
  return [lo / 100, hi / 100];
}

/**
 * Read a pace band out of doctrine prose: `8:35–9:27` → `[515, 567]` seconds,
 * `6:51` → `[411, 411]`. Trailing prose (`6:18 (per mi; reps timed)`) is ignored.
 */
export function parsePaceBandSec(cell: string): [number, number] {
  const src = cell.replace(/[–—−]/g, '-').replace(/\([^)]*\)/g, ' ');
  const re = /(\d{1,2}):(\d{2})/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(Number(m[1]) * 60 + Number(m[2]));
  if (out.length === 0) throw new Error(`DOCTRINE · no mm:ss pace in doctrine cell "${cell}"`);
  return [out[0], out[out.length - 1]];
}

/** Every band on a line, in order · for prose rules that carry several. */
export function parseBands(text: string): [number, number][] {
  const out: [number, number][] = [];
  const src = text.replace(/[–—−]/g, '-');
  const re = /(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push([Number(m[1]), Number(m[2])]);
  return out;
}
