import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  analyticsOutline,
  cardOutline,
  cashOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  createOutline,
  documentTextOutline,
  linkOutline,
  pricetagOutline,
  refreshOutline,
  warningOutline,
} from 'ionicons/icons';
import { HeaderComponent } from '../../components/header/header.component';
import {
  TrainerPaymentDashboardData,
  TrainerPlanBillingType,
  TrainerPaymentsService,
  TrainerStripeConnectSummary,
} from '../../services/trainer-payments.service';

@Component({
  selector: 'app-stripe-setup',
  standalone: true,
  templateUrl: './stripe-setup.page.html',
  styleUrls: ['./stripe-setup.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonCard,
    IonCardContent,
    IonButton,
    IonIcon,
    IonInput,
    IonItem,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTextarea,
    HeaderComponent,
  ],
})
export class StripeSetupPage implements OnInit {
  private readonly trainerPaymentsService = inject(TrainerPaymentsService);

  isLoading = true;
  isOpeningOnboarding = false;
  errorMessage = '';
  successMessage = '';
  dashboardData: TrainerPaymentDashboardData | null = null;
  isCreatingPlan = false;
  planErrorMessage = '';
  planSuccessMessage = '';
  latestCreatedPlanId = '';
  planTitle = 'Monthly Coaching';
  planDescription = 'Workout programming + weekly check-ins';
  planPriceCents: number | null = 7500;
  planBillingType: TrainerPlanBillingType = 'monthly';
  readonly billingTypeOptions: TrainerPlanBillingType[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

  constructor() {
    addIcons({
      cashOutline,
      cardOutline,
      analyticsOutline,
      linkOutline,
      pricetagOutline,
      documentTextOutline,
      refreshOutline,
      warningOutline,
      checkmarkCircleOutline,
      closeCircleOutline,
      createOutline,
    });
  }

  ngOnInit(): void {
    void this.loadDashboard();
  }

  ionViewWillEnter(): void {
    void this.loadDashboard();
  }

  get stripeSummary(): TrainerStripeConnectSummary | null {
    return this.dashboardData?.stripe ?? null;
  }

  get onboardingButtonLabel(): string {
    if (!this.stripeSummary) {
      return 'Start Stripe Onboarding';
    }

    if (this.stripeSummary.onboardingStatus === 'complete' && this.isStripeReadyToPayout) {
      return 'Review Stripe Account';
    }

    return 'Continue Stripe Onboarding';
  }

  get isStripeReadyToPayout(): boolean {
    const stripe = this.stripeSummary;
    if (!stripe) {
      return false;
    }

    return stripe.detailsSubmitted && stripe.chargesEnabled && stripe.payoutsEnabled;
  }

  async startStripeOnboarding(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';
    this.isOpeningOnboarding = true;

    try {
      const result = await this.trainerPaymentsService.createOnboardingLink();
      const onboardingWindow = window.open(result.onboardingUrl, '_blank', 'noopener');
      if (!onboardingWindow) {
        window.location.assign(result.onboardingUrl);
      }

      this.successMessage = 'Stripe onboarding opened. Return here after completing setup.';
      await this.loadDashboard();
    } catch (error) {
      console.error('[StripeSetupPage] Failed to create onboarding link:', error);
      this.errorMessage = this.resolveErrorMessage(error);
    } finally {
      this.isOpeningOnboarding = false;
    }
  }

  async refreshDashboard(): Promise<void> {
    await this.loadDashboard();
  }

  async createPlan(): Promise<void> {
    this.planErrorMessage = '';
    this.planSuccessMessage = '';
    this.latestCreatedPlanId = '';
    this.isCreatingPlan = true;

    try {
      const result = await this.trainerPaymentsService.createTrainerPlan({
        title: this.planTitle,
        description: this.planDescription,
        priceCents: Number(this.planPriceCents ?? 0),
        billingType: this.planBillingType,
      });
      this.latestCreatedPlanId = result.planId;
      this.planSuccessMessage = `Plan created successfully (${result.planId}).`;
      await this.loadDashboard();
    } catch (error) {
      console.error('[StripeSetupPage] Failed to create trainer plan:', error);
      this.planErrorMessage = this.resolveErrorMessage(error);
    } finally {
      this.isCreatingPlan = false;
    }
  }

  formatAccountId(accountId: string): string {
    const normalized = String(accountId || '').trim();
    if (normalized.length <= 10) {
      return normalized;
    }

    return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
  }

  private async loadDashboard(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      this.dashboardData = await this.trainerPaymentsService.getDashboardData();
    } catch (error) {
      console.error('[StripeSetupPage] Failed to load dashboard data:', error);
      this.dashboardData = null;
      this.errorMessage = this.resolveErrorMessage(error);
    } finally {
      this.isLoading = false;
    }
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return 'Unable to load trainer payment setup right now.';
  }
}
