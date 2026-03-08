// imports
import { WorkoutLogService } from '../../services/workout-log.service';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonInput, IonButton, IonIcon, IonContent } from '@ionic/angular/standalone';
import { Platform } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { arrowUp, fitnessOutline } from 'ionicons/icons';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { HeaderComponent } from '../../components/header/header.component';

import {
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
  TrainingType,
  RowWeight,
} from '../../models/workout-session.model';
import { Router } from '@angular/router';
import {
  WorkoutChatService,
  ChatHistoryMessage,
  ChatResponse,
} from '../../services/workout-chat.service';
import { ExerciseEstimatorsService } from '../../services/exercise-estimators.service';

// who is sending the message
type ChatSender = 'bot' | 'user';

// definitions
interface ChatMessage {
  from: ChatSender;
  text: string;
}

@Component({
  selector: 'app-workout-chatbot',
  standalone: true,
  templateUrl: './workout-chatbot.page.html',
  styleUrls: ['./workout-chatbot.page.scss'],
  imports: [CommonModule, FormsModule, IonInput, IonButton, IonIcon, IonContent, HeaderComponent],
})
export class WorkoutChatbotPage implements OnInit, OnDestroy {
  userInput = '';
  messages: ChatMessage[] = [];
  isLoading = false;
  keyboardOffset = 0;
  exerciseEstimatorIds: string[] = [];

  // Save guards
  hasSavedWorkout = false;
  isSavingWorkout = false;
  private estimatorIdsLoadPromise: Promise<void> | null = null;
  private isIPhone = false;
  private removeKeyboardListeners: Array<() => void> = [];

  // structured session/summary object the AI can update
  session: WorkoutSessionPerformance = this.createEmptySession();

  constructor(
    private router: Router,
    private workoutChatService: WorkoutChatService,
    private workoutLogService: WorkoutLogService,
    private exerciseEstimatorsService: ExerciseEstimatorsService,
    private platform: Platform
  ) {
    addIcons({ fitnessOutline, arrowUp });
  }

  ngOnInit() {
    // New page load = new workout attempt
    this.hasSavedWorkout = false;
    this.isSavingWorkout = false;

    this.addBotMessage(
      'Hey! Ready to log your workout? Include exercise, sets/reps, weight (kg or body weight), and I will turn it into training rows.'
    );

    this.isIPhone = this.platform.is('iphone');
    this.initKeyboardBehavior();
    this.estimatorIdsLoadPromise = this.loadEstimatorIds();
  }

  ngOnDestroy() {
    this.removeKeyboardListeners.forEach((remove) => remove());
    this.removeKeyboardListeners = [];
  }

  // helpers:
  addBotMessage(text: string) {
    this.messages.push({ from: 'bot', text });
  }

  addUserMessage(text: string) {
    this.messages.push({ from: 'user', text });
  }

