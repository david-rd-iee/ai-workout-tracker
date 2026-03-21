import { Injectable, signal, Signal, computed } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { credentials } from '../../interfaces/profiles/credentials';
type Credentials = credentials;
import { Platform } from '@ionic/angular';
import { Subject } from 'rxjs';
import { Router } from '@angular/router';
import firebase from 'firebase/compat/app';
import { Firestore, deleteField, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { GroupService } from '../group.service';
import {
  calculateUserLevelProgress,
  normalizeEarlyMorningWorkoutsTracker,
  normalizeStreakData,
  normalizeUserScore,
} from '../../models/user-stats.model';
// Import for Capacitor plugins
import { registerPlugin } from '@capacitor/core';

// Define the interface for the Apple Sign In plugin
interface AppleSignInPlugin {
  Authorize(): Promise<{
    response?: {
      identityToken: string;
      email?: string;
      familyName?: string;
      givenName?: string;
      authorizationCode?: string;
    };
    identityToken?: string;
    email?: string;
    user?: string;
  }>;
}

// Register the Apple Sign In plugin
const SignInWithApple = registerPlugin<AppleSignInPlugin>('SignInWithApple');

@Injectable({
  providedIn: 'root'
})
export class AccountService {
  private credentials = signal<Credentials>({ uid: '', email: '' });
  private authInitialized = signal(false);
  private isAuthenticated = computed(() => !!this.credentials().uid);
  private lastAuthError = signal('');
  private lastTrainerGroupBootstrapUid = '';
  
  // Event system for authentication state changes
  private authStateChange$ = new Subject<{ user: any; isAuthenticated: boolean }>();
  
  // Public observable for other services to listen to auth changes
  public authStateChanges$ = this.authStateChange$.asObservable();

  constructor(
    private afAuth: AngularFireAuth,
    private router: Router,
    private platform: Platform,
    private firestore: Firestore,
    private groupService: GroupService
  ) {
    this.initializeAuth();
  }

  private async ensureUsersDocument(uid: string, email: string | null): Promise<void> {
    const userRef = doc(this.firestore, 'users', uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        userId: uid,
        email: email ?? '',
        firstName: '',
        lastName: '',
        username: '',
        isPT: false,
        trainerId: '',
        groups: [],
        profilepic: '',
        created_at: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const userStatsRef = doc(this.firestore, 'userStats', uid);
    const userStatsSnap = await getDoc(userStatsRef);
    if (!userStatsSnap.exists()) {
      const levelProgress = calculateUserLevelProgress(0);
      await setDoc(userStatsRef, {
        userId: uid,
        age: 0,
        sex: 0,
        heightMeters: 0,
        weightKg: 0,
        bmi: 0,
        userScore: {
          cardioScore: {
            totalCardioScore: 0,
          },
          strengthScore: {
            totalStrengthScore: 0,
          },
          totalScore: 0,
          maxAddedScoreWithinDay: 0,
        },
        Expected_Effort: {
          Cardio: {},
          Strength: {},
        },
        ...levelProgress,
        streakData: normalizeStreakData(undefined),
        earlymorningWorkoutsTracker: normalizeEarlyMorningWorkoutsTracker(undefined),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const current = userStatsSnap.data() as any;
    const normalizedUserScore = normalizeUserScore(
      current?.userScore,
      current?.cardioScore,
      current?.strengthScore,
      current?.totalScore,
      current?.workScore
    );
    const cardioTotal = normalizedUserScore.cardioScore.totalCardioScore;
    const strengthTotal = normalizedUserScore.strengthScore.totalStrengthScore;
    const totalScore = cardioTotal + strengthTotal;
    const levelProgress = calculateUserLevelProgress(totalScore);

    const hasUserScoreMap =
      typeof current?.userScore === 'object' &&
      current?.userScore !== null &&
      typeof current?.userScore?.cardioScore === 'object' &&
      current?.userScore?.cardioScore !== null &&
      typeof current?.userScore?.strengthScore === 'object' &&
      current?.userScore?.strengthScore !== null;
    const hasCardioTotal =
      Number(current?.userScore?.cardioScore?.totalCardioScore) === cardioTotal;
    const hasStrengthTotal =
      Number(current?.userScore?.strengthScore?.totalStrengthScore) === strengthTotal;
    const expectedEffort = this.normalizeExpectedEffort(
      current?.Expected_Effort,
      current?.expected_strength_scores
    );
    const streakData = normalizeStreakData(
      current?.streakData,
      current?.currentStreak,
      current?.maxStreak
    );
    const earlymorningWorkoutsTracker = normalizeEarlyMorningWorkoutsTracker(
      current?.earlymorningWorkoutsTracker
    );
    const hasExpectedEffortMap =
      typeof current?.Expected_Effort === 'object' &&
      current?.Expected_Effort !== null &&
      typeof current?.Expected_Effort?.Cardio === 'object' &&
      current?.Expected_Effort?.Cardio !== null &&
      typeof current?.Expected_Effort?.Strength === 'object' &&
      current?.Expected_Effort?.Strength !== null;
    const rawStreakData =
      typeof current?.streakData === 'object' && current?.streakData !== null
        ? current.streakData as Record<string, unknown>
        : null;
    const hasStreakDataMap =
      rawStreakData !== null &&
      Number(rawStreakData['currentStreak']) === streakData.currentStreak &&
      Number(rawStreakData['maxStreak']) === streakData.maxStreak &&
      String(rawStreakData['lastLoggedDay'] ?? '').trim() ===
        String(streakData.lastLoggedDay ?? '').trim();
    const rawEarlyMorningWorkoutsTracker =
      typeof current?.earlymorningWorkoutsTracker === 'object' &&
      current?.earlymorningWorkoutsTracker !== null
        ? current.earlymorningWorkoutsTracker as Record<string, unknown>
        : null;
    const hasEarlyMorningWorkoutsTrackerMap =
      rawEarlyMorningWorkoutsTracker !== null &&
      Number(rawEarlyMorningWorkoutsTracker['earlyMorningWorkoutNumber']) ===
        earlymorningWorkoutsTracker.earlyMorningWorkoutNumber &&
      String(rawEarlyMorningWorkoutsTracker['dateLastUpdated'] ?? '').trim() ===
        String(earlymorningWorkoutsTracker.dateLastUpdated ?? '').trim();
    const hasLegacyExpectedStrengthScores =
      typeof current?.expected_strength_scores === 'object' &&
      current?.expected_strength_scores !== null;
    const hasLegacyTopLevelScores =
      Object.prototype.hasOwnProperty.call(current ?? {}, 'cardioScore') ||
      Object.prototype.hasOwnProperty.call(current ?? {}, 'strengthScore') ||
      Object.prototype.hasOwnProperty.call(current ?? {}, 'totalScore') ||
      Object.prototype.hasOwnProperty.call(current ?? {}, 'workScore');
    const totalNeedsUpdate = Number(current?.userScore?.totalScore) !== totalScore;
    const maxAddedScoreNeedsUpdate =
      Number(current?.userScore?.maxAddedScoreWithinDay) !==
      normalizedUserScore.maxAddedScoreWithinDay;
    const levelNeedsUpdate =
      Number(current?.level) !== levelProgress.level ||
      Number(current?.percentage_of_level) !== levelProgress.percentage_of_level;

    if (
      !hasUserScoreMap ||
      !hasCardioTotal ||
      !hasStrengthTotal ||
      !hasExpectedEffortMap ||
      !hasStreakDataMap ||
      !hasEarlyMorningWorkoutsTrackerMap ||
      hasLegacyTopLevelScores ||
      hasLegacyExpectedStrengthScores ||
      totalNeedsUpdate ||
      maxAddedScoreNeedsUpdate ||
      levelNeedsUpdate
    ) {
      await setDoc(
        userStatsRef,
        {
          userScore: {
            ...normalizedUserScore,
            totalScore,
          },
          Expected_Effort: expectedEffort,
          streakData,
          earlymorningWorkoutsTracker,
          cardioScore: deleteField(),
          strengthScore: deleteField(),
          totalScore: deleteField(),
          workScore: deleteField(),
          expected_strength_scores: deleteField(),
          ...levelProgress,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  private normalizeExpectedEffort(
    value: unknown,
    legacyStrengthScores?: unknown
  ): { Cardio: Record<string, number>; Strength: Record<string, number> } {
    const expectedEffort = value && typeof value === 'object'
      ? value as Record<string, unknown>
      : {};

    return {
      Cardio: this.toNumberMap(expectedEffort['Cardio']),
      Strength: this.toNumberMap(expectedEffort['Strength'] ?? legacyStrengthScores),
    };
  }

  private toNumberMap(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>(
      (acc, [key, candidateValue]) => {
        const parsed = Number(candidateValue);
        if (Number.isFinite(parsed)) {
          acc[key] = parsed;
        }
        return acc;
      },
      {}
    );
  }

  private async initializeAuth() {
    try {
      // Use session persistence on web so each browser tab can keep its own auth user.
      // Keep local persistence on native platforms.
      await this.afAuth.setPersistence(this.platform.is('hybrid') ? 'local' : 'session');

      this.afAuth.authState.subscribe(async (user) => {
        if (user && user.uid) {
          try {
            await this.ensureUsersDocument(user.uid, user.email ?? null);
            if (this.lastTrainerGroupBootstrapUid !== user.uid) {
              await this.groupService.ensureTrainerPtGroup(user.uid);
              this.lastTrainerGroupBootstrapUid = user.uid;
            }
          } catch (ensureError) {
            console.error('Error ensuring user documents:', ensureError);
          }
          this.credentials.set({ uid: user.uid, email: user.email || '' });
          
          // Emit authentication state change event
          this.authStateChange$.next({ user, isAuthenticated: true });
        } else {
          this.credentials.set({ uid: '', email: '' });
          this.lastTrainerGroupBootstrapUid = '';
          this.authStateChange$.next({ user: null, isAuthenticated: false });
        }
        this.authInitialized.set(true);
      });
    } catch (error) {
      console.error('Error initializing auth:', error);
      this.authInitialized.set(true);
    }
  }

  isAuthReady(): Signal<boolean> {
    return this.authInitialized.asReadonly();
  }

  isLoggedIn(): Signal<boolean> {
    return this.isAuthenticated;
  }

  getCredentials(): Signal<Credentials> {
    return this.credentials.asReadonly();
  }

  getLastAuthErrorMessage(): string {
    return this.lastAuthError();
  }

  clearLastAuthError(): void {
    this.lastAuthError.set('');
  }

  private mapFirebaseAuthError(error: any): string {
    const code = error?.code as string | undefined;
    switch (code) {
      case 'auth/invalid-email':
        return 'Invalid email format.';
      case 'auth/invalid-credential':
        return 'Incorrect email or password.';
      case 'auth/user-disabled':
        return 'This account has been disabled.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Try again later or reset your password.';
      case 'auth/network-request-failed':
        return 'Network error. Check your internet connection and try again.';
      case 'auth/operation-not-allowed':
        return 'Email/password sign-in is not enabled in Firebase Auth.';
      case 'auth/unauthorized-domain':
        return 'This domain is not authorized in Firebase Authentication settings.';
      default:
        return error?.message || 'Login failed. Please try again.';
    }
  }

  // Update the signup method
  async signup(email: string, password: string): Promise<boolean> {
    try {
      this.lastAuthError.set('');
      const cleanEmail = email.trim();
      const userCredential = await this.afAuth.createUserWithEmailAndPassword(cleanEmail, password);
      if (!userCredential.user) {
        return false;
      }
      await this.ensureUsersDocument(userCredential.user.uid, userCredential.user.email ?? cleanEmail);
      this.credentials.set({ uid: userCredential.user.uid, email: cleanEmail });
      return true;
    } catch (e: any) {
      console.error('Signup failed:', e);
      this.lastAuthError.set(this.mapFirebaseAuthError(e));
      return false;
    }
  }

  // Update the login method
  async login(email: string, password: string): Promise<boolean> {
    try {
      this.lastAuthError.set('');
      const cleanEmail = email.trim();
      const userCredential = await this.afAuth.signInWithEmailAndPassword(cleanEmail, password);
      if (userCredential.user === null) {
        this.lastAuthError.set('Login failed. No user returned from Firebase.');
        return false;
      }

      await this.ensureUsersDocument(userCredential.user.uid, userCredential.user.email ?? email);
      this.credentials.set({ uid: userCredential.user.uid, email: email });
      return true;
    } catch (e: any) {
      console.error('Login failed:', e);
      this.lastAuthError.set(this.mapFirebaseAuthError(e));
      return false;
    }
  }

  // Update the logout method
  async logout() {
    await this.afAuth.signOut();
    // Force reload all routes by navigating to login
    await this.router.navigate(['/login'], {
      onSameUrlNavigation: 'reload',
      replaceUrl: true
    });

    // Optional: Refresh the page to clear all states
    window.location.reload();
    this.credentials.set({ uid: '', email: '' });
  }

  // Change password method
  async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    try {
      // Get current user
      const user = await this.afAuth.currentUser;
      
      if (!user) {
        return { success: false, message: 'No user is currently logged in' };
      }
      
      // Get current email
      const email = user.email;
      
      if (!email) {
        return { success: false, message: 'User email not found' };
      }
      
      // Re-authenticate user before changing password
      try {
        const credential = firebase.auth.EmailAuthProvider.credential(email, currentPassword);
        await user.reauthenticateWithCredential(credential);
      } catch (error) {
        console.error('Re-authentication failed:', error);
        return { success: false, message: 'Current password is incorrect' };
      }
      
      // Change password
      await user.updatePassword(newPassword);
      return { success: true, message: 'Password updated successfully' };
    } catch (error: any) {
      console.error('Password change error:', error);
      return { 
        success: false, 
        message: error.message || 'Failed to change password. Please try again.'
      };
    }
  }

  // Sign in with Apple
  async signInWithApple(): Promise<boolean> {
    try {
      // Only proceed if on iOS platform
      if (!this.platform.is('ios')) {
        return false;
      }

      // Use the Capacitor Apple Login plugin
      const result = await SignInWithApple.Authorize();
      
      // The plugin returns data in a 'response' object
      const appleResponse = result.response || result;
      
      if (!appleResponse || !appleResponse.identityToken) {
        return false;
      }

      // Create a credential for Firebase Auth
      const oauthProvider = new firebase.auth.OAuthProvider('apple.com');
      const credential = oauthProvider.credential({
        idToken: appleResponse.identityToken
      });

      // Sign in with the credential
      const userCredential = await this.afAuth.signInWithCredential(credential);
      
      if (!userCredential.user) {
        return false;
      }

      // Set the credentials
      const email = userCredential.user.email || appleResponse.email || '';
      await this.ensureUsersDocument(userCredential.user.uid, email);
      this.credentials.set({ uid: userCredential.user.uid, email: email });
      return true;
    } catch (error) {
      console.error('Apple Sign In error:', error);
      return false;
    }
  }
}
