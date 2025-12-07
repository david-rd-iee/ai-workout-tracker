import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController, AlertController } from '@ionic/angular';
import { IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent, 
         IonText, IonCard, IonCardContent, IonList, IonItem, IonLabel, IonTextarea, 
         IonRow, IonCol, IonSpinner, IonAvatar, IonDatetime, IonDatetimeButton, 
         IonModal, IonSelect, IonSelectOption } from '@ionic/angular/standalone';
import { SessionData } from '../list-sessions/list-sessions.component';
// import { SessionBookingService } from '../../../services/session-booking.service';
type SessionBookingService = any;
import { ChatsService } from '../../../services/chats.service';
import { AccountService } from '../../../services/account/account.service';
import { UserService } from '../../../services/account/user.service';
import { addIcons } from 'ionicons';
import { calendarOutline, timeOutline, personOutline, closeOutline, hourglassOutline, alertCircleOutline } from 'ionicons/icons';

@Component({
  selector: 'app-modal-session-cancel',
  templateUrl: './modal-session-cancel.component.html',
  styleUrls: ['./modal-session-cancel.component.scss'],
  standalone: true,
  imports: [
    IonicModule, 
    CommonModule, 
    FormsModule,
    IonHeader, 
    IonToolbar, 
    IonTitle, 
    IonButtons, 
    IonButton, 
    IonIcon, 
    IonContent,
    IonText, 
    IonCard, 
    IonCardContent, 
    IonList, 
    IonItem, 
    IonLabel, 
    IonTextarea,
    IonRow, 
    IonCol, 
    IonSpinner,
    IonAvatar,
    IonDatetime,
    IonDatetimeButton,
    IonModal,
    IonSelect,
    IonSelectOption
  ]
})
export class ModalSessionCancelComponent implements OnInit {
  @Input() session!: SessionData;
  
  // Properties for the form
  reason: string = '';
  selectedAction: 'reschedule' | 'cancel' | null = null;
  isSubmitting: boolean = false;
  newDate: string = '';
  newTime: string = '';
  userId: string | null = null;
  userType: 'trainer' | 'client' = 'client';
  minDate: string = new Date().toISOString();
  availableTimes: string[] = [
    '8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', 
    '11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', 
    '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', 
    '5:00 PM', '5:30 PM', '6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM'
  ];
  
  // Chat ID for sending messages
  chatId: string | null = null;

  constructor(
    private modalController: ModalController,
    private sessionBookingService: SessionBookingService,
    private chatsService: ChatsService,
    private accountService: AccountService,
    private userService: UserService,
    private toastController: ToastController,
    private alertController: AlertController
  ) {
    addIcons({
      calendarOutline,
      timeOutline,
      personOutline,
      closeOutline,
      hourglassOutline,
      alertCircleOutline
    });
  }

  ngOnInit() {
    console.log('Session data in modal:', this.session);
    
    // Set default date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.newDate = this.formatDate(tomorrow);
    
    // Set default time to the same time as the original session
    this.newTime = this.session.time;
    
    // Get user ID from account service
    const credentials = this.accountService.getCredentials()();
    if (credentials) {
      this.userId = credentials.uid;
      
      // Get account type from user service
      const userProfile = this.userService.getUserInfo()();
      if (userProfile && userProfile.accountType) {
        this.userType = userProfile.accountType as 'trainer' | 'client';
      }
    }
  }
  
  /**
   * Format a date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  /**
   * Select an action (reschedule or cancel)
   */
  selectAction(action: 'reschedule' | 'cancel') {
    this.selectedAction = action;
  }
  
  /**
   * Submit the selected action with reason
   */
  async submitAction() {
    if (!this.selectedAction || !this.reason.trim()) {
      return;
    }
    
    this.isSubmitting = true;
    
    try {
      if (this.selectedAction === 'reschedule') {
        await this.handleReschedule();
      } else if (this.selectedAction === 'cancel') {
        await this.handleCancel();
      }
    } catch (error) {
      console.error('Error processing action:', error);
      this.showErrorAlert('There was an error processing your request. Please try again.');
    } finally {
      this.isSubmitting = false;
    }
  }
  
