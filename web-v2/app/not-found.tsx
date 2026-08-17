import { StatusScreen, StatusHomeLink } from './_status/StatusScreen';

export default function NotFound() {
  return (
    <StatusScreen
      eyebrow="404"
      title="No page here"
      body="That address does not match anything in the app. It may have been renamed, or the link may be out of date."
    >
      <StatusHomeLink />
    </StatusScreen>
  );
}
