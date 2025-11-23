import { Injectable } from '@angular/core';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { environment } from '../../../environments/environment';
import { AgreementService } from '../agreement.service';
import { Environment } from '../../Interfaces/environment.interface';
import { Agreement } from '../../Interfaces/Agreement';
import { Functions, httpsCallable, getFunctions } from '@angular/fire/functions';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { ROUTE_PATHS } from '../../app.routes';

interface ServiceOption {
  text: string;
  value: string;
  placeholder?: string;
}

@Injectable({
  providedIn: 'root'
})
export class PaymentService {
  private stripe: Stripe | null = null;
  private paymentStatusSubject = new BehaviorSubject<string>('');
  public paymentStatus$ = this.paymentStatusSubject.asObservable();

  constructor(
    private agreementService: AgreementService,
    private functions: Functions,
    private router: Router
  ) {
    this.initStripe();
  }

  private async initStripe() {
    this.stripe = await loadStripe((environment as Environment).stripePublicKey);
  }
  
  /**
   * Get the Stripe public key from environment
   * @returns The Stripe public key
   */
  getStripePublicKey(): string {
    return (environment as Environment).stripePublicKey;
  }

  async calculateAgreementTotal(agreementId: string): Promise<number> {
    console.log('Calculating agreement total for agreement ID:', agreementId);
    
    if (!agreementId) {
      console.error('No agreement ID provided to calculateAgreementTotal');
      return 0;
    }
    
    const agreement = await this.agreementService.getAgreementById(agreementId);
    console.log('Agreement data in calculateAgreementTotal:', JSON.stringify(agreement));
    
    if (!agreement) {
      console.error('Agreement not found for ID:', agreementId);
      return 0;
    }
    
    // Get services from the simplified agreementData structure
    const services = agreement?.agreementData?.services || [];
    
    console.log('Services found:', JSON.stringify(services));
    
    let total = 0;
    
    // Process services array if it exists
    for (const service of services) {
      // Get the selected service options from the service
      const serviceOptions = service.selectedServiceOptions || [];
      console.log('Service options for service:', JSON.stringify(serviceOptions));
      
      // Find the price option - this is the only value that matters for payment
      // Look for both 'Price of Service' and 'Total Price of Service' for compatibility
      const priceOption = serviceOptions.find((opt: ServiceOption) => 
        opt.text === 'Price of Service' || opt.text === 'Total Price of Service');
      console.log('Price option found:', priceOption);
      
      if (priceOption?.value) {
        // Extract numeric value from the price string (removing currency symbols, commas, etc.)
        const priceString = priceOption.value.toString();
        console.log('Raw price string:', priceString);
        
        // Extract the price - handle formats like "$100", "100 USD", "$100.00", etc.
        const priceMatch = priceString.match(/\$?\s*(\d+(?:\.\d+)?)/);
        const price = priceMatch ? parseFloat(priceMatch[1]) : parseFloat(priceString.replace(/[^0-9.]/g, ''));
        
        console.log('Extracted price:', price);
        
        if (!isNaN(price)) {
          // Only add to total if we have a valid price
          total += price;
          console.log('Running total after adding service price:', total);
        } else {
          console.error('Could not parse price from:', priceString);
        }
      } else {
        console.log('No Price of Service option found for this service');
      }
    }
    
    console.log('Final calculated total:', total);
    
    // Ensure we return a valid number
    if (isNaN(total) || total <= 0) {
      console.warn('Calculated total is invalid, zero, or negative - using default amount');
      return 1; // Minimum amount for testing (1 dollar)
    }
    
    return total;
  }

