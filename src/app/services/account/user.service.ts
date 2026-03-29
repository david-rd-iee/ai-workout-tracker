import { Injectable, signal, computed, Signal, effect } from '@angular/core';
import { AccountService } from './account.service';
import { trainerProfile } from '../../Interfaces/Profiles/Trainer';
import { clientProfile } from '../../Interfaces/Profiles/client';
import { Firestore, setDoc, getDoc, doc, updateDoc, serverTimestamp } from '@angular/fire/firestore';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { FileUploadService } from '../file-upload.service';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { AppUser } from '../../models/user.model';
import { AccountType, ProfileRepositoryService } from './profile-repository.service';
import { UserBadgesService } from '../user-badges.service';
import { UserStatsService } from '../user-stats.service';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private userInfo = signal<trainerProfile | clientProfile | null>(null);
  private readonly TRAINERS_COLLECTION = 'trainers';
  private readonly CLIENTS_COLLECTION = 'clients';
  private profileLoadPromise: Promise<boolean> | null = null;
  private loadedProfileUid: string | null = null;
  private profileCompletionRoute = '/complete-profile';

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
      const collection = formData.accountType === 'trainer'
        ? this.TRAINERS_COLLECTION
        : this.CLIENTS_COLLECTION;

      // Add required fields for chat functionality
      const profileData = {
        ...formData,
        unreadMessageCount: 0, // Initialize unread message count
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const userDocRef = doc(this.firestore, `${collection}/${userID}`);
      await setDoc(userDocRef, profileData);

      const usersRef = doc(this.firestore, `users/${userID}`);
      const firstName = typeof (formData as any)?.firstName === 'string'
        ? (formData as any).firstName.trim()
        : '';
      const lastName = typeof (formData as any)?.lastName === 'string'
        ? (formData as any).lastName.trim()
        : '';

      await setDoc(
        usersRef,
        {
          userId: userID,
          email: authEmail ?? '',
          firstName,
          lastName,
          isPT: formData.accountType === 'trainer',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const userSummaryPatch: Partial<AppUser> = {
        userId: userID,
        email: authEmail ?? '',
        firstName,
        lastName,
        isPT: formData.accountType === 'trainer',
      };
      this.profileRepository.primeUserSummary(userID, userSummaryPatch);
      this.profileRepository.primeProfile(userID, formData.accountType, {
        ...profileData,
        id: userID,
        email: authEmail ?? '',
      });
      this.syncCurrentUserSummaryPatch(userID, userSummaryPatch);
      this.syncCurrentUserProfilePatch(userID, formData.accountType, {
        ...profileData,
        id: userID,
        email: authEmail ?? '',
      });
      return true;
    } else {
      throw new Error('User ID not found');
    }
  }

  async loadUserProfile(): Promise<boolean> {
    this.profileCompletionRoute = '/complete-profile';

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
      this.profileCompletionRoute = '/profile-creation/trainer';
      this.userInfo.set(null);
      this.loadedProfileUid = null;
      this.userBadgesService.clear();
      this.userStatsService.clear();
      return false;
    }

    let hasRequiredStats = true;
    const usersData = await this.getUserSummaryDirectly(userID);
    if (!isTrainerProfile) {
      const userStatsDoc = await getDoc(doc(this.firestore, 'userStats', userID));
      const userStatsData = userStatsDoc.exists() ? userStatsDoc.data() : null;
      await this.ensureBmiField(userID, userStatsData);
      hasRequiredStats = this.hasRequiredUserStats(userStatsData);
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

      // Keep complete-profile flow for signups until core identity fields are set.
      if (!firstName || !lastName || !username) {
        this.profileCompletionRoute = '/complete-profile';
        this.userInfo.set(null);
        this.loadedProfileUid = null;
        this.userBadgesService.clear();
        this.userStatsService.clear();
        return false;
      }

      if (!hasRequiredStats) {
        this.profileCompletionRoute = '/complete-profile';
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
      this.profileCompletionRoute = '/complete-profile';
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
    const isTrainer = usersData?.['isPT'] === true;
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

    if (typeof userSummary?.profilepic === 'string' && userSummary.profilepic.trim()) {
      merged.profilepic = userSummary.profilepic;
    }

    if (Object.prototype.hasOwnProperty.call(userSummary ?? {}, 'username')) {
      (merged as any).username = userSummary?.username ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(userSummary ?? {}, 'trainerId')) {
      (merged as any).trainerId = userSummary?.trainerId ?? '';
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

    if (Object.prototype.hasOwnProperty.call(patch, 'profilepic')) {
      nextUser.profilepic = patch.profilepic ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'username')) {
      nextUser['username'] = patch.username ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'trainerId')) {
      nextUser['trainerId'] = patch.trainerId ?? '';
    }

    if (typeof patch.isPT === 'boolean') {
      nextUser.accountType = patch.isPT ? 'trainer' : 'client';
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
