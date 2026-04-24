import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
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
  checkmarkCircleOutline,
  closeCircleOutline,
  refreshOutline,
} from 'ionicons/icons';
import { HeaderComponent } from '../../components/header/header.component';
import {
  ClientPaymentsService,
  ClientTrainerPaymentContext,
  ClientTrainerPlan,
  ClientTrainerPlanBillingType,
} from '../../services/client-payments.service';

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

  isLoading = true;
  isStartingCheckout = false;
  errorMessage = '';
  successMessage = '';
  paymentContext: ClientTrainerPaymentContext | null = null;
  activePlanId = '';

  constructor() {
    addIcons({
      cardOutline,
      cashOutline,
      refreshOutline,
      checkmarkCircleOutline,
      closeCircleOutline,
    });
  }

  ngOnInit(): void {
    this.applyCheckoutMessageFromQueryParams();
    void this.loadPaymentContext();
  }

  ionViewWillEnter(): void {
    this.applyCheckoutMessageFromQueryParams();
    void this.loadPaymentContext();
  }

  async refresh(): Promise<void> {
    await this.loadPaymentContext();
  }

  async startCheckout(plan: ClientTrainerPlan): Promise<void> {
    const planId = String(plan?.planId || '').trim();
    if (!planId) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.activePlanId = planId;
    this.isStartingCheckout = true;

    try {
      const result = await this.clientPaymentsService.createCheckoutSession(planId);
      const checkoutWindow = window.open(result.checkoutUrl, '_blank', 'noopener');
      if (!checkoutWindow) {
        window.location.assign(result.checkoutUrl);
      }
    } catch (error) {
      console.error('[ClientPaymentsPage] Failed to start checkout:', error);
      this.errorMessage = this.resolveErrorMessage(error);
    } finally {
      this.isStartingCheckout = false;
      this.activePlanId = '';
    }
  }

  formatPrice(priceCents: number): string {
    const cents = Number.isFinite(priceCents) ? Math.max(0, Math.trunc(priceCents)) : 0;
    return (cents / 100).toFixed(2);
  }

  formatBillingType(billingType: ClientTrainerPlanBillingType): string {
    if (billingType === 'quarterly') {
      return 'Every 3 Months';
    }
    if (billingType === 'yearly') {
      return 'Yearly';
    }
    return billingType === 'weekly' ? 'Weekly' : 'Monthly';
  }

  checkoutButtonLabel(billingType: ClientTrainerPlanBillingType): string {
    return this.isRecurringType(billingType) ? 'Subscribe' : 'Pay Trainer';
  }

  isRecurringType(billingType: ClientTrainerPlanBillingType): boolean {
    return billingType === 'weekly' ||
      billingType === 'monthly' ||
      billingType === 'quarterly' ||
      billingType === 'yearly';
  }

  private async loadPaymentContext(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      this.paymentContext = await this.clientPaymentsService.getPaymentContext();
    } catch (error) {
      console.error('[ClientPaymentsPage] Failed to load payment context:', error);
      this.paymentContext = null;
      this.errorMessage = this.resolveErrorMessage(error);
    } finally {
      this.isLoading = false;
    }
  }

  private applyCheckoutMessageFromQueryParams(): void {
    const checkoutResult = String(this.route.snapshot.queryParamMap.get('checkout') || '').trim().toLowerCase();
    if (checkoutResult === 'success') {
      this.successMessage = 'Payment checkout completed. Your subscription should appear shortly.';
      return;
    }

    if (checkoutResult === 'cancel') {
      this.errorMessage = 'Checkout was cancelled. You can try again any time.';
      return;
    }

    this.successMessage = '';
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return 'Unable to start payment checkout right now.';
  }
}
