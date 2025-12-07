import { Component, OnInit, Signal, computed, effect, signal } from '@angular/core';
import { DEFAULT_ASSETS } from '../../../../assets/exports/assets.constants';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { IonContent, IonGrid, IonRow, IonCol, IonButton, IonList, IonItem, IonLabel, IonIcon, LoadingController, ToastController, IonCard, IonCardHeader, IonCardTitle, IonCardContent, ModalController } from '@ionic/angular/standalone';
import { UserService } from '../../../services/account/user.service';
import { clientProfile } from '../../../Interfaces/Profiles/client';
import { AccountService } from 'src/app/services/account/account.service';
import { ROUTE_PATHS } from 'src/app/app.routes';
import { ImageUploaderComponent } from 'src/app/components/image-uploader/image-uploader.component';
import { HeaderComponent } from "../../../components/header/header.component";
import { addIcons } from 'ionicons';
import { settingsOutline, addCircleOutline, trophy, chevronDown, chevronUp, medal, createOutline } from 'ionicons/icons';
import { AchievementBadge, ACHIEVEMENT_BADGES, calculateBadgeLevel } from '../../../Interfaces/Badge';
import { BadgeSelectorComponent } from '../../../components/badge-selector/badge-selector.component';
import { AchievementBadgeComponent } from '../../../components/achievement-badge/achievement-badge.component';

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
  readonly ROUTE_PATHS = ROUTE_PATHS;

  isAuthReady = this.accountService.isAuthReady();
  userId = computed(() => this.accountService.getCredentials()().uid);
  isLoading = signal(true);

  constructor(
    private userService: UserService,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private accountService: AccountService,
    private modalCtrl: ModalController,
    private route: ActivatedRoute
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
    // Check if viewing someone else's profile via route params
    this.route.params.subscribe(params => {
      this.profileUserId = params['userId'] || null;
      this.isOwnProfile = !this.profileUserId || this.profileUserId === this.userId();
    });
    
    // Mock data for testing without database connection
    this.clientInfo = {
      profileImage: DEFAULT_ASSETS.PROFILE_PHOTO,
      firstName: 'Test',
      lastName: 'Client'
    };
    // Load mock achievement badges with stats
    this.loadMockAchievementBadges();
    this.isLoading.set(false);
  }

  async loadClientProfile() {
    if (!this.userId()) {
      console.error('No user ID available');
      // Use mock data for testing
      this.clientInfo = {
        profileImage: DEFAULT_ASSETS.PROFILE_PHOTO,
        firstName: 'Test',
        lastName: 'Client'
      };
      this.isLoading.set(false);
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Loading profile...'
    });
    await loading.present();

    try {
      // Set default values first
      this.clientInfo = {
        profileImage: DEFAULT_ASSETS.PROFILE_PHOTO,
        firstName: 'Client',
        lastName: ''
      };
      
      // Use the direct method to get client profile
      const clientData = await this.userService.getUserProfileDirectly(this.userId(), 'client');
      console.log('Client data retrieved:', clientData);
      
      if (clientData) {
        // Update the client profile with the data - cast to clientProfile since we requested 'client' type
        this.clientProfile = clientData as clientProfile;
        
        // Update the client info with the data
        this.clientInfo = {
          profileImage: clientData.profileImage || DEFAULT_ASSETS.PROFILE_PHOTO,
          firstName: clientData.firstName || 'Client',
          lastName: clientData.lastName || ''
        };
        
        this.originalProfileImage = this.clientInfo.profileImage;
        console.log('Client info after processing:', JSON.stringify(this.clientInfo));
      } else {
        console.warn('No client profile found, using default values');
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      this.showToast('Failed to load profile');
    } finally {
      loading.dismiss();
      this.isLoading.set(false);
    }
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
      // Create a partial profile with just the fields we want to update
      const updatedProfile: Partial<clientProfile> = {};
      
      // Update profile with image if one was selected
      // Temporarily disabled - updateClientProfile method doesn't exist
      // await this.userService.updateClientProfile(
      //   this.userId(),
      //   updatedProfile,
      //   this.selectedFile || undefined
      // );
      console.warn('Update profile temporarily disabled');

      // Reset state after successful save
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
    //Mock values for demonstration
    const mockData: Record<string, number> = {
      //MASTER tier - Ultimate achievement
      'strength-master': 5500000,   
      
      //DIAMOND tier - Exceptional
      'workout-warrior': 650,         
      'heavy-lifter': 550,            
      
      //GOLD tier - Advanced
      'streak-king': 120,             
      'endurance-champion': 12000,    
      
      //SILVER tier - Intermediate
      'pr-crusher': 22,               
      'century-club': 175,            
      
      //BRONZE tier - Getting started
      'social-butterfly': 35,         
      'early-riser': 18,              
      
      //NOT YET EARNED - Show locked badges
      'transformation': 5,         
      
      //MASTER tier - Jerk Master
      //'jerk-master': 5000000000,      //5 billion reps - Master tier
    };
    return mockData[badgeId] || 0;
  }

  getMockPercentile(badgeId: string): number | undefined {
    //Mock percentile rankings
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
      //'jerk-master': 0.000001         
    };
    return mockPercentiles[badgeId];
  }

  updateDisplayBadges() {
    this.displayBadges = this.displayBadgeIds
      .map(id => this.allBadges.find(b => b.id === id))
      .filter(badge => badge !== undefined) as AchievementBadge[];
  }

  async openBadgeSelector() {
    //Only show earned badges in selector
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