  private buildHistory(): ChatHistoryMessage[] {
    // map our UI messages into the type the service expects
    return this.messages.slice(-10).map((m) => ({
      role: m.from === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));
  }

  async handleSend() {
    const text = this.userInput.trim();
    if (!text) return;

    // show user message immediately
    this.addUserMessage(text);
    this.userInput = '';
    this.isLoading = true;

    try {
      if (this.estimatorIdsLoadPromise) {
        await this.estimatorIdsLoadPromise;
      }

      const response: ChatResponse = await this.workoutChatService.sendMessage({
        message: text,
        session: this.session,
        history: this.buildHistory(),
        exerciseEstimatorIds: this.exerciseEstimatorIds,
      });

      // If the previous session was complete, and now it's not complete,
      // assume user is starting a new workout -> allow saving again.
      const wasComplete = !!this.session?.isComplete;

      const nextSession = this.normalizeSession(
        (response.updatedSession as Partial<WorkoutSessionPerformance> | undefined) ?? this.session
      );
      await this.ensureEstimatorDocsForRows(nextSession.trainingRows);
      this.session = nextSession;
      this.logRowsToConsole(this.session.trainingRows);

      const isNowComplete = !!this.session?.isComplete;

      if (wasComplete && !isNowComplete) {
        this.hasSavedWorkout = false;
      }

      // show bot reply
      if (response.botMessage) {
        this.addBotMessage(response.botMessage);
      } else {
        this.addBotMessage(
          'I received your message, but there was no reply text. Check the backend response format.'
        );
      }
    } catch (err) {
      console.error('Error talking to AI backend:', err);
      this.addBotMessage(
        'Oops, something went wrong while talking to the AI. Try again in a moment.'
      );
    } finally {
      this.isLoading = false;
    }
  }

  async submitWorkout() {
    // Don’t allow multiple clicks while saving
    if (this.isSavingWorkout) return;

    if (this.hasSavedWorkout) {
      this.addBotMessage('Your workout is already submitted.');
      return;
    }

    const didSave = await this.persistCurrentWorkout();
    if (!didSave) return;

    this.addBotMessage('Workout submitted and saved to your history.');
  }

  viewWorkoutSummary(): void {
    this.router.navigate(['/workout-summary'], {
      state: { summary: this.session },
    });
  }

  private async persistCurrentWorkout(): Promise<boolean> {
    if (this.isSavingWorkout) return false;

    this.isSavingWorkout = true;
    try {
      await this.workoutLogService.saveCompletedWorkout(this.session);
      this.hasSavedWorkout = true;
      return true;
    } catch (err) {
      console.error('Failed to save workout:', err);
      this.addBotMessage(
        'I had trouble saving your workout. Please try again.'
      );
      return false;
    } finally {
      this.isSavingWorkout = false;
    }
  }

  private createEmptySession(): WorkoutSessionPerformance {
    return {
      date: new Date().toISOString().slice(0, 10),
      trainingRows: [],
      estimated_calories: 0,
      trainer_notes: '',
      isComplete: false,
      sessionType: '',
      notes: '',
      volume: 0,
      calories: 0,
      exercises: [],
    };
  }

  private normalizeSession(
    candidate: Partial<WorkoutSessionPerformance> | null | undefined
  ): WorkoutSessionPerformance {
    const session = candidate ?? {};
    const rows = this.normalizeRows((session as any).trainingRows);
    const estimatedCalories = this.toNumber(
      (session as any).estimated_calories ?? (session as any).calories,
      0
    );
    const trainerNotesRaw = (session as any).trainer_notes ?? (session as any).notes ?? '';
    const trainerNotes = typeof trainerNotesRaw === 'string' ? trainerNotesRaw : String(trainerNotesRaw ?? '');
    const dateRaw = (session as any).date;
    const date = typeof dateRaw === 'string' && dateRaw.trim()
      ? dateRaw
      : new Date().toISOString().slice(0, 10);

    return {
      date,
      trainingRows: rows,
      estimated_calories: estimatedCalories,
      trainer_notes: trainerNotes,
      isComplete: !!(session as any).isComplete,
      sessionType: (session as any).sessionType ?? '',
      notes: trainerNotes,
      volume: this.calculateTotalVolume(rows),
      calories: estimatedCalories,
      exercises: this.rowsToLegacyExercises(rows),
    };
  }

  private normalizeRows(rowsCandidate: unknown): WorkoutTrainingRow[] {
    if (!Array.isArray(rowsCandidate)) {
      return [];
    }

    return rowsCandidate
      .map((entry): WorkoutTrainingRow | null => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const row = entry as Record<string, unknown>;
        const trainingType = this.normalizeTrainingType(
          row['Training_Type'] ?? row['training_type'] ?? row['trainingType']
        );
        const rawType = typeof row['exercise_type'] === 'string'
          ? row['exercise_type']
          : typeof row['exersice_type'] === 'string'
            ? row['exersice_type']
            : '';
        const exerciseType = this.exerciseEstimatorsService.normalizeEstimatorId(rawType) || 'unknown_exercise';
        const sets = this.toInteger(row['sets'], 1);
        const reps = this.toInteger(row['reps'], 1);
        const weights = this.normalizeWeight(
          row['weights'] ?? row['weight'] ?? row['weight_kg']
        );

        return {
          Training_Type: trainingType,
          exercise_type: exerciseType,
          sets,
          reps,
          weights,
        };
      })
      .filter((row): row is WorkoutTrainingRow => !!row);
  }

  private normalizeTrainingType(value: unknown): TrainingType {
    const text = String(value ?? '').trim().toLowerCase();
    if (text === 'strength') return 'Strength';
    if (text === 'cardio') return 'Cardio';
    return 'Other';
  }

  private normalizeWeight(value: unknown): RowWeight {
    if (typeof value === 'string') {
      const lowered = value.trim().toLowerCase();
      if (lowered.includes('body')) {
        return 'body weight';
      }

      const parsed = Number(lowered);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }

    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }

