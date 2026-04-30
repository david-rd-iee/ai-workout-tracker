import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Firestore, collection, doc, getDoc, getDocs, query, where } from '@angular/fire/firestore';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonIcon,
  IonSpinner,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline,
  calendarOutline,
  cashOutline,
  chatbubblesOutline,
  closeCircleOutline,
  fitnessOutline,
  eyeOutline,
  locationOutline,
  lockClosedOutline,
  playOutline,
  refreshOutline,
  ribbonOutline,
  timeOutline,
} from 'ionicons/icons';
import { HeaderComponent } from '../../components/header/header.component';
import { ChatsService } from '../../services/chats.service';
import {
  ClientAgreementPricingSummary,
  ClientPaymentsService,
  ClientTrainerPaymentContext,
} from '../../services/client-payments.service';
import { SessionBookingService } from '../../services/session-booking.service';

interface AssignedTrainerWorkout {
  id: string;
  title: string;
  notes: string;
  exerciseCount: number;
  durationMinutes: number;
  dueDate: Date;
  dueDateLabel: string;
  statusLabel: string;
  isComplete: boolean;
}

interface NextSessionSummary {
  id: string;
  startsAt: Date;
  dateLabel: string;
  timeLabel: string;
  typeLabel: string;
  locationLabel: string;
  statusLabel: string;
  trainerName: string;
}

interface ConnectedTrainerDetails {
  displayName: string;
  profilepic: string;
  specialization: string;
  experience: string;
  education: string;
  city: string;
  state: string;
  hourlyRate: number | null;
}

