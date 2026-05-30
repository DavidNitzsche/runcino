import { redirect } from 'next/navigation';

// Settings live inside the Faff Profile (Me) view now.
export default function SettingsPage() {
  redirect('/me');
}
