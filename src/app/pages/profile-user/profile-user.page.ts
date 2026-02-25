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
import { NavController } from '@ionic/angular';

import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, collection, query, where, getDocs } from '@angular/fire/firestore';
import { effect } from '@angular/core';

import { UserService } from '../../services/account/user.service';
import type { trainerProfile } from '../../Interfaces/Profiles/Trainer';
import type { clientProfile } from '../../Interfaces/Profiles/client';
import { addIcons } from 'ionicons';
import {
  settingsOutline,
  createOutline,
  fitness,
  statsChart,
  trophy,
  star,
  peopleOutline,
  searchOutline,
  trophyOutline,
  mapOutline,
  analyticsOutline,
  people,
  school,
  cash,
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
  private navCtrl = inject(NavController);
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private modalCtrl = inject(ModalController);
  private loadingCtrl = inject(LoadingController);
  private toastCtrl = inject(ToastController);
  private userService = inject(UserService);

  isLoading = true;
  currentUser: (trainerProfile | clientProfile) | null = null;

  profileImageUrl: string | null = null;

  // Greek Statue properties
  allStatues: GreekStatue[] = [];
  displayStatues: GreekStatue[] = [];
  displayStatueIds: string[] = [];
  currentSlideIndex: number = 0;

  // Trainer Stats properties
  trainerStats = {
    totalClients: 0,
    totalSessions: 0,
    longestStandingClient: { name: '', durationDays: 0 },
    topPerformingClient: { name: '', improvement: '' },
    totalRevenue: 0
  };

  get carvedStatuesCount(): number {
    return this.allStatues.filter(s => s.currentLevel).length;
  }

  constructor() {
    addIcons({
      settingsOutline,
      createOutline,
      fitness,
      statsChart,
      trophy,
      star,
      peopleOutline,
      searchOutline,
      trophyOutline,
      mapOutline,
      analyticsOutline,
      people,
      school,
      cash,
    });

    // Use the UserService's signal to get user data
    effect(() => {
      const userInfo = this.userService.getUserInfo()();
      
      console.log('[ProfileUserPage] User info from service:', userInfo);
      console.log('[ProfileUserPage] Account type:', userInfo?.accountType);
      
      if (userInfo) {
        this.currentUser = userInfo;
        
        const pic = ((this.currentUser as any)?.profileImage || (this.currentUser as any)?.profilepic || '').trim();
        console.log('[ProfileUserPage] Profile image data:', {
          profileImage: (this.currentUser as any)?.profileImage,
          profilepic: (this.currentUser as any)?.profilepic,
          finalPic: pic,
          userData: userInfo
        });
        this.profileImageUrl = pic.length > 0 ? pic : null;
        
        this.isLoading = false;
        
        // Load role-specific data
        const uid = this.auth.currentUser?.uid;
        if (uid) {
          if (this.currentUser.accountType === 'trainer') {
            console.log('[ProfileUserPage] Loading trainer stats for:', uid);
            this.loadTrainerStats(uid);
            this.loadTrainerStatues(uid);
          } else {
            console.log('[ProfileUserPage] Loading client statues for:', uid);
            this.loadGreekStatuesFromFirestore(uid);
          }
        }
      } else {
        this.currentUser = null;
        this.profileImageUrl = null;
        this.isLoading = false;
      }
    });
  }

  ngOnInit(): void {
    // Effect is now in constructor
  }

  ngOnDestroy(): void {
    // No subscriptions to clean up
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

  goToGroups(): void {
    this.navCtrl.navigateForward('/groups', {
      animated: true,
      animationDirection: 'forward',
    });
  }
  goToLogWorkout(): void {
    this.navCtrl.navigateForward('/workout-chatbot', {
      animated: true,
      animationDirection: 'forward',
    });
  }
  goToFindPT(): void { console.log('Find PT clicked'); }
  goToStatues(): void { console.log('Statues clicked'); }
  goToRegional(): void { this.router.navigateByUrl('/regional-leaderboard'); }
  goToAnalyzeWorkout(): void { console.log('Analyze Workout clicked'); }

  // Statue management methods

  onSlideChange(event: any): void {
    this.currentSlideIndex = event.detail[0].activeIndex;
  }

  private async loadTrainerStats(trainerId: string): Promise<void> {
    try {
      console.log('[ProfileUserPage] Loading trainer stats for:', trainerId);

      // Get all bookings for this trainer
      const bookingsRef = collection(this.firestore, 'bookings');
      const trainerBookingsQuery = query(
        bookingsRef,
        where('trainerId', '==', trainerId)
      );
      const bookingsSnap = await getDocs(trainerBookingsQuery);
      
      console.log('[ProfileUserPage] Total bookings found:', bookingsSnap.size);
      
      const completedSessions = bookingsSnap.docs.filter(doc => 
        doc.data()['status'] === 'completed'
      );
      this.trainerStats.totalSessions = completedSessions.length;

      console.log('[ProfileUserPage] Completed sessions:', completedSessions.length);

      // Calculate total revenue
      this.trainerStats.totalRevenue = completedSessions.reduce((sum, doc) => {
        return sum + (doc.data()['price'] || 0);
      }, 0);

      // Get all clients for this trainer from trainerClients collection
      const trainerClientsRef = doc(this.firestore, 'trainerClients', trainerId);
      const trainerClientsSnap = await getDoc(trainerClientsRef);
      
      let clients: any[] = [];
      if (trainerClientsSnap.exists()) {
        const data = trainerClientsSnap.data();
        clients = data?.['clients'] || [];
        this.trainerStats.totalClients = clients.length;
        console.log('[ProfileUserPage] Found clients in trainerClients:', clients.length, clients);
      } else {
        this.trainerStats.totalClients = 0;
        console.log('[ProfileUserPage] No trainerClients document found');
      }

      // Find longest standing client
      let longestClient = { name: 'N/A', durationDays: 0 };
      const now = new Date();
      
      for (const client of clients) {
        const joinedDate = client.joinedDate ? new Date(client.joinedDate) : null;
        if (joinedDate) {
          const durationMs = now.getTime() - joinedDate.getTime();
          const durationDays = Math.floor(durationMs / (1000 * 60 * 60 * 24));
          
          if (durationDays > longestClient.durationDays) {
            const firstName = client.firstName || '';
            const lastName = client.lastName || '';
            longestClient = {
              name: `${firstName} ${lastName}`.trim() || 'Unknown Client',
              durationDays
            };
          }
        }
      }
      this.trainerStats.longestStandingClient = longestClient;

      // Find top performing client (most sessions completed)
      const clientSessionCounts: { [clientId: string]: { name: string, count: number } } = {};
      
      for (const booking of completedSessions) {
        const clientId = booking.data()['clientId'];
        const clientFirstName = booking.data()['clientFirstName'] || '';
        const clientLastName = booking.data()['clientLastName'] || '';
        const clientName = `${clientFirstName} ${clientLastName}`.trim() || 'Unknown Client';
        
        if (!clientSessionCounts[clientId]) {
          clientSessionCounts[clientId] = { name: clientName, count: 0 };
        }
        clientSessionCounts[clientId].count++;
      }

      let topClient = { name: 'N/A', improvement: '0 sessions' };
      let maxSessions = 0;
      
      for (const clientId in clientSessionCounts) {
        if (clientSessionCounts[clientId].count > maxSessions) {
          maxSessions = clientSessionCounts[clientId].count;
          topClient = {
            name: clientSessionCounts[clientId].name,
            improvement: `${maxSessions} sessions`
          };
        }
      }
      this.trainerStats.topPerformingClient = topClient;

      console.log('[ProfileUserPage] Trainer stats loaded:', this.trainerStats);
    } catch (error) {
      console.error('[ProfileUserPage] Error loading trainer stats:', error);
    }
  }

  private async loadTrainerStatues(trainerId: string): Promise<void> {
    try {
      const badgeRef = doc(this.firestore, 'userBadges', trainerId);
      const badgeSnap = await getDoc(badgeRef);

      // Calculate statue values from trainer stats
      const statueValues: { [key: string]: number } = {
        'zeus-mentor': this.trainerStats.totalClients,
        'athena-wisdom': this.trainerStats.totalSessions,
        'hermes-prosperity': this.trainerStats.totalRevenue
      };

      let displayStatueIds: string[] = [];
      let percentiles: { [key: string]: number } = {};

      if (badgeSnap.exists()) {
        const data = badgeSnap.data() as any;
        displayStatueIds = data.displayStatueIds || data.displayBadgeIds || [];
        percentiles = data.percentiles || {};
      } else {
        // Default display statues for trainers
        displayStatueIds = ['zeus-mentor', 'athena-wisdom', 'hermes-prosperity'];
      }

      this.displayStatueIds = displayStatueIds;

      // Filter to trainer-specific statues only
      const trainerStatueIds = ['zeus-mentor', 'athena-wisdom', 'hermes-prosperity'];
      this.allStatues = GREEK_STATUES
        .filter(statue => trainerStatueIds.includes(statue.id))
        .map(statue => {
          const currentValue = statueValues[statue.id] || 0;
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
      console.log('[ProfileUserPage] Loaded trainer statues:', this.allStatues);
    } catch (error) {
      console.error('[ProfileUserPage] Error loading trainer statues:', error);
      this.allStatues = [];
      this.displayStatueIds = [];
      this.displayStatues = [];
    }
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

      // Filter out trainer-specific statues for clients
      const trainerStatueIds = ['zeus-mentor', 'athena-wisdom', 'hermes-prosperity'];
      
      // Merge Firestore progress into GREEK_STATUES definition
      this.allStatues = GREEK_STATUES
        .filter(statue => !trainerStatueIds.includes(statue.id))
        .map(statue => {
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
    const uid = this.currentUser?.id || this.auth.currentUser?.uid;
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
