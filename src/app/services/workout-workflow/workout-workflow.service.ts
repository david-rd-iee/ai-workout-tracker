import { Injectable } from '@angular/core';
import { WorkoutSessionPerformance } from '../../models/workout-session.model';
import { ChatHistoryMessage, WorkoutChatService } from '../workout-chat.service';
import type { SaveCompletedWorkoutResult } from '../workout-log.service';
import { WorkoutLogService } from '../workout-log.service';
import { WorkoutSessionFormatterService } from '../workout-session-formatter.service';
import {
  ProcessWorkoutMessageParams,
  ProcessWorkoutMessageResult,
  SubmitWorkoutParams,
  SubmitWorkoutResult,
  WorkoutChatCompletionStatus,
  WorkoutChatScreenState,
  WorkoutChatSaveStatus,
  WorkoutWorkflowMessage,
  WorkoutWorkflowState,
} from './workout-workflow.models';
import { WorkoutWorkflowEstimatorPreparationService } from './workout-workflow-estimator-preparation.service';
import { WorkoutWorkflowSummaryProjectionService } from './workout-workflow-summary-projection.service';

export type {
  ProcessWorkoutMessageParams,
  ProcessWorkoutMessageResult,
  SubmitWorkoutParams,
  SubmitWorkoutResult,
  TrainerNotesRequester,
  WorkoutChatCompletionStatus,
  WorkoutChatScreenState,
  WorkoutChatSaveStatus,
  WorkoutWorkflowMessage,
  WorkoutWorkflowState,
  WorkoutWorkflowSummaryRows,
} from './workout-workflow.models';

@Injectable({
  providedIn: 'root',
})
export class WorkoutWorkflowService {
  constructor(
    private workoutChatService: WorkoutChatService,
    private workoutLogService: WorkoutLogService,
    private workoutSessionFormatter: WorkoutSessionFormatterService,
    private workoutWorkflowSummaryProjection: WorkoutWorkflowSummaryProjectionService,
    private workoutWorkflowEstimatorPreparation: WorkoutWorkflowEstimatorPreparationService
  ) {}

  createInitialState(): WorkoutChatScreenState {
    const session = this.workoutSessionFormatter.createEmptySession();
    return this.buildChatScreenState({
      session,
      saveStatus: 'not_saved',
      loggedAt: null,
      botMessage: null,
    });
  }

  async processWorkoutMessage(
    params: ProcessWorkoutMessageParams
  ): Promise<ProcessWorkoutMessageResult> {
    const { message, messages, screenState } = params;
    const { session } = screenState;
    const exerciseEstimatorIds =
      await this.workoutWorkflowEstimatorPreparation.prepareEstimatorsForSession(session);
    const response = await this.workoutChatService.sendMessage({
      message,
      session,
      history: this.buildHistory(messages),
      exerciseEstimatorIds,
    });

    const nextSession = this.normalizeSession(
      (response.updatedSession as Partial<WorkoutSessionPerformance> | undefined) ?? session,
      message
    );

    return this.buildChatScreenState({
      session: nextSession,
      saveStatus: nextSession.isComplete ? screenState.saveStatus : 'not_saved',
      loggedAt: nextSession.isComplete ? screenState.loggedAt : null,
      botMessage: response.botMessage?.trim()
        ? response.botMessage
        : 'I received your message, but there was no reply text. Check the backend response format.',
    });
  }

  async submitWorkout(params: SubmitWorkoutParams): Promise<SubmitWorkoutResult> {
    const { session, requestTrainerNotes } = params;
    const trainerNotes = await requestTrainerNotes(session.trainer_notes ?? session.notes ?? '');

    if (trainerNotes === null) {
      return this.buildSubmitScreenState({
        session,
        saveStatus: 'cancelled',
        loggedAt: null,
        botMessage: null,
        eventId: '',
        savePersistenceStatus: null,
        scoreUpdate: null,
      });
    }

    const sessionToSave = this.workoutSessionFormatter.applyTrainerNotes(
      session,
      trainerNotes,
      true
    );
    const saveResult = await this.workoutLogService.saveCompletedWorkout(sessionToSave);

    return this.buildSubmitScreenState({
      session: saveResult.savedSession,
      saveStatus: 'saved',
      loggedAt: saveResult.loggedAt.toISOString(),
      botMessage:
        'Workout submitted and saved to your history. Score updates should now be available, and summaries will finish updating in the background.',
      eventId: saveResult.eventId,
      savePersistenceStatus: saveResult.status,
      scoreUpdate: saveResult.scoreUpdate,
    });
  }

  private buildWorkflowState(session: WorkoutSessionPerformance): WorkoutWorkflowState {
    return this.workoutWorkflowSummaryProjection.projectWorkflowState(session);
  }

  private buildChatScreenState(params: {
    session: WorkoutSessionPerformance;
    saveStatus: WorkoutChatSaveStatus;
    loggedAt: string | null;
    botMessage: string | null;
  }): WorkoutChatScreenState {
    return {
      ...this.buildWorkflowState(params.session),
      saveStatus: params.saveStatus,
      loggedAt: params.loggedAt,
      completionStatus: this.resolveCompletionStatus(params.session),
      botMessage: params.botMessage,
    };
  }

  private buildSubmitScreenState(params: {
    session: WorkoutSessionPerformance;
    saveStatus: WorkoutChatSaveStatus;
    loggedAt: string | null;
    botMessage: string | null;
    eventId: string;
    savePersistenceStatus: SaveCompletedWorkoutResult['status'] | null;
    scoreUpdate: SaveCompletedWorkoutResult['scoreUpdate'];
  }): SubmitWorkoutResult {
    return {
      ...this.buildChatScreenState(params),
      eventId: params.eventId,
      savePersistenceStatus: params.savePersistenceStatus,
      scoreUpdate: params.scoreUpdate,
    };
  }

  private resolveCompletionStatus(
    session: WorkoutSessionPerformance
  ): WorkoutChatCompletionStatus {
    return session.isComplete ? 'complete' : 'incomplete';
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