  /**
   * Initiate the payment process for an agreement
   * This now uses the in-app payment flow instead of redirecting to Stripe Checkout
   * @param agreementId The agreement ID to process payment for
   * @param successPath The path to redirect to on success
   * @param cancelPath The path to redirect to on cancel
   */
  async initiatePayment(agreementId: string, successPath: string = ROUTE_PATHS.PAYMENT.SUCCESS, cancelPath: string = ROUTE_PATHS.PAYMENT.CANCEL): Promise<void> {
    if (!this.stripe) {
      throw new Error('Stripe not initialized');
    }

    try {
      this.paymentStatusSubject.next('processing');
      
      // Instead of redirecting to Stripe Checkout, navigate to our in-app payment page
      // The payment page will handle the Stripe Elements integration
      const router = window.document.querySelector('ion-router');
      if (router) {
        // Use the Ionic router to navigate to the payment page
        router.push(ROUTE_PATHS.PAYMENT.PROCESS(agreementId));
      } else {
        // Fallback to window.location if Ionic router is not available
        window.location.href = ROUTE_PATHS.PAYMENT.PROCESS(agreementId);
      }
      
    } catch (error) {
      this.paymentStatusSubject.next('error');
      console.error('Payment initiation error:', error);
      throw error;
    }
  }

  
  /**
   * Create a payment intent for in-app payment processing
   * @param agreementId The agreement ID
   * @param amount The payment amount
   * @returns A promise that resolves to the payment intent with client secret
   */
  async createPaymentIntent(agreementId: string, amount: number): Promise<{ clientSecret: string }> {
    try {
      this.paymentStatusSubject.next('processing');
      
      // Check if we're running in a browser environment for testing
      const isBrowserTesting = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      
      if (isBrowserTesting) {
        // For browser testing, create a mock client secret
        console.log('BROWSER TESTING MODE: Creating mock payment intent');
        const mockClientSecret = 'pi_mock_' + Date.now() + '_secret_mock_' + Math.random().toString(36).substring(2, 15);
        
        // Store the mock payment intent in the agreement for tracking
        try {
          // Update the agreement with a mock payment intent ID
          // Note: You'll need to add this method to your AgreementService
          await this.agreementService.updateAgreementPaymentInfo(agreementId, {
            payment_intent_id: 'pi_mock_' + Date.now(),
            payment_status: 'requires_payment_method'
          });
          console.log('Updated agreement with mock payment intent');
        } catch (dbError) {
          console.error('Error updating agreement with mock payment intent:', dbError);
        }
        
        // Return the mock client secret
        return { clientSecret: mockClientSecret };
      }
      
      // For production or native app, use Firebase Functions SDK
      console.log('Using Firebase Functions SDK to create payment intent');
      const functionsInstance = getFunctions(undefined, 'us-west1');
      const createPaymentIntentFn = httpsCallable(functionsInstance, 'createPaymentIntent');
      
      // Prepare the data object with all required parameters
      const paymentData = {
        agreementId,
        amount
      };
      
      // Log the exact data being sent to the function
      console.log('Calling createPaymentIntent with data:', JSON.stringify(paymentData));
      
      // Call the function with the required parameters
      const response = await createPaymentIntentFn(paymentData);
      
      // Log the full response for debugging
      console.log('Raw response from createPaymentIntent:', JSON.stringify(response));
      
      // The data property contains the actual response from the function
      if (!response || !response.data) {
        throw new Error('Invalid response from payment intent function');
      }
      
      const result = response.data as { clientSecret?: string, error?: { message: string } };
      
      // Check for errors in the response
      if (result.error) {
        this.paymentStatusSubject.next('error');
        throw new Error(result.error.message);
      }
      
      // Validate the clientSecret is present
      if (!result.clientSecret) {
        this.paymentStatusSubject.next('error');
        throw new Error('No client secret returned from payment intent function');
      }
      
      return { clientSecret: result.clientSecret };
      
    } catch (error) {
      this.paymentStatusSubject.next('error');
      console.error('Payment intent creation error:', error);
      throw error;
    }
  }
  
