import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Runcino',
  description: 'Personal Apple Watch race pacing tool.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
