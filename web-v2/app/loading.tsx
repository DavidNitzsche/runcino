import { StatusScreen } from './_status/StatusScreen';

/**
 * Shown while a route segment streams. Deliberately quiet: a title and a
 * pulse, no spinner theatre, and `role="status"` so it is announced rather
 * than appearing as a silent blank frame.
 */
export default function Loading() {
  return (
    <StatusScreen busy eyebrow="Loading" title="Pulling your training">
      <span className="statusscreen-pulse" aria-hidden="true">
        <i /><i /><i />
      </span>
    </StatusScreen>
  );
}
