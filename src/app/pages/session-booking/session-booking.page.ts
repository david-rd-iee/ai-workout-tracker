import { Component, OnInit, signal, computed, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ROUTE_PATHS } from '../../app.routes';
import { 
  IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonBackButton, 
  IonButton, IonIcon, IonCheckbox, IonToast, IonLoading, IonDatetime,
  ToastController, LoadingController, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';
import { TrainerAvailabilityService } from '../../services/trainer-availability.service';
import { SessionBookingService } from '../../services/session-booking.service';
import { TimeSlot } from '../../Interfaces/Calendar';
import { UserService } from '../../services/account/user.service';


@Component({
  selector: 'app-session-booking',
  templateUrl: './session-booking.page.html',
  styleUrls: ['./session-booking.page.scss'],
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    CommonModule, 
    FormsModule, 
    IonContent, 
    IonHeader, 
    IonTitle, 
    IonToolbar, 
    IonButtons, 
    IonBackButton, 
    IonButton, 
    IonDatetime
  ]
})
export class SessionBookingPage implements OnInit {
  // Calendar variables
  minSelectableDate = new Date().toISOString();
  selectedDate = signal<Date | null>(null);
  selectedDateISO = computed(() => {
    return this.selectedDate() ? this.selectedDate()!.toISOString() : '';
  });
  
  // Time slot variables
  availableTimeSlots = signal<TimeSlot[]>([]);
  selectedTimeSlots = signal<string[]>([]);
  
  // User variables
  trainerId = signal<string>('');
  clientId = signal<string>('');
  trainerName = signal<string>('Trainer');
  isTrainer = signal<boolean>(false);

  constructor(
    private trainerAvailabilityService: TrainerAvailabilityService,
    private sessionBookingService: SessionBookingService,
    private userService: UserService,
    private route: ActivatedRoute,
    private router: Router,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private location: Location
  ) {
    addIcons({ chevronBackOutline, chevronForwardOutline });
    
    const currentDate = new Date();
    this.minSelectableDate = currentDate.toISOString();
    
    this.selectedDate.set(currentDate);
  }

  ngOnInit() {    
    this.route.params.subscribe(async params => {
      const trainerId = params['trainerId'];
      
      if (trainerId) {
        this.trainerId.set(trainerId);
        console.log('Trainer ID set from route params:', trainerId);
        
        const trainerProfile = this.userService.getUserById(trainerId, 'trainer');
        
        const currentProfile = trainerProfile();
        if (currentProfile) {
          this.trainerName.set(currentProfile.firstName || 'Trainer');
        }
        
        setTimeout(() => {
          const profile = trainerProfile();
          if (profile) {
            this.trainerName.set(profile.firstName || 'Trainer');
          }
        }, 500);
        
        // Automatically load time slots for the current date
        const currentDate = new Date();
        this.selectedDate.set(currentDate);
        console.log('Automatically loading time slots for today:', this.trainerAvailabilityService.formatDate(currentDate));
        this.loadTimeSlots(currentDate);
      } else {
        console.warn('No trainer ID provided in route params');
        await this.showToast('No trainer ID provided. Please select a trainer first.');
        this.router.navigate(['/']);
        return;
      }
      
      // Get current user ID from the user service
      const currentUser = this.userService.getCurrentUser()();
      if (currentUser?.uid) {
        this.clientId.set(currentUser.uid);
        console.log('Client ID set:', currentUser.uid);
        
        // Check if the current user is the trainer
        this.isTrainer.set(currentUser.uid === trainerId);
        console.log('Is trainer:', this.isTrainer());
      } else {
        console.warn('No current user found');
        this.router.navigate(['/login']);
        return;
      }
    });
  }

  onDateChange(event: CustomEvent) {
    const selectedValue = event.detail.value;
    
    if (selectedValue) {
      const newDate = new Date(selectedValue);
      this.selectedDate.set(newDate);
      
      this.loadTimeSlots(newDate);
    }
  }

  selectDate(date: Date) {
    this.selectedDate.set(date);
    this.selectedTimeSlots.set([]);
    
    this.loadTimeSlots(date);
  }

