export type ExerciseEstimatorModel =
  'WeightedLeastSquares' |
  'ExponentialRegression' |
  'PolynomialRegression' |
  'NONE';

export type ExerciseEstimatorCategory = 'Strength' | 'Cardio';

export const EXERCISE_ESTIMATOR_ROOT_COLLECTION = 'exercise_estimators';
export const EXERCISE_ESTIMATOR_PARENT_DOC = 'default';
export const EXERCISE_ESTIMATOR_STRENGTH_CATEGORY: ExerciseEstimatorCategory = 'Strength';
export const EXERCISE_ESTIMATOR_CARDIO_CATEGORY: ExerciseEstimatorCategory = 'Cardio';
export const EXERCISE_ESTIMATOR_WORKOUT_LOGS_COLLECTION = 'workout_logs';

export type ExerciseEstimatorCoefficientMap = Record<string, number>;

export interface ExerciseEstimatorDoc {
  model: ExerciseEstimatorModel;
  coefficients: ExerciseEstimatorCoefficientMap;
}

export interface ExerciseEstimatorSeedDoc extends ExerciseEstimatorDoc {
  id: string;
}
