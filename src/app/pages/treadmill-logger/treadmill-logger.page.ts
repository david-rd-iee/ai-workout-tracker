import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import {
  AlertController,
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonSpinner,
  IonText,
} from '@ionic/angular/standalone';
import { HeaderComponent } from '../../components/header/header.component';
import {
  CardioTrainingRow,
  SummaryExercise,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../../models/workout-session.model';
import { ExerciseEstimatorsService } from '../../services/exercise-estimators.service';
import { WorkoutChatService } from '../../services/workout-chat.service';
import type { StreakUpdateResult } from '../../services/workout-log.service';
import type { UpdateScoreResult } from '../../services/update-score.service';
import { WorkoutWorkflowService } from '../../services/workout-workflow.service';
import { WorkoutSessionFormatterService } from '../../services/workout-session-formatter.service';

interface MachineTypeOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-treadmill-logger',
  standalone: true,
  templateUrl: './treadmill-logger.page.html',
  styleUrls: ['./treadmill-logger.page.scss'],
  imports: [
    CommonModule,
    IonButton,
    IonCard,
    IonCardContent,
    IonContent,
    IonSpinner,
    IonText,
    HeaderComponent,
  ],
})
export class TreadmillLoggerPage {
  private readonly workoutChatService = inject(WorkoutChatService);
  private readonly workoutWorkflowService = inject(WorkoutWorkflowService);
  private readonly exerciseEstimatorsService = inject(ExerciseEstimatorsService);
  private readonly router = inject(Router);
  private readonly alertController = inject(AlertController);
  private readonly workoutSessionFormatter = inject(WorkoutSessionFormatterService);

  readonly machineTypeOptions: MachineTypeOption[] = [
    { label: 'Treadmill', value: 'running' },
    { label: 'Exercise Bike', value: 'biking' },
    { label: 'Rowing Machine', value: 'rowing' },
    { label: 'Elliptical', value: 'elliptical' },
    { label: 'Stair Climber', value: 'stairs' },
    { label: 'Other Cardio', value: 'generic_cardio' },
  ];

  photoDataUrl = '';
  statusMessage = 'Take a clear photo of your treadmill screen, then log the workout to review the summary.';
  errorMessage = '';
  isCapturing = false;
  isAnalyzing = false;
  isSavingWorkout = false;
  selectedMachineType = this.machineTypeOptions[0].value;
  session: WorkoutSessionPerformance = this.createEmptySession();

  get cardioRows(): CardioTrainingRow[] {
    const rows = this.session.cardioTrainingRow;
    if (Array.isArray(rows)) {
      return rows;
    }
    return rows ? [rows] : [];
  }

  get hasAnalyzedWorkout(): boolean {
    return this.cardioRows.length > 0;
  }

  async captureTreadmillPhoto(): Promise<void> {
    if (this.isCapturing || this.isAnalyzing || this.isSavingWorkout) {
      return;
    }

    this.isCapturing = true;
    this.errorMessage = '';

    try {
      const photo = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        correctOrientation: true,
        width: 1600,
        webUseInput: true,
      });

      const dataUrl = String(photo.dataUrl ?? '').trim();
      if (!dataUrl) {
        throw new Error('No image data was captured.');
      }

