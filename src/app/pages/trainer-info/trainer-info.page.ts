import { CUSTOM_ELEMENTS_SCHEMA, Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { 
  IonContent, 
  IonIcon, 
  LoadingController, 
  IonButton,
  IonSpinner,
  IonFooter,
  IonToolbar
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { 
  informationCircleOutline, 
  map, 
  chatbubbleEllipsesOutline,
  checkmarkCircle,
  globeOutline,
  locationOutline,
  ribbonOutline,
  schoolOutline,
  documentTextOutline,
  informationOutline,
  chevronUpOutline,
  chevronDownOutline
} from 'ionicons/icons';
import { AccountService } from 'src/app/services/account/account.service';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { TrainerService } from 'src/app/services/trainer.service';
import { trainerProfile } from 'src/app/Interfaces/Profiles/Trainer';
import { ActivatedRoute, Router } from '@angular/router';
import { ROUTE_PATHS } from 'src/app/app.routes';
import { ChatsService } from 'src/app/services/chats.service';
import { DEFAULT_ASSETS } from 'src/assets/exports/assets.constants';

@Component({
  selector: 'app-trainer-info',
  templateUrl: './trainer-info.page.html',
  styleUrls: ['./trainer-info.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonContent,
    IonIcon,
    HeaderComponent,
    IonButton,
    IonSpinner,
    IonFooter,
    IonToolbar
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class TrainerInfoPage implements OnInit {
  trainerProfile: trainerProfile | null = null;
  trainerId: string | null = null;
  
  trainerInfo = {
    trainerImage: "", 
    name: '', 
    specialization: '', 
    description: '', 
    education: '', 
    isRemote: false, 
    isInperson: false,
  };

  isLoading = signal(true);
  isDescriptionExpanded = signal(false);
  isSpecializationExpanded = signal(false);
  
  // Character limits for collapsed descriptions
  readonly descriptionCharLimit = 300;
  readonly specializationCharLimit = 100;

  // Expose ROUTE_PATHS to template
  readonly ROUTE_PATHS = ROUTE_PATHS;

  constructor(
    private trainerService: TrainerService,
    private loadingCtrl: LoadingController,
    private accountService: AccountService,
    private route: ActivatedRoute,
    private router: Router,
    private chatsService: ChatsService
  ) {
    addIcons({
      informationCircleOutline,
      map,
      chatbubbleEllipsesOutline,
      checkmarkCircle,
      globeOutline,
      locationOutline,
      ribbonOutline,
      schoolOutline,
      documentTextOutline,
      informationOutline,
      chevronUpOutline,
      chevronDownOutline
    });
  }

  async ngOnInit() {
    // Get trainer ID from URL
    this.route.paramMap.subscribe(params => {
      this.trainerId = params.get('id');
      if (this.trainerId) {
        this.loadTrainerProfile(this.trainerId);
      } else {
        console.error('No trainer ID provided in URL');
        this.isLoading.set(false);
      }
    });
  }

  async loadTrainerProfile(trainerId: string) {
    const loading = await this.loadingCtrl.create({
      message: 'Loading profile...'
    });
    await loading.present();

    try {
      this.trainerProfile = await this.trainerService.getTrainerProfile(trainerId);
      console.log('Trainer profile:', this.trainerProfile);
      this.trainerInfo = {
        trainerImage: this.trainerProfile?.profileImage || DEFAULT_ASSETS.PROFILE_PHOTO,
        name: `${this.trainerProfile?.firstName} ${this.trainerProfile?.lastName}`,
        specialization: this.trainerProfile?.specialization || '',
        description: this.trainerProfile?.description || '',
        education: this.trainerProfile?.education || '',
        isRemote: this.trainerProfile?.trainingLocation?.remote,
        isInperson: this.trainerProfile?.trainingLocation?.inPerson,
      };
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      loading.dismiss();
      this.isLoading.set(false);
    }
  }

  // Toggle description expansion
  toggleDescription() {
    this.isDescriptionExpanded.update(current => !current);
  }

  // Toggle specialization expansion
  toggleSpecialization() {
    this.isSpecializationExpanded.update((current: boolean) => !current);
  }
  
  // Get truncated description with ellipsis
  getTruncatedDescription(): string {
    if (this.isDescriptionExpanded() || !this.trainerInfo.description || this.trainerInfo.description.length <= this.descriptionCharLimit) {
      return this.trainerInfo.description;
    }
    
    return this.trainerInfo.description.substring(0, this.descriptionCharLimit) + '...';
  }

  // Get truncated specialization with ellipsis
  getTruncatedSpecialization(): string {
    if (this.isSpecializationExpanded() || !this.trainerInfo.specialization || this.trainerInfo.specialization.length <= this.specializationCharLimit) {
      return this.trainerInfo.specialization;
    }
    
    return this.trainerInfo.specialization.substring(0, this.specializationCharLimit) + '...';
  }

  async goToChat() {
    if (!this.trainerId) {
      console.error('Cannot navigate to chat: No trainer ID available');
      return;
    }
    
    try {
      // Get current user ID
      const currentUser = this.accountService.getCredentials()();
      if (!currentUser || !currentUser.uid) {
        console.error('Cannot navigate to chat: User not logged in');
        return;
      }
      
      // Check if a chat already exists between these users
      const existingChatId = await this.chatsService.findExistingChatBetweenUsers(
        currentUser.uid, 
        this.trainerId
      );
      
      if (existingChatId) {
        // If chat exists, navigate to that chat
        console.log('Found existing chat:', existingChatId);
        this.router.navigate([ROUTE_PATHS.APP.CHAT, existingChatId, this.trainerId, 'client']);
      } else {
        // If no chat exists, create a new one
        console.log('No existing chat found, creating new chat');
        this.router.navigate([ROUTE_PATHS.APP.CHAT, 'new', this.trainerId, 'client']);
      }
    } catch (error) {
      console.error('Error checking for existing chat:', error);
      // Fallback to creating a new chat if there's an error
      this.router.navigate([ROUTE_PATHS.APP.CHAT, 'new', this.trainerId, 'client']);
    }
  }
}