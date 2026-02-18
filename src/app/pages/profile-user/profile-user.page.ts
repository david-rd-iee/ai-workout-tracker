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
  AlertController,
} from '@ionic/angular/standalone';
import { NavController } from '@ionic/angular';

import { Auth } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp } from '@angular/fire/firestore';
import { Storage, ref, deleteObject } from '@angular/fire/storage';
import { effect } from '@angular/core';

import { UserService } from '../../services/account/user.service';
import { FileUploadService } from '../../services/file-upload.service';
import { ImagePickerService } from '../../services/image-picker.service';
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
import { AccountService } from '../../services/account/account.service';

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
  private alertCtrl = inject(AlertController);
  private storage = inject(Storage);
  private userService = inject(UserService);
  private fileUploadService = inject(FileUploadService);
  private imagePickerService = inject(ImagePickerService);
  private accountService = inject(AccountService);

  isLoading = true;
  currentUser: (trainerProfile | clientProfile) | null = null;
  readonly defaultProfileImage = 'assets/user_icons/profilePhoto.svg';

  profilepicUrl: string = this.defaultProfileImage;
  private usersDocFirstName = '';
  private usersDocLastName = '';
  private usersDocUsername = '';
  private hasEnteredView = false;
  private roleLoadInFlight = false;
  private pendingIdentityUid: string | null = null;
  private loadedIdentityUid: string | null = null;
  private pendingRoleLoadKey: string | null = null;
  private loadedRoleLoadKey: string | null = null;

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
      const uid = this.auth.currentUser?.uid;
      
      if (userInfo) {
        this.currentUser = userInfo;
        
        const pic = this.normalizeProfileImage(
          (this.currentUser as any)?.profilepic || ''
        );
        this.profilepicUrl = pic ?? this.defaultProfileImage;
        
        this.isLoading = false;
        
        // Stage profile loads; run after route transition enters.
        if (uid) {
          if (this.loadedIdentityUid !== uid) {
            this.pendingIdentityUid = uid;
          }
          const roleLoadKey = `${uid}:${this.currentUser.accountType}`;
          if (this.loadedRoleLoadKey !== roleLoadKey) {
            this.pendingRoleLoadKey = roleLoadKey;
          }
          if (this.hasEnteredView) {
            void this.runDeferredLoads();
          }
        }
      } else {
        this.currentUser = null;
        this.profilepicUrl = this.defaultProfileImage;
        this.pendingIdentityUid = null;
        this.loadedIdentityUid = null;
        this.pendingRoleLoadKey = null;
        this.loadedRoleLoadKey = null;
        this.isLoading = false;
      }
    });
  }

  ngOnInit(): void {
    // Effect is now in constructor
  }

  ionViewDidEnter(): void {
    this.hasEnteredView = true;
    void this.runDeferredLoads();
  }

  ionViewDidLeave(): void {
    this.hasEnteredView = false;
  }

  ngOnDestroy(): void {
    this.hasEnteredView = false;
    this.roleLoadInFlight = false;
  }

  private async runDeferredLoads(): Promise<void> {
    if (!this.hasEnteredView || this.roleLoadInFlight) {
      return;
    }

    this.roleLoadInFlight = true;
    try {
      const uid = this.auth.currentUser?.uid ?? null;
      if (!uid || !this.currentUser) {
        return;
      }

      if (this.pendingIdentityUid === uid && this.loadedIdentityUid !== uid) {
        await Promise.all([
          this.loadIdentityFromUsersDoc(uid),
          this.loadProfileImageFromUserDoc(uid),
        ]);
        this.loadedIdentityUid = uid;
        this.pendingIdentityUid = null;
      }

      const roleLoadKey = `${uid}:${this.currentUser.accountType}`;
      if (this.pendingRoleLoadKey === roleLoadKey && this.loadedRoleLoadKey !== roleLoadKey) {
        if (this.currentUser.accountType === 'trainer') {
          await this.loadTrainerStats(uid);
          await this.loadTrainerStatues(uid);
        } else {
          await this.loadGreekStatuesFromFirestore(uid);
        }

        this.loadedRoleLoadKey = roleLoadKey;
        this.pendingRoleLoadKey = null;
      }
    } finally {
      this.roleLoadInFlight = false;
      if (this.hasEnteredView && (this.pendingIdentityUid || this.pendingRoleLoadKey)) {
        void this.runDeferredLoads();
      }
    }
  }

  get displayName(): string {
    const first = (this.currentUser?.firstName || '').trim();
    const last = (this.currentUser?.lastName || '').trim();
    const fallbackFirst = this.usersDocFirstName.trim();
    const fallbackLast = this.usersDocLastName.trim();
    const full = `${first || fallbackFirst} ${last || fallbackLast}`.trim();
    return full || 'User';
  }

  get displayUsername(): string {
    const fromProfile = ((this.currentUser as any)?.username || '').trim();
    const fromUsersDoc = this.usersDocUsername.trim();
    return fromProfile || fromUsersDoc || '';
  }

  onSettingsClick(): void {
    // this.router.navigate(['settings']);
  }

  async onProfileImageClick(): Promise<void> {
    let shouldChangeImage = false;
    const alert = await this.alertCtrl.create({
      header: 'Profile Picture',
      message: 'Would you like to change your profile picture?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Change Image',
          handler: () => {
            shouldChangeImage = true;
          },
        },
      ],
    });
    await alert.present();

    await alert.onDidDismiss();
    if (shouldChangeImage) {
      await this.changeProfileImage();
    }
  }

  goToGroups(): void {
    this.navCtrl.navigateForward('/groups', {
      animated: true,
      animationDirection: 'forward',
    });
  }
  goToLogWorkout(): void { this.router.navigate(['/tabs/chats/workout-chatbot']); }
  goToFindPT(): void {}
  goToStatues(): void {}
  goToRegional(): void { this.router.navigateByUrl('/regional-leaderboard'); }
  goToAnalyzeWorkout(): void {}

  // Statue management methods

  onSlideChange(event: any): void {
    this.currentSlideIndex = event.detail[0].activeIndex;
  }

  private async loadTrainerStats(trainerId: string): Promise<void> {
    try {
      // Get all bookings for this trainer
      const bookingsRef = collection(this.firestore, 'bookings');
      const trainerBookingsQuery = query(
        bookingsRef,
        where('trainerId', '==', trainerId)
      );
      const bookingsSnap = await getDocs(trainerBookingsQuery);
      
      const completedSessions = bookingsSnap.docs.filter(doc => 
        doc.data()['status'] === 'completed'
      );
      this.trainerStats.totalSessions = completedSessions.length;

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
      } else {
        this.trainerStats.totalClients = 0;
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

  private normalizeProfileImage(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async loadProfileImageFromUserDoc(uid: string): Promise<void> {
    try {
      const userRef = doc(this.firestore, 'users', uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        this.profilepicUrl = this.defaultProfileImage;
        return;
      }

      const userData = userSnap.data();
      const userDocPic = this.normalizeProfileImage(
        userData?.['profilepic'] || ''
      );
      this.profilepicUrl = userDocPic ?? this.defaultProfileImage;
    } catch (error) {
      console.error('[ProfileUserPage] Error loading users doc profile image:', error);
      this.profilepicUrl = this.defaultProfileImage;
    }
  }

  private async loadIdentityFromUsersDoc(uid: string): Promise<void> {
    try {
      const userRef = doc(this.firestore, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        return;
      }

      const userData = userSnap.data();
      this.usersDocFirstName = typeof userData?.['firstName'] === 'string' ? userData['firstName'] : '';
      this.usersDocLastName = typeof userData?.['lastName'] === 'string' ? userData['lastName'] : '';
      this.usersDocUsername = typeof userData?.['username'] === 'string' ? userData['username'] : '';
    } catch (error) {
      console.error('[ProfileUserPage] Error loading users doc identity:', error);
    }
  }

  private async changeProfileImage(): Promise<void> {
    const accountUid = this.accountService.getCredentials()().uid || null;
    const authUid = this.auth.currentUser?.uid ?? null;
    const uid = accountUid || authUid;

    if (!uid) {
      await this.showToast('You must be signed in to change your profile picture.');
      return;
    }

    const file = await this.imagePickerService.pickImageFile();
    if (!file) {
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Updating profile picture...',
    });
    await loading.present();

    try {
      const oldUrl = this.normalizeProfileImage(this.profilepicUrl);
      const sanitizedName = file.name.replace(/\s+/g, '_');
      const storagePath = `profile-pictures/${uid}/${Date.now()}_${sanitizedName}`;
      const downloadUrl = await this.fileUploadService.uploadFile(storagePath, file);

      const userRef = doc(this.firestore, 'users', uid);
      await setDoc(
        userRef,
        {
          profilepic: downloadUrl,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      if (oldUrl && oldUrl !== this.defaultProfileImage && oldUrl !== downloadUrl) {
        await this.deleteExistingProfileImage(oldUrl);
      }

      this.profilepicUrl = downloadUrl;
      if (this.currentUser) {
        (this.currentUser as any).profilepic = downloadUrl;
      }
      await this.showToast('Profile picture updated.');
    } catch (error) {
      console.error('[ProfileUserPage] Failed to update profile picture:', error);
      const message = error instanceof Error ? error.message : 'Please try again.';
      await this.showToast(`Failed to update profile picture: ${message}`);
    } finally {
      await loading.dismiss();
    }
  }

  private async deleteExistingProfileImage(url: string): Promise<void> {
    const storagePath = this.extractStoragePathFromDownloadUrl(url);
    if (!storagePath) {
      return;
    }

    try {
      const imageRef = ref(this.storage, storagePath);
      await deleteObject(imageRef);
    } catch (error) {
      // Non-blocking: continue with new upload even if old file delete fails.
      console.warn('[ProfileUserPage] Failed to delete old profile image:', error);
    }
  }

  private extractStoragePathFromDownloadUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const marker = '/o/';
      const idx = parsed.pathname.indexOf(marker);
      if (idx === -1) {
        return null;
      }

      const encodedPath = parsed.pathname.substring(idx + marker.length);
      return decodeURIComponent(encodedPath);
    } catch {
      return null;
    }
  }
}
