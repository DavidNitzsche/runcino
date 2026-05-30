import { redirect } from 'next/navigation';

// Form-metric tips live inside the Faff Health view now.
export default function TipsPage() {
  redirect('/health');
}
