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
  // Keep these optional so the page doesn't crash in tests/dev if Firebase isn't wired
  router = inject(Router, { optional: true });
  private auth = inject(Auth, { optional: true });
  private firestore = inject(Firestore, { optional: true });

  private userSub?: Subscription;

  // UI state
  isLoading = true;

  // User data (from Firestore users/{uid})
  currentUser: AppUser | null = null;

  // Temp fields used by the page UI
  profileImageUrl: string | null = null;
  username: string | null = null;

  ngOnInit(): void {
    // Dev fallback: no Firebase -> show placeholder user
    if (!this.auth || !this.firestore) {
      this.currentUser = {
        userId: 'DEV_OFFLINE',
        name: 'First Last',
        email: 'dev-tester@example.com',
        isPT: false,
        ptUID: '',
        groups: [],
      };

      this.username = 'username';
      this.profileImageUrl = null;
      this.isLoading = false;
      return;
    }

    // Firebase path: load user doc
    this.auth.onAuthStateChanged((fbUser) => {
      if (!fbUser) {
        this.currentUser = null;
        this.username = null;
        this.profileImageUrl = null;
        this.isLoading = false;
        return;
      }

      const userRef = doc(this.firestore!, 'users', fbUser.uid);
      this.userSub?.unsubscribe();

      this.userSub = docData(userRef).subscribe({
        next: (u) => {
          this.currentUser = (u as AppUser) ?? null;

          // TEMP mapping (adjust once your schema is finalized)
          // If your AppUser already has username/photoUrl, map them here.
          // Otherwise these are placeholders.
          this.username = (this.currentUser as any)?.username ?? this.username ?? 'username';
          this.profileImageUrl = (this.currentUser as any)?.photoUrl ?? null;

          this.isLoading = false;
        },
        error: (err) => {
          console.error('[ProfileUserPage] Failed to load user:', err);
          this.currentUser = null;
          this.isLoading = false;
        },
      });
    });
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  // Display helpers
  get displayName(): string {
    return this.currentUser?.name || 'First Last';
  }

  // Top-right gear
  onSettingsClick(): void {
    // TODO: route to a settings page when you create it
    console.log('Settings clicked');
    // Example later:
    // this.router?.navigate(['settings']);
  }

  // Stacked actions (wire these routes when the pages exist)
  goToGroups(): void {
    console.log('Groups clicked');
    // this.router?.navigate(['groups']);
  }

  goToLogWorkout(): void {
    console.log('Log Workout clicked');
    // this.router?.navigate(['log-workout']);
  }

  goToFindPT(): void {
    console.log('Find PT clicked');
    // this.router?.navigate(['find-pt']);
  }

  goToStatues(): void {
    console.log('Statues clicked');
    // this.router?.navigate(['statues']);
  }

  goToRegional(): void {
    console.log('Regional clicked');
    // this.router?.navigate(['regional']);
  }

  goToAnalyzeWorkout(): void {
    console.log('Analyze Workout clicked');
    // this.router?.navigate(['analyze-workout']);
  }
}
