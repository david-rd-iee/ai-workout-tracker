import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { WorkoutSessionPerformance } from '../models/workout-session.model';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequestPayload {
  message: string;
  session: WorkoutSessionPerformance;
  history: ChatHistoryMessage[];
  exerciseEstimatorIds: string[];
}

export interface ChatResponse {
  botMessage: string;
  updatedSession?: WorkoutSessionPerformance;
}

@Injectable({
  providedIn: 'root',
})
export class WorkoutChatService {
  private readonly callableName = 'workoutChatCallable';
  private apiUrl =
    'https://us-central1-ai-fitness-f8ed4.cloudfunctions.net/workoutChat';

  constructor(private http: HttpClient) {}

  async sendMessage(payload: ChatRequestPayload): Promise<ChatResponse> {
    console.log('Sending payload to workoutChat:', payload);

    try {
      const functions = getFunctions(undefined, 'us-central1');
      const callable = httpsCallable<ChatRequestPayload, ChatResponse>(
        functions,
        this.callableName
      );
      const response = await callable(payload);
      return response.data;
    } catch (callableError) {
      console.warn(
        '[WorkoutChatService] Callable workout chat failed; falling back to HTTP endpoint.',
        callableError
      );

      return firstValueFrom(
        this.http.post<ChatResponse>(this.apiUrl, payload)
      );
    }
  }
}
