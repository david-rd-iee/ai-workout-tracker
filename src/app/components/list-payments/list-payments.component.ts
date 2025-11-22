import { Component, Input, OnInit, OnChanges } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { IonAvatar, IonIcon, IonBadge, IonSkeletonText } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { calendarOutline, cashOutline, personOutline, documentTextOutline } from 'ionicons/icons';
import { Router } from '@angular/router';
import { Transaction } from '../../services/stripe/transaction.service';
import { UserService } from '../../services/account/user.service';
import { trainerProfile } from '../../Interfaces/Profiles/Trainer';
import { clientProfile } from '../../Interfaces/Profiles/Client';

export interface PaymentData extends Transaction {
  otherPartyName?: string;
  otherPartyImage?: string;
  otherPartyType?: string;
  isProfileLoading?: boolean;
}

@Component({
  selector: 'app-list-payments',
  templateUrl: './list-payments.component.html',
  styleUrls: ['./list-payments.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonAvatar,
    IonIcon,
    IonBadge,
    IonSkeletonText,
    DatePipe
  ]
})
export class ListPaymentsComponent implements OnInit, OnChanges {
  @Input() payments: Transaction[] = [];
  @Input() isLoading: boolean = false;
  @Input() noPaymentsFound: boolean = false;
  @Input() userType: 'trainer' | 'client' = 'trainer';
  
  // Cache for user profiles to avoid redundant calls
  private profileCache: { [key: string]: trainerProfile | clientProfile } = {};
  
  // Processed payments after any transformations
  processedPayments: PaymentData[] = [];

  constructor(
    private router: Router,
    private userService: UserService
  ) { 
    addIcons({
      calendarOutline,
      cashOutline,
      personOutline,
      documentTextOutline
    });
  }

  ngOnInit() {
    // No initialization needed - we'll process payments when they change
  }
  
  // Store previous payments to avoid duplicate processing
  private previousPayments: string = '';
  
  ngOnChanges() {
    if (this.payments && this.payments.length > 0) {
      // Create a hash of the current payments to compare with previous
      const paymentsHash = JSON.stringify(this.payments.map(p => p.paymentId));
      
      // Only process if the payments have changed
      if (paymentsHash !== this.previousPayments) {
        this.previousPayments = paymentsHash;
        this.processPayments();
      }
    } else {
      this.processedPayments = [];
    }
  }

  /**
   * Process the input payments: standardize and prepare for display
   */
  private processPayments() {
    // Clear profile cache when processing new payments to avoid stale data
    this.profileCache = {};
    
    // Create a copy of the payments with additional display properties
    const processedPayments = this.payments.map(payment => {
      const paymentData: PaymentData = {
        ...payment,
        isProfileLoading: true
      };
      
      // Set default values that will be shown while loading
      if (this.userType === 'trainer') {
        paymentData.otherPartyName = payment.clientName || 'Your Client';
        paymentData.otherPartyImage = payment.clientProfileImage || '';
        paymentData.otherPartyType = 'Client';
      } else {
        // For clients viewing their payments to trainers
        paymentData.otherPartyName = 'Your Trainer';
        paymentData.otherPartyType = 'Trainer';
      }
      
      return paymentData;
    });
    
    // Update the processed payments
    this.processedPayments = processedPayments;
    
    // Now fetch any missing profiles in the background and update UI as they load
    if (processedPayments.length > 0) {
      // Use setTimeout to allow the UI to render first
      setTimeout(() => {
        for (const payment of this.processedPayments) {
          if (this.userType === 'trainer' && !payment.clientName) {
            // Trainer viewing payments - fetch client profiles if not already loaded
            this.fetchClientProfile(payment);
          } else if (this.userType === 'client') {
            // Client viewing payments - fetch trainer profiles
            this.fetchTrainerProfile(payment);
          } else {
            // Profile already loaded
            payment.isProfileLoading = false;
          }
        }
      }, 100);
    }
  }
  
  /**
   * Fetch trainer profile for a payment
   */
  private async fetchTrainerProfile(payment: PaymentData) {
    if (!payment.trainerId) {
      payment.isProfileLoading = false;
      return;
    }
    
    // Check cache first
    const cacheKey = `trainer_${payment.trainerId}`;
    if (this.profileCache[cacheKey]) {
      this.updatePaymentWithTrainerProfile(payment, this.profileCache[cacheKey]);
      return;
    }
    
    try {
      // Use direct method instead of signal + polling
      const profile = await this.userService.getUserProfileDirectly(payment.trainerId, 'trainer');
      if (profile) {
        // Cache the profile
        this.profileCache[cacheKey] = profile;
        this.updatePaymentWithTrainerProfile(payment, profile);
      } else {
        payment.isProfileLoading = false;
      }
    } catch (error) {
      console.error('Error fetching trainer profile:', error);
      payment.isProfileLoading = false;
    }
  }
  
  /**
   * Update payment with trainer profile info
   */
  private updatePaymentWithTrainerProfile(payment: PaymentData, profile: trainerProfile | clientProfile) {
    payment.otherPartyName = `${profile.firstName} ${profile.lastName}`;
    payment.otherPartyImage = profile.profileImage || '';
    payment.otherPartyType = 'Trainer';
    payment.isProfileLoading = false;
  }
  
  /**
   * Fetch client profile for a payment
   */
  private async fetchClientProfile(payment: PaymentData) {
    if (!payment.clientId) {
      payment.isProfileLoading = false;
      return;
    }
    
    // If we already have the client name, no need to fetch again
    if (payment.clientName) {
      payment.isProfileLoading = false;
      return;
    }
    
    // Check cache first
    const cacheKey = `client_${payment.clientId}`;
    if (this.profileCache[cacheKey]) {
      this.updatePaymentWithClientProfile(payment, this.profileCache[cacheKey]);
      return;
    }
    
    try {
      // Use direct method instead of signal + polling
      const profile = await this.userService.getUserProfileDirectly(payment.clientId, 'client');
      if (profile) {
        // Cache the profile
        this.profileCache[cacheKey] = profile;
        this.updatePaymentWithClientProfile(payment, profile);
      } else {
        payment.isProfileLoading = false;
      }
    } catch (error) {
      console.error('Error fetching client profile:', error);
      payment.isProfileLoading = false;
    }
  }
  
  /**
   * Update payment with client profile info
   */
  private updatePaymentWithClientProfile(payment: PaymentData, profile: trainerProfile | clientProfile) {
    payment.otherPartyName = `${profile.firstName} ${profile.lastName}`;
    payment.otherPartyImage = profile.profileImage || '';
    payment.otherPartyType = 'Client';
    payment.isProfileLoading = false;
  }
  
  /**
   * Format currency amount
   */
  formatAmount(amount: number): string {
    if (typeof amount !== 'number') return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount / 100); // Assuming amount is in cents
  }
  
  /**
   * Get shortened version of agreement ID
   */
  getShortenedAgreementId(agreementId: string): string {
    if (!agreementId) return 'Unknown';
    if (agreementId.length <= 8) return agreementId;
    return agreementId.substring(0, 8) + '...';
  }
  
  /**
   * Navigate to payment details
   */
  viewPaymentDetails(payment: PaymentData) {
    if (!payment || !payment.agreementId) {
      console.error('Payment or agreement ID is missing');
      return;
    }
    
    // Navigate to the agreement details page
    this.router.navigate(['/app/tabs/agreements', payment.agreementId]);
  }
}