    return 'body weight';
  }

  private toNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private toInteger(value: unknown, fallback: number): number {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private calculateTotalVolume(rows: WorkoutTrainingRow[]): number {
    return rows.reduce((total, row) => {
      if (typeof row.weights !== 'number') {
        return total;
      }
      return total + row.sets * row.reps * row.weights;
    }, 0);
  }

  private rowsToLegacyExercises(rows: WorkoutTrainingRow[]) {
    return rows.map((row) => {
      const metricWeight = typeof row.weights === 'number' ? `${row.weights} kg` : row.weights;
      return {
        name: this.fromSnakeCase(row.exercise_type),
        metric: `${row.sets} x ${row.reps} @ ${metricWeight}`,
        volume: typeof row.weights === 'number' ? row.sets * row.reps * row.weights : 0,
      };
    });
  }

  private fromSnakeCase(value: string): string {
    return value
      .split('_')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }

  private async loadEstimatorIds(): Promise<void> {
    try {
      this.exerciseEstimatorIds = await this.exerciseEstimatorsService.listEstimatorIds();
      console.log('[WorkoutChatbot] Loaded exercise estimator IDs:', this.exerciseEstimatorIds);
    } catch (error) {
      console.error('[WorkoutChatbot] Failed to load exercise estimator IDs:', error);
      this.exerciseEstimatorIds = [];
    } finally {
      this.estimatorIdsLoadPromise = null;
    }
  }

  private async ensureEstimatorDocsForRows(rows: WorkoutTrainingRow[]): Promise<void> {
    const knownIds = new Set(this.exerciseEstimatorIds);

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
        console.log(`[WorkoutChatbot] Added new exercise estimator ID: ${normalizedId}`);
      } catch (error) {
        console.error(`[WorkoutChatbot] Failed to ensure estimator doc for ${normalizedId}:`, error);
      }
    }

    this.exerciseEstimatorIds = Array.from(knownIds).sort((a, b) => a.localeCompare(b));
  }

  private logRowsToConsole(rows: WorkoutTrainingRow[]): void {
    rows.forEach((row, index) => {
      console.log(`[WorkoutChatbot][Row ${index + 1}]`, {
        Training_Type: row.Training_Type,
        exercise_type: row.exercise_type,
        sets: row.sets,
        reps: row.reps,
        weights: row.weights,
        estimated_calories: this.session.estimated_calories,
        trainer_notes: this.session.trainer_notes,
        isComplete: !!this.session.isComplete,
      });
    });
  }

  private initKeyboardBehavior(): void {
    // On iPhone, keep native iOS keyboard behavior and do not force offsets.
    if (this.isIPhone) {
      this.keyboardOffset = 0;
      return;
    }

    if (Capacitor.isNativePlatform()) {
      void this.bindNativeKeyboardListeners();
      return;
    }

    this.bindWebViewportKeyboardListeners();
  }

  private async bindNativeKeyboardListeners(): Promise<void> {
    const showHandler = (info: { keyboardHeight: number }) => {
      this.keyboardOffset = info?.keyboardHeight ?? 0;
    };

    const hideHandler = () => {
      this.keyboardOffset = 0;
    };

    const willShow = await Keyboard.addListener('keyboardWillShow', showHandler);
    const didShow = await Keyboard.addListener('keyboardDidShow', showHandler);
    const willHide = await Keyboard.addListener('keyboardWillHide', hideHandler);
    const didHide = await Keyboard.addListener('keyboardDidHide', hideHandler);

    this.removeKeyboardListeners.push(
      () => void willShow.remove(),
      () => void didShow.remove(),
      () => void willHide.remove(),
      () => void didHide.remove()
    );
  }

  private bindWebViewportKeyboardListeners(): void {
    if (!window.visualViewport) return;

    const updateOffset = () => {
      const viewport = window.visualViewport;
      if (!viewport) return;
      const offset = Math.max(
        0,
        Math.round(window.innerHeight - viewport.height - viewport.offsetTop)
      );
      this.keyboardOffset = offset;
    };

    window.visualViewport.addEventListener('resize', updateOffset);
    window.visualViewport.addEventListener('scroll', updateOffset);
    this.removeKeyboardListeners.push(() =>
      window.visualViewport?.removeEventListener('resize', updateOffset)
    );
    this.removeKeyboardListeners.push(() =>
      window.visualViewport?.removeEventListener('scroll', updateOffset)
    );
  }
}
