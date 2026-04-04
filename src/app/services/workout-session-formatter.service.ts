import { Injectable } from '@angular/core';
import { ExerciseEstimatorsService } from './exercise-estimators.service';
import {
  applyTrainerNotesToWorkoutSessionPerformance,
  createEmptyWorkoutSessionPerformance,
  mergeWorkoutSessionPerformances,
  workoutEventToWorkoutSessionPerformance,
  workoutSessionPerformanceToWorkoutEvent,
} from '../adapters/workout-event.adapters';
import {
  CardioTrainingRow,
  OtherTrainingRow,
  SummaryExercise,
  TrainingType,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../models/workout-session.model';

interface NormalizeSessionOptions {
  latestUserMessage?: string;
  cardioTypeFallback?: string;
  defaultDate?: string;
  defaultTrainerNotes?: string;
  isComplete?: boolean;
  sessionType?: string;
}

interface MergeSessionsOptions {
  date?: string;
  trainerNotes?: string;
  isComplete?: boolean;
  sessionType?: string;
}

@Injectable({
  providedIn: 'root',
})
export class WorkoutSessionFormatterService {
  constructor(private exerciseEstimatorsService: ExerciseEstimatorsService) {}

  createEmptySession(date = new Date().toISOString().slice(0, 10)): WorkoutSessionPerformance {
    return createEmptyWorkoutSessionPerformance(date);
  }

  normalizeSession(
    candidate: Partial<WorkoutSessionPerformance> | Record<string, unknown> | null | undefined,
    options: NormalizeSessionOptions = {}
  ): WorkoutSessionPerformance {
    const session = candidate ?? {};
    const source = session as Record<string, unknown>;
    const estimatedCaloriesInput = this.toNonNegativeNumber(
      source['estimated_calories'] ?? source['calories'],
      0
    );
    const fallbackRows = this.normalizeRows(source['trainingRows'], undefined, options.latestUserMessage);
    const legacyCardioRows = this.extractLegacyCardioRowsFromTrainingRows(source['trainingRows']);

    const strengthRows = this.normalizeRows(
      this.hasOwnKey(source, 'strengthTrainingRow')
        ? source['strengthTrainingRow']
        : this.hasOwnKey(source, 'strengthTrainingRowss')
          ? source['strengthTrainingRowss']
          : fallbackRows.filter((row) => row.Training_Type === 'Strength'),
      'Strength',
      options.latestUserMessage
    );
    const cardioRows = this.normalizeCardioRows(
      this.hasOwnKey(source, 'cardioTrainingRow')
        ? source['cardioTrainingRow']
        : legacyCardioRows,
      options.latestUserMessage,
      options.cardioTypeFallback
    );
    const otherRows = this.normalizeOtherRows(
      this.hasOwnKey(source, 'otherTrainingRow')
        ? source['otherTrainingRow']
        : fallbackRows
            .filter((row) => row.Training_Type === 'Other')
            .map((row) => ({
              activity: row.exercise_type,
              sets: row.sets,
              reps: row.reps,
              displayed_weights_metric: row.displayed_weights_metric,
              weights_kg: row.weights_kg,
              estimated_calories: row.estimated_calories,
            }))
    );

    this.ensureEstimatedCaloriesAcrossRows(
      strengthRows,
      cardioRows,
      otherRows,
      estimatedCaloriesInput
    );

    const rows = [
      ...strengthRows,
      ...this.cardioRowsToTrainingRows(cardioRows),
      ...this.otherRowsToTrainingRows(otherRows),
    ];
    const derivedEstimatedCalories = [
      ...strengthRows.map((row) => this.toNonNegativeNumber(row.estimated_calories, 0)),
      ...cardioRows.map((row) => this.toNonNegativeNumber(row.estimated_calories, 0)),
      ...otherRows.map((row) => this.toNonNegativeNumber(row['estimated_calories'], 0)),
    ].reduce((total, value) => total + value, 0);
    const estimatedCalories = estimatedCaloriesInput > 0
      ? estimatedCaloriesInput
      : derivedEstimatedCalories;
    const trainingType = this.resolveSessionTrainingType(source, strengthRows, cardioRows, otherRows, rows);
    const trainerNotes = this.readText(
      source['trainer_notes'] ??
      source['notes']
    ) || this.readText(options.defaultTrainerNotes) || '';
    const date = this.readText(source['date']) || options.defaultDate || new Date().toISOString().slice(0, 10);
    const sessionType = this.readText(source['sessionType']) || this.readText(options.sessionType);

    const normalizedSession: WorkoutSessionPerformance = {
      date,
      trainingRows: rows,
      Training_Type: trainingType,
      strengthTrainingRow: strengthRows,
      strengthTrainingRowss: strengthRows,
      cardioTrainingRow: cardioRows,
      otherTrainingRow: otherRows,
      estimated_calories: estimatedCalories,
      trainer_notes: trainerNotes,
      isComplete: typeof options.isComplete === 'boolean'
        ? options.isComplete
        : !!source['isComplete'],
      sessionType,
      notes: trainerNotes,
      volume: this.calculateTotalVolume(rows),
      calories: estimatedCalories,
      exercises: this.rowsToLegacyExercises(rows),
    };

    const canonicalEvent = workoutSessionPerformanceToWorkoutEvent(normalizedSession);
    if (sessionType) {
      canonicalEvent.source = this.mapSessionTypeToWorkoutEventSource(sessionType);
    }

    return workoutEventToWorkoutSessionPerformance(canonicalEvent);
  }

  applyTrainerNotes(
    session: Partial<WorkoutSessionPerformance> | Record<string, unknown> | null | undefined,
    trainerNotes: string,
    isComplete = true
  ): WorkoutSessionPerformance {
    return applyTrainerNotesToWorkoutSessionPerformance(session, trainerNotes, isComplete);
  }

  mergeSessions(
    sessions: Array<Partial<WorkoutSessionPerformance> | Record<string, unknown> | null | undefined>,
    options: MergeSessionsOptions = {}
  ): WorkoutSessionPerformance {
    return mergeWorkoutSessionPerformances(sessions, {
      date: options.date,
      trainerNotes: options.trainerNotes,
      isComplete: options.isComplete,
      source: options.sessionType
        ? this.mapSessionTypeToWorkoutEventSource(options.sessionType)
        : undefined,
    });
  }

  private mapSessionTypeToWorkoutEventSource(
    sessionType: string
  ): 'chat' | 'treadmill_logger' | 'map_tracking' | 'manual' | 'imported' {
    const normalized = this.readText(sessionType).toLowerCase();
    if (normalized === 'treadmill' || normalized === 'treadmill_logger') {
      return 'treadmill_logger';
    }
    if (normalized === 'map' || normalized === 'map_tracking') {
      return 'map_tracking';
    }
    if (normalized === 'imported' || normalized === 'import') {
      return 'imported';
    }
    if (normalized === 'manual') {
      return 'manual';
    }
    return 'chat';
  }

  private normalizeRows(
    rowsCandidate: unknown,
    forcedType?: TrainingType,
    latestUserMessage?: string
  ): WorkoutTrainingRow[] {
    const rows = Array.isArray(rowsCandidate)
      ? rowsCandidate
      : rowsCandidate && typeof rowsCandidate === 'object'
        ? [rowsCandidate]
        : [];

    return rows
      .map((entry, index): WorkoutTrainingRow | null => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const row = entry as Record<string, unknown>;
        const trainingType = forcedType ??
          this.normalizeTrainingType(
            row['Training_Type'] ?? row['training_type'] ?? row['trainingType']
          );
        const rawType = typeof row['exercise_type'] === 'string'
          ? row['exercise_type']
          : typeof row['exersice_type'] === 'string'
            ? row['exersice_type']
            : '';
        const exerciseType = this.exerciseEstimatorsService.normalizeEstimatorId(rawType) ||
          'unknown_exercise';
        const sets = this.toInteger(row['sets'], 1);
        const reps = this.toInteger(row['reps'], 1);
        const rawWeight =
          row['displayed_weights_metric'] ??
          row['displayWeight'] ??
          row['weights'] ??
          row['weight'];
        const displayedWeightsMetric = this.resolveDisplayedWeightMetric(
          row,
          rawWeight,
          latestUserMessage,
          index
        );
        const weightsKg = this.resolveWeightKgValue(row, rawWeight);
        const estimatedRowCalories = this.toNonNegativeNumber(
          row['estimated_calories'] ?? row['estimatedCalories'],
          0
        );

        return {
          Training_Type: trainingType,
          estimated_calories: estimatedRowCalories,
          exercise_type: exerciseType,
          sets,
          reps,
          displayed_weights_metric: displayedWeightsMetric,
          weights_kg: weightsKg,
        };
      })
      .filter((row): row is WorkoutTrainingRow => !!row);
  }

  private normalizeCardioRows(
    rowsCandidate: unknown,
    latestUserMessage?: string,
    cardioTypeFallback?: string
  ): CardioTrainingRow[] {
    const rows = this.toObjectArray(rowsCandidate);
    const latestDistanceText = this.extractDistanceMetricText(latestUserMessage);
    const latestTimeText = this.extractTimeMetricText(latestUserMessage);

    return rows.map((row, index) => {
      const cardioTypeRaw =
        row['cardio_type'] ??
        row['cardioType'] ??
        row['exercise_type'] ??
        row['exersice_type'] ??
        row['type'];
      const cardioTypeText = typeof cardioTypeRaw === 'string' ? cardioTypeRaw : '';
      const normalizedCardioType =
        this.exerciseEstimatorsService.normalizeEstimatorId(cardioTypeText) ||
        this.exerciseEstimatorsService.normalizeEstimatorId(cardioTypeFallback ?? '') ||
        'cardio_activity';
      const distanceMeters = this.parseDistanceMeters(
        row['distance_meters'] ?? row['distance'] ?? row['meters']
      );
      const timeMinutes = this.parseTimeMinutes(
        row['time_minutes'] ?? row['time'] ?? row['minutes'] ?? row['duration']
      );
      const estimatedRowCalories = this.toNonNegativeNumber(
        row['estimated_calories'] ?? row['estimatedCalories'],
        0
      );
      const normalizedRow: CardioTrainingRow = {
        ...row,
        Training_Type: 'Cardio',
        estimated_calories: estimatedRowCalories,
        cardio_type: normalizedCardioType,
        exercise_type: normalizedCardioType,
      };
      const displayDistance = this.resolveDisplayDistanceText(row) ??
        (index === 0 ? latestDistanceText : undefined);
      const displayTime = this.resolveDisplayTimeText(row) ??
        (index === 0 ? latestTimeText : undefined);

      if (typeof distanceMeters === 'number') {
        normalizedRow.distance_meters = distanceMeters;
      } else {
        delete normalizedRow.distance_meters;
      }

      if (typeof timeMinutes === 'number') {
        normalizedRow.time_minutes = timeMinutes;
      } else {
        delete normalizedRow.time_minutes;
      }

      if (displayDistance) {
        normalizedRow.display_distance = displayDistance;
      } else {
        delete normalizedRow.display_distance;
      }

      if (displayTime) {
        normalizedRow.display_time = displayTime;
      } else {
        delete normalizedRow.display_time;
      }

      return normalizedRow;
    });
  }

  private normalizeOtherRows(rowsCandidate: unknown): OtherTrainingRow[] {
    return this.toObjectArray(rowsCandidate).map((row) => ({
      ...row,
      Training_Type: 'Other',
      estimated_calories: this.toNonNegativeNumber(
        row['estimated_calories'] ?? row['estimatedCalories'],
        0
      ),
    }));
  }

  private extractLegacyCardioRowsFromTrainingRows(rowsCandidate: unknown): Array<Record<string, unknown>> {
    return this.toObjectArray(rowsCandidate)
      .filter((row) =>
        this.normalizeTrainingType(
          row['Training_Type'] ?? row['training_type'] ?? row['trainingType']
        ) === 'Cardio'
      )
      .map((row) => ({
        ...row,
        cardio_type:
          row['cardio_type'] ??
          row['cardioType'] ??
          row['exercise_type'] ??
          row['exersice_type'] ??
          row['type'],
        display_distance:
          row['display_distance'] ??
          row['distance_input'] ??
          row['distanceText'] ??
          row['distance_text'],
        display_time:
          row['display_time'] ??
          row['time_input'] ??
          row['timeText'] ??
          row['time_text'],
        distance_meters:
          row['distance_meters'] ??
          row['distance'] ??
          row['meters'],
        time_minutes:
          row['time_minutes'] ??
          row['time'] ??
          row['minutes'] ??
          row['duration'] ??
          row['reps'],
      }));
  }

  private cardioRowsToTrainingRows(rows: CardioTrainingRow[]): WorkoutTrainingRow[] {
    return rows.map((row) => {
      const exerciseType = this.exerciseEstimatorsService.normalizeEstimatorId(row.cardio_type) ||
        'cardio_activity';
      const reps = this.toInteger(row.time_minutes ?? row.distance_meters, 0);
      return {
        Training_Type: 'Cardio',
        estimated_calories: this.toNonNegativeNumber(row.estimated_calories, 0),
        exercise_type: exerciseType,
        sets: 1,
        reps,
        displayed_weights_metric: 'bodyweight',
        weights_kg: 0,
      };
    });
  }

  private otherRowsToTrainingRows(rows: OtherTrainingRow[]): WorkoutTrainingRow[] {
    return rows.map((row) => {
      const sourceName =
        row['exercise_type'] ??
        row['exersice_type'] ??
        row['name'] ??
        row['activity'] ??
        row['type'];
      const sourceNameText = typeof sourceName === 'string' ? sourceName : '';
      const exerciseType = this.exerciseEstimatorsService.normalizeEstimatorId(sourceNameText) ||
        'other_activity';
      const sets = this.toInteger(row['sets'], 1);
      const reps = this.toInteger(row['reps'] ?? row['time'] ?? row['duration'] ?? 1, 1);
      const rawWeight =
        row['displayed_weights_metric'] ??
        row['weights'] ??
        row['weight'] ??
        row['load'];
      const estimatedRowCalories = this.toNonNegativeNumber(row['estimated_calories'], 0);
      return {
        Training_Type: 'Other',
        estimated_calories: estimatedRowCalories,
        exercise_type: exerciseType,
        sets,
        reps,
        displayed_weights_metric: this.resolveDisplayedWeightMetric(row, rawWeight, undefined, 0),
        weights_kg: this.resolveWeightKgValue(row, rawWeight),
      };
    });
  }

  private normalizeTrainingType(value: unknown): TrainingType {
    const text = String(value ?? '').trim().toLowerCase();
    if (text === 'strength') return 'Strength';
    if (text === 'cardio') return 'Cardio';
    return 'Other';
  }

  private toNonNegativeNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return parsed >= 0 ? parsed : fallback;
  }

  private toInteger(value: unknown, fallback: number): number {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private toPositiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private resolveDisplayDistanceText(row: Record<string, unknown>): string | undefined {
    return this.readMetricText(
      row['display_distance'] ??
      row['distance_input'] ??
      row['distanceText'] ??
      row['distance_text']
    );
  }

  private resolveDisplayTimeText(row: Record<string, unknown>): string | undefined {
    return this.readMetricText(
      row['display_time'] ??
      row['time_input'] ??
      row['timeText'] ??
      row['time_text']
    );
  }

  private resolveDisplayedWeightMetric(
    row: Record<string, unknown>,
    rawWeight: unknown,
    latestUserMessage?: string,
    rowIndex = 0
  ): string {
    const explicit = this.readMetricText(
      row['displayed_weights_metric'] ?? row['displayWeight']
    );
    if (explicit) {
      return explicit.toLowerCase().includes('body') ? 'bodyweight' : explicit;
    }

    const rawText = this.readMetricText(rawWeight);
    if (rawText) {
      if (rawText.toLowerCase().includes('body')) {
        return 'bodyweight';
      }
      if (/[a-z]/i.test(rawText)) {
        return rawText;
      }
    }

    const messageWeight = rowIndex === 0
      ? this.extractWeightMetricText(latestUserMessage)
      : undefined;
    if (messageWeight) {
      return messageWeight.toLowerCase().includes('body') ? 'bodyweight' : messageWeight;
    }

    return 'bodyweight';
  }

  private extractWeightMetricText(value: unknown): string | undefined {
    const text = this.readMetricText(value);
    if (!text) {
      return undefined;
    }

    if (text.toLowerCase().includes('body weight') || text.toLowerCase().includes('bodyweight')) {
      return 'bodyweight';
    }

    const match = text.match(
      /([0-9]*\.?[0-9]+)\s*(kg|kgs|kilogram|kilograms|lb|lbs|pound|pounds)\b/i
    );
    return match?.[0]?.trim();
  }

  private resolveWeightKgValue(row: Record<string, unknown>, rawWeight: unknown): number {
    const explicitKg = this.toPositiveNumber(row['weights_kg']);
    if (typeof explicitKg === 'number') {
      return explicitKg;
    }

    return this.parseWeightKg(rawWeight) ?? 0;
  }

  private parseWeightKg(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }

    const text = String(value ?? '').trim().toLowerCase();
    if (!text || text.includes('body')) {
      return undefined;
    }

    const match = text.match(
      /([0-9]*\.?[0-9]+)\s*(kg|kgs|kilogram|kilograms|lb|lbs|pound|pounds)?\b/
    );
    if (!match) {
      const parsed = Number(text);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }

    const amount = Number(match[1] ?? 0);
    const unit = String(match[2] ?? 'kg').toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) {
      return undefined;
    }

    if (unit === 'lb' || unit === 'lbs' || unit === 'pound' || unit === 'pounds') {
      return amount * 0.45359237;
    }

    return amount;
  }

  private extractDistanceMetricText(value: unknown): string | undefined {
    const text = this.readMetricText(value);
    if (!text) {
      return undefined;
    }

    const match = text.match(
      /([0-9]*\.?[0-9]+)\s*(mi|mile|miles|km|kilometer|kilometers|m|meter|meters)\b/i
    );
    return match?.[0]?.trim();
  }

  private extractTimeMetricText(value: unknown): string | undefined {
    const text = this.readMetricText(value);
    if (!text) {
      return undefined;
    }

    const match = text.match(
      /([0-9]*\.?[0-9]+)\s*(h|hr|hrs|hour|hours|min|mins|minute|minutes)\b/i
    );
    return match?.[0]?.trim();
  }

  private readMetricText(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const text = value.trim();
    return text ? text : undefined;
  }

  private readText(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim();
  }

  private parseDistanceMeters(value: unknown): number | undefined {
    const direct = this.toPositiveNumber(value);
    if (typeof direct === 'number') {
      return direct;
    }

    const text = String(value ?? '').trim().toLowerCase();
    if (!text) {
      return undefined;
    }

    const match = text.match(
      /([0-9]*\.?[0-9]+)\s*(mi|mile|miles|km|kilometer|kilometers|m|meter|meters)\b/
    );
    if (!match) {
      return undefined;
    }

    const amount = Number(match[1] ?? 0);
    const unit = match[2] ?? '';
    if (!Number.isFinite(amount) || amount <= 0) {
      return undefined;
    }

    if (unit === 'mi' || unit === 'mile' || unit === 'miles') {
      return Math.round(amount * 1609.344);
    }
    if (unit === 'km' || unit === 'kilometer' || unit === 'kilometers') {
      return Math.round(amount * 1000);
    }
    return Math.round(amount);
  }

  private parseTimeMinutes(value: unknown): number | undefined {
    const direct = this.toPositiveNumber(value);
    if (typeof direct === 'number') {
      return direct;
    }

    const text = String(value ?? '').trim().toLowerCase();
    if (!text) {
      return undefined;
    }

    const match = text.match(
      /([0-9]*\.?[0-9]+)\s*(h|hr|hrs|hour|hours|min|mins|minute|minutes)\b/
    );
    if (!match) {
      return undefined;
    }

    const amount = Number(match[1] ?? 0);
    const unit = match[2] ?? '';
    if (!Number.isFinite(amount) || amount <= 0) {
      return undefined;
    }

    if (
      unit === 'h' ||
      unit === 'hr' ||
      unit === 'hrs' ||
      unit === 'hour' ||
      unit === 'hours'
    ) {
      return Math.round(amount * 60);
    }
    return Math.round(amount);
  }

  private toObjectArray(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object'
      );
    }

    if (value && typeof value === 'object') {
      return [value as Record<string, unknown>];
    }

    return [];
  }

  private hasOwnKey(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  private resolveSessionTrainingType(
    source: Record<string, unknown>,
    strengthRows: WorkoutTrainingRow[],
    cardioRows: CardioTrainingRow[],
    otherRows: OtherTrainingRow[],
    flattenedRows: WorkoutTrainingRow[]
  ): TrainingType {
    if (this.hasOwnKey(source, 'Training_Type')) {
      return this.normalizeTrainingType(source['Training_Type']);
    }

    const populatedTypes = [
      strengthRows.length > 0 ? 'Strength' as const : null,
      cardioRows.length > 0 ? 'Cardio' as const : null,
      otherRows.length > 0 ? 'Other' as const : null,
    ].filter((value): value is TrainingType => !!value);

    if (populatedTypes.length === 1) {
      return populatedTypes[0];
    }

    return flattenedRows[0]?.Training_Type ?? 'Other';
  }

  private ensureEstimatedCaloriesAcrossRows(
    strengthRows: WorkoutTrainingRow[],
    cardioRows: CardioTrainingRow[],
    otherRows: OtherTrainingRow[],
    sessionEstimatedCalories: number
  ): void {
    const buckets = [
      ...strengthRows.map((row) => ({
        read: () => row.estimated_calories,
        write: (value: number) => { row.estimated_calories = value; },
      })),
      ...cardioRows.map((row) => ({
        read: () => row.estimated_calories,
        write: (value: number) => { row.estimated_calories = value; },
      })),
      ...otherRows.map((row) => ({
        read: () => this.toNonNegativeNumber(row['estimated_calories'], 0),
        write: (value: number) => { row['estimated_calories'] = value; },
      })),
    ];

    if (buckets.length === 0) {
      return;
    }

    const missing = buckets.filter((bucket) => bucket.read() <= 0);
    if (missing.length === 0) {
      return;
    }

    const fallbackPerRow = sessionEstimatedCalories > 0
      ? Math.max(1, Math.round(sessionEstimatedCalories / buckets.length))
      : 0;

    missing.forEach((bucket) => {
      bucket.write(fallbackPerRow);
    });
  }

  private calculateTotalVolume(rows: WorkoutTrainingRow[]): number {
    return rows.reduce((total, row) => {
      if (
        typeof row.weights_kg !== 'number' ||
        !Number.isFinite(row.weights_kg) ||
        row.weights_kg <= 0
      ) {
        return total;
      }
      return total + row.sets * row.reps * row.weights_kg;
    }, 0);
  }

  private rowsToLegacyExercises(rows: WorkoutTrainingRow[]): SummaryExercise[] {
    return rows.map((row) => {
      const metricWeight = row.displayed_weights_metric || 'bodyweight';
      return {
        name: this.fromSnakeCase(row.exercise_type),
        metric: `${row.sets} x ${row.reps} @ ${metricWeight}`,
        volume: typeof row.weights_kg === 'number'
          ? row.sets * row.reps * row.weights_kg
          : 0,
      };
    });
  }

  private fromSnakeCase(value: string): string {
    return String(value ?? '')
      .split('_')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }
}
