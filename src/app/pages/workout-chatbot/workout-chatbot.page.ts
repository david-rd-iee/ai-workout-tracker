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
  WorkoutWorkflowViewState,
  WorkoutWorkflowService,
} from '../../services/workout-workflow.service';

type ChatSender = 'bot' | 'user';

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
  displayStrengthRows: WorkoutTrainingRow[] = [];
  displayCardioRows: CardioTrainingRow[] = [];
  displayOtherRows: WorkoutTrainingRow[] = [];

  hasSavedWorkout = false;
  isSavingWorkout = false;
  savedWorkoutLoggedAt: string | null = null;

  private isIPhone = false;
  private removeKeyboardListeners: Array<() => void> = [];
  private readonly workoutWorkflowService = inject(WorkoutWorkflowService);

  session: WorkoutSessionPerformance = this.workoutWorkflowService.createInitialState().session;

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

    this.applyWorkflowViewState(this.workoutWorkflowService.createInitialState());
    this.addBotMessage(
      'Hey! Ready to log your workout? Include exercise, sets/reps, weight (kg or bodyweight), and I will turn it into training rows.'
    );

    this.isIPhone = this.platform.is('iphone');
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
    return this.showLiveSummary || this.hasSavedWorkout;
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
        session: this.session,
        hasSavedWorkout: this.hasSavedWorkout,
        savedWorkoutLoggedAt: this.savedWorkoutLoggedAt,
      });

      this.applyWorkflowViewState(result);

      this.addBotMessage(result.botMessage);
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

      this.applyWorkflowViewState(result);

      if (!result.hasSavedWorkout || !result.savedWorkoutLoggedAt) {
        return;
      }

      this.addBotMessage(
        'Workout submitted and saved to your history. Stats and summaries will finish updating in the background.'
      );
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

  private applyWorkflowViewState(state: WorkoutWorkflowViewState): void {
    this.session = state.session;
    this.displayStrengthRows = state.summaryRows.strengthRows;
    this.displayCardioRows = state.summaryRows.cardioRows;
    this.displayOtherRows = state.summaryRows.otherRows;
    this.hasSavedWorkout = state.hasSavedWorkout;
    this.savedWorkoutLoggedAt = state.savedWorkoutLoggedAt;
  }

  private readText(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const text = value.trim();
    return text ? text : undefined;
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
    if (!window.visualViewport) {
      return;
    }

    const updateOffset = () => {
      const viewport = window.visualViewport;
      if (!viewport) {
        return;
      }

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
