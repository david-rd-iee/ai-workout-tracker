import { Injectable, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { Platform } from '@ionic/angular/standalone';
import { Preferences } from '@capacitor/preferences';
import { loadStripe, Stripe, StripeEmbeddedCheckout } from '@stripe/stripe-js';
import { PaymentService } from './stripe/payment.service';
import { FlexPaymentService } from './flex-payment.service';
import { AgreementService } from './agreement.service';
import { GoogleAnalyticsService } from './google-analytics.service';
import { Agreement } from '../Interfaces/Agreement';

export interface CheckoutSession {
  stripeSessionId: string;
  stripeClientSecret: string;
  flexCheckoutUrl: string;
  flexSessionId: string;
}

@Injectable({
  providedIn: 'root'
})
export class CheckoutService {
  private stripe: Stripe | null = null;
  private embeddedCheckout: StripeEmbeddedCheckout | null = null;

  constructor(
    private paymentService: PaymentService,
    private flexPaymentService: FlexPaymentService,
    private agreementService: AgreementService,
    private googleAnalyticsService: GoogleAnalyticsService,
    private router: Router,
    private platform: Platform
  ) {}

  /**
   * Create both Stripe and Flex checkout sessions in parallel
   */
  async createCheckoutSessions(agreementId: string, paymentAmount: number): Promise<CheckoutSession> {
    // Create Stripe session (required)
    const stripeResponse = await this.createStripeCheckoutSession(agreementId, paymentAmount);
    
    // Create Flex session (optional - don't fail if it errors)
    let flexData = { redirect_url: '', checkout_session_id: '' };
    try {
      flexData = await this.createFlexCheckoutSession(agreementId);
    } catch (error) {
      console.warn('Flex checkout session creation failed, continuing with Stripe only:', error);
    }

    return {
      stripeSessionId: stripeResponse.sessionId,
      stripeClientSecret: stripeResponse.clientSecret,
      flexCheckoutUrl: flexData.redirect_url,
      flexSessionId: flexData.checkout_session_id
    };
  }

  /**
   * Create Stripe checkout session
   */
  private async createStripeCheckoutSession(agreementId: string, paymentAmount: number) {
    console.log('Creating Stripe checkout session...');
    const response = await this.paymentService.createCheckoutSession(agreementId, paymentAmount);
    
    if (!response || !response.sessionId) {
      throw new Error('Invalid checkout session response');
    }
    
    console.log('Stripe checkout session created:', response.sessionId);
    return response;
  }

  /**
   * Create Flex checkout session
   */
  private async createFlexCheckoutSession(agreementId: string) {
    console.log('Creating Flex checkout session...');
    const response = await this.flexPaymentService.createCheckoutSession(agreementId);
    console.log('Flex checkout session created:', response.checkout_session_id);
    return response;
  }

  /**
   * Initialize and mount Stripe embedded checkout
   */
  async initializeEmbeddedCheckout(
    clientSecret: string,
    checkoutElement: ElementRef,
    onComplete: () => void
  ): Promise<void> {
    try {
      console.log('Initializing Stripe Embedded Checkout');
      
      if (!clientSecret) {
        throw new Error('Missing client secret for embedded checkout');
      }

      // Load Stripe if not already loaded
      if (!this.stripe) {
        this.stripe = await loadStripe(this.paymentService.getStripePublicKey());
        
        if (!this.stripe) {
          throw new Error('Failed to load Stripe');
        }
      }

      // Mount the embedded checkout
      await this.mountEmbeddedCheckout(clientSecret, checkoutElement, onComplete);
    } catch (error) {
      console.error('Error initializing Stripe Elements:', error);
      throw error;
    }
  }

  /**
   * Mount the embedded checkout to the DOM element
   */
  private async mountEmbeddedCheckout(
    clientSecret: string,
    checkoutElement: ElementRef,
    onComplete: () => void
  ): Promise<void> {
    try {
      if (!checkoutElement || !checkoutElement.nativeElement) {
        throw new Error('Checkout element not available');
      }

      if (!this.stripe) {
        throw new Error('Stripe not initialized');
      }

      // Check if already mounted and still in DOM
      if (this.embeddedCheckout) {
        // Check if the checkout is still mounted in the DOM
        const isStillMounted = checkoutElement.nativeElement.querySelector('iframe');
        if (isStillMounted) {
          console.log('Embedded checkout already exists and is mounted, skipping re-initialization');
          return;
        } else {
          console.log('Embedded checkout exists but not mounted, destroying and re-creating');
          try {
            this.embeddedCheckout.destroy();
          } catch (e) {
            console.warn('Error destroying old checkout:', e);
          }
          this.embeddedCheckout = null;
        }
      }

      console.log('Creating embedded checkout with client secret');
      
      // Clear any existing content
      checkoutElement.nativeElement.innerHTML = '';
      
      // Create the embedded checkout with timeout
      const checkoutPromise = this.stripe.initEmbeddedCheckout({
        clientSecret: clientSecret,
        onComplete: () => {
          console.log('Payment completed successfully');
          onComplete();
        }
      });
      
      const result = await Promise.race([
        checkoutPromise,
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Checkout initialization timed out')), 10000)
        )
      ]);
      
      // Type guard to ensure we have a proper checkout object
      if (result && typeof result === 'object' && 'mount' in result && typeof result.mount === 'function') {
        this.embeddedCheckout = result as StripeEmbeddedCheckout;
        this.embeddedCheckout.mount(checkoutElement.nativeElement);
        console.log('Embedded checkout mounted successfully');
      } else {
        throw new Error('Invalid checkout object returned from Stripe');
      }
    } catch (error) {
      console.error('Error mounting embedded checkout:', error);
      throw error;
    }
  }

  /**
   * Process Flex payment
   */
  async processFlexPayment(agreementId: string): Promise<boolean> {
    try {
      console.log('User selected Flex payment');
      const success = await this.flexPaymentService.processPayment(agreementId);
      
      if (success) {
        console.log('Flex payment completed successfully');
      } else {
        console.log('Flex payment not completed - browser closed or payment failed');
      }
      
      return success;
    } catch (error) {
      console.error('Error processing Flex payment:', error);
      throw error;
    }
  }

  /**
   * Clean up Stripe resources
   */
  destroy(): void {
    if (this.embeddedCheckout) {
      try {
        this.embeddedCheckout.destroy();
      } catch (error) {
        console.error('Error destroying embedded checkout:', error);
      }
      this.embeddedCheckout = null;
    }
  }

  /**
   * Get the standard checkout URL as a fallback
   */
  async getStandardCheckoutUrl(sessionId: string): Promise<string | null> {
    try {
      // For Stripe checkout sessions, we can directly construct the URL
      if (sessionId && sessionId.startsWith('cs_')) {
        return `https://checkout.stripe.com/pay/${sessionId}`;
      }
      
      // Fallback to getting the URL from the service
      return await this.paymentService.getStandardCheckoutUrl(sessionId);
    } catch (error) {
      console.error('Error getting standard checkout URL:', error);
      return null;
    }
  }

  /**
   * Process successful payment - handles post-payment logic
   */
  async processSuccessfulPayment(
    checkoutSessionId: string,
    agreementId: string | null,
    agreement: Agreement | null,
    paymentAmount: number
  ): Promise<void> {
    try {
      console.log('Processing successful payment');
      
      // If we have a session ID but no agreement ID, try to get the agreement ID from the session
      if (checkoutSessionId && !agreementId) {
        try {
          // Check the payment status to get metadata
          const status = await this.paymentService.checkPaymentStatus(checkoutSessionId);
          console.log('Payment status:', status);
          
          // Try to extract the agreement ID from the session metadata
          // This would require your backend to return this information
          // For now, we'll try to navigate to the home page directly
          console.log('No agreement ID available, will navigate to home page');
          
          // Navigate to the home page with success message
          this.router.navigate(['/app/tabs/home'], { 
            state: { message: 'Payment successful! Your agreement is now complete.' }
          });
          return;
        } catch (error) {
          console.error('Error checking payment status:', error);
          // Navigate to home page as fallback
          this.router.navigate(['/app/tabs/home']);
          return;
        }
      }
      
      // Check if there's a pending signature to save
      let pendingSignatureJson: string | null = null;
      
      // Get signature data from the appropriate storage based on platform
      if (this.platform.is('ios')) {
        const { value } = await Preferences.get({ key: 'pendingSignature' });
        pendingSignatureJson = value;
      } else {
        pendingSignatureJson = localStorage.getItem('pendingSignature');
      }
      
      // Update the agreement payment info to mark as completed
      if (agreementId) {
        await this.agreementService.updateAgreementPaymentInfo(agreementId, { status: 'completed' });
        console.log('Agreement payment status updated to completed');
      } else {
        console.warn('No agreement ID available, skipping payment status update');
      }
      
      // If there's a pending signature, save it now that payment is complete
      if (pendingSignatureJson) {
        try {
          const pendingSignature = JSON.parse(pendingSignatureJson);
          console.log('Saving pending signature after successful payment:', pendingSignature);
          
          // Save the signature to the database
          const signatures = await this.agreementService.saveSignature(
            pendingSignature.agreementId,
            pendingSignature.fullName,
            pendingSignature.signerType
          );
          
          // Check if both parties have signed
          const bothSigned = signatures.trainer && signatures.client;
          
          // If both have signed, update the PDF with signatures
          if (bothSigned) {
            const agreementData = await this.agreementService.getAgreementById(pendingSignature.agreementId);
            if (agreementData && agreementData.agreementStoragePath) {
              const signedPdfPath = agreementData.agreementStoragePath.replace('.pdf', '_signed.pdf');
              await this.agreementService.saveSignedPdf(pendingSignature.agreementId, signedPdfPath);
            }
          }
          
          // Clear the pending signature from storage
          if (this.platform.is('ios')) {
            await Preferences.remove({ key: 'pendingSignature' });
          } else {
            localStorage.removeItem('pendingSignature');
          }
        } catch (error) {
          console.error('Error saving signature after payment:', error);
        }
      }
      
      // Track purchase event with Google Analytics (includes gclid for conversion tracking)
      await this.googleAnalyticsService.trackPurchase(
        checkoutSessionId || `payment_${Date.now()}`, // transaction ID
        paymentAmount, // value
        'USD', // currency
        [{
          item_id: 'training_agreement',
          item_name: 'Personal Training Agreement',
          category: 'fitness',
          quantity: 1,
          price: paymentAmount
        }]
      );
      
      // Get the chat ID from the agreement if available
      let chatId = '';
      if (agreement && agreement.chatId) {
        chatId = agreement.chatId;
      }
      
      // Navigate to the chat page with success message
      if (chatId) {
        // If we have a chat ID, navigate directly to that chat
        this.router.navigate(['/app/tabs/chats/chat', chatId], { 
          state: { message: 'Payment successful! Your agreement is now complete.' }
        });
      } else {
        // Otherwise navigate to the chats list
        this.router.navigate(['/app/tabs/chats'], { 
          state: { message: 'Payment successful! Your agreement is now complete.' }
        });
      }
    } catch (error) {
      console.error('Error processing successful payment:', error);
      // Even on error, try to navigate away from payment page
      this.router.navigate(['/app/tabs/home']);
      throw error;
    }
  }
}
