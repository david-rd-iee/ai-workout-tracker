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
  IonInput,
  IonTextarea,
  ModalController,
  ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { close, calendarOutline, fitnessOutline, cashOutline, documentTextOutline, checkmarkCircle } from 'ionicons/icons';
import { SessionBookingService } from 'src/app/services/session-booking.service';
import { TrainerAvailabilityService } from 'src/app/services/trainer-availability.service';
import { TimeSlot } from 'src/app/Interfaces/Calendar';
import {
  AgreementPaymentStatus,
  AgreementPaymentTerms,
} from 'src/app/Interfaces/Agreement';

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
    IonInput,
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
  @Input() agreementPaymentTerms: AgreementPaymentTerms | null = null;
  @Input() agreementPaymentStatus: AgreementPaymentStatus | '' = '';

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
    addIcons({ close, calendarOutline, fitnessOutline, cashOutline, documentTextOutline, checkmarkCircle });

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
    this.applyAgreementPricingDefaults();
    this.generateTimeSlots();
    if (this.isClientRequestMode()) {
      this.loadTrainerAvailabilityForSelectedDate();
    }
  }

  private applyAgreementPricingDefaults(): void {
    const terms = this.agreementPaymentTerms;
    if (!terms || terms.required !== true) {
      return;
    }

    const agreementPrice = Math.max(0, Number(terms.amountCents || 0)) / 100;
    if (terms.type === 'one_time') {
      this.appointment.price = agreementPrice;
      return;
    }

    this.appointment.price = 0;
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
    return this.isClientRequestMode() ? 'Session' : 'Schedule';
  }

  get confirmButtonLabel(): string {
    return this.isClientRequestMode() ? 'Send Session Request' : 'Confirm Session';
  }

  get hasAgreementPricing(): boolean {
    return !!this.agreementPaymentTerms;
  }

  get isSubscriptionAgreement(): boolean {
    return this.agreementPaymentTerms?.required === true &&
      this.agreementPaymentTerms?.type === 'subscription';
  }

  get isOneTimeAgreement(): boolean {
    return this.agreementPaymentTerms?.required === true &&
      this.agreementPaymentTerms?.type === 'one_time';
  }

  get agreementPriceLabel(): string {
    const terms = this.agreementPaymentTerms;
    if (!terms || terms.required !== true) {
      return 'No payment required by agreement';
    }

    const amount = Math.max(0, Number(terms.amountCents || 0)) / 100;
    const currency = String(terms.currency || 'usd').toUpperCase();
    return `$${amount.toFixed(2)} ${currency}`;
  }

  get agreementSubscriptionLabel(): string {
    const interval = String(this.agreementPaymentTerms?.interval || 'month').toLowerCase();
    const intervalLabel = interval === 'week' ? 'weekly' : interval === 'year' ? 'yearly' : 'monthly';
    return `Subscription (${intervalLabel})`;
  }

  get isClientSubscribedToAgreement(): boolean {
    const normalizedStatus = String(this.agreementPaymentStatus || '').trim().toLowerCase();
    return normalizedStatus === 'active' || normalizedStatus === 'paid';
  }

  get agreementSubscriptionStatusLabel(): string {
    return this.isClientSubscribedToAgreement ? 'Client subscribed' : 'Client not subscribed';
  }

  requestAvailableSlots(): string[] {
    return this.availabilitySignal()
      .filter((slot) => {
        if (slot.booked || !slot.time) {
          return false;
        }
        if (!this.isClientRequestMode()) {
          return true;
        }
        return !this.isPastTimeForDate(this.toBookingDate(this.appointment.date), slot.time);
      })
      .map((slot) => slot.time);
  }

  previewAvailableSlots(): string[] {
    return this.requestAvailableSlots();
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

  selectAvailableTime(slot: string): void {
    if (!slot) {
      return;
    }
    this.appointment.time = slot;
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
        if (this.isPastTimeForDate(formattedDate, formattedTime)) {
          await this.showToast('You can only request same-day sessions at or after the current time.', 'warning');
          return;
        }

        const availableSlots = this.requestAvailableSlots();
        const requestedMinutes = this.parseTimeToMinutes(formattedTime);
        const hasMatchingSlot = availableSlots.some((slot) => {
          const slotMinutes = this.parseTimeToMinutes(this.formatTimeSlot(slot));
          if (Number.isFinite(requestedMinutes) && Number.isFinite(slotMinutes)) {
            return slotMinutes === requestedMinutes;
          }
          return this.formatTimeSlot(slot) === formattedTime;
        });

        if (!hasMatchingSlot) {
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
        price: this.resolveBookingPrice(),
        status: bookingStatus,
        createdAt: new Date(),
        sessionType: this.appointment.sessionType,
        notes: this.appointment.notes || '',
        requestedBy: this.isClientRequestMode() ? 'client' : 'trainer',
        requestType: this.isClientRequestMode() ? 'session_request' : 'trainer_scheduled'
      };

      // Save booking request/session
      const bookingId = this.isClientRequestMode()
        ? await this.sessionBookingService.requestSessionBooking(bookingRequest)
        : await this.sessionBookingService.bookSession(bookingRequest);
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
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Failed to schedule appointment. Please try again.';
      await this.showToast(message, 'danger');
    }
  }

  private resolveBookingPrice(): number {
    if (this.isOneTimeAgreement) {
      return Math.max(0, Number(this.agreementPaymentTerms?.amountCents || 0)) / 100;
    }
    if (this.isSubscriptionAgreement) {
      return 0;
    }
    return this.appointment.price || 75;
  }

  private isPastTimeForDate(date: string, time: string): boolean {
    const normalizedDate = String(date || '').trim();
    const normalizedTime = this.formatTimeSlot(String(time || '').trim());
    if (!normalizedDate || !normalizedTime) {
      return false;
    }

    const now = new Date();
    const today = this.formatLocalDate(now);
    if (normalizedDate !== today) {
      return false;
    }

    const requestedMinutes = this.parseTimeToMinutes(normalizedTime);
    if (!Number.isFinite(requestedMinutes)) {
      return false;
    }

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return requestedMinutes < nowMinutes;
  }

  private formatLocalDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseTimeToMinutes(time: string): number {
    const normalized = String(time || '').trim();
    if (!normalized) {
      return Number.NaN;
    }

    const amPmMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (amPmMatch) {
      let hour = Number.parseInt(amPmMatch[1], 10);
      const minute = Number.parseInt(amPmMatch[2], 10);
      const period = amPmMatch[3].toUpperCase();

      if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 1 || hour > 12 || minute < 0 || minute > 59) {
        return Number.NaN;
      }

      if (period === 'PM' && hour < 12) {
        hour += 12;
      } else if (period === 'AM' && hour === 12) {
        hour = 0;
      }

      return hour * 60 + minute;
    }

    const twentyFourHourMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (twentyFourHourMatch) {
      const hour = Number.parseInt(twentyFourHourMatch[1], 10);
      const minute = Number.parseInt(twentyFourHourMatch[2], 10);
      if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return Number.NaN;
      }
      return hour * 60 + minute;
    }

    return Number.NaN;
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
