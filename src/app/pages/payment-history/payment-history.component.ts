import { Component, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { HeaderComponent } from '../../components/header/header.component';
import { Browser } from '@capacitor/browser';

@Component({
  selector: 'app-payment-history',
  templateUrl: './payment-history.component.html',
  styleUrls: ['./payment-history.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, HeaderComponent]
})
export class PaymentHistoryComponent implements OnInit {

  constructor() { }

  ngOnInit() {}

  async openBillingPortal() {
    await Browser.open({
      url: 'https://billing.stripe.com/p/login/14AeVef44fVT3o56kxcIE00'
    });
  }

}
