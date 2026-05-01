import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AlertController,
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
} from '@ionic/angular/standalone';
import { Platform } from '@ionic/angular';
import { Router } from '@angular/router';
import { addIcons } from 'ionicons';
import { arrowUp, fitnessOutline } from 'ionicons/icons';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { HeaderComponent } from '../../components/header/header.component';
import {
  CardioTrainingRow,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../../models/workout-session.model';
import {
  WorkoutChatScreenState,
  WorkoutWorkflowService,
} from '../../services/workout-workflow/workout-workflow.service';
import type { ScoreUpdateResult } from '../../services/workout-log.service';

type ChatSender = 'bot' | 'user';

interface AssignedWorkoutContext {
  id: string;
  title: string;
  dueDateLabel: string;
  statusLabel: string;
  exerciseCount: number;
  durationMinutes: number;
  notes: string;
  trainerName: string;
}

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
  backHref = '/logging-method-routes';
  assignedWorkout: AssignedWorkoutContext | null = null;
  displayStrengthRows: WorkoutTrainingRow[] = [];
  displayCardioRows: CardioTrainingRow[] = [];
  displayOtherRows: WorkoutTrainingRow[] = [];

  hasSavedWorkout = false;
  isSavingWorkout = false;
  savedWorkoutLoggedAt: string | null = null;

  private isIPhone = false;
  private isIPadLike = false;
  private supportsOnScreenKeyboard = false;
  private removeKeyboardListeners: Array<() => void> = [];
  private readonly workoutWorkflowService = inject(WorkoutWorkflowService);
  private screenState: WorkoutChatScreenState = this.workoutWorkflowService.createInitialState();

  session: WorkoutSessionPerformance = this.screenState.session;

  constructor(
    private router: Router,
    private platform: Platform,
    private alertController: AlertController
  ) {
    addIcons({ fitnessOutline, arrowUp });
  }

  ngOnInit(): void {
    this.isSavingWorkout = false;
    this.messages = [];
    this.loadNavigationState();

    this.applyScreenState(this.workoutWorkflowService.createInitialState());
    this.addBotMessage(
      'Hey! Ready to log your workout? Include exercise, sets/reps, weight (kg or bodyweight), and I will turn it into training rows.'
    );

    this.isIPhone = this.platform.is('iphone');
    this.isIPadLike = this.platform.is('ipad') || (this.platform.is('tablet') && this.platform.is('ios'));
    this.supportsOnScreenKeyboard = this.detectOnScreenKeyboardSupport();
    this.initKeyboardBehavior();
  }

  ngOnDestroy(): void {
    this.removeKeyboardListeners.forEach((remove) => remove());
    this.removeKeyboardListeners = [];
  }

  get showLiveSummary(): boolean {
    return (this.session.trainingRows.length > 0 || this.isLoading) && !this.hasSavedWorkout;
  }

  get showSummaryPanel(): boolean {
    return this.showLiveSummary || this.hasSavedWorkout || !!this.assignedWorkout;
  }

  get hasUserMessages(): boolean {
    return this.messages.some((message) => message.from === 'user');
  }

  addBotMessage(text: string): void {
    this.messages.push({ from: 'bot', text });
  }

  addUserMessage(text: string): void {
    this.messages.push({ from: 'user', text });
  }

  async handleSend(): Promise<void> {
    const text = this.userInput.trim();
    if (!text) {
      return;
    }

    this.addUserMessage(text);
    this.userInput = '';
    this.isLoading = true;

    try {
      const result = await this.workoutWorkflowService.processWorkoutMessage({
        message: text,
        messages: this.messages,
        screenState: this.screenState,
      });

      this.applyScreenState(result);
    } catch (error) {
      console.error('Error talking to AI backend:', error);
      this.addBotMessage('Oops, something went wrong while talking to the AI. Try again in a moment.');
    } finally {
      this.isLoading = false;
    }
  }

  async submitWorkout(): Promise<void> {
    if (this.isSavingWorkout) {
      return;
    }

    if (this.hasSavedWorkout) {
      this.addBotMessage('Your workout is already submitted.');
      return;
    }

    this.isSavingWorkout = true;

    try {
      const result = await this.workoutWorkflowService.submitWorkout({
        session: this.session,
        requestTrainerNotes: (initialValue) => this.promptForTrainerNotes(initialValue),
      });

      this.applyScreenState(result);

      if (result.saveStatus !== 'saved' || !result.loggedAt) {
        return;
      }
    } catch (error) {
      console.error('Failed to save workout:', error);
      this.addBotMessage('I had trouble saving your workout. Please try again.');
    } finally {
      this.isSavingWorkout = false;
    }
  }

  viewWorkoutSummary(): void {
    void this.router.navigate(['/workout-summary'], {
      state: {
        summary: this.session,
        loggedAt: this.savedWorkoutLoggedAt,
      },
    });
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

  formatStrengthMetric(row: WorkoutTrainingRow): string {
    const weightText = row.displayed_weights_metric || 'bodyweight';
    return `${row.sets} x ${row.reps} @ ${weightText}`;
  }

  formatOtherMetric(row: WorkoutTrainingRow): string {
    const weightText = row.displayed_weights_metric || 'bodyweight';
    return `${row.sets} x ${row.reps} @ ${weightText}`;
  }

  formatCardioMetric(row: CardioTrainingRow): string {
    const distanceText = this.readText(row.display_distance);
    const timeText = this.readText(row.display_time);

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

  private applyScreenState(state: WorkoutChatScreenState): void {
    this.screenState = state;
    this.session = state.session;
    this.displayStrengthRows = state.summaryRows.strengthRows;
    this.displayCardioRows = state.summaryRows.cardioRows;
    this.displayOtherRows = state.summaryRows.otherRows;
    this.hasSavedWorkout = state.saveStatus === 'saved';
    this.savedWorkoutLoggedAt = state.loggedAt;

    if (state.botMessage) {
      this.addBotMessage(state.botMessage);
    }
  }

  private loadNavigationState(): void {
    const navigation = this.router.getCurrentNavigation();
    const state = (navigation?.extras.state || window.history.state || {}) as Record<string, unknown>;

    const backHref = this.readText(state['backHref']);
    if (backHref) {
      this.backHref = backHref;
    }

    const assignedWorkout = state['assignedWorkout'];
    if (assignedWorkout && typeof assignedWorkout === 'object' && !Array.isArray(assignedWorkout)) {
      const workout = assignedWorkout as Record<string, unknown>;
      this.assignedWorkout = {
        id: this.readText(workout['id']) || '',
        title: this.readText(workout['title']) || 'Assigned Workout',
        dueDateLabel: this.readText(workout['dueDateLabel']) || 'Due date not set',
        statusLabel: this.readText(workout['statusLabel']) || 'Assigned',
        exerciseCount: Math.max(0, Number(workout['exerciseCount'] || 0) || 0),
        durationMinutes: Math.max(0, Number(workout['durationMinutes'] || 0) || 0),
        notes: this.readText(workout['notes']) || '',
        trainerName: this.readText(workout['trainerName']) || '',
      };
    }
  }

  private readText(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const text = value.trim();
    return text ? text : undefined;
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

  private formatExerciseName(value: string): string {
    return String(value ?? '')
      .split('_')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }

  private buildScoreUpdateMessage(scoreUpdate: ScoreUpdateResult): string {
    const lines = scoreUpdate.exerciseScoreDeltas.map((entry) => (
      `${this.formatExerciseName(entry.exerciseType)}: ${this.formatSignedScore(entry.addedScore)}`
    ));

    lines.push(`Cardio Added: ${this.formatSignedScore(scoreUpdate.addedCardioScore)}`);
    lines.push(`Strength Added: ${this.formatSignedScore(scoreUpdate.addedStrengthScore)}`);
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

  private initKeyboardBehavior(): void {
    if (!this.supportsOnScreenKeyboard) {
      this.keyboardOffset = 0;
      return;
    }

    if (this.isIPhone) {
      this.keyboardOffset = 0;
      return;
    }

    if (Capacitor.isNativePlatform()) {
      void this.bindNativeKeyboardListeners();
      this.bindWebViewportKeyboardListeners();
      return;
    }

    this.bindWebViewportKeyboardListeners();
  }

  private async bindNativeKeyboardListeners(): Promise<void> {
    const showHandler = (info: { keyboardHeight: number }) => {
      const nativeOffset = this.normalizeKeyboardOffset(info?.keyboardHeight ?? 0);
      const viewportOffset = this.getViewportKeyboardOffset();

      if (this.isIPadLike) {
        // External keyboards on iPad can trigger native keyboard events even when no software keyboard is shown.
        // Only move the composer when the viewport actually shrinks.
        this.keyboardOffset = viewportOffset;
        return;
      }

      this.keyboardOffset = Math.max(nativeOffset, viewportOffset);
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
    if (!window.visualViewport) {
      return;
    }

    const updateOffset = () => {
      const viewportOffset = this.getViewportKeyboardOffset();

      if (this.isIPadLike) {
        this.keyboardOffset = viewportOffset;
        return;
      }

      if (Capacitor.isNativePlatform()) {
        this.keyboardOffset = Math.max(this.keyboardOffset, viewportOffset);
        return;
      }

      this.keyboardOffset = viewportOffset;
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

  private normalizeKeyboardOffset(offset: number): number {
    const roundedOffset = Math.max(0, Math.round(offset || 0));
    // Ignore tiny viewport changes (browser chrome, window jiggle) that are not real software keyboards.
    return roundedOffset >= 120 ? roundedOffset : 0;
  }

  private getViewportKeyboardOffset(): number {
    if (typeof window === 'undefined' || !window.visualViewport) {
      return 0;
    }

    return this.normalizeKeyboardOffset(
      window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop
    );
  }

  private detectOnScreenKeyboardSupport(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false;
    }

    if (this.platform.is('desktop')) {
      return false;
    }

    const hasTouchPoints = (navigator.maxTouchPoints ?? 0) > 0;
    const hasCoarsePointer = typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
    const mobileLikePlatform = this.platform.is('mobile')
      || this.platform.is('tablet')
      || this.platform.is('hybrid')
      || Capacitor.isNativePlatform();

    return mobileLikePlatform || hasTouchPoints || hasCoarsePointer;
  }
}
