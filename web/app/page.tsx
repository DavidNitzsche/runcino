/**
 * / — Overview / Hub. Daily home: greeting, recovery, miles, next race,
 * today's workout, the season arc, instrument grid (HRV / sleep / load
 * / threshold pace / cadence / etc.).
 *
 * v1 implementation embeds the canonical design from designs/hub.html
 * verbatim. As individual sections gain real data, they get peeled out
 * into React components.
 */

import { Caption, Nav } from '../components/nav';
import { loadDesignEmbed } from '../lib/design-embed';

export default function OverviewPage() {
  const { bodyHtml, css } = loadDesignEmbed('hub');
  return (
    <>
      <Caption left="Runcino · overview" right={`OVERVIEW · ${new Date().toISOString().slice(0,10)}`} />
      <div className="stage">
        <Nav active="overview" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <div className="body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      </div>
    </>
  );
}
