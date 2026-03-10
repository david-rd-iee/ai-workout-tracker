import { registerPlugin } from '@capacitor/core';

export interface WorkoutSessionPlugin {
  checkAvailability(): Promise<{ available: boolean }>;
  requestAuthorization(): Promise<{ authorized: boolean }>;
  startWorkout(): Promise<{ started: boolean }>;
  stopWorkout(): Promise<{ stopped: boolean; saved: boolean }>;
  addListener(
    eventName: 'heartRateUpdate',
    listenerFunc: (data: { heartRate: number; timestamp: string }) => void
  ): Promise<any>;
  addListener(
    eventName: 'workoutStateChanged',
    listenerFunc: (data: { state: string }) => void
  ): Promise<any>;
  addListener(
    eventName: 'workoutError',
    listenerFunc: (data: { error: string }) => void
  ): Promise<any>;
  removeAllListeners(): Promise<void>;
}

const WorkoutSession = registerPlugin<WorkoutSessionPlugin>('WorkoutSession');

export default WorkoutSession;
