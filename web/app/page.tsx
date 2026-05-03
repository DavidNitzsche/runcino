import { redirect } from 'next/navigation';

/**
 * Root route → redirect to /races. The races index is the new app entry
 * point. The legacy single-page builder is gone; /races/new is the
 * surface for "type a race + drop a GPX → get everything."
 */
export default function Home() {
  redirect('/races');
}
