import '../../redesign/styles.css';
import { buildSeed } from '@/components/faff-app/seed';
import { GearClient } from '@/components/redesign/gear/GearClient';

export const dynamic = 'force-dynamic';

/**
 * app/me/gear/page.tsx
 *
 * 2026-08-18 · Live cutover — canonical route for the Gear (shoe garage)
 * screen, replacing the /redesign/gear address. Nested under /me (Settings)
 * per the design brief's own hierarchy ("Gear · off Settings, over
 * whatever surface was showing" — GearClient.tsx's own header comment),
 * chrome-free like its /redesign/gear counterpart. Mirrors
 * app/redesign/gear/page.tsx exactly — same buildSeed() load, same
 * GET /api/shoe client-side refresh for retired pairs.
 */
export default async function MeGearPage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <GearClient seed={seed} />
    </div>
  );
}