@Component({
  selector: 'app-client-payments',
  standalone: true,
  templateUrl: './client-payments.page.html',
  styleUrls: ['./client-payments.page.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonCard,
    IonCardContent,
    IonButton,
    IonIcon,
    IonSpinner,
    HeaderComponent,
  ],
})
export class ClientPaymentsPage implements OnInit {
  private readonly clientPaymentsService = inject(ClientPaymentsService);
  private readonly sessionBookingService = inject(SessionBookingService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(Firestore);
  private readonly chatsService = inject(ChatsService);

  isLoading = true;
  isLoadingTrainer = false;
  isStartingCheckout = false;
  isOpeningChat = false;
  isLoadingWorkouts = false;
  isLoadingNextSession = false;
  errorMessage = '';
  successMessage = '';
  highlightWorkoutsSection = false;
  paymentContext: ClientTrainerPaymentContext | null = null;
  connectedTrainer: ConnectedTrainerDetails | null = null;
  activeAgreementId = '';
  assignedWorkouts: AssignedTrainerWorkout[] = [];
  nextSession: NextSessionSummary | null = null;
  nextSessionEmptyMessage = '';
  nextSessionErrorMessage = '';
  nextSessionPermissionDenied = false;

  constructor() {
    addIcons({
      alertCircleOutline,
      calendarOutline,
      cashOutline,
      chatbubblesOutline,
      refreshOutline,
      closeCircleOutline,
      fitnessOutline,
      eyeOutline,
      locationOutline,
      lockClosedOutline,
      playOutline,
      ribbonOutline,
      timeOutline,
    });
  }

  ngOnInit(): void {
    this.applyCheckoutMessageFromQueryParams();
    this.applyPanelFocusFromQueryParams();
    void this.loadPaymentContext();
  }

  ionViewWillEnter(): void {
    this.applyCheckoutMessageFromQueryParams();
    this.applyPanelFocusFromQueryParams();
    void this.loadPaymentContext();
  }

  async refresh(): Promise<void> {
    await this.loadPaymentContext();
  }

  async startCheckout(agreementPricing: ClientAgreementPricingSummary): Promise<void> {
    const agreementId = String(agreementPricing?.agreementId || '').trim();
    if (!agreementId) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.activeAgreementId = agreementId;
    this.isStartingCheckout = true;

    try {
      const returnOrigin = window.location.origin;
      const result = await this.clientPaymentsService.createAgreementCheckoutSession(
        agreementId,
        'client-payments',
        returnOrigin
      );
      window.location.assign(result.url);
    } catch (error) {
      console.error('[ClientPaymentsPage] Failed to start checkout:', error);
      this.errorMessage = this.resolveErrorMessage(error);
    } finally {
      this.isStartingCheckout = false;
      this.activeAgreementId = '';
    }
  }

  async openTrainerChat(): Promise<void> {
    const clientId = String(this.paymentContext?.clientId || '').trim();
    const trainerId = String(this.paymentContext?.trainerId || '').trim();
    if (!clientId || !trainerId) {
      return;
    }

    this.errorMessage = '';
    this.isOpeningChat = true;

    try {
      const chatId = await this.chatsService.findOrCreateDirectChat(clientId, trainerId);
      await this.router.navigate(['/chat', chatId], {
        state: {
          otherUserId: trainerId,
          userType: 'client',
        },
      });
    } catch (error) {
      console.error('[ClientPaymentsPage] Failed to open trainer chat:', error);
      this.errorMessage = 'Unable to open trainer chat right now.';
    } finally {
      this.isOpeningChat = false;
    }
  }

  async openAssignedWorkout(workout: AssignedTrainerWorkout): Promise<void> {
    const workoutId = String(workout?.id || '').trim();
    if (!workoutId) {
      return;
    }

    await this.router.navigate(['/assigned-workout', workoutId], {
      state: {
        workout,
      },
    });
  }

  formatPrice(priceCents: number): string {
    const cents = Number.isFinite(priceCents) ? Math.max(0, Math.trunc(priceCents)) : 0;
    return (cents / 100).toFixed(2);
  }

  formatBillingType(agreementPricing: ClientAgreementPricingSummary): string {
    if (agreementPricing.type === 'one_time') {
      return 'One-time';
    }

    if (agreementPricing.interval === 'week') {
      return 'Weekly';
    }
    if (agreementPricing.interval === 'year') {
      return 'Yearly';
    }
    return 'Monthly';
  }

  checkoutButtonLabel(agreementPricing: ClientAgreementPricingSummary): string {
    return agreementPricing.type === 'subscription' ? 'Subscribe' : 'Pay with Stripe';
  }

  canCheckout(agreementPricing: ClientAgreementPricingSummary): boolean {
    const agreementStatus = String(agreementPricing.status || '').toLowerCase();
    const paymentStatus = String(agreementPricing.paymentStatus || '').toLowerCase();
    const isSigned = agreementStatus === 'signed' ||
      agreementStatus === 'completed' ||
      agreementStatus === 'partially_signed';
    const alreadyPaid = paymentStatus === 'paid' || paymentStatus === 'active';
    return isSigned && !alreadyPaid;
  }

  checkoutStatusLabel(agreementPricing: ClientAgreementPricingSummary): string {
    const agreementStatus = String(agreementPricing.status || '').toLowerCase();
    const paymentStatus = String(agreementPricing.paymentStatus || '').toLowerCase();
    if (paymentStatus === 'paid' || paymentStatus === 'active') {
      return 'Paid';
    }
    if (
      agreementStatus !== 'signed' &&
      agreementStatus !== 'completed' &&
      agreementStatus !== 'partially_signed'
    ) {
      return 'Awaiting Signature';
    }

    return 'Ready for Payment';
  }

  get trainerLocationLabel(): string {
    const city = String(this.connectedTrainer?.city || '').trim();
    const state = String(this.connectedTrainer?.state || '').trim();

    if (city && state) {
      return `${city}, ${state}`;
    }

    return city || state || '';
  }

  trainerAvatarInitial(): string {
    const displayName = String(this.connectedTrainer?.displayName || this.paymentContext?.trainerName || '').trim();
    return displayName ? displayName[0].toUpperCase() : '?';
  }

  formatHourlyRate(rate: number): string {
    if (!Number.isFinite(rate) || rate <= 0) {
      return '';
    }

    return Number.isInteger(rate) ? rate.toFixed(0) : rate.toFixed(2);
  }

  formatSessionLocation(session: NextSessionSummary): string {
    const typeLabel = String(session?.typeLabel || '').trim();
    const locationLabel = String(session?.locationLabel || '').trim();

    if (typeLabel && locationLabel) {
      return `${typeLabel} · ${locationLabel}`;
    }

    return typeLabel || locationLabel || '';
  }

  private async loadPaymentContext(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    this.connectedTrainer = null;

    try {
      this.paymentContext = await this.clientPaymentsService.getPaymentContext();
      await this.loadConnectedTrainer();
      const clientId = String(this.paymentContext?.clientId || '').trim();
      const trainerId = String(this.paymentContext?.trainerId || '').trim();
      if (clientId && trainerId) {
        await Promise.allSettled([
          this.loadAssignedWorkouts(clientId, trainerId),
          this.loadNextSession(clientId, trainerId),
        ]);
      } else {
        this.assignedWorkouts = [];
        this.nextSession = null;
        this.nextSessionEmptyMessage = '';
        this.nextSessionErrorMessage = '';
        this.nextSessionPermissionDenied = false;
      }
    } catch (error) {
      console.error('[ClientPaymentsPage] Failed to load payment context:', error);
      this.paymentContext = null;
      this.connectedTrainer = null;
      this.assignedWorkouts = [];
      this.nextSession = null;
      this.nextSessionEmptyMessage = '';
      this.nextSessionErrorMessage = '';
      this.nextSessionPermissionDenied = false;
      this.errorMessage = this.resolveErrorMessage(error);
    } finally {
      this.isLoading = false;
    }
  }

  private async loadConnectedTrainer(): Promise<void> {
    const trainerId = String(this.paymentContext?.trainerId || '').trim();
    if (!trainerId) {
      this.connectedTrainer = null;
      return;
    }

    this.isLoadingTrainer = true;
    this.connectedTrainer = null;

    try {
      const [trainerUserSnap, trainerSnap] = await Promise.all([
        getDoc(doc(this.firestore, `users/${trainerId}`)),
        getDoc(doc(this.firestore, `trainers/${trainerId}`)),
      ]);

      if (!trainerUserSnap.exists() && !trainerSnap.exists()) {
        this.connectedTrainer = null;
        return;
      }

      const trainerUserData = trainerUserSnap.exists() ? (trainerUserSnap.data() as Record<string, unknown>) : {};
      const trainerData = trainerSnap.exists() ? (trainerSnap.data() as Record<string, unknown>) : {};
      const displayName = this.resolveTrainerDisplayName(trainerUserData, trainerData);

      this.connectedTrainer = {
        displayName,
        profilepic: this.resolveTrainerProfilePicture(trainerUserData, trainerData),
        specialization: String(trainerData['specialization'] || '').trim(),
        experience: String(trainerData['experience'] || '').trim(),
        education: String(trainerData['education'] || '').trim(),
        city: String(trainerUserData['city'] || trainerData['city'] || '').trim(),
        state: String(trainerUserData['state'] || trainerData['state'] || '').trim(),
        hourlyRate: this.resolveTrainerHourlyRate(trainerData),
      };
    } catch (error) {
      console.error('[ClientPaymentsPage] Failed to load connected trainer:', error);
      this.connectedTrainer = null;
    } finally {
      this.isLoadingTrainer = false;
    }
  }

  private resolveTrainerProfilePicture(
    trainerUserData: Record<string, unknown>,
    trainerData: Record<string, unknown>
  ): string {
    const profilePic =
      String(trainerUserData['profilepic'] || '').trim() ||
      String(trainerUserData['profilePic'] || '').trim() ||
      String(trainerUserData['profileImage'] || '').trim() ||
      String(trainerData['profilepic'] || '').trim() ||
      String(trainerData['photoURL'] || '').trim() ||
      String(trainerData['profilePic'] || '').trim();
    return profilePic;
  }

  private resolveTrainerHourlyRate(trainerData: Record<string, unknown>): number | null {
    const rawRate = Number(trainerData['hourlyRate']);
    return Number.isFinite(rawRate) && rawRate > 0 ? rawRate : null;
  }

  private resolveTrainerDisplayName(
    trainerUserData: Record<string, unknown>,
    trainerData: Record<string, unknown>
  ): string {
    const displayName =
      String(trainerUserData['displayName'] || '').trim() ||
      String(trainerData['displayName'] || '').trim() ||
      String(trainerUserData['username'] || '').trim() ||
      String(trainerData['username'] || '').trim();
    if (displayName) {
      return displayName;
    }

    const firstName =
      String(trainerUserData['firstName'] || trainerData['firstName'] || '').trim();
    const lastName =
      String(trainerUserData['lastName'] || trainerData['lastName'] || '').trim();
    return `${firstName} ${lastName}`.trim() || 'Assigned Trainer';
  }

  private isPermissionError(error: unknown): boolean {
    const message = this.resolveErrorMessage(error).toLowerCase();
    return message.includes('permission') || message.includes('insufficient');
  }

  private resolveNextSessionErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return 'Unable to load your next session right now.';
  }

