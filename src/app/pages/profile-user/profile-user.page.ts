import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonBackButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonProgressBar,
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
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonProgressBar,
  ],
})
export class ProfileUserPage implements OnInit {
  private router = inject(Router, { optional: true });
  private auth = inject(Auth, { optional: true });
  private firestore = inject(Firestore, { optional: true });

  private userSub?: Subscription;

  isLoading = true;
  currentUser: AppUser | null = null;

  // TEMP placeholders (replace with UserStats later)
  streakDays = 0;
  level = 1;
  levelProgress = 0.25; // 0..1
  totalWorkScore = 0;

  ngOnInit(): void {
    // If Firebase not wired (or tests), show a friendly placeholder
    if (!this.auth || !this.firestore) {
      this.currentUser = {
        userId: 'DEV_OFFLINE',
        name: 'Dev Test User',
        email: 'dev-tester@example.com',
        isPT: false,
        ptUID: '',
        groups: [],
      };
      this.streakDays = 3;
      this.level = 2;
      this.levelProgress = 0.4;
      this.totalWorkScore = 1200;
      this.isLoading = false;
      return;
    }

    this.auth.onAuthStateChanged((fbUser) => {
      if (!fbUser) {
        this.currentUser = null;
        this.isLoading = false;
        return;
      }

      const userRef = doc(this.firestore!, 'users', fbUser.uid);
      this.userSub?.unsubscribe();
      this.userSub = docData(userRef).subscribe({
        next: (u) => {
          this.currentUser = (u as AppUser) ?? null;

          // TODO: Replace with real stats document (ex: userStats/{uid})
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

  get displayName(): string {
    return this.currentUser?.name || 'Your Profile';
  }

  goHome(): void {
    this.router?.navigate(['']);
  }
}
