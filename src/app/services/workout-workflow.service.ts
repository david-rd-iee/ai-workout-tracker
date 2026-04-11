import { Injectable } from '@angular/core';
import {
  CardioTrainingRow,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../models/workout-session.model';
import { ExerciseEstimatorsService } from './exercise-estimators.service';
import { ChatHistoryMessage, WorkoutChatService } from './workout-chat.service';
import {
  SaveCompletedWorkoutResult,
  WorkoutLogService,
} from './workout-log.service';
import { WorkoutSessionFormatterService } from './workout-session-formatter.service';

export interface WorkoutWorkflowMessage {
  from: 'bot' | 'user';
  text: string;
}

export interface WorkoutWorkflowSummaryRows {
  strengthRows: WorkoutTrainingRow[];
  cardioRows: CardioTrainingRow[];
  otherRows: WorkoutTrainingRow[];
}

export interface WorkoutWorkflowState {
  session: WorkoutSessionPerformance;
  summaryRows: WorkoutWorkflowSummaryRows;
}

export interface ProcessWorkoutMessageParams {
  message: string;
  messages: WorkoutWorkflowMessage[];
  session: WorkoutSessionPerformance;
}

export interface ProcessWorkoutMessageResult extends WorkoutWorkflowState {
  botMessage: string;
  shouldResetSavedWorkout: boolean;
}

export type TrainerNotesRequester = (initialValue: string) => Promise<string | null>;

export interface SubmitWorkoutParams {
  session: WorkoutSessionPerformance;
  requestTrainerNotes: TrainerNotesRequester;
}

export interface SubmitWorkoutSavedResult extends WorkoutWorkflowState {
  status: 'saved';
  eventId: string;
  loggedAt: Date;
  saveStatus: SaveCompletedWorkoutResult['status'];
}

export interface SubmitWorkoutCancelledResult extends WorkoutWorkflowState {
  status: 'cancelled';
}

export type SubmitWorkoutResult =
  | SubmitWorkoutSavedResult
  | SubmitWorkoutCancelledResult;

@Injectable({
  providedIn: 'root',
})
export class WorkoutWorkflowService {
  constructor(
    private workoutChatService: WorkoutChatService,
    private workoutLogService: WorkoutLogService,
    private exerciseEstimatorsService: ExerciseEstimatorsService,
    private workoutSessionFormatter: WorkoutSessionFormatterService
  ) {}

  createInitialState(): WorkoutWorkflowState {
    const session = this.workoutSessionFormatter.createEmptySession();
    return this.buildWorkflowState(session);
  }

  async processWorkoutMessage(
    params: ProcessWorkoutMessageParams
  ): Promise<ProcessWorkoutMessageResult> {
    const { message, messages, session } = params;
    const exerciseEstimatorIds = await this.getExerciseEstimatorIds();
    const response = await this.workoutChatService.sendMessage({
      message,
      session,
      history: this.buildHistory(messages),
      exerciseEstimatorIds,
    });

    const wasComplete = !!session?.isComplete;
    const nextSession = this.normalizeSession(
      (response.updatedSession as Partial<WorkoutSessionPerformance> | undefined) ?? session,
      message
    );

    await this.ensureEstimatorDocsForRows(this.readStrengthRows(nextSession));

    const workflowState = this.buildWorkflowState(nextSession);
    this.logRowsToConsole(workflowState);

    return {
      ...workflowState,
      botMessage: response.botMessage?.trim()
        ? response.botMessage
        : 'I received your message, but there was no reply text. Check the backend response format.',
      shouldResetSavedWorkout: wasComplete && !workflowState.session.isComplete,
    };
  }

  async submitWorkout(params: SubmitWorkoutParams): Promise<SubmitWorkoutResult> {
    const { session, requestTrainerNotes } = params;
    const trainerNotes = await requestTrainerNotes(session.trainer_notes ?? session.notes ?? '');

    if (trainerNotes === null) {
      return {
        status: 'cancelled',
        ...this.buildWorkflowState(session),
      };
    }

    const sessionToSave = this.workoutSessionFormatter.applyTrainerNotes(
      session,
      trainerNotes,
      true
    );
    const saveResult = await this.workoutLogService.saveCompletedWorkout(sessionToSave);

    return {
      status: 'saved',
      ...this.buildWorkflowState(saveResult.savedSession),
      eventId: saveResult.eventId,
      loggedAt: saveResult.loggedAt,
      saveStatus: saveResult.status,
    };
  }

  private buildWorkflowState(session: WorkoutSessionPerformance): WorkoutWorkflowState {
    return {
      session,
      summaryRows: {
        strengthRows: this.readStrengthRows(session),
        cardioRows: this.readCardioRows(session),
        otherRows: (session.trainingRows ?? []).filter((row) => row.Training_Type === 'Other'),
      },
    };
  }

  private normalizeSession(
    candidate: Partial<WorkoutSessionPerformance> | null | undefined,
    latestUserMessage?: string
  ): WorkoutSessionPerformance {
    return this.workoutSessionFormatter.normalizeSession(candidate, {
      latestUserMessage,
      defaultDate: new Date().toISOString().slice(0, 10),
    });
  }

  private buildHistory(messages: WorkoutWorkflowMessage[]): ChatHistoryMessage[] {
    return messages.slice(-10).map((message) => ({
      role: message.from === 'user' ? 'user' : 'assistant',
      content: message.text,
    }));
  }

  private async getExerciseEstimatorIds(): Promise<string[]> {
    const cachedEstimatorIds = this.exerciseEstimatorsService.getCachedEstimatorIds();
    if (cachedEstimatorIds.length > 0) {
      return cachedEstimatorIds;
    }

    try {
      return await this.exerciseEstimatorsService.listEstimatorIds();
    } catch (error) {
      console.error('[WorkoutWorkflowService] Failed to load exercise estimator IDs:', error);
      return [];
    }
  }

  private readStrengthRows(session: WorkoutSessionPerformance): WorkoutTrainingRow[] {
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

  private readCardioRows(session: WorkoutSessionPerformance): CardioTrainingRow[] {
    if (Array.isArray(session.cardioTrainingRow)) {
      return session.cardioTrainingRow;
    }

    return session.cardioTrainingRow
      ? [session.cardioTrainingRow]
      : [];
  }

  private async ensureEstimatorDocsForRows(rows: WorkoutTrainingRow[]): Promise<void> {
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
        console.log(`[WorkoutWorkflowService] Added new exercise estimator ID: ${normalizedId}`);
      } catch (error) {
        console.error(
          `[WorkoutWorkflowService] Failed to ensure estimator doc for ${normalizedId}:`,
          error
        );
      }
    }
  }

  private logRowsToConsole(state: WorkoutWorkflowState): void {
    const shared = {
      trainer_notes: state.session.trainer_notes,
      isComplete: !!state.session.isComplete,
    };

    state.summaryRows.strengthRows.forEach((row, index) => {
      console.log(`[WorkoutWorkflow][Strength Row ${index + 1}]`, {
        ...shared,
        Training_Type: row.Training_Type,
        estimated_calories: row.estimated_calories,
        exercise_type: row.exercise_type,
        sets: row.sets,
        reps: row.reps,
        displayed_weights_metric: row.displayed_weights_metric,
        weights_kg: row.weights_kg,
      });
    });

    state.summaryRows.cardioRows.forEach((row, index) => {
      console.log(`[WorkoutWorkflow][Cardio Row ${index + 1}]`, {
        ...shared,
        Training_Type: row.Training_Type,
        estimated_calories: row.estimated_calories,
        cardio_type: row.cardio_type,
        display_distance: row.display_distance ?? null,
        distance_meters: typeof row.distance_meters === 'number' ? row.distance_meters : null,
        display_time: row.display_time ?? null,
        time_minutes: typeof row.time_minutes === 'number' ? row.time_minutes : null,
      });
    });

    state.summaryRows.otherRows.forEach((row, index) => {
      console.log(`[WorkoutWorkflow][Other Row ${index + 1}]`, {
        ...shared,
        Training_Type: row.Training_Type,
        estimated_calories: row.estimated_calories,
        exercise_type: row.exercise_type,
        sets: row.sets,
        reps: row.reps,
        displayed_weights_metric: row.displayed_weights_metric,
        weights_kg: row.weights_kg,
      });
    });
  }
}
