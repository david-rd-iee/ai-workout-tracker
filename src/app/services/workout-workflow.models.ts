import {
  CardioTrainingRow,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../models/workout-session.model';
import type { SaveCompletedWorkoutResult } from './workout-log.service';

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
