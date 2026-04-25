import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
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
  cashOutline,
  cardOutline,
  chatbubblesOutline,
  closeCircleOutline,
  fitnessOutline,
  refreshOutline,
  timeOutline,
} from 'ionicons/icons';
import { HeaderComponent } from '../../components/header/header.component';
import { ChatsService } from '../../services/chats.service';
import {
  ClientAgreementPricingSummary,
  ClientPaymentsService,
  ClientTrainerPaymentContext,
} from '../../services/client-payments.service';

interface AssignedTrainerWorkout {
  id: string;
  title: string;
  notes: string;
  exerciseCount: number;
  durationMinutes: number;
  assignedAt: Date;
  assignedAtLabel: string;
  isComplete: boolean;
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(Firestore);
  private readonly chatsService = inject(ChatsService);

  isLoading = true;
  isStartingCheckout = false;
  isOpeningChat = false;
  isLoadingWorkouts = false;
  errorMessage = '';
  successMessage = '';
  highlightWorkoutsSection = false;
  paymentContext: ClientTrainerPaymentContext | null = null;
  activeAgreementId = '';
  assignedWorkouts: AssignedTrainerWorkout[] = [];

  constructor() {
    addIcons({
      cardOutline,
      cashOutline,
      chatbubblesOutline,
      refreshOutline,
      closeCircleOutline,
      fitnessOutline,
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
      const result = await this.clientPaymentsService.createAgreementCheckoutSession(agreementId);
      const checkoutWindow = window.open(result.url, '_blank', 'noopener');
      if (!checkoutWindow) {
        window.location.assign(result.url);
      }
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
    const isSigned = agreementStatus === 'signed';
    const alreadyPaid = paymentStatus === 'paid' || paymentStatus === 'active';
    return isSigned && !alreadyPaid;
  }

  checkoutStatusLabel(agreementPricing: ClientAgreementPricingSummary): string {
    const agreementStatus = String(agreementPricing.status || '').toLowerCase();
    const paymentStatus = String(agreementPricing.paymentStatus || '').toLowerCase();
    if (paymentStatus === 'paid' || paymentStatus === 'active') {
      return 'Paid';
    }
    if (agreementStatus !== 'signed') {
      return 'Awaiting Signature';
    }

    return 'Ready for Payment';
  }

  private async loadPaymentContext(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      this.paymentContext = await this.clientPaymentsService.getPaymentContext();
      const clientId = String(this.paymentContext?.clientId || '').trim();
      if (clientId) {
        await this.loadAssignedWorkouts(clientId);
      } else {
        this.assignedWorkouts = [];
      }
    } catch (error) {
      console.error('[ClientPaymentsPage] Failed to load payment context:', error);
      this.paymentContext = null;
      this.assignedWorkouts = [];
      this.errorMessage = this.resolveErrorMessage(error);
    } finally {
      this.isLoading = false;
    }
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

  private async loadAssignedWorkouts(clientId: string): Promise<void> {
    this.isLoadingWorkouts = true;
    this.assignedWorkouts = [];

    try {
      const workoutsSnapshot = await getDocs(
        collection(this.firestore, `clientWorkouts/${clientId}/workouts`)
      );
      const workouts = workoutsSnapshot.docs
        .map((workoutDoc) => this.mapAssignedWorkout(workoutDoc.id, workoutDoc.data() as Record<string, unknown>))
        .sort((left, right) => right.assignedAt.getTime() - left.assignedAt.getTime());

      this.assignedWorkouts = workouts;
    } catch (error) {
      console.error('[ClientPaymentsPage] Failed to load assigned workouts:', error);
      this.assignedWorkouts = [];
    } finally {
      this.isLoadingWorkouts = false;
    }
  }

  private mapAssignedWorkout(workoutId: string, workoutData: Record<string, unknown>): AssignedTrainerWorkout {
    const title = String(workoutData['title'] || workoutData['name'] || 'Workout').trim() || 'Workout';
    const notes = String(workoutData['notes'] || workoutData['description'] || '').trim();
    const exercises = Array.isArray(workoutData['exercises']) ? workoutData['exercises'] : [];
    const duration = Number(workoutData['duration'] || 0);
    const assignedAt =
      this.toDate(workoutData['scheduledDate']) ||
      this.toDate(workoutData['createdAt']) ||
      this.toDate(workoutData['updatedAt']) ||
      new Date();

    return {
      id: workoutId,
      title,
      notes,
      exerciseCount: exercises.length,
      durationMinutes: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
      assignedAt,
      assignedAtLabel: assignedAt.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
      isComplete: workoutData['isComplete'] === true,
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
