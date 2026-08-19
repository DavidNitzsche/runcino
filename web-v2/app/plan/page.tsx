import { Shell } from '@/components/faff-app/Shell';
import { buildSeed } from '@/components/faff-app/seed';

export const dynamic = 'force-dynamic';

// Legacy alias — Plan lives under Training (Faff Train tab).
export default async function PlanPage() {
  const seed = await buildSeed();
  return <Shell seed={seed} initial="train" />;
}
