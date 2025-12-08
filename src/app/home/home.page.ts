import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [IonicModule, CommonModule],
})
export class HomePage {
  constructor(private auth: Auth) {
    this.devAutoLogin();
  }

  private async devAutoLogin() {
    try {
      const cred = await signInWithEmailAndPassword(
        this.auth,
        'fake.user.low@demo.com',
        'Test1234!' // whatever you set in console
      );
      console.log('✅ Dev auto-login success:', cred.user.uid);
    } catch (err) {
      console.error('❌ Dev auto-login failed:', err);
    }
  }
}
