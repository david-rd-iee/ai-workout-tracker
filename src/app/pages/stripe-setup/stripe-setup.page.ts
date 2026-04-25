import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  analyticsOutline,
  cardOutline,
  cashOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  linkOutline,
  refreshOutline,
  warningOutline,
} from 'ionicons/icons';
import { HeaderComponent } from '../../components/header/header.component';
import {
  TrainerPaymentDashboardData,
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
    IonContent,
    IonCard,
    IonCardContent,
    IonButton,
    IonIcon,
    IonSpinner,
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

  constructor() {
    addIcons({
      cashOutline,
      cardOutline,
      analyticsOutline,
      linkOutline,
      refreshOutline,
      warningOutline,
      checkmarkCircleOutline,
      closeCircleOutline,
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
