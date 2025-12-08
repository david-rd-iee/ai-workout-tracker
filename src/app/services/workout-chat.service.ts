import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { WorkoutSessionPerformance } from '../models/workout-session.model';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequestPayload {
  message: string;
  session: WorkoutSessionPerformance;
  history: ChatHistoryMessage[];
}

export interface ChatResponse {
  botMessage: string;
  updatedSession?: WorkoutSessionPerformance;
}

@Injectable({
  providedIn: 'root',
})
export class WorkoutChatService {
  private apiUrl =
    'https://us-central1-ai-fitness-f8ed4.cloudfunctions.net/workoutChat';

  constructor(private http: HttpClient) {}

  sendMessage(payload: ChatRequestPayload): Promise<ChatResponse> {
    console.log('Sending payload to workoutChat:', payload);

    return firstValueFrom(
      this.http.post<ChatResponse>(this.apiUrl, payload)
    );
  }
}
