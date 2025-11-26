import { Component, OnInit, ElementRef, ViewChild, OnDestroy, AfterViewInit } from '@angular/core';
import { IonButtons, Platform } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonSpinner, IonItem, IonLabel, IonList } from '@ionic/angular/standalone';
import { ActivatedRoute, Router } from '@angular/router';
import { PaymentService } from '../../services/stripe/payment.service';
import { AgreementService } from '../../services/agreement.service';
import { CheckoutService } from '../../services/checkout.service';
import { Agreement } from '../../Interfaces/Agreement';
import { Subscription } from 'rxjs';
import { PaymentSuccessComponent } from './payment-success/payment-success.component';

@Component({
  selector: 'app-payment',
  templateUrl: './payment.page.html',
  styleUrls: ['./payment.page.scss'],
  standalone: true,
  imports: [
    IonContent, 
    IonHeader, 
    IonTitle, 
    IonToolbar, 
    CommonModule, 
    FormsModule, 
    IonButton, 
    IonCard, 
    IonCardContent, 
    IonCardHeader, 
    IonCardTitle,
    IonSpinner,
    IonItem,
    IonLabel,
    IonList,
    PaymentSuccessComponent,
    IonButtons
  ]
})
export class PaymentPage implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('checkoutElement') checkoutElement!: ElementRef;
  
  agreementId: string = '';
  agreement: Agreement | null = null;
  paymentAmount: number = 0;
  isLoading: boolean = true;
  error: string | null = null;
  paymentStatus: string = '';
  private statusSubscription: Subscription | undefined;
  
  // Checkout session properties
  clientSecret: string = '';
  checkoutSessionId: string = '';
  flexCheckoutUrl: string = '';
  flexCheckoutSessionId: string = '';
  
  // Flag to show payment success component
  showPaymentSuccess: boolean = false;
  
  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private paymentService: PaymentService,
    private agreementService: AgreementService,
    private checkoutService: CheckoutService,
    public platform: Platform  // Changed to public so it can be accessed from the template
  ) { }

  ngOnInit() {
    this.statusSubscription = this.paymentService.paymentStatus$.subscribe(status => {
      this.paymentStatus = status;
    });
    
    // First check if we're returning from Stripe checkout
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get('session_id');
    
    if (sessionId) {
      console.log('Detected return from Stripe with session_id:', sessionId);
      this.checkoutSessionId = sessionId;
      this.processSuccessfulPayment();
      return;
    }
    
    // If not returning from Stripe, proceed with normal flow
    this.route.paramMap.subscribe(params => {
      this.agreementId = params.get('agreementId') || '';
      if (this.agreementId) {
        this.loadAgreementData();
      } else {
        this.error = 'No agreement ID provided';
        this.isLoading = false;
      }
    });
  }
  
  ngOnDestroy() {
    if (this.statusSubscription) {
      this.statusSubscription.unsubscribe();
    }
    
    // Clean up checkout resources
    this.checkoutService.destroy();
  }
  
  async loadAgreementData() {
    try {
      this.isLoading = true;
      this.agreement = await this.agreementService.getAgreementById(this.agreementId);
      
      if (!this.agreement) {
        this.error = 'Agreement not found';
        this.isLoading = false;
        return;
      }
      
      this.paymentAmount = await this.paymentService.calculateAgreementTotal(this.agreementId);
      this.isLoading = false;
    } catch (error) {
      console.error('Error loading agreement data:', error);
      this.error = 'Failed to load agreement data';
      this.isLoading = false;
    }
  }
  
  async initiateCheckout() {
    try {
      // Don't create a new session if one already exists
      if (this.checkoutSessionId) {
        console.log('Checkout session already exists, skipping reset');
        return;
      }
      
      this.isLoading = true;
      console.log('Initiating checkout for agreement:', this.agreementId, 'with amount:', this.paymentAmount);
      
      // Create both Flex and Stripe checkout sessions using the service
      const session = await this.checkoutService.createCheckoutSessions(this.agreementId, this.paymentAmount);
      
      // Store session data
      this.checkoutSessionId = session.stripeSessionId;
      this.clientSecret = session.stripeClientSecret;
      this.flexCheckoutUrl = session.flexCheckoutUrl;
      this.flexCheckoutSessionId = session.flexSessionId;
      
      // Initialize Stripe embedded checkout after a short delay to ensure view is ready
      if (this.checkoutSessionId && this.clientSecret) {
        setTimeout(() => {
          this.initializeStripeElements();
        }, 100);
      }
      
      this.isLoading = false;
    } catch (error) {
      console.error('Error initiating checkout:', error);
      this.error = 'Failed to initiate checkout: ' + (error instanceof Error ? error.message : String(error));
      this.isLoading = false;
    }
  }
  
  
  /**
   * Handle Flex payment button click
   */
  async payWithFlex() {
    try {
      this.isLoading = true;
      this.error = null;
      
      // Process payment with Flex using the checkout service
      const success = await this.checkoutService.processFlexPayment(this.agreementId);
      
      if (success) {
        await this.processSuccessfulPayment();
      } else {
        console.log('Stripe checkout remains available for use');
        // Re-initialize Stripe checkout in case it was unmounted
        this.isLoading = false;
        setTimeout(() => {
          if (this.checkoutSessionId && this.clientSecret) {
            console.log('Re-initializing Stripe checkout after Flex cancellation');
            this.initializeStripeElements();
          }
        }, 300);
      }
    } catch (error) {
      console.error('Error processing Flex payment:', error);
      this.error = 'Failed to open Flex checkout. Please try again or use Stripe payment.';
      this.isLoading = false;
    }
  }
  
  
  /**
   * Implement AfterViewInit to ensure the view is initialized
   */
  ngAfterViewInit() {
    // If we already have a session ID, initialize the checkout after view init
    if (this.checkoutSessionId && this.clientSecret) {
      setTimeout(() => {
        this.initializeStripeElements();
      }, 0);
    }
  }

  /**
   * Initialize Stripe embedded checkout
   */
  private async initializeStripeElements() {
    try {
      if (!this.clientSecret) {
        throw new Error('Missing client secret for embedded checkout');
      }
      
      if (!this.checkoutElement || !this.checkoutElement.nativeElement) {
        console.warn('Checkout element not available yet, retrying...');
        // Retry after a longer delay if element isn't ready
        setTimeout(() => {
          this.initializeStripeElements();
        }, 200);
        return;
      }
      
      await this.checkoutService.initializeEmbeddedCheckout(
        this.clientSecret,
        this.checkoutElement,
        () => this.processSuccessfulPayment()
      );
    } catch (error) {
      console.error('Error initializing Stripe Elements:', error);
      this.error = 'Unable to load embedded checkout. Would you like to use the standard checkout instead?';
      this.isLoading = false;
      this.offerStandardCheckoutFallback(this.checkoutSessionId);
    }
  }

  
  
  goBack() {
    this.router.navigate(['/app/tabs/home']);
  }
  
  /**
   * Offer a fallback to standard Stripe checkout if embedded checkout fails
   */
  private offerStandardCheckoutFallback(sessionId: string) {
    // Create a button in the error container to redirect to standard checkout
    setTimeout(() => {
      const errorContainer = document.querySelector('.error-container');
      if (errorContainer) {
        const fallbackButton = document.createElement('ion-button');
        fallbackButton.setAttribute('expand', 'block');
        fallbackButton.setAttribute('color', 'primary');
        fallbackButton.textContent = 'Continue with Standard Checkout';
        fallbackButton.addEventListener('click', () => {
          this.redirectToStandardCheckout(sessionId);
        });
        
        // Add the button to the error container
        errorContainer.appendChild(fallbackButton);
      }
    }, 0);
  }
  
  /**
   * Handle return from Stripe checkout
   * This is called when the user is redirected back from Stripe
   */
  private async handleReturnFromStripe() {
    // Check if we're returning from a successful payment
    const url = new URL(window.location.href);
    const isSuccess = url.pathname.includes('payment-success') || url.searchParams.has('success');
    const isCancel = url.pathname.includes('payment-cancel') || url.searchParams.has('canceled');
    
    if (isSuccess) {
      console.log('Detected return from successful payment');
      await this.processSuccessfulPayment();
    } else if (isCancel) {
      console.log('Payment was canceled');
      this.error = 'Payment was canceled. Please try again.';
    }
  }
  
  
  private async processSuccessfulPayment() {
    try {
      this.isLoading = true;
      
      await this.checkoutService.processSuccessfulPayment(
        this.checkoutSessionId,
        this.agreementId || null,
        this.agreement,
        this.paymentAmount
      );
    } catch (error) {
      console.error('Error processing successful payment:', error);
    } finally {
      this.isLoading = false;
    }
  }
  
  /**
   * Redirect to standard Stripe checkout as a fallback
   */
  private async redirectToStandardCheckout(sessionId: string) {
    console.log('Redirecting to standard Stripe checkout');
    this.isLoading = true;
    
    try {
      const url = await this.checkoutService.getStandardCheckoutUrl(sessionId);
      
      if (url) {
        console.log('Redirecting to:', url);
        window.location.href = url;
      } else {
        throw new Error('Failed to get standard checkout URL');
      }
    } catch (error) {
      console.error('Error redirecting to standard checkout:', error);
      this.error = 'Payment system unavailable. Please try again later.';
      this.isLoading = false;
    }
  }
  
}
