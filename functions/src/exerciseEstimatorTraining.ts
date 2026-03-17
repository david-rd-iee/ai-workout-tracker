import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const WORKOUT_LOGS_COLLECTION = "workout_logs";
const DEFAULT_PARENT_DOC = "default";
const CARDIO_CATEGORY = "Cardio";
const STRENGTH_CATEGORY = "Strength";
const STANDARD_RETRAIN_INTERVAL = 50;
const EXTENDED_RETRAIN_INTERVAL = 100;
const CROSS_VALIDATION_FOLD_COUNT = 5;
const RIDGE_LAMBDA = 1;
const MINIMUM_VALID_SAMPLE_COUNT = 12;
const SPECIAL_INTERVAL_EXERCISES = new Set(["generic_cardio", "scaled_strength"]);
const NUMERIC_EPSILON = 1e-8;

type ExerciseEstimatorCategory = typeof CARDIO_CATEGORY | typeof STRENGTH_CATEGORY;
type TargetField = "actual_one_rep_max" | "actual_scaled_strength" | "actual_vo2_max";
type SupportedModelName =
  | "LinearRegression"
  | "RidgeRegression"
  | "WeightedLeastSquares"
  | "GeneralizedLeastSquares"
  | "PolynomialRegression"
  | "LogLinearRegression"
  | "PowerLawRegression"
  | "ExponentialRegression";

interface TrainingSample {
  age: number;
  bmi: number;
  sex: number;
  target: number;
}

interface RegressionMetrics {
  rmse: number;
  mae: number;
  rSquared: number;
}

interface FittedModel {
  model: SupportedModelName;
  coefficients: Record<string, number>;
  predict: (sample: TrainingSample) => number;
}

interface RankedModel extends RegressionMetrics {
  fit: FittedModel;
  cvRmse: number;
  cvMae: number;
}

interface RegressionCandidate {
  name: SupportedModelName;
  fit: (samples: TrainingSample[]) => FittedModel | null;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return typeof parsed === "number" && parsed > 0 ? parsed : null;
}

function toPositiveLog(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? Math.log(value) : null;
}