  private applyCheckoutMessageFromQueryParams(): void {
    const checkoutResult = String(this.route.snapshot.queryParamMap.get('checkout') || '').trim().toLowerCase();
    if (checkoutResult === 'success') {
      this.successMessage = 'Payment checkout completed successfully.';
      return;
    }

    if (checkoutResult === 'cancel') {
      this.errorMessage = 'Checkout was cancelled. You can try again any time.';
      return;
    }

    this.successMessage = '';
  }

  private applyPanelFocusFromQueryParams(): void {
    const panel = String(this.route.snapshot.queryParamMap.get('panel') || '').trim().toLowerCase();
    this.highlightWorkoutsSection = panel === 'workouts';
  }

  private async loadAssignedWorkouts(clientId: string, trainerId: string): Promise<void> {
    this.isLoadingWorkouts = true;
    this.assignedWorkouts = [];

    try {
      const workoutsSnapshot = await getDocs(
        query(
          collection(this.firestore, `clientWorkouts/${clientId}/workouts`),
          where('trainerId', '==', trainerId)
        )
      );
      const workouts = workoutsSnapshot.docs
        .map((workoutDoc) => this.mapAssignedWorkout(workoutDoc.id, workoutDoc.data() as Record<string, unknown>))
        .sort((left, right) => right.dueDate.getTime() - left.dueDate.getTime());

      this.assignedWorkouts = workouts;
    } catch (error) {
      console.error('[ClientPaymentsPage] Failed to load assigned workouts:', error);
      this.assignedWorkouts = [];
    } finally {
      this.isLoadingWorkouts = false;
    }
  }

