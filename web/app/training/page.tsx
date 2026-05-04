/**
 * /training — Weekly + season-arc training view.
 *
 * v1 embeds designs/training.html. Mock data; real coaching loop and
 * weekly plan generation are M3 per the master plan.
 */

import { Caption, Nav } from '../../components/nav';
import { loadDesignEmbed } from '../../lib/design-embed';

export default function TrainingPage() {
  const { bodyHtml, css } = loadDesignEmbed('training');
  return (
    <>
      <Caption left="Runcino · training" right="TRAINING · WEEK + ARC" />
      <div className="stage">
        <Nav active="training" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <div className="body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      </div>
    </>
  );
}
