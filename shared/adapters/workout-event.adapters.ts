import type {
  CardioWorkoutEventEntry,
  CardioWorkoutRoute,
  CardioWorkoutRouteBounds,
  CardioWorkoutRoutePoint,
  OtherWorkoutEventEntry,
  StrengthWorkoutEventEntry,
  WorkoutDistanceMeasurement,
  WorkoutDurationMeasurement,
  WorkoutEvent,
  WorkoutEventEntry,
  WorkoutEventSource,
  WorkoutEventSummary,
} from '../models/workout-event.model';
import {
  WORKOUT_EVENT_RECORD_SCHEMA_VERSION,
  type WorkoutEventRecord,
} from '../models/workout-event-record.model';

export interface LegacyWorkoutSessionLike {
  date?: unknown;
  trainingRows?: unknown;
  strengthTrainingRow?: unknown;
  strengthTrainingRowss?: unknown;
  cardioTrainingRow?: unknown;
  otherTrainingRow?: unknown;
  estimated_calories?: unknown;
  estimatedCalories?: unknown;
  calories?: unknown;
  trainer_notes?: unknown;
  trainerNotes?: unknown;
  notes?: unknown;
  isComplete?: unknown;
  sessionType?: unknown;
  source?: unknown;
  volume?: unknown;
  exercises?: unknown;
  [key: string]: unknown;
}

interface NormalizeWorkoutEventOptions {
  defaultDate?: string;
  source?: WorkoutEventSource;
  trainerNotes?: string;
  isComplete?: boolean;
}

interface MergeWorkoutEventsOptions {
  date?: string;
  trainerNotes?: string;
  isComplete?: boolean;
  source?: WorkoutEventSource;
}

const BODYWEIGHT_DISPLAY = 'bodyweight';

export function createEmptyWorkoutEvent(
  date = currentDateKey(),
  source?: WorkoutEventSource
): WorkoutEvent {
  return {
    date,
    entries: [],
    summary: {
      estimatedCalories: 0,
      trainerNotes: '',
      isComplete: false,
    },
    ...(source ? { source } : {}),
  };
}

export function normalizeWorkoutEventCandidate(
  candidate: unknown,
  options: NormalizeWorkoutEventOptions = {}
): WorkoutEvent {
  if (!candidate || typeof candidate !== 'object') {
    return applyWorkoutEventDefaults(createEmptyWorkoutEvent(options.defaultDate), options);
  }

  const record = candidate as Record<string, unknown>;
  const eventCandidate = record['event'];
  if (eventCandidate && typeof eventCandidate === 'object' && !Array.isArray(eventCandidate)) {
    return normalizeWorkoutEventCandidate(eventCandidate, options);
  }

  if (Array.isArray(record['entries']) || isObject(record['summary'])) {
    return applyWorkoutEventDefaults(parseCanonicalWorkoutEvent(record), options);
  }

  return applyWorkoutEventDefaults(
    legacyWorkoutSessionToWorkoutEvent(record as LegacyWorkoutSessionLike),
    options
  );
}

export function legacyWorkoutSessionToWorkoutEvent(
  session: LegacyWorkoutSessionLike | null | undefined
): WorkoutEvent {
  const source = (session ?? {}) as Record<string, unknown>;
  const fallbackTrainingRows = toObjectArray(source['trainingRows']);

  const strengthRows = toObjectArray(
    source['strengthTrainingRow'] ??
      source['strengthTrainingRowss'] ??
      fallbackTrainingRows.filter((row) => readText(row['Training_Type']).toLowerCase() === 'strength')
  );
  const cardioRows = toObjectArray(
    source['cardioTrainingRow'] ??
      fallbackTrainingRows.filter((row) => readText(row['Training_Type']).toLowerCase() === 'cardio')
  );
  const otherRows = toObjectArray(
    source['otherTrainingRow'] ??
      fallbackTrainingRows.filter((row) => readText(row['Training_Type']).toLowerCase() === 'other')
  );

  const entries: WorkoutEventEntry[] = [
    ...strengthRows.map((row) => strengthRowToEntry(row)),
    ...cardioRows.map((row) => cardioRowToEntry(row)),
    ...otherRows.map((row) => otherRowToEntry(row)),
  ];

  const summary: WorkoutEventSummary = {
    estimatedCalories: toNonNegativeNumber(
      source['estimated_calories'] ?? source['estimatedCalories'] ?? source['calories'],
      entries.reduce((total, entry) => total + entry.estimatedCalories, 0)
    ),
    trainerNotes: readText(
      source['trainer_notes'] ?? source['trainerNotes'] ?? source['notes']
    ),
    isComplete: Boolean(source['isComplete']),
  };

  const event = createEmptyWorkoutEvent(readText(source['date']) || currentDateKey());
  event.entries = entries;
  event.summary = summary;

  const sourceHint = normalizeWorkoutEventSource(source['source'] ?? source['sessionType']);
  if (sourceHint) {
    event.source = sourceHint;
  }

  return event;
}

