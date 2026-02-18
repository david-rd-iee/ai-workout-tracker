import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent,
  IonItem,
  IonInput,
  IonButton,
  IonText,
} from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';

@Component({
  selector: 'app-complete-profile',
  templateUrl: './complete-profile.page.html',
  styleUrls: ['./complete-profile.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonItem,
    IonInput,
    IonButton,
    IonText,
  ],
})
export class CompleteProfilePage implements OnInit {
  private router = inject(Router);
  private auth = inject(Auth);
  private firestore = inject(Firestore);

  firstName = '';
  lastName = '';
  username = '';

  isSubmitting = false;
  errorMessage = '';

  ngOnInit(): void {
    this.loadExistingUserProfile();
  }

  async onSubmit(): Promise<void> {
    this.errorMessage = '';

    const firstName = this.firstName.trim();
    const lastName = this.lastName.trim();
    const username = this.username.trim();

    if (!firstName || !lastName || !username) {
      this.errorMessage = 'Please fill out all fields.';
      return;
    }

    const uid = await this.resolveCurrentUid();
    if (!uid) {
      this.errorMessage = 'You must be logged in to continue.';
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }

    this.isSubmitting = true;
    try {
      const userRef = doc(this.firestore, 'users', uid);
      await setDoc(
        userRef,
        {
          userId: uid,
          email: this.auth.currentUser?.email ?? '',
          firstName,
          lastName,
          username,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await this.router.navigateByUrl('/tabs', { replaceUrl: true });
    } catch (error) {
      console.error('[CompleteProfilePage] Failed to save profile:', error);
      this.errorMessage = 'Failed to save profile. Please try again.';
    } finally {
      this.isSubmitting = false;
    }
  }

  private async loadExistingUserProfile(): Promise<void> {
    const uid = await this.resolveCurrentUid();
    if (!uid) {
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }

    try {
      const userRef = doc(this.firestore, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        return;
      }

      const data = userSnap.data();
      this.firstName = typeof data?.['firstName'] === 'string' ? data['firstName'] : '';
      this.lastName = typeof data?.['lastName'] === 'string' ? data['lastName'] : '';
      this.username = typeof data?.['username'] === 'string' ? data['username'] : '';
    } catch (error) {
      console.error('[CompleteProfilePage] Failed to load existing profile fields:', error);
    }
  }

  private async resolveCurrentUid(): Promise<string | null> {
    if (this.auth.currentUser?.uid) {
      return this.auth.currentUser.uid;
    }

    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(this.auth, (user) => {
        unsubscribe();
        resolve(user?.uid ?? null);
      });
    });
  }
}
