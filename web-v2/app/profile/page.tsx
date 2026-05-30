import { Shell } from '@/components/faff-app/Shell';
import { buildSeed } from '@/components/faff-app/seed';

export const dynamic = 'force-dynamic';

// Legacy alias — Profile now mounted as Faff Me (profile view).
export default async function ProfilePage() {
  const seed = await buildSeed();
  return <Shell seed={seed} initial="profile" />;
}
