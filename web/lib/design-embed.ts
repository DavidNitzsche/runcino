/**
 * Design-embed loader.
 *
 * Reads a design HTML file from `designs/<slug>.html` (the canonical
 * visual reference) and returns its body content + page-specific CSS,
 * with the design's own caption + nav stripped (the React app provides
 * its own). Used by the / and /training and /health and /log pages so
 * we get visually faithful first-pass renders without porting hundreds
 * of inline styles by hand.
 *
 * This is intentionally a v1 mechanism. As pages get React-ified
 * incrementally, individual sections move from this raw embed into
 * proper components, until the embed call gets removed.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export interface EmbeddedDesign {
  /** HTML to drop into <div dangerouslySetInnerHTML={{ __html: ... }} /> */
  bodyHtml: string;
  /** CSS to drop into a <style dangerouslySetInnerHTML={{ __html: ... }} /> */
  css: string;
}

/** Resolve the workspace root by walking up from the web/ cwd. The
 *  design files live one level above at `../designs/<slug>.html`. */
function designPath(slug: string): string {
  return join(process.cwd(), '..', 'designs', `${slug}.html`);
}

export function loadDesignEmbed(slug: string): EmbeddedDesign {
  const raw = readFileSync(designPath(slug), 'utf-8');

  // Pull out the page's <style>...</style>. Multiple may exist; concat.
  let css = '';
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(raw)) !== null) css += m[1] + '\n';

  // Extract just the body content of the design (the <div class="body">
  // section inside <div class="stage">). Ignores the design's own
  // caption strip + nav, which the React layout supplies.
  const bodyMatch = raw.match(
    /<div class="body">([\s\S]+?)<\/div>\s*<\/div>\s*(?:<script|<\/body>)/
  );
  let bodyHtml = bodyMatch ? bodyMatch[1] : '';

  // Rewrite design's intra-site .html links to Next.js routes.
  bodyHtml = bodyHtml.replace(/href="hub\.html"/g, 'href="/"');
  bodyHtml = bodyHtml.replace(/href="races\.html"/g, 'href="/races"');
  bodyHtml = bodyHtml.replace(/href="training\.html"/g, 'href="/training"');
  bodyHtml = bodyHtml.replace(/href="health\.html"/g, 'href="/health"');
  bodyHtml = bodyHtml.replace(/href="log\.html"/g, 'href="/log"');
  bodyHtml = bodyHtml.replace(/href="race-detail\.html"/g, 'href="/races/big-sur-marathon"');
  bodyHtml = bodyHtml.replace(
    /href="race-detail-sombrero\.html"/g,
    'href="/races/sombrero-half"'
  );

  return { bodyHtml, css };
}
