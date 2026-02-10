import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonAvatar,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonIcon,
  IonSpinner,
} from '@ionic/angular/standalone';

import { addIcons } from 'ionicons';
import {
  chatbubblesOutline,
  fitnessOutline,
  peopleOutline,
  personCircleOutline,
  trophyOutline,
  constructOutline,
} from 'ionicons/icons';

import { Auth } from '@angular/fire/auth';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';

import type { AppUser } from '../../models/user.model';
import { DevSeedService } from '../../services/dev-seed.service';

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonAvatar,
    IonButton,
    IonSpinner,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonIcon,
  ],
})
export class HomePage implements OnInit, OnDestroy {
  private router = inject(Router, { optional: true });
  private auth = inject(Auth, { optional: true });
  private firestore = inject(Firestore, { optional: true });
  private devSeed = inject(DevSeedService, { optional: true });

  private userSub?: Subscription;

  // 👇 Your dev UID (Firestore doc ID)
  private readonly DEV_UID = 'Zas8MzSObSfvv3SRMINzWMiQFg63';

  isLoadingUser = true;
  currentUser: AppUser | null = null;

  constructor() {
    addIcons({
      constructOutline,
      personCircleOutline,
      trophyOutline,
      fitnessOutline,
      peopleOutline,
      chatbubblesOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    // Keep the component test-friendly: if Firebase isn't wired up, just show a fallback.
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
      this.isLoadingUser = false;
      return;
    }

    // Run seeding (safe even if it no-ops) so your dev Firestore docs exist.
    try {
      await this.devSeed?.ensureDevUserAndSeed();
    } catch (e) {
      console.warn('[HomePage] Dev seeding failed (continuing):', e);
    }

    // If Auth exists, prefer the authed user; otherwise fall back to DEV_UID.
    if (this.auth) {
      this.auth.onAuthStateChanged((fbUser) => {
        const uidToLoad = fbUser?.uid ?? this.DEV_UID;
        this.subscribeToUser(uidToLoad);
      });
    } else {
      // No Auth wired up -> just load dev doc directly.
      this.subscribeToUser(this.DEV_UID);
    }
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  private subscribeToUser(uid: string): void {
    const userRef = doc(this.firestore!, 'users', uid);

    this.isLoadingUser = true;
    this.userSub?.unsubscribe();

    this.userSub = docData(userRef).subscribe({
      next: (u) => {
        // u does NOT include doc id (uid) — that's the Firestore document ID now.
        this.currentUser = (u as AppUser) ?? null;
        this.isLoadingUser = false;
      },
      error: (err) => {
        console.error('[HomePage] Failed to load current user:', err);
        this.currentUser = null;
        this.isLoadingUser = false;
      },
    });
  }

  get greetingName(): string {
    // Prefer firstName, then username, then fallback
    const first = (this.currentUser?.firstName || '').trim();
    const user = (this.currentUser?.username || '').trim();
    return first || user || 'there';
  }

  get avatarInitial(): string {
    const first = (this.currentUser?.firstName || '').trim();
    const user = (this.currentUser?.username || '').trim();
    const source = first || user;
    return source ? source[0].toUpperCase() : '?';
  }

  get profileImageUrl(): string | null {
    // Read from your Firestore user object.
    const raw =
      (this.currentUser as any)?.profilepic ??
      (this.currentUser as any)?.profilePic ??
      null;

    return typeof raw === 'string' && raw.trim().length > 0
      ? raw.trim()
      : null;
  }


  onProfileClick(): void {
    this.router?.navigate(['profile-user']);
  }

  navigateTo(path: string): void {
    this.router?.navigate([path]);
  }
}
