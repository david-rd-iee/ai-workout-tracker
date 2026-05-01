import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource, type Photo } from '@capacitor/camera';
import {
  AlertController,
  IonButton,
  IonContent,
  IonSpinner,
  IonText,
  Platform,
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
import type { ScoreUpdateResult, StreakUpdateResult } from '../../services/workout-log.service';
import { WorkoutWorkflowService } from '../../services/workout-workflow/workout-workflow.service';
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
  private readonly platform = inject(Platform);

  readonly machineTypeOptions: MachineTypeOption[] = [
    { label: 'Treadmill', value: 'running' },
    { label: 'Exercise Bike', value: 'biking' },
    { label: 'Rowing Machine', value: 'rowing' },
    { label: 'Elliptical', value: 'elliptical' },
    { label: 'Stair Climber', value: 'stairs' },
    { label: 'Other Cardio', value: 'generic_cardio' },
  ];

  photoDataUrl = '';
  statusMessage = 'Take a clear photo of your treadmill screen, then send it for analysis to review the summary.';
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

  async showCaptureInstructions(): Promise<void> {
    const alert = await this.alertController.create({
      mode: 'ios',
      header: 'Quick photo guide',
      subHeader: 'Get the best workout read in under a minute',
      cssClass: 'capture-instructions-alert',
      message: this.buildCaptureInstructionsMessage(),
      buttons: ['Got it'],
      translucent: true,
    });

    await alert.present();
  }

  private buildCaptureInstructionsMessage(): string {
    return [
      'Before you take the photo:',
      '• Pick your machine type.',
      '• Make sure the display is bright and in focus.',
      '',
      'How to log your workout:',
      '1. Tap "Take Treadmill Photo".',
      '2. Capture the full display (time, distance, calories).',
      '3. Tap "Send Photo for Analysis" to generate your summary.',
      '4. Review the details, then tap "Save Workout".',
      '',
      'If the results look off:',
      '• Retake the photo with less glare.',
      '• Keep your phone steady and centered on the screen.',
      '• Ensure the numbers are clearly visible.',
    ].join('\n');
  }

  async captureTreadmillPhoto(): Promise<void> {
    if (this.isCapturing || this.isAnalyzing || this.isSavingWorkout) {
      return;
    }

    this.isCapturing = true;
    this.errorMessage = '';

    try {
      const hasCameraPermission = await this.ensureCameraPermission();
      if (!hasCameraPermission) {
        this.errorMessage = 'Camera permission is required on iPhone. Please allow access in Settings and try again.';
        return;
      }

      const photo = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: this.isNativeIPhone() ? CameraSource.Camera : CameraSource.Prompt,
        correctOrientation: true,
        width: 1600,
        webUseInput: !Capacitor.isNativePlatform(),
      });

      const dataUrl = await this.toDataUrl(photo);
      if (!dataUrl) {
        throw new Error('No image data was captured.');
      }

      this.photoDataUrl = dataUrl;
      this.session = this.createEmptySession();
      this.statusMessage = 'Photo ready. Tap Send Photo for Analysis to review the extracted summary.';
    } catch (error) {
      if (!this.isUserCancellation(error)) {
        console.error('[TreadmillLoggerPage] Failed to capture treadmill photo:', error);
        this.errorMessage = 'Camera capture failed. Please try again.';
      }
    } finally {
      this.isCapturing = false;
    }
  }

  private async ensureCameraPermission(): Promise<boolean> {
    if (!this.isNativeIPhone()) {
      return true;
    }

    const currentPermissions = await Camera.checkPermissions();
    if (currentPermissions.camera === 'granted') {
      return true;
    }

    const requestedPermissions = await Camera.requestPermissions({
      permissions: ['camera'],
    });
    return requestedPermissions.camera === 'granted';
  }

  private async toDataUrl(photo: Photo): Promise<string> {
    const existingDataUrl = String(photo.dataUrl ?? '').trim();
    if (existingDataUrl) {
      return existingDataUrl;
    }

    const base64 = String(photo.base64String ?? '').trim();
    if (base64) {
      return `data:image/jpeg;base64,${base64}`;
    }

    const sourcePath = String(photo.webPath ?? photo.path ?? '').trim();
    if (!sourcePath) {
      return '';
    }

    const response = await fetch(sourcePath);
    if (!response.ok) {
      throw new Error('Captured photo could not be loaded for upload.');
    }

    const blob = await response.blob();
    return this.blobToDataUrl(blob);
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(typeof reader.result === 'string' ? reader.result : '');
      };
      reader.onerror = () => reject(new Error('Failed to read captured photo data.'));
      reader.readAsDataURL(blob);
    });
  }

  private isNativeIPhone(): boolean {
    return Capacitor.isNativePlatform() && this.platform.is('iphone');
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
      this.statusMessage = response.botMessage?.trim() ||
        'Your treadmill workout summary is ready to review.';

      if (this.cardioRows.length === 0) {
        this.errorMessage = 'AI could not read enough treadmill data from that image. Please retake the photo.';
      }
    } catch (error) {
      console.error('[TreadmillLoggerPage] Failed to analyze treadmill image:', error);
      this.errorMessage = 'AI analysis failed. Please try again.';
      this.statusMessage = 'Take another treadmill photo and tap Send Photo for Analysis again.';
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

      if (result.saveStatus !== 'saved' || !result.loggedAt) {
        return;
      }

      await this.router.navigate(['/workout-summary'], {
        state: {
          summary: result.session,
          loggedAt: result.loggedAt,
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
      this.statusMessage = 'Take a clear photo of your cardio machine screen, then send it for analysis to review the summary.';
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

  private buildScoreUpdateMessage(scoreUpdate: ScoreUpdateResult): string {
    const lines = scoreUpdate.exerciseScoreDeltas.map((entry) => (
      `${this.formatExerciseName(entry.exerciseType)}: ${this.formatSignedScore(entry.addedScore)}`
    ));

    lines.push(`Total Added: ${this.formatSignedScore(scoreUpdate.addedTotalScore)}`);
    lines.push('');
    lines.push(`New Total: ${this.formatScoreValue(scoreUpdate.currentTotalScore)}`);

    return lines.join('\n');
  }

  private async showScoreUpdateAlert(scoreUpdate: ScoreUpdateResult): Promise<void> {
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
