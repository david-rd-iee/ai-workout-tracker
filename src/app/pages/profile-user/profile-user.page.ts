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

import { Auth, onAuthStateChanged } from '@angular/fire/auth';
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
  private router = inject(Router);
  private auth = inject(Auth);
  private firestore = inject(Firestore);

  private userSub?: Subscription;

  isLoading = true;
  currentUser: AppUser | null = null;

  profileImageUrl: string | null = null;
  username: string | null = null;

  ngOnInit(): void {
    onAuthStateChanged(this.auth, (fbUser) => {
      this.userSub?.unsubscribe();

      if (!fbUser) {
        this.currentUser = null;
        this.username = null;
        this.profileImageUrl = null;
        this.isLoading = false;

        // Optional: route to login
        // this.router.navigate(['login']);
        return;
      }

      this.subscribeToUser(fbUser.uid);
    });
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  private subscribeToUser(uid: string): void {
    const userRef = doc(this.firestore, 'users', uid);

    this.isLoading = true;
    this.userSub = docData(userRef, { idField: 'userId' }).subscribe({
      next: (u) => {
        this.currentUser = (u as AppUser) ?? null;

        this.username = (this.currentUser?.username || '').trim() || null;

        const pic = (this.currentUser?.profilepic || '').trim();
        this.profileImageUrl = pic.length > 0 ? pic : null;

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

  get displayName(): string {
    const first = (this.currentUser?.firstName || '').trim();
    const last = (this.currentUser?.lastName || '').trim();
    const full = `${first} ${last}`.trim();
    return full || 'User';
  }

  onSettingsClick(): void {
    console.log('Settings clicked');
    // this.router.navigate(['settings']);
  }

  goToGroups(): void { console.log('Groups clicked'); }
  goToLogWorkout(): void { console.log('Log Workout clicked'); }
  goToFindPT(): void { console.log('Find PT clicked'); }
  goToStatues(): void { console.log('Statues clicked'); }
  goToRegional(): void { this.router.navigateByUrl('/regional-leaderboard'); }
  goToAnalyzeWorkout(): void { console.log('Analyze Workout clicked'); }
}
