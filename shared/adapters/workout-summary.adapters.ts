import {
  createEmptyWorkoutEvent,
  mergeWorkoutEvents,
  normalizeWorkoutEventCandidate,
  workoutEventToLegacyWorkoutSession,
} from './workout-event.adapters';
import type { LegacyWorkoutSessionLike } from './workout-event.adapters';
import type { WorkoutEvent } from '../models/workout-event.model';
import type { WorkoutSummary } from '../models/workout-summary.model';

export interface WorkoutSummaryEventInput {
  workoutEventId?: string;
  event: WorkoutEvent | null | undefined;
  createdAt?: Date | string | null | undefined;
}

interface NormalizeWorkoutSummaryOptions {
  defaultDate?: string;
}

export function createEmptyWorkoutSummary(date = currentDateKey()): WorkoutSummary {
  return {
    date,
    workoutEventIds: [],
    eventCount: 0,
    aggregate: createEmptyWorkoutEvent(date),
  };
}

export function normalizeWorkoutSummaryCandidate(
  candidate: unknown,
  options: NormalizeWorkoutSummaryOptions = {}
): WorkoutSummary {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return createEmptyWorkoutSummary(options.defaultDate || currentDateKey());
  }

  const record = candidate as Record<string, unknown>;
  const aggregate = normalizeWorkoutEventCandidate(record['aggregate'], {
    defaultDate: readText(record['date']) || options.defaultDate,
  });
  const date = readText(record['date']) || aggregate.date || options.defaultDate || currentDateKey();
  const workoutEventIds = normalizeStringArray(record['workoutEventIds']);
  const firstEventCreatedAt = toIsoString(record['firstEventCreatedAt']);
  const lastEventCreatedAt = toIsoString(record['lastEventCreatedAt']);

  return {
    date,
    workoutEventIds,
    eventCount: toNonNegativeInteger(record['eventCount'], workoutEventIds.length),
    aggregate: {
      ...aggregate,
      date,
    },
    ...(firstEventCreatedAt ? { firstEventCreatedAt } : {}),
    ...(lastEventCreatedAt ? { lastEventCreatedAt } : {}),
  };
}

export function createWorkoutSummaryFromEvents(
  events: Array<WorkoutSummaryEventInput | null | undefined>,
  options: NormalizeWorkoutSummaryOptions = {}
): WorkoutSummary {
  const normalizedEvents = events
    .filter((entry): entry is WorkoutSummaryEventInput => !!entry && typeof entry === 'object')
    .map((entry) => ({
      workoutEventId: readText(entry.workoutEventId),
      event: normalizeWorkoutEventCandidate(entry.event, {
        defaultDate: options.defaultDate,
      }),
      createdAt: toIsoString(entry.createdAt),
    }))
    .filter((entry) => entry.event.entries.length > 0);

  if (normalizedEvents.length === 0) {
    return createEmptyWorkoutSummary(options.defaultDate || currentDateKey());
  }

  normalizedEvents.sort((left, right) => (
    (left.createdAt || '').localeCompare(right.createdAt || '')
  ));

  const date = options.defaultDate || normalizedEvents[0].event.date;
  const aggregate = mergeWorkoutEvents(
    normalizedEvents.map((entry) => entry.event),
    {
      date,
      isComplete: true,
    }
  );

  return {
    date,
    workoutEventIds: normalizedEvents
      .map((entry) => entry.workoutEventId)
      .filter((value) => value.length > 0),
    eventCount: normalizedEvents.length,
    aggregate: {
      ...aggregate,
      date,
    },
    ...(normalizedEvents[0].createdAt ? { firstEventCreatedAt: normalizedEvents[0].createdAt } : {}),
    ...(normalizedEvents[normalizedEvents.length - 1].createdAt
      ? { lastEventCreatedAt: normalizedEvents[normalizedEvents.length - 1].createdAt }
      : {}),
  };
}

export function workoutSummaryToLegacyWorkoutSession(
  workoutSummary: WorkoutSummary
): LegacyWorkoutSessionLike {
  return workoutEventToLegacyWorkoutSession(
    normalizeWorkoutSummaryCandidate(workoutSummary).aggregate
  );
}

function readText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim()
    : String(value ?? '').trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.map((entry) => readText(entry)).filter(Boolean)));
}

function toIsoString(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  const text = readText((value as { toDate?: () => Date } | null | undefined)?.toDate?.() ?? value);
  if (!text) {
    return undefined;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function currentDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}
