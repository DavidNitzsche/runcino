import '../../redesign/styles.css';
import { notFound } from 'next/navigation';
import { buildRaceDetail } from '@/components/faff-app/raceDetail';
import { RaceDetailClient } from '@/components/redesign/races/RaceDetailClient';

export const dynamic = 'force-dynamic';

/**
 * app/goal/[slug]/page.tsx
 *
 * 2026-08-18 · Live cutover — this route now renders the redesigned Race
 * Detail screen directly (previously mounted the old Shell + RaceView).
 * Same real buildRaceDetail(slug) data load and race-data-doctrine
 * compliance — see app/redesign/races/[slug]/page.tsx for the full
 * doctrine/slug-decode rationale, mirrored here exactly. The old
 * Shell-based RaceView is preserved in git history and in
 * components/faff-app/views/RaceView.tsx, just no longer routed here.
 * Chrome-free (no Rail) — Race Detail is a Level-2 detail page per the
 * design brief, same as Run Detail and Race Week.
 */
export default async function RaceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const race = await buildRaceDetail(slug);
  if (!race) notFound();
  return (
    <div className="redesign-root" data-theme="light">
      <RaceDetailClient race={race} />
    </div>
  );
}
