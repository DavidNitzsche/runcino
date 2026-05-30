import { redirect } from 'next/navigation';

// Usage dashboard is an operator surface; route normal traffic to Today.
export default function UsagePage() {
  redirect('/today');
}
