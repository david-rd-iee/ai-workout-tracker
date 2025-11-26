import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonToolbar, IonTitle, IonButton, IonSpinner } from '@ionic/angular/standalone';

@Component({
  selector: 'app-stripe-setup',
  templateUrl: './stripe-setup.page.html',
  styleUrls: ['./stripe-setup.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent, IonHeader, IonToolbar, IonTitle, IonButton, IonSpinner]
})
export class StripeSetupPage implements OnInit {
  isLoading = true;

  constructor(private router: Router) {}

  ngOnInit() {
    setTimeout(() => {
      this.isLoading = false;
    }, 1000);
  }

  goBack() {
    this.router.navigate(['/app/tabs/home']);
  }
}
