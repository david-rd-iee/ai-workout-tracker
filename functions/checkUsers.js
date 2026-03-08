/**
 * Quick script to check what users exist and their roles
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkUsers() {
  console.log('Checking users in database...\n');
  
  try {
    const usersSnapshot = await db.collection('users').limit(20).get();
    
    console.log(`Found ${usersSnapshot.size} users (showing first 20):\n`);
    
    const roleCounts = {};
    
    usersSnapshot.forEach(doc => {
      const data = doc.data();
      const role = data.role || 'no role';
      const name = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'No name';
      
      roleCounts[role] = (roleCounts[role] || 0) + 1;
      
      console.log(`- ${name} (${doc.id})`);
      console.log(`  Role: ${role}`);
      console.log('');
    });
    
    console.log('\n=== Role Summary ===');
    Object.entries(roleCounts).forEach(([role, count]) => {
      console.log(`${role}: ${count} users`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkUsers();
