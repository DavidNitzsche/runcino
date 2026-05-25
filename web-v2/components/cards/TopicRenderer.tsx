import type { Topic } from '@/lib/topics/types';
import { RunRecapCard } from './RunRecapCard';
import {
  NextWorkoutCard, RaceHorizonCard, ProfileGapCard,
  SleepDeficitCard, WatchListCard, FunFactCard,
} from './SimpleCards';

/**
 * Polymorphic renderer — picks the right component per topic kind.
 * Topic kinds not in this switch are silently dropped (forward-compat).
 */
export function TopicRenderer({ topic }: { topic: Topic }) {
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
    default:
      // Forward-compat: never crash on an unknown kind. Log + skip.
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('Unknown topic kind:', (topic as any).kind);
      }
      return null;
  }
}