  /**
   * Handle the reschedule action
   */
  private async handleReschedule() {
    if (!this.userId || !this.newDate || !this.newTime) {
      this.showErrorAlert('Please select a new date and time for the session.');
      this.isSubmitting = false;
      return;
    }
    
    try {
      // Create the reschedule request
      const rescheduleRequestId = await this.sessionBookingService.createSessionRescheduleRequest(
        this.session,
        this.newDate,
        this.newTime,
        this.reason,
        this.userType
      );
      
      // Find the chat ID between the trainer and client
      await this.findOrCreateChat();
      
      if (this.chatId) {
        // Send a message about the reschedule request
        await this.chatsService.sendMessage(
          this.chatId,
          this.userId!,
          `reschedule/${rescheduleRequestId}`
        );
      }
      
      // Show success message
      this.showSuccessToast('Session reschedule request sent successfully.');
      
      // Close the modal
      this.modalController.dismiss({
        action: 'reschedule',
        rescheduleRequestId,
        reason: this.reason,
        newDate: this.newDate,
        newTime: this.newTime,
        session: this.session
      });
    } catch (error) {
      console.error('Error rescheduling session:', error);
      this.showErrorAlert('Failed to reschedule session. Please try again.');
      this.isSubmitting = false;
    }
  }
  
  /**
   * Handle the cancel action
   */
  private async handleCancel() {
    try {
      // Cancel the session
      await this.sessionBookingService.cancelBookedSession(
        this.session.trainerId,
        this.session.id
      );
      
      // Find the chat ID between the trainer and client
      await this.findOrCreateChat();
      
      if (this.chatId) {
        // Send a message about the cancellation
        await this.chatsService.sendMessage(
          this.chatId,
          this.userId!,
          `Session on ${this.session.date} at ${this.session.time} has been cancelled. Reason: ${this.reason}`
        );
      }
      
      // Show success message
      this.showSuccessToast('Session cancelled successfully.');
      
      // Close the modal
      this.modalController.dismiss({
        action: 'cancel',
        reason: this.reason,
        session: this.session
      });
    } catch (error) {
      console.error('Error cancelling session:', error);
      this.showErrorAlert('Failed to cancel session. Please try again.');
      this.isSubmitting = false;
    }
  }
  
  /**
   * Find or create a chat between the trainer and client
   */
  private async findOrCreateChat() {
    if (!this.userId) return;
    
    try {
      // Determine the other user ID (trainer or client)
      const otherUserId = this.userType === 'trainer' ? this.session.clientId : this.session.trainerId;
      
      // First try to find an existing chat between the users
      const existingChatId = await this.chatsService.findExistingChatBetweenUsers(this.userId, otherUserId);
      
      if (existingChatId) {
        // Use the existing chat
        this.chatId = existingChatId;
        console.log('Using existing chat:', this.chatId);
      } else {
        // Create a new chat if none exists
        this.chatId = await this.chatsService.createChat(this.userId, otherUserId);
        console.log('Created new chat:', this.chatId);
      }
    } catch (error) {
      console.error('Error finding or creating chat:', error);
    }
  }
  
  /**
   * Show a success toast message
   */
  private async showSuccessToast(message: string) {
    const toast = await this.toastController.create({
      message: message,
      duration: 2000,
      position: 'bottom',
      color: 'success'
    });
    await toast.present();
  }
  
  /**
   * Show an error alert
   */
  private async showErrorAlert(message: string) {
    const alert = await this.alertController.create({
      header: 'Error',
      message: message,
      buttons: ['OK']
    });
    await alert.present();
  }
  
  /**
   * Close the modal without taking action
   */
  cancel() {
    this.modalController.dismiss({
      action: 'dismissed'
    });
  }
}