export function workoutEventToLegacyWorkoutSession(
  event: WorkoutEvent
): LegacyWorkoutSessionLike {
  const normalizedEvent = normalizeWorkoutEventCandidate(event);
  const strengthRows = normalizedEvent.entries
    .filter((entry): entry is StrengthWorkoutEventEntry => entry.kind === 'strength')
    .map((entry) => ({
      Training_Type: 'Strength' as const,
      estimated_calories: roundNonNegative(entry.estimatedCalories),
      exercise_type: entry.exerciseType,
      sets: roundNonNegative(entry.sets),
      reps: roundNonNegative(entry.reps),
      displayed_weights_metric: normalizeDisplayWeight(entry.load.displayText),
      weights_kg: roundToTwo(entry.load.weightKg),
      weights: entry.load.weightKg > 0 ? roundToTwo(entry.load.weightKg) : 'body weight' as const,
    }));
  const cardioRows = normalizedEvent.entries
    .filter((entry): entry is CardioWorkoutEventEntry => entry.kind === 'cardio')
    .map((entry) => ({
      Training_Type: 'Cardio' as const,
      estimated_calories: roundNonNegative(entry.estimatedCalories),
      cardio_type: entry.cardioType,
      exercise_type: entry.cardioType,
      display_distance: entry.distance?.displayText ?? '',
      distance_meters: entry.distance?.meters,
      distance: entry.distance?.meters,
      display_time: entry.duration?.displayText ?? '',
      time_minutes: entry.duration?.minutes,
      time: entry.duration?.minutes,
      activity_source: entry.activitySource,
      started_at: entry.startedAt,
      ended_at: entry.endedAt,
      average_pace_minutes_per_km: entry.averagePaceMinutesPerKm,
      average_pace_minutes_per_mile: entry.averagePaceMinutesPerMile,
      route_points: entry.route?.points.map((point) => ({
        lat: point.lat,
        lng: point.lng,
        recorded_at: point.recordedAt,
        accuracy_meters: point.accuracyMeters,
      })),
      route_bounds: entry.route?.bounds,
    }));
  const otherRows = normalizedEvent.entries
    .filter((entry): entry is OtherWorkoutEventEntry => entry.kind === 'other')
    .map((entry) => ({
      ...(isObject(entry.details) ? entry.details : {}),
      Training_Type: 'Other' as const,
      estimated_calories: roundNonNegative(entry.estimatedCalories),
      exercise_type: entry.activityType,
    }));
  const trainingRows = normalizedEvent.entries.map((entry) => eventEntryToLegacyTrainingRow(entry));
  const totalVolume = strengthRows.reduce((total, row) => (
    total + roundNonNegative(row.sets) * roundNonNegative(row.reps) * toNonNegativeNumber(row.weights_kg)
  ), 0);
  const estimatedCalories = roundNonNegative(normalizedEvent.summary.estimatedCalories);

  return {
    date: normalizedEvent.date,
    trainingRows,
    strengthTrainingRow: strengthRows,
    strengthTrainingRowss: strengthRows,
    cardioTrainingRow: cardioRows,
    otherTrainingRow: otherRows,
    estimated_calories: estimatedCalories,
    estimatedCalories,
    calories: estimatedCalories,
    trainer_notes: normalizedEvent.summary.trainerNotes,
    trainerNotes: normalizedEvent.summary.trainerNotes,
    notes: normalizedEvent.summary.trainerNotes,
    isComplete: normalizedEvent.summary.isComplete,
    sessionType: normalizedEvent.source ?? '',
    volume: roundToTwo(totalVolume),
    exercises: trainingRows.map((row) => ({
      name: fromSnakeCase(row.exercise_type),
      metric: `${roundNonNegative(row.sets)} x ${roundNonNegative(row.reps)} @ ${normalizeDisplayWeight(
        readText(row.displayed_weights_metric) || (typeof row.weights === 'string' ? row.weights : '')
      )}`,
      volume: typeof row.weights_kg === 'number'
        ? roundToTwo(roundNonNegative(row.sets) * roundNonNegative(row.reps) * row.weights_kg)
        : 0,
    })),
  };
}