  /**
   * Create a Checkout Session for embedded checkout form
   * @param agreementId The agreement ID
   * @param amount The payment amount
   * @returns A promise that resolves to the Checkout Session with sessionId and clientSecret
   */
  async createCheckoutSession(agreementId: string, amount: number): Promise<{ sessionId: string, clientSecret: string }> {
    try {
      this.paymentStatusSubject.next('processing');
      
      console.log('Using Firebase Functions for checkout session');
      
      // Get the Firebase Functions instance with the correct region
      // Make sure to specify the region that matches your function configuration
      const regionalFunctions = getFunctions(undefined, 'us-west1');
      
      // Use httpsCallable which handles CORS automatically for onCall functions
      console.log('Creating checkout session using Firebase Functions');
      const createCheckoutSessionFn = httpsCallable(regionalFunctions, 'createCheckoutSession');
      
      // Prepare the data object with all required parameters
      // For embedded checkout, we don't need success_url and cancel_url
      const checkoutData = {
        agreementId,
        amount
      };
      
      // Log the exact data being sent to the function
      console.log('Calling createCheckoutSession with data:', JSON.stringify(checkoutData));
      
      // Call the function with the required parameters
      const response = await createCheckoutSessionFn(checkoutData);
      
      // Log the full response for debugging
      console.log('Raw response from createCheckoutSession:', JSON.stringify(response));
      
      // The data property contains the actual response from the function
      if (!response || !response.data) {
        throw new Error('Invalid response from checkout session function');
      }
      
      const result = response.data as { sessionId?: string, clientSecret?: string, error?: { message: string } };
      
      // Check for errors in the response
      if (result.error) {
        this.paymentStatusSubject.next('error');
        throw new Error(result.error.message);
      }
      
      // Validate the sessionId and clientSecret are present
      if (!result.sessionId || !result.clientSecret) {
        this.paymentStatusSubject.next('error');
        throw new Error('Missing session ID or client secret from checkout function');
      }
      
      // Return sessionId and clientSecret for embedded checkout
      return { sessionId: result.sessionId, clientSecret: result.clientSecret };
      
    } catch (error) {
      this.paymentStatusSubject.next('error');
      console.error('Checkout session creation error:', error);
      throw error;
    }
  }
  
  /**
   * Get the URL for standard Stripe checkout as a fallback
   * @param sessionId The Stripe checkout session ID
   * @returns Promise with the checkout URL or null if not available
   */
  async getStandardCheckoutUrl(sessionId: string): Promise<string | null> {
    try {
      console.log('Getting standard checkout URL for session:', sessionId);
      
      // For testing environments, construct a direct URL to Stripe checkout
      if (sessionId.startsWith('mock_session_')) {
        return null; // No fallback for mock sessions
      }
      
      // Construct a direct URL to Stripe checkout
      // This is a fallback mechanism when embedded checkout fails
      return `https://checkout.stripe.com/pay/${sessionId}`;
    } catch (error) {
      console.error('Error getting standard checkout URL:', error);
      return null;
    }
  }