  private async loadNextSession(clientId: string, trainerId: string): Promise<void> {
    this.isLoadingNextSession = true;
    this.nextSession = null;
    this.nextSessionEmptyMessage = '';
    this.nextSessionErrorMessage = '';
    this.nextSessionPermissionDenied = false;

    try {
      const upcomingBookings = await this.sessionBookingService.getUpcomingConfirmedClientBookings(
        clientId,
        trainerId
      );
      const nextBooking = upcomingBookings[0];
      if (!nextBooking) {
        this.nextSessionEmptyMessage = 'No confirmed sessions are scheduled yet.';
        return;
      }

      this.nextSession = this.mapNextSession(nextBooking, trainerId);
    } catch (error) {
      console.error('[ClientPaymentsPage] Failed to load next session:', error);
      this.nextSession = null;
      this.nextSessionEmptyMessage = '';

      if (this.isPermissionError(error)) {
        this.nextSessionPermissionDenied = true;
        this.nextSessionErrorMessage = 'We could not load your bookings because this account does not have permission to read them right now.';
        return;
      }

      this.nextSessionErrorMessage = this.resolveNextSessionErrorMessage(error);
    } finally {
      this.isLoadingNextSession = false;
    }
  }

  private mapNextSession(booking: Record<string, unknown>, fallbackTrainerId: string): NextSessionSummary {
    const startsAt = this.resolveBookingStartDate(booking) || new Date();
    const trainerFirstName = String(booking['trainerFirstName'] || '').trim();
    const trainerLastName = String(booking['trainerLastName'] || '').trim();
    const trainerName = `${trainerFirstName} ${trainerLastName}`.trim() ||
      String(this.paymentContext?.trainerName || '').trim() ||
      'Your Trainer';
    const sessionType = String(booking['sessionType'] || '').trim().toLowerCase();
    const location = String(booking['location'] || '').trim();
    const meetingLink = String(booking['meetingLink'] || '').trim();
    const typeLabel = sessionType === 'in-person'
      ? 'In person'
      : sessionType === 'online'
        ? 'Online'
        : 'Session';
    const locationLabel = sessionType === 'in-person'
      ? location || 'Location pending'
      : meetingLink
        ? 'Virtual link available'
        : 'Trainer meeting';
    const status = String(booking['status'] || '').trim().toLowerCase();

    return {
      id: String(booking['id'] || booking['bookingId'] || '').trim(),
      startsAt,
      dateLabel: startsAt.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      timeLabel: startsAt.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }),
      typeLabel,
      locationLabel,
      statusLabel: status === 'confirmed' ? 'Confirmed' : 'Scheduled',
      trainerName: trainerName || (fallbackTrainerId ? 'Your Trainer' : 'Trainer'),
    };
  }

  private resolveBookingStartDate(booking: Record<string, unknown>): Date | null {
    const utcValue = String(booking['startTimeUTC'] || '').trim();
    if (utcValue) {
      const parsedUtc = new Date(utcValue);
      if (!Number.isNaN(parsedUtc.getTime())) {
        return parsedUtc;
      }
    }

    const dateValue = String(booking['date'] || '').trim();
    const timeValue = String(booking['time'] || booking['startTime'] || '').trim();
    if (!dateValue) {
      return null;
    }

    if (dateValue && timeValue) {
      const parsed = this.parseLocalBookingDateTime(dateValue, timeValue);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    const parsedDate = new Date(dateValue);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  private parseLocalBookingDateTime(dateStr: string, timeStr: string): Date {
    const dateParts = dateStr.split('-').map((part) => Number(part));
    const fallback = new Date(`${dateStr} ${timeStr}`);
    if (dateParts.length !== 3 || dateParts.some((part) => !Number.isFinite(part))) {
      return fallback;
    }

    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) {
      return fallback;
    }

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const period = match[3].toUpperCase();

    if (period === 'PM' && hours < 12) {
      hours += 12;
    } else if (period === 'AM' && hours === 12) {
      hours = 0;
    }

    const parsed = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], hours, minutes, 0, 0);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }

  private mapAssignedWorkout(workoutId: string, workoutData: Record<string, unknown>): AssignedTrainerWorkout {
    const title = String(workoutData['title'] || workoutData['name'] || 'Workout').trim() || 'Workout';
    const notes = String(workoutData['notes'] || workoutData['description'] || '').trim();
    const exercises = Array.isArray(workoutData['exercises']) ? workoutData['exercises'] : [];
    const duration = Number(workoutData['duration'] || 0);
    const dueDate =
      this.toDate(workoutData['scheduledDate']) ||
      this.toDate(workoutData['createdAt']) ||
      this.toDate(workoutData['updatedAt']) ||
      new Date();
    const isComplete = workoutData['isComplete'] === true;
    const statusLabel = isComplete
      ? 'Complete'
      : dueDate.getTime() < Date.now()
        ? 'Overdue'
        : 'Assigned';

    return {
      id: workoutId,
      title,
      notes,
      exerciseCount: exercises.length,
      durationMinutes: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
      dueDate,
      dueDateLabel: dueDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      statusLabel,
      isComplete,
    };
  }

  private toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof (value as { toDate?: unknown }).toDate === 'function') {
      const converted = (value as { toDate: () => Date }).toDate();
      return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
    }

    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return 'Unable to start payment checkout right now.';
  }
}