export function applyTrainerNotesToWorkoutEvent(
  event: WorkoutEvent,
  trainerNotes: string,
  isComplete = true
): WorkoutEvent {
  const normalizedEvent = normalizeWorkoutEventCandidate(event);
  return {
    ...normalizedEvent,
    summary: {
      ...normalizedEvent.summary,
      trainerNotes: readText(trainerNotes),
      isComplete,
    },
  };
}

export function mergeWorkoutEvents(
  events: Array<WorkoutEvent | null | undefined>,
  options: MergeWorkoutEventsOptions = {}
): WorkoutEvent {
  const normalizedEvents = events
    .map((event) => normalizeWorkoutEventCandidate(event))
    .filter((event) => event.entries.length > 0);

  if (normalizedEvents.length === 0) {
    return applyWorkoutEventDefaults(createEmptyWorkoutEvent(options.date), {
      defaultDate: options.date,
      trainerNotes: options.trainerNotes,
      isComplete: options.isComplete,
      source: options.source,
    });
  }

  const mergedEvent: WorkoutEvent = {
    date: options.date || normalizedEvents[0].date,
    entries: normalizedEvents.reduce<WorkoutEventEntry[]>(
      (entries, event) => entries.concat(event.entries),
      []
    ),
    summary: {
      estimatedCalories: normalizedEvents.reduce(
        (total, event) => total + toNonNegativeNumber(event.summary.estimatedCalories),
        0
      ),
      trainerNotes: options.trainerNotes ?? uniqueNotes(
        normalizedEvents.map((event) => event.summary.trainerNotes)
      ).join('\n\n'),
      isComplete: typeof options.isComplete === 'boolean'
        ? options.isComplete
        : normalizedEvents.every((event) => event.summary.isComplete),
    },
  };

  const source = options.source ?? normalizedEvents.map((event) => event.source).find(Boolean);
  if (source) {
    mergedEvent.source = source;
  }

  return mergedEvent;
}

export function workoutEventToRecord(event: WorkoutEvent): WorkoutEventRecord {
  return {
    schemaVersion: WORKOUT_EVENT_RECORD_SCHEMA_VERSION,
    event: normalizeWorkoutEventCandidate(event),
  };
}

export function workoutEventRecordToWorkoutEvent(record: unknown): WorkoutEvent {
  return normalizeWorkoutEventCandidate(record);
}

function applyWorkoutEventDefaults(
  event: WorkoutEvent,
  options: NormalizeWorkoutEventOptions
): WorkoutEvent {
  const defaultedEvent = {
    ...event,
    date: event.date || options.defaultDate || currentDateKey(),
    summary: {
      estimatedCalories: toNonNegativeNumber(event.summary?.estimatedCalories),
      trainerNotes: readText(event.summary?.trainerNotes ?? options.trainerNotes),
      isComplete: typeof options.isComplete === 'boolean'
        ? options.isComplete
        : Boolean(event.summary?.isComplete),
    },
  };

  const source = normalizeWorkoutEventSource(options.source ?? defaultedEvent.source);
  if (source) {
    defaultedEvent.source = source;
  } else {
    delete defaultedEvent.source;
  }

  return defaultedEvent;
}

