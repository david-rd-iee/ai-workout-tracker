// imports
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonFooter,
  IonItem,
  IonInput,
  IonButton,
  IonList,
  IonLabel,
} from '@ionic/angular/standalone';

import {
  WorkoutSessionPerformance,
} from '../../models/workout-session.model';

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
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonFooter,
    IonItem,
    IonInput,
    IonButton,
    IonList,
    IonLabel,
  ],
})
export class WorkoutChatbotPage implements OnInit {
  userInput = '';
  messages: ChatMessage[] = [];
  isLoading = false;

  // structured session object the AI can update
  session: WorkoutSessionPerformance = {
    date: new Date().toISOString().slice(0, 10), // yyyy-mm-dd
    sessionType: '',
    exercises: [],
  };

  constructor(
    private router: Router,
    private workoutChatService: WorkoutChatService
  ) {}

  ngOnInit() {
    this.addBotMessage(
      "Hey! I’m your AI workout assistant. Tell me about your session and I’ll help clean it up and log it for your trainer."
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
    console.log('handleSend() called, raw input =', this.userInput);
    const text = this.userInput.trim();
    if (!text) {
      console.log('Empty or whitespace-only message, ignoring.');
      return;
    }

    // show user message immediately
    this.addUserMessage(text);
    this.userInput = '';

    this.isLoading = true;

    try {
      const response: ChatResponse =
        await this.workoutChatService.sendMessage({
          message: text,
          session: this.session,
          history: this.buildHistory(),
        });

      // update session if backend/AI changed it
      if (response.updatedSession) {
        this.session = response.updatedSession;
        console.log('Updated session:', this.session);
      }

      // show bot reply
      if (response.botMessage) {
        this.addBotMessage(response.botMessage);
      } else {
        // fallback if backend didn't send text
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
}
