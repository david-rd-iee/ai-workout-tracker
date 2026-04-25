import { Component, OnInit, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonDatetime, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonSpinner, ModalController, ToastController } from '@ionic/angular/standalone';
import { HeaderComponent } from '../../../components/header/header.component';
import { SessionBookingService } from '../../../services/session-booking.service';
import { UserService } from '../../../services/account/user.service';
import { ListSessionsComponent } from '../../../components/sessions/list-sessions/list-sessions.component';
import { ActivatedRoute } from '@angular/router';
import { AppointmentSchedulerModalComponent } from 'src/app/components/modals/appointment-scheduler-modal/appointment-scheduler-modal.component';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

@Component({
  selector: 'app-client-calendar',
  templateUrl: './client-calendar.page.html',
  styleUrls: ['./client-calendar.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonDatetime,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonSpinner,
    HeaderComponent,
    ListSessionsComponent
  ]
})
export class ClientCalendarPage implements OnInit {

  selectedDate = new Date().toISOString();
  trainings: any[] = [];
  allTrainings: any[] = [];
  isLoading = signal<boolean>(false);
  clientId = '';
  monthlyBookings: any[] = [];
  currentMonth = new Date().getMonth();
  currentYear = new Date().getFullYear();
  highlightedDates: any[] = [];
  // Force refresh when needed
  forceRefresh = 0;
  private currentUserRecord: Record<string, unknown> | null = null;

  constructor(
    private sessionBookingService: SessionBookingService,
    private userService: UserService,
    private route: ActivatedRoute,
    private modalController: ModalController,
    private toastController: ToastController,
    private firestore: Firestore,
  ) {
    // Use effect to react to changes in the current user
    effect(() => {
      const user = this.userService.getCurrentUser()();
      if (user) {
        this.currentUserRecord = user as unknown as Record<string, unknown>;
        this.clientId = user.uid;
        if (this.isLoading()) {
          this.loadMonthlyBookings();
        }
      } else {
        this.currentUserRecord = null;
        console.error('No user logged in');
        this.isLoading.set(false);
      }
    });
  }

  ngOnInit() {
    this.isLoading.set(true);
    
    // Check for selectedDate in query params
    this.route.queryParams.subscribe(params => {
      if (params['selectedDate']) {
        // If a date was passed in the URL, use it
        this.selectedDate = params['selectedDate'];
        console.log('Using date from URL:', this.selectedDate);
        
        // Parse the ISO date string to get year, month, day
        // The format should be something like: 2025-04-27T19:00:00.000Z
        const dateObj = new Date(this.selectedDate);
        
        // Ensure we're using the correct date regardless of timezone
        // by extracting the date parts directly from the ISO string
        this.currentMonth = dateObj.getMonth();
        this.currentYear = dateObj.getFullYear();
      }
    });
  }

  ionViewWillEnter() {
    // Always refresh data when entering the view
    this.isLoading.set(true);
    // loadMonthlyBookings will also call loadTrainings internally
    this.loadMonthlyBookings();
  }

  dateChanged(event: CustomEvent) {
    const value = event.detail.value as string;
    this.selectedDate = value;
    const newDate = new Date(value);
    
    this.trainings = [];
    this.forceRefresh++;
    
    if (newDate.getMonth() !== this.currentMonth || newDate.getFullYear() !== this.currentYear) {
      this.currentMonth = newDate.getMonth();
      this.currentYear = newDate.getFullYear();
      this.loadMonthlyBookings();
    } else {
      this.loadTrainings(newDate);
    }
  }

  /**
   * Load all bookings for the current month
   */
  private async loadMonthlyBookings() {
    if (!this.clientId) {
      this.isLoading.set(false);
      return;
    }
    
    try {
      // Get all bookings for this client
      const allBookings = await this.sessionBookingService.getClientBookings(this.clientId);
      
      // Filter bookings for the current month and year
      const currentMonthStr = String(this.currentMonth + 1).padStart(2, '0'); // +1 because JS months are 0-indexed
      const currentYearStr = String(this.currentYear);
      
      // Filter bookings that match the current month/year (format: YYYY-MM-DD)
      this.monthlyBookings = allBookings.filter(booking => {
        if (!booking.date) return false;
        return booking.date.startsWith(`${currentYearStr}-${currentMonthStr}`);
      });
      
      // Store all bookings for reference
      this.allTrainings = allBookings;
      
      // Update highlighted dates for the calendar
      this.updateHighlightedDates();
      
      // Load trainings for the selected date
      // The list-sessions component will handle profile loading
      this.loadTrainings(new Date(this.selectedDate));
    } catch (error) {
      console.error('Error loading monthly bookings:', error);
    } finally {
      this.isLoading.set(false);
    }
  }
  
  
  private loadTrainings(date: Date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    const formattedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    const bookings = this.monthlyBookings.filter(booking => {
      return booking.date === formattedDate;
    });
    
    const freshBookings = bookings.map(booking => {
      // Build the other party name from stored fields if available
      let otherPartyName = undefined;
      let otherPartyImage = undefined;
      if (booking.trainerFirstName || booking.trainerLastName) {
        const firstName = booking.trainerFirstName || '';
        const lastName = booking.trainerLastName || '';
        otherPartyName = `${firstName} ${lastName}`.trim();
        otherPartyImage = booking.trainerProfilePic || '';
      }
      
      return {
        id: booking.id || booking.bookingId,
        trainerId: booking.trainerId,
        clientId: booking.clientId,
        date: booking.date,
        time: booking.time || booking.startTime,
        endTime: booking.endTime,
        duration: booking.duration || 30,
        status: booking.status || 'confirmed',
        otherPartyName: otherPartyName,
        otherPartyImage: otherPartyImage,
        isProfileLoading: !otherPartyName, // Only loading if we don't have the name
        _refresh: Math.random().toString(36).substring(2, 15)
      };
    });
    
    this.trainings = [...freshBookings];
  }

