/**
 * Seed learn_articles from /Research/INDEX.md.
 *
 * Strategy: parse INDEX.md sections + entries.
 *   - Each `## <group-title>` becomes the EYEBROW for child entries.
 *   - Each `### [NN-slug.md](NN-slug.md)` + following paragraph + Sections line
 *     becomes one learn_articles row.
 *   - slug = `research-<NN>-<slug>` so it never collides with future
 *     content (which can use plain slugs like 'why-rest-works').
 *   - body_md = the description paragraph + a "Read the full reference"
 *     pointer + the Sections list.
 *   - citations_json carries the file path so the API can lazy-load the
 *     full markdown when needed.
 *   - related_slugs is empty for now; cross-linking is a later pass.
 *
 * Idempotent via ON CONFLICT (slug) DO UPDATE.
 */
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';

const INDEX_PATH = '/Volumes/WP/06 Claude Code/Runcino/Research/INDEX.md';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function titleize(slug) {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bVdot\b/g, 'VDOT')
    .replace(/\bHrv?\b/g, m => m.toUpperCase())
    .replace(/\bVo2max\b/i, 'VO2max');
}

function parseIndex(md) {
  const lines = md.split('\n');
  const articles = [];
  let eyebrow = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // group heading "## Foundational input layer"
    const groupM = l.match(/^## (.+)$/);
    if (groupM) {
      const t = groupM[1].trim();
      if (t === 'Reading order') continue;
      eyebrow = t.replace(/\s+/g, ' ').toUpperCase();
      continue;
    }
    // entry heading "### [NN-slug.md](NN-slug.md)"
    const entryM = l.match(/^### \[(\d+\w?)-([^\]]+)\.md\]\(/);
    if (entryM) {
      const num = entryM[1];
      const slugCore = entryM[2];
      const fullSlug = `research-${num}-${slugCore}`;
      // pull description paragraph (next non-empty line until blank or "**Sections:**")
      let body = '';
      let sections = '';
      for (let j = i + 1; j < lines.length; j++) {
        const ln = lines[j];
        if (ln.startsWith('### ') || ln.startsWith('## ') || ln === '---') break;
        if (ln.startsWith('**Sections:**')) {
          sections = ln.replace(/^\*\*Sections:\*\*\s*/, '').trim();
          break;
        }
        if (ln.trim()) body += (body ? ' ' : '') + ln.trim();
      }
      articles.push({
        num,
        slug: fullSlug,
        sourcePath: `Research/${num}-${slugCore}.md`,
        title: titleize(slugCore),
        eyebrow: eyebrow ?? 'RESEARCH',
        body,
        sections,
      });
    }
  }
  return articles;
}

async function q(sql, params=[]) { return (await pool.query(sql, params)); }

try {
  const md = readFileSync(INDEX_PATH, 'utf8');
  const articles = parseIndex(md);
  console.log('Parsed', articles.length, 'articles');

  for (const a of articles) {
    const bodyMd = [
      a.body,
      '',
      `**Full reference:** \`${a.sourcePath}\`. The coach reads the full markdown at runtime; the in-app reader shows this summary.`,
      '',
      a.sections ? `### Sections covered\n${a.sections.split(';').map(s => '- ' + s.trim().replace(/\.$/, '')).join('\n')}` : '',
    ].filter(Boolean).join('\n');

    const citations = [
      { kind: 'doctrine', path: a.sourcePath, label: `Research/${a.num}` },
    ];

    await q(
      `INSERT INTO learn_articles (slug, title, eyebrow, body_md, citations_json, related_slugs, updated_ts)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
       ON CONFLICT (slug) DO UPDATE
       SET title = EXCLUDED.title, eyebrow = EXCLUDED.eyebrow,
           body_md = EXCLUDED.body_md, citations_json = EXCLUDED.citations_json,
           updated_ts = NOW()`,
      [a.slug, a.title, a.eyebrow, bodyMd, JSON.stringify(citations), []]
    );
  }

  const all = await q(`SELECT slug, title, eyebrow FROM learn_articles ORDER BY slug`);
  console.log('\nlearn_articles now (' + all.rowCount + ' rows):');
  for (const r of all.rows) console.log(`  ${r.slug.padEnd(42)} [${(r.eyebrow ?? '').padEnd(28)}] ${r.title}`);
} catch (e) { console.error(e); process.exit(1); }
finally { await pool.end(); }
