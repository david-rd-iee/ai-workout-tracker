/**
 * Local script to migrate trainer stats directly using Firebase Admin SDK
 * 
 * Setup: Set the GOOGLE_APPLICATION_CREDENTIALS environment variable
 * 
 * Windows PowerShell:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="path\to\serviceAccountKey.json"
 *   node runMigration.js
 * 
 * Or download service account key from Firebase Console and save as serviceAccountKey.json
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Try to load service account key if it exists
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

if (fs.existsSync(serviceAccountPath)) {
  console.log('Using service account key from serviceAccountKey.json\n');
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.log('Using GOOGLE_APPLICATION_CREDENTIALS environment variable\n');
  admin.initializeApp({
    projectId: 'ai-fitness-f8ed4'
  });
} else {
  console.error('ERROR: No credentials found!');
  console.error('\nOption 1: Download service account key');
  console.error('  1. Go to: https://console.firebase.google.com/project/ai-fitness-f8ed4/settings/serviceaccounts/adminsdk');
  console.error('  2. Click "Generate new private key"');
  console.error('  3. Save as: functions/serviceAccountKey.json');
  console.error('  4. Run: node runMigration.js');
  console.error('\nOption 2: Set environment variable');
  console.error('  PowerShell: $env:GOOGLE_APPLICATION_CREDENTIALS="path\\to\\key.json"');
  process.exit(1);
}

const db = admin.firestore();
const STATUE_LEVELS = ['rough', 'outlined', 'detailed', 'polished', 'gilded', 'divine'];
const TRAINER_STATUE_TIERS = {
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

function calculateStatueProgress(statueId, currentValue) {
  const tiers = TRAINER_STATUE_TIERS[statueId];
  if (!tiers) {
    return { progressToNext: 0 };
  }

  let currentLevel;
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
  const progressToNext = ((currentValue - currentTierValue) / (nextTierValue - currentTierValue)) * 100;

  return {
    currentLevel,
    nextTierValue,
    progressToNext: Math.min(100, Math.max(0, progressToNext)),
  };
}

async function saveTrainerBadgeDoc(userId, badgeId, currentValue, migratedAt) {
  const badgeRef = db.doc(`userStats/${userId}/Badges/${badgeId}`);
  const existingSnap = await badgeRef.get();
  const existingData = existingSnap.exists ? existingSnap.data() || {} : {};
  const normalizedValue = Number.isFinite(currentValue) ? currentValue : 0;
  const progress = calculateStatueProgress(badgeId, normalizedValue);

  await badgeRef.set({
    isDisplayed: existingData.isDisplayed === true,
    currentValue: normalizedValue,
    ...(progress.currentLevel ? { currentLevel: progress.currentLevel } : {}),
    ...(progress.nextTierValue !== undefined ? { nextTierValue: progress.nextTierValue } : {}),
    progressToNext: progress.progressToNext,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    migratedAt,
  }, { merge: true });
}

async function migrateTrainerStats() {
  console.log('[Migration] Starting trainer stats migration...\n');
  
  try {
    // Strategy 1: Find users who have bookings as trainerId
    console.log('[Migration] Finding trainers from bookings...');
    const bookingsSnapshot = await db.collection('bookings').limit(1000).get();
    const trainerIds = new Set();
    
    bookingsSnapshot.forEach(doc => {
      const trainerId = doc.data().trainerId;
      if (trainerId) {
        trainerIds.add(trainerId);
      }
    });
    
    // Strategy 2: Find users who have trainer client subcollection docs
    console.log('[Migration] Finding trainers from trainers/*/clients...');
    const trainersSnapshot = await db.collection('trainers').get();
    for (const trainerDoc of trainersSnapshot.docs) {
      const clientsSnapshot = await db.collection(`trainers/${trainerDoc.id}/clients`).limit(1).get();
      if (!clientsSnapshot.empty) {
        trainerIds.add(trainerDoc.id);
      }
    }
    
    console.log(`[Migration] Found ${trainerIds.size} unique trainers to migrate\n`);
    
    if (trainerIds.size === 0) {
      console.log('No trainers found. Migration complete.');
      process.exit(0);
    }
    
    const migrationResults = [];
    
    for (const trainerId of trainerIds) {
      // Get trainer name from users collection
      let trainerName = 'Unknown';
      try {
        const userDoc = await db.doc(`users/${trainerId}`).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          trainerName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || trainerId;
        }
      } catch (e) {
        trainerName = trainerId;
      }
      
      try {
        // Get all bookings for this trainer
        const bookingsSnapshot = await db.collection('bookings')
          .where('trainerId', '==', trainerId)
          .get();
        
        // Calculate stats
        let totalSessions = 0;
        let totalRevenue = 0;
        const uniqueClients = new Set();
        
        bookingsSnapshot.forEach(doc => {
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
        
        // Also check trainers/{trainerId}/clients subcollection for additional client count
        const trainerClientsSnapshot = await db.collection(`trainers/${trainerId}/clients`).get();
        const clientsFromCollection = trainerClientsSnapshot.size;
        
        // Use the higher count (in case the trainer clients subcollection has more accurate data)
        const finalClientCount = Math.max(totalClients, clientsFromCollection);
        
        const migratedAt = admin.firestore.FieldValue.serverTimestamp();

        await Promise.all([
          saveTrainerBadgeDoc(trainerId, 'zeus-mentor', finalClientCount, migratedAt),
          saveTrainerBadgeDoc(trainerId, 'athena-wisdom', totalSessions, migratedAt),
          saveTrainerBadgeDoc(trainerId, 'hermes-prosperity', totalRevenue, migratedAt),
        ]);
        
        const result = {
          trainerId,
          trainerName,
          totalSessions,
          totalClients: finalClientCount,
          totalRevenue,
          success: true
        };
        
        migrationResults.push(result);
        console.log(`✓ ${trainerName}: ${totalSessions} sessions, ${finalClientCount} clients, $${totalRevenue.toFixed(2)}`);
        
      } catch (error) {
        console.error(`✗ Failed to migrate trainer ${trainerId}:`, error.message);
        migrationResults.push({
          trainerId,
          trainerName,
          success: false,
          error: error.message
        });
      }
    }
    
    const successCount = migrationResults.filter(r => r.success).length;
    const failCount = migrationResults.filter(r => !r.success).length;
    
    console.log('\n=== Migration Complete ===');
    console.log(`Total: ${trainerIds.size} trainers`);
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${failCount}`);
    
    if (failCount > 0) {
      console.log('\nFailed migrations:');
      migrationResults.filter(r => !r.success).forEach(r => {
        console.log(`  - ${r.trainerName} (${r.trainerId}): ${r.error}`);
      });
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('[Migration] Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the migration
migrateTrainerStats();
