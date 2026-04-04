# WorkoutEvent Model

`WorkoutEvent` is now the authoritative workout domain contract for this repo.

TypeScript source of truth:

- `shared/models/workout-event.model.ts`

## Design goals

- Keep the domain contract focused on workout facts only.
- Separate the workout domain model from UI storage shapes and page-specific convenience fields.
- Keep booking/calendar, chat transcript, trainer-report, and leaderboard concerns out of the workout event contract.
- Provide one canonical workout shape that adapters can map to and from.

## Authoritative shape

```ts
interface WorkoutEvent {
  date: string;
  entries: WorkoutEventEntry[];
  summary: WorkoutEventSummary;
  source?: 'chat' | 'treadmill_logger' | 'map_tracking' | 'manual' | 'imported';
}

interface WorkoutEventSummary {
  estimatedCalories: number;
  trainerNotes: string;
  isComplete: boolean;
}

type WorkoutEventEntry =
  | StrengthWorkoutEventEntry
  | CardioWorkoutEventEntry
  | OtherWorkoutEventEntry;
```

The specialized entry contracts live in `shared/models/workout-event.model.ts`.

## What belongs in WorkoutEvent

- Local workout date
- Canonical workout entries
- Session-level estimated calories
- Trainer notes
- Completion state
- Optional workout submission source

## What does not belong in WorkoutEvent

- Booking ids, trainer/client scheduling data, and calendar slot state
- Chat request history, assistant messages, or prompt/response transport fields
- Trainer summary message formatting or report-only projections
- Leaderboard totals, score aggregates, streaks, or badge counters
- Firestore collection paths, document ids, timestamps used only for storage mechanics

## Current legacy shapes and intended mapping

### `src/app/models/workout-session.model.ts`

This remains a legacy UI/storage adapter shape.

- `date` -> `WorkoutEvent.date`
- `trainer_notes` / `notes` -> `WorkoutEvent.summary.trainerNotes`
- `estimated_calories` / `calories` -> `WorkoutEvent.summary.estimatedCalories`
- `isComplete` -> `WorkoutEvent.summary.isComplete`
- `strengthTrainingRow`, `cardioTrainingRow`, `otherTrainingRow`, `trainingRows` -> `WorkoutEvent.entries`
- `sessionType` -> optional `WorkoutEvent.source` when it truly describes ingestion source
- `volume`, `exercises`, duplicated calorie fields -> derived projections, not canonical domain fields

### `functions/src/index.ts` workout chat/treadmill summary payloads

These are also adapter shapes, not the canonical model.

- Returned row collections should map into `WorkoutEvent.entries`
- Returned `estimated_calories`, `trainer_notes`, and `isComplete` map into `WorkoutEvent.summary`
- The Cloud Function now normalizes them by round-tripping through the shared workout-event adapters instead of owning a duplicate schema normalizer.

## Migration intent

- `WorkoutEvent` is the domain contract.
- Existing workout session payloads should become adapters around it.
- The formatter/normalizer should translate legacy payloads, not define the schema.
- The canonical frontend persistence path is `users/{uid}/workoutEvents/{eventId}`.
- The workout history page now reads canonical `workoutEvents` directly.
- The legacy `workoutSessions/{sessionId}` trigger path has been retired.
- Per-day `users/{uid}/workoutLogs/{date}` docs remain temporary derived projections for any remaining legacy consumers.
- Trainer summaries and score/streak docs remain downstream outputs derived from `WorkoutEvent`, not canonical workout storage.
