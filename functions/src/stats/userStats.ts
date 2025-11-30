import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

export const onWorkoutSessionCreate = onDocumentCreated('workoutSessions/{sessionId}', async (event) => {
  const session = event.data?.data();
  if (!session) return;

  const userId = session.userId;
  const statsRef = admin.firestore().doc(`userStats/${userId}`);
  const statsSnap = await statsRef.get();
  const current = statsSnap.data() || {};

  await statsRef.set({
    totalWorkScore: (current.totalWorkScore || 0) + (session.workScore || 0),
    lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
});

