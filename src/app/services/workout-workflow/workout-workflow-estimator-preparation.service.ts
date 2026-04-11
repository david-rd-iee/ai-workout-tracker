import { Injectable } from '@angular/core';
import { WorkoutSessionPerformance, WorkoutTrainingRow } from '../../models/workout-session.model';
import { ExerciseEstimatorsService } from '../exercise-estimators.service';
import { WorkoutWorkflowSummaryProjectionService } from './workout-workflow-summary-projection.service';

@Injectable({
  providedIn: 'root',
})
export class WorkoutWorkflowEstimatorPreparationService {
  constructor(
    private exerciseEstimatorsService: ExerciseEstimatorsService,
    private workoutWorkflowSummaryProjection: WorkoutWorkflowSummaryProjectionService
  ) {}

  async prepareEstimatorsForSession(session: WorkoutSessionPerformance): Promise<string[]> {
    const strengthRows = this.workoutWorkflowSummaryProjection.projectStrengthRows(session);
    const knownIds = await this.loadKnownEstimatorIds();

    await this.ensureEstimatorDocsForRows(strengthRows, knownIds);

    return [...knownIds];
  }

  private async loadKnownEstimatorIds(): Promise<Set<string>> {
    const cachedEstimatorIds = this.exerciseEstimatorsService.getCachedEstimatorIds();
    if (cachedEstimatorIds.length > 0) {
      return new Set(cachedEstimatorIds);
    }

    try {
      return new Set(await this.exerciseEstimatorsService.listEstimatorIds());
    } catch {
      return new Set<string>();
    }
  }

  private async ensureEstimatorDocsForRows(
    rows: WorkoutTrainingRow[],
    knownIds: Set<string>
  ): Promise<void> {
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
