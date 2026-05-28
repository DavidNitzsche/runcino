import type { Topic } from '@/lib/topics/types';
import { RunRecapCard } from './RunRecapCard';
import { CardErrorBoundary } from './CardErrorBoundary';
import {
  NextWorkoutCard, RaceHorizonCard, ProfileGapCard,
  SleepDeficitCard, WatchListCard, FunFactCard,
  NiggleCard, LoadRampCard, WeeklyVolumeCard, LongRunHorizonCard,
} from './SimpleCards';

/**
 * Polymorphic renderer — picks the right component per topic kind.
 * Topic kinds not in this switch are silently dropped (forward-compat).
 */
export function TopicRenderer({ topic }: { topic: Topic }) {
  return (
    <CardErrorBoundary label={`${topic.kind} card`}>
      <TopicRendererInner topic={topic} />
    </CardErrorBoundary>
  );
}

function TopicRendererInner({ topic }: { topic: Topic }) {
  switch (topic.kind) {
    case 'run_recap':
      return <RunRecapCard payload={topic.payload} coach_note={topic.coach_note} />;
    case 'next_workout':
      return <NextWorkoutCard payload={topic.payload} coach_note={topic.coach_note} />;
    case 'race_horizon':
      return <RaceHorizonCard payload={topic.payload} coach_note={topic.coach_note} />;
    case 'profile_gap':
      return <ProfileGapCard payload={topic.payload} />;
    case 'sleep_deficit':
      return <SleepDeficitCard payload={topic.payload} coach_note={topic.coach_note} />;
    case 'watch_list':
      return <WatchListCard payload={topic.payload} />;
    case 'fun_fact':
      return <FunFactCard payload={topic.payload} />;
    case 'niggle':
      return <NiggleCard payload={topic.payload} coach_note={topic.coach_note} />;
    case 'load_ramp':
      return <LoadRampCard payload={topic.payload} coach_note={topic.coach_note} />;
    case 'weekly_volume':
      return <WeeklyVolumeCard payload={topic.payload} coach_note={topic.coach_note} />;
    case 'long_run_horizon':
      return <LongRunHorizonCard payload={topic.payload} coach_note={topic.coach_note} />;
    default:
      // Forward-compat: never crash on an unknown kind. Log + skip.
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('Unknown topic kind:', (topic as any).kind);
      }
      return null;
  }
}