  /**
   * Check the status of a payment by session ID
   * @param sessionId The Stripe checkout session ID
   */
  async checkPaymentStatus(sessionId: string): Promise<string> {
    try {
      // Check if we're running in a browser environment for testing
      const isBrowserTesting = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      
      if (isBrowserTesting && sessionId.startsWith('mock_session_')) {
        // For browser testing with a mock session ID, simulate a successful payment
        console.log('BROWSER TESTING MODE: Simulating payment status check for mock session');
        
        // Simulate a delay to make it feel more realistic
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Return a successful status
        const status = 'succeeded';
        this.paymentStatusSubject.next(status);
        return status;
      }
      
      // For production or real session IDs, get agreement by session ID
      console.log('Checking payment status for session ID:', sessionId);
      const agreementsSnapshot = await this.agreementService.getAgreementByCheckoutSessionId(sessionId);
      
      if (agreementsSnapshot && agreementsSnapshot.length > 0) {
        const agreement = agreementsSnapshot[0];
        const status = agreement.payment_status || 'unknown';
        this.paymentStatusSubject.next(status);
        return status;
      }
      
      // If no agreement found, try Firebase Functions as a fallback
      if (!isBrowserTesting) {
        try {
          console.log('Checking payment status with Firebase Functions');
          const functionsInstance = getFunctions(undefined, 'us-west1');
          const checkPaymentStatus = httpsCallable(functionsInstance, 'checkPaymentStatus');
          const response = await checkPaymentStatus({ sessionId });
          
          const result = response.data as { status: string, error?: { message: string } };
          if (result.error) {
            console.error('Error checking payment status:', result.error);
            this.paymentStatusSubject.next('error');
            return 'error';
          }
          
          const status = result.status || 'unknown';
          this.paymentStatusSubject.next(status);
          return status;
        } catch (functionError) {
          console.error('Error calling checkPaymentStatus function:', functionError);
        }
      }
      
      this.paymentStatusSubject.next('unknown');
      return 'unknown';
    } catch (error) {
      console.error('Error checking payment status:', error);
      this.paymentStatusSubject.next('error');
      return 'error';
    }
  }

  /**
   * Create a Stripe Connect account for the current user
   * @returns An Observable that resolves to the account ID
   */
  createConnectAccount(): Observable<{ account: string }> {
    try {
      console.log('Creating Stripe Connect account using Firebase Functions');
      
      // Get the Firebase Functions instance with the correct region
      const regionalFunctions = getFunctions(undefined, 'us-west1');
      
      // Use httpsCallable which handles CORS automatically for onCall functions
      const createConnectAccountFn = httpsCallable(regionalFunctions, 'createConnectAccount');
      
      // Call the function and map the response
      return from(createConnectAccountFn()).pipe(
        map(response => {
          if (!response || !response.data) {
            throw new Error('Invalid response from createConnectAccount function');
          }
          
          const result = response.data as { account?: string, error?: { message: string } };
          
          // Check for errors in the response
          if (result.error) {
            throw new Error(result.error.message);
          }
          
          // Validate the account ID is present
          if (!result.account) {
            throw new Error('No account ID returned from createConnectAccount function');
          }
          
          return { account: result.account };
        })
      );
    } catch (error) {
      console.error('Error creating Stripe Connect account:', error);
      throw error;
    }
  }

  /**
   * Create an account session for Stripe Connect onboarding or dashboard access
   * @param accountId The Stripe Connect account ID
   * @returns An Observable that resolves to the client secret for the account session
   */
  createAccountSession(accountId: string): Observable<{ client_secret: string }> {
    try {
      console.log('Creating account session using Firebase Functions');
      
      // Get the Firebase Functions instance with the correct region
      const regionalFunctions = getFunctions(undefined, 'us-west1');
      
      // Use httpsCallable which handles CORS automatically for onCall functions
      const createAccountSessionFn = httpsCallable(regionalFunctions, 'createAccountSession');
      
      // Prepare the data object with the account ID
      const sessionData = { accountId };
      
      // Log the exact data being sent to the function
      console.log('Calling createAccountSession with data:', JSON.stringify(sessionData));
      
      // Call the function and map the response
      return from(createAccountSessionFn(sessionData)).pipe(
        map(response => {
          if (!response || !response.data) {
            throw new Error('Invalid response from createAccountSession function');
          }
          
          const result = response.data as { client_secret?: string, error?: { message: string } };
          
          // Check for errors in the response
          if (result.error) {
            throw new Error(result.error.message);
          }
          
          // Validate the client secret is present
          if (!result.client_secret) {
            throw new Error('No client secret returned from createAccountSession function');
          }
          
          return { client_secret: result.client_secret };
        })
      );
    } catch (error) {
      console.error('Error creating account session:', error);
      throw error;
    }
  }
}
