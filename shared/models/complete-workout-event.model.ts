import type { WorkoutEvent } from './workout-event.model';
import type { WorkoutEventRecordSubmissionMetadata } from './workout-event-record.model';

export const COMPLETE_WORKOUT_EVENT_STATUS_PERSISTED = 'persisted' as const;

export interface CompleteWorkoutEventRequest {
  event: WorkoutEvent;
  submissionMetadata?: WorkoutEventRecordSubmissionMetadata;
}

export interface CompleteWorkoutEventResponse {
  eventId: string;
  status: typeof COMPLETE_WORKOUT_EVENT_STATUS_PERSISTED;
}
