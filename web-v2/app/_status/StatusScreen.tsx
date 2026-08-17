/**
 * StatusScreen · the shared frame for Next's three route-level surfaces
 * (not-found / error / loading).
 *
 * 2026-08-17 · Before this existed there were NO `not-found.tsx`,
 * `error.tsx` or `loading.tsx` anywhere under `app/`. A mistyped URL, a
 * thrown render, or a slow segment all fell through to Next's built-in
 * pages, which are WHITE, unstyled, carry no navigation, and give the
 * runner no way back into a fully dark app. The first thing a runner saw
 * when something went wrong was a page that did not look like the product.
 *
 * These surfaces render OUTSIDE the app shell (`.win` / `.side` / `.main`
 * all live inside the page components, not the root layout), so this frame
 * paints its own background and supplies its own way out. It leans on the
 * existing `.ph` / `.phl` / `.phs` placeholder tokens so it inherits the
 * app's type ramp rather than inventing a second one.
 */
import Link from 'next/link';

export function StatusScreen({
  eyebrow,
  title,
  body,
  children,
  busy,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  children?: React.ReactNode;
  busy?: boolean;
}) {
  return (
    <div className="statusscreen">
      <div
        className="statusscreen-in"
        role={busy ? 'status' : 'alert'}
        aria-busy={busy ? 'true' : undefined}
      >
        <span className="statusscreen-brand">FAFF.RUN</span>
        {eyebrow ? <div className="statusscreen-eyebrow">{eyebrow}</div> : null}
        <h1 className="statusscreen-title">{title}</h1>
        {body ? <p className="statusscreen-body">{body}</p> : null}
        {children ? <div className="statusscreen-actions">{children}</div> : null}
      </div>
    </div>
  );
}

/** The always-available way back. Every status surface carries one. */
export function StatusHomeLink({ label = 'Back to today' }: { label?: string }) {
  return (
    <Link href="/today" className="statusscreen-btn">
      {label}
    </Link>
  );
}
