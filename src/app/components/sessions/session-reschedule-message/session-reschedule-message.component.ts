import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { IonCard, IonCardContent, IonButton, IonIcon, IonSpinner, IonText, IonRow, IonCol, IonItem, IonLabel } from '@ionic/angular/standalone';
import { SessionBookingService } from '../../../services/session-booking.service';
import { SessionRescheduleRequest } from '../../../Interfaces/SessionReschedule';
import { UserService } from '../../../services/account/user.service';
import { AccountService } from '../../../services/account/account.service';
import { addIcons } from 'ionicons';
import { calendarOutline, timeOutline, checkmarkOutline, closeOutline, alertCircleOutline } from 'ionicons/icons';

@Component({
  selector: 'app-session-reschedule-message',
  templateUrl: './session-reschedule-message.component.html',
  styleUrls: ['./session-reschedule-message.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonicModule,
    IonCard,
    IonCardContent,
    IonButton,
    IonIcon,
    IonSpinner,
    IonText,
    IonRow,
    IonCol,
    IonItem,
    IonLabel
  ]
})
export class SessionRescheduleMessageComponent implements OnInit {
  @Input() rescheduleId!: string;
  @Input() senderId!: string;
  @Input() timestamp!: string;
  
  rescheduleRequest: SessionRescheduleRequest | null = null;
  isLoading: boolean = true;
  isProcessing: boolean = false;
  error: string | null = null;
  userId: string | null = null;
  userType: 'trainer' | 'client' | null = null;
  
  // Determine if the current user can accept the request
  canAccept: boolean = false;
  
  constructor(
    private sessionBookingService: SessionBookingService,
    private accountService: AccountService,
    private userService: UserService,
    private toastController: ToastController,
    private alertController: AlertController
  ) {
    addIcons({
      calendarOutline,
      timeOutline,
      checkmarkOutline,
      closeOutline,
      alertCircleOutline
    });
  }

  async ngOnInit() {
    // Get user ID and type
    const credentials = this.accountService.getCredentials()();
    if (credentials) {
      this.userId = credentials.uid;
      
      // Get account type from user service
      const userProfile = this.userService.getUserInfo()();
      if (userProfile && userProfile.accountType) {
        this.userType = userProfile.accountType as 'trainer' | 'client';
      }
    }
    
    try {
      // Load the reschedule request details
      this.rescheduleRequest = await this.sessionBookingService.getSessionRescheduleRequestById(this.rescheduleId);
      
      if (this.rescheduleRequest) {
        // Determine if the current user can accept the request
        // Only the recipient of the request can accept it
        this.canAccept = this.userType === 'trainer' && this.rescheduleRequest.requestedBy === 'client' ||
                       this.userType === 'client' && this.rescheduleRequest.requestedBy === 'trainer';
      }
    } catch (error) {
      console.error('Error loading reschedule request:', error);
      this.error = 'Failed to load reschedule details';
    } finally {
      this.isLoading = false;
    }
  }
  
  /**
   * Accept the reschedule request
   */
  async acceptReschedule() {
    if (!this.rescheduleRequest || !this.userId || !this.rescheduleId) return;
    
    this.isProcessing = true;
    
    try {
      await this.sessionBookingService.acceptSessionRescheduleRequest(this.rescheduleId);
      this.showSuccessToast('Session rescheduled successfully');
      
      // Update the local state
      if (this.rescheduleRequest) {
        this.rescheduleRequest.status = 'accepted';
      }
    } catch (error) {
      console.error('Error accepting reschedule request:', error);
      this.showErrorAlert('Failed to accept reschedule request');
    } finally {
      this.isProcessing = false;
    }
  }
  
  /**
   * Reject the reschedule request
   */
  async rejectReschedule() {
    if (!this.rescheduleRequest || !this.userId || !this.rescheduleId) return;
    
    this.isProcessing = true;
    
    try {
      await this.sessionBookingService.rejectSessionRescheduleRequest(this.rescheduleId);
      this.showSuccessToast('Reschedule request rejected');
      
      // Update the local state
      if (this.rescheduleRequest) {
        this.rescheduleRequest.status = 'rejected';
      }
    } catch (error) {
      console.error('Error rejecting reschedule request:', error);
      this.showErrorAlert('Failed to reject reschedule request');
    } finally {
      this.isProcessing = false;
    }
  }
  
  /**
   * Format a date string to a more readable format
   */
  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }
  
  /**
   * Show a success toast message
   */
  private async showSuccessToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      color: 'success',
      position: 'bottom'
    });
    await toast.present();
  }
  
  /**
   * Show an error alert
   */
  private async showErrorAlert(message: string) {
    const alert = await this.alertController.create({
      header: 'Error',
      message,
      buttons: ['OK']
    });
    await alert.present();
  }
}
