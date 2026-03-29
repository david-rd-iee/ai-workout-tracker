import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

type StatueLevel = 'rough' | 'outlined' | 'detailed' | 'polished' | 'gilded' | 'divine';

const STATUE_LEVELS: StatueLevel[] = [
  'rough',
  'outlined',
  'detailed',
  'polished',
  'gilded',
  'divine',
];

const TRAINER_STATUE_TIERS: Record<string, Record<StatueLevel, number>> = {
  'zeus-mentor': {
    rough: 5,
    outlined: 15,
    detailed: 30,
    polished: 50,
    gilded: 100,
    divine: 200,
  },
  'athena-wisdom': {
    rough: 50,
    outlined: 200,
    detailed: 500,
    polished: 1000,
    gilded: 2500,
    divine: 5000,
  },
  'hermes-prosperity': {
    rough: 1000,
    outlined: 5000,
    detailed: 15000,
    polished: 50000,
    gilded: 100000,
    divine: 250000,
  },
};

function getUserBadgeRef(userId: string, badgeId: string) {
  return admin.firestore().doc(`userStats/${userId}/Badges/${badgeId}`);
}

function calculateStatueProgress(statueId: string, currentValue: number): {
  currentLevel?: StatueLevel;
  nextTierValue?: number;
  progressToNext: number;
} {
  const tiers = TRAINER_STATUE_TIERS[statueId];
  if (!tiers) {
    return { progressToNext: 0 };
  }

  let currentLevel: StatueLevel | undefined;
  for (const level of [...STATUE_LEVELS].reverse()) {
    if (currentValue >= tiers[level]) {
      currentLevel = level;
      break;
    }
  }

  if (!currentLevel) {
    return {
      nextTierValue: tiers.rough,
      progressToNext: Math.min(100, Math.max(0, (currentValue / tiers.rough) * 100)),
    };
  }

  const currentIndex = STATUE_LEVELS.indexOf(currentLevel);
  if (currentIndex === STATUE_LEVELS.length - 1) {
    return {
      currentLevel,
      progressToNext: 100,
    };
  }

  const nextLevel = STATUE_LEVELS[currentIndex + 1];
  const nextTierValue = tiers[nextLevel];
  const currentTierValue = tiers[currentLevel];
  const progressToNext =
    ((currentValue - currentTierValue) / (nextTierValue - currentTierValue)) * 100;

  return {
    currentLevel,
    nextTierValue,
    progressToNext: Math.min(100, Math.max(0, progressToNext)),
  };
}

async function saveTrainerBadgeDoc(userId: string, badgeId: string, currentValue: number): Promise<void> {
  const badgeRef = getUserBadgeRef(userId, badgeId);
  const existingSnap = await badgeRef.get();
  const existingData = existingSnap.exists ? existingSnap.data() ?? {} : {};
  const normalizedValue = Number.isFinite(currentValue) ? currentValue : 0;
  const progress = calculateStatueProgress(badgeId, normalizedValue);

  await badgeRef.set(
    {
      isDisplayed: existingData['isDisplayed'] === true,
      currentValue: normalizedValue,
      ...(progress.currentLevel ? { currentLevel: progress.currentLevel } : {}),
      ...(progress.nextTierValue !== undefined ? { nextTierValue: progress.nextTierValue } : {}),
      progressToNext: progress.progressToNext,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Updates trainer statistics when a booking is created or updated
 * Tracks: total sessions completed, total revenue, total clients
 */
export const onBookingChange = onDocumentWritten('bookings/{bookingId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();

  if (!after?.trainerId) return;

  const trainerId = after.trainerId;

  const statusChanged = before?.status !== after?.status;
  const priceChanged = before?.price !== after?.price;
  const shouldUpdate = statusChanged || priceChanged;

  if (!shouldUpdate) return;

  console.log(`[TrainerStats] Updating stats for trainer ${trainerId}`);

  try {
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('trainerId', '==', trainerId)
      .get();

    let totalSessions = 0;
    let totalRevenue = 0;
    const uniqueClients = new Set<string>();

    bookingsSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.status === 'completed') {
        totalSessions++;
        totalRevenue += (data.price || 0);
      }
      if (data.clientId) {
        uniqueClients.add(data.clientId);
      }
    });

    const totalClients = uniqueClients.size;

    await Promise.all([
      saveTrainerBadgeDoc(trainerId, 'zeus-mentor', totalClients),
      saveTrainerBadgeDoc(trainerId, 'athena-wisdom', totalSessions),
      saveTrainerBadgeDoc(trainerId, 'hermes-prosperity', totalRevenue),
    ]);

    console.log(
      `[TrainerStats] Updated trainer ${trainerId}: ${totalSessions} sessions, ${totalClients} clients, $${totalRevenue} revenue`
    );
  } catch (error) {
    console.error('[TrainerStats] Error updating trainer stats:', error);
    throw error;
  }
});

/**
 * Updates trainer client count when a new client relationship is established
 * This provides an alternative/backup to counting from bookings
 */
export const onTrainerClientChange = onDocumentWritten(
  'trainers/{trainerId}/clients/{clientId}',
  async (event) => {
    const trainerId = event.params.trainerId;
    const clientsSnapshot = await admin.firestore()
      .collection(`trainers/${trainerId}/clients`)
      .get();
    const totalClients = clientsSnapshot.size;

    console.log(`[TrainerStats] Updating client count for trainer ${trainerId}: ${totalClients} clients`);

    try {
      await saveTrainerBadgeDoc(trainerId, 'zeus-mentor', totalClients);
    } catch (error) {
      console.error('[TrainerStats] Error updating trainer client count:', error);
      throw error;
    }
  }
);
