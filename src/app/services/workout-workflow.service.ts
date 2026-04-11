import { Injectable } from '@angular/core';
import { WorkoutSessionPerformance } from '../models/workout-session.model';
import { ChatHistoryMessage, WorkoutChatService } from './workout-chat.service';
import { WorkoutLogService } from './workout-log.service';
import { WorkoutSessionFormatterService } from './workout-session-formatter.service';
import {
  ProcessWorkoutMessageParams,
  ProcessWorkoutMessageResult,
  SubmitWorkoutParams,
  SubmitWorkoutResult,
  WorkoutWorkflowMessage,
  WorkoutWorkflowState,
  WorkoutWorkflowViewState,
} from './workout-workflow.models';
import { WorkoutWorkflowEstimatorPreparationService } from './workout-workflow-estimator-preparation.service';
import { WorkoutWorkflowSummaryMapperService } from './workout-workflow-summary-mapper.service';

export type {
  ProcessWorkoutMessageParams,
  ProcessWorkoutMessageResult,
  SubmitWorkoutParams,
  SubmitWorkoutResult,
  TrainerNotesRequester,
  WorkoutWorkflowMessage,
  WorkoutWorkflowState,
  WorkoutWorkflowSummaryRows,
  WorkoutWorkflowViewState,
} from './workout-workflow.models';

@Injectable({
  providedIn: 'root',
})
export class WorkoutWorkflowService {
  constructor(
    private workoutChatService: WorkoutChatService,
    private workoutLogService: WorkoutLogService,
    private workoutSessionFormatter: WorkoutSessionFormatterService,
    private workoutWorkflowSummaryMapper: WorkoutWorkflowSummaryMapperService,
    private workoutWorkflowEstimatorPreparation: WorkoutWorkflowEstimatorPreparationService
  ) {}

  createInitialState(): WorkoutWorkflowViewState {
    const session = this.workoutSessionFormatter.createEmptySession();
    return this.buildWorkflowViewState(session, false, null);
  }

  async processWorkoutMessage(
    params: ProcessWorkoutMessageParams
  ): Promise<ProcessWorkoutMessageResult> {
    const { message, messages, session, hasSavedWorkout, savedWorkoutLoggedAt } = params;
    const exerciseEstimatorIds =
      await this.workoutWorkflowEstimatorPreparation.getExerciseEstimatorIds();
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

    await this.workoutWorkflowEstimatorPreparation.ensureEstimatorDocsForRows(
      this.workoutWorkflowSummaryMapper.readStrengthRows(nextSession)
    );

    const nextHasSavedWorkout = nextSession.isComplete
      ? hasSavedWorkout
      : false;
    const nextSavedWorkoutLoggedAt = nextSession.isComplete
      ? savedWorkoutLoggedAt
      : null;
    const workflowState = this.buildWorkflowViewState(
      nextSession,
      nextHasSavedWorkout,
      nextSavedWorkoutLoggedAt
    );

    return {
      ...workflowState,
      botMessage: response.botMessage?.trim()
        ? response.botMessage
        : 'I received your message, but there was no reply text. Check the backend response format.',
    };
  }

  async submitWorkout(params: SubmitWorkoutParams): Promise<SubmitWorkoutResult> {
    const { session, requestTrainerNotes } = params;
    const trainerNotes = await requestTrainerNotes(session.trainer_notes ?? session.notes ?? '');

    if (trainerNotes === null) {
      return {
        status: 'cancelled',
        ...this.buildWorkflowViewState(session, false, null),
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
      saveStatus: saveResult.status,
      hasSavedWorkout: true,
      savedWorkoutLoggedAt: saveResult.loggedAt.toISOString(),
    };
  }

  private buildWorkflowState(session: WorkoutSessionPerformance): WorkoutWorkflowState {
    return this.workoutWorkflowSummaryMapper.buildWorkflowState(session);
  }

  private buildWorkflowViewState(
    session: WorkoutSessionPerformance,
    hasSavedWorkout: boolean,
    savedWorkoutLoggedAt: string | null
  ): WorkoutWorkflowViewState {
    return {
      ...this.buildWorkflowState(session),
      hasSavedWorkout,
      savedWorkoutLoggedAt,
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
}
