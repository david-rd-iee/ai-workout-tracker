import { Component, OnInit, ViewChild, Signal, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonContent, IonButton, IonIcon, IonItem, IonCheckbox, IonGrid, IonRow, IonCol, IonTextarea, IonModal, IonDatetime, IonDatetimeButton, IonList, IonLabel, LoadingController, ToastController, ModalController, IonCard } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { close, map, informationCircleOutline, add, remove, createOutline, cloudUploadOutline, settingsOutline } from 'ionicons/icons';
import { HeaderComponent } from "../../../components/header/header.component";
import { TrainerService } from '../../../services/trainer.service';
import { trainerProfile } from '../../../Interfaces/Profiles/Trainer';
import { AccountService } from 'src/app/services/account/account.service';
import { UserService } from 'src/app/services/account/user.service';
import { ROUTE_PATHS } from 'src/app/app.routes';
import { ImageUploaderComponent } from 'src/app/components/image-uploader/image-uploader.component';
import { VideoUploaderComponent } from 'src/app/components/video-uploader/video-uploader.component';
import { AvailabiltyComponent } from 'src/app/components/availabilty/availabilty.component';
import { DayAvailability } from 'src/app/Interfaces/Availability';
import { CertificationsComponent } from 'src/app/components/certifications/certifications.component';
import { AutocorrectDirective } from 'src/app/directives/autocorrect.directive';
import { DEFAULT_ASSETS } from 'src/assets/exports/assets.constants';
import { ImageCarouselComponent, CarouselImage } from 'src/app/components/image-carousel/image-carousel.component';

// ModalController is already imported from @ionic/angular/standalone
@Component({
  selector: 'app-trainer-profile',
  templateUrl: './trainer-profile.page.html',
  styleUrls: ['./trainer-profile.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HeaderComponent,
    IonContent,
    IonTextarea,
    IonButton,
    IonIcon,
    IonItem,
    IonCheckbox,
    ImageUploaderComponent,
    VideoUploaderComponent,
    IonGrid,
    IonRow,
    IonCol,
    AvailabiltyComponent,
    CertificationsComponent,
    AutocorrectDirective,
    IonCard,
    ImageCarouselComponent
  ]
})
export class TrainerProfilePage implements OnInit {
  @ViewChild('specializationTextarea', { static: false }) specializationTextarea!: IonTextarea;
  @ViewChild('descriptionTextarea', { static: false }) descriptionTextarea!: IonTextarea;
  trainerProfile: trainerProfile | null = null;
  originalTrainerInfo: trainerProfile | null = null;
  originalAvailability: any;
  hasChanges: boolean = false;
  selectedFile: File | null = null;
  selectedVideoFile: File | null = null;
  beforeAfterImages: CarouselImage[] = [];
  originalBeforeAfterImages: CarouselImage[] = [];
  additionalPhotos: CarouselImage[] = [];
  originalAdditionalPhotos: CarouselImage[] = [];

  // Expose ROUTE_PATHS to template
  readonly ROUTE_PATHS = ROUTE_PATHS;

  trainerInfo = {
    trainerImage: "", name: '', specialization: '', description: '', certs: ['', ''], isRemote: false, isInperson: false, introVideoUrl: '',
  };

  availability: DayAvailability[] = [];

  bookNowPrice = {
    price: null, duration: null
  }

  isAuthReady = this.accountService.isAuthReady();
  userId = computed(() => this.accountService.getCredentials()().uid);
  isLoading = signal(true);

  constructor(
    private trainerService: TrainerService,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private accountService: AccountService,
    private modalCtrl: ModalController,
    private userService: UserService
  ) {
    addIcons({
      close,
      informationCircleOutline,
      add,
      remove,
      createOutline,
      cloudUploadOutline,
      map,
      settingsOutline
    });
     effect(() => {
      if (this.isAuthReady()) {
        this.loadTrainerProfile();
      }
    });
  }

  async ngOnInit() {
    // Set up an effect in the injection context
    this.initializeAvailability();
  }

  initializeAvailability() {
    // Initialize with default availability for each day of the week
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    this.availability = days.map(day => ({
      day: day,
      available: day !== 'Sun' && day !== 'Sat', // Default to available on weekdays
      timeWindows: [{
        startTime: '09:00 AM',
        endTime: '05:00 PM'
      }]
    }));
  }

  onAvailabilityChange(availability: DayAvailability[]) {
    this.availability = availability;
    this.hasChanges = true;
  }

  async loadTrainerProfile() {
    const userId = this.userId();
    if (!userId) {
      console.error('No user ID available');
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Loading profile...'
    });
    await loading.present();

