import { notFound } from 'next/navigation';
import { Shell } from '@/components/faff-app/Shell';
import { buildSeed } from '@/components/faff-app/seed';
import { buildRaceDetail } from '@/components/faff-app/raceDetail';

export const dynamic = 'force-dynamic';

export default async function RaceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [seed, race] = await Promise.all([buildSeed(), buildRaceDetail(slug)]);
  if (!race) notFound();
  return <Shell seed={seed} initial="race" raceSeed={race} />;
}
