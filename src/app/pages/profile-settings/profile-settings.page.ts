import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavController } from '@ionic/angular';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBackOutline } from 'ionicons/icons';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { EmailAuthProvider, reauthenticateWithCredential, updateEmail, User, verifyBeforeUpdateEmail } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { AlertController } from '@ionic/angular';
import { deleteField, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

@Component({
  selector: 'app-profile-settings',
  templateUrl: './profile-settings.page.html',
  styleUrls: ['./profile-settings.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonItem,
    IonInput,
    IonText,
  ],
})
export class ProfileSettingsPage implements OnInit {
  private navCtrl = inject(NavController);
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private router = inject(Router);
  private alertCtrl = inject(AlertController);

  firstName = '';
  lastName = '';
  email = '';
  initialEmail = '';
  weight: string | number | null = '';
  height: string | number | null = '';

  isLoading = false;
  isSaving = false;
  errorMessage = '';
  successMessage = '';

  constructor() {
    addIcons({ arrowBackOutline });
  }

  ngOnInit(): void {
    void this.loadSettings();
  }

  goBack(): void {
    this.navCtrl.navigateBack('/profile-user', {
      animated: true,
      animationDirection: 'back',
    });
  }

  async saveSettings(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';

    const authUser = await this.resolveCurrentUser();
    if (!authUser) {
      this.errorMessage = 'You must be logged in to update settings.';
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }
    const uid = authUser.uid;

    const firstName = this.firstName.trim();
    const lastName = this.lastName.trim();
    const email = this.email.trim();

    if (!firstName || !lastName || !email) {
      this.errorMessage = 'First name, last name, and email are required.';
      return;
    }

    const parsedWeight = this.parseOptionalNumber(this.weight);
    const parsedHeight = this.parseOptionalNumber(this.height);

    if (parsedWeight !== null && parsedWeight <= 0) {
      this.errorMessage = 'Weight must be greater than 0.';
      return;
    }

    if (parsedHeight !== null && parsedHeight <= 0) {
      this.errorMessage = 'Height must be greater than 0.';
      return;
    }

    this.isSaving = true;

    let emailForUsersDoc = email;
    let emailUpdateError: string | null = null;
    let emailVerificationSent = false;

    try {
      const emailChanged = this.normalizeEmail(email) !== this.normalizeEmail(this.initialEmail);
      if (emailChanged) {
        try {
          const result = await this.updateAuthEmailWithReauthIfNeeded(authUser, email);
          if (result === 'updated') {
            this.initialEmail = email;
          } else if (result === 'verification-sent') {
            emailVerificationSent = true;
            emailForUsersDoc = this.initialEmail || (authUser.email ?? '').trim() || email;
          }
        } catch (emailError: unknown) {
          console.error('[ProfileSettingsPage] Email update failed:', emailError);
          emailUpdateError = this.getUserFriendlyAuthError(emailError);
          emailForUsersDoc = this.initialEmail || (authUser.email ?? '').trim() || email;
        }
      }

      const userRef = doc(this.firestore, 'users', uid);
      await setDoc(
        userRef,
        {
          userId: uid,
          firstName,
          lastName,
          email: emailForUsersDoc,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const userStatsPayload: Record<string, unknown> = {
        userId: uid,
        updatedAt: serverTimestamp(),
      };

      userStatsPayload['weight'] = parsedWeight === null ? deleteField() : parsedWeight;
      userStatsPayload['height'] = parsedHeight === null ? deleteField() : parsedHeight;

      const userStatsRef = doc(this.firestore, 'userStats', uid);
      await setDoc(userStatsRef, userStatsPayload, { merge: true });

      if (emailVerificationSent) {
        this.errorMessage =
          'Verification email sent. Confirm the new email, then save again to sync it here.';
        this.successMessage = 'Name, weight, and height were saved.';
        this.email = emailForUsersDoc;
      } else if (emailUpdateError) {
        this.errorMessage = emailUpdateError;
        this.successMessage = 'Name, weight, and height were saved.';
        this.email = emailForUsersDoc;
      } else {
        this.successMessage = 'Settings saved.';
      }
    } catch (error: unknown) {
      console.error('[ProfileSettingsPage] Failed to save settings:', error);
      this.errorMessage = this.getUserFriendlyAuthError(error);
    } finally {
      this.isSaving = false;
    }
  }

  private async loadSettings(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    const authUser = await this.resolveCurrentUser();
    const uid = authUser?.uid ?? null;
    if (!uid) {
      this.errorMessage = 'You must be logged in to view settings.';
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      this.isLoading = false;
      return;
    }

    try {
      const userRef = doc(this.firestore, 'users', uid);
      const userStatsRef = doc(this.firestore, 'userStats', uid);
      const [userSnap, userStatsSnap] = await Promise.all([
        getDoc(userRef),
        getDoc(userStatsRef),
      ]);

      if (userSnap.exists()) {
        const userData = userSnap.data();
        this.firstName = typeof userData?.['firstName'] === 'string' ? userData['firstName'] : '';
        this.lastName = typeof userData?.['lastName'] === 'string' ? userData['lastName'] : '';
        this.email = typeof userData?.['email'] === 'string' ? userData['email'] : '';
      }

      if (!this.email && this.auth.currentUser?.email) {
        this.email = this.auth.currentUser.email;
      }

      this.initialEmail = this.email.trim();

      if (userStatsSnap.exists()) {
        const userStatsData = userStatsSnap.data();
        const weight = userStatsData?.['weight'];
        const height = userStatsData?.['height'];

        this.weight = typeof weight === 'number' ? String(weight) : '';
        this.height = typeof height === 'number' ? String(height) : '';
      }
    } catch (error) {
      console.error('[ProfileSettingsPage] Failed to load settings:', error);
      this.errorMessage = 'Failed to load settings.';
    } finally {
      this.isLoading = false;
    }
  }

  private parseOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    const trimmed = String(value).trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async resolveCurrentUser(): Promise<User | null> {
    if (this.auth.currentUser) {
      return this.auth.currentUser;
    }

    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(this.auth, (user) => {
        unsubscribe();
        resolve(user ?? null);
      });
    });
  }

  private isRequiresRecentLoginError(error: unknown): boolean {
    return (
      error instanceof FirebaseError &&
      (error.code === 'auth/requires-recent-login' ||
        error.code === 'auth/user-token-expired')
    );
  }

  private async updateAuthEmailWithReauthIfNeeded(
    authUser: User,
    nextEmail: string
  ): Promise<'updated' | 'verification-sent'> {
    try {
      await updateEmail(authUser, nextEmail);
      return 'updated';
    } catch (error: unknown) {
      if (this.isEmailVerificationRequiredError(error)) {
        await verifyBeforeUpdateEmail(authUser, nextEmail);
        return 'verification-sent';
      }

      if (!this.isRequiresRecentLoginError(error)) {
        throw error;
      }
    }

    const hasPasswordProvider = authUser.providerData.some((provider) => provider.providerId === 'password');
    if (!hasPasswordProvider) {
      throw new FirebaseError(
        'auth/requires-recent-login',
        'Recent login required and no password provider is linked.'
      );
    }

    const password = await this.promptForCurrentPassword();
    if (!password) {
      throw new FirebaseError('auth/requires-recent-login', 'Re-authentication was canceled by the user.');
    }

    const currentEmail = authUser.email?.trim();
    if (!currentEmail) {
      throw new FirebaseError('auth/missing-email', 'Current auth email is missing.');
    }

    const credential = EmailAuthProvider.credential(currentEmail, password);
    await reauthenticateWithCredential(authUser, credential);
    try {
      await updateEmail(authUser, nextEmail);
      return 'updated';
    } catch (error: unknown) {
      if (this.isEmailVerificationRequiredError(error)) {
        await verifyBeforeUpdateEmail(authUser, nextEmail);
        return 'verification-sent';
      }
      throw error;
    }
  }

  private async promptForCurrentPassword(): Promise<string | null> {
    const alert = await this.alertCtrl.create({
      header: 'Confirm Password',
      message: 'Please enter your current password to change your email.',
      inputs: [
        {
          name: 'currentPassword',
          type: 'password',
          placeholder: 'Current password',
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Continue', role: 'confirm' },
      ],
    });

    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'confirm') {
      return null;
    }

    const value = String(result.data?.values?.currentPassword ?? '').trim();
    return value || null;
  }

  private getUserFriendlyAuthError(error: unknown): string {
    if (!(error instanceof FirebaseError)) {
      return 'Failed to save settings. Please try again.';
    }

    switch (error.code) {
      case 'auth/requires-recent-login':
      case 'auth/user-token-expired':
        return 'For security, log out and back in, then try changing your email again.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/email-already-in-use':
        return 'That email is already in use by another account.';
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Current password is incorrect.';
      case 'auth/network-request-failed':
        return 'Network error while updating email. Check your connection and try again.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a bit and try again.';
      case 'auth/operation-not-allowed':
        return 'Email change is not allowed directly. Verify the new email first.';
      case 'auth/internal-error':
        return 'Auth service returned an internal error. Please try again.';
      default:
        return `Failed to update email (${error.code}).`;
    }
  }

  private isEmailVerificationRequiredError(error: unknown): boolean {
    return (
      error instanceof FirebaseError &&
      error.code === 'auth/operation-not-allowed' &&
      String(error.message).toLowerCase().includes('verify the new email')
    );
  }

  private normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
  }
}
