import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonIcon,
  IonSpinner
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircleOutline } from 'ionicons/icons';
import { PaymentService } from '../../../services/stripe/payment.service';
import { ROUTE_PATHS } from 'src/app/app.routes';

@Component({
  selector: 'app-payment-success',
  templateUrl: './payment-success.component.html',
  styleUrls: ['./payment-success.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IonButton,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonIcon,
    IonSpinner
  ]
})
export class PaymentSuccessComponent implements OnInit {
  loading = true;
  paymentStatus = '';
  @Input() sessionId = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private paymentService: PaymentService
  ) {
    addIcons({ checkmarkCircleOutline });
  }

  async ngOnInit() {
    // If sessionId is provided as an input, use it directly
    // Otherwise, try to get it from URL query params
    if (!this.sessionId) {
      this.route.queryParams.subscribe(async (params) => {
        this.sessionId = params['session_id'];
      });
    }
    
    if (this.sessionId) {
      try {
        // Check payment status in Firestore
        this.paymentStatus = await this.paymentService.checkPaymentStatus(this.sessionId);
      } catch (error) {
        console.error('Error checking payment status:', error);
        this.paymentStatus = 'error';
      } finally {
        this.loading = false;
      }
    } else {
      this.loading = false;
      this.paymentStatus = 'unknown';
    }
  }

  goToAgreements() {
    this.router.navigate(['/tabs/service-agreements']);
  }

  goToHome() {
    this.router.navigate([ROUTE_PATHS.APP.TABS.HOME]);
  }
}
