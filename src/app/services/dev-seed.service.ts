// src/app/services/dev-seed.service.ts
import { Injectable } from '@angular/core';
import {
  Auth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  User,
} from '@angular/fire/auth';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Database, ref, set, push, get } from '@angular/fire/database';
import { ChatsService } from './chats.service';

// Allowed dev group scenarios
type DevGroupScenario = 'none' | 'pt' | 'friends' | 'both';

@Injectable({
  providedIn: 'root',
})
export class DevSeedService {
  // Dev-only credentials for your fake user
  private readonly devEmail = 'dev-tester@example.com';
  private readonly devPassword = 'devtester123';
  
  // Trainer dev credentials
  private readonly devTrainerEmail = 'dev-trainer@example.com';
  private readonly devTrainerPassword = 'devtrainer123';

  // 'none'    -> no groups
  // 'pt'      -> only PT group
  // 'friends' -> only friends group
  // 'both'    -> PT + friends
  private readonly devGroupScenario: DevGroupScenario = 'none';

  private readonly ptGroupId = 'DEV_PT_GROUP';
  private readonly friendsGroupId = 'DEV_FRIENDS_GROUP';

  constructor(
    private auth: Auth,
    private firestore: Firestore,
    private db: Database,
    private chatsService: ChatsService,
  ) {}

  /**
   * Ensures there is a dev user in Firebase Auth and
   * that /users/{uid}, /userStats/{uid}, group membership,
   * and dummy leaderboard users exist.
   */
  async ensureDevUserAndSeed(): Promise<void> {
    console.log('[DevSeedService] ensureDevUserAndSeed() starting...');
    let user: User | null = null;

    // 1) Sign in or create the dev auth user
    try {
      const cred = await signInWithEmailAndPassword(
        this.auth,
        this.devEmail,
        this.devPassword,
      );
      user = cred.user;
      console.log(
        '[DevSeedService] Signed in existing dev user:',
        user.uid,
      );
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found') {
        console.log(
          '[DevSeedService] Dev user not found, creating new one...',
        );
        const cred = await createUserWithEmailAndPassword(
          this.auth,
          this.devEmail,
          this.devPassword,
        );
        user = cred.user;
        console.log('[DevSeedService] Created dev user:', user.uid);
      } else {
        console.error('[DevSeedService] Error signing in dev user:', err);
        throw err;
      }
    }

    if (!user) {
      throw new Error(
        '[DevSeedService] Dev user is null after sign-in/sign-up',
      );
    }

    const uid = user.uid;
    console.log('[DevSeedService] Using dev UID:', uid);

    // 2) Ensure /users/{uid} exists
    const userRef = doc(this.firestore, 'users', uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      console.log(
        '[DevSeedService] Creating /users doc for dev user...',
      );
      await setDoc(userRef, {
        userId: uid,
        name: 'Dev Test User',
        email: this.devEmail,
        isPT: false,
        ptUID: '',
        groups: [],
        region: {
          country: 'USA',
          state: 'Nevada',
          city: 'Reno',
        },
        created_at: serverTimestamp(),
      });
    } else {
      console.log(
        '[DevSeedService] /users doc already exists for dev user.',
      );
      // Make sure region exists on existing dev user as well
      await setDoc(
        userRef,
        {
          region: {
            country: 'USA',
            state: 'Nevada',
            city: 'Reno',
          },
        },
        { merge: true },
      );
    }

    // 3) Ensure /userStats/{uid} exists
    const statsRef = doc(this.firestore, 'userStats', uid);
    const statsSnap = await getDoc(statsRef);

    if (!statsSnap.exists()) {
      console.log(
        '[DevSeedService] Creating /userStats doc for dev user...',
      );
      await setDoc(statsRef, {
        userId: uid,
        displayName: 'Dev Test User',
        total_work_score: 1500,
        cardio_work_score: 900,
        strength_work_score: 600,
        level: 7,
        region: {
          country: 'USA',
          state: 'Nevada',
          city: 'Reno',
        },
        last_updated_at: serverTimestamp(),
      });
    } else {
      console.log('[DevSeedService] /users doc already exists for dev user.');

      // Ensure required fields exist even if the doc was created earlier with a different schema
      await setDoc(
        userRef,
        {
          userId: uid,
          name: 'Dev Test User',
          email: this.devEmail,
          isPT: false,
          ptUID: '',
          // don't force groups here if you want membership logic to control it later
          region: {
            country: 'USA',
            state: 'Nevada',
            city: 'Reno',
          },
        },
        { merge: true },
      );
    }


