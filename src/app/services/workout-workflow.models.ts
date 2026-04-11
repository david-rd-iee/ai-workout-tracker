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

export interface WorkoutWorkflowViewState extends WorkoutWorkflowState {
  hasSavedWorkout: boolean;
  savedWorkoutLoggedAt: string | null;
}

export interface ProcessWorkoutMessageParams {
  message: string;
  messages: WorkoutWorkflowMessage[];
  session: WorkoutSessionPerformance;
  hasSavedWorkout: boolean;
  savedWorkoutLoggedAt: string | null;
}

export interface ProcessWorkoutMessageResult extends WorkoutWorkflowViewState {
  botMessage: string;
}

export type TrainerNotesRequester = (initialValue: string) => Promise<string | null>;

export interface SubmitWorkoutParams {
  session: WorkoutSessionPerformance;
  requestTrainerNotes: TrainerNotesRequester;
}

export interface SubmitWorkoutSavedResult extends WorkoutWorkflowState {
  status: 'saved';
  eventId: string;
  saveStatus: SaveCompletedWorkoutResult['status'];
  hasSavedWorkout: true;
  savedWorkoutLoggedAt: string;
}

export interface SubmitWorkoutCancelledResult extends WorkoutWorkflowViewState {
  status: 'cancelled';
}

export type SubmitWorkoutResult =
  | SubmitWorkoutSavedResult
  | SubmitWorkoutCancelledResult;
