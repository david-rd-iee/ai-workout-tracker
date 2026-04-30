import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonCard, IonCardContent, IonContent, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { alertCircleOutline, cashOutline, refreshOutline } from 'ionicons/icons';
import { Agreement } from 'src/app/Interfaces/Agreement';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { AgreementService } from 'src/app/services/agreement.service';

@Component({
  selector: 'app-agreement-payment-page',
  standalone: true,
  templateUrl: './agreement-payment.page.html',
  styleUrls: ['./agreement-payment.page.scss'],
  imports: [
    CommonModule,
    IonButton,
    IonCard,
    IonCardContent,
    IonContent,
    IonIcon,
    IonSpinner,
    HeaderComponent,
  ],
})
export class AgreementPaymentPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly agreementService = inject(AgreementService);

  isLoading = true;
  isStartingCheckout = false;
  errorMessage = '';
  agreement: Agreement | null = null;

  constructor() {
    addIcons({
      alertCircleOutline,
      cashOutline,
      refreshOutline,
    });

    void this.loadAgreement();
  }

  ionViewWillEnter(): void {
    void this.loadAgreement();
  }

  formatAmount(amountCents: number): string {
    const cents = Number.isFinite(amountCents) ? Math.max(0, Math.trunc(amountCents)) : 0;
    return (cents / 100).toFixed(2);
  }

  billingLabel(agreement: Agreement): string {
    const terms = agreement.paymentTerms;
    if (!terms?.required) {
      return 'No payment required';
    }

    if (terms.type === 'subscription') {
      return `Subscription${terms.interval ? ` (${terms.interval})` : ''}`;
    }

    return 'One-time payment';
  }

  async refresh(): Promise<void> {
    await this.loadAgreement();
  }

  async startCheckout(): Promise<void> {
    if (!this.agreement?.id) {
      return;
    }

    this.isStartingCheckout = true;
    this.errorMessage = '';

    try {
      const checkoutUrl = await this.agreementService.createAgreementCheckoutSession(
        this.agreement.id,
        'agreement-payment'
      );
      window.location.assign(checkoutUrl);
    } catch (error) {
      console.error('[AgreementPaymentPage] Failed to start agreement checkout:', error);
      this.errorMessage = this.resolveErrorMessage(error);
    } finally {
      this.isStartingCheckout = false;
    }
  }

  async goBackToAgreements(): Promise<void> {
    await this.router.navigate(['/service-agreements']);
  }

  private async loadAgreement(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      const agreementId = String(this.route.snapshot.paramMap.get('agreementId') || '').trim();
      if (!agreementId) {
        throw new Error('A valid agreement is required.');
      }

      const agreement = await this.agreementService.getAgreementById(agreementId);
      if (!agreement) {
        throw new Error('Agreement not found.');
      }

      const agreementStatus = String(agreement.agreementStatus || agreement.status || '').toLowerCase();
      const isSigned =
        agreementStatus === 'signed' ||
        agreementStatus === 'completed' ||
        agreementStatus === 'partially_signed';
      if (!isSigned) {
        throw new Error('Agreement must be signed before payment can begin.');
      }

      if (agreement.paymentTerms?.required !== true) {
        throw new Error('This agreement does not require payment.');
      }

      this.agreement = agreement;
    } catch (error) {
      console.error('[AgreementPaymentPage] Failed to load agreement payment context:', error);
      this.agreement = null;
      this.errorMessage = this.resolveErrorMessage(error);
    } finally {
      this.isLoading = false;
    }
  }

  private resolveErrorMessage(error: unknown): string {
    const message = String((error as { message?: unknown })?.message || '').trim();
    return message || 'Unable to load agreement payment details right now.';
  }
}