function parseCanonicalWorkoutEvent(candidate: Record<string, unknown>): WorkoutEvent {
  const entriesCandidate = Array.isArray(candidate['entries']) ? candidate['entries'] : [];
  const summaryCandidate = isObject(candidate['summary'])
    ? candidate['summary'] as Record<string, unknown>
    : {};

  return {
    date: readText(candidate['date']) || currentDateKey(),
    entries: entriesCandidate
      .filter((entry): entry is Record<string, unknown> => isObject(entry))
      .map((entry) => normalizeWorkoutEventEntry(entry)),
    summary: {
      estimatedCalories: toNonNegativeNumber(summaryCandidate['estimatedCalories']),
      trainerNotes: readText(summaryCandidate['trainerNotes']),
      isComplete: Boolean(summaryCandidate['isComplete']),
    },
    ...(normalizeWorkoutEventSource(candidate['source'])
      ? { source: normalizeWorkoutEventSource(candidate['source']) as WorkoutEventSource }
      : {}),
  };
}

function normalizeWorkoutEventEntry(candidate: Record<string, unknown>): WorkoutEventEntry {
  const kind = readText(candidate['kind']).toLowerCase();
  if (kind === 'strength') {
    return {
      kind: 'strength',
      exerciseType: readText(candidate['exerciseType']) || 'strength_exercise',
      sets: roundNonNegative(candidate['sets']),
      reps: roundNonNegative(candidate['reps']),
      estimatedCalories: toNonNegativeNumber(candidate['estimatedCalories']),
      load: normalizeStrengthLoad(candidate['load']),
    };
  }

  if (kind === 'cardio') {
    return {
      kind: 'cardio',
      cardioType: readText(candidate['cardioType']) || 'cardio_activity',
      estimatedCalories: toNonNegativeNumber(candidate['estimatedCalories']),
      ...(normalizeDistanceMeasurement(candidate['distance'])
        ? { distance: normalizeDistanceMeasurement(candidate['distance']) as WorkoutDistanceMeasurement }
        : {}),
      ...(normalizeDurationMeasurement(candidate['duration'])
        ? { duration: normalizeDurationMeasurement(candidate['duration']) as WorkoutDurationMeasurement }
        : {}),
      ...(readText(candidate['activitySource']) ? { activitySource: readText(candidate['activitySource']) } : {}),
      ...(readText(candidate['startedAt']) ? { startedAt: readText(candidate['startedAt']) } : {}),
      ...(readText(candidate['endedAt']) ? { endedAt: readText(candidate['endedAt']) } : {}),
      ...(toOptionalPositiveNumber(candidate['averagePaceMinutesPerKm']) !== undefined
        ? { averagePaceMinutesPerKm: toOptionalPositiveNumber(candidate['averagePaceMinutesPerKm']) }
        : {}),
      ...(toOptionalPositiveNumber(candidate['averagePaceMinutesPerMile']) !== undefined
        ? { averagePaceMinutesPerMile: toOptionalPositiveNumber(candidate['averagePaceMinutesPerMile']) }
        : {}),
      ...(normalizeRoute(candidate['route'])
        ? { route: normalizeRoute(candidate['route']) as CardioWorkoutRoute }
        : {}),
    };
  }

  return {
    kind: 'other',
    activityType: readText(candidate['activityType']) || 'other_activity',
    estimatedCalories: toNonNegativeNumber(candidate['estimatedCalories']),
    ...(isObject(candidate['details'])
      ? { details: { ...(candidate['details'] as Record<string, unknown>) } }
      : {}),
  };
}

function strengthRowToEntry(row: Record<string, unknown>): StrengthWorkoutEventEntry {
  const displayText = resolveStrengthLoadDisplayText(row);
  return {
    kind: 'strength',
    exerciseType: readText(row['exercise_type'] ?? row['exercise']) || 'strength_exercise',
    sets: roundNonNegative(row['sets']),
    reps: roundNonNegative(row['reps']),
    estimatedCalories: toNonNegativeNumber(row['estimated_calories'] ?? row['estimatedCalories']),
    load: {
      displayText,
      weightKg: resolveStrengthExternalLoadKg(row, displayText),
    },
  };
}

