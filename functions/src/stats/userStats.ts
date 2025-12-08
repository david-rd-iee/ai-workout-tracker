import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

interface WorkoutSession {
  userId: string;
  workoutType: 'strength' | 'cardio';
  exercises: Array<{
    sets?: number;
    reps?: number;
    weight?: number; // in kg
    duration?: number; // in minutes
    distance?: number; // in km
    intensity?: number; // 1-10 scale
  }>;
  workScore?: number;
}

function calculateWorkScore(session: WorkoutSession): number {
  if (session.workScore) {
    return session.workScore; // Use pre-calculated score if available
  }

  let score = 0;
  
  if (session.workoutType === 'strength') {
    // For strength training: score based on volume (sets * reps * weight)
    score = session.exercises.reduce((total, exercise) => {
      const volume = (exercise.sets || 0) * (exercise.reps || 0) * (exercise.weight || 0);
      return total + volume;
    }, 0) / 100; // Normalize the score to a reasonable range
  } else if (session.workoutType === 'cardio') {
    // For cardio: score based on duration and intensity
    score = session.exercises.reduce((total, exercise) => {
      const durationScore = (exercise.duration || 0) * 2; // Base score from duration
      const intensityMultiplier = (exercise.intensity || 5) / 5; // Scale from 0.2 to 2.0
      return total + (durationScore * intensityMultiplier);
    }, 0);
  }
  
  return Math.round(score);
}

export const onWorkoutSessionCreate = onDocumentCreated('workoutSessions/{sessionId}', async (event) => {
  const session = event.data?.data() as WorkoutSession | undefined;
  if (!session || !session.userId) return;

  const userId = session.userId;
  const statsRef = admin.firestore().doc(`userStats/${userId}`);
  const statsSnap = await statsRef.get();
  const current = statsSnap.data() || {};
  
  // Calculate work score for this session
  const workScore = calculateWorkScore(session);
  
  // Prepare updates
  const updates: Record<string, any> = {
    totalWorkScore: (current.totalWorkScore || 0) + workScore,
    lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  
  // Update specific workout type score
  if (session.workoutType === 'strength') {
    updates.strengthWorkScore = (current.strengthWorkScore || 0) + workScore;
  } else if (session.workoutType === 'cardio') {
    updates.cardioWorkScore = (current.cardioWorkScore || 0) + workScore;
  }
  
  // Update the document
  await statsRef.set(updates, { merge: true });
});

