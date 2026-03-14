import { Injectable } from '@angular/core';
import {
  Firestore,
} from '@angular/fire/firestore';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import { ExerciseEstimatorCoefficientMap, ExerciseEstimatorSeedDoc } from '../models/exercise-estimators.model';

const DEFAULT_EXERCISE_ESTIMATORS: ExerciseEstimatorSeedDoc[] = [
  {
    id: 'barbell_back_squat',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 134.0162235696616,
      sex_code: -44.484532088436936,
      bmi: 4.536633474112881,
      age: -1.49939249657599,
    },
  },
  {
    id: 'barbell_row',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 78.51284957106651,
      sex_code: -23.889499569716254,
      bmi: 2.806871724507872,
      age: -0.9332825860403384,
    },
  },
  {
    id: 'bench_press',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 88.12096888142138,
      sex_code: -34.867416837221995,
      bmi: 2.7917038090385624,
      age: -0.8237387785168938,
    },
  },
  {
    id: 'bicep_curl',
    model: 'ExponentialRegression',
    coefficients: {
      intercept: 3.3078194484193406,
      scale_a: 27.325475851441187,
      sex_code: -0.6524401049042372,
      bmi: 0.04383390366290067,
      age: -0.015338168600449988,
    },
  },
  {
    id: 'deadlift',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 133.84130367430672,
      sex_code: -43.57188225071672,
      bmi: 5.219311761638274,
      age: -1.6728114073896978,
    },
  },
  {
    id: 'dips',
    model: 'ExponentialRegression',
    coefficients: {
      intercept: 4.5446811986642555,
      scale_a: 94.13041352389389,
      sex_code: -0.6735282081745626,
      bmi: 0.04610385365273445,
      age: -0.01665518336660798,
    },
  },
  {
    id: 'hanging_leg_raise',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 19.262269031658885,
      sex_code: -7.645071425492178,
      bmi: 0.5855051199626555,
      age: -0.17703124956943733,
    },
  },
  {
    id: 'hip_thrust',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 170.8633354435145,
      sex_code: -61.1598362495083,
      bmi: 6.092439929008098,
      age: -1.9144768616618988,
    },
  },
  {
    id: 'incline_bench_press',
    model: 'ExponentialRegression',
    coefficients: {
      intercept: 4.698453478001911,
      scale_a: 109.7772681455362,
      sex_code: -0.708553410486903,
      bmi: 0.04624194864788072,
      age: -0.016609744067653625,
    },
  },
  {
    id: 'kettlebell_swing',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 48.03204333832839,
      sex_code: -16.634617713991215,
      bmi: 1.9421226782036534,
      age: -0.6085237612740128,
    },
  },
  {
    id: 'lat_pulldown',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 68.33202191310261,
      sex_code: -22.06565540721432,
      bmi: 2.5957254413426885,
      age: -0.8537310213517274,
    },
  },
  {
    id: 'leg_press',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 221.34320657459222,
      sex_code: -73.57206185655748,
      bmi: 7.451863566052357,
      age: -2.4469397112879174,
    },
  },
  {
    id: 'lunges',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 44.418833783109996,
      sex_code: -14.796304043988147,
      bmi: 1.7790126903555001,
      age: -0.5430193840196503,
    },
  },
  {
    id: 'overhead_press',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 55.62211368555324,
      sex_code: -22.584546865489184,
      bmi: 1.8076815303031368,
      age: -0.5471844547655839,
    },
  },
  {
    id: 'plank',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 28.24039196161647,
      sex_code: -10.960656293870567,
      bmi: 0.8937161608312403,
      age: -0.2863880653689597,
    },
  },
  {
    id: 'pull-ups',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 45.45994867813691,
      sex_code: -12.798984230230833,
      bmi: 1.919943711189593,
      age: -0.6113751039019191,
    },
  },
  {
    id: 'push-up',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 60.30246351757239,
      sex_code: -23.470559493439037,
      bmi: 1.8037837869689815,
      age: -0.5680465283873071,
    },
  },
  {
    id: 'romanian_deadlift',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 116.99898275681642,
      sex_code: -38.347857107599175,
      bmi: 4.22640756046019,
      age: -1.3617976278952417,
    },
  },
  {
    id: 'seated_cable_row',
    model: 'WeightedLeastSquares',
    coefficients: {
      intercept: 67.75606515153596,
      sex_code: -19.063154671478483,
      bmi: 2.337845152771502,
      age: -0.808675850196091,
    },
  },
  {
    id: 'scaled_strength',
    model: 'ExponentialRegression',
    coefficients: {
      intercept: 1.930023505437541,
      scale_a: 6.8896721844372255,
      sex_code: -0.4158373373611672,
      BMI: 0.02245514366927598,
      age: -0.015484345713830469,
    },
  },
];

@Injectable({
  providedIn: 'root',
})
export class ExerciseEstimatorsService {
  private initPromise: Promise<void> | null = null;
  private estimatorIdsCache: string[] | null = null;
  private estimatorIdsLoadPromise: Promise<string[]> | null = null;
  private static readonly ESTIMATOR_IDS_INDEX_COLLECTION = 'systemConfig';
  private static readonly ESTIMATOR_IDS_INDEX_DOC = 'exercise_estimators_index';