function cardioRowToEntry(row: Record<string, unknown>): CardioWorkoutEventEntry {
  const distance = createDistanceMeasurement(
    row['display_distance'] ?? row['distance_input'] ?? row['distanceText'] ?? row['distance_text'],
    row['distance_meters'] ?? row['distance'] ?? row['meters']
  );
  const duration = createDurationMeasurement(
    row['display_time'] ?? row['time_input'] ?? row['timeText'] ?? row['time_text'],
    row['time_minutes'] ?? row['time'] ?? row['minutes'] ?? row['duration'] ?? row['reps']
  );
  const routePoints = normalizeRoutePoints(row['route_points'] ?? row['routePoints']);
  const routeBounds = normalizeRouteBounds(row['route_bounds'] ?? row['routeBounds']);

  return {
    kind: 'cardio',
    cardioType: readText(row['cardio_type'] ?? row['exercise_type'] ?? row['type']) || 'cardio_activity',
    estimatedCalories: toNonNegativeNumber(row['estimated_calories'] ?? row['estimatedCalories']),
    ...(distance ? { distance } : {}),
    ...(duration ? { duration } : {}),
    ...(readText(row['activity_source'] ?? row['activitySource'])
      ? { activitySource: readText(row['activity_source'] ?? row['activitySource']) }
      : {}),
    ...(readText(row['started_at'] ?? row['startedAt'])
      ? { startedAt: readText(row['started_at'] ?? row['startedAt']) }
      : {}),
    ...(readText(row['ended_at'] ?? row['endedAt'])
      ? { endedAt: readText(row['ended_at'] ?? row['endedAt']) }
      : {}),
    ...(toOptionalPositiveNumber(row['average_pace_minutes_per_km'] ?? row['averagePaceMinutesPerKm']) !== undefined
      ? { averagePaceMinutesPerKm: toOptionalPositiveNumber(
        row['average_pace_minutes_per_km'] ?? row['averagePaceMinutesPerKm']
      ) }
      : {}),
    ...(toOptionalPositiveNumber(row['average_pace_minutes_per_mile'] ?? row['averagePaceMinutesPerMile']) !== undefined
      ? { averagePaceMinutesPerMile: toOptionalPositiveNumber(
        row['average_pace_minutes_per_mile'] ?? row['averagePaceMinutesPerMile']
      ) }
      : {}),
    ...((routePoints.length > 0 || routeBounds)
      ? {
        route: {
          points: routePoints,
          ...(routeBounds ? { bounds: routeBounds } : {}),
        },
      }
      : {}),
  };
}

