import { Injectable } from '@angular/core';
import {
  CardioTrainingRow,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../../models/workout-session.model';
import {
  WorkoutWorkflowState,
  WorkoutWorkflowSummaryRows,
} from './workout-workflow.models';

@Injectable({
  providedIn: 'root',
})
export class WorkoutWorkflowSummaryProjectionService {
  projectSummaryRows(session: WorkoutSessionPerformance): WorkoutWorkflowSummaryRows {
    return {
      strengthRows: this.projectStrengthRows(session),
      cardioRows: this.projectCardioRows(session),
      otherRows: (session.trainingRows ?? []).filter((row) => row.Training_Type === 'Other'),
    };
  }

  projectWorkflowState(session: WorkoutSessionPerformance): WorkoutWorkflowState {
    return {
      session,
      summaryRows: this.projectSummaryRows(session),
    };
  }

  projectStrengthRows(session: WorkoutSessionPerformance): WorkoutTrainingRow[] {
    if (Array.isArray(session.strengthTrainingRow)) {
      return session.strengthTrainingRow;
    }

    if (session.strengthTrainingRow) {
      return [session.strengthTrainingRow];
    }

    return Array.isArray(session.strengthTrainingRowss)
      ? session.strengthTrainingRowss
      : [];
  }

  projectCardioRows(session: WorkoutSessionPerformance): CardioTrainingRow[] {
    if (Array.isArray(session.cardioTrainingRow)) {
      return session.cardioTrainingRow;
    }

    return session.cardioTrainingRow
      ? [session.cardioTrainingRow]
      : [];
  }
}
