import {
  CardioTrainingRow,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../../models/workout-session.model';
import type { SaveCompletedWorkoutResult } from '../workout-log.service';

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

export type WorkoutChatSaveStatus = 'not_saved' | 'saved' | 'cancelled';
export type WorkoutChatCompletionStatus = 'incomplete' | 'complete';

export interface WorkoutChatScreenState extends WorkoutWorkflowState {
  saveStatus: WorkoutChatSaveStatus;
  loggedAt: string | null;
  completionStatus: WorkoutChatCompletionStatus;
  botMessage: string | null;
}

export interface ProcessWorkoutMessageParams {
  message: string;
  messages: WorkoutWorkflowMessage[];
  screenState: WorkoutChatScreenState;
}

export type ProcessWorkoutMessageResult = WorkoutChatScreenState;

export type TrainerNotesRequester = (initialValue: string) => Promise<string | null>;

export interface SubmitWorkoutParams {
  session: WorkoutSessionPerformance;
  requestTrainerNotes: TrainerNotesRequester;
}

export interface SubmitWorkoutResult extends WorkoutChatScreenState {
  eventId: string;
  savePersistenceStatus: SaveCompletedWorkoutResult['status'] | null;
  scoreUpdate: SaveCompletedWorkoutResult['scoreUpdate'];
}
