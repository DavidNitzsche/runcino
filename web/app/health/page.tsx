/**
 * /health — Health signals (HRV, sleep, RHR, load).
 *
 * v1 embeds designs/health.html. Mock data; real HealthKit-fed numbers
 * are M2 (iOS reads HKQuery → writes to iCloud-Drive JSON → web reads).
 */

import { Caption, Nav } from '../../components/nav';
import { loadDesignEmbed } from '../../lib/design-embed';

export default function HealthPage() {
  const { bodyHtml, css } = loadDesignEmbed('health');
  return (
    <>
      <Caption left="Runcino · health" right="HEALTH · 7D / 30D / 90D" />
      <div className="stage">
        <Nav active="health" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <div className="body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      </div>
    </>
  );
}