    // 4) Ensure dev groups + membership
    await this.ensureDevGroupsAndMembership(uid);

    // 5) Seed dummy userStats docs for leaderboard testing
    await this.seedDummyUserStats();

    // 6) Seed dev badges for profile page
    await this.seedDevBadges(uid);

    console.log('[DevSeedService] ensureDevUserAndSeed() finished.');
  }

  /**
   * Ensures dev PT + friends groups exist in /groupID
   * and sets the dev user's `groups` array based on devGroupScenario.
   *
   * Groups themselves are never deleted; only the user's membership array changes.
   */
  private async ensureDevGroupsAndMembership(uid: string): Promise<void> {
    console.log(
      '[DevSeedService] ensureDevGroupsAndMembership() with scenario:',
      this.devGroupScenario,
    );

    const groupsCollectionName = 'groupID';
    const userRef = doc(this.firestore, 'users', uid);

    const ptGroupRef = doc(this.firestore, groupsCollectionName, this.ptGroupId);
    const friendsGroupRef = doc(this.firestore, groupsCollectionName, this.friendsGroupId);

    // For PT scenarios ('pt' or 'both'), ensure PT group doc exists
    if (this.devGroupScenario === 'pt' || this.devGroupScenario === 'both') {
      const ptGroupSnap = await getDoc(ptGroupRef);
      if (!ptGroupSnap.exists()) {
        console.log('[DevSeedService] Creating PT group doc...');
        await setDoc(ptGroupRef, {
          groupId: this.ptGroupId,
          name: 'Dev PT Group',
          isPTGroup: true,
          ownerUserId: uid,
          created_at: serverTimestamp(),
        });
      } else {
        console.log('[DevSeedService] PT group doc already exists.');
      }
    }

    // For friends scenarios ('friends' or 'both'), ensure friends group doc exists
    if (this.devGroupScenario === 'friends' || this.devGroupScenario === 'both') {
      const friendsGroupSnap = await getDoc(friendsGroupRef);
      if (!friendsGroupSnap.exists()) {
        console.log('[DevSeedService] Creating friends group doc...');
        await setDoc(friendsGroupRef, {
          groupId: this.friendsGroupId,
          name: 'Dev Friends Group',
          isPTGroup: false,
          ownerUserId: uid,
          created_at: serverTimestamp(),
        });
      } else {
        console.log('[DevSeedService] Friends group doc already exists.');
      }
    }

    const groups: string[] = [];

    if (this.devGroupScenario === 'pt') {
      groups.push(this.ptGroupId);
    } else if (this.devGroupScenario === 'friends') {
      groups.push(this.friendsGroupId);
    } else if (this.devGroupScenario === 'both') {
      groups.push(this.ptGroupId, this.friendsGroupId);
    } else if (this.devGroupScenario === 'none') {
      // no groups: leave array empty
    }

    console.log('[DevSeedService] Setting groups on /users doc:', groups);

    await setDoc(
      userRef,
      { groups },
      { merge: true },
    );
  }

  /**
   * Seeds a set of dummy userStats docs with different regions and scores
   * for leaderboard testing. These are Firestore-only and do NOT correspond
   * to real Auth users.
   */
  private async seedDummyUserStats(): Promise<void> {
    console.log('[DevSeedService] Seeding dummy userStats for leaderboard...');

    const dummyUsers = [
      {
        userId: 'dummy_user_1',
        displayName: 'Alice Runner',
        region: { country: 'USA', state: 'California', city: 'San Francisco' },
        total_work_score: 3200,
        cardio_work_score: 2500,
        strength_work_score: 700,
        level: 10,
      },
      {
        userId: 'dummy_user_2',
        displayName: 'Bob Lifter',
        region: { country: 'USA', state: 'California', city: 'Los Angeles' },
        total_work_score: 2800,
        cardio_work_score: 1200,
        strength_work_score: 1600,
        level: 9,
      },
      {
        userId: 'dummy_user_3',
        displayName: 'Charlie Sprinter',
        region: { country: 'USA', state: 'Nevada', city: 'Reno' },
        total_work_score: 1900,
        cardio_work_score: 1700,
        strength_work_score: 200,
        level: 6,
      },
      {
        userId: 'dummy_user_4',
        displayName: 'Diana Athlete',
        region: { country: 'USA', state: 'New York', city: 'New York City' },
        total_work_score: 4100,
        cardio_work_score: 2100,
        strength_work_score: 2000,
        level: 12,
      },
      {
        userId: 'dummy_user_5',
        displayName: 'Ethan Strong',
        region: { country: 'Canada', state: 'Ontario', city: 'Toronto' },
        total_work_score: 2300,
        cardio_work_score: 800,
        strength_work_score: 1500,
        level: 8,
      },
      {
        userId: 'dummy_user_6',
        displayName: 'Fiona Cardio',
        region: { country: 'Canada', state: 'British Columbia', city: 'Vancouver' },
        total_work_score: 2600,
        cardio_work_score: 2200,
        strength_work_score: 400,
        level: 9,
      },
      {
        userId: 'dummy_user_7',
        displayName: 'George Power',
        region: { country: 'UK', state: 'England', city: 'London' },
        total_work_score: 3500,
        cardio_work_score: 1500,
        strength_work_score: 2000,
        level: 11,
      },
      {
        userId: 'dummy_user_8',
        displayName: 'Hannah Balance',
        region: { country: 'Germany', state: 'Bavaria', city: 'Munich' },
        total_work_score: 2700,
        cardio_work_score: 1350,
        strength_work_score: 1350,
        level: 9,
      },
    ];

    for (const dummy of dummyUsers) {
      const ref = doc(this.firestore, 'userStats', dummy.userId);
      try {
        console.log('[DevSeedService] Writing dummy userStats:', dummy.userId);
        await setDoc(
          ref,
          {
            userId: dummy.userId,
            displayName: dummy.displayName,
            total_work_score: dummy.total_work_score,
            cardio_work_score: dummy.cardio_work_score,
            strength_work_score: dummy.strength_work_score,
            level: dummy.level,
            region: dummy.region,
            last_updated_at: serverTimestamp(),
          },
          { merge: true },
        );
        console.log('[DevSeedService] Wrote dummy userStats:', dummy.userId);
      } catch (err) {
        console.error(
          '[DevSeedService] Failed to write dummy userStats:',
          dummy.userId,
          err,
        );
      }
    }

    console.log('[DevSeedService] Dummy userStats seeding complete.');
  }

  private async seedDevBadges(uid: string): Promise<void> {
    console.log('[DevSeedService] Seeding Greek statues (dev badges)...');

    const badgeRef = doc(this.firestore, 'userBadges', uid);

    // Greek statue progress values - showing various carving stages
    await setDoc(
      badgeRef,
      {
        userId: uid,
        values: {
          // Greek god statue IDs with impressive progress
          'heracles-strength': 5500000,      // Heracles - God of Strength (Divine level)
          'ares-warrior': 650,               // Ares - God of War (Gilded level)
          'atlas-burden': 550,               // Atlas - Titan (Gilded level)
          'hestia-eternal-flame': 120,       // Hestia - Eternal Flame (Polished level)
          'hermes-swiftness': 12000,         // Hermes - God of Swiftness (Detailed level)
          'nike-victory': 22,                // Nike - Goddess of Victory (Outlined level)
          'chronos-time': 175,               // Chronos - God of Time (Outlined level)
          'dionysus-fellowship': 35,         // Dionysus - God of Fellowship (Rough level)
          'eos-dawn': 18,                    // Eos - Goddess of Dawn (Rough level)
          'apollo-transformation': 5,        // Apollo - God of Perfection (Just started)
        },
        percentiles: {
          'heracles-strength': 0.5,    // Top 0.5% - very rare
          'ares-warrior': 2.3,         // Top 2.3%
          'atlas-burden': 0.1,         // Top 0.1% - extremely rare
          'hestia-eternal-flame': 6.7,
          'hermes-swiftness': 11.2,
          'nike-victory': 18.9,
          'chronos-time': 23.4,
          'dionysus-fellowship': 38.6,
          'eos-dawn': 42.1,
        },
        // Display the most impressive statues
        displayStatueIds: ['heracles-strength', 'ares-warrior', 'atlas-burden'],
        // Keep old field for backwards compatibility
        displayBadgeIds: ['heracles-strength', 'ares-warrior', 'atlas-burden'],
        last_updated_at: serverTimestamp(),
      },
      { merge: true },
    );

    console.log('[DevSeedService] Greek statues seeded successfully.');
  }

  /**
   * Creates a dev trainer user with complete profile
   */
  async createDevTrainer(): Promise<void> {
    console.log('[DevSeedService] Creating dev trainer user...');
    let user: User | null = null;

    // 1) Sign in or create the dev trainer auth user
    try {
      const cred = await signInWithEmailAndPassword(
        this.auth,
        this.devTrainerEmail,
        this.devTrainerPassword,
      );
      user = cred.user;
      console.log('[DevSeedService] Signed in existing dev trainer:', user.uid);
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found' || err?.code === 'auth/invalid-credential') {
        console.log('[DevSeedService] Dev trainer not found, creating new one...');
        const cred = await createUserWithEmailAndPassword(
          this.auth,
          this.devTrainerEmail,
          this.devTrainerPassword,
        );
        user = cred.user;
        console.log('[DevSeedService] Created dev trainer:', user.uid);
      } else {
        console.error('[DevSeedService] Error signing in dev trainer:', err);
        throw err;
      }
    }

    if (!user) {
      throw new Error('[DevSeedService] Dev trainer is null after sign-in/sign-up');
    }

    const uid = user.uid;

    // 2) Create trainer profile in /trainers collection
    const trainerRef = doc(this.firestore, 'trainers', uid);
    await setDoc(trainerRef, {
      accountType: 'trainer',
      email: this.devTrainerEmail,
      firstName: 'Dev',
      lastName: 'Trainer',
      phoneNumber: '+15551234567',
      birthday: new Date('1990-01-01'),
      gender: 'male',
      profileImage: '',
      specialization: 'Strength & Conditioning',
      experience: '5+ years',
      education: 'B.S. Exercise Science',
      shortDescription: 'Certified strength coach helping clients reach their fitness goals',
      description: 'I am a certified personal trainer with over 5 years of experience in strength training, functional fitness, and athletic conditioning. My approach focuses on sustainable progress and proper form to prevent injuries while maximizing results.',
      certifications: ['NASM-CPT', 'CSCS', 'Precision Nutrition Level 1'],
      trainingLocation: {
        remote: true,
        inPerson: true
      },
      hourlyRate: 75,
      availability: {
        Monday: [{ start: '09:00', end: '17:00' }],
        Tuesday: [{ start: '09:00', end: '17:00' }],
        Wednesday: [{ start: '09:00', end: '17:00' }],
        Thursday: [{ start: '09:00', end: '17:00' }],
        Friday: [{ start: '09:00', end: '15:00' }],
      },
      additionalPhotos: [],
      introVideoUrl: '',
      visible: true,
      unreadMessageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log('[DevSeedService] Dev trainer profile created successfully!');
    console.log('[DevSeedService] Email:', this.devTrainerEmail);
    console.log('[DevSeedService] Password:', this.devTrainerPassword);
  }

  /**
   * Connect the dev client to the dev trainer
   * This establishes the trainer-client relationship
   */
  async connectClientToTrainer(): Promise<void> {
    console.log('[DevSeedService] Connecting dev client to dev trainer...');

    // First, ensure both users exist
    await this.ensureDevUserAndSeed();
    await this.createDevTrainer();

    // Get the client UID
    const clientCred = await signInWithEmailAndPassword(
      this.auth,
      this.devEmail,
      this.devPassword,
    );
    const clientUid = clientCred.user.uid;

    // Get the trainer UID
    const trainerCred = await signInWithEmailAndPassword(
      this.auth,
      this.devTrainerEmail,
      this.devTrainerPassword,
    );
    const trainerUid = trainerCred.user.uid;

    console.log('[DevSeedService] Client UID:', clientUid);
    console.log('[DevSeedService] Trainer UID:', trainerUid);

    // Update client profile to include trainerId
    const clientRef = doc(this.firestore, 'clients', clientUid);
    const clientSnap = await getDoc(clientRef);

    if (!clientSnap.exists()) {
      // Create client profile if it doesn't exist
      await setDoc(clientRef, {
        accountType: 'client',
        email: this.devEmail,
        firstName: 'Dev',
        lastName: 'Tester',
        phoneNumber: '+15559876543',
        birthday: new Date('1995-06-15'),
        gender: 'male',
        profileImage: '',
        trainerId: trainerUid,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log('[DevSeedService] Created client profile with trainer connection');
    } else {
      // Update existing client profile
      await setDoc(clientRef, {
        trainerId: trainerUid,
        updatedAt: new Date()
      }, { merge: true });
      console.log('[DevSeedService] Updated client profile with trainer connection');
    }

    // Add client to trainer's clients list in a separate document
    const trainerClientsRef = doc(this.firestore, 'trainerClients', trainerUid);
    const trainerClientsSnap = await getDoc(trainerClientsRef);

    if (!trainerClientsSnap.exists()) {
      await setDoc(trainerClientsRef, {
        trainerId: trainerUid,
        clients: [{
          clientId: clientUid,
          clientName: 'Dev Tester',
          clientEmail: this.devEmail,
          joinedDate: new Date().toISOString(),
          totalSessions: 12,
          lastSession: new Date(Date.now() - 172800000).toISOString()
        }],
        updatedAt: new Date()
      });
    } else {
      const existingClients = trainerClientsSnap.data()['clients'] || [];
      const clientExists = existingClients.some((c: any) => c.clientId === clientUid);
      
      if (!clientExists) {
        existingClients.push({
          clientId: clientUid,
          clientName: 'Dev Tester',
          clientEmail: this.devEmail,
          joinedDate: new Date().toISOString(),
          totalSessions: 12,
          lastSession: new Date(Date.now() - 172800000).toISOString()
        });
        
        await setDoc(trainerClientsRef, {
          clients: existingClients,
          updatedAt: new Date()
        }, { merge: true });
      }
    }

    // Create a chat between trainer and client
    await this.createTrainerClientChat(trainerUid, clientUid);
    
    console.log('[DevSeedService] You can now:');
    console.log('[DevSeedService] 1. Login as trainer:', this.devTrainerEmail);
    console.log('[DevSeedService] 2. See client in trainer home page');
    console.log('[DevSeedService] 3. Login as client:', this.devEmail);
    console.log('[DevSeedService] 4. See trainer connection in client profile');
    console.log('[DevSeedService] 5. Chat between trainer and client is ready!');
  }

  /**
   * Create a chat between the dev trainer and dev client
   */
  private async createTrainerClientChat(trainerId: string, clientId: string): Promise<void> {
    console.log('[DevSeedService] Creating chat between trainer and client...');

    try {
      // Check if chat already exists
      const userChatsRef = ref(this.db, `userChats/${trainerId}`);
      const userChatsSnapshot = await get(userChatsRef);
      
      let chatExists = false;
      if (userChatsSnapshot.exists()) {
        const userChatsData = userChatsSnapshot.val();
        // Check if there's already a chat with this client
        for (const chatId in userChatsData) {
          const chatRef = ref(this.db, `chats/${chatId}`);
          const chatSnapshot = await get(chatRef);
          if (chatSnapshot.exists()) {
            const chatData = chatSnapshot.val();
            if (chatData.participants && chatData.participants.includes(clientId)) {
              chatExists = true;
              console.log('[DevSeedService] Chat already exists:', chatId);
              break;
            }
          }
        }
      }

      if (!chatExists) {
        // Create new chat
        const chatId = await this.chatsService.createChat(trainerId, clientId);
        console.log('[DevSeedService] Created new chat:', chatId);
        
        // Send an initial welcome message
        await this.chatsService.sendMessage(
          chatId,
          trainerId,
          'Hi! Welcome to our training chat. Feel free to reach out if you have any questions about your workouts or progress!'
        );
        console.log('[DevSeedService] Sent initial welcome message');
      }
    } catch (error) {
      console.error('[DevSeedService] Error creating trainer-client chat:', error);
    }
  }

}
