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
    
    // Strategy 2: Find users who have trainerClients documents
    console.log('[Migration] Finding trainers from trainerClients...');
    const trainerClientsSnapshot = await db.collection('trainerClients').get();
    trainerClientsSnapshot.forEach(doc => {
      trainerIds.add(doc.id);
    });
    
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
        
        // Also check trainerClients collection for additional client count
        const trainerClientsDoc = await db.doc(`trainerClients/${trainerId}`).get();
        let clientsFromCollection = 0;
        if (trainerClientsDoc.exists) {
          const clients = trainerClientsDoc.data().clients || [];
          clientsFromCollection = clients.length;
        }
        
        // Use the higher count (in case trainerClients has more accurate data)
        const finalClientCount = Math.max(totalClients, clientsFromCollection);
        
        // Update userBadges
        const userBadgesRef = db.doc(`userBadges/${trainerId}`);
        
        await userBadgesRef.set({
          values: {
            'zeus-mentor': finalClientCount,
            'athena-wisdom': totalSessions,
            'hermes-prosperity': totalRevenue
          },
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          migratedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
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