  /**
   * Update the highlighted dates array for the calendar
   * This will add dots to dates that have sessions
   */
  private updateHighlightedDates() {
    // Create a Set to store unique dates with sessions (to avoid duplicates)
    const datesWithSessions = new Set<string>();
    
    // Filter out cancelled sessions and collect unique dates
    this.monthlyBookings.forEach(booking => {
      if (booking.status !== 'cancelled' && booking.date) {
        datesWithSessions.add(booking.date);
      }
    });
    
    // Convert the dates to the format expected by ion-datetime
    this.highlightedDates = Array.from(datesWithSessions).map(dateStr => {
      return {
        date: dateStr,
        textColor: '#172BFF', // Blue text color
        cssClass: 'has-session' // Custom CSS class for styling and adding dots via CSS
      };
    });
  }
  
  /**
   * Handle session change events (reschedule or cancel) from the list-sessions component
   * @param event The session change event containing action and sessionId
   */
  onSessionChanged(event: {action: string, sessionId: string}) {
    // Refresh the sessions list when a session is rescheduled or canceled
    if (event.action === 'reschedule' || event.action === 'cancel') {
      // Reload all bookings for the month to update the calendar highlights
      this.loadMonthlyBookings();
      
      // Note: loadMonthlyBookings already calls loadTrainings internally
      // so we don't need to call it again here
    }
  }

  async requestSessionWithTrainer(): Promise<void> {
    const clientId = String(this.clientId || '').trim();
    if (!clientId) {
      await this.showToast('Please log in to request a session.', 'warning');
      return;
    }

    const trainerId = await this.getAssignedTrainerId(clientId);
    if (!trainerId) {
      await this.showToast('Assign a trainer before requesting a session.', 'warning');
      return;
    }

    try {
      const [trainerSummary, trainerProfileSnap, clientSummary] = await Promise.all([
        this.userService.getUserSummaryDirectly(trainerId),
        getDoc(doc(this.firestore, 'trainers', trainerId)),
        this.userService.getUserSummaryDirectly(clientId),
      ]);

      const trainerProfile = trainerProfileSnap.exists()
        ? (trainerProfileSnap.data() as Record<string, unknown>)
        : {};

      const trainerFirstName = String(trainerSummary?.firstName || trainerProfile['firstName'] || '').trim();
      const trainerLastName = String(trainerSummary?.lastName || trainerProfile['lastName'] || '').trim();
      const trainerName = `${trainerFirstName} ${trainerLastName}`.trim() || 'Your Trainer';

      const clientFirstName = String(clientSummary?.firstName || this.currentUserRecord?.['firstName'] || '').trim();
      const clientLastName = String(clientSummary?.lastName || this.currentUserRecord?.['lastName'] || '').trim();
      const clientDisplayName = `${clientFirstName} ${clientLastName}`.trim() || 'Client';

      const modal = await this.modalController.create({
        component: AppointmentSchedulerModalComponent,
        componentProps: {
          mode: 'client-request',
          trainerId,
          trainerName,
          trainerFirstName,
          trainerLastName,
          trainerProfilePic: String(trainerSummary?.profilepic || trainerProfile['profilepic'] || '').trim(),
          clientId,
          clientName: clientDisplayName,
          clientFirstName,
          clientLastName,
          clientProfilePic: String(clientSummary?.profilepic || this.currentUserRecord?.['profilepic'] || '').trim(),
        },
      });

      await modal.present();
      const { data } = await modal.onWillDismiss();
      if (data?.success) {
        await this.loadMonthlyBookings();
      }
    } catch (error) {
      console.error('Error opening session request modal from client calendar:', error);
      await this.showToast('Unable to open session request right now.', 'danger');
    }
  }

  private async getAssignedTrainerId(clientId: string): Promise<string> {
    const fromUserRecord = String(
      this.currentUserRecord?.['trainerId'] || this.currentUserRecord?.['trainerID'] || ''
    ).trim();
    if (fromUserRecord) {
      return fromUserRecord;
    }

    try {
      const clientSnap = await getDoc(doc(this.firestore, 'clients', clientId));
      if (!clientSnap.exists()) {
        return '';
      }
      const data = clientSnap.data() as Record<string, unknown>;
      return String(data['trainerId'] || data['trainerID'] || '').trim();
    } catch (error) {
      console.error('Error resolving assigned trainer for client calendar:', error);
      return '';
    }
  }

  private async showToast(message: string, color: 'success' | 'warning' | 'danger' = 'success') {
    const toast = await this.toastController.create({
      message,
      duration: 2500,
      position: 'top',
      color,
    });
    await toast.present();
  }
}
