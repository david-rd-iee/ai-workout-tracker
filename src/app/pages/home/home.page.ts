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

import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { Firestore, doc, docData, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { authState } from 'rxfire/auth';
import { switchMap, of } from 'rxjs';
import { Subscription } from 'rxjs';

import type { AppUser } from '../../models/user.model';

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
  private router = inject(Router);
  private auth = inject(Auth);
  private firestore = inject(Firestore);

  private userSub?: Subscription;

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

ngOnInit(): void {
  this.userSub?.unsubscribe();

  this.userSub = authState(this.auth).pipe(
    switchMap((fbUser) => {
      if (!fbUser) {
        this.currentUser = null;
        this.isLoadingUser = false;
        return of(null);
      }

      const userRef = doc(this.firestore, 'users', fbUser.uid);
      return docData(userRef, { idField: 'userId' });
    })
  ).subscribe({
    next: (u) => {
      this.currentUser = (u as any) ?? null;
      this.isLoadingUser = false;
    },
    error: (err) => {
      console.error(err);
      this.currentUser = null;
      this.isLoadingUser = false;
    },
  });
}


  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  private subscribeToUser(uid: string): void {
    const userRef = doc(this.firestore, 'users', uid);
    this.isLoadingUser = true;

    this.userSub = docData(userRef, { idField: 'userId' }).subscribe({
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
  }

  private async ensureUserDocExists(fbUser: User): Promise<void> {
    const userRef = doc(this.firestore, 'users', fbUser.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      // Minimal doc: sourced from Auth only; no fake names.
      await setDoc(
        userRef,
        {
          email: fbUser.email ?? '',
          created_at: serverTimestamp(),
          groupID: [],
          // leave these unset/empty until onboarding/profile edit:
          firstName: '',
          lastName: '',
          username: '',
          role: 'client',
          profilepic: '',
        },
        { merge: true },
      );
    }
  }

  get greetingName(): string {
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
    const raw = (this.currentUser?.profilepic || '').trim();
    return raw.length > 0 ? raw : null;
  }

  onProfileClick(): void {
    this.router.navigate(['profile-user']);
  }

  navigateTo(path: string): void {
    this.router.navigate([path]);
  }
}
