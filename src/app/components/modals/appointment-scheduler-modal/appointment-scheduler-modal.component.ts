import { Component, OnInit, Input, effect, inject, Signal, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { 
  IonHeader, 
  IonToolbar, 
  IonTitle, 
  IonContent, 
  IonButton, 
  IonButtons, 
  IonIcon,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonItem,
  IonLabel,
  IonDatetime,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonNote,
  ModalController,
  ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { close, calendar, time, fitness, calendarOutline, fitnessOutline, cashOutline, documentTextOutline, checkmarkCircle, personCircle, barbell, flash, walk, medal, rocket, nutrition, library } from 'ionicons/icons';
import { SessionBookingService } from 'src/app/services/session-booking.service';
import { TrainerAvailabilityService } from 'src/app/services/trainer-availability.service';
import { TimeSlot } from 'src/app/Interfaces/Calendar';

interface AppointmentData {
  clientId: string;
  clientName: string;
  date: string;
  time: string;
  duration: number;
  sessionType: string;
  price?: number;
  notes?: string;
}

@Component({
  selector: 'app-appointment-scheduler-modal',
  standalone: true,
  templateUrl: './appointment-scheduler-modal.component.html',
  styleUrls: ['./appointment-scheduler-modal.component.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButton,
    IonButtons,
    IonIcon,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonItem,
    IonLabel,
    IonDatetime,
    IonSelect,
    IonSelectOption,
    IonTextarea
  ],
})
export class AppointmentSchedulerModalComponent implements OnInit {
  @Input() clientId!: string;
  @Input() clientName!: string;
  @Input() trainerId!: string;
  @Input() mode: 'trainer-schedule' | 'client-request' = 'trainer-schedule';
  @Input() trainerName?: string;
  @Input() trainerFirstName?: string;
  @Input() trainerLastName?: string;
  @Input() trainerProfilePic?: string;
  @Input() clientFirstName?: string;
  @Input() clientLastName?: string;
  @Input() clientProfilePic?: string;

  private sessionBookingService = inject(SessionBookingService);
  private trainerAvailabilityService = inject(TrainerAvailabilityService);
  private toastController = inject(ToastController);
  availabilitySignal: Signal<TimeSlot[]> = signal<TimeSlot[]>([]);

  appointment: AppointmentData = {
    clientId: '',
    clientName: '',
    date: new Date().toISOString(),
    time: '09:00',
    duration: 60,
    sessionType: 'Strength Training',
    price: 75,
    notes: ''
  };

  sessionTypes = [
    'Strength Training',
    'HIIT Session',
    'Cardio & Core',
    'Upper Body Focus',
    'Lower Body Focus',
    'Full Body Workout',
    'Mobility & Flexibility',
    'Sports Performance',
    'Weight Loss Focus',
    'Muscle Building'
  ];

  durations = [
    { value: 30, label: '30 minutes' },
    { value: 45, label: '45 minutes' },
    { value: 60, label: '60 minutes' },
    { value: 90, label: '90 minutes' },
    { value: 120, label: '2 hours' }
  ];

  timeSlots: string[] = [];

  minDate: string = new Date().toISOString();

  constructor(private modalController: ModalController) {
    addIcons({ close, calendar, time, fitness, calendarOutline, fitnessOutline, cashOutline, documentTextOutline, checkmarkCircle, personCircle, barbell, flash, walk, medal, rocket, nutrition, library });

    effect(() => {
      if (!this.isClientRequestMode()) {
        return;
      }

      const availableSlots = this.requestAvailableSlots();
      if (!availableSlots.length) {
        this.appointment.time = '';
        return;
      }

      if (!availableSlots.includes(this.appointment.time)) {
        this.appointment.time = availableSlots[0];
      }
    });
  }

  ngOnInit() {
    this.appointment.clientId = this.clientId;
    this.appointment.clientName = this.clientName;
    this.generateTimeSlots();
    if (this.isClientRequestMode()) {
      this.loadTrainerAvailabilityForSelectedDate();
    }
  }

  generateTimeSlots() {
    const slots: string[] = [];
    for (let hour = 6; hour < 22; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        slots.push(timeString);
      }
    }
    this.timeSlots = slots;
  }

  formatTimeSlot(time: string): string {
    const normalizedTime = String(time || '').trim();
    if (!normalizedTime) {
      return 'Select a time';
    }
    if (/\b(?:AM|PM)\b/i.test(normalizedTime)) {
      return normalizedTime;
    }
    const [hour, minute] = normalizedTime.split(':');
    const hourNum = Number.parseInt(hour, 10);
    if (!Number.isFinite(hourNum) || !minute) {
      return normalizedTime;
    }
    const period = hourNum >= 12 ? 'PM' : 'AM';
    const displayHour = hourNum > 12 ? hourNum - 12 : hourNum === 0 ? 12 : hourNum;
    return `${displayHour}:${minute} ${period}`;
  }

  isClientRequestMode(): boolean {
    return this.mode === 'client-request';
  }

  get modalTitle(): string {
    return this.isClientRequestMode() ? 'Request Session' : 'Schedule Session';
  }

  get eyebrowLabel(): string {
    return this.isClientRequestMode() ? 'Client Request' : 'Trainer Session';
  }

  get heroTitle(): string {
    if (this.isClientRequestMode()) {
      return this.trainerName?.trim() || 'Your Trainer';
    }
    return this.clientName;
  }

  get heroCopy(): string {
    if (this.isClientRequestMode()) {
      return 'Choose an open time from your trainer\'s availability and send a booking request for approval.';
    }
    return 'Schedule a training session with a polished trainer-side workflow.';
  }

  get confirmButtonLabel(): string {
    return this.isClientRequestMode() ? 'Send Session Request' : 'Confirm Session';
  }

  get summaryPriceVisible(): boolean {
    return !this.isClientRequestMode() && !!this.appointment.price;
  }

  requestAvailableSlots(): string[] {
    return this.availabilitySignal()
      .filter((slot) => !slot.booked && !!slot.time)
      .map((slot) => slot.time);
  }

  onDateChanged(event: CustomEvent) {
    const nextValue = String(event.detail.value || '').trim();
    if (!nextValue) {
      return;
    }

    this.appointment.date = nextValue;
    if (this.isClientRequestMode()) {
      this.loadTrainerAvailabilityForSelectedDate();
    }
  }

  private loadTrainerAvailabilityForSelectedDate(): void {
    const date = this.toBookingDate(this.appointment.date);
    if (!this.trainerId || !date) {
      this.availabilitySignal = signal<TimeSlot[]>([]);
      return;
    }

    this.availabilitySignal = this.trainerAvailabilityService.getTrainerAvailability(this.trainerId, date);
  }

  private toBookingDate(rawValue: string): string {
    if (!rawValue) {
      return '';
    }

    const normalizedRawValue = String(rawValue).trim();
    const directDateMatch = normalizedRawValue.match(/^(\d{4}-\d{2}-\d{2})/);
    if (directDateMatch) {
      return directDateMatch[1];
    }

    const parsed = new Date(normalizedRawValue);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }

    return normalizedRawValue.includes('T') ? normalizedRawValue.split('T')[0] : normalizedRawValue;
  }

  getSessionIcon(type: string): string {
    const iconMap: { [key: string]: string } = {
      'Strength Training': 'barbell',
      'HIIT Session': 'flash',
      'Cardio & Core': 'walk',
      'Upper Body Focus': 'fitness',
      'Lower Body Focus': 'fitness',
      'Full Body Workout': 'medal',
      'Mobility & Flexibility': 'body',
      'Sports Performance': 'rocket',
      'Weight Loss Focus': 'nutrition',
      'Muscle Building': 'library'
    };
    return iconMap[type] || 'fitness';
  }

  dismiss() {
    this.modalController.dismiss();
  }

  async scheduleAppointment() {
    if (!this.appointment.date || !this.appointment.time) {
      console.error('Date and time are required');
      await this.showToast('Please select both date and time', 'warning');
      return;
    }

    try {
      const formattedDate = this.toBookingDate(this.appointment.date);
      const formattedTime = this.formatTimeSlot(this.appointment.time);

      if (this.isClientRequestMode()) {
        const availableSlots = this.requestAvailableSlots();
        if (!availableSlots.includes(formattedTime)) {
          await this.showToast('Please choose one of your trainer\'s available time slots.', 'warning');
          return;
        }
      }

      // Create booking request
      const bookingStatus: 'pending' | 'confirmed' = this.isClientRequestMode() ? 'pending' : 'confirmed';
      const bookingRequest = {
        trainerId: this.trainerId,
        clientId: this.appointment.clientId,
        trainerFirstName: this.trainerFirstName,
        trainerLastName: this.trainerLastName,
        trainerProfilePic: this.trainerProfilePic,
        clientFirstName: this.clientFirstName,
        clientLastName: this.clientLastName,
        clientProfilePic: this.clientProfilePic,
        date: formattedDate,
        time: formattedTime,
        duration: this.appointment.duration,
        price: this.appointment.price || 75,
        status: bookingStatus,
        createdAt: new Date(),
        sessionType: this.appointment.sessionType,
        notes: this.appointment.notes || '',
        requestedBy: this.isClientRequestMode() ? 'client' : 'trainer',
        requestType: this.isClientRequestMode() ? 'session_request' : 'trainer_scheduled'
      };

      // Save to Firestore using SessionBookingService
      const bookingId = await this.sessionBookingService.bookSession(bookingRequest);
      console.log('Appointment scheduled successfully with ID:', bookingId);

      await this.showToast(
        this.isClientRequestMode()
          ? 'Session request sent to your trainer!'
          : 'Appointment scheduled successfully!',
        'success'
      );
      
      // Dismiss modal with success
      this.modalController.dismiss({
        success: true,
        bookingId: bookingId,
        appointment: this.appointment,
        status: bookingRequest.status
      });
    } catch (error) {
      console.error('Error scheduling appointment:', error);
      await this.showToast('Failed to schedule appointment. Please try again.', 'danger');
    }
  }

  private async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      position: 'top',
      color
    });
    await toast.present();
  }
}
