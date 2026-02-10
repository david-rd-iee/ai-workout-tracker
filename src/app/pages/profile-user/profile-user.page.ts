import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

import { Auth } from '@angular/fire/auth';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';

import type { AppUser } from '../../models/user.model';

@Component({
  selector: 'app-profile-user',
  standalone: true,
  templateUrl: './profile-user.page.html',
  styleUrls: ['./profile-user.page.scss'],
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonContent,
  ],
})
export class ProfileUserPage implements OnInit, OnDestroy {
  // Keep optional for tests/dev safety
  router = inject(Router, { optional: true });
  private auth = inject(Auth, { optional: true });
  private firestore = inject(Firestore, { optional: true });

  private userSub?: Subscription;

  // 👇 Dev fallback UID (Firestore document ID)
  private readonly DEV_UID = 'Zas8MzSObSfvv3SRMINzWMiQFg63';

  // UI state
  isLoading = true;

  // User data (from Firestore users/{uid})
  currentUser: AppUser | null = null;

  // Fields used by the HTML template
  profileImageUrl: string | null = null;
  username: string | null = null;

  ngOnInit(): void {
    // If Firestore isn't available, show placeholder and don't crash
    if (!this.firestore) {
      this.currentUser = {
        email: 'dev-tester@example.com',
        firstName: 'Dev',
        lastName: 'Tester',
        groupID: [],
        profilePic: '',
        role: 'user',
        username: 'devtester',
      };
      this.username = this.currentUser.username;
      this.profileImageUrl = null;
      this.isLoading = false;
      return;
    }

    // Prefer auth uid if available; otherwise fall back to DEV_UID
    if (this.auth) {
      this.auth.onAuthStateChanged((fbUser) => {
        const uidToLoad = fbUser?.uid ?? this.DEV_UID;
        this.subscribeToUser(uidToLoad);
      });
    } else {
      this.subscribeToUser(this.DEV_UID);
    }
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  private subscribeToUser(uid: string): void {
    const userRef = doc(this.firestore!, 'users', uid);

    this.isLoading = true;
    this.userSub?.unsubscribe();

    this.userSub = docData(userRef).subscribe({
      next: (u) => {
        // Firestore doc does NOT include the docId; docId == uid now
        this.currentUser = (u as AppUser) ?? null;

        // Username
        this.username = (this.currentUser as any)?.username ?? null;

        // Profile image:
        // You said the URL is stored under "profilepic" (lowercase).
        // Also allow "profilePic" (camelCase) in case some docs use that.
        const raw =
          (this.currentUser as any)?.profilepic ??
          (this.currentUser as any)?.profilePic ??
          null;

        this.profileImageUrl = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;

        this.isLoading = false;
      },
      error: (err) => {
        console.error('[ProfileUserPage] Failed to load user:', err);
        this.currentUser = null;
        this.username = null;
        this.profileImageUrl = null;
        this.isLoading = false;
      },
    });
  }

  // Display helpers used in HTML
  get displayName(): string {
    const first = (this.currentUser?.firstName || '').trim();
    const last = (this.currentUser?.lastName || '').trim();

    const full = `${first} ${last}`.trim();
    return full || 'User';
  }

  // Top-right gear
  onSettingsClick(): void {
    console.log('Settings clicked');
    // this.router?.navigate(['settings']);
  }

  // Actions (wire routes when ready)
  goToGroups(): void {
    console.log('Groups clicked');
  }
  goToLogWorkout(): void {
    console.log('Log Workout clicked');
  }
  goToFindPT(): void {
    console.log('Find PT clicked');
  }
  goToStatues(): void {
    console.log('Statues clicked');
  }
  goToRegional(): void {
    console.log('Regional clicked');
  }
  goToAnalyzeWorkout(): void {
    console.log('Analyze Workout clicked');
  }
}