      this.photoDataUrl = dataUrl;
      this.session = this.createEmptySession();
      this.statusMessage = 'Photo ready. Tap Log Workout to review the extracted summary.';
    } catch (error) {
      if (!this.isUserCancellation(error)) {
        console.error('[TreadmillLoggerPage] Failed to capture treadmill photo:', error);
        this.errorMessage = 'Camera capture failed. Please try again.';
      }
    } finally {
      this.isCapturing = false;
    }
  }

  async analyzePhoto(): Promise<void> {
    if (!this.photoDataUrl || this.isAnalyzing || this.isSavingWorkout) {
      return;
    }

    this.isAnalyzing = true;
    this.errorMessage = '';
    this.statusMessage = 'Reading treadmill display...';

    try {
      const response = await this.workoutChatService.analyzeTreadmillImage({
        imageDataUrl: this.photoDataUrl,
        machineType: this.selectedMachineType,
      });
      const nextSession = this.normalizeSession(
        response.updatedSession,
        this.selectedMachineType
      );
      this.session = nextSession;
      this.logSessionJsonToConsole(this.session, this.selectedMachineType);
      this.statusMessage = response.botMessage?.trim() ||
        'Your treadmill workout summary is ready to review.';

      if (this.cardioRows.length === 0) {
        this.errorMessage = 'AI could not read enough treadmill data from that image. Please retake the photo.';
      }
    } catch (error) {
      console.error('[TreadmillLoggerPage] Failed to analyze treadmill image:', error);
      this.errorMessage = 'AI analysis failed. Please try again.';
      this.statusMessage = 'Take another treadmill photo and tap Log Workout again.';
    } finally {
      this.isAnalyzing = false;
    }
  }

  async logWorkout(): Promise<void> {
    if (!this.hasAnalyzedWorkout || this.isSavingWorkout || this.isAnalyzing) {
      return;
    }

    this.isSavingWorkout = true;
    this.errorMessage = '';

    try {
      const result = await this.workoutWorkflowService.submitWorkout({
        session: this.session,
        requestTrainerNotes: (initialValue) => this.promptForTrainerNotes(initialValue),
      });
      this.session = result.session;

      if (!result.hasSavedWorkout || !result.savedWorkoutLoggedAt) {
        return;
      }

      await this.router.navigate(['/workout-summary'], {
        state: {
          summary: result.session,
          loggedAt: result.savedWorkoutLoggedAt,
          backHref: '/treadmill-logger',
        },
      });
    } catch (error) {
      console.error('[TreadmillLoggerPage] Failed to save treadmill workout:', error);
      this.errorMessage = 'The treadmill workout could not be saved. Please try again.';
    } finally {
      this.isSavingWorkout = false;
    }
  }

  private createEmptySession(): WorkoutSessionPerformance {
    return this.workoutSessionFormatter.createEmptySession();
  }

  private normalizeSession(
    candidate: Partial<WorkoutSessionPerformance> | null | undefined,
    machineTypeFallback?: string
  ): WorkoutSessionPerformance {
    return this.workoutSessionFormatter.normalizeSession(candidate, {
      cardioTypeFallback: machineTypeFallback,
      defaultDate: new Date().toISOString().slice(0, 10),
      isComplete: false,
    });
  }

  private async promptForTrainerNotes(initialValue: string): Promise<string | null> {
    return new Promise(async (resolve) => {
      const alert = await this.alertController.create({
        mode: 'ios',
        header: 'Trainer Notes',
        message: 'Add any notes for your trainer before this workout is saved.',
        inputs: [
          {
            name: 'trainerNotes',
            type: 'textarea',
            value: initialValue,
            placeholder: 'How did the workout feel? Anything your trainer should know?',
          },
        ],
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => resolve(null),
          },
          {
            text: 'Continue',
            handler: (data) => {
              resolve(String(data?.trainerNotes ?? '').trim());
            },
          },
        ],
        translucent: true,
      });

      await alert.present();
    });
  }

  private normalizeCardioRows(
    rowsCandidate: unknown,
    machineTypeFallback?: string
  ): CardioTrainingRow[] {
    const rows = this.toObjectArray(rowsCandidate);

    return rows.map((row) => {
      const cardioTypeRaw =
        row['cardio_type'] ??
        row['cardioType'] ??
        row['exercise_type'] ??
        row['type'];
      const cardioTypeText = typeof cardioTypeRaw === 'string' ? cardioTypeRaw : '';
      const normalizedCardioType =
        this.exerciseEstimatorsService.normalizeEstimatorId(cardioTypeText) ||
        this.exerciseEstimatorsService.normalizeEstimatorId(machineTypeFallback ?? '') ||
        'generic_cardio';
      const distanceMeters = this.parseDistanceMeters(
        row['distance_meters'] ?? row['distance'] ?? row['meters']
      );
      const timeMinutes = this.parseTimeMinutes(
        row['time_minutes'] ?? row['time'] ?? row['minutes'] ?? row['duration']
      );
      const normalizedRow: CardioTrainingRow = {
        ...row,
        Training_Type: 'Cardio',
        estimated_calories: this.toNonNegativeNumber(
          row['estimated_calories'] ?? row['estimatedCalories'],
          0
        ),
        cardio_type: normalizedCardioType,
      };
      const displayDistance = this.readMetricText(
        row['display_distance'] ??
        row['distance_input'] ??
        row['distanceText'] ??
        row['distance_text']
      );
      const displayTime = this.readMetricText(
        row['display_time'] ??
        row['time_input'] ??
        row['timeText'] ??
        row['time_text']
      );

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

  selectMachineType(machineType: string): void {
    if (this.isAnalyzing || this.isSavingWorkout) {
      return;
    }

    this.selectedMachineType = machineType;
    if (!this.photoDataUrl) {
      this.statusMessage = 'Take a clear photo of your cardio machine screen, then log the workout to review the summary.';
    }
  }

  private cardioRowsToTrainingRows(rows: CardioTrainingRow[]): WorkoutTrainingRow[] {
    return rows.map((row) => ({
      Training_Type: 'Cardio',
      estimated_calories: this.toNonNegativeNumber(row.estimated_calories, 0),
      exercise_type:
        this.exerciseEstimatorsService.normalizeEstimatorId(row.cardio_type) || 'treadmill',
      sets: 1,
      reps: Math.floor(
        Number(row.time_minutes ?? row.distance_meters ?? row.time ?? row.distance ?? 0)
      ),
      displayed_weights_metric: 'bodyweight',
      weights_kg: 0,
    }));
  }

  private cardioRowsToSummaryExercises(rows: CardioTrainingRow[]): SummaryExercise[] {
    return rows.map((row) => ({
      name: this.formatExerciseName(row.cardio_type),
      metric: this.formatCardioMetric(row),
      volume: 0,
    }));
  }

  private formatCardioMetric(row: CardioTrainingRow): string {
    const distanceText = this.readMetricText(
      row.display_distance ??
      row['distance_input'] ??
      row['distanceText'] ??
      row['distance_text']
    );
    const timeText = this.readMetricText(
      row.display_time ??
      row['time_input'] ??
      row['timeText'] ??
      row['time_text']
    );

    if (distanceText && timeText) {
      return `${distanceText} in ${timeText}`;
    }
    return distanceText || timeText || 'Treadmill workout';
  }

  formatExerciseName(value: string): string {
    return String(value ?? '')
      .split('_')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }

  formatCardioDistance(row: CardioTrainingRow): string {
    return this.readMetricText(
      row.display_distance ??
      row['distance_input'] ??
      row['distanceText'] ??
      row['distance_text']
    ) || 'N/A';
  }

  formatCardioTime(row: CardioTrainingRow): string {
    return this.readMetricText(
      row.display_time ??
      row['time_input'] ??
      row['timeText'] ??
      row['time_text']
    ) || 'N/A';
  }

  private readMetricText(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const text = value.trim();
    return text ? text : undefined;
  }

  private toObjectArray(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object'
      );
    }

    if (value && typeof value === 'object') {
      return [value as Record<string, unknown>];
    }

    return [];
  }

  private toPositiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private toNonNegativeNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return parsed >= 0 ? parsed : fallback;
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

    const match = text.match(
      /([0-9]*\.?[0-9]+)\s*(mi|mile|miles|km|kilometer|kilometers|m|meter|meters)\b/
    );
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

    const match = text.match(
      /([0-9]*\.?[0-9]+)\s*(h|hr|hrs|hour|hours|min|mins|minute|minutes)\b/
    );
    if (!match) {
      return undefined;
    }

    const amount = Number(match[1] ?? 0);
    const unit = match[2] ?? '';
    if (!Number.isFinite(amount) || amount <= 0) {
      return undefined;
    }

    if (
      unit === 'h' ||
      unit === 'hr' ||
      unit === 'hrs' ||
      unit === 'hour' ||
      unit === 'hours'
    ) {
      return Math.round(amount * 60);
    }
    return Math.round(amount);
  }

  private isUserCancellation(error: unknown): boolean {
    const text = error instanceof Error ? error.message : String(error ?? '');
    return /cancel/i.test(text);
  }

  private logSessionJsonToConsole(
    session: WorkoutSessionPerformance,
    machineType: string
  ): void {
    const debugJson = {
      cardioTrainingRow: this.cardioRows.map((row) => ({
        Training_Type: 'Cardio' as const,
        estimated_calories: this.toNonNegativeNumber(row.estimated_calories, 0),
        cardio_type: this.exerciseEstimatorsService.normalizeEstimatorId(row.cardio_type) ||
          this.exerciseEstimatorsService.normalizeEstimatorId(machineType) ||
          'generic_cardio',
        display_distance: row.display_distance ?? '',
        display_time: row.display_time ?? '',
        distance_meters: this.toPositiveNumber(row.distance_meters ?? row.distance) ?? 0,
        time_minutes: this.toPositiveNumber(row.time_minutes ?? row.time) ?? 0,
      })),
      estimated_calories: this.toNonNegativeNumber(
        session.estimated_calories ?? session.calories,
        0
      ),
      trainer_notes: session.trainer_notes ?? '',
      isComplete: !!session.isComplete,
    };

    console.log('[TreadmillLogger] Parsed cardio JSON:', debugJson);
    console.log('[TreadmillLogger] Parsed cardio JSON string:', JSON.stringify(debugJson, null, 2));
  }

  private roundToTwoDecimals(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private formatScoreValue(value: number): string {
    return String(this.roundToTwoDecimals(value));
  }

  private formatSignedScore(value: number): string {
    const rounded = this.roundToTwoDecimals(value);
    const absoluteValue = this.formatScoreValue(Math.abs(rounded));
    return `${rounded < 0 ? '-' : '+'} ${absoluteValue}`;
  }

  private buildScoreUpdateMessage(scoreUpdate: UpdateScoreResult): string {
    const lines = scoreUpdate.exerciseScoreDeltas.map((entry) => (
      `${this.formatExerciseName(entry.exerciseType)}: ${this.formatSignedScore(entry.addedScore)}`
    ));

    lines.push(`Total Added: ${this.formatSignedScore(scoreUpdate.addedTotalScore)}`);
    lines.push('');
    lines.push(`New Total: ${this.formatScoreValue(scoreUpdate.currentTotalScore)}`);

    return lines.join('\n');
  }

  private async showScoreUpdateAlert(scoreUpdate: UpdateScoreResult): Promise<void> {
    const alert = await this.alertController.create({
      mode: 'ios',
      header: 'Score Updated',
      cssClass: 'score-update-alert',
      message: this.buildScoreUpdateMessage(scoreUpdate),
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
        message: ['Nice work, your streak just grew.', ...lines].join('\n'),
      };
    }

    return {
      header: 'Streak Started',
      message: ['Your workout streak has started.', ...lines].join('\n'),
    };
  }

  private formatStreakDays(value: number): string {
    const safeValue = Math.max(0, Math.floor(Number(value) || 0));
    return `${safeValue} day${safeValue === 1 ? '' : 's'}`;
  }
}