    try {
      // Load trainer profile data
      this.trainerProfile = await this.trainerService.getTrainerProfile(userId);
      console.log('Trainer profile:', this.trainerProfile);
      this.trainerInfo = {
        trainerImage: this.trainerProfile?.profileImage || DEFAULT_ASSETS.PROFILE_PHOTO,
        name: `${this.trainerProfile?.firstName} ${this.trainerProfile?.lastName}`,
        specialization: this.trainerProfile?.specialization || '',
        description: this.trainerProfile?.description || '',
        certs: [this.trainerProfile?.education],
        isRemote: this.trainerProfile?.trainingLocation?.remote,
        isInperson: this.trainerProfile?.trainingLocation?.inPerson,
        introVideoUrl: this.trainerProfile?.introVideoUrl || '',
      };
      this.originalTrainerInfo = JSON.parse(JSON.stringify(this.trainerInfo));
      
      // Load trainer availability data
      try {
        const availabilityData = await this.trainerService.getTrainerAvailability(userId);
        if (availabilityData && availabilityData.length > 0) {
          this.availability = availabilityData;
          this.originalAvailability = JSON.parse(JSON.stringify(availabilityData));
          console.log('Loaded trainer availability:', this.availability);
        } else {
          // If no availability data found, initialize with default values
          this.initializeAvailability();
          console.log('No availability data found, initialized with defaults');
        }
      } catch (availabilityError) {
        console.error('Error loading availability:', availabilityError);
        // Initialize with defaults if there's an error
        this.initializeAvailability();
      }

      // Load before/after images
      try {
        const imageUrls = await this.trainerService.getBeforeAfterImages(userId);
        this.beforeAfterImages = imageUrls.map((url, index) => ({
          id: `${Date.now()}-${index}`,
          url: url
        }));
        this.originalBeforeAfterImages = JSON.parse(JSON.stringify(this.beforeAfterImages));
        console.log('Loaded before/after images:', this.beforeAfterImages.length);
      } catch (imageError) {
        console.error('Error loading before/after images:', imageError);
        this.beforeAfterImages = [];
        this.originalBeforeAfterImages = [];
      }

      // Load additional photos
      try {
        const photoUrls = await this.trainerService.getAdditionalPhotos(userId);
        this.additionalPhotos = photoUrls.map((url, index) => ({
          id: `${Date.now()}-${index}-additional`,
          url: url
        }));
        this.originalAdditionalPhotos = JSON.parse(JSON.stringify(this.additionalPhotos));
        console.log('Loaded additional photos:', this.additionalPhotos.length);
      } catch (photoError) {
        console.error('Error loading additional photos:', photoError);
        this.additionalPhotos = [];
        this.originalAdditionalPhotos = [];
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      this.showToast('Failed to load profile');
    } finally {
      loading.dismiss();
      this.isLoading.set(false);
    }
  }

  async toggleEdit() {
    if (this.trainerProfile) {
      // Validate that at least one training location option is selected
      if (!this.trainerInfo.isRemote && !this.trainerInfo.isInperson) {
        this.showToast('Please select at least one training location option (Remote or In-Person)');
        return;
      }

      const loading = await this.loadingCtrl.create({
        message: 'Saving changes...'
      });
      await loading.present();
  
      try {
        const updatedProfile: Partial<trainerProfile> = {
          trainingLocation: {
            remote: this.trainerInfo.isRemote || false,
            inPerson: this.trainerInfo.isInperson || false
          },
          certifications: this.trainerInfo.certs,
          description: this.descriptionTextarea?.value || '',
          specialization: this.specializationTextarea?.value || ''
        };
  
        // Update profile with image and video if they were selected
        await this.trainerService.updateTrainerProfile(
          this.accountService.getCredentials()().uid,
          updatedProfile,
          this.selectedFile || undefined,
          this.selectedVideoFile || undefined,
          loading
        );

        // Save trainer availability
        if (this.availability && this.availability.length > 0) {
          // Store availability in trainer profile or a separate collection
          // This is a simplified example - in a real app, you might want to store this in a separate collection
          await this.trainerService.updateTrainerAvailability(
            this.accountService.getCredentials()().uid,
            this.availability
          );
          
          // Store the original availability for change detection
          this.originalAvailability = JSON.parse(JSON.stringify(this.availability));
        }

        // Save before/after images
        const newImages = this.beforeAfterImages.filter(img => img.file);
        if (newImages.length > 0) {
          const files = newImages.map(img => img.file!);
          const uploadedUrls = await this.trainerService.uploadBeforeAfterImages(
            this.accountService.getCredentials()().uid,
            files
          );
          
          // Replace file-based images with uploaded URLs
          let uploadIndex = 0;
          this.beforeAfterImages = this.beforeAfterImages.map(img => {
            if (img.file) {
              return { id: img.id, url: uploadedUrls[uploadIndex++] };
            }
            return img;
          });
        }
        
        // Update all image URLs in Firestore
        const allImageUrls = this.beforeAfterImages.map(img => img.url);
        await this.trainerService.updateBeforeAfterImages(
          this.accountService.getCredentials()().uid,
          allImageUrls
        );
        this.originalBeforeAfterImages = JSON.parse(JSON.stringify(this.beforeAfterImages));

        // Save additional photos
        const newPhotos = this.additionalPhotos.filter(img => img.file);
        if (newPhotos.length > 0) {
          const files = newPhotos.map(img => img.file!);
          const uploadedUrls = await this.trainerService.uploadAdditionalPhotos(
            this.accountService.getCredentials()().uid,
            files
          );
          
          // Replace file-based images with uploaded URLs
          let uploadIndex = 0;
          this.additionalPhotos = this.additionalPhotos.map(img => {
            if (img.file) {
              return { id: img.id, url: uploadedUrls[uploadIndex++] };
            }
            return img;
          });
        }
        
        // Update all additional photo URLs in Firestore
        const allPhotoUrls = this.additionalPhotos.map(img => img.url);
        await this.trainerService.updateAdditionalPhotos(
          this.accountService.getCredentials()().uid,
          allPhotoUrls
        );
        this.originalAdditionalPhotos = JSON.parse(JSON.stringify(this.additionalPhotos));
  
        this.originalTrainerInfo = JSON.parse(JSON.stringify(this.trainerInfo));
        this.hasChanges = false;
        this.selectedFile = null; // Reset selected file after successful upload
        this.selectedVideoFile = null; // Reset selected video file after successful upload
        this.showToast('Profile updated successfully');
      } catch (error) {
        console.error('Error updating profile:', error);
        this.showToast('Failed to update profile');
      } finally {
        loading.dismiss();
      }
    }
  }

