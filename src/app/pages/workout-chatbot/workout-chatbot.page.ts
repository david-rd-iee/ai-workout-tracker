// imports
import { WorkoutLogService } from '../../services/workout-log.service';
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonInput, IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { fitnessOutline } from 'ionicons/icons';

import { WorkoutSessionPerformance } from '../../models/workout-session.model';

import { Router } from '@angular/router';
import {
  WorkoutChatService,
  ChatHistoryMessage,
  ChatResponse,
} from '../../services/workout-chat.service';

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
  imports: [CommonModule, FormsModule, IonInput, IonButton, IonIcon],
})
export class WorkoutChatbotPage implements OnInit {
  userInput = '';
  messages: ChatMessage[] = [];
  isLoading = false;

  // Save guards
  hasSavedWorkout = false;
  isSavingWorkout = false;

  // structured session/summary object the AI can update
  session: WorkoutSessionPerformance = {
    date: new Date().toISOString().slice(0, 10), // yyyy-mm-dd
    sessionType: '',
    notes: '',
    volume: 0,
    calories: 0,
    exercises: [],
    isComplete: false,
  };

  constructor(
    private router: Router,
    private workoutChatService: WorkoutChatService,
    private workoutLogService: WorkoutLogService
  ) {
    addIcons({ fitnessOutline });
  }

  ngOnInit() {
    // New page load = new workout attempt
    this.hasSavedWorkout = false;
    this.isSavingWorkout = false;

    this.addBotMessage(
      "Hey! Ready to log your workout? Tell me your first exercise (name, sets, reps, weight) and I’ll organize everything for your trainer."
    );
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
      const response: ChatResponse = await this.workoutChatService.sendMessage({
        message: text,
        session: this.session,
        history: this.buildHistory(),
      });

      // If the previous session was complete, and now it's not complete,
      // assume user is starting a new workout -> allow saving again.
      const wasComplete = !!this.session?.isComplete;

      if (response.updatedSession) {
        this.session = response.updatedSession as WorkoutSessionPerformance;
      }

      const isNowComplete = !!this.session?.isComplete;

      if (wasComplete && !isNowComplete) {
        this.hasSavedWorkout = false;
      }

      // Auto-save the workout as soon as AI marks this session complete.
      if (!wasComplete && isNowComplete && !this.hasSavedWorkout) {
        await this.persistCurrentWorkout();
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

  async navigateToWorkoutSummary() {
    // Don’t allow multiple clicks while saving
    if (this.isSavingWorkout) return;

    if (!this.session?.isComplete) {
      this.addBotMessage(
        'Finish logging your workout first, then I’ll save it and show the summary.'
      );
      return;
    }

    if (!this.hasSavedWorkout) {
      const didSave = await this.persistCurrentWorkout();
      if (!didSave) return;
    }

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
}
