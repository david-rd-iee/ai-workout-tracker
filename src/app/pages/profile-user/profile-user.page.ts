import { Component, OnDestroy, OnInit, inject, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
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
  IonCard,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  ModalController,
  LoadingController,
  ToastController,
} from '@ionic/angular/standalone';

import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Firestore, doc, docData, getDoc, setDoc } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';

import type { AppUser } from '../../models/user.model';
import { addIcons } from 'ionicons';
import {
  settingsOutline,
  createOutline,
  fitness,
} from 'ionicons/icons';
import {
  GreekStatue,
  GREEK_STATUES,
  calculateStatueLevel
} from '../../interfaces/GreekStatue';
import { UserBadgesDoc } from '../../models/user-badges.model';
import { StatueSelectorComponent } from '../../components/statue-selector/statue-selector.component';
import { GreekStatueComponent } from '../../components/greek-statue/greek-statue.component';
import { HeaderComponent } from '../../components/header/header.component';

@Component({
  selector: 'app-profile-user',
  standalone: true,
  templateUrl: './profile-user.page.html',
  styleUrls: ['./profile-user.page.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    CommonModule,
    IonContent,
    IonCard,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    GreekStatueComponent,
    HeaderComponent,
  ],
})
export class ProfileUserPage implements OnInit, OnDestroy {
  private router = inject(Router);
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private modalCtrl = inject(ModalController);
  private loadingCtrl = inject(LoadingController);
  private toastCtrl = inject(ToastController);

  private userSub?: Subscription;

  isLoading = true;
  currentUser: AppUser | null = null;

  profileImageUrl: string | null = null;
  username: string | null = null;

  // Greek Statue properties
  allStatues: GreekStatue[] = [];
  displayStatues: GreekStatue[] = [];
  displayStatueIds: string[] = [];
  currentSlideIndex: number = 0;

  get carvedStatuesCount(): number {
    return this.allStatues.filter(s => s.currentLevel).length;
  }

  constructor() {
    addIcons({
      settingsOutline,
      createOutline,
      fitness,
    });
  }

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

        // Load statues after user is loaded
        if (this.currentUser?.userId && this.currentUser?.role !== 'trainer') {
          this.loadGreekStatuesFromFirestore(this.currentUser.userId);
        }
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
  goToLogWorkout(): void { this.router.navigate(['/tabs/chats/workout-chatbot']); }
  goToFindPT(): void { console.log('Find PT clicked'); }
  goToStatues(): void { console.log('Statues clicked'); }
  goToRegional(): void { this.router.navigateByUrl('/regional-leaderboard'); }
  goToAnalyzeWorkout(): void { console.log('Analyze Workout clicked'); }

  // Statue management methods

  onSlideChange(event: any): void {
    this.currentSlideIndex = event.detail[0].activeIndex;
  }

  private async loadGreekStatuesFromFirestore(userId: string): Promise<void> {
    try {
      const badgeRef = doc(this.firestore, 'userBadges', userId);
      const badgeSnap = await getDoc(badgeRef);

      if (!badgeSnap.exists()) {
        console.warn('[ProfileUserPage] No userBadges doc found; using empty statue list.');
        this.allStatues = [];
        this.displayStatueIds = [];
        this.displayStatues = [];
        return;
      }

      const data = badgeSnap.data() as UserBadgesDoc;
      const values = data.values || {};
      const percentiles = data.percentiles || {};
      // Support both old and new field names
      this.displayStatueIds = data.displayStatueIds || data.displayBadgeIds || [];

      // Merge Firestore progress into GREEK_STATUES definition
      this.allStatues = GREEK_STATUES.map(statue => {
        const currentValue = values[statue.id] ?? 0;
        const percentile = percentiles[statue.id];

        const level = calculateStatueLevel(statue, currentValue || 0);
        return {
          ...statue,
          currentValue,
          percentile,
          currentLevel: level || undefined,
        };
      });

      this.updateDisplayStatues();
      console.log('[ProfileUserPage] Loaded statues from Firestore:', this.allStatues);
    } catch (err) {
      console.error('[ProfileUserPage] Error loading statues from Firestore:', err);
      this.allStatues = [];
      this.displayStatueIds = [];
      this.displayStatues = [];
    }
  }

  updateDisplayStatues() {
    this.displayStatues = this.displayStatueIds
      .map(id => this.allStatues.find(s => s.id === id))
      .filter(statue => statue !== undefined) as GreekStatue[];
  }

  async openBadgeSelector() {
    const carvedStatues = this.allStatues.filter(s => s.currentLevel);

    const modal = await this.modalCtrl.create({
      component: StatueSelectorComponent,
      componentProps: {
        carvedStatues: carvedStatues,
        selectedStatueIds: this.displayStatueIds
      }
    });

    await modal.present();

    const { data, role } = await modal.onWillDismiss();

    if (role === 'confirm' && data) {
      this.displayStatueIds = data;
      this.updateDisplayStatues();
      await this.saveDisplayStatues();
    }
  }

  async saveDisplayStatues() {
    const uid = this.currentUser?.userId;
    if (!uid) {
      this.showToast('Not signed in');
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Saving display statues...'
    });
    await loading.present();

    try {
      const badgeRef = doc(this.firestore, 'userBadges', uid);
      await setDoc(
        badgeRef,
        { displayStatueIds: this.displayStatueIds },
        { merge: true }
      );

      this.showToast('Display statues updated successfully');
    } catch (error) {
      console.error('Error updating display statues:', error);
      this.showToast('Failed to update display statues');
    } finally {
      loading.dismiss();
    }
  }

  private async showToast(message: string) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'bottom'
    });
    await toast.present();
  }
}
