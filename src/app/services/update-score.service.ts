import { Injectable } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { WorkoutSessionPerformance } from '../models/workout-session.model';
import { ExerciseEstimatorCoefficientMap, ExerciseEstimatorModel } from '../models/exercise-estimators.model';

interface EstimatorDoc {
  model: ExerciseEstimatorModel;
  coefficients: ExerciseEstimatorCoefficientMap;
}

export interface UpdateScoreResult {
  oldCardioScore: number;
  newCardioScore: number;
  addedCardioScore: number;
  oldStrengthScore: number;
  newStrengthScore: number;
  addedStrengthScore: number;
  addedTotalScore: number;
  currentTotalScore: number;
}

@Injectable({
  providedIn: 'root',
})
export class UpdateScoreService {
  constructor(private firestore: Firestore) {}

  async updateScoreAfterWorkout(params: {
    userId: string;
    session: WorkoutSessionPerformance;
    workoutLogId?: string;
  }): Promise<UpdateScoreResult> {
    const userId = String(params.userId ?? '').trim();
    if (!userId) {
      throw new Error('updateScoreAfterWorkout: userId is required');
    }

    const statsRef = doc(this.firestore, 'userStats', userId);
    const statsSnap = await getDoc(statsRef);
    const current = statsSnap.exists()
      ? (statsSnap.data() as Record<string, unknown>)
      : {};

    const userAge = this.toNonNegativeNumber(current['age']);
    const userBmi = this.toNonNegativeNumber(current['bmi']);
    const userWeightKg = this.toNonNegativeNumber(
      current['weightKg'] ?? current['weight_kg'] ?? current['weight']
    );
    const userSexCode = this.toSexCode(current['sex']);

    const cardioScoreMap = this.roundScoreMap(this.toNumberMap(current['cardioScore']));
    const strengthScoreMap = this.roundScoreMap(this.toNumberMap(
      current['strengthScore'] ?? current['workScore']
    ));
    const expectedStrengthScores = this.toNumberMap(current['expected_strength_scores']);

    const oldCardioScore = this.toWholeNumber(this.toNonNegativeNumber(cardioScoreMap['totalCardioScore']));
    const oldStrengthScore = this.toWholeNumber(this.toNonNegativeNumber(strengthScoreMap['totalStrengthScore']));
    const currentTotalScore = this.toWholeNumber(this.toFiniteNumber(
      current['totalScore'],
      oldCardioScore + oldStrengthScore
    ));

    const cardioRows = this.getCardioRows(params.session);
    const addedCardioScore = cardioRows.length * 100;
    const newCardioScore = oldCardioScore + addedCardioScore;

    const strengthRows = this.getStrengthRows(params.session);
    const scaledStrengthEstimator = await this.getEstimatorDoc('scaled_strength', false);

    for (const row of strengthRows) {
      const exerciseType = this.normalizeEstimatorId(
        String(
          row['exercise_type'] ??
          row['exerciseType'] ??
          row['exercise'] ??
          ''
        )
      );
      if (!exerciseType) {
        continue;
      }

      const estimator = await this.getEstimatorDoc(exerciseType, true);
      let usedScaledStrengthEstimator = estimator.model === 'NONE';

      let expected = this.toNonNegativeNumber(expectedStrengthScores[exerciseType]);
      if (expected <= 0) {
        expected = this.calculateExpectedFromEstimator(estimator, {
          sexCode: userSexCode,
          bmi: userBmi,
          age: userAge,
        });
      }

      if (expected <= 0) {
        expected = this.calculateExpectedFromEstimator(scaledStrengthEstimator, {
          sexCode: userSexCode,
          bmi: userBmi,
          age: userAge,
        });
        usedScaledStrengthEstimator = true;
      }

      if (expected > 0) {
        expectedStrengthScores[exerciseType] = expected;
      }

      const reps = this.toNonNegativeNumber(row['reps']);
      const weightKg = this.resolveWeightKg(
        row['weights'] ?? row['weight'] ?? row['weight_kg']
      );
      const e1rm = weightKg > 0 ? weightKg * (1 + reps / 30) : 0;
      const actual = usedScaledStrengthEstimator
        ? this.scaleActualStrength(e1rm, userWeightKg)
        : e1rm;
      const score = expected > 0 && actual > 0
        ? (actual / expected) * 100
        : 0;
      const roundedScore = this.toWholeNumber(score);

      if (roundedScore > 0) {
        const priorExerciseScore = this.toWholeNumber(
          this.toNonNegativeNumber(strengthScoreMap[exerciseType])
        );
        strengthScoreMap[exerciseType] = priorExerciseScore + roundedScore;
      }

      await this.logScoreInput('scaled_strength', {
        userId,
        workoutLogId: params.workoutLogId,
        exerciseType,
        age: userAge,
        bmi: userBmi,
        sexCode: userSexCode,
        weightKg: userWeightKg,
        expectedOneRepMaxKg: expected,
        actualOneRepMaxKg: actual,
        e1rmKg: e1rm,
        score: roundedScore,
        usedScaledStrengthEstimator,
      });
      await this.logScoreInput(exerciseType, {
        userId,
        workoutLogId: params.workoutLogId,
        exerciseType,
        age: userAge,
        bmi: userBmi,
        sexCode: userSexCode,
        weightKg: userWeightKg,
        expectedOneRepMaxKg: expected,
        actualOneRepMaxKg: actual,
        e1rmKg: e1rm,
        score: roundedScore,
        usedScaledStrengthEstimator,
      });
    }

    const newStrengthScore = this.toWholeNumber(this.sumStrengthEntries(strengthScoreMap));
    const addedStrengthScore = this.toWholeNumber(newStrengthScore - oldStrengthScore);
    const addedTotalScore = this.toWholeNumber(addedCardioScore + addedStrengthScore);
    const nextTotalScore = this.toWholeNumber(currentTotalScore + addedTotalScore);

    const nextCardioMap: Record<string, number> = {
      ...cardioScoreMap,
      totalCardioScore: newCardioScore,
    };
    const nextStrengthMap: Record<string, number> = {
      ...this.roundScoreMap(strengthScoreMap),
      totalStrengthScore: newStrengthScore,
    };

    await setDoc(
      statsRef,
      {
        cardioScore: nextCardioMap,
        strengthScore: nextStrengthMap,
        expected_strength_scores: expectedStrengthScores,
        totalScore: nextTotalScore,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return {
      oldCardioScore,
      newCardioScore,
      addedCardioScore,
      oldStrengthScore,
      newStrengthScore,
      addedStrengthScore,
      addedTotalScore,
      currentTotalScore: nextTotalScore,
    };
  }

  private getStrengthRows(session: WorkoutSessionPerformance): Array<Record<string, unknown>> {
    const explicitStrengthRows = this.toObjectArray(
      session.strengthTrainingRow ?? session.strengthTrainingRowss ?? []
    );
    if (explicitStrengthRows.length > 0) {
      return explicitStrengthRows;
    }

    const fallbackRows = Array.isArray(session.trainingRows) ? session.trainingRows : [];
    return fallbackRows
      .filter((row) => row?.Training_Type === 'Strength')
      .map((row) => row as unknown as Record<string, unknown>);
  }

  private getCardioRows(session: WorkoutSessionPerformance): Array<Record<string, unknown>> {
    const explicitCardioRows = this.toObjectArray(session.cardioTrainingRow ?? []);
    if (explicitCardioRows.length > 0) {
      return explicitCardioRows;
    }

    const fallbackRows = Array.isArray(session.trainingRows) ? session.trainingRows : [];
    return fallbackRows
      .filter((row) => row?.Training_Type === 'Cardio')
      .map((row) => row as unknown as Record<string, unknown>);
  }

  private async getEstimatorDoc(
    exerciseType: string,
    createWhenMissing: boolean
  ): Promise<EstimatorDoc> {
    const estimatorId = this.normalizeEstimatorId(exerciseType);
    const estimatorRef = doc(this.firestore, 'exercise_estimators', estimatorId);
    const estimatorSnap = await getDoc(estimatorRef);

    if (!estimatorSnap.exists()) {
      if (createWhenMissing) {
        await setDoc(
          estimatorRef,
          {
            model: 'NONE',
            coefficients: {},
            isUserDefined: true,
            createdBy: 'update_score_service',
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      return {
        model: 'NONE',
        coefficients: {},
      };
    }

    const raw = estimatorSnap.data() as Record<string, unknown>;
    const rawModel = String(raw['model'] ?? 'NONE');
    const model: ExerciseEstimatorModel = (
      rawModel === 'WeightedLeastSquares' ||
      rawModel === 'ExponentialRegression' ||
      rawModel === 'NONE'
    )
      ? rawModel
      : 'NONE';

    return {
      model,
      coefficients: this.toNumberMap(raw['coefficients']),
    };
  }

  private calculateExpectedFromEstimator(
    estimator: EstimatorDoc,
    params: {
      sexCode: number;
      bmi: number;
      age: number;
    }
  ): number {
    const intercept = this.getCoefficient(estimator.coefficients, 'intercept');
    const sexCoefficient = this.getCoefficient(estimator.coefficients, 'sex_code');
    const bmiCoefficient = this.getCoefficient(estimator.coefficients, 'bmi');
    const ageCoefficient = this.getCoefficient(estimator.coefficients, 'age');

    if (estimator.model === 'WeightedLeastSquares') {
      return intercept +
        (sexCoefficient * params.sexCode) +
        (bmiCoefficient * params.bmi) +
        (ageCoefficient * params.age);
    }

    if (estimator.model === 'ExponentialRegression') {
      const scaleA = this.getCoefficient(estimator.coefficients, 'scale_a');
      const exponent =
        (sexCoefficient * params.sexCode) +
        (bmiCoefficient * params.bmi) +
        (ageCoefficient * params.age);
      return intercept + (scaleA * Math.exp(exponent));
    }

    return 0;
  }

  private getCoefficient(
    coefficients: ExerciseEstimatorCoefficientMap,
    key: string
  ): number {
    if (typeof coefficients[key] === 'number' && Number.isFinite(coefficients[key])) {
      return coefficients[key];
    }

    const lowercaseKey = key.toLowerCase();
    const entry = Object.entries(coefficients).find(([candidate]) =>
      candidate.toLowerCase() === lowercaseKey
    );
    if (!entry) {
      return 0;
    }

    const candidateValue = entry[1];
    return Number.isFinite(candidateValue) ? candidateValue : 0;
  }

  private async logScoreInput(
    estimatorId: string,
    payload: {
      userId: string;
      workoutLogId?: string;
      exerciseType: string;
      age: number;
      bmi: number;
      sexCode: number;
      weightKg: number;
      expectedOneRepMaxKg: number;
      actualOneRepMaxKg: number;
      e1rmKg: number;
      score: number;
      usedScaledStrengthEstimator: boolean;
    }
  ): Promise<void> {
    const normalizedId = this.normalizeEstimatorId(estimatorId);
    if (!normalizedId) {
      return;
    }

    const samplesRef = collection(
      this.firestore,
      'exercise_estimators',
      normalizedId,
      'score_inputs'
    );

    await addDoc(samplesRef, {
      user_id: payload.userId,
      workout_log_id: payload.workoutLogId ?? '',
      exercise_type: payload.exerciseType,
      age: payload.age,
      bmi: payload.bmi,
      sex: payload.sexCode,
      weight_kg: payload.weightKg,
      expected_one_rep_max_kg: payload.expectedOneRepMaxKg,
      actual_one_rep_max_kg: payload.actualOneRepMaxKg,
      e1rm_kg: payload.e1rmKg,
      score: payload.score,
      used_scaled_strength_model: payload.usedScaledStrengthEstimator,
      createdAt: serverTimestamp(),
    });
  }

  private sumStrengthEntries(strengthScoreMap: Record<string, number>): number {
    return Object.entries(strengthScoreMap).reduce((sum, [key, value]) => {
      if (key === 'totalStrengthScore') {
        return sum;
      }
      return sum + this.toNonNegativeNumber(value);
    }, 0);
  }

  private scaleActualStrength(e1rm: number, userWeightKg: number): number {
    if (e1rm <= 0 || userWeightKg <= 0) {
      return 0;
    }
    return e1rm / Math.pow(userWeightKg, 0.67);
  }

  private resolveWeightKg(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }

    const text = String(value ?? '').trim().toLowerCase();
    if (text.includes('body')) {
      return 0;
    }

    const parsed = Number(text);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    return 0;
  }

  private toSexCode(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    const text = String(value ?? '').trim().toLowerCase();
    if (text === 'male' || text === 'm') {
      return 1;
    }
    if (text === 'female' || text === 'f') {
      return 0;
    }

    const parsed = Number(text);
    if (Number.isFinite(parsed)) {
      return parsed;
    }

    return 0;
  }

  private toNumberMap(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object') {
      return {};
    }

    return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>(
      (acc, [key, candidateValue]) => {
        const parsed = Number(candidateValue);
        if (Number.isFinite(parsed)) {
          acc[key] = parsed;
        }
        return acc;
      },
      {}
    );
  }

  private roundScoreMap(value: Record<string, number>): Record<string, number> {
    return Object.entries(value).reduce<Record<string, number>>((acc, [key, candidate]) => {
      acc[key] = this.toWholeNumber(this.toNonNegativeNumber(candidate));
      return acc;
    }, {});
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

  private normalizeEstimatorId(rawId: string): string {
    return String(rawId ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');
  }

  private toFiniteNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private toNonNegativeNumber(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return parsed;
  }

  private toWholeNumber(value: number): number {
    return Math.round(Number(value) || 0);
  }
}