  constructor(private firestore: Firestore) {}

  ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.seedMissingEstimatorDocs()
        .then(() => this.listEstimatorIds())
        .then(() => undefined);
    }

    return this.initPromise;
  }

  async listEstimatorIds(forceRefresh = false): Promise<string[]> {
    if (!forceRefresh && this.estimatorIdsCache) {
      return [...(this.estimatorIdsCache ?? [])];
    }

    if (!forceRefresh && this.estimatorIdsLoadPromise) {
      return [...(await this.estimatorIdsLoadPromise)];
    }

    this.estimatorIdsLoadPromise = this.loadEstimatorIdsFromIndexOrCollection();
    try {
      const ids = await this.estimatorIdsLoadPromise;
      this.estimatorIdsCache = ids;
      return [...ids];
    } finally {
      this.estimatorIdsLoadPromise = null;
    }
  }

  getCachedEstimatorIds(): string[] {
    return [...(this.estimatorIdsCache ?? [])];
  }

  normalizeEstimatorId(rawId: string): string {
    return String(rawId ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');
  }

  async ensureEstimatorDocExists(rawId: string): Promise<string> {
    const estimatorId = this.normalizeEstimatorId(rawId);
    if (!estimatorId) {
      throw new Error('Estimator ID cannot be empty');
    }

    const estimatorRef = doc(this.firestore, 'exercise_estimators', estimatorId);
    const estimatorSnap = await getDoc(estimatorRef);

    if (!estimatorSnap.exists()) {
      await setDoc(estimatorRef, {
        model: 'NONE',
        coefficients: {},
        isUserDefined: true,
        createdBy: 'workout_chatbot',
      });
    }

    await this.upsertEstimatorIdsIndex([estimatorId]);
    this.addEstimatorIdToLocalCache(estimatorId);

    return estimatorId;
  }

  private async seedMissingEstimatorDocs(): Promise<void> {
    const seededIds: string[] = [];
    for (const estimator of DEFAULT_EXERCISE_ESTIMATORS) {
      const estimatorRef = doc(this.firestore, 'exercise_estimators', estimator.id);
      const estimatorSnap = await getDoc(estimatorRef);
      seededIds.push(estimator.id);

      if (!estimatorSnap.exists()) {
        await setDoc(estimatorRef, {
          model: estimator.model,
          coefficients: estimator.coefficients,
        });
        continue;
      }

      const existingData = estimatorSnap.data();
      const migratedCoefficients = this.toCoefficientMap(existingData?.['coefficients']);

      if (migratedCoefficients) {
        await setDoc(
          estimatorRef,
          {
            coefficients: migratedCoefficients,
          },
          { merge: true },
        );
      }
    }

    await this.upsertEstimatorIdsIndex(seededIds);
    this.estimatorIdsCache = null;
  }

  private async loadEstimatorIdsFromIndexOrCollection(): Promise<string[]> {
    const indexRef = doc(
      this.firestore,
      ExerciseEstimatorsService.ESTIMATOR_IDS_INDEX_COLLECTION,
      ExerciseEstimatorsService.ESTIMATOR_IDS_INDEX_DOC
    );

    try {
      const indexSnap = await getDoc(indexRef);
      if (indexSnap.exists()) {
        const ids = this.normalizeEstimatorIdArray(indexSnap.data()?.['ids']);
        if (ids.length > 0) {
          return ids;
        }
      }
    } catch (error) {
      console.warn('[ExerciseEstimatorsService] Failed to load estimator ID index:', error);
    }

    const snapshot = await getDocs(collection(this.firestore, 'exercise_estimators'));
    const ids = snapshot.docs.map((entry) => entry.id).sort((a, b) => a.localeCompare(b));
    await this.upsertEstimatorIdsIndex(ids);
    return ids;
  }

  private normalizeEstimatorIdArray(candidate: unknown): string[] {
    if (!Array.isArray(candidate)) {
      return [];
    }

    const ids = candidate
      .map((value) => this.normalizeEstimatorId(String(value ?? '')))
      .filter((value) => !!value);

    return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
  }

  private async upsertEstimatorIdsIndex(ids: string[]): Promise<void> {
    const normalizedIds = this.normalizeEstimatorIdArray(ids);
    if (normalizedIds.length === 0) {
      return;
    }

    const indexRef = doc(
      this.firestore,
      ExerciseEstimatorsService.ESTIMATOR_IDS_INDEX_COLLECTION,
      ExerciseEstimatorsService.ESTIMATOR_IDS_INDEX_DOC
    );

    await setDoc(
      indexRef,
      {
        ids: arrayUnion(...normalizedIds),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  private addEstimatorIdToLocalCache(estimatorId: string): void {
    const normalizedId = this.normalizeEstimatorId(estimatorId);
    if (!normalizedId) {
      return;
    }

    if (!this.estimatorIdsCache) {
      this.estimatorIdsCache = [normalizedId];
      return;
    }

    if (this.estimatorIdsCache.includes(normalizedId)) {
      return;
    }

    this.estimatorIdsCache = [...this.estimatorIdsCache, normalizedId].sort((a, b) =>
      a.localeCompare(b)
    );
  }

  private toCoefficientMap(coefficients: unknown): ExerciseEstimatorCoefficientMap | null {
    if (!Array.isArray(coefficients) || coefficients.length === 0) {
      return null;
    }

    const legacyNamed = coefficients.every((entry) => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as any).name === 'string' &&
        typeof (entry as any).value === 'number'
      );
    });

    if (legacyNamed) {
      return coefficients.reduce((acc, entry: any) => {
        acc[entry.name] = entry.value;
        return acc;
      }, {} as ExerciseEstimatorCoefficientMap);
    }

    const singletonMaps = coefficients.every((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return false;
      }

      const keys = Object.keys(entry as Record<string, unknown>);
      if (keys.length === 0) {
        return false;
      }

      return keys.every((key) => typeof (entry as Record<string, unknown>)[key] === 'number');
    });

    if (singletonMaps) {
      return coefficients.reduce((acc, entry) => {
        Object.assign(acc, entry as ExerciseEstimatorCoefficientMap);
        return acc;
      }, {} as ExerciseEstimatorCoefficientMap);
    }

    return null;
  }
}
