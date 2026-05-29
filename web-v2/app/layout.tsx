import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'faff.run',
  description: 'Your coach. Your race. Your training.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Paper-overhaul 2026-05-29: warm-paper canvas. Reverting the skin = drop
  // data-skin below + restore #0a0c10 here.
  themeColor: '#F2EFE9',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-skin="paper" activates the FAFF technical spec-sheet token layer in
    // globals.css. Remove this one attribute to revert to the dark theme
    // (Cardinal Rule #8 · dark stays revertable via token swap).
    <html lang="en" data-skin="paper">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* v3 typography (2026-05-28): Oswald 700 for display, Inter for body.
         *  HelveticaNeue-Bold dropped — Oswald handles hero kerning natively.
         *  Both families load via globals.css @import as well; preload here
         *  to avoid FOUT on first paint. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Oswald:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
