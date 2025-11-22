import { Component, Input, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { IonItem, IonLabel, IonIcon, IonAvatar, IonBadge, IonNote, IonCard, IonCardContent } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { cashOutline, personOutline, calendarOutline, documentTextOutline } from 'ionicons/icons';
import { Transaction } from '../../services/stripe/transaction.service';

@Component({
  selector: 'app-payment-received-item',
  templateUrl: './payment-received-item.component.html',
  styleUrls: ['./payment-received-item.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonItem,
    IonLabel,
    IonIcon,
    IonAvatar,
    IonBadge,
    IonNote,
    IonCard,
    IonCardContent,
    DatePipe
  ]
})
export class PaymentReceivedItemComponent implements OnInit {
  @Input() transaction!: Transaction;
  @Input() showClientName: boolean = true;
  @Input() showAgreementId: boolean = false;
  @Input() clickable: boolean = false;

  constructor() {
    addIcons({
      cashOutline,
      personOutline,
      calendarOutline,
      documentTextOutline
    });
  }

  ngOnInit() {
    // Ensure transaction has all required fields
    if (!this.transaction) {
      console.error('Transaction is required for payment-received-item component');
    }
  }

  /**
   * Format the amount as currency
   */
  formatAmount(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }

  /**
   * Get a shortened version of the agreement ID
   */
  getShortenedAgreementId(agreementId: string): string {
    if (!agreementId) return '';
    if (agreementId.length <= 8) return agreementId;
    return agreementId.substring(0, 8) + '...';
  }
}
