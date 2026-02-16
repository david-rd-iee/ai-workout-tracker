import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { WorkoutSessionPerformance } from '../models/workout-session.model';

@Injectable({ providedIn: 'root' })
export class WorkoutLogService {
  constructor(
    private firestore: Firestore,
    private auth: Auth
  ) {}

  async saveCompletedWorkout(session: WorkoutSessionPerformance) {
    const user = this.auth.currentUser;

    if (!user) {
      throw new Error('User not authenticated');
    }

    // Path: users/{uid}/workoutLogs
    const workoutLogsRef = collection(
      this.firestore,
      `users/${user.uid}/workoutLogs`
    );

    return addDoc(workoutLogsRef, {
      createdAt: serverTimestamp(),
      calories: session.calories,
      totalVolume: session.volume,
      notes: session.notes ?? '',
      exercises: session.exercises ?? [],
      source: 'ai_logger',
      version: 1,
    });
  }
}