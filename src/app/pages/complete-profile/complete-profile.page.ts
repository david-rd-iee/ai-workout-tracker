import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonButton, IonCheckbox, IonContent, IonText } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '../../services/push-notifications.plugin';

@Component({
  selector: 'app-complete-profile',
  templateUrl: './complete-profile.page.html',
  styleUrls: ['./complete-profile.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonButton, IonCheckbox, IonContent, IonText],
})
export class CompleteProfilePage implements OnInit {
  private router = inject(Router);
  private auth = inject(Auth);
  private alertController = inject(AlertController);

  termsAccepted = false;
  errorMessage = '';
  private hasPromptedForNotifications = false;

  ngOnInit(): void {
    void this.ensureAuthenticated();
  }

  async onSubmit(): Promise<void> {
    this.errorMessage = '';

    if (!this.termsAccepted) {
      this.errorMessage = 'Please accept the Terms of Service to continue.';
      return;
    }

    await this.router.navigateByUrl('/complete-profile/client', { replaceUrl: true });
  }

  async onTermsAcceptedChange(): Promise<void> {
    if (this.termsAccepted && !this.hasPromptedForNotifications) {
      this.hasPromptedForNotifications = true;
      await this.checkAndPromptForPushNotifications();
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    const uid = await this.resolveCurrentUid();
    if (!uid) {
      await this.router.navigateByUrl('/login', { replaceUrl: true });
    }
  }

  private async checkAndPromptForPushNotifications(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    try {
      const permission = await PushNotifications.checkPermissions();
      if (permission.receive !== 'granted') {
        await this.promptForPushNotifications();
      }
    } catch (error) {
      console.error('Error checking push notification permissions:', error);
      await this.promptForPushNotifications();
    }
  }

  private async promptForPushNotifications(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Stay Connected with Your Trainer',
      message:
        'Push notifications help you hear back quickly about sessions, messages, and important updates.',
      buttons: [
        {
          text: 'Not Now',
          role: 'cancel',
          cssClass: 'secondary',
        },
        {
          text: 'Enable Notifications',
          handler: () => {
            void this.requestPushNotificationPermission();
          },
        },
      ],
    });

    await alert.present();
  }

  private async requestPushNotificationPermission(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    try {
      const permission = await PushNotifications.requestPermissions();
      if (permission.receive === 'granted') {
        await PushNotifications.register();
      }
    } catch (error) {
      console.error('Error requesting push notification permission:', error);
    }
  }

  private async resolveCurrentUid(): Promise<string | null> {
    if (this.auth.currentUser?.uid) {
      return this.auth.currentUser.uid;
    }

    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(this.auth, (user) => {
        unsubscribe();
        resolve(user?.uid ?? null);
      });
    });
  }
}
