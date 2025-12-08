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
import { HeaderComponent } from "../../../components/header/header.component";
import { addIcons } from 'ionicons';
import { settingsOutline, addCircleOutline, trophy, chevronDown, chevronUp, medal, createOutline } from 'ionicons/icons';
import { AchievementBadge, ACHIEVEMENT_BADGES, calculateBadgeLevel } from '../../../interfaces/Badge';
import { BadgeSelectorComponent } from '../../../components/badge-selector/badge-selector.component';
import { AchievementBadgeComponent } from '../../../components/achievement-badge/achievement-badge.component';

// ⭐ NEW: Firestore + AppUser import
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { AppUser } from 'src/app/models/user.model';

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
    IonCardContent,
    AchievementBadgeComponent,
  ]
})
export class ClientProfilePage implements OnInit {
  clientProfile: clientProfile | null = null;
  selectedFile: File | null = null;
  hasChanges: boolean = false;
  originalProfileImage: string = '';

  // ⭐ NEW: store the logged-in AppUser from /users collection
  appUser: AppUser | null = null;

  // 🔁 CHANGED: this is what you bind in your template
  clientInfo = {
    profileImage: "",
    firstName: "",
    lastName: ""
  };

  // Achievement Badge properties
  allBadges: AchievementBadge[] = [];
  displayBadges: AchievementBadge[] = [];
  displayBadgeIds: string[] = [];
  showAllAchievements: boolean = false;
  initialAchievementsCount: number = 3; // Show first 3 fully, 4th faded
  
  // Profile viewing properties
  profileUserId: string | null = null; // The ID of the profile being viewed
  isOwnProfile: boolean = true; // Whether viewing your own profile
  
  get earnedBadgesCount(): number {
    return this.allBadges.filter(b => b.currentLevel).length;
  }
  
  get visibleAchievements(): AchievementBadge[] {
    return this.showAllAchievements ? this.allBadges : this.allBadges.slice(0, this.initialAchievementsCount + 1);
  }
  
  toggleShowAllAchievements(): void {
    this.showAllAchievements = !this.showAllAchievements;
  }

  // Expose ROUTE_PATHS to template
  //readonly ROUTE_PATHS = ROUTE_PATHS;

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
    private firestore: Firestore,        // ⭐ NEW
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
    // 🔁 CHANGED: just set route info; no more hard-coded Test Client here
    this.route.params.subscribe(params => {
      this.profileUserId = params['userId'] || null;
      this.isOwnProfile = !this.profileUserId || this.profileUserId === this.userId();
    });

    // Keep mock achievement badges only if you still want them in dev:
    this.loadMockAchievementBadges();
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
      // ⭐ NEW: read from /users/{uid} using AppUser model
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

  // ⭐ NEW: small helper for dev fallback values
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

  //Achievement Badge management methods
  loadMockAchievementBadges() {
    //Create mock data
    this.allBadges = ACHIEVEMENT_BADGES.map(badge => ({
      ...badge,
      currentValue: this.getMockValue(badge.id),
      percentile: this.getMockPercentile(badge.id)
    })).map(badge => {
      const level = calculateBadgeLevel(badge, badge.currentValue || 0);
      return {
        ...badge,
        currentLevel: level || undefined
      };
    });

    //Set badges as display badges
    this.displayBadgeIds = ['strength-master', 'workout-warrior', 'streak-king'];
    this.updateDisplayBadges();
  }

  getMockValue(badgeId: string): number {
    const mockData: Record<string, number> = {
      'strength-master': 5500000,   
      'workout-warrior': 650,         
      'heavy-lifter': 550,            
      'streak-king': 120,             
      'endurance-champion': 12000,    
      'pr-crusher': 22,               
      'century-club': 175,            
      'social-butterfly': 35,         
      'early-riser': 18,              
      'transformation': 5,         
    };
    return mockData[badgeId] || 0;
  }

  getMockPercentile(badgeId: string): number | undefined {
    const mockPercentiles: Record<string, number> = {
      'strength-master': 0.5,        
      'workout-warrior': 2.3,       
      'heavy-lifter': 0.1,         
      'streak-king': 6.7,            
      'endurance-champion': 11.2,     
      'pr-crusher': 18.9,          
      'century-club': 23.4,          
      'social-butterfly': 38.6,      
      'early-riser': 42.1,          
    };
    return mockPercentiles[badgeId];
  }

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
    if (!this.clientProfile) {
      this.showToast('No profile data available');
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Saving display badges...'
    });
    await loading.present();

    try {
      const updatedProfile: Partial<clientProfile> = {
        displayBadges: this.displayBadgeIds
      };
      
      // Temporarily disabled - updateClientProfile method doesn't exist
      // await this.userService.updateClientProfile(
      //   this.userId(),
      //   updatedProfile
      // );
      console.warn('Update profile temporarily disabled');
      
      this.showToast('Display badges updated successfully');
    } catch (error) {
      console.error('Error updating display badges:', error);
      this.showToast('Failed to update display badges');
    } finally {
      loading.dismiss();
    }
  }
}
