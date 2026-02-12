import { Component, OnInit, Signal, computed, effect, signal, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
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
  createOutline,
  fitness,
  peopleOutline,
  fitnessOutline,
  timeOutline
} from 'ionicons/icons';
import {
  GreekStatue,
  GREEK_STATUES,
  calculateStatueLevel
} from '../../../interfaces/GreekStatue';
import { StatueSelectorComponent } from '../../../components/statue-selector/statue-selector.component';
import { GreekStatueComponent } from '../../../components/greek-statue/greek-statue.component';

// Firestore + AppUser import
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { AppUser } from 'src/app/models/user.model';
import { UserBadgesDoc } from 'src/app/models/user-badges.model';

@Component({
  selector: 'app-client-profile',
  templateUrl: './client-profile.page.html',
  styleUrls: ['./client-profile.page.scss'],
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
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
    GreekStatueComponent,
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

  // Greek Statue properties
  allStatues: GreekStatue[] = [];
  displayStatues: GreekStatue[] = [];
  displayStatueIds: string[] = [];
  
  // Trainer-specific stats
  accountType = computed(() => {
    return this.userService.getUserInfo()()?.accountType || 'client';
  });
  trainerStats = {
    longestStandingClient: 'John Smith (2 years)',
    totalClients: 15,
    clientWorkoutsCompleted: 487,
    leaderboardPlace: 12
  };
  showAllAchievements: boolean = false;
  initialAchievementsCount: number = 3; // Show first 3 fully, 4th faded
  currentSlideIndex: number = 0; // Track active slide for pagination

  // Profile viewing properties
  profileUserId: string | null = null; // The ID of the profile being viewed
  isOwnProfile: boolean = true;        // Whether viewing your own profile

  get carvedStatuesCount(): number {
    return this.allStatues.filter(s => s.currentLevel).length;
  }

  get visibleAchievements(): GreekStatue[] {
    return this.showAllAchievements
      ? this.allStatues
      : this.allStatues.slice(0, this.initialAchievementsCount + 1);
  }

  toggleShowAllAchievements(): void {
    this.showAllAchievements = !this.showAllAchievements;
  }

  viewStatDetails(statType: string): void {
    console.log('View details for:', statType);
    // TODO: Navigate to detailed view or show modal with more information
    // Example: this.router.navigate(['/trainer-stats', statType]);
  }

  openSettings(): void {
    console.log('Open settings');
    // TODO: Navigate to settings page or open settings modal
    // Example: this.router.navigate(['/account']);
  }

  onSlideChange(event: any): void {
    this.currentSlideIndex = event.detail[0].activeIndex;
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
      createOutline,
      fitness,
      peopleOutline,
      fitnessOutline,
      timeOutline
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

        // Load Greek statues for this user from Firestore
        await this.loadGreekStatuesFromFirestore(targetUserId);
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

  // Load statue carving progress from /userBadges/{userId}
  private async loadGreekStatuesFromFirestore(userId: string): Promise<void> {
    try {
      const badgeRef = doc(this.firestore, 'userBadges', userId);
      const badgeSnap = await getDoc(badgeRef);

      if (!badgeSnap.exists()) {
        console.warn('[ClientProfilePage] No userBadges doc found; using empty statue list.');
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
      console.log('[ClientProfilePage] Loaded statues from Firestore:', this.allStatues);
    } catch (err) {
      console.error('[ClientProfilePage] Error loading statues from Firestore:', err);
      this.allStatues = [];
      this.displayStatueIds = [];
      this.displayStatues = [];
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

  // Statue management methods

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
    const uid = this.userId();
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
}
