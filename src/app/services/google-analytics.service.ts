import { Injectable, inject } from '@angular/core';
import { Analytics, logEvent } from '@angular/fire/analytics';
import { UserService } from './account/user.service';
import { AccountService } from './account/account.service';

@Injectable({
  providedIn: 'root'
})
export class GoogleAnalyticsService {
    private analytics: Analytics = inject(Analytics);
    private userService = inject(UserService);
    private accountService = inject(AccountService);

  constructor() {
  }

  async trackPurchase(transactionId: string, value: number, currency: string = 'USD', items: any[] = []): Promise<void> {
    if (!this.analytics) {
      console.error('Analytics not initialized');
      return;
    }

    try {
      const gclid = await this.getUserGclid();
      
      const purchaseData: any = {
        transaction_id: transactionId,
        value: value,
        currency: currency,
        items: items
      };

      if (gclid) {
        purchaseData.gclid = gclid;
      }

      logEvent(this.analytics, 'in_app_purchase', purchaseData);
    } catch (error) {
      console.error('Error tracking purchase:', error);
    }
  }

  private async getUserGclid(): Promise<string | null> {
    try {
      const userInfo = this.userService.getUserInfo()();
      if (userInfo && userInfo.gclid) {
        return userInfo.gclid;
      }
      return null;
    } catch (error) {
      console.error('Error getting user gclid:', error);
      return null;
    }
  }

  async fireTestPurchaseEvent(): Promise<void> {
    if (!this.analytics) {
      console.error('Analytics not initialized');
      return;
    }

    try {
      logEvent(this.analytics, 'test_event');
      
      await this.trackPurchase(
        `test_${Date.now()}`,
        75.00,
        'USD',
        [{
          item_id: 'training_session',
          item_name: 'Personal Training Session',
          category: 'fitness',
          quantity: 1,
          price: 75.00
        }]
      );
      
    } catch (error) {
      console.error('Error sending events:', error);
    }
  }
}