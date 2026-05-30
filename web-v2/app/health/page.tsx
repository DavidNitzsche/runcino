import { Shell } from '@/components/faff-app/Shell';
import { buildSeed } from '@/components/faff-app/seed';

export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  const seed = await buildSeed();
  return <Shell seed={seed} initial="health" />;
}
