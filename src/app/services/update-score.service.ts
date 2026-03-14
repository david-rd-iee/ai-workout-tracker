import { Injectable } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { WorkoutSessionPerformance } from '../models/workout-session.model';
import {
  EXERCISE_ESTIMATOR_CARDIO_CATEGORY,
  EXERCISE_ESTIMATOR_PARENT_DOC,
  EXERCISE_ESTIMATOR_ROOT_COLLECTION,
  EXERCISE_ESTIMATOR_STRENGTH_CATEGORY,
  EXERCISE_ESTIMATOR_WORKOUT_LOGS_COLLECTION,
  ExerciseEstimatorCategory,
  ExerciseEstimatorCoefficientMap,
  ExerciseEstimatorModel,
} from '../models/exercise-estimators.model';

interface EstimatorDoc {
  exists: boolean;
  model: ExerciseEstimatorModel;
  coefficients: ExerciseEstimatorCoefficientMap;
  hasConfiguredEstimator: boolean;
}

interface ExpectedEffortMap {
  Cardio: Record<string, number>;
  Strength: Record<string, number>;
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
    const expectedEffort = this.normalizeExpectedEffort(
      current['Expected_Effort'],
      current['expected_strength_scores']
    );

    const oldCardioScore = this.resolveScoreTotal(cardioScoreMap, 'totalCardioScore');
    const oldStrengthScore = this.resolveScoreTotal(strengthScoreMap, 'totalStrengthScore');
    const currentTotalScore = this.toWholeNumber(this.toFiniteNumber(
      current['totalScore'],
      oldCardioScore + oldStrengthScore
    ));

    const cardioRows = this.getCardioRows(params.session);
    const strengthRows = this.getStrengthRows(params.session);
    const genericCardioEstimator = await this.getEstimatorDoc({
      category: EXERCISE_ESTIMATOR_CARDIO_CATEGORY,
      exerciseType: 'generic_cardio',
      createWhenMissing: false,
      createBlankDocWhenMissing: false,
    });
    const scaledStrengthEstimator = await this.getEstimatorDoc({
      category: EXERCISE_ESTIMATOR_STRENGTH_CATEGORY,
      exerciseType: 'scaled_strength',
      createWhenMissing: false,
      createBlankDocWhenMissing: false,
    });

    for (const row of cardioRows) {
      const exerciseType = this.resolveCardioExerciseType(row);
      if (!exerciseType) {
        continue;
      }

      const estimator = exerciseType === 'generic_cardio'
        ? genericCardioEstimator
        : await this.getEstimatorDoc({
          category: EXERCISE_ESTIMATOR_CARDIO_CATEGORY,
          exerciseType,
          createWhenMissing: true,
          createBlankDocWhenMissing: true,
        });
      const usedGenericCardioEstimator =
        exerciseType !== 'generic_cardio' && !estimator.hasConfiguredEstimator;
      const estimatorForCalculation = usedGenericCardioEstimator
        ? genericCardioEstimator
        : estimator;

      let expected = this.toNonNegativeNumber(expectedEffort.Cardio[exerciseType]);
      if (expected <= 0) {
        expected = this.calculateExpectedFromEstimator(estimatorForCalculation, {
          sexCode: userSexCode,
          bmi: userBmi,
          age: userAge,
        });
      }

      if (expected > 0) {
        expectedEffort.Cardio[exerciseType] = expected;
      }

      const cardioPerformance = this.resolveCardioPerformance(row);
      const score = expected > 0 && cardioPerformance.actualVo2Max > 0
        ? (cardioPerformance.actualVo2Max / expected) * 100
        : 0;
      const roundedScore = this.toWholeNumber(score);

      if (roundedScore > 0) {
        const priorExerciseScore = this.toWholeNumber(
          this.toNonNegativeNumber(cardioScoreMap[exerciseType])
        );
        cardioScoreMap[exerciseType] = priorExerciseScore + roundedScore;
      }

      const cardioLogPayload = {
        age: userAge,
        bmi: userBmi,
        sex: userSexCode,
        actual_vo2_max: cardioPerformance.actualVo2Max,
      };

      await this.logEstimatorWorkout(
        EXERCISE_ESTIMATOR_CARDIO_CATEGORY,
        'generic_cardio',
        cardioLogPayload
      );
      if (exerciseType !== 'generic_cardio') {
        await this.logEstimatorWorkout(
          EXERCISE_ESTIMATOR_CARDIO_CATEGORY,
          exerciseType,
          cardioLogPayload
        );
      }
    }

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

