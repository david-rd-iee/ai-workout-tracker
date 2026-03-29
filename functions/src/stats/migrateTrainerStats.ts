import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';

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

async function saveTrainerBadgeDoc(
  db: FirebaseFirestore.Firestore,
  userId: string,
  badgeId: string,
  currentValue: number,
  migratedAt: FirebaseFirestore.FieldValue
): Promise<void> {
  const badgeRef = db.doc(`userStats/${userId}/Badges/${badgeId}`);
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
      migratedAt,
    },
    { merge: true }
  );
}

/**
 * One-time migration to populate trainer stats in /userStats/{userId}/Badges/{badgeId}
 * Call this function once to migrate existing trainer data
 */
export const migrateTrainerStats = onCall(async () => {
  console.log('[Migration] Starting trainer stats migration...');

  try {
    const db = admin.firestore();

    const usersSnapshot = await db.collection('users')
      .where('role', '==', 'trainer')
      .get();

    console.log(`[Migration] Found ${usersSnapshot.size} trainers to migrate`);

    const migrationResults = [];

    for (const userDoc of usersSnapshot.docs) {
      const trainerId = userDoc.id;
      const trainerName = `${userDoc.data().firstName || ''} ${userDoc.data().lastName || ''}`.trim();

      try {
        const bookingsSnapshot = await db.collection('bookings')
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

        const trainerClientsSnapshot = await db
          .collection(`trainers/${trainerId}/clients`)
          .get();
        const clientsFromCollection = trainerClientsSnapshot.size;

        const finalClientCount = Math.max(totalClients, clientsFromCollection);
        const migratedAt = admin.firestore.FieldValue.serverTimestamp();

        await Promise.all([
          saveTrainerBadgeDoc(db, trainerId, 'zeus-mentor', finalClientCount, migratedAt),
          saveTrainerBadgeDoc(db, trainerId, 'athena-wisdom', totalSessions, migratedAt),
          saveTrainerBadgeDoc(db, trainerId, 'hermes-prosperity', totalRevenue, migratedAt),
        ]);

        const result = {
          trainerId,
          trainerName,
          totalSessions,
          totalClients: finalClientCount,
          totalRevenue,
          success: true,
        };

        migrationResults.push(result);
        console.log(
          `[Migration] ✓ Migrated ${trainerName}: ${totalSessions} sessions, ${finalClientCount} clients, $${totalRevenue}`
        );
      } catch (error) {
        console.error(`[Migration] ✗ Failed to migrate trainer ${trainerId}:`, error);
        migrationResults.push({
          trainerId,
          trainerName,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = migrationResults.filter((result) => result.success).length;
    const failCount = migrationResults.filter((result) => !result.success).length;

    console.log(`[Migration] Complete! Success: ${successCount}, Failed: ${failCount}`);

    return {
      success: true,
      totalTrainers: usersSnapshot.size,
      migrated: successCount,
      failed: failCount,
      results: migrationResults,
    };
  } catch (error) {
    console.error('[Migration] Fatal error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});
