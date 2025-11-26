import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
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
  IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeCircleOutline } from 'ionicons/icons';

@Component({
  selector: 'app-payment-cancel',
  templateUrl: './payment-cancel.component.html',
  styleUrls: ['./payment-cancel.component.scss'],
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
    IonIcon
  ]
})
export class PaymentCancelComponent {
  constructor(private router: Router) {
    addIcons({ closeCircleOutline });
  }

  goToAgreements() {
    this.router.navigate(['/tabs/service-agreements']);
  }

  tryAgain() {
    // Navigate back to the agreements page
    this.router.navigate(['/tabs/service-agreements']);
  }
}