  loadTimeSlots(date: Date) {
    if (!this.trainerId()) {
      console.error('Cannot load time slots: No trainer ID available');
      return;
    }
    
    const formattedDate = this.trainerAvailabilityService.formatDate(date);
    console.log(`Loading time slots for trainer ${this.trainerId()} on date ${formattedDate}`);
    
    this.availableTimeSlots.set([]);
    
    const availabilitySignal = this.trainerAvailabilityService.getTrainerAvailability(this.trainerId(), formattedDate);
    
    const initialTimeSlots = availabilitySignal();
    
    this.processTimeSlots(initialTimeSlots);
    
    setTimeout(() => {
      const updatedTimeSlots = availabilitySignal();
      if (updatedTimeSlots && updatedTimeSlots.length > 0 && JSON.stringify(updatedTimeSlots) !== JSON.stringify(initialTimeSlots)) {
        this.processTimeSlots(updatedTimeSlots);
      }
    }, 1000);
    
    return () => {};
  }
  
  private processTimeSlots(timeSlots: TimeSlot[]) {
    if (timeSlots && timeSlots.length > 0) {
      const sortedTimeSlots = [...timeSlots].sort((a, b) => {
        const timeA = this.parseTimeForSorting(a.time);
        const timeB = this.parseTimeForSorting(b.time);
        return timeA - timeB;
      });
      
      console.log('Setting sorted time slots:', sortedTimeSlots);
      this.availableTimeSlots.set(sortedTimeSlots);
      
      // Force update by creating a new array reference
      setTimeout(() => {
        console.log('Force updating time slots with same content to trigger change detection');
        this.availableTimeSlots.set([...this.availableTimeSlots()]);
      }, 100);
    } else {
      // If no time slots are available, set an empty array
      console.log('No time slots available from Firebase');
      this.availableTimeSlots.set([]);
    }
  }

  private parseTimeForSorting(timeStr: string): number {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return 0;
    
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
    
    if (ampm === 'PM' && hour < 12) {
      hour += 12;
    } else if (ampm === 'AM' && hour === 12) {
      hour = 0;
    }
    
    return hour * 60 + minute;
  }

  selectTimeSlot(time: string) {
    const currentSelected = this.selectedTimeSlots();
    
    // If the time slot is already selected, remove it
    if (currentSelected.includes(time)) {
      this.selectedTimeSlots.set(currentSelected.filter(slot => slot !== time));
    } else {
      // Otherwise add it to the selected time slots
      this.selectedTimeSlots.set([...currentSelected, time]);
    }
  }
  
  isTimeSlotSelected(time: string): boolean {
    return this.selectedTimeSlots().includes(time);
  }

  async proceedToBooking() {
    const selectedDate = this.selectedDate();
    const selectedTimeSlots = this.selectedTimeSlots();
    
    if (!selectedDate || selectedTimeSlots.length === 0) {
      await this.showToast('Please select a date and at least one time slot');
      return;
    }
    
    if (this.isTrainer()) {
      await this.showToast('These are your available time slots for ' + this.trainerAvailabilityService.formatDate(selectedDate));
      return;
    }
    
    try {
      const loading = await this.loadingController.create({
        message: 'Booking your session...',
        duration: 10000
      });
      await loading.present();
      
      // Book consecutive time slots as single sessions
      const formattedDate = this.sessionBookingService.formatDate(selectedDate);
      const bookingResults = await this.sessionBookingService.bookConsecutiveSessions(
        this.trainerId(),
        this.clientId(),
        formattedDate,
        selectedTimeSlots
      );
      
      console.log('Bookings created with IDs:', bookingResults);
      
      // Refresh the time slots to show the booked slots
      this.loadTimeSlots(selectedDate);
      
      loading.dismiss();
      
      // Get grouped sessions to display a more informative message
      const sessions = this.sessionBookingService.groupConsecutiveTimeSlots(selectedTimeSlots);
      if (sessions.length === 1) {
        // Single session with possibly multiple time slots
        const session = sessions[0];
        await this.showToast(`Session booked successfully for ${session.duration} mins!`);
      } else {
        // Multiple non-consecutive sessions
        await this.showToast(`${sessions.length} sessions booked successfully!`);
      }
      
      this.selectedTimeSlots.set([]);
      
      setTimeout(() => {
        this.location.back();
      }, 2000);
    } catch (error: any) {
      console.error('Error booking session:', error);
      await this.showToast('Error booking your session: ' + (error.message || 'Unknown error'));
    }
  }

  private async showToast(message: string, duration = 2000) {
    const toast = await this.toastController.create({
      message,
      duration,
      position: 'bottom'
    });
    await toast.present();
  }
}
