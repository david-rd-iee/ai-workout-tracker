import { Injectable } from '@angular/core';
import {
  CardioTrainingRow,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../models/workout-session.model';
import {
  WorkoutWorkflowState,
  WorkoutWorkflowSummaryRows,
} from './workout-workflow.models';

@Injectable({
  providedIn: 'root',
})
export class WorkoutWorkflowSummaryMapperService {
  buildSummaryRows(session: WorkoutSessionPerformance): WorkoutWorkflowSummaryRows {
    return {
      strengthRows: this.readStrengthRows(session),
      cardioRows: this.readCardioRows(session),
      otherRows: (session.trainingRows ?? []).filter((row) => row.Training_Type === 'Other'),
    };
  }

  buildWorkflowState(session: WorkoutSessionPerformance): WorkoutWorkflowState {
    return {
      session,
      summaryRows: this.buildSummaryRows(session),
    };
  }

  readStrengthRows(session: WorkoutSessionPerformance): WorkoutTrainingRow[] {
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

  readCardioRows(session: WorkoutSessionPerformance): CardioTrainingRow[] {
    if (Array.isArray(session.cardioTrainingRow)) {
      return session.cardioTrainingRow;
    }

    return session.cardioTrainingRow
      ? [session.cardioTrainingRow]
      : [];
  }
}
