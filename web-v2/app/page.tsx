import { redirect } from 'next/navigation';

// Root → TODAY. TODAY is the home surface; everything else hangs off of it via tabs.
export default function Home() {
  redirect('/today');
}
