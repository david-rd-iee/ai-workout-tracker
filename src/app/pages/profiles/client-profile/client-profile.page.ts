import { Component, OnInit, Signal, computed, effect, signal } from '@angular/core';
import { DEFAULT_ASSETS } from '../../../../assets/exports/assets.constants';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import {
  IonContent,
  IonGrid,
  IonRow,
  IonCol,
  IonButton,
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
  LoadingController,
  ToastController,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  ModalController
} from '@ionic/angular/standalone';
import { UserService } from '../../../services/account/user.service';
import { clientProfile } from '../../../Interfaces/Profiles/client';
import { AccountService } from 'src/app/services/account/account.service';
import { ImageUploaderComponent } from 'src/app/components/image-uploader/image-uploader.component';
import { HeaderComponent } from '../../../components/header/header.component';
import { addIcons } from 'ionicons';
import {
  settingsOutline,
  addCircleOutline,
  trophy,
  chevronDown,
  chevronUp,
  medal,
  createOutline
} from 'ionicons/icons';
import {
  AchievementBadge,
  ACHIEVEMENT_BADGES,
  calculateBadgeLevel
} from '../../../interfaces/Badge';
import { BadgeSelectorComponent } from '../../../components/badge-selector/badge-selector.component';
import { AchievementBadgeComponent } from '../../../components/achievement-badge/achievement-badge.component';

// Firestore + AppUser import
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { AppUser } from 'src/app/models/user.model';
import { UserBadgesDoc } from 'src/app/models/user-badges.model';

@Component({
  selector: 'app-client-profile',
  templateUrl: './client-profile.page.html',
  styleUrls: ['./client-profile.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    HeaderComponent,
    IonContent,
    ImageUploaderComponent,
    IonGrid,
    IonRow,
    IonCol,
    IonButton,
    IonList,
    IonItem,
    IonLabel,
    IonIcon,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    AchievementBadgeComponent,
  ]
})
export class ClientProfilePage implements OnInit {
  clientProfile: clientProfile | null = null;
  selectedFile: File | null = null;
  hasChanges: boolean = false;
  originalProfileImage: string = '';

  // Store the logged-in AppUser from /users collection
  appUser: AppUser | null = null;

  // Bound to the template for basic profile info
  clientInfo = {
    profileImage: '',
    firstName: '',
    lastName: ''
  };

  // Achievement Badge properties
  allBadges: AchievementBadge[] = [];
  displayBadges: AchievementBadge[] = [];
  displayBadgeIds: string[] = [];
  showAllAchievements: boolean = false;
  initialAchievementsCount: number = 3; // Show first 3 fully, 4th faded

  // Profile viewing properties
  profileUserId: string | null = null; // The ID of the profile being viewed
  isOwnProfile: boolean = true;        // Whether viewing your own profile

  get earnedBadgesCount(): number {
    return this.allBadges.filter(b => b.currentLevel).length;
  }

  get visibleAchievements(): AchievementBadge[] {
    return this.showAllAchievements
      ? this.allBadges
      : this.allBadges.slice(0, this.initialAchievementsCount + 1);
  }

  toggleShowAllAchievements(): void {
    this.showAllAchievements = !this.showAllAchievements;
  }

  isAuthReady = this.accountService.isAuthReady();
  userId = computed(() => this.accountService.getCredentials()().uid);
  isLoading = signal(true);

  constructor(
    private userService: UserService,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private accountService: AccountService,
    private modalCtrl: ModalController,
    private route: ActivatedRoute,
    private firestore: Firestore,
  ) {
    addIcons({
      settingsOutline,
      addCircleOutline,
      trophy,
      chevronDown,
      chevronUp,
      medal,
      createOutline
    });

    effect(() => {
      if (this.isAuthReady()) {
        this.loadClientProfile();
      }
    });
  }

  ngOnInit() {
    this.route.params.subscribe(params => {
      this.profileUserId = params['userId'] || null;
      this.isOwnProfile = !this.profileUserId || this.profileUserId === this.userId();
    });

    // Badges now come from Firestore, not hard-coded mocks
  }

