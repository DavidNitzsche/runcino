import type { Metadata } from 'next';
import './globals.css';
import { getCurrentUser } from '@/lib/auth';
import { ActiveModeBanner } from './components/ActiveModeBanner';

export const metadata: Metadata = {
  title: 'faff.run',
  description: 'Personal Apple Watch race pacing tool.',
};

/** Canonical faff.run brand accent, matches `--orange` in profile-v4.css. */
const DEFAULT_ACCENT = '#E85D26';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve the logged-in user's accent so the whole app paints correctly
  // on first byte. Anonymous / unauthenticated pages (login, signup) just
  // get the default, no harm done.
  let accent = DEFAULT_ACCENT;
  try {
    const u = await getCurrentUser();
    if (u?.accent_color && /^#[0-9a-fA-F]{6}$/.test(u.accent_color)) {
      accent = u.accent_color;
    }
  } catch {
    // DB unavailable / cold start, fall back to default
  }

  const accentStyle = {
    ['--accent' as string]: accent,
    ['--orange' as string]: accent,
  } as React.CSSProperties;

  return (
    <html lang="en" style={accentStyle}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap"
        />
      </head>
      <body className="min-h-screen">
        <ActiveModeBanner />
        {children}
      </body>
    </html>
  );
}
