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
  trophyOutline, constructOutline } from 'ionicons/icons';
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

  isLoadingUser = true;
  currentUser: AppUser | null = null;

  constructor() {
    addIcons({constructOutline,personCircleOutline,trophyOutline,fitnessOutline,peopleOutline,chatbubblesOutline,});
  }

  async ngOnInit(): Promise<void> {
    // Keep the component test-friendly: if Firebase isn't wired up, just show a fallback.
    if (!this.auth || !this.firestore || !this.devSeed) {
      this.currentUser = {
        userId: 'DEV_OFFLINE',
        name: 'Dev Test User',
        email: 'dev-tester@example.com',
        isPT: false,
        ptUID: '',
        groups: [],
      };
      this.isLoadingUser = false;
      return;
    }

    // Ensure a dummy dev user exists in Firebase Auth + Firestore, then load the current user.
    try {
      await this.devSeed.ensureDevUserAndSeed();
    } catch (e) {
      console.warn('[HomePage] Dev seeding failed (continuing):', e);
    }

    this.auth.onAuthStateChanged((fbUser) => {
      if (!fbUser) {
        this.currentUser = null;
        this.isLoadingUser = false;
        return;
      }

      const userRef = doc(this.firestore!, 'users', fbUser.uid);
      this.userSub?.unsubscribe();
      this.userSub = docData(userRef).subscribe({
        next: (u) => {
          this.currentUser = (u as AppUser) ?? null;
          this.isLoadingUser = false;
        },
        error: (err) => {
          console.error('[HomePage] Failed to load current user:', err);
          this.currentUser = null;
          this.isLoadingUser = false;
        },
      });
    });
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  get greetingName(): string {
    return this.currentUser?.name || 'there';
  }

  get avatarInitial(): string {
    const name = (this.currentUser?.name || '').trim();
    return name ? name[0].toUpperCase() : '?';
  }

  onProfileClick(): void {
    this.router?.navigate(['profile-user']);
  }



  navigateTo(path: string): void {
    this.router?.navigate([path]);
  }
}
