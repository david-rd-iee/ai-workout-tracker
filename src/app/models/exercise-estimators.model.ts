export type ExerciseEstimatorModel = 'WeightedLeastSquares' | 'ExponentialRegression';

export type ExerciseEstimatorCoefficientMap = Record<string, number>;

export interface ExerciseEstimatorDoc {
  model: ExerciseEstimatorModel;
  coefficients: ExerciseEstimatorCoefficientMap;
}

export interface ExerciseEstimatorSeedDoc extends ExerciseEstimatorDoc {
  id: string;
}
