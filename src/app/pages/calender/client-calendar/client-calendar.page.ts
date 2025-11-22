import { Component, OnInit, signal, effect, Injector, runInInjectionContext } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonDatetime, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonSpinner } from '@ionic/angular/standalone';
import { HeaderComponent } from '../../../components/header/header.component';
import { SessionBookingService } from '../../../services/session-booking.service';
import { UserService } from '../../../services/account/user.service';
import { trainerProfile } from '../../../Interfaces/Profiles/Trainer';
import { ListSessionsComponent, SessionData } from '../../../components/sessions/list-sessions/list-sessions.component';
import { ActivatedRoute } from '@angular/router';

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

  constructor(
    private sessionBookingService: SessionBookingService,
    private userService: UserService,
    private injector: Injector,
    private route: ActivatedRoute
  ) {
    // Use effect to react to changes in the current user
    effect(() => {
      const user = this.userService.getCurrentUser()();
      if (user) {
        this.clientId = user.uid;
        if (this.isLoading()) {
          this.loadMonthlyBookings();
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
      return {
        id: booking.id || booking.bookingId,
        trainerId: booking.trainerId,
        clientId: booking.clientId,
        date: booking.date,
        time: booking.time || booking.startTime,
        endTime: booking.endTime,
        duration: booking.duration || 30,
        status: booking.status || 'confirmed',
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
}