      const estimator = await this.getEstimatorDoc({
        category: EXERCISE_ESTIMATOR_STRENGTH_CATEGORY,
        exerciseType,
        createWhenMissing: true,
        createBlankDocWhenMissing: false,
      });

      let usedScaledStrengthEstimator = !estimator.hasConfiguredEstimator;
      let expected = this.toNonNegativeNumber(expectedEffort.Strength[exerciseType]);
      if (expected <= 0 && estimator.hasConfiguredEstimator) {
        expected = this.calculateExpectedFromEstimator(estimator, {
          sexCode: userSexCode,
          bmi: userBmi,
          age: userAge,
        });
        usedScaledStrengthEstimator = false;
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
        expectedEffort.Strength[exerciseType] = expected;
      }

      const reps = this.toNonNegativeNumber(row['reps']);
      const weightKg = this.resolveWeightKg(
        row['weights_kg'] ?? row['weights'] ?? row['weight'] ?? row['weight_kg'],
        userWeightKg
      );
      const e1rm = weightKg > 0 ? weightKg * (1 + reps / 30) : 0;
      const scaledActualStrength = this.scaleActualStrength(e1rm, userWeightKg);
      const actual = usedScaledStrengthEstimator
        ? scaledActualStrength
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

      await this.logEstimatorWorkout(
        EXERCISE_ESTIMATOR_STRENGTH_CATEGORY,
        'scaled_strength',
        {
          age: userAge,
          bmi: userBmi,
          sex: userSexCode,
          actual_scaled_strength: scaledActualStrength,
        }
      );
      if (exerciseType !== 'scaled_strength') {
        await this.logEstimatorWorkout(
          EXERCISE_ESTIMATOR_STRENGTH_CATEGORY,
          exerciseType,
          {
            age: userAge,
            bmi: userBmi,
            sex: userSexCode,
            actual_one_rep_max: e1rm,
          }
        );
      }
    }

    const newCardioScore = this.toWholeNumber(this.sumScoreEntries(cardioScoreMap, 'totalCardioScore'));
    const newStrengthScore = this.toWholeNumber(
      this.sumScoreEntries(strengthScoreMap, 'totalStrengthScore')
    );
    const addedCardioScore = this.toWholeNumber(newCardioScore - oldCardioScore);
    const addedStrengthScore = this.toWholeNumber(newStrengthScore - oldStrengthScore);
    const addedTotalScore = this.toWholeNumber(addedCardioScore + addedStrengthScore);
    const nextTotalScore = this.toWholeNumber(currentTotalScore + addedTotalScore);

    const nextCardioMap: Record<string, number> = {
      ...this.roundScoreMap(cardioScoreMap),
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
        Expected_Effort: expectedEffort,
        expected_strength_scores: deleteField(),
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

  private async getEstimatorDoc(params: {
    category: ExerciseEstimatorCategory;
    exerciseType: string;
    createWhenMissing: boolean;
    createBlankDocWhenMissing: boolean;
  }): Promise<EstimatorDoc> {
    const estimatorId = this.normalizeEstimatorId(params.exerciseType);
    const estimatorRef = this.getEstimatorDocRef(params.category, estimatorId);
    const estimatorSnap = await getDoc(estimatorRef);

    if (!estimatorSnap.exists()) {
      if (params.createWhenMissing) {
        const payload: Record<string, unknown> = {
          isUserDefined: true,
          createdBy: 'update_score_service',
          createdAt: serverTimestamp(),
        };
        if (!params.createBlankDocWhenMissing) {
          payload['model'] = 'NONE';
          payload['coefficients'] = {};
        }

        await setDoc(estimatorRef, payload, { merge: true });
      }

      return {
        exists: false,
        model: 'NONE',
        coefficients: {},
        hasConfiguredEstimator: false,
      };
    }

    const raw = estimatorSnap.data() as Record<string, unknown>;
    const rawModel = String(raw['model'] ?? 'NONE');
    const model: ExerciseEstimatorModel = (
      rawModel === 'WeightedLeastSquares' ||
      rawModel === 'ExponentialRegression' ||
      rawModel === 'PolynomialRegression' ||
      rawModel === 'NONE'
    )
      ? rawModel
      : 'NONE';
    const coefficients = this.toNumberMap(raw['coefficients']);

    return {
      exists: true,
      model,
      coefficients,
      hasConfiguredEstimator: model !== 'NONE' && Object.keys(coefficients).length > 0,
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

    if (estimator.model === 'WeightedLeastSquares') {
      const sexCoefficient = this.getCoefficient(estimator.coefficients, ['sex_code', 'sex']);
      const bmiCoefficient = this.getCoefficient(estimator.coefficients, ['bmi', 'BMI']);
      const ageCoefficient = this.getCoefficient(estimator.coefficients, ['age', 'age_years']);

      return intercept +
        (sexCoefficient * params.sexCode) +
        (bmiCoefficient * params.bmi) +
        (ageCoefficient * params.age);
    }

    if (estimator.model === 'ExponentialRegression') {
      const scaleA = this.getCoefficient(estimator.coefficients, 'scale_a');
      const sexCoefficient = this.getCoefficient(estimator.coefficients, ['sex_code', 'sex']);
      const bmiCoefficient = this.getCoefficient(estimator.coefficients, ['bmi', 'BMI']);
      const ageCoefficient = this.getCoefficient(estimator.coefficients, ['age', 'age_years']);
      const exponent =
        (sexCoefficient * params.sexCode) +
        (bmiCoefficient * params.bmi) +
        (ageCoefficient * params.age);

      return intercept + (scaleA * Math.exp(exponent));
    }

    if (estimator.model === 'PolynomialRegression') {
      const ageCoefficient = this.getCoefficient(estimator.coefficients, ['age_years', 'age']);
      const sexCoefficient = this.getCoefficient(estimator.coefficients, ['sex', 'sex_code']);
      const bmiCoefficient = this.getCoefficient(estimator.coefficients, ['bmi', 'BMI']);
      const ageSquaredCoefficient = this.getCoefficient(estimator.coefficients, [
        'age_years^2',
        'age_squared',
      ]);
      const ageSexCoefficient = this.getCoefficient(estimator.coefficients, [
        'age_years sex',
        'age_sex',
      ]);
      const ageBmiCoefficient = this.getCoefficient(estimator.coefficients, [
        'age_years bmi',
        'age_bmi',
      ]);
      const sexSquaredCoefficient = this.getCoefficient(estimator.coefficients, [
        'sex^2',
        'sex_squared',
      ]);
      const sexBmiCoefficient = this.getCoefficient(estimator.coefficients, [
        'sex bmi',
        'sex_bmi',
      ]);
      const bmiSquaredCoefficient = this.getCoefficient(estimator.coefficients, [
        'bmi^2',
        'bmi_squared',
      ]);

      return intercept +
        (ageCoefficient * params.age) +
        (sexCoefficient * params.sexCode) +
        (bmiCoefficient * params.bmi) +
        (ageSquaredCoefficient * Math.pow(params.age, 2)) +
        (ageSexCoefficient * params.age * params.sexCode) +
        (ageBmiCoefficient * params.age * params.bmi) +
        (sexSquaredCoefficient * Math.pow(params.sexCode, 2)) +
        (sexBmiCoefficient * params.sexCode * params.bmi) +
        (bmiSquaredCoefficient * Math.pow(params.bmi, 2));
    }

    return 0;
  }

  private getCoefficient(
    coefficients: ExerciseEstimatorCoefficientMap,
    keys: string | string[]
  ): number {
    const candidates = Array.isArray(keys) ? keys : [keys];
    for (const candidate of candidates) {
      const exactValue = coefficients[candidate];
      if (typeof exactValue === 'number' && Number.isFinite(exactValue)) {
        return exactValue;
      }
    }

    const normalizedCandidates = new Set(
      candidates.map((candidate) => this.normalizeCoefficientKey(candidate))
    );
    const entry = Object.entries(coefficients).find(([candidate]) =>
      normalizedCandidates.has(this.normalizeCoefficientKey(candidate))
    );
    if (!entry) {
      return 0;
    }

    const candidateValue = entry[1];
    return Number.isFinite(candidateValue) ? candidateValue : 0;
  }

  private normalizeCoefficientKey(rawKey: string): string {
    return String(rawKey ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  private async logEstimatorWorkout(
    category: ExerciseEstimatorCategory,
    estimatorId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const normalizedId = this.normalizeEstimatorId(estimatorId);
    if (!normalizedId) {
      return;
    }

    const samplesRef = collection(
      this.firestore,
      EXERCISE_ESTIMATOR_ROOT_COLLECTION,
      EXERCISE_ESTIMATOR_PARENT_DOC,
      category,
      normalizedId,
      EXERCISE_ESTIMATOR_WORKOUT_LOGS_COLLECTION
    );

    await addDoc(samplesRef, {
      ...payload,
      createdAt: serverTimestamp(),
    });
  }

  private sumScoreEntries(scoreMap: Record<string, number>, totalKey: string): number {
    return Object.entries(scoreMap).reduce((sum, [key, value]) => {
      if (key === totalKey) {
        return sum;
      }
      return sum + this.toNonNegativeNumber(value);
    }, 0);
  }

  private resolveScoreTotal(scoreMap: Record<string, number>, totalKey: string): number {
    const explicitTotal = this.toNonNegativeNumber(scoreMap[totalKey]);
    if (explicitTotal > 0) {
      return this.toWholeNumber(explicitTotal);
    }

    return this.toWholeNumber(this.sumScoreEntries(scoreMap, totalKey));
  }

  private scaleActualStrength(e1rm: number, userWeightKg: number): number {
    if (e1rm <= 0 || userWeightKg <= 0) {
      return 0;
    }
    return e1rm / Math.pow(userWeightKg, 0.67);
  }

  private resolveCardioPerformance(row: Record<string, unknown>): {
    timeMinutes: number;
    distanceMeters: number;
    speedMetersPerMinute: number;
    actualVo2Max: number;
  } {
    const timeMinutes = this.toNonNegativeNumber(
      row['time_minutes'] ?? row['time'] ?? row['minutes'] ?? row['duration']
    );
    const distanceMeters = this.toNonNegativeNumber(
      row['distance_meters'] ?? row['distance'] ?? row['meters']
    );
    const speedMetersPerMinute = timeMinutes > 0
      ? distanceMeters / timeMinutes
      : 0;
    const actualVo2Max = speedMetersPerMinute > 0
      ? this.toNonNegativeNumber(((speedMetersPerMinute * 12) - 504.9) / 44.73)
      : 0;

    return {
      timeMinutes,
      distanceMeters,
      speedMetersPerMinute,
      actualVo2Max,
    };
  }

  private resolveCardioExerciseType(row: Record<string, unknown>): string {
    return this.normalizeEstimatorId(
      String(
        row['exercise_type'] ??
        row['cardio_type'] ??
        row['exercise'] ??
        row['type'] ??
        ''
      )
    );
  }

  private resolveWeightKg(value: unknown, fallbackBodyweightKg = 0): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }

    const text = String(value ?? '').trim().toLowerCase();
    if (text.includes('body')) {
      return fallbackBodyweightKg > 0 ? fallbackBodyweightKg : 0;
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

  private normalizeExpectedEffort(
    value: unknown,
    legacyStrengthScores?: unknown
  ): ExpectedEffortMap {
    const expectedEffort = value && typeof value === 'object'
      ? value as Record<string, unknown>
      : {};

    return {
      Cardio: this.toNumberMap(expectedEffort['Cardio']),
      Strength: this.toNumberMap(expectedEffort['Strength'] ?? legacyStrengthScores),
    };
  }

  private toNumberMap(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
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

  private getEstimatorDocRef(category: ExerciseEstimatorCategory, estimatorId: string) {
    return doc(
      this.firestore,
      EXERCISE_ESTIMATOR_ROOT_COLLECTION,
      EXERCISE_ESTIMATOR_PARENT_DOC,
      category,
      estimatorId
    );
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
