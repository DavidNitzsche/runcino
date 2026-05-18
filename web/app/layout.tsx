import type { Metadata } from 'next';
import './globals.css';
import { getAccentColor } from '@/lib/accent-color';

export const metadata: Metadata = {
  title: 'Runcino',
  description: 'Personal Apple Watch race pacing tool.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const accent = await getAccentColor();
  // Override --corp (canonical brand color used throughout the app) and
  // expose --accent for new surfaces that want to opt into the user's
  // pick explicitly. Cast keeps TS happy on custom CSS properties.
  const accentStyle = { ['--corp' as string]: accent, ['--accent' as string]: accent } as React.CSSProperties;
  return (
    <html lang="en" style={accentStyle}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Jost:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap"
        />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
