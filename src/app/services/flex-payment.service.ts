import { Injectable, inject } from '@angular/core';
import { Browser } from '@capacitor/browser';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Observable, filter, map, take, timeout } from 'rxjs';

export interface PaymentStatus {
  status: 'pending' | 'completed' | 'failed' | 'expired';
  paidAt?: any;
  paymentAmount?: number;
}

@Injectable({
  providedIn: 'root'
})
export class FlexPaymentService {
  private functions = inject(Functions);
  private firestore = inject(Firestore);

  /**
   * Create Flex checkout session and return the URL
   */
  async createCheckoutSession(agreementId: string): Promise<{ redirect_url: string; checkout_session_id: string }> {
    const createCheckout = httpsCallable(this.functions, 'createFlexCheckoutSession');
    const result = await createCheckout({ agreementId }) as any;

    if (!result.data.success || !result.data.redirect_url) {
      throw new Error('Failed to create checkout session');
    }

    return {
      redirect_url: result.data.redirect_url,
      checkout_session_id: result.data.checkout_session_id
    };
  }

  /**
   * Watch payment status in real-time via Firestore (updated by webhook)
   */
  watchPaymentStatus(agreementId: string): Observable<PaymentStatus> {
    const agreementRef = doc(this.firestore, `agreements/${agreementId}`);
    
    return docData(agreementRef).pipe(
      map(data => ({
        status: data?.['paymentStatus'] || 'pending',
        paidAt: data?.['paidAt'],
        paymentAmount: data?.['paymentAmount']
      }))
    );
  }

  /**
   * Open checkout in in-app browser and wait for completion
   * Uses WebSocket connection via Firestore to detect when webhook updates payment status
   * Detects browser close events to handle user cancellation gracefully
   */
  async processPayment(agreementId: string): Promise<boolean> {
    let browserCloseListener: any = null;
    let paymentStatusSubscription: any = null;
    
    try {
      // 1. Create checkout session
      const { redirect_url } = await this.createCheckoutSession(agreementId);

      // 2. Start watching for payment completion (WebSocket via Firestore)
      const paymentComplete = new Promise<boolean>((resolve, reject) => {
        paymentStatusSubscription = this.watchPaymentStatus(agreementId)
          .pipe(
            filter(status => status.status !== 'pending'),
            take(1),
            timeout(600000) // 10 minute timeout
          )
          .subscribe({
            next: (status) => {
              console.log('Payment status updated:', status);
              resolve(status.status === 'completed');
            },
            error: (err) => {
              console.error('Payment status error:', err);
              reject(err);
            }
          });
      });

      // 3. Listen for browser close/finish events
      const browserClosed = new Promise<boolean>((resolve) => {
        browserCloseListener = Browser.addListener('browserFinished', () => {
          console.log('Browser closed by user');
          resolve(false); // Browser closed = payment not completed
        });
      });

      // 4. Open browser
      await Browser.open({
        url: redirect_url,
        presentationStyle: 'popover',
        toolbarColor: '#000000'
      });

      // 5. Wait for either payment completion OR browser close (whichever happens first)
      const success = await Promise.race([paymentComplete, browserClosed]);

      // 6. Clean up
      if (browserCloseListener) {
        browserCloseListener.remove();
      }
      
      if (paymentStatusSubscription) {
        paymentStatusSubscription.unsubscribe();
      }

      // 7. Close browser if still open
      try {
        await Browser.close();
      } catch (e) {
        // Browser might already be closed, ignore error
      }

      return success;

    } catch (error) {
      console.error('Payment error:', error);
      
      // Clean up listeners
      if (browserCloseListener) {
        try {
          browserCloseListener.remove();
        } catch (e) {
          console.error('Error removing browser listener:', e);
        }
      }
      
      if (paymentStatusSubscription) {
        paymentStatusSubscription.unsubscribe();
      }
      
      // Try to close browser
      try {
        await Browser.close();
      } catch (e) {
        // Browser might already be closed, ignore error
      }
      
      return false;
    }
  }
}