function otherRowToEntry(row: Record<string, unknown>): OtherWorkoutEventEntry {
  const details = stripKeys(row, [
    'Training_Type',
    'estimated_calories',
    'estimatedCalories',
    'exercise_type',
    'activity',
    'name',
    'type',
  ]);

  return {
    kind: 'other',
    activityType: readText(
      row['exercise_type'] ?? row['activity'] ?? row['name'] ?? row['type']
    ) || 'other_activity',
    estimatedCalories: toNonNegativeNumber(row['estimated_calories'] ?? row['estimatedCalories']),
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}

function eventEntryToLegacyTrainingRow(entry: WorkoutEventEntry): {
  Training_Type: 'Strength' | 'Cardio' | 'Other';
  estimated_calories: number;
  exercise_type: string;
  sets: number;
  reps: number;
  displayed_weights_metric?: string;
  weights_kg?: number;
  weights?: number | 'body weight';
} {
  if (entry.kind === 'strength') {
    return {
      Training_Type: 'Strength',
      estimated_calories: roundNonNegative(entry.estimatedCalories),
      exercise_type: entry.exerciseType,
      sets: roundNonNegative(entry.sets),
      reps: roundNonNegative(entry.reps),
      displayed_weights_metric: normalizeDisplayWeight(entry.load.displayText),
      weights_kg: roundToTwo(entry.load.weightKg),
      weights: entry.load.weightKg > 0 ? roundToTwo(entry.load.weightKg) : 'body weight',
    };
  }

  if (entry.kind === 'cardio') {
    return {
      Training_Type: 'Cardio',
      estimated_calories: roundNonNegative(entry.estimatedCalories),
      exercise_type: entry.cardioType,
      sets: 1,
      reps: roundNonNegative(entry.duration?.minutes ?? entry.distance?.meters),
      displayed_weights_metric: BODYWEIGHT_DISPLAY,
      weights_kg: 0,
      weights: 'body weight',
    };
  }

  const details = isObject(entry.details) ? entry.details : {};
  return {
    Training_Type: 'Other',
    estimated_calories: roundNonNegative(entry.estimatedCalories),
    exercise_type: entry.activityType,
    sets: roundNonNegative(details['sets'], 1),
    reps: roundNonNegative(details['reps'] ?? details['time'], 1),
    displayed_weights_metric: readText(
      details['displayed_weights_metric'] ?? details['weights'] ?? details['weight']
    ) || BODYWEIGHT_DISPLAY,
    weights: 'body weight',
  };
}

function normalizeStrengthLoad(candidate: unknown): StrengthWorkoutEventEntry['load'] {
  if (!isObject(candidate)) {
    return {
      displayText: BODYWEIGHT_DISPLAY,
      weightKg: 0,
    };
  }

  const record = candidate as Record<string, unknown>;
  const displayText = normalizeDisplayWeight(readText(record['displayText']) || BODYWEIGHT_DISPLAY);
  return {
    displayText,
    weightKg: toNonNegativeNumber(record['weightKg']),
  };
}

function resolveStrengthLoadDisplayText(row: Record<string, unknown>): string {
  const explicitDisplay = readText(
    row['displayed_weights_metric'] ??
      row['displayWeight'] ??
      row['weights'] ??
      row['weight'] ??
      row['load']
  );
  if (!explicitDisplay) {
    return BODYWEIGHT_DISPLAY;
  }

  return normalizeDisplayWeight(explicitDisplay);
}

function resolveStrengthExternalLoadKg(row: Record<string, unknown>, displayText: string): number {
  const explicitKg = toOptionalPositiveNumber(
    row['weights_kg'] ?? row['weight_kg']
  );
  if (explicitKg !== undefined) {
    return explicitKg;
  }

  if (displayText.toLowerCase().includes('body')) {
    return 0;
  }

  const text = readText(
    row['displayed_weights_metric'] ??
      row['weights'] ??
      row['weight'] ??
      row['load']
  );
  return parseWeightKg(text);
}

function normalizeDisplayWeight(value: string): string {
  const text = readText(value);
  if (!text || text.toLowerCase().includes('body')) {
    return BODYWEIGHT_DISPLAY;
  }
  return text;
}

function createDistanceMeasurement(
  displayValue: unknown,
  metersValue: unknown
): WorkoutDistanceMeasurement | undefined {
  const displayText = readText(displayValue);
  const meters = toOptionalPositiveNumber(metersValue);
  if (!displayText && meters === undefined) {
    return undefined;
  }

  return {
    ...(displayText ? { displayText } : {}),
    ...(meters !== undefined ? { meters } : {}),
  };
}

function createDurationMeasurement(
  displayValue: unknown,
  minutesValue: unknown
): WorkoutDurationMeasurement | undefined {
  const displayText = readText(displayValue);
  const minutes = toOptionalPositiveNumber(minutesValue);
  if (!displayText && minutes === undefined) {
    return undefined;
  }

  return {
    ...(displayText ? { displayText } : {}),
    ...(minutes !== undefined ? { minutes } : {}),
  };
}

function normalizeDistanceMeasurement(value: unknown): WorkoutDistanceMeasurement | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  return createDistanceMeasurement(
    (value as Record<string, unknown>)['displayText'],
    (value as Record<string, unknown>)['meters']
  );
}

