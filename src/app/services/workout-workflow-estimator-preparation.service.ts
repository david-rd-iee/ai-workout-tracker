import { Injectable } from '@angular/core';
import { WorkoutTrainingRow } from '../models/workout-session.model';
import { ExerciseEstimatorsService } from './exercise-estimators.service';

@Injectable({
  providedIn: 'root',
})
export class WorkoutWorkflowEstimatorPreparationService {
  constructor(private exerciseEstimatorsService: ExerciseEstimatorsService) {}

  async getExerciseEstimatorIds(): Promise<string[]> {
    const cachedEstimatorIds = this.exerciseEstimatorsService.getCachedEstimatorIds();
    if (cachedEstimatorIds.length > 0) {
      return cachedEstimatorIds;
    }

    try {
      return await this.exerciseEstimatorsService.listEstimatorIds();
    } catch {
      return [];
    }
  }

  async ensureEstimatorDocsForRows(rows: WorkoutTrainingRow[]): Promise<void> {
    const knownIds = new Set(await this.getExerciseEstimatorIds());

    for (const row of rows) {
      const normalizedId = this.exerciseEstimatorsService.normalizeEstimatorId(row.exercise_type);
      if (!normalizedId) {
        continue;
      }

      row.exercise_type = normalizedId;

      if (knownIds.has(normalizedId)) {
        continue;
      }

      try {
        await this.exerciseEstimatorsService.ensureEstimatorDocExists(normalizedId);
        knownIds.add(normalizedId);
      } catch {
        continue;
      }
    }
  }
}
