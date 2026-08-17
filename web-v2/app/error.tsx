'use client';

import { useEffect } from 'react';
import { StatusScreen, StatusHomeLink } from './_status/StatusScreen';

/**
 * Route-level error boundary. `reset()` re-runs the failed segment, which
 * is the honest first offer: most failures here are a dropped request, not
 * a broken page. The way home sits beside it either way — a runner should
 * never be stranded on a dead screen.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[route error]', error);
  }, [error]);

  return (
    <StatusScreen
      eyebrow="Something broke"
      title="This page did not load"
      body="The error is on our side, not yours. Nothing you have logged is affected."
    >
      <button type="button" className="statusscreen-btn" onClick={() => reset()}>
        Try again
      </button>
      <StatusHomeLink />
      {error.digest ? (
        <span className="statusscreen-digest">Reference {error.digest}</span>
      ) : null}
    </StatusScreen>
  );
}
