/**
 * /log — Run history + per-run detail.
 *
 * v1 embeds designs/log.html. Mock data; the real ingest path is
 * Strava OAuth (M2) → normalize into SavedRun → render here.
 */

import { Caption, Nav } from '../../components/nav';
import { loadDesignEmbed } from '../../lib/design-embed';

export default function LogPage() {
  const { bodyHtml, css } = loadDesignEmbed('log');
  return (
    <>
      <Caption left="Runcino · log" right="LOG · RUNS" />
      <div className="stage">
        <Nav active="log" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <div className="body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      </div>
    </>
  );
}
