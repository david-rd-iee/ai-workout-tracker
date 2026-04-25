import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from '@angular/fire/firestore';
import { workoutSummaryToLegacyWorkoutSession } from '../../../shared/adapters/workout-summary.adapters';
import { normalizeWorkoutSummaryCandidate } from '../../../shared/adapters/workout-summary.adapters';
import type { WorkoutSummary } from '../../../shared/models/workout-summary.model';
import { workoutEventToWorkoutSessionPerformance } from '../adapters/workout-event.adapters';
import type {
  CardioTrainingRow,
  OtherTrainingRow,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../models/workout-session.model';
import type { WorkoutHistoryDateGroup } from '../models/workout-history.model';

export interface PersistedWorkoutSummary extends WorkoutSummary {
  createdAt?: unknown;
  updatedAt?: unknown;
}

@Injectable({ providedIn: 'root' })
export class WorkoutSummaryService {
  constructor(private firestore: Firestore) {}

  async listRecentWorkoutSummaries(
    userId: string,
    maxResults = 20
  ): Promise<PersistedWorkoutSummary[]> {
    const normalizedUserId = this.readText(userId);
    if (!normalizedUserId) {
      return [];
    }

    const summariesRef = collection(this.firestore, `users/${normalizedUserId}/workoutSummaries`);
    // Canonical docs are keyed by YYYY-MM-DD doc ids. Sorting by doc id is resilient
    // even when legacy docs are missing a top-level "date" field.
    let snapshot = await getDocs(
      query(summariesRef, orderBy(documentId(), 'desc'), limit(maxResults))
    );

    // Fallback for projects that do not allow documentId ordering in existing indexes.
    if (snapshot.empty) {
      snapshot = await getDocs(
        query(summariesRef, orderBy('date', 'desc'), limit(maxResults))
      );
    }

    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      const summary = normalizeWorkoutSummaryCandidate(data, { defaultDate: docSnap.id });
      return {
        ...summary,
        createdAt: data['createdAt'],
        updatedAt: data['updatedAt'],
      };
    });
  }

  async getWorkoutSummary(userId: string, date: string): Promise<PersistedWorkoutSummary | null> {
    const normalizedUserId = this.readText(userId);
    const normalizedDate = this.readText(date);
    if (!normalizedUserId || !normalizedDate) {
      return null;
    }

    const snapshot = await getDoc(
      doc(this.firestore, `users/${normalizedUserId}/workoutSummaries/${normalizedDate}`)
    );
    if (!snapshot.exists()) {
      return null;
    }

    const data = snapshot.data() as Record<string, unknown>;
    const summary = normalizeWorkoutSummaryCandidate(data, { defaultDate: normalizedDate });
    return {
      ...summary,
      createdAt: data['createdAt'],
      updatedAt: data['updatedAt'],
    };
  }

  toWorkoutSessionPerformance(summary: WorkoutSummary): WorkoutSessionPerformance {
    return workoutEventToWorkoutSessionPerformance(
      normalizeWorkoutSummaryCandidate(summary).aggregate
    );
  }

  toLoggedAtDate(summary: WorkoutSummary): Date | null {
    return this.toDate(
      summary.lastEventCreatedAt ??
      summary.firstEventCreatedAt
    );
  }

  toHistoryGroup(summary: WorkoutSummary): WorkoutHistoryDateGroup {
    const normalizedSummary = normalizeWorkoutSummaryCandidate(summary);
    const session = workoutSummaryToLegacyWorkoutSession(normalizedSummary) as WorkoutSessionPerformance;
    const totalCalories = this.toRoundedNonNegative(
      session.estimated_calories ?? session.calories
    );
    const trainingRows = Array.isArray(session.trainingRows) ? session.trainingRows : [];
    const calorieShares = this.resolveCalorieShares(trainingRows, totalCalories);

    const fallbackStrength: WorkoutHistoryDateGroup['strength'] = [];
    const fallbackCardio: WorkoutHistoryDateGroup['cardio'] = [];
    const fallbackOther: WorkoutHistoryDateGroup['other'] = [];

    trainingRows.forEach((row, index) => {
      const caloriesBurned = calorieShares[index] ?? 0;
      if (row.Training_Type === 'Strength') {
        fallbackStrength.push({
          exercise: this.toDisplayExerciseName(row.exercise_type),
          sets: this.toRoundedNonNegative(row.sets),
          reps: this.toRoundedNonNegative(row.reps),
          weights: this.formatWeight(row as unknown as Record<string, unknown>),
          caloriesBurned,
        });
        return;
      }

      if (row.Training_Type === 'Cardio') {
        fallbackCardio.push({
          exercise: this.toDisplayExerciseName(row.exercise_type),
          distance: '',
          time: this.toRoundedNonNegative(row.reps) > 0 ? `${this.toRoundedNonNegative(row.reps)} min` : '',
          caloriesBurned,
        });
        return;
      }

      fallbackOther.push({
        exercise: this.toDisplayExerciseName(row.exercise_type),
        details: `${this.toRoundedNonNegative(row.sets)} x ${this.toRoundedNonNegative(row.reps)} @ ${this.formatWeight(row as unknown as Record<string, unknown>)}`,
        caloriesBurned,
      });
    });

    const strengthRows = this.toObjectArray(session.strengthTrainingRow);
    const cardioRows = this.toObjectArray(session.cardioTrainingRow);
    const otherRows = this.toObjectArray(session.otherTrainingRow);

    const strength = strengthRows.length > 0
      ? strengthRows.map((row) => ({
          exercise: this.toDisplayExerciseName(
            String(row['exercise_type'] ?? row['exercise'] ?? 'strength_exercise')
          ),
          sets: this.toRoundedNonNegative(row['sets']),
          reps: this.toRoundedNonNegative(row['reps']),
          weights: this.formatWeight(row),
          caloriesBurned: this.toRoundedNonNegative(row['estimated_calories']),
        }))
      : fallbackStrength;

    const cardio = cardioRows.length > 0
      ? cardioRows.map((row) => ({
          exercise: this.toDisplayExerciseName(
            String(row['cardio_type'] ?? row['exercise_type'] ?? row['type'] ?? 'cardio_activity')
          ),
          distance: this.resolveCardioDistanceText(row),
          time: this.resolveCardioTimeText(row),
          caloriesBurned: this.toRoundedNonNegative(row['estimated_calories']),
        }))
      : fallbackCardio;

    const other = otherRows.length > 0
      ? otherRows.map((row) => ({
          exercise: this.toDisplayExerciseName(
            String(row['exercise_type'] ?? row['activity'] ?? row['name'] ?? 'other_activity')
          ),
          details: this.resolveOtherDetails(row),
          caloriesBurned: this.toRoundedNonNegative(row['estimated_calories']),
        }))
      : fallbackOther;

    if (strength.length === 0 && cardio.length === 0 && other.length === 0) {
      const legacyExercises = Array.isArray(session.exercises) ? session.exercises : [];
      legacyExercises.forEach((exercise) => {
        const parsed = this.parseLegacyMetric(exercise.metric);
        other.push({
          exercise: exercise.name || 'Exercise',
          details: `${parsed.sets} x ${parsed.reps} @ ${parsed.weights}`,
          caloriesBurned: 0,
        });
      });
    }

    const allCalories = [
      ...strength.map((entry) => entry.caloriesBurned),
      ...cardio.map((entry) => entry.caloriesBurned),
      ...other.map((entry) => entry.caloriesBurned),
    ];
    const sumOfRowCalories = allCalories.reduce((sum, value) => sum + value, 0);
    const displayTotalCalories = totalCalories > 0 ? totalCalories : sumOfRowCalories;

    if (displayTotalCalories > 0 && sumOfRowCalories === 0) {
      const rowCount = strength.length + cardio.length + other.length;
      if (rowCount > 0) {
        const equalShare = Math.round(displayTotalCalories / rowCount);
        strength.forEach((entry) => { entry.caloriesBurned = equalShare; });
        cardio.forEach((entry) => { entry.caloriesBurned = equalShare; });
        other.forEach((entry) => { entry.caloriesBurned = equalShare; });
      }
    }

    return {
      date: normalizedSummary.date,
      strength,
      cardio,
      other,
      totalCaloriesBurned: displayTotalCalories,
      trainerNotes: this.readText(session.trainer_notes ?? session.notes),
    };
  }

  private resolveCalorieShares(rows: WorkoutTrainingRow[], totalCalories: number): number[] {
    if (rows.length === 0) {
      return [];
    }

    const rowCalories = rows.map((row) => this.toRoundedNonNegative(row.estimated_calories));
    const rowCalorieSum = rowCalories.reduce((sum, value) => sum + value, 0);
    if (rowCalorieSum > 0) {
      return rowCalories;
    }

    const equalShare = totalCalories > 0 ? Math.round(totalCalories / rows.length) : 0;
    return rows.map(() => equalShare);
  }

  private resolveCardioDistanceText(row: Record<string, unknown>): string {
    const displayText = this.readText(
      row['display_distance'] ??
      row['distance_input'] ??
      row['distanceText'] ??
      row['distance_text']
    );
    if (displayText) {
      return displayText;
    }

    const distance = Number(row['distance_meters'] ?? row['distance']);
    if (Number.isFinite(distance) && distance > 0) {
      return `${Math.round(distance * 100) / 100} m`;
    }

    return '';
  }

  private resolveCardioTimeText(row: Record<string, unknown>): string {
    const displayText = this.readText(
      row['display_time'] ??
      row['time_input'] ??
      row['timeText'] ??
      row['time_text']
    );
    if (displayText) {
      return displayText;
    }

    const minutes = Number(row['time_minutes'] ?? row['time']);
    if (Number.isFinite(minutes) && minutes > 0) {
      return `${Math.round(minutes * 100) / 100} min`;
    }

    return '';
  }

  private resolveOtherDetails(row: Record<string, unknown>): string {
    const sets = this.toRoundedNonNegative(row['sets']);
    const reps = this.toRoundedNonNegative(row['reps'] ?? row['time']);
    const weights = this.readText(
      row['displayed_weights_metric'] ?? row['weights'] ?? row['weight'] ?? row['load']
    ) || 'bodyweight';

    if (sets > 0 || reps > 0) {
      return `${sets} x ${reps} @ ${weights}`;
    }

    return this.readText(row['activity'] ?? row['name'] ?? row['type']) || 'Activity logged';
  }

  private parseLegacyMetric(metric: string): { sets: number; reps: number; weights: string } {
    const match = String(metric ?? '').match(/(\d+)\s*x\s*(\d+)\s*@\s*(.+)/i);
    if (!match) {
      return { sets: 0, reps: 0, weights: 'bodyweight' };
    }

    return {
      sets: this.toRoundedNonNegative(match[1]),
      reps: this.toRoundedNonNegative(match[2]),
      weights: this.readText(match[3]) || 'bodyweight',
    };
  }

  private toDisplayExerciseName(value: string): string {
    return String(value ?? '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }

  private formatWeight(row: Record<string, unknown>): string {
    const displayMetric = this.readText(row['displayed_weights_metric']);
    if (displayMetric) {
      return displayMetric.toLowerCase().includes('body') ? 'bodyweight' : displayMetric;
    }

    return 'bodyweight';
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

  private toRoundedNonNegative(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }

    return Math.round(parsed);
  }

  private toDate(value: unknown): Date | null {
    try {
      const dateValue = (value as { toDate?: () => Date } | null | undefined)?.toDate?.() ?? value;
      if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
        return dateValue;
      }

      const parsed = new Date(this.readText(dateValue));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    } catch {
      return null;
    }
  }

  private readText(value: unknown): string {
    return typeof value === 'string'
      ? value.trim()
      : String(value ?? '').trim();
  }
}
