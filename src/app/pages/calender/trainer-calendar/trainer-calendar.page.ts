import { Component, OnInit, OnDestroy, signal, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonDatetime, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonSpinner, IonButton, IonIcon, IonInput, IonTextarea, IonList, IonItem, IonLabel, IonFab, IonFabButton, AlertController, ActionSheetController, ModalController, ToastController } from '@ionic/angular/standalone';
import { HeaderComponent } from '../../../components/header/header.component';
import { SessionBookingService } from '../../../services/session-booking.service';
import { UserService } from '../../../services/account/user.service';
import { ListSessionsComponent, SessionData } from '../../../components/sessions/list-sessions/list-sessions.component';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-trainer-calendar',
  templateUrl: './trainer-calendar.page.html',
  styleUrls: ['./trainer-calendar.page.scss'],
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
export class TrainerCalendarPage implements OnInit {
  selectedDate = new Date().toISOString();
  trainings: any[] = [];
  allTrainings: any[] = [];
  isLoading = signal<boolean>(false);
  trainerId = '';
  monthlyBookings: any[] = [];
  currentMonth = new Date().getMonth();
  currentYear = new Date().getFullYear();
  highlightedDates: any[] = [];
  private lastRefreshTime = 0;

  constructor(
    private sessionBookingService: SessionBookingService,
    private userService: UserService,
    private route: ActivatedRoute
  ) {
    // Use effect to react to changes in the current user
    effect(() => {
      const user = this.userService.getCurrentUser()();
      if (user) {
        this.trainerId = user.uid;
        if (this.isLoading()) {
          this.loadMonthlyBookings();
          this.loadTrainings(new Date(this.selectedDate));
        }
      } else {
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
    console.log('Trainer calendar page entered');
    
    // Check if we need to refresh data (if more than 5 seconds have passed since last refresh)
    const now = Date.now();
    const refreshInterval = 5000; // 5 seconds in milliseconds
    
    if (now - this.lastRefreshTime > refreshInterval) {
      console.log('Refreshing calendar data');
      this.isLoading.set(true);
      this.loadMonthlyBookings();
      
      // Also load trainings for the selected date
      const selectedDateObj = new Date(this.selectedDate);
      this.loadTrainings(selectedDateObj);
      
      this.lastRefreshTime = now;
    } else {
      console.log('Skipping refresh - last refresh was too recent');
      
      // Still load trainings for the selected date even if we skip the monthly refresh
      const selectedDateObj = new Date(this.selectedDate);
      this.loadTrainings(selectedDateObj);
    }
  }

  dateChanged(event: CustomEvent) {
    const value = event.detail.value as string;
    this.selectedDate = value;
    const newDate = new Date(value);
    
    // Check if month has changed and reload monthly bookings if needed
    if (newDate.getMonth() !== this.currentMonth || newDate.getFullYear() !== this.currentYear) {
      this.currentMonth = newDate.getMonth();
      this.currentYear = newDate.getFullYear();
      this.loadMonthlyBookings();
    }
    
    this.loadTrainings(newDate);
  }

  /**
   * Load all bookings for the current month
   */
  private async loadMonthlyBookings() {
    if (!this.trainerId) {
      console.error('Cannot load bookings: No trainer ID available');
      this.isLoading.set(false);
      return;
    }
    try {
      const bookedSessions = await this.sessionBookingService.getTrainerBookedSessions(this.trainerId);
      this.monthlyBookings = bookedSessions;
      this.allTrainings = bookedSessions.map(booking => {
        return {
          id: booking.bookingId || booking.id,
          datetime: this.createDateTimeString(booking.date, booking.time || booking.startTime),
          clientName: booking.clientName || 'Client',
          clientId: booking.clientId,
          type: booking.sessionType || 'Training Session',
          date: booking.date,
          time: booking.time || booking.startTime,
          endTime: booking.endTime,
          duration: booking.duration || 30, // Default to 30 minutes if not specified
          status: booking.status || 'confirmed'
        };
      });
      
      // Update highlighted dates for the calendar
      this.updateHighlightedDates();
      
      // Reload trainings for the selected date
      this.loadTrainings(new Date(this.selectedDate));
    } catch (error) {
      console.error('Error loading monthly bookings:', error);
    } finally {
      this.isLoading.set(false);
    }
  }
  
  /**
   * Create a datetime string from date and time
   */
  private createDateTimeString(date: string, time: string): string {
    // Handle undefined or null inputs
    try {
      // Parse the date (YYYY-MM-DD)
      const [year, month, day] = date.split('-').map(num => parseInt(num, 10));
      
      // Parse the time (HH:MM AM/PM)
      const timeMatch = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (!timeMatch) {
        return new Date().toISOString();
      }
      
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const period = timeMatch[3].toUpperCase();
      
      // Convert to 24-hour format
      if (period === 'PM' && hours < 12) hours += 12;
      else if (period === 'AM' && hours === 12) hours = 0;
      
      // Create date at the specified time
      const dateObj = new Date(year, month - 1, day, hours, minutes);
      return dateObj.toISOString();
    } catch (error) {
      console.error('Error creating datetime string:', error);
      return new Date().toISOString();
    }
  }
  
  /**
   * Load trainings for the selected date
   */
  private loadTrainings(date: Date) {
    // Get year, month, day components in local time
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    
    // Format date for logging
    const formattedDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    console.log(`Loading trainings for date: ${formattedDate}`);
    
    this.trainings = this.allTrainings.filter(training => {
      // Create a new date from the training datetime to compare
      const trainingDate = new Date(training.datetime);
      
      // Compare year, month, day directly to avoid timezone issues
      const matchesDate = trainingDate.getFullYear() === year &&
        trainingDate.getMonth() === month &&
        trainingDate.getDate() === day;
      
      // Log for debugging
      if (matchesDate) {
        console.log(`Matched training: ${trainingDate.toISOString()} for selected date: ${formattedDate}`);
      }
      
      return matchesDate && training.status !== 'cancelled';
    }).map(training => ({
      ...training,
      displayTime: training.time // Just display the start time
    }));
  }

  /**
   * Update the highlighted dates array for the calendar
   * This will add dots to dates that have sessions
   */
  private updateHighlightedDates() {
    // Create a Set to store unique dates with sessions (to avoid duplicates)
    const datesWithSessions = new Set<string>();
    
    // Filter out cancelled sessions and collect unique dates
    this.allTrainings.forEach(training => {
      if (training.status !== 'cancelled' && training.date) {
        datesWithSessions.add(training.date);
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
    
    console.log('Updated highlighted dates:', this.highlightedDates);
  }
  
  /**
   * Handle session change events (reschedule or cancel) from the list-sessions component
   * @param event The session change event containing action and sessionId
   */
  onSessionChanged(event: {action: string, sessionId: string}) {
    console.log('Session changed event received in trainer calendar:', event);
    
    // Refresh the sessions list when a session is rescheduled or canceled
    if (event.action === 'reschedule' || event.action === 'cancel') {
      // Reload all bookings for the month to update the calendar highlights
      this.loadMonthlyBookings();
      
      // Also reload trainings for the selected date to update the list
      const selectedDateObj = new Date(this.selectedDate);
      this.loadTrainings(selectedDateObj);
      
      // Update the last refresh time
      this.lastRefreshTime = Date.now();
    }
  }
}