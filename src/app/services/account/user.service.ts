import { Injectable, signal, computed, Signal, effect } from '@angular/core';
import { AccountService } from './account.service';
import { trainerProfile } from '../../Interfaces/Profiles/Trainer';
import { clientProfile } from '../../Interfaces/Profiles/client';
import { Firestore, setDoc, getDoc, doc, updateDoc, serverTimestamp } from '@angular/fire/firestore';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { FileUploadService } from '../file-upload.service';
import { AppUser } from '../../models/user.model';
import { AccountType, ProfileRepositoryService } from './profile-repository.service';
import { UserBadgesService } from '../user-badges.service';
import { UserStatsService } from '../user-stats.service';
import { calculateUserLevelProgress } from '../../models/user-stats.model';
import { getFunctions, httpsCallable } from 'firebase/functions';

type DemoFitnessLevel = 'Beginner' | 'Intermediate' | 'Advanced';
type DemoGoal = 'Strength' | 'Cardio' | 'Consistency' | 'General Fitness';
// Public demo users always point at this fixed trainer so the event flow stays simple.
const DEMO_TRAINER_UID = 'I1zIOGwmhDe3Mm5hURkbSpZpOyh2';

interface DemoClientSetup {
  displayName: string;
  fitnessLevel: DemoFitnessLevel;
  goal: DemoGoal;
}

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private userInfo = signal<trainerProfile | clientProfile | null>(null);
  private readonly TRAINERS_COLLECTION = 'trainers';
  private readonly CLIENTS_COLLECTION = 'clients';
  private profileLoadPromise: Promise<boolean> | null = null;
  private loadedProfileUid: string | null = null;
  private profileCompletionRoute = '/complete-profile/client';

  constructor(
    private accountService: AccountService,
    private firestore: Firestore,
    private fileUploadService: FileUploadService,
    private profileRepository: ProfileRepositoryService,
    private userBadgesService: UserBadgesService,
    private userStatsService: UserStatsService
  ) {
    effect(() => {
      if (!this.accountService.isLoggedIn()()) {
        this.userInfo.set(null);
        this.loadedProfileUid = null;
        this.profileLoadPromise = null;
        this.profileRepository.clear();
        this.userBadgesService.clear();
        this.userStatsService.clear();
      }
    });
  }

  async createUserProfile(formData: trainerProfile | clientProfile): Promise<boolean> {
    const userID = this.accountService.getCredentials()().uid;
    const authEmail = this.accountService.getCredentials()().email;
    formData.email = authEmail;

    if (userID) {
      const isTrainerAccount = formData.accountType === 'trainer';
      const firstName = typeof (formData as any)?.firstName === 'string'
        ? (formData as any).firstName.trim()
        : '';
      const lastName = typeof (formData as any)?.lastName === 'string'
        ? (formData as any).lastName.trim()
        : '';
      const phone = typeof (formData as any)?.phone === 'string'
        ? (formData as any).phone.trim()
        : '';
      const profileImage = typeof (formData as any)?.profilepic === 'string'
        ? (formData as any).profilepic.trim()
        : '';
      const zip = typeof (formData as any)?.zip === 'number'
        ? (formData as any).zip
        : Number((formData as any)?.zip || 0);

      const trainerProfileData = isTrainerAccount
        ? {
            firstName,
            lastName,
            profilepic: profileImage,
            city: typeof (formData as any)?.city === 'string' ? (formData as any).city.trim() : '',
            state: typeof (formData as any)?.state === 'string' ? (formData as any).state.trim() : '',
            zip,
            specialization: typeof (formData as any)?.specialization === 'string'
              ? (formData as any).specialization.trim()
              : '',
            experience: typeof (formData as any)?.experience === 'string'
              ? (formData as any).experience.trim()
              : '',
            education: typeof (formData as any)?.education === 'string'
              ? (formData as any).education.trim()
              : '',
            description: typeof (formData as any)?.description === 'string'
              ? (formData as any).description.trim()
              : '',
            certifications: Array.isArray((formData as any)?.certifications)
              ? (formData as any).certifications.map((value: unknown) => String(value).trim()).filter(Boolean)
              : [],
            trainingLocation: {
              remote: (formData as any)?.trainingLocation?.remote === true,
              inPerson: (formData as any)?.trainingLocation?.inPerson === true,
            },
            visible: false,
            unreadMessageCount: 0,
          }
        : null;

      const clientProfileData = !isTrainerAccount
        ? {
            ...(formData as unknown as Record<string, unknown>),
            unreadMessageCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : null;

      const trainerDocRef = doc(this.firestore, `${this.TRAINERS_COLLECTION}/${userID}`);
      const clientDocRef = doc(this.firestore, `${this.CLIENTS_COLLECTION}/${userID}`);

      if (isTrainerAccount) {
        await setDoc(trainerDocRef, trainerProfileData!);
      } else {
        await setDoc(clientDocRef, clientProfileData!);
      }

      const userStatsPayload = this.buildInitialUserStatsPayload(formData, userID);
      if (userStatsPayload) {
        await setDoc(doc(this.firestore, 'userStats', userID), userStatsPayload, { merge: true });
      }

      const usersRef = doc(this.firestore, `users/${userID}`);
      const userProfilePatch: Record<string, unknown> = {
        userId: userID,
        email: authEmail ?? '',
        firstName,
        lastName,
        displayName: typeof (formData as any)?.displayName === 'string'
          ? (formData as any).displayName.trim()
          : `${firstName} ${lastName}`.trim(),
        phone,
        profilepic: profileImage,
        isPT: false,
        requestedAccountType: formData.accountType,
        trainerApprovalStatus: isTrainerAccount ? 'pending' : 'approved',
        trainerApplicationSubmittedAt: isTrainerAccount ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      };

      if (isTrainerAccount) {
        userProfilePatch['city'] = typeof (formData as any)?.city === 'string'
          ? (formData as any).city.trim()
          : '';
        userProfilePatch['state'] = typeof (formData as any)?.state === 'string'
          ? (formData as any).state.trim()
          : '';
        userProfilePatch['zip'] = zip;
      }

      await setDoc(
        usersRef,
        userProfilePatch,
        { merge: true }
      );

      const userSummaryPatch: Partial<AppUser> = {
        userId: userID,
        email: authEmail ?? '',
        displayName: typeof (formData as any)?.displayName === 'string'
          ? (formData as any).displayName.trim()
          : `${firstName} ${lastName}`.trim(),
        firstName,
        lastName,
        phone,
        profilepic: profileImage,
        isPT: false,
      };
      this.profileRepository.primeUserSummary(userID, userSummaryPatch);
      this.profileRepository.primeProfile(
        userID,
        formData.accountType,
        isTrainerAccount ? trainerProfileData! : clientProfileData!
      );
      this.syncCurrentUserSummaryPatch(userID, userSummaryPatch);
      this.syncCurrentUserProfilePatch(
        userID,
        formData.accountType,
        isTrainerAccount ? trainerProfileData! : clientProfileData!
      );
      return true;
    } else {
      throw new Error('User ID not found');
    }
  }

  async createDemoClientProfile(setup: DemoClientSetup): Promise<boolean> {
    const userID = this.accountService.getCredentials()().uid;
    const authEmail = this.accountService.getCredentials()().email;
    const displayName = this.normalizeText(setup.displayName) || 'Demo Athlete';
    const fitnessLevel = setup.fitnessLevel;
    const goal = setup.goal;

    if (!userID) {
      throw new Error('User ID not found');
    }

    const now = new Date();
    const timestamps = {
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const clientProfileData: clientProfile = {
      id: userID,
      displayName,
      firstName: displayName,
      lastName: '',
      email: authEmail || '',
      phone: '',
      profilepic: '',
      city: '',
      state: '',
      zip: 0,
      accountType: 'client',
      role: 'client',
      demoMode: true,
      trainerId: DEMO_TRAINER_UID,
      fitnessLevel,
      goal,
      goals: goal,
      experience: fitnessLevel,
      description: `Demo profile for a ${fitnessLevel.toLowerCase()} athlete focused on ${goal.toLowerCase()}.`,
      displayBadges: ['demo-starter', 'demo-consistency'],
      unreadMessageCount: 0,
    };

    const userSummaryPatch: Partial<AppUser> = {
      userId: userID,
      displayName,
      firstName: displayName,
      lastName: '',
      username: displayName,
      email: '',
      phone: '',
      profilepic: '',
      isPT: false,
      role: 'client',
      demoMode: true,
      fitnessLevel,
      goal,
      trainerId: DEMO_TRAINER_UID,
      groupID: [],
      ...timestamps,
    } as Partial<AppUser>;

    const userStatsDoc = this.buildDemoUserStats(userID, displayName, fitnessLevel, goal, now);
    const userStatsScore = Number(
      (userStatsDoc['userScore'] as Record<string, unknown> | undefined)?.['totalScore'] ?? 0
    );

    await setDoc(doc(this.firestore, `users/${userID}`), userSummaryPatch, { merge: true });

    await Promise.all([
      setDoc(doc(this.firestore, `${this.CLIENTS_COLLECTION}/${userID}`), {
        ...clientProfileData,
        ...timestamps,
      }),
      setDoc(doc(this.firestore, 'userStats', userID), userStatsDoc, { merge: true }),
      // Public demo users are always linked to a fixed trainer so the demo feels personalized.
      setDoc(
        doc(this.firestore, `trainers/${DEMO_TRAINER_UID}/clients/${userID}`),
        {
          clientId: userID,
          trainerId: DEMO_TRAINER_UID,
          status: 'active',
          demoMode: true,
          displayName,
          firstName: displayName,
          lastName: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
    ]);

    await this.seedDemoTrendData(userID, userStatsScore);

    this.profileRepository.primeUserSummary(userID, userSummaryPatch);
    this.profileRepository.primeProfile(userID, 'client', {
      ...clientProfileData,
      ...timestamps,
    });
    this.syncCurrentUserSummaryPatch(userID, userSummaryPatch);
    this.syncCurrentUserProfilePatch(userID, 'client', {
      ...clientProfileData,
      ...timestamps,
    });

    await Promise.all([
      this.userStatsService.initializeCurrentUserStats(userID, true),
      this.userBadgesService.initializeCurrentUserBadges(userID, true),
    ]);

    await this.ensureInnovationDayGroupMembership(userID, displayName);

    return true;
  }

  async loadUserProfile(): Promise<boolean> {
    this.profileCompletionRoute = '/complete-profile/client';

    if (!this.accountService.isLoggedIn()()) {
      return false;
    }

    const credentials = this.accountService.getCredentials()();
    const userID = (credentials?.uid || '').trim();
    if (!userID) {
      throw new Error('User ID not found');
    }

    if (this.loadedProfileUid === userID && this.userInfo()) {
      return true;
    }

    if (this.profileLoadPromise) {
      return this.profileLoadPromise;
    }

    this.profileLoadPromise = this.loadUserProfileInternal(userID, credentials?.email || '');
    try {
      return await this.profileLoadPromise;
    } finally {
      this.profileLoadPromise = null;
    }
  }

  private async loadUserProfileInternal(userID: string, email: string): Promise<boolean> {
    const trainerDoc = await getDoc(doc(this.firestore, `${this.TRAINERS_COLLECTION}/${userID}`));
    const isTrainerProfile = trainerDoc.exists();
    let userDoc = trainerDoc;

    if (!isTrainerProfile) {
      userDoc = await getDoc(doc(this.firestore, `${this.CLIENTS_COLLECTION}/${userID}`));
    }

    const trainerNeedsNameCompletion = await this.ensureTrainerUsersDocIdentity(userID, email);
    if (trainerNeedsNameCompletion) {
      this.profileCompletionRoute = '/complete-profile/client';
      this.userInfo.set(null);
      this.loadedProfileUid = null;
      this.userBadgesService.clear();
      this.userStatsService.clear();
      return false;
    }

    let hasRequiredStats = true;
    const usersData = await this.getUserSummaryDirectly(userID);
    const isDemoMode =
      usersData?.['demoMode'] === true ||
      (userDoc.exists() &&
        typeof (userDoc.data() as Record<string, unknown>)?.['demoMode'] === 'boolean' &&
        (userDoc.data() as Record<string, unknown>)['demoMode'] === true);
    const trainerApprovalStatus = String((usersData as Record<string, unknown> | null)?.['trainerApprovalStatus'] || '').trim().toLowerCase();
    const requestedAccountType = String((usersData as Record<string, unknown> | null)?.['requestedAccountType'] || '').trim().toLowerCase();

    if (requestedAccountType === 'trainer' && trainerApprovalStatus === 'pending') {
      this.profileCompletionRoute = '/trainer-approval-pending';
      this.userInfo.set(null);
      this.loadedProfileUid = null;
      this.userBadgesService.clear();
      this.userStatsService.clear();
      return false;
    }

    if (!isTrainerProfile) {
      const userStatsDoc = await getDoc(doc(this.firestore, 'userStats', userID));
      const userStatsData = userStatsDoc.exists() ? userStatsDoc.data() : null;
      await this.ensureBmiField(userID, userStatsData);
      hasRequiredStats = isDemoMode ? true : this.hasRequiredUserStats(userStatsData);
    }

    if (!userDoc.exists()) {
      // Fallback for app users that only have /users doc.
      if (!usersData) {
        this.userInfo.set(null);
        this.loadedProfileUid = null;
        this.userBadgesService.clear();
        this.userStatsService.clear();
        return false;
      }

      const firstName = typeof usersData?.['firstName'] === 'string' ? usersData['firstName'].trim() : '';
      const lastName = typeof usersData?.['lastName'] === 'string' ? usersData['lastName'].trim() : '';
      const username = typeof usersData?.['username'] === 'string' ? usersData['username'].trim() : '';

      if (!firstName || !lastName || !username) {
        this.profileCompletionRoute = '/complete-profile/client';
        this.userInfo.set(null);
        this.loadedProfileUid = null;
        this.userBadgesService.clear();
        this.userStatsService.clear();
        return false;
      }

      if (!hasRequiredStats) {
        this.profileCompletionRoute = '/complete-profile/client';
        this.userInfo.set(null);
        this.loadedProfileUid = null;
        this.userBadgesService.clear();
        this.userStatsService.clear();
        return false;
      }

      const fallbackProfile = {
        id: userID,
        firstName,
        lastName,
        email,
        phone: '',
        profilepic: typeof usersData?.['profilepic'] === 'string' ? usersData['profilepic'] : '',
        city: '',
        state: '',
        zip: 0,
        accountType: 'client' as const,
        goals: '',
        experience: '',
        description: '',
        unreadMessageCount:
          typeof (usersData as any)?.['unreadMessageCount'] === 'number'
            ? (usersData as any)['unreadMessageCount']
            : 0,
        username,
      } as unknown as clientProfile;

      const mergedFallbackProfile = this.mergeLoadedProfileWithUserSummary(
        userID,
        fallbackProfile,
        'client',
        usersData,
        email
      );
      this.userInfo.set(mergedFallbackProfile);
      this.loadedProfileUid = userID;
      await Promise.all([
        this.userBadgesService.initializeCurrentUserBadges(userID),
        this.userStatsService.initializeCurrentUserStats(userID),
      ]);
      await this.userBadgesService.syncStatueBadges(userID);
      await this.userBadgesService.getUserBadges(userID, true);
      await this.syncClientTrainerRecordOnLogin(userID, mergedFallbackProfile as unknown as Record<string, unknown>);
      return true;
    }

    if (!isTrainerProfile && !hasRequiredStats) {
      this.profileCompletionRoute = '/complete-profile/client';
      this.userInfo.set(null);
      this.loadedProfileUid = null;
      this.userBadgesService.clear();
      this.userStatsService.clear();
      return false;
    }

    const accountType: AccountType = isTrainerProfile ? 'trainer' : 'client';
    const userData = this.mergeLoadedProfileWithUserSummary(
      userID,
      userDoc.data() as trainerProfile | clientProfile,
      accountType,
      usersData,
      email
    );

    this.profileRepository.primeProfile(userID, accountType, userData as unknown as Record<string, unknown>);
    if (usersData) {
      this.profileRepository.primeUserSummary(userID, usersData);
    }

    this.userInfo.set(userData);
    this.loadedProfileUid = userID;
    await Promise.all([
      this.userBadgesService.initializeCurrentUserBadges(userID),
      this.userStatsService.initializeCurrentUserStats(userID),
    ]);
    await this.userBadgesService.syncStatueBadges(userID);
    await this.userBadgesService.getUserBadges(userID, true);

    if (!isTrainerProfile) {
      await this.syncClientTrainerRecordOnLogin(userID, userData as unknown as Record<string, unknown>);
    }

    return true;
  }

  private async syncClientTrainerRecordOnLogin(
    userId: string,
    loadedClientProfile: Record<string, unknown> | null
  ): Promise<void> {
    try {
      const clientUid = String(userId || '').trim();
      if (!clientUid) {
        return;
      }

      const usersRef = doc(this.firestore, 'users', clientUid);
      const clientRef = doc(this.firestore, 'clients', clientUid);
      const [usersSnap, clientSnap] = await Promise.all([getDoc(usersRef), getDoc(clientRef)]);

      const usersData = usersSnap.exists() ? (usersSnap.data() as Record<string, unknown>) : {};
      const clientData = clientSnap.exists() ? (clientSnap.data() as Record<string, unknown>) : {};

      let trainerId = String(
        usersData?.['trainerId'] ||
        clientData?.['trainerId'] ||
        ''
      ).trim();

      if (!trainerId) {
        return;
      }

      const trainerRef = doc(this.firestore, 'trainers', trainerId);
      const trainerSnap = await getDoc(trainerRef);
      if (!trainerSnap.exists()) {
        return;
      }

      if (String(usersData?.['trainerId'] || '').trim() !== trainerId) {
        await setDoc(
          usersRef,
          {
            trainerId,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (String(clientData?.['trainerId'] || '').trim() !== trainerId) {
        await setDoc(
          clientRef,
          {
            trainerId,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      const firstName = String(
        usersData?.['firstName'] ||
        loadedClientProfile?.['firstName'] ||
        clientData?.['firstName'] ||
        ''
      ).trim();
      const lastName = String(
        usersData?.['lastName'] ||
        loadedClientProfile?.['lastName'] ||
        clientData?.['lastName'] ||
        ''
      ).trim();
      const clientEmail = String(
        loadedClientProfile?.['email'] ||
        clientData?.['email'] ||
        usersData?.['email'] ||
        ''
      ).trim();
      const profilepic = String(
        loadedClientProfile?.['profilepic'] ||
        clientData?.['profilepic'] ||
        usersData?.['profilepic'] ||
        ''
      ).trim();

      const trainerClientRef = doc(this.firestore, `trainers/${trainerId}/clients/${clientUid}`);
      const trainerClientSnap = await getDoc(trainerClientRef);
      const trainerClientData = trainerClientSnap.exists()
        ? (trainerClientSnap.data() as Record<string, unknown>)
        : {};
      const joinedDate = String(trainerClientData?.['joinedDate'] || '').trim() || new Date().toISOString();

      await setDoc(
        trainerClientRef,
        {
          clientId: clientUid,
          firstName,
          lastName,
          clientName: `${firstName} ${lastName}`.trim(),
          clientEmail,
          profilepic,
          joinedDate,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error('[UserService] Failed to sync trainer client record on login:', error);
    }
  }

  private async ensureTrainerUsersDocIdentity(userId: string, email: string): Promise<boolean> {
    const userRef = doc(this.firestore, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      return false;
    }

    const usersData = userSnap.data() as Record<string, unknown>;
    const isTrainer =
      usersData?.['isPT'] === true ||
      String(usersData?.['requestedAccountType'] || '').trim().toLowerCase() === 'trainer';
    if (!isTrainer) {
      return false;
    }

    const firstName = typeof usersData?.['firstName'] === 'string'
      ? usersData['firstName'].trim()
      : '';
    const lastName = typeof usersData?.['lastName'] === 'string'
      ? usersData['lastName'].trim()
      : '';
    const usersEmail = typeof usersData?.['email'] === 'string'
      ? usersData['email'].trim()
      : '';
    const authEmail = (email || '').trim();

    if (!usersEmail && authEmail) {
      await setDoc(
        userRef,
        {
          email: authEmail,
          updatedAt: new Date(),
        },
        { merge: true }
      );
    }

    return !firstName || !lastName;
  }

  private async ensureBmiField(userId: string, statsData: any): Promise<void> {
    if (!statsData) {
      return;
    }

    const hasBmiField = Object.prototype.hasOwnProperty.call(statsData, 'bmi');
    const currentBmi = statsData?.['bmi'];
    if (hasBmiField && typeof currentBmi === 'number' && Number.isFinite(currentBmi)) {
      return;
    }

    const heightMeters = this.parsePositiveNumber(statsData?.['heightMeters']);
    const weightKg = this.parsePositiveNumber(statsData?.['weightKg']);
    const bmi = heightMeters !== null && weightKg !== null
      ? this.calculateBmi(heightMeters, weightKg)
      : 0;

    await setDoc(
      doc(this.firestore, 'userStats', userId),
      { bmi },
      { merge: true }
    );
  }

  private hasRequiredUserStats(statsData: any): boolean {
    const age = this.parsePositiveNumber(statsData?.['age']);
    const sex = this.parseSexValue(statsData?.['sex']);
    const heightMeters = this.parsePositiveNumber(statsData?.['heightMeters']);
    const weightKg = this.parsePositiveNumber(statsData?.['weightKg']);

    return age !== null && Number.isInteger(age) && sex !== null && heightMeters !== null && weightKg !== null;
  }

  private parsePositiveNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? value : null;
    }

    const parsed = Number(String(value ?? '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private calculateBmi(heightMeters: number, weightKg: number): number {
    const bmi = weightKg / (heightMeters * heightMeters);
    return Number.isFinite(bmi) ? Number(bmi.toFixed(2)) : 0;
  }

  private parseSexValue(value: unknown): number | null {
    const parsed = Number(String(value ?? '').trim());
    if (parsed === 1 || parsed === 1.5 || parsed === 2) {
      return parsed;
    }
    return null;
  }

  private buildInitialUserStatsPayload(
    formData: trainerProfile | clientProfile,
    userId: string
  ): Record<string, unknown> | null {
    const formDataRecord = formData as unknown as Record<string, unknown>;
    const age = this.parsePositiveInteger(formDataRecord['age']);
    const heightMeters = this.parsePositiveNumber(formDataRecord['heightMeters']);
    const weightKg = this.parsePositiveNumber(formDataRecord['weightKg']);
    const sex = this.parseSexValue(formDataRecord['sex']);

    if (
      age === null ||
      heightMeters === null ||
      weightKg === null ||
      sex === null
    ) {
      return null;
    }

    const bmi = this.calculateBmi(heightMeters, weightKg);
    if (!bmi) {
      return null;
    }

    return {
      userId,
      age,
      heightMeters,
      weightKg,
      sex,
      bmi,
      updatedAt: serverTimestamp(),
    };
  }

  private parsePositiveInteger(value: unknown): number | null {
    const parsed = Number(String(value ?? '').trim());
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
      return null;
    }

    return parsed;
  }

  private buildDemoUserStats(
    userId: string,
    displayName: string,
    fitnessLevel: DemoFitnessLevel,
    goal: DemoGoal,
    now: Date
  ): Record<string, unknown> {
    const seedByLevel: Record<DemoFitnessLevel, { totalScore: number; streak: number; workouts: number; cardio: number; strength: number; }> = {
      Beginner: { totalScore: 180, streak: 2, workouts: 2, cardio: 90, strength: 90 },
      Intermediate: { totalScore: 540, streak: 5, workouts: 4, cardio: 250, strength: 290 },
      Advanced: { totalScore: 980, streak: 9, workouts: 6, cardio: 470, strength: 510 },
    };

    const seed = seedByLevel[fitnessLevel];
    const levelProgress = calculateUserLevelProgress(seed.totalScore);
    const dateKey = this.toLocalDateKey(now);

    return {
      userId,
      displayName,
      demoMode: true,
      fitnessLevel,
      goal,
      age: 0,
      sex: 0,
      heightMeters: 0,
      weightKg: 0,
      bmi: 0,
      userScore: {
        cardioScore: {
          totalCardioScore: seed.cardio,
        },
        strengthScore: {
          totalStrengthScore: seed.strength,
        },
        totalScore: seed.totalScore,
        maxAddedScoreWithinDay: 0,
      },
      Expected_Effort: {
        Cardio: {
          warmup: fitnessLevel === 'Beginner' ? 10 : 18,
        },
        Strength: {
          focus: fitnessLevel === 'Advanced' ? 60 : 35,
        },
      },
      ...levelProgress,
      streakData: {
        currentStreak: seed.streak,
        maxStreak: Math.max(seed.streak + 1, seed.streak),
        totalNumberOfDaysTracked: seed.workouts + 1,
        lastLoggedDay: dateKey,
      },
      earlymorningWorkoutsTracker: {
        earlyMorningWorkoutNumber: fitnessLevel === 'Advanced' ? 3 : 1,
        dateLastUpdated: dateKey,
      },
      groupRankings: {
        totalNumberOfMembers: 24,
        lastUpdated: now.toISOString(),
      },
      region: {
        country: 'US',
        state: 'NV',
        city: 'Reno',
        countryCode: 'US',
        stateCode: 'NV',
        cityId: 'reno_nv_usa',
        countryName: 'United States',
        stateName: 'Nevada',
        cityName: 'Reno',
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  }

  private async seedDemoTrendData(userId: string, totalScore: number): Promise<void> {
    const dateKeys = [0, 1, 2].map((offset) => this.toLocalDateKey(this.offsetDate(new Date(), offset)));
    const values = [Math.round(totalScore * 0.22), Math.round(totalScore * 0.28), Math.round(totalScore * 0.3)];

    await Promise.all(
      dateKeys.map((dateKey, index) =>
        setDoc(
          doc(this.firestore, `userStats/${userId}/addedScore/${dateKey}`),
          {
            date: dateKey,
            cardioScoreAddedToday: Math.round(values[index] * 0.45),
            strengthScoreAddedToday: Math.round(values[index] * 0.55),
            totalScoreAddedToday: values[index],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      )
    );
  }

  private async ensureInnovationDayGroupMembership(userId: string, displayName: string): Promise<void> {
    const callable = httpsCallable<
      { displayName: string },
      { groupId: string; groupName: string }
    >(
      getFunctions(undefined, 'us-central1'),
      'ensureInnovationDayGroupMembership'
    );

    await callable({
      displayName: this.normalizeText(displayName) || 'Demo Athlete',
    });

    this.profileRepository.applyUserSummaryPatch(userId, {
      groupID: ['innovation-day'],
      groupId: 'innovation-day',
      groupName: 'Innovation day',
      groups: ['innovation-day'],
    });
    this.profileRepository.applyProfilePatch(userId, 'client', {
      groupID: ['innovation-day'],
      groupId: 'innovation-day',
      groupName: 'Innovation day',
      groups: ['innovation-day'],
    } as Record<string, unknown>);
  }

  private offsetDate(date: Date, daysAgo: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() - daysAgo);
    return next;
  }

  private toLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  }

  private mergeLoadedProfileWithUserSummary(
    userId: string,
    profile: trainerProfile | clientProfile,
    accountType: AccountType,
    userSummary: AppUser | null,
    fallbackEmail: string
  ): trainerProfile | clientProfile {
    const merged = {
      ...(profile as unknown as Record<string, unknown>),
      id: (profile as any)?.id || userId,
      accountType,
      email: (profile as any)?.email || fallbackEmail,
    } as (trainerProfile | clientProfile) & Record<string, unknown>;

    if (userSummary?.firstName) {
      merged.firstName = userSummary.firstName;
    }

    if (userSummary?.lastName) {
      merged.lastName = userSummary.lastName;
    }

    if (userSummary?.email) {
      merged.email = userSummary.email;
    }

    if (userSummary?.phone) {
      merged.phone = userSummary.phone;
    }

    if (typeof userSummary?.profilepic === 'string' && userSummary.profilepic.trim()) {
      merged.profilepic = userSummary.profilepic;
    }

    if (Object.prototype.hasOwnProperty.call(userSummary ?? {}, 'username')) {
      (merged as any).username = userSummary?.username ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(userSummary ?? {}, 'displayName')) {
      (merged as any).displayName = userSummary?.displayName ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(userSummary ?? {}, 'trainerId')) {
      (merged as any).trainerId = userSummary?.trainerId ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(userSummary ?? {}, 'demoMode')) {
      (merged as any).demoMode = userSummary?.demoMode === true;
    }

    if (Object.prototype.hasOwnProperty.call(userSummary ?? {}, 'role')) {
      (merged as any).role = userSummary?.role ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(userSummary ?? {}, 'fitnessLevel')) {
      (merged as any).fitnessLevel = userSummary?.fitnessLevel ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(userSummary ?? {}, 'goal')) {
      (merged as any).goal = userSummary?.goal ?? '';
    }

    return merged as trainerProfile | clientProfile;
  }

  syncCurrentUserSummaryPatch(userId: string, patch: Partial<AppUser>): void {
    const currentUser = this.userInfo();
    if (!currentUser || this.loadedProfileUid !== userId) {
      return;
    }

    const nextUser = {
      ...(currentUser as unknown as Record<string, unknown>),
    } as (trainerProfile | clientProfile) & Record<string, unknown>;

    if (Object.prototype.hasOwnProperty.call(patch, 'firstName')) {
      nextUser.firstName = patch.firstName ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'lastName')) {
      nextUser.lastName = patch.lastName ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'email')) {
      nextUser.email = patch.email ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'phone')) {
      nextUser.phone = patch.phone ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'profilepic')) {
      nextUser.profilepic = patch.profilepic ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'username')) {
      nextUser['username'] = patch.username ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'displayName')) {
      nextUser['displayName'] = patch.displayName ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'trainerId')) {
      nextUser['trainerId'] = patch.trainerId ?? '';
    }

    if (typeof patch.isPT === 'boolean') {
      nextUser.accountType = patch.isPT ? 'trainer' : 'client';
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'demoMode')) {
      nextUser['demoMode'] = patch.demoMode === true;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'role')) {
      if (patch.role === 'client' || patch.role === 'trainer') {
        nextUser['role'] = patch.role;
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'fitnessLevel')) {
      nextUser['fitnessLevel'] = patch.fitnessLevel ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'goal')) {
      nextUser['goal'] = patch.goal ?? '';
    }

    this.userInfo.set(nextUser as trainerProfile | clientProfile);
  }

  syncCurrentUserProfilePatch(
    userId: string,
    accountType: AccountType,
    patch: Partial<Record<string, unknown>>
  ): void {
    const currentUser = this.userInfo();
    if (!currentUser || this.loadedProfileUid !== userId || currentUser.accountType !== accountType) {
      return;
    }

    const nextUser = {
      ...(currentUser as unknown as Record<string, unknown>),
      ...patch,
    } as unknown as trainerProfile | clientProfile;
    this.userInfo.set(nextUser);
  }

  getUserInfo(): Signal<trainerProfile | clientProfile | null> {
    return this.userInfo;
  }

  getProfileCompletionRoute(): string {
    return this.profileCompletionRoute || '/complete-profile';
  }

  getUserById(userId: string, accountType: 'trainer' | 'client'): Signal<trainerProfile | clientProfile | null> {
    const userSignal = signal<trainerProfile | clientProfile | null>(null);
    void this.profileRepository.getProfile(userId, accountType)
      .then((profile) => {
        userSignal.set(profile as trainerProfile | clientProfile | null);
      })
      .catch((error) => {
        console.error(`[UserService] Error fetching user (${accountType}):`, error);
        userSignal.set(null);
      });

    return userSignal;
  }

  async updateClientProfile(uid: string, profileData: Partial<clientProfile>, imageFile?: File): Promise<void> {
    try {
      if (imageFile) {
        const imageUrl = await this.uploadClientImage(uid, imageFile);
        profileData.profilepic = imageUrl;
      }

      const docRef = doc(this.firestore, `${this.CLIENTS_COLLECTION}/${uid}`);
      await updateDoc(docRef, profileData);

      const userSummaryPatch: Partial<AppUser> = {};
      if (Object.prototype.hasOwnProperty.call(profileData, 'firstName')) {
        userSummaryPatch.firstName = profileData.firstName ?? '';
      }
      if (Object.prototype.hasOwnProperty.call(profileData, 'lastName')) {
        userSummaryPatch.lastName = profileData.lastName ?? '';
      }
      if (Object.prototype.hasOwnProperty.call(profileData, 'email')) {
        userSummaryPatch.email = profileData.email ?? '';
      }
      if (Object.prototype.hasOwnProperty.call(profileData, 'profilepic')) {
        userSummaryPatch.profilepic = profileData.profilepic ?? '';
      }
      if (Object.prototype.hasOwnProperty.call(profileData, 'trainerId')) {
        userSummaryPatch.trainerId = (profileData as Record<string, unknown>)['trainerId'] as string;
      }

      if (Object.keys(userSummaryPatch).length > 0) {
        await setDoc(
          doc(this.firestore, 'users', uid),
          {
            ...userSummaryPatch,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        this.profileRepository.applyUserSummaryPatch(uid, userSummaryPatch);
        this.syncCurrentUserSummaryPatch(uid, userSummaryPatch);
      }

      this.profileRepository.applyProfilePatch(uid, 'client', profileData as unknown as Record<string, unknown>);
      this.syncCurrentUserProfilePatch(uid, 'client', profileData as unknown as Record<string, unknown>);
    } catch (error) {
      console.error('Error updating client profile:', error);
      throw error;
    }
  }

  async getUserProfileDirectly(uid: string, accountType: 'trainer' | 'client'): Promise<trainerProfile | clientProfile | null> {
    return this.profileRepository.getProfile(uid, accountType) as Promise<trainerProfile | clientProfile | null>;
  }

  async getUserSummaryDirectly(userId: string, forceRefresh = false): Promise<AppUser | null> {
    return this.profileRepository.getUserSummary(userId, forceRefresh);
  }

  async getResolvedUserProfileDirectly(
    uid: string,
    preferredType?: AccountType,
    forceRefresh = false
  ): Promise<trainerProfile | clientProfile | null> {
    return this.profileRepository.getResolvedProfile(
      uid,
      preferredType,
      forceRefresh
    ) as Promise<trainerProfile | clientProfile | null>;
  }

  async getResolvedAccountType(
    uid: string,
    preferredType?: AccountType,
    forceRefresh = false
  ): Promise<AccountType | null> {
    return this.profileRepository.getResolvedAccountType(uid, preferredType, forceRefresh);
  }

  async uploadClientImage(uid: string, file: File): Promise<string> {
    try {
      // Use the new FileUploadService for more reliable uploads
      const storagePath = `client-images/${uid}`;
      return await this.fileUploadService.uploadFile(storagePath, file);
    } catch (error: any) {
      console.error('Error uploading client image:', error);
      throw error; // FileUploadService already handles detailed error logging
    }
  }
  
  /**
   * Get the current authenticated user as a Signal
   * @returns Signal with the user object containing uid and other properties
   */
  getCurrentUser(): Signal<{uid: string, email: string} | null> {
    return computed(() => this.accountService.getCredentials()());
  }


  getUserFullName(userId: string, accountType: 'trainer' | 'client'): Observable<string> {
    return from(this.getUserProfileDirectly(userId, accountType)).pipe(
      map(userProfile => {
        if (!userProfile) return '';
        if (accountType === 'trainer') {
          const profile = userProfile as trainerProfile;
          return `${profile.firstName} ${profile.lastName}`;
        } else {
          const profile = userProfile as clientProfile;
          return `${profile.firstName} ${profile.lastName}`;
        }
      })
    );
  }

  /**
   * Increment unread message count for a user
   * @param userId The user ID to increment count for
   * @param accountType The account type (trainer or client)
   */
  async incrementUnreadMessageCount(userId: string, accountType: 'trainer' | 'client'): Promise<number> {
    try {
      const collection = accountType === 'trainer' ? this.TRAINERS_COLLECTION : this.CLIENTS_COLLECTION;
      const docRef = doc(this.firestore, `${collection}/${userId}`);
      
      // Get current profile to read current count
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        console.error('User profile not found for incrementing unread count');
        return 0;
      }
      
      const currentProfile = docSnap.data() as trainerProfile | clientProfile;
      const currentCount = currentProfile.unreadMessageCount || 0;
      const newCount = currentCount + 1;
      
      // Update the unread message count
      await updateDoc(docRef, { unreadMessageCount: newCount });
      this.profileRepository.applyProfilePatch(userId, accountType, { unreadMessageCount: newCount });
      this.syncCurrentUserProfilePatch(userId, accountType, { unreadMessageCount: newCount });
      return newCount;
    } catch (error) {
      console.error('Error incrementing unread message count:', error);
      return 0;
    }
  }

  /**
   * Adjust unread message count for a user by a delta and clamp at 0.
   * @param userId The user ID to update
   * @param accountType The account type (trainer or client)
   * @param delta Positive to increment, negative to decrement
   */
  async adjustUnreadMessageCount(
    userId: string,
    accountType: 'trainer' | 'client',
    delta: number
  ): Promise<number> {
    try {
      const collection = accountType === 'trainer' ? this.TRAINERS_COLLECTION : this.CLIENTS_COLLECTION;
      const docRef = doc(this.firestore, `${collection}/${userId}`);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        console.error('User profile not found for adjusting unread count');
        return 0;
      }

      const currentProfile = docSnap.data() as trainerProfile | clientProfile;
      const currentCount = currentProfile.unreadMessageCount || 0;
      const normalizedDelta = Number.isFinite(delta) ? Math.trunc(delta) : 0;
      const nextCount = Math.max(0, currentCount + normalizedDelta);

      await updateDoc(docRef, { unreadMessageCount: nextCount });
      this.profileRepository.applyProfilePatch(userId, accountType, { unreadMessageCount: nextCount });
      this.syncCurrentUserProfilePatch(userId, accountType, { unreadMessageCount: nextCount });
      return nextCount;
    } catch (error) {
      console.error('Error adjusting unread message count:', error);
      return 0;
    }
  }

  /**
   * Reset unread message count for a user to 0
   * @param userId The user ID to reset count for
   * @param accountType The account type (trainer or client)
   */
  async resetUnreadMessageCount(userId: string, accountType: 'trainer' | 'client'): Promise<void> {
    try {
      const collection = accountType === 'trainer' ? this.TRAINERS_COLLECTION : this.CLIENTS_COLLECTION;
      const docRef = doc(this.firestore, `${collection}/${userId}`);
      
      // Reset the unread message count to 0
      await updateDoc(docRef, { unreadMessageCount: 0 });
      this.profileRepository.applyProfilePatch(userId, accountType, { unreadMessageCount: 0 });
      this.syncCurrentUserProfilePatch(userId, accountType, { unreadMessageCount: 0 });
    } catch (error) {
      console.error('Error resetting unread message count:', error);
    }
  }

  /**
   * Get current unread message count for a user
   * @param userId The user ID to get count for
   * @param accountType The account type (trainer or client)
   */
  async getUnreadMessageCount(userId: string, accountType: 'trainer' | 'client'): Promise<number> {
    try {
      const profile = await this.getUserProfileDirectly(userId, accountType);
      return profile?.unreadMessageCount || 0;
    } catch (error) {
      console.error('Error getting unread message count:', error);
      return 0;
    }
  }

  /**
   * Link partial profiles using phone number after profile creation
   */
  async linkProfileByPhone(phoneNumber: string): Promise<any> {
    try {
      const credentials = this.accountService.getCredentials()();
      const uid = credentials?.uid;
      const email = credentials?.email;
      
      if (!uid || !phoneNumber) {
        return null;
      }
      
      // Use the modified linkProfile function with phone number
      const functions = getFunctions(undefined, 'us-west1');
      const linkProfileFunction = httpsCallable(functions, 'linkProfile');
      const result = await linkProfileFunction({ phoneNumber, uid, email });
      const data = result.data as any;
      
      if (data.success && data.linkedProfiles > 0) {
        return data.profileData;
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error linking profile by phone:', error);
      return null;
    }
  }
}