function clampPrediction(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function roundMetric(value: number): number {
  return Math.round((Number(value) || 0) * 1_000_000) / 1_000_000;
}

function resolveTargetField(
  category: ExerciseEstimatorCategory,
  exerciseId: string
): TargetField {
  if (exerciseId === "scaled_strength") {
    return "actual_scaled_strength";
  }

  return category === CARDIO_CATEGORY
    ? "actual_vo2_max"
    : "actual_one_rep_max";
}

function resolveRetrainInterval(exerciseId: string): number {
  return SPECIAL_INTERVAL_EXERCISES.has(exerciseId)
    ? EXTENDED_RETRAIN_INTERVAL
    : STANDARD_RETRAIN_INTERVAL;
}

function normalizeSexValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  const text = String(value ?? "").trim().toLowerCase();
  if (!text) {
    return null;
  }

  if (text === "male" || text === "m") {
    return 1;
  }
  if (text === "female" || text === "f") {
    return 2;
  }
  if (text === "nonbinary" || text === "non-binary" || text === "nb" || text === "other") {
    return 1.5;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeTrainingSample(
  raw: Record<string, unknown>,
  targetField: TargetField
): TrainingSample | null {
  const age = toPositiveNumber(raw["age"]);
  const bmi = toPositiveNumber(raw["bmi"]);
  const sex = normalizeSexValue(raw["sex"]);
  const target = toPositiveNumber(raw[targetField]);

  if (
    typeof age !== "number" ||
    typeof bmi !== "number" ||
    typeof sex !== "number" ||
    typeof target !== "number"
  ) {
    return null;
  }

  return {
    age,
    bmi,
    sex,
    target,
  };
}

function createZeroMatrix(size: number): number[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length;
  const a = matrix.map((row) => [...row]);
  const b = [...vector];

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let maxRowIndex = pivotIndex;
    let maxAbsValue = Math.abs(a[pivotIndex][pivotIndex] ?? 0);

    for (let candidateIndex = pivotIndex + 1; candidateIndex < size; candidateIndex += 1) {
      const candidateAbsValue = Math.abs(a[candidateIndex][pivotIndex] ?? 0);
      if (candidateAbsValue > maxAbsValue) {
        maxAbsValue = candidateAbsValue;
        maxRowIndex = candidateIndex;
      }
    }

    if (maxAbsValue <= NUMERIC_EPSILON) {
      return null;
    }

    if (maxRowIndex !== pivotIndex) {
      [a[pivotIndex], a[maxRowIndex]] = [a[maxRowIndex], a[pivotIndex]];
      [b[pivotIndex], b[maxRowIndex]] = [b[maxRowIndex], b[pivotIndex]];
    }

    for (let rowIndex = pivotIndex + 1; rowIndex < size; rowIndex += 1) {
      const factor = (a[rowIndex][pivotIndex] ?? 0) / (a[pivotIndex][pivotIndex] ?? 1);
      if (Math.abs(factor) <= NUMERIC_EPSILON) {
        continue;
      }

      for (let columnIndex = pivotIndex; columnIndex < size; columnIndex += 1) {
        a[rowIndex][columnIndex] -= factor * (a[pivotIndex][columnIndex] ?? 0);
      }
      b[rowIndex] -= factor * b[pivotIndex];
    }
  }

  const solution = Array.from({ length: size }, () => 0);
  for (let rowIndex = size - 1; rowIndex >= 0; rowIndex -= 1) {
    let sum = b[rowIndex];
    for (let columnIndex = rowIndex + 1; columnIndex < size; columnIndex += 1) {
      sum -= (a[rowIndex][columnIndex] ?? 0) * solution[columnIndex];
    }

    const pivot = a[rowIndex][rowIndex] ?? 0;
    if (Math.abs(pivot) <= NUMERIC_EPSILON) {
      return null;
    }

    solution[rowIndex] = sum / pivot;
  }

  return solution.map((entry) => (Math.abs(entry) <= NUMERIC_EPSILON ? 0 : entry));
}

function solveRegression(
  features: number[][],
  targets: number[],
  weights?: number[],
  ridgeLambda = 0
): number[] | null {
  if (features.length === 0 || targets.length !== features.length) {
    return null;
  }

  const featureCount = features[0]?.length ?? 0;
  if (featureCount === 0) {
    return null;
  }

  const normalMatrix = createZeroMatrix(featureCount);
  const rightHandSide = Array.from({ length: featureCount }, () => 0);

  for (let sampleIndex = 0; sampleIndex < features.length; sampleIndex += 1) {
    const row = features[sampleIndex];
    const target = targets[sampleIndex];
    const weight = Math.max(weights?.[sampleIndex] ?? 1, NUMERIC_EPSILON);

    for (let leftIndex = 0; leftIndex < featureCount; leftIndex += 1) {
      const leftValue = row[leftIndex] ?? 0;
      rightHandSide[leftIndex] += weight * leftValue * target;

      for (let rightIndex = 0; rightIndex < featureCount; rightIndex += 1) {
        normalMatrix[leftIndex][rightIndex] += weight * leftValue * (row[rightIndex] ?? 0);
      }
    }
  }

  if (ridgeLambda > 0) {
    for (let diagonalIndex = 1; diagonalIndex < featureCount; diagonalIndex += 1) {
      normalMatrix[diagonalIndex][diagonalIndex] += ridgeLambda;
    }
  }

  const directSolution = solveLinearSystem(normalMatrix, rightHandSide);
  if (directSolution) {
    return directSolution;
  }

  if (ridgeLambda <= 0) {
    const stabilizedMatrix = normalMatrix.map((row) => [...row]);
    for (let diagonalIndex = 0; diagonalIndex < featureCount; diagonalIndex += 1) {
      stabilizedMatrix[diagonalIndex][diagonalIndex] += NUMERIC_EPSILON;
    }
    return solveLinearSystem(stabilizedMatrix, rightHandSide);
  }

  return null;
}

function calculateMetrics(samples: TrainingSample[], predict: (sample: TrainingSample) => number): RegressionMetrics {
  if (samples.length === 0) {
    return {
      rmse: 0,
      mae: 0,
      rSquared: 0,
    };
  }

  const meanTarget = samples.reduce((sum, sample) => sum + sample.target, 0) / samples.length;
  let squaredErrorSum = 0;
  let absoluteErrorSum = 0;
  let totalVariance = 0;

  for (const sample of samples) {
    const prediction = clampPrediction(predict(sample));
    const residual = sample.target - prediction;
    squaredErrorSum += residual * residual;
    absoluteErrorSum += Math.abs(residual);

    const centeredTarget = sample.target - meanTarget;
    totalVariance += centeredTarget * centeredTarget;
  }

  const rmse = Math.sqrt(squaredErrorSum / samples.length);
  const mae = absoluteErrorSum / samples.length;
  const rSquared = totalVariance <= NUMERIC_EPSILON
    ? (squaredErrorSum <= NUMERIC_EPSILON ? 1 : 0)
    : 1 - (squaredErrorSum / totalVariance);

  return {
    rmse,
    mae,
    rSquared,
  };
}

function calculateCrossValidationMetrics(
  samples: TrainingSample[],
  candidate: RegressionCandidate
): { cvRmse: number; cvMae: number } | null {
  if (samples.length < 2) {
    return null;
  }

  const foldCount = Math.min(CROSS_VALIDATION_FOLD_COUNT, samples.length);
  let squaredErrorSum = 0;
  let absoluteErrorSum = 0;
  let validationCount = 0;

  for (let foldIndex = 0; foldIndex < foldCount; foldIndex += 1) {
    const trainingSamples = samples.filter((_, index) => index % foldCount !== foldIndex);
    const validationSamples = samples.filter((_, index) => index % foldCount === foldIndex);

    if (trainingSamples.length === 0 || validationSamples.length === 0) {
      continue;
    }

    const fit = candidate.fit(trainingSamples);
    if (!fit) {
      return null;
    }

    for (const sample of validationSamples) {
      const prediction = clampPrediction(fit.predict(sample));
      const residual = sample.target - prediction;
      squaredErrorSum += residual * residual;
      absoluteErrorSum += Math.abs(residual);
      validationCount += 1;
    }
  }

  if (validationCount === 0) {
    return null;
  }

  return {
    cvRmse: Math.sqrt(squaredErrorSum / validationCount),
    cvMae: absoluteErrorSum / validationCount,
  };
}

function buildLinearFeatures(sample: TrainingSample): number[] {
  return [1, sample.sex, sample.bmi, sample.age];
}

function buildPolynomialFeatures(sample: TrainingSample): number[] {
  return [
    1,
    sample.age,
    sample.sex,
    sample.bmi,
    sample.age ** 2,
    sample.age * sample.sex,
    sample.age * sample.bmi,
    sample.sex ** 2,
    sample.sex * sample.bmi,
    sample.bmi ** 2,
  ];
}

function buildLogFeatures(sample: TrainingSample): number[] | null {
  const logSex = toPositiveLog(sample.sex);
  const logBmi = toPositiveLog(sample.bmi);
  const logAge = toPositiveLog(sample.age);

  if (
    typeof logSex !== "number" ||
    typeof logBmi !== "number" ||
    typeof logAge !== "number"
  ) {
    return null;
  }

  return [1, logSex, logBmi, logAge];
}

function fitLinearLikeModel(
  samples: TrainingSample[],
  modelName: SupportedModelName,
  options?: {
    ridgeLambda?: number;
    weights?: number[];
  }
): FittedModel | null {
  const features = samples.map(buildLinearFeatures);
  const targets = samples.map((sample) => sample.target);
  const coefficients = solveRegression(
    features,
    targets,
    options?.weights,
    options?.ridgeLambda ?? 0
  );

  if (!coefficients || coefficients.length < 4) {
    return null;
  }

  const [intercept, sexCoefficient, bmiCoefficient, ageCoefficient] = coefficients;
  const predict = (sample: TrainingSample) => clampPrediction(
    intercept +
      (sexCoefficient * sample.sex) +
      (bmiCoefficient * sample.bmi) +
      (ageCoefficient * sample.age)
  );

  return {
    model: modelName,
    coefficients: {
      intercept,
      sex_code: sexCoefficient,
      bmi: bmiCoefficient,
      age: ageCoefficient,
    },
    predict,
  };
}

function fitLinearRegression(samples: TrainingSample[]): FittedModel | null {
  return fitLinearLikeModel(samples, "LinearRegression");
}

function fitRidgeRegression(samples: TrainingSample[]): FittedModel | null {
  return fitLinearLikeModel(samples, "RidgeRegression", {
    ridgeLambda: RIDGE_LAMBDA,
  });
}

function fitWeightedLeastSquares(samples: TrainingSample[]): FittedModel | null {
  const weights = samples.map((sample) => 1 / Math.max(sample.target, 1));
  return fitLinearLikeModel(samples, "WeightedLeastSquares", { weights });
}

function fitGeneralizedLeastSquares(samples: TrainingSample[]): FittedModel | null {
  const baseline = fitLinearRegression(samples);
  if (!baseline) {
    return null;
  }

  const weights = samples.map((sample) => {
    const residual = sample.target - baseline.predict(sample);
    return 1 / Math.max((residual * residual), 1);
  });

  return fitLinearLikeModel(samples, "GeneralizedLeastSquares", { weights });
}

function fitPolynomialRegression(samples: TrainingSample[]): FittedModel | null {
  const features = samples.map(buildPolynomialFeatures);
  const targets = samples.map((sample) => sample.target);
  const coefficients = solveRegression(features, targets);

  if (!coefficients || coefficients.length < 10) {
    return null;
  }

  const [
    intercept,
    ageCoefficient,
    sexCoefficient,
    bmiCoefficient,
    ageSquaredCoefficient,
    ageSexCoefficient,
    ageBmiCoefficient,
    sexSquaredCoefficient,
    sexBmiCoefficient,
    bmiSquaredCoefficient,
  ] = coefficients;

  const predict = (sample: TrainingSample) => clampPrediction(
    intercept +
      (ageCoefficient * sample.age) +
      (sexCoefficient * sample.sex) +
      (bmiCoefficient * sample.bmi) +
      (ageSquaredCoefficient * (sample.age ** 2)) +
      (ageSexCoefficient * sample.age * sample.sex) +
      (ageBmiCoefficient * sample.age * sample.bmi) +
      (sexSquaredCoefficient * (sample.sex ** 2)) +
      (sexBmiCoefficient * sample.sex * sample.bmi) +
      (bmiSquaredCoefficient * (sample.bmi ** 2))
  );

  return {
    model: "PolynomialRegression",
    coefficients: {
      intercept,
      age_years: ageCoefficient,
      sex: sexCoefficient,
      bmi: bmiCoefficient,
      "age_years^2": ageSquaredCoefficient,
      "age_years sex": ageSexCoefficient,
      "age_years bmi": ageBmiCoefficient,
      "sex^2": sexSquaredCoefficient,
      "sex bmi": sexBmiCoefficient,
      "bmi^2": bmiSquaredCoefficient,
    },
    predict,
  };
}

function fitLogLinearRegression(samples: TrainingSample[]): FittedModel | null {
  const features = samples.map(buildLogFeatures);
  if (features.some((entry) => !entry)) {
    return null;
  }

  const targets = samples.map((sample) => sample.target);
  const coefficients = solveRegression(features as number[][], targets);
  if (!coefficients || coefficients.length < 4) {
    return null;
  }

  const [intercept, logSexCoefficient, logBmiCoefficient, logAgeCoefficient] = coefficients;
  const predict = (sample: TrainingSample) => {
    const logFeatures = buildLogFeatures(sample);
    if (!logFeatures) {
      return 0;
    }

    return clampPrediction(
      intercept +
        (logSexCoefficient * logFeatures[1]) +
        (logBmiCoefficient * logFeatures[2]) +
        (logAgeCoefficient * logFeatures[3])
    );
  };

  return {
    model: "LogLinearRegression",
    coefficients: {
      intercept,
      log_sex_code: logSexCoefficient,
      log_bmi: logBmiCoefficient,
      log_age: logAgeCoefficient,
    },
    predict,
  };
}

function fitPowerLawRegression(samples: TrainingSample[]): FittedModel | null {
  const features = samples.map(buildLogFeatures);
  if (features.some((entry) => !entry)) {
    return null;
  }

  const transformedTargets = samples.map((sample) => toPositiveLog(sample.target));
  if (transformedTargets.some((entry) => typeof entry !== "number")) {
    return null;
  }

  const coefficients = solveRegression(
    features as number[][],
    transformedTargets as number[]
  );
  if (!coefficients || coefficients.length < 4) {
    return null;
  }

  const [logScale, sexExponent, bmiExponent, ageExponent] = coefficients;
  const scaleA = Math.exp(logScale);
  const predict = (sample: TrainingSample) => {
    const logFeatures = buildLogFeatures(sample);
    if (!logFeatures) {
      return 0;
    }

    const exponent =
      (sexExponent * logFeatures[1]) +
      (bmiExponent * logFeatures[2]) +
      (ageExponent * logFeatures[3]);

    return clampPrediction(scaleA * Math.exp(exponent));
  };

  return {
    model: "PowerLawRegression",
    coefficients: {
      intercept: 0,
      scale_a: scaleA,
      sex_exponent: sexExponent,
      bmi_exponent: bmiExponent,
      age_exponent: ageExponent,
    },
    predict,
  };
}

function fitExponentialRegression(samples: TrainingSample[]): FittedModel | null {
  const features = samples.map(buildLinearFeatures);
  const transformedTargets = samples.map((sample) => toPositiveLog(sample.target));
  if (transformedTargets.some((entry) => typeof entry !== "number")) {
    return null;
  }

  const coefficients = solveRegression(
    features,
    transformedTargets as number[]
  );
  if (!coefficients || coefficients.length < 4) {
    return null;
  }

  const [logScale, sexCoefficient, bmiCoefficient, ageCoefficient] = coefficients;
  const scaleA = Math.exp(logScale);
  const predict = (sample: TrainingSample) => clampPrediction(
    scaleA * Math.exp(
      (sexCoefficient * sample.sex) +
      (bmiCoefficient * sample.bmi) +
      (ageCoefficient * sample.age)
    )
  );

  return {
    model: "ExponentialRegression",
    coefficients: {
      intercept: 0,
      scale_a: scaleA,
      sex_code: sexCoefficient,
      bmi: bmiCoefficient,
      age: ageCoefficient,
    },
    predict,
  };
}

const MODEL_CANDIDATES: RegressionCandidate[] = [
  { name: "LinearRegression", fit: fitLinearRegression },
  { name: "RidgeRegression", fit: fitRidgeRegression },
  { name: "WeightedLeastSquares", fit: fitWeightedLeastSquares },
  { name: "GeneralizedLeastSquares", fit: fitGeneralizedLeastSquares },
  { name: "PolynomialRegression", fit: fitPolynomialRegression },
  { name: "LogLinearRegression", fit: fitLogLinearRegression },
  { name: "PowerLawRegression", fit: fitPowerLawRegression },
  { name: "ExponentialRegression", fit: fitExponentialRegression },
];

function rankModels(samples: TrainingSample[]): RankedModel[] {
  const rankedModels: RankedModel[] = [];

  for (const candidate of MODEL_CANDIDATES) {
    const fit = candidate.fit(samples);
    if (!fit) {
      continue;
    }

    const metrics = calculateMetrics(samples, fit.predict);
    const crossValidationMetrics = calculateCrossValidationMetrics(samples, candidate);
    if (!crossValidationMetrics) {
      continue;
    }

    rankedModels.push({
      fit,
      rmse: metrics.rmse,
      mae: metrics.mae,
      rSquared: metrics.rSquared,
      cvRmse: crossValidationMetrics.cvRmse,
      cvMae: crossValidationMetrics.cvMae,
    });
  }

  return rankedModels.sort((left, right) => {
    if (left.cvRmse !== right.cvRmse) {
      return left.cvRmse - right.cvRmse;
    }
    if (left.rmse !== right.rmse) {
      return left.rmse - right.rmse;
    }
    if (left.rSquared !== right.rSquared) {
      return right.rSquared - left.rSquared;
    }
    return MODEL_CANDIDATES.findIndex((candidate) => candidate.name === left.fit.model) -
      MODEL_CANDIDATES.findIndex((candidate) => candidate.name === right.fit.model);
  });
}

async function reserveTrainingWindow(
  estimatorRef: admin.firestore.DocumentReference,
  totalLogs: number,
  threshold: number,
  targetField: TargetField
): Promise<boolean> {
  return db.runTransaction(async (transaction) => {
    const estimatorSnap = await transaction.get(estimatorRef);
    const estimatorData = estimatorSnap.data() as Record<string, unknown> | undefined;
    const trainingMetadata = (
      estimatorData?.["trainingMetadata"] &&
      typeof estimatorData["trainingMetadata"] === "object"
    )
      ? estimatorData["trainingMetadata"] as Record<string, unknown>
      : {};
    const latestTrainedSampleCount = toFiniteNumber(
      trainingMetadata["latestTrainedSampleCount"]
    ) ?? 0;

    if (latestTrainedSampleCount >= totalLogs) {
      return false;
    }

    transaction.set(
      estimatorRef,
      {
        trainingMetadata: {
          status: "training",
          threshold,
          targetField,
          pendingSampleCount: totalLogs,
          startedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );

    return true;
  });
}

export const retrainExerciseEstimatorOnWorkoutLogCreate = onDocumentCreated(
  `exercise_estimators/${DEFAULT_PARENT_DOC}/{category}/{exerciseId}/${WORKOUT_LOGS_COLLECTION}/{logId}`,
  async (event) => {
    const rawCategory = String(event.params.category ?? "").trim();
    const exerciseId = String(event.params.exerciseId ?? "").trim();

    if (
      rawCategory !== CARDIO_CATEGORY &&
      rawCategory !== STRENGTH_CATEGORY
    ) {
      logger.warn("[ExerciseEstimatorTraining] Skipping unknown category.", {
        category: rawCategory,
        exerciseId,
      });
      return;
    }

    if (!exerciseId) {
      logger.warn("[ExerciseEstimatorTraining] Skipping missing exercise id.");
      return;
    }

    const category = rawCategory as ExerciseEstimatorCategory;
    const estimatorRef = db.doc(
      `exercise_estimators/${DEFAULT_PARENT_DOC}/${category}/${exerciseId}`
    );
    const workoutLogsRef = estimatorRef.collection(WORKOUT_LOGS_COLLECTION);
    const threshold = resolveRetrainInterval(exerciseId);
    const targetField = resolveTargetField(category, exerciseId);

    const countSnapshot = await workoutLogsRef.count().get();
    const totalLogs = Number(countSnapshot.data().count ?? 0);

    if (totalLogs <= 0 || totalLogs % threshold !== 0) {
      return;
    }

    const reserved = await reserveTrainingWindow(
      estimatorRef,
      totalLogs,
      threshold,
      targetField
    );
    if (!reserved) {
      return;
    }

    try {
      const workoutLogsSnapshot = await workoutLogsRef.get();
      const orderedDocs = [...workoutLogsSnapshot.docs].sort((left, right) =>
        left.id.localeCompare(right.id)
      );
      const validSamples = orderedDocs
        .map((docSnap) => normalizeTrainingSample(docSnap.data() as Record<string, unknown>, targetField))
        .filter((sample): sample is TrainingSample => !!sample);
      const invalidSampleCount = totalLogs - validSamples.length;

      if (validSamples.length < MINIMUM_VALID_SAMPLE_COUNT) {
        await estimatorRef.set(
          {
            trainingMetadata: {
              status: "insufficient_valid_samples",
              threshold,
              targetField,
              latestTrainedSampleCount: totalLogs,
              totalLogCount: totalLogs,
              validSampleCount: validSamples.length,
              invalidSampleCount,
              completedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          },
          { merge: true }
        );
        return;
      }

      const rankedModels = rankModels(validSamples);
      const bestModel = rankedModels[0];

      if (!bestModel) {
        await estimatorRef.set(
          {
            trainingMetadata: {
              status: "no_fit",
              threshold,
              targetField,
              latestTrainedSampleCount: totalLogs,
              totalLogCount: totalLogs,
              validSampleCount: validSamples.length,
              invalidSampleCount,
              completedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          },
          { merge: true }
        );
        return;
      }

      await estimatorRef.set(
        {
          model: bestModel.fit.model,
          coefficients: bestModel.fit.coefficients,
          trainingMetadata: {
            status: "ready",
            threshold,
            targetField,
            latestTrainedSampleCount: totalLogs,
            totalLogCount: totalLogs,
            validSampleCount: validSamples.length,
            invalidSampleCount,
            selectionMetric: "cross_validated_rmse",
            crossValidationFolds: Math.min(CROSS_VALIDATION_FOLD_COUNT, validSamples.length),
            cvRmse: roundMetric(bestModel.cvRmse),
            cvMae: roundMetric(bestModel.cvMae),
            rmse: roundMetric(bestModel.rmse),
            mae: roundMetric(bestModel.mae),
            rSquared: roundMetric(bestModel.rSquared),
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );

      logger.info("[ExerciseEstimatorTraining] Estimator retrained.", {
        category,
        exerciseId,
        model: bestModel.fit.model,
        targetField,
        totalLogs,
        validSamples: validSamples.length,
        cvRmse: roundMetric(bestModel.cvRmse),
      });
    } catch (error) {
      logger.error("[ExerciseEstimatorTraining] Failed to retrain estimator.", {
        category,
        exerciseId,
        targetField,
        totalLogs,
        error,
      });

      await estimatorRef.set(
        {
          trainingMetadata: {
            status: "failed",
            threshold,
            targetField,
            latestTrainedSampleCount: totalLogs,
            totalLogCount: totalLogs,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastError:
              error instanceof Error
                ? error.message
                : String(error),
          },
        },
        { merge: true }
      );
    }
  }
);
