// imports
import { StreakUpdateResult, WorkoutLogService } from '../../services/workout-log.service';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonInput, IonButton, IonIcon, IonContent, AlertController } from '@ionic/angular/standalone';
import { Platform } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { arrowUp, fitnessOutline } from 'ionicons/icons';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { HeaderComponent } from '../../components/header/header.component';

import {
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
  CardioTrainingRow,
  OtherTrainingRow,
  TrainingType,
  RowWeight,
} from '../../models/workout-session.model';
import { Router } from '@angular/router';
import { UpdateScoreResult } from '../../services/update-score.service';
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
  displayStrengthRows: WorkoutTrainingRow[] = [];
  displayCardioRows: CardioTrainingRow[] = [];
  displayOtherRows: WorkoutTrainingRow[] = [];

  // Save guards
  hasSavedWorkout = false;
  isSavingWorkout = false;
  savedWorkoutLoggedAt: string | null = null;
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
    private platform: Platform,
    private alertController: AlertController
  ) {
    addIcons({ fitnessOutline, arrowUp });
  }

  ngOnInit() {
    // New page load = new workout attempt
    this.hasSavedWorkout = false;
    this.isSavingWorkout = false;
    this.savedWorkoutLoggedAt = null;

    this.addBotMessage(
      'Hey! Ready to log your workout? Include exercise, sets/reps, weight (kg or bodyweight), and I will turn it into training rows.'
    );

    this.isIPhone = this.platform.is('iphone');
    this.initKeyboardBehavior();
    const cachedEstimatorIds = this.exerciseEstimatorsService.getCachedEstimatorIds();
    if (cachedEstimatorIds.length > 0) {
      this.exerciseEstimatorIds = cachedEstimatorIds;
    } else {
      this.estimatorIdsLoadPromise = this.loadEstimatorIds();
    }
    this.refreshSummaryDisplayRows();
  }

  ngOnDestroy() {
    this.removeKeyboardListeners.forEach((remove) => remove());
    this.removeKeyboardListeners = [];
  }

  get showLiveSummary(): boolean {
    return (this.session.trainingRows.length > 0 || this.isLoading) && !this.hasSavedWorkout;
  }

  get showSummaryPanel(): boolean {
    return this.showLiveSummary || this.hasSavedWorkout;
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
        (response.updatedSession as Partial<WorkoutSessionPerformance> | undefined) ?? this.session,
        text
      );
      const strengthRowsForEstimator = Array.isArray(nextSession.strengthTrainingRow)
        ? nextSession.strengthTrainingRow
        : nextSession.strengthTrainingRow
          ? [nextSession.strengthTrainingRow]
          : (nextSession.strengthTrainingRowss ?? []);
      await this.ensureEstimatorDocsForRows(strengthRowsForEstimator);
      this.session = nextSession;
      this.refreshSummaryDisplayRows();
      this.logRowsToConsole(this.session);

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
      state: {
        summary: this.session,
        loggedAt: this.savedWorkoutLoggedAt,
      },
    });
  }

  private async persistCurrentWorkout(): Promise<boolean> {
    if (this.isSavingWorkout) return false;

    this.isSavingWorkout = true;
    try {
      const loggedAt = new Date().toISOString();
      const saveResult = await this.workoutLogService.saveCompletedWorkout(this.session);
      this.hasSavedWorkout = true;
      this.savedWorkoutLoggedAt = loggedAt;
      if (saveResult.streakUpdate.kind !== 'unchanged') {
        await this.showStreakUpdateAlert(saveResult.streakUpdate);
      }
      if (saveResult.scoreUpdate) {
        await this.showScoreUpdateAlert(saveResult.scoreUpdate);
      }
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

  private roundToTwoDecimals(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private async showScoreUpdateAlert(scoreUpdate: UpdateScoreResult): Promise<void> {
    const message = this.buildScoreUpdateMessage(scoreUpdate);
    const alert = await this.alertController.create({
      mode: 'ios',
      header: 'Score Updated',
      cssClass: 'score-update-alert',
      message,
      buttons: ['OK'],
      translucent: true,
    });

    await alert.present();
  }

  private async showStreakUpdateAlert(streakUpdate: StreakUpdateResult): Promise<void> {
    const { header, message } = this.buildStreakUpdateAlertContent(streakUpdate);
    const alert = await this.alertController.create({
      mode: 'ios',
      header,
      cssClass: 'score-update-alert',
      message,
      buttons: ['OK'],
      translucent: true,
    });

    await alert.present();
  }

  private buildScoreUpdateMessage(scoreUpdate: UpdateScoreResult): string {
    const lines = scoreUpdate.exerciseScoreDeltas.map((entry) => (
      `${this.formatSummaryExerciseName(entry.exerciseType)}: ${this.formatSignedScore(entry.addedScore)}`
    ));

    lines.push(`Total Added: ${this.formatSignedScore(scoreUpdate.addedTotalScore)}`);
    lines.push('');
    lines.push(`New Total: ${this.formatScoreValue(scoreUpdate.currentTotalScore)}`);

    return lines.join('\n');
  }

  private buildStreakUpdateAlertContent(
    streakUpdate: StreakUpdateResult
  ): { header: string; message: string } {
    const lines = [`Current Streak: ${this.formatStreakDays(streakUpdate.currentStreak)}`];

    if (streakUpdate.maxStreak > 0) {
      lines.push(`Max Streak: ${this.formatStreakDays(streakUpdate.maxStreak)}`);
    }

    if (streakUpdate.maxStreak > streakUpdate.previousMaxStreak) {
      lines.push('', 'New max streak reached.');
    }

    if (streakUpdate.kind === 'restarted') {
      return {
        header: 'Streak Restarted',
        message: ['You are back on track.', ...lines].join('\n'),
      };
    }

    if (streakUpdate.kind === 'extended') {
      return {
        header: 'Streak Updated',
        message: [`Nice work, your streak just grew.`, ...lines].join('\n'),
      };
    }

    return {
      header: 'Streak Started',
      message: [`Your workout streak has started.`, ...lines].join('\n'),
    };
  }

  private formatStreakDays(value: number): string {
    const safeValue = Math.max(0, Math.floor(Number(value) || 0));
    return `${safeValue} day${safeValue === 1 ? '' : 's'}`;
  }

  formatSummaryExerciseName(exerciseType: string): string {
    return String(exerciseType ?? '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private formatSignedScore(value: number): string {
    const rounded = this.roundToTwoDecimals(value);
    const absoluteValue = this.formatScoreValue(Math.abs(rounded));

    return `${rounded < 0 ? '-' : '+'} ${absoluteValue}`;
  }

  private formatScoreValue(value: number): string {
    return String(this.roundToTwoDecimals(value));
  }

  private createEmptySession(): WorkoutSessionPerformance {
    return {
      date: new Date().toISOString().slice(0, 10),
      trainingRows: [],
      strengthTrainingRow: [],
      strengthTrainingRowss: [],
      cardioTrainingRow: [],
      otherTrainingRow: [],
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
    candidate: Partial<WorkoutSessionPerformance> | null | undefined,
    latestUserMessage?: string
  ): WorkoutSessionPerformance {
    const session = candidate ?? {};
    const source = session as Record<string, unknown>;
    const estimatedCalories = this.toNumber(
      source['estimated_calories'] ?? source['calories'],
      0
    );
    const fallbackRows = this.normalizeRows(source['trainingRows'], undefined, latestUserMessage);
    const legacyCardioRows = this.extractLegacyCardioRowsFromTrainingRows(source['trainingRows']);
    const strengthRows = this.normalizeRows(
      this.hasOwnKey(source, 'strengthTrainingRow')
        ? source['strengthTrainingRow']
        : this.hasOwnKey(source, 'strengthTrainingRowss')
          ? source['strengthTrainingRowss']
        : fallbackRows.filter((row) => row.Training_Type === 'Strength'),
      'Strength',
      latestUserMessage
    );
    const cardioRows = this.normalizeCardioRows(
      this.hasOwnKey(source, 'cardioTrainingRow')
        ? source['cardioTrainingRow']
        : legacyCardioRows,
      latestUserMessage
    );
    const otherRows = this.normalizeOtherRows(
      this.hasOwnKey(source, 'otherTrainingRow')
        ? source['otherTrainingRow']
        : fallbackRows
            .filter((row) => row.Training_Type === 'Other')
            .map((row) => ({
              activity: row.exercise_type,
              sets: row.sets,
              reps: row.reps,
              displayed_weights_metric: row.displayed_weights_metric,
              weights_kg: row.weights_kg,
              estimated_calories: row.estimated_calories,
            }))
    );
    this.ensureEstimatedCaloriesAcrossRows(
      strengthRows,
      cardioRows,
      otherRows,
      estimatedCalories
    );
    const rows = [
      ...strengthRows,
      ...this.cardioRowsToTrainingRows(cardioRows),
      ...this.otherRowsToTrainingRows(otherRows),
    ];
    const trainingType = this.resolveSessionTrainingType(source, strengthRows, cardioRows, otherRows, rows);
    const trainerNotesRaw = (session as any).trainer_notes ?? (session as any).notes ?? '';
    const trainerNotes = typeof trainerNotesRaw === 'string' ? trainerNotesRaw : String(trainerNotesRaw ?? '');
    const dateRaw = (session as any).date;
    const date = typeof dateRaw === 'string' && dateRaw.trim()
      ? dateRaw
      : new Date().toISOString().slice(0, 10);

    return {
      date,
      trainingRows: rows,
      Training_Type: trainingType,
      strengthTrainingRow: strengthRows,
      strengthTrainingRowss: strengthRows,
      cardioTrainingRow: cardioRows,
      otherTrainingRow: otherRows,
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

  private normalizeRows(
    rowsCandidate: unknown,
    forcedType?: TrainingType,
    latestUserMessage?: string
  ): WorkoutTrainingRow[] {
    const rows = Array.isArray(rowsCandidate)
      ? rowsCandidate
      : rowsCandidate && typeof rowsCandidate === 'object'
        ? [rowsCandidate]
        : [];

    return rows
      .map((entry, index): WorkoutTrainingRow | null => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const row = entry as Record<string, unknown>;
        const trainingType = forcedType ??
          this.normalizeTrainingType(
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
        const rawWeight =
          row['displayed_weights_metric'] ??
          row['displayedWeight'] ??
          row['weights'] ??
          row['weight'];
        const displayedWeightsMetric = this.resolveDisplayedWeightMetric(
          row,
          rawWeight,
          latestUserMessage,
          index
        );
        const weightsKg = this.resolveWeightKgValue(row, rawWeight);
        const estimatedRowCalories = this.toNonNegativeNumber(
          row['estimated_calories'] ?? row['estimatedCalories'],
          0
        );

        return {
          Training_Type: trainingType,
          estimated_calories: estimatedRowCalories,
          exercise_type: exerciseType,
          sets,
          reps,
          displayed_weights_metric: displayedWeightsMetric,
          weights_kg: weightsKg,
        };
      })
      .filter((row): row is WorkoutTrainingRow => !!row);
  }

  private normalizeCardioRows(rowsCandidate: unknown, latestUserMessage?: string): CardioTrainingRow[] {
    const rows = this.toObjectArray(rowsCandidate);
    const latestDistanceText = this.extractDistanceMetricText(latestUserMessage);
    const latestTimeText = this.extractTimeMetricText(latestUserMessage);

    return rows.map((row, index) => {
      const cardioTypeRaw =
        row['cardio_type'] ??
        row['cardioType'] ??
        row['exercise_type'] ??
        row['exersice_type'] ??
        row['type'];
      const cardioTypeText = typeof cardioTypeRaw === 'string' ? cardioTypeRaw : '';
      const normalizedCardioType = this.exerciseEstimatorsService.normalizeEstimatorId(cardioTypeText) || 'cardio_activity';
      const distanceMeters = this.parseDistanceMeters(
        row['distance_meters'] ?? row['distance'] ?? row['meters']
      );
      const timeMinutes = this.parseTimeMinutes(
        row['time_minutes'] ?? row['time'] ?? row['minutes'] ?? row['duration']
      );
      const estimatedRowCalories = this.toNonNegativeNumber(
        row['estimated_calories'] ?? row['estimatedCalories'],
        0
      );

      const normalizedRow: CardioTrainingRow = {
        ...row,
        Training_Type: 'Cardio',
        estimated_calories: estimatedRowCalories,
        cardio_type: normalizedCardioType,
      };
      const displayDistance = this.resolveDisplayDistanceText(row) ??
        (index === 0 ? latestDistanceText : undefined);
      const displayTime = this.resolveDisplayTimeText(row) ??
        (index === 0 ? latestTimeText : undefined);

      if (typeof distanceMeters === 'number') {
        normalizedRow.distance_meters = distanceMeters;
      } else {
        delete normalizedRow.distance_meters;
      }

      if (typeof timeMinutes === 'number') {
        normalizedRow.time_minutes = timeMinutes;
      } else {
        delete normalizedRow.time_minutes;
      }

      if (displayDistance) {
        normalizedRow.display_distance = displayDistance;
      } else {
        delete normalizedRow.display_distance;
      }

      if (displayTime) {
        normalizedRow.display_time = displayTime;
      } else {
        delete normalizedRow.display_time;
      }

      return normalizedRow;
    });
  }

  private normalizeOtherRows(rowsCandidate: unknown): OtherTrainingRow[] {
    return this.toObjectArray(rowsCandidate).map((row) => {
      const estimatedRowCalories = this.toNonNegativeNumber(
        row['estimated_calories'] ?? row['estimatedCalories'],
        0
      );
      return {
        ...row,
        Training_Type: 'Other',
        estimated_calories: estimatedRowCalories,
      };
    });
  }

  private extractLegacyCardioRowsFromTrainingRows(rowsCandidate: unknown): Array<Record<string, unknown>> {
    return this.toObjectArray(rowsCandidate)
      .filter((row) =>
        this.normalizeTrainingType(
          row['Training_Type'] ?? row['training_type'] ?? row['trainingType']
        ) === 'Cardio'
      )
      .map((row) => ({
        cardio_type:
          row['cardio_type'] ??
          row['cardioType'] ??
          row['exercise_type'] ??
          row['exersice_type'] ??
          row['type'],
        display_distance:
          row['display_distance'] ??
          row['distance_input'] ??
          row['distanceText'] ??
          row['distance_text'],
        display_time:
          row['display_time'] ??
          row['time_input'] ??
          row['timeText'] ??
          row['time_text'],
        distance_meters:
          row['distance_meters'] ??
          row['distance'] ??
          row['meters'],
        time_minutes:
          row['time_minutes'] ??
          row['time'] ??
          row['minutes'] ??
          row['duration'] ??
          row['reps'],
        estimated_calories:
          row['estimated_calories'] ??
          row['estimatedCalories'],
      }));
  }

  private cardioRowsToTrainingRows(rows: CardioTrainingRow[]): WorkoutTrainingRow[] {
    return rows.map((row) => {
      const exerciseType = this.exerciseEstimatorsService.normalizeEstimatorId(row.cardio_type) || 'cardio_activity';
      const reps = this.toInteger(row.time_minutes ?? row.distance_meters, 0);
      return {
        Training_Type: 'Cardio',
        estimated_calories: this.toNonNegativeNumber(row.estimated_calories, 0),
        exercise_type: exerciseType,
        sets: 1,
        reps,
        displayed_weights_metric: 'bodyweight',
        weights_kg: 0,
      };
    });
  }

  private otherRowsToTrainingRows(rows: OtherTrainingRow[]): WorkoutTrainingRow[] {
    return rows.map((row) => {
      const sourceName =
        row['exercise_type'] ??
        row['exersice_type'] ??
        row['name'] ??
        row['activity'] ??
        row['type'];
      const sourceNameText = typeof sourceName === 'string' ? sourceName : '';
      const exerciseType = this.exerciseEstimatorsService.normalizeEstimatorId(sourceNameText) || 'other_activity';
      const sets = this.toInteger(row['sets'], 1);
      const reps = this.toInteger(row['reps'] ?? row['time'] ?? row['duration'] ?? 1, 1);
      const rawWeight =
        row['displayed_weights_metric'] ??
        row['weights'] ??
        row['weight'] ??
        row['load'];
      const estimatedRowCalories = this.toNonNegativeNumber(row['estimated_calories'], 0);
      return {
        Training_Type: 'Other',
        estimated_calories: estimatedRowCalories,
        exercise_type: exerciseType,
        sets,
        reps,
        displayed_weights_metric: this.resolveDisplayedWeightMetric(row, rawWeight, undefined, 0),
        weights_kg: this.resolveWeightKgValue(row, rawWeight),
      };
    });
  }

  private normalizeTrainingType(value: unknown): TrainingType {
    const text = String(value ?? '').trim().toLowerCase();
    if (text === 'strength') return 'Strength';
    if (text === 'cardio') return 'Cardio';
    return 'Other';
  }

  private toNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private toNonNegativeNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return parsed >= 0 ? parsed : fallback;
  }

  private toInteger(value: unknown, fallback: number): number {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private toPositiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private resolveDisplayDistanceText(row: Record<string, unknown>): string | undefined {
    return this.readMetricText(
      row['display_distance'] ??
      row['distance_input'] ??
      row['distanceText'] ??
      row['distance_text']
    );
  }

  private resolveDisplayTimeText(row: Record<string, unknown>): string | undefined {
    return this.readMetricText(
      row['display_time'] ??
      row['time_input'] ??
      row['timeText'] ??
      row['time_text']
    );
  }

  private resolveDisplayedWeightMetric(
    row: Record<string, unknown>,
    rawWeight: unknown,
    latestUserMessage?: string,
    rowIndex = 0
  ): string {
    const explicit = this.readMetricText(
      row['displayed_weights_metric'] ?? row['displayWeight']
    );
    if (explicit) {
      return explicit.toLowerCase().includes('body') ? 'bodyweight' : explicit;
    }

    const rawText = this.readMetricText(rawWeight);
    if (rawText) {
      if (rawText.toLowerCase().includes('body')) {
        return 'bodyweight';
      }
      if (/[a-z]/i.test(rawText)) {
        return rawText;
      }
    }

    const messageWeight = rowIndex === 0
      ? this.extractWeightMetricText(latestUserMessage)
      : undefined;
    if (messageWeight) {
      return messageWeight.toLowerCase().includes('body') ? 'bodyweight' : messageWeight;
    }

    return 'bodyweight';
  }

  private extractWeightMetricText(value: unknown): string | undefined {
    const text = this.readMetricText(value);
    if (!text) {
      return undefined;
    }

    if (text.toLowerCase().includes('body weight') || text.toLowerCase().includes('bodyweight')) {
      return 'bodyweight';
    }

    const match = text.match(
      /([0-9]*\.?[0-9]+)\s*(kg|kgs|kilogram|kilograms|lb|lbs|pound|pounds)\b/i
    );
    return match?.[0]?.trim();
  }

  private resolveWeightKgValue(row: Record<string, unknown>, rawWeight: unknown): number {
    const explicitKg = this.toPositiveNumber(row['weights_kg']);
    if (typeof explicitKg === 'number') {
      return explicitKg;
    }

    return this.parseWeightKg(rawWeight) ?? 0;
  }

  private parseWeightKg(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }

    const text = String(value ?? '').trim().toLowerCase();
    if (!text || text.includes('body')) {
      return undefined;
    }

    const match = text.match(
      /([0-9]*\.?[0-9]+)\s*(kg|kgs|kilogram|kilograms|lb|lbs|pound|pounds)?\b/
    );
    if (!match) {
      const parsed = Number(text);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }

    const amount = Number(match[1] ?? 0);
    const unit = String(match[2] ?? 'kg').toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) {
      return undefined;
    }

    if (unit === 'lb' || unit === 'lbs' || unit === 'pound' || unit === 'pounds') {
      return amount * 0.45359237;
    }

    return amount;
  }

  private extractDistanceMetricText(value: unknown): string | undefined {
    const text = this.readMetricText(value);
    if (!text) {
      return undefined;
    }

    const match = text.match(/([0-9]*\.?[0-9]+)\s*(mi|mile|miles|km|kilometer|kilometers|m|meter|meters)\b/i);
    return match?.[0]?.trim();
  }

  private extractTimeMetricText(value: unknown): string | undefined {
    const text = this.readMetricText(value);
    if (!text) {
      return undefined;
    }

    const match = text.match(/([0-9]*\.?[0-9]+)\s*(h|hr|hrs|hour|hours|min|mins|minute|minutes)\b/i);
    return match?.[0]?.trim();
  }

  private readMetricText(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const text = value.trim();
    return text ? text : undefined;
  }

  private refreshSummaryDisplayRows(): void {
    this.displayStrengthRows = this.normalizeRows(
      this.session.strengthTrainingRow ?? this.session.strengthTrainingRowss ?? [],
      'Strength'
    );
    this.displayCardioRows = this.normalizeCardioRows(this.session.cardioTrainingRow ?? []);
    this.displayOtherRows = this.normalizeRows(
      (this.session.trainingRows ?? []).filter((row) => row.Training_Type === 'Other'),
      'Other'
    );
  }

  formatStrengthMetric(row: WorkoutTrainingRow): string {
    const weightText = row.displayed_weights_metric || 'bodyweight';
    return `${row.sets} x ${row.reps} @ ${weightText}`;
  }

  formatOtherMetric(row: WorkoutTrainingRow): string {
    const weightText = row.displayed_weights_metric || 'bodyweight';
    return `${row.sets} x ${row.reps} @ ${weightText}`;
  }

  formatCardioMetric(row: CardioTrainingRow): string {
    const distanceText = this.getCardioDistanceText(row);
    const timeText = this.getCardioTimeText(row);

    if (distanceText && timeText) {
      return `${distanceText} in ${timeText}`;
    }
    if (distanceText) {
      return distanceText;
    }
    if (timeText) {
      return timeText;
    }
    return 'details pending';
  }

  private getCardioDistanceText(row: CardioTrainingRow): string | undefined {
    return this.readMetricText(row.display_distance);
  }

  private getCardioTimeText(row: CardioTrainingRow): string | undefined {
    return this.readMetricText(row.display_time);
  }

  private parseDistanceMeters(value: unknown): number | undefined {
    const direct = this.toPositiveNumber(value);
    if (typeof direct === 'number') {
      return direct;
    }

    const text = String(value ?? '').trim().toLowerCase();
    if (!text) {
      return undefined;
    }

    const match = text.match(/([0-9]*\.?[0-9]+)\s*(mi|mile|miles|km|kilometer|kilometers|m|meter|meters)\b/);
    if (!match) {
      return undefined;
    }

    const amount = Number(match[1] ?? 0);
    const unit = match[2] ?? '';
    if (!Number.isFinite(amount) || amount <= 0) {
      return undefined;
    }

    if (unit === 'mi' || unit === 'mile' || unit === 'miles') {
      return Math.round(amount * 1609.344);
    }
    if (unit === 'km' || unit === 'kilometer' || unit === 'kilometers') {
      return Math.round(amount * 1000);
    }
    return Math.round(amount);
  }

  private parseTimeMinutes(value: unknown): number | undefined {
    const direct = this.toPositiveNumber(value);
    if (typeof direct === 'number') {
      return direct;
    }

    const text = String(value ?? '').trim().toLowerCase();
    if (!text) {
      return undefined;
    }

    const match = text.match(/([0-9]*\.?[0-9]+)\s*(h|hr|hrs|hour|hours|min|mins|minute|minutes)\b/);
    if (!match) {
      return undefined;
    }

    const amount = Number(match[1] ?? 0);
    const unit = match[2] ?? '';
    if (!Number.isFinite(amount) || amount <= 0) {
      return undefined;
    }

    if (unit === 'h' || unit === 'hr' || unit === 'hrs' || unit === 'hour' || unit === 'hours') {
      return Math.round(amount * 60);
    }
    return Math.round(amount);
  }

  private toObjectArray(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object');
    }

    if (value && typeof value === 'object') {
      return [value as Record<string, unknown>];
    }

    return [];
  }

  private hasOwnKey(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  private resolveSessionTrainingType(
    source: Record<string, unknown>,
    strengthRows: WorkoutTrainingRow[],
    cardioRows: CardioTrainingRow[],
    otherRows: OtherTrainingRow[],
    flattenedRows: WorkoutTrainingRow[]
  ): TrainingType {
    if (this.hasOwnKey(source, 'Training_Type')) {
      return this.normalizeTrainingType(source['Training_Type']);
    }

    if (strengthRows.length > 0) return 'Strength';
    if (cardioRows.length > 0) return 'Cardio';
    if (otherRows.length > 0) return 'Other';
    return flattenedRows[0]?.Training_Type ?? 'Other';
  }

  private ensureEstimatedCaloriesAcrossRows(
    strengthRows: WorkoutTrainingRow[],
    cardioRows: CardioTrainingRow[],
    otherRows: OtherTrainingRow[],
    sessionEstimatedCalories: number
  ): void {
    const buckets = [
      ...strengthRows.map((row) => ({ read: () => row.estimated_calories, write: (value: number) => { row.estimated_calories = value; } })),
      ...cardioRows.map((row) => ({ read: () => row.estimated_calories, write: (value: number) => { row.estimated_calories = value; } })),
      ...otherRows.map((row) => ({ read: () => this.toNonNegativeNumber(row['estimated_calories'], 0), write: (value: number) => { row['estimated_calories'] = value; } })),
    ];

    if (buckets.length === 0) {
      return;
    }

    const missing = buckets.filter((bucket) => bucket.read() <= 0);
    if (missing.length === 0) {
      return;
    }

    const fallbackPerRow = sessionEstimatedCalories > 0
      ? Math.max(1, Math.round(sessionEstimatedCalories / buckets.length))
      : 0;

    missing.forEach((bucket) => {
      bucket.write(fallbackPerRow);
    });
  }

  private calculateTotalVolume(rows: WorkoutTrainingRow[]): number {
    return rows.reduce((total, row) => {
      if (typeof row.weights_kg !== 'number' || !Number.isFinite(row.weights_kg) || row.weights_kg <= 0) {
        return total;
      }
      return total + row.sets * row.reps * row.weights_kg;
    }, 0);
  }

  private rowsToLegacyExercises(rows: WorkoutTrainingRow[]) {
    return rows.map((row) => {
      const metricWeight = row.displayed_weights_metric || 'bodyweight';
      return {
        name: this.fromSnakeCase(row.exercise_type),
        metric: `${row.sets} x ${row.reps} @ ${metricWeight}`,
        volume: typeof row.weights_kg === 'number' ? row.sets * row.reps * row.weights_kg : 0,
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

  private logRowsToConsole(session: WorkoutSessionPerformance): void {
    const shared = {
      trainer_notes: session.trainer_notes,
      isComplete: !!session.isComplete,
    };

    const strengthRows = this.normalizeRows(
      session.strengthTrainingRow ?? session.strengthTrainingRowss ?? [],
      'Strength'
    );
    strengthRows.forEach((row, index) => {
      console.log(`[WorkoutChatbot][Strength Row ${index + 1}]`, {
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

    const cardioRows = this.normalizeCardioRows(session.cardioTrainingRow);
    cardioRows.forEach((row, index) => {
      console.log(`[WorkoutChatbot][Cardio Row ${index + 1}]`, {
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

    const otherRows = this.normalizeOtherRows(session.otherTrainingRow);
    otherRows.forEach((row, index) => {
      console.log(`[WorkoutChatbot][Other Row ${index + 1}]`, {
        ...shared,
        ...row,
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
