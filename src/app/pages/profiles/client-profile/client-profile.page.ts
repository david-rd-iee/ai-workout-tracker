import { Component, OnInit, Signal, computed, effect, signal } from '@angular/core';
import { DEFAULT_ASSETS } from '../../../../assets/exports/assets.constants';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonContent, IonGrid, IonRow, IonCol, IonButton, IonList, IonItem, IonLabel, IonIcon, LoadingController, ToastController, IonCard } from '@ionic/angular/standalone';
import { UserService } from '../../../services/account/user.service';
import { clientProfile } from '../../../Interfaces/Profiles/Client';
import { AccountService } from 'src/app/services/account/account.service';
import { ROUTE_PATHS } from 'src/app/app.routes';
import { ImageUploaderComponent } from 'src/app/components/image-uploader/image-uploader.component';
import { HeaderComponent } from "../../../components/header/header.component";
import { addIcons } from 'ionicons';
import { settingsOutline } from 'ionicons/icons';

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

  // Expose ROUTE_PATHS to template
  readonly ROUTE_PATHS = ROUTE_PATHS;

  isAuthReady = this.accountService.isAuthReady();
  userId = computed(() => this.accountService.getCredentials()().uid);
  isLoading = signal(true);

  constructor(
    private userService: UserService,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private accountService: AccountService
  ) {
    addIcons({
      settingsOutline
    });
    effect(() => {
      if (this.isAuthReady()) {
        this.loadClientProfile();
      }
    });
  }

  ngOnInit() {}

  async loadClientProfile() {
    if (!this.userId()) {
      console.error('No user ID available');
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
      await this.userService.updateClientProfile(
        this.userId(),
        updatedProfile,
        this.selectedFile || undefined
      );

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
}
