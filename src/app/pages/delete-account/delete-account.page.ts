import { Component, OnInit, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular/standalone';
import { 
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonList, IonItem,
  IonLabel, IonIcon, IonButton, IonSpinner
} from '@ionic/angular/standalone';
import { Auth, deleteUser, getAuth, signOut } from '@angular/fire/auth';
import { Firestore, doc, deleteDoc, collection, query, where, getDocs, getDoc } from '@angular/fire/firestore';
import { UserService } from '../../services/account/user.service';
import { addIcons } from 'ionicons';
import { personOutline, chatbubbleOutline, documentTextOutline, calendarOutline, cardOutline } from 'ionicons/icons';

@Component({
  selector: 'app-delete-account',
  templateUrl: './delete-account.page.html',
  styleUrls: ['./delete-account.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonList, IonItem,
    IonLabel, IonIcon, IonButton, IonSpinner
  ]
})
export class DeleteAccountPage implements OnInit {
  // User data
  user = signal<any>(null);
  isTrainer = signal<boolean>(false);
  userId = '';
  
  // UI state
  confirmationText = '';
  isLoading = false;
  
  constructor(
    private auth: Auth,
    private firestore: Firestore,
    private userService: UserService,
    private router: Router,
    private alertController: AlertController,
    private toastController: ToastController
  ) {
    // Add icons to be used in the page
    addIcons({ personOutline, chatbubbleOutline, documentTextOutline, calendarOutline, cardOutline });
  }

  async ngOnInit() {
    try {
      // Get current Firebase auth user directly
      const auth = getAuth();
      const currentUser = auth.currentUser;
      
      // Log authentication state
      console.log('Auth state in ngOnInit:', auth);
      console.log('Current user object:', currentUser);
      
      if (currentUser) {
        this.userId = currentUser.uid;
        console.log('Current user ID:', this.userId);
        
        // Try to get user from Firestore directly to verify permissions
        try {
          const userDoc = await getDoc(doc(this.firestore, 'users', currentUser.uid));
          console.log('User document exists:', userDoc.exists());
        } catch (firestoreError) {
          console.error('Error accessing Firestore:', firestoreError);
        }
      } else {
        console.error('No authenticated user found in ngOnInit');
        
        // Try to get user credentials from AccountService as fallback
        try {
          const credentials = this.userService.getCurrentUser()();
          if (credentials && credentials.uid) {
            this.userId = credentials.uid;
            console.log('User ID from credentials:', this.userId);
          }
        } catch (credError) {
          console.error('Error getting credentials:', credError);
        }
      }
      
      // Get user info which contains the userType
      const userInfo = this.userService.getUserInfo();
      
      // Set up an effect to track changes to the userInfo signal
      effect(() => {
        const profile = userInfo();
        
        if (profile) {
          this.user.set(profile);
          this.isTrainer.set(profile.accountType === 'trainer');
          console.log('User profile loaded, account type:', profile.accountType);
        }
      });
    } catch (error) {
      console.error('Error in ngOnInit:', error);
    }
  }

  /**
   * Confirm account deletion with an alert
   */
  async confirmDelete() {
    const alert = await this.alertController.create({
      header: 'Final Confirmation',
      message: 'Are you absolutely sure you want to delete your account? This action CANNOT be undone.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete Account',
          role: 'confirm',
          cssClass: 'danger',
          handler: () => {
            this.deleteAccount();
          }
        }
      ]
    });

    await alert.present();
  }

  /**
   * Delete the user's account and all associated data
   */
  async deleteAccount() {
    try {
      this.isLoading = true;
      
      // Get current Firebase auth user
      const auth = getAuth();
      const currentUser = auth.currentUser;
      
      if (!currentUser) {
        throw new Error('No authenticated user found');
      }
      
      // Ensure we have the user ID
      this.userId = currentUser.uid;
      console.log('User ID for deletion:', this.userId);
      
      // 1. Delete user data from Firestore based on user type
      await this.deleteUserData();
      
      // 2. Delete the Firebase Authentication account
      await deleteUser(currentUser);
      
      // 3. Show success message
      const toast = await this.toastController.create({
        message: 'Your account has been successfully deleted.',
        duration: 3000,
        position: 'bottom',
        color: 'success'
      });
      await toast.present();
      
      // 4. Sign out and redirect to home/login page
      await signOut(auth);

      
      // Wait a short time to show the message before redirecting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Navigate to the login page with replaceUrl to prevent going back
      this.router.navigateByUrl('/', { replaceUrl: true });
      
    } catch (error) {
      console.error('Error deleting account:', error);
      
      // Show error message
      const toast = await this.toastController.create({
        message: `Failed to delete account: ${error instanceof Error ? error.message : 'Unknown error'}`,
        duration: 5000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
      
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Delete all user data from Firestore
   */
  private async deleteUserData() {
    // CRITICAL: Force get the user ID directly from Firebase Auth
    const auth = getAuth();
    if (!auth.currentUser) {
      await new Promise<void>(resolve => {
        const unsubscribe = auth.onAuthStateChanged(user => {
          unsubscribe();
          resolve();
        });
      });
    }
    
    const currentUser = auth.currentUser;
    if (currentUser) {
      this.userId = currentUser.uid;
      console.log('Retrieved user ID in deleteUserData:', this.userId);
    } else {
      console.error('Still no auth user after waiting for auth state');
    }
    
    // If still no userId, try one more approach with the account service
    if (!this.userId) {
      try {
        // Try to get from account service directly
        const accountService = this.userService['accountService'];
        if (accountService) {
          const credentials = accountService.getCredentials()();
          if (credentials && credentials.uid) {
            this.userId = credentials.uid;
            console.log('Got user ID from account service:', this.userId);
          }
        }
      } catch (e) {
        console.error('Error getting ID from account service:', e);
      }
    }
    
    const userId = this.userId;
    console.log('Final attempt to delete user data for ID:', userId);
    
    if (!userId) {
      throw new Error('User ID not found');
    }
    
    try {
      // Delete user profile based on user type
      if (this.isTrainer()) {
        console.log('Deleting trainer profile...');
        try {
          // Delete trainer profile
          await deleteDoc(doc(this.firestore, 'trainers', userId));
          console.log('Successfully deleted trainer profile');
        } catch (error) {
          console.error('Error deleting trainer profile:', error);
          // Don't throw, just log and continue
        }
        
        // Note: We are preserving agreements for record-keeping purposes
        
        console.log('Deleting trainer availability...');
        try {
          // Try both possible collection names for trainer availability
          try {
            // First try 'trainerAvailability'
            await deleteDoc(doc(this.firestore, 'trainerAvailability', userId));
            console.log('Successfully deleted trainer availability from trainerAvailability collection');
          } catch (error1) {
            console.log('Could not delete from trainerAvailability, trying trainer_availability...');
            // If that fails, try 'trainer_availability'
            try {
              await deleteDoc(doc(this.firestore, 'trainer_availability', userId));
              console.log('Successfully deleted trainer availability from trainer_availability collection');
            } catch (error2) {
              console.error('Error deleting from both availability collections:', error1, error2);
              // Don't throw here, just log and continue
            }
          }
        } catch (error) {
          console.error('Error in trainer availability deletion process:', error);
          // Don't throw here, just log and continue with other deletions
        }
        
      } else {
        console.log('Deleting client profile...');
        try {
          // Delete client profile
          await deleteDoc(doc(this.firestore, 'clients', userId));
          console.log('Successfully deleted client profile');
        } catch (error) {
          console.error('Error deleting client profile:', error);
          // Don't throw, just log and continue
        }
        
        // Note: We are preserving agreements for record-keeping purposes
      }
      
      // Delete user's chats
      console.log('Deleting user chats...');
      try {
        const chatsQuery = query(
          collection(this.firestore, 'chats'),
          where('participants', 'array-contains', userId)
        );
        const chatsSnapshot = await getDocs(chatsQuery);
        console.log(`Found ${chatsSnapshot.docs.length} chats to delete`);
        
        for (const chatDoc of chatsSnapshot.docs) {
          try {
            await deleteDoc(chatDoc.ref);
            console.log(`Deleted chat ${chatDoc.id}`);
          } catch (chatError) {
            console.error(`Error deleting chat ${chatDoc.id}:`, chatError);
            // Continue with other chats even if one fails
          }
        }
      } catch (error) {
        console.error('Error querying or deleting chats:', error);
        // Continue with other deletions even if chats fail
      }
      
      // Delete user's bookings
      console.log('Deleting user bookings...');
      try {
        const bookingsQuery = query(
          collection(this.firestore, 'bookings'),
          where(this.isTrainer() ? 'trainerId' : 'clientId', '==', userId)
        );
        const bookingsSnapshot = await getDocs(bookingsQuery);
        console.log(`Found ${bookingsSnapshot.docs.length} bookings to delete`);
        
        for (const bookingDoc of bookingsSnapshot.docs) {
          try {
            await deleteDoc(bookingDoc.ref);
            console.log(`Deleted booking ${bookingDoc.id}`);
          } catch (bookingError) {
            console.error(`Error deleting booking ${bookingDoc.id}:`, bookingError);
            // Continue with other bookings even if one fails
          }
        }
      } catch (error) {
        console.error('Error querying or deleting bookings:', error);
        // Continue with other deletions even if bookings fail
      }
      
      // Delete user document (in users collection)
      console.log('Deleting user document...');
      try {
        await deleteDoc(doc(this.firestore, 'users', userId));
        console.log('Successfully deleted user document');
      } catch (error) {
        console.error('Error deleting user document:', error);
        // Don't throw, just log and continue
      }
      
      // Even if we had errors with some collections, consider the data deletion successful
      // This ensures we can proceed with deleting the authentication account
      console.log('Data deletion completed with best effort');
    } catch (error) {
      console.error('Error in deleteUserData:', error);
      throw error;
    }
  }
}