  async loadClientProfile() {
    const currentUid = this.userId();
    if (!currentUid) {
      console.error('No auth user ID available');
      this.useFallbackClientInfo();
      this.isLoading.set(false);
      return;
    }

    // If you ever support viewing others' profiles, use that ID.
    const targetUserId = this.profileUserId || currentUid;

    const loading = await this.loadingCtrl.create({
      message: 'Loading profile...'
    });
    await loading.present();

    try {
      // Read from /users/{uid} using AppUser model
      const userRef = doc(this.firestore, 'users', targetUserId);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        console.warn('No /users doc found for user, using fallback');
        this.useFallbackClientInfo();
      } else {
        const data = userSnap.data() as AppUser;
        this.appUser = {
          ...data,
          userId: data.userId || targetUserId,
        };

        // Map AppUser.name into first/last name for the UI
        const fullName = this.appUser.name || 'Client';
        const [firstName, ...restName] = fullName.split(' ');
        const lastName = restName.join(' ');

        this.clientInfo = {
          profileImage: DEFAULT_ASSETS.PROFILE_PHOTO,
          firstName: firstName || 'Client',
          lastName: lastName || ''
        };

        this.originalProfileImage = this.clientInfo.profileImage;

        console.log('[ClientProfilePage] Loaded AppUser:', this.appUser);
        console.log('[ClientProfilePage] clientInfo:', this.clientInfo);

        // Load achievement badges for this user from Firestore
        await this.loadAchievementBadgesFromFirestore(targetUserId);
      }

      // OPTIONAL: if you still want your old clientProfile (extra fields),
      // you can ALSO call your existing service here:
      // const clientData = await this.userService.getUserProfileDirectly(targetUserId, 'client');
      // this.clientProfile = clientData as clientProfile;
    } catch (error) {
      console.error('Error loading profile:', error);
      this.showToast('Failed to load profile');
      this.useFallbackClientInfo();
    } finally {
      loading.dismiss();
      this.isLoading.set(false);
    }
  }

  // Load badge values/percentiles/displayBadgeIds from /userBadges/{userId}
  private async loadAchievementBadgesFromFirestore(userId: string): Promise<void> {
    try {
      const badgeRef = doc(this.firestore, 'userBadges', userId);
      const badgeSnap = await getDoc(badgeRef);

      if (!badgeSnap.exists()) {
        console.warn('[ClientProfilePage] No userBadges doc found; using empty badge list.');
        this.allBadges = [];
        this.displayBadgeIds = [];
        this.displayBadges = [];
        return;
      }

      const data = badgeSnap.data() as UserBadgesDoc;
      const values = data.values || {};
      const percentiles = data.percentiles || {};
      this.displayBadgeIds = data.displayBadgeIds || [];

      // Merge Firestore progress into your static ACHIEVEMENT_BADGES definition
      this.allBadges = ACHIEVEMENT_BADGES.map(badge => {
        const currentValue = values[badge.id] ?? 0;
        const percentile = percentiles[badge.id];

        const level = calculateBadgeLevel(badge, currentValue || 0);
        return {
          ...badge,
          currentValue,
          percentile,
          currentLevel: level || undefined,
        };
      });

      this.updateDisplayBadges();
      console.log('[ClientProfilePage] Loaded badges from Firestore:', this.allBadges);
    } catch (err) {
      console.error('[ClientProfilePage] Error loading badges from Firestore:', err);
      this.allBadges = [];
      this.displayBadgeIds = [];
      this.displayBadges = [];
    }
  }

  // Helper for dev fallback values
  private useFallbackClientInfo() {
    this.clientInfo = {
      profileImage: DEFAULT_ASSETS.PROFILE_PHOTO,
      firstName: 'Dev',
      lastName: 'User'
    };
    this.originalProfileImage = this.clientInfo.profileImage;
  }

  async onImageSelected(file: File) {
    console.log('Image selected:', file.name);
    this.selectedFile = file;
    // Create preview
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.clientInfo.profileImage = e.target.result;
      this.hasChanges = true; // Set hasChanges to true when image is selected
      console.log('hasChanges set to true, new image preview created');
    };
    reader.readAsDataURL(file);
  }

  async saveChanges() {
    if (!this.clientProfile) {
      this.showToast('No profile data available');
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Saving changes...'
    });
    await loading.present();

    try {
      const updatedProfile: Partial<clientProfile> = {};

      // Temporarily disabled - updateClientProfile method doesn't exist
      // await this.userService.updateClientProfile(
      //   this.userId(),
      //   updatedProfile,
      //   this.selectedFile || undefined
      // );
      console.warn('Update profile temporarily disabled');

      this.originalProfileImage = this.clientInfo.profileImage;
      this.selectedFile = null;
      this.hasChanges = false;

      this.showToast('Profile updated successfully');
    } catch (error) {
      console.error('Error updating profile:', error);
      this.showToast('Failed to update profile');
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

  // Badge management methods

  updateDisplayBadges() {
    this.displayBadges = this.displayBadgeIds
      .map(id => this.allBadges.find(b => b.id === id))
      .filter(badge => badge !== undefined) as AchievementBadge[];
  }

  async openBadgeSelector() {
    const earnedBadges = this.allBadges.filter(b => b.currentLevel);

    const modal = await this.modalCtrl.create({
      component: BadgeSelectorComponent,
      componentProps: {
        earnedBadges: earnedBadges,
        selectedBadgeIds: this.displayBadgeIds
      }
    });

    await modal.present();

    const { data, role } = await modal.onWillDismiss();

    if (role === 'confirm' && data) {
      this.displayBadgeIds = data;
      this.updateDisplayBadges();
      await this.saveDisplayBadges();
    }
  }

  async saveDisplayBadges() {
    const uid = this.userId();
    if (!uid) {
      this.showToast('Not signed in');
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Saving display badges...'
    });
    await loading.present();

    try {
      const badgeRef = doc(this.firestore, 'userBadges', uid);
      await setDoc(
        badgeRef,
        { displayBadgeIds: this.displayBadgeIds },
        { merge: true }
      );

      this.showToast('Display badges updated successfully');
    } catch (error) {
      console.error('Error updating display badges:', error);
      this.showToast('Failed to update display badges');
    } finally {
      loading.dismiss();
    }
  }
}
