import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

/**
 * Updates trainer statistics when a booking is created or updated
 * Tracks: total sessions completed, total revenue, total clients
 */
export const onBookingChange = onDocumentWritten('bookings/{bookingId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  
  if (!after?.trainerId) return;
  
  const trainerId = after.trainerId;
  
  // Only process if status changed to/from 'completed' or if price changed
  const statusChanged = before?.status !== after?.status;
  const priceChanged = before?.price !== after?.price;
  const shouldUpdate = statusChanged || priceChanged;
  
  if (!shouldUpdate) return;
  
  console.log(`[TrainerStats] Updating stats for trainer ${trainerId}`);
  
  try {
    // Query all bookings for this trainer
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('trainerId', '==', trainerId)
      .get();
    
    // Calculate completed sessions and revenue
    let totalSessions = 0;
    let totalRevenue = 0;
    const uniqueClients = new Set<string>();
    
    bookingsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.status === 'completed') {
        totalSessions++;
        totalRevenue += (data.price || 0);
      }
      // Count all clients (not just completed bookings)
      if (data.clientId) {
        uniqueClients.add(data.clientId);
      }
    });
    
    const totalClients = uniqueClients.size;
    
    // Update userBadges document
    const userBadgesRef = admin.firestore().doc(`userBadges/${trainerId}`);
    
    await userBadgesRef.set({
      values: {
        'zeus-mentor': totalClients,
        'athena-wisdom': totalSessions,
        'hermes-prosperity': totalRevenue
      },
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    console.log(`[TrainerStats] Updated trainer ${trainerId}: ${totalSessions} sessions, ${totalClients} clients, $${totalRevenue} revenue`);
    
  } catch (error) {
    console.error('[TrainerStats] Error updating trainer stats:', error);
    throw error;
  }
});

/**
 * Updates trainer client count when a new client relationship is established
 * This provides an alternative/backup to counting from bookings
 */
export const onTrainerClientChange = onDocumentWritten('trainerClients/{trainerId}', async (event) => {
  const data = event.data?.after?.data();
  
  if (!data) return;
  
  const trainerId = event.params.trainerId;
  const clients = data.clients || [];
  const totalClients = clients.length;
  
  console.log(`[TrainerStats] Updating client count for trainer ${trainerId}: ${totalClients} clients`);
  
  try {
    const userBadgesRef = admin.firestore().doc(`userBadges/${trainerId}`);
    
    await userBadgesRef.set({
      values: {
        'zeus-mentor': totalClients
      },
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
  } catch (error) {
    console.error('[TrainerStats] Error updating trainer client count:', error);
    throw error;
  }
});