function normalizeDurationMeasurement(value: unknown): WorkoutDurationMeasurement | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  return createDurationMeasurement(
    (value as Record<string, unknown>)['displayText'],
    (value as Record<string, unknown>)['minutes']
  );
}

function normalizeRoute(value: unknown): CardioWorkoutRoute | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const points = normalizeRoutePoints(record['points']);
  const bounds = normalizeRouteBounds(record['bounds']);
  if (points.length === 0 && !bounds) {
    return undefined;
  }

  return {
    points,
    ...(bounds ? { bounds } : {}),
  };
}

function normalizeRoutePoints(value: unknown): CardioWorkoutRoutePoint[] {
  return toObjectArray(value)
    .map((point): CardioWorkoutRoutePoint | null => {
      const lat = Number(point['lat']);
      const lng = Number(point['lng']);
      const recordedAt = readText(point['recordedAt'] ?? point['recorded_at']);
      const accuracyMeters = toOptionalPositiveNumber(
        point['accuracyMeters'] ?? point['accuracy_meters']
      );

      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !recordedAt) {
        return null;
      }

      return {
        lat,
        lng,
        recordedAt,
        ...(accuracyMeters !== undefined ? { accuracyMeters } : {}),
      };
    })
    .filter((point): point is CardioWorkoutRoutePoint => !!point);
}

function normalizeRouteBounds(value: unknown): CardioWorkoutRouteBounds | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const bounds = value as Record<string, unknown>;
  const north = Number(bounds['north']);
  const south = Number(bounds['south']);
  const east = Number(bounds['east']);
  const west = Number(bounds['west']);
  if (
    !Number.isFinite(north) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(west)
  ) {
    return undefined;
  }

  return { north, south, east, west };
}

function normalizeWorkoutEventSource(value: unknown): WorkoutEventSource | undefined {
  const text = readText(value).toLowerCase();
  if (!text) {
    return undefined;
  }

  if (text === 'chat') {
    return 'chat';
  }
  if (text === 'treadmill_logger' || text === 'treadmill') {
    return 'treadmill_logger';
  }
  if (text === 'map_tracking' || text === 'map') {
    return 'map_tracking';
  }
  if (text === 'manual') {
    return 'manual';
  }
  if (text === 'imported' || text === 'import') {
    return 'imported';
  }

  return undefined;
}

function uniqueNotes(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => readText(value)).filter(Boolean)));
}

function stripKeys(
  value: Record<string, unknown>,
  keysToStrip: string[]
): Record<string, unknown> {
  return Object.entries(value).reduce<Record<string, unknown>>((result, [key, entry]) => {
    if (!keysToStrip.includes(key)) {
      result[key] = entry;
    }
    return result;
  }, {});
}

function fromSnakeCase(value: string): string {
  return readText(value)
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function parseWeightKg(value: unknown): number {
  const direct = toOptionalPositiveNumber(value);
  if (direct !== undefined) {
    return direct;
  }

  const text = readText(value).toLowerCase();
  if (!text || text.includes('body')) {
    return 0;
  }

  const match = text.match(
    /([0-9]*\.?[0-9]+)\s*(kg|kgs|kilogram|kilograms|lb|lbs|pound|pounds)?\b/
  );
  if (!match) {
    return 0;
  }

  const amount = Number(match[1] ?? 0);
  const unit = String(match[2] ?? 'kg').toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  if (unit === 'lb' || unit === 'lbs' || unit === 'pound' || unit === 'pounds') {
    return roundToTwo(amount * 0.45359237);
  }

  return roundToTwo(amount);
}

function currentDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function roundToTwo(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.round(parsed * 100) / 100;
}

function roundNonNegative(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Math.max(0, Math.round(fallback));
  }
  return Math.round(parsed);
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Math.max(0, Number(fallback) || 0);
  }
  return parsed;
}

function toOptionalPositiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => isObject(entry));
  }

  if (isObject(value)) {
    return [value as Record<string, unknown>];
  }

  return [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