  async onImageSelected(file: File) {
    this.selectedFile = file;
    // Create preview
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.trainerInfo.trainerImage = e.target.result;
      this.onTrainerInfoChange();
    };
    reader.readAsDataURL(file);
  }

  async onVideoSelected(file: File) {
    console.log('Video selected in parent:', file.name, file.size, file.type);
    this.selectedVideoFile = file;
    this.onTrainerInfoChange();
  }

  onVideoRemoved() {
    console.log('Video removed in parent');
    this.selectedVideoFile = null;
    
    // If there's a saved video (from Firebase), mark it for deletion by clearing the URL
    // This will trigger hasChanges and allow the user to save the removal
    if (this.trainerInfo.introVideoUrl) {
      this.trainerInfo.introVideoUrl = '';
    }
    
    this.checkForChanges();
  }
  
  onCertificationsChange(certs: string[]) {
    if (!this.trainerInfo) {
      return;
    }
    
    this.trainerInfo.certs = certs;
    // Handle the updated certifications as needed
  }

  checkForChanges() {
    if (!this.originalTrainerInfo) return;

    const currentTrainerInfo = {
      ...this.trainerInfo,
      description: this.descriptionTextarea?.value || '',
      specialization: this.specializationTextarea?.value || ''
    };

    const originalTrainerInfoCompare = {
      ...this.originalTrainerInfo,
      description: this.originalTrainerInfo.description || '',
      specialization: this.originalTrainerInfo.specialization || ''
    };

    // Check for changes in trainer info
    const infoChanged = JSON.stringify(currentTrainerInfo) !== JSON.stringify(originalTrainerInfoCompare);
    
    // Check for changes in availability
    const availabilityChanged = this.originalAvailability ? 
      JSON.stringify(this.availability) !== JSON.stringify(this.originalAvailability) : 
      this.availability.length > 0;

    // Check for changes in before/after images
    const imagesChanged = JSON.stringify(this.beforeAfterImages) !== JSON.stringify(this.originalBeforeAfterImages);

    // Check for changes in additional photos
    const additionalPhotosChanged = JSON.stringify(this.additionalPhotos) !== JSON.stringify(this.originalAdditionalPhotos);

    // Check if there's a new file to upload (image or video)
    const hasNewFile = this.selectedFile !== null || this.selectedVideoFile !== null;

    this.hasChanges = infoChanged || availabilityChanged || imagesChanged || additionalPhotosChanged || hasNewFile;
  }

  // Add these event listeners to detect changes
  onTrainerInfoChange() {
    this.checkForChanges();
  }

  onBeforeAfterImagesChange(images: CarouselImage[]) {
    this.beforeAfterImages = images;
    this.checkForChanges();
  }

  onAdditionalPhotosChange(images: CarouselImage[]) {
    this.additionalPhotos = images;
    this.checkForChanges();
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