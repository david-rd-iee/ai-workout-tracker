import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';

/**
 * One-time migration to populate trainer stats in userBadges
 * Call this function once to migrate existing trainer data
 */
export const migrateTrainerStats = onCall(async (request) => {
  console.log('[Migration] Starting trainer stats migration...');
  
  try {
    const db = admin.firestore();
    
    // Get all users with role 'trainer'
    const usersSnapshot = await db.collection('users')
      .where('role', '==', 'trainer')
      .get();
    
    console.log(`[Migration] Found ${usersSnapshot.size} trainers to migrate`);
    
    const migrationResults = [];
    
    for (const userDoc of usersSnapshot.docs) {
      const trainerId = userDoc.id;
      const trainerName = `${userDoc.data().firstName || ''} ${userDoc.data().lastName || ''}`.trim();
      
      try {
        // Get all bookings for this trainer
        const bookingsSnapshot = await db.collection('bookings')
          .where('trainerId', '==', trainerId)
          .get();
        
        // Calculate stats
        let totalSessions = 0;
        let totalRevenue = 0;
        const uniqueClients = new Set<string>();
        
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
          const clients = trainerClientsDoc.data()?.clients || [];
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
        console.log(`[Migration] ✓ Migrated ${trainerName}: ${totalSessions} sessions, ${finalClientCount} clients, $${totalRevenue}`);
        
      } catch (error) {
        console.error(`[Migration] ✗ Failed to migrate trainer ${trainerId}:`, error);
        migrationResults.push({
          trainerId,
          trainerName,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    const successCount = migrationResults.filter(r => r.success).length;
    const failCount = migrationResults.filter(r => !r.success).length;
    
    console.log(`[Migration] Complete! Success: ${successCount}, Failed: ${failCount}`);
    
    return {
      success: true,
      totalTrainers: usersSnapshot.size,
      migrated: successCount,
      failed: failCount,
      results: migrationResults
    };
    
  } catch (error) {
    console.error('[Migration] Fatal error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
