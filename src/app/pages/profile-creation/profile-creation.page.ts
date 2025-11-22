import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonContent, IonHeader, IonLabel, IonSelect, IonSelectOption, IonTitle, IonToolbar, IonCheckbox, AlertController } from '@ionic/angular/standalone';
import { Router,RouterModule } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

@Component({
  selector: 'app-profile-creation',
  templateUrl: './profile-creation.page.html',
  styleUrls: ['./profile-creation.page.scss'],
  standalone: true,
  imports: [
    IonContent, 
    IonHeader, 
    IonTitle, 
    IonToolbar, 
    CommonModule, 
    FormsModule, 
    IonButton,
    IonLabel,
    IonCheckbox
  ]
})
export class ProfileCreationPage implements OnInit {
  termsAccepted: boolean = false;
  private hasPromptedForNotifications: boolean = false;

  constructor(private router: Router, private alertController: AlertController) { 
  }

  ngOnInit() {
  }

  async onTermsAcceptedChange() {
    if (this.termsAccepted && !this.hasPromptedForNotifications) {
      this.hasPromptedForNotifications = true;
      await this.checkAndPromptForPushNotifications();
    }
  }

  private async checkAndPromptForPushNotifications() {
    if (Capacitor.isNativePlatform()) {
      try {
        // Check current permission status
        const permission = await PushNotifications.checkPermissions();
        
        // Only prompt if notifications are not granted
        if (permission.receive !== 'granted') {
          await this.promptForPushNotifications();
        }
      } catch (error) {
        console.error('Error checking push notification permissions:', error);
        // If we can't check permissions, show the prompt anyway
        await this.promptForPushNotifications();
      }
    }
    // For web platform, we don't prompt since push notifications aren't typically available
  }

  private async promptForPushNotifications() {
    const alert = await this.alertController.create({
      header: 'Stay Connected with Your Trainer',
      message: 'Push notifications are vital so you can hear back from your trainer quickly. Get instant updates about sessions, messages, and important announcements.',
      buttons: [
        {
          text: 'Not Now',
          role: 'cancel',
          cssClass: 'secondary'
        },
        {
          text: 'Enable Notifications',
          handler: () => {
            this.requestPushNotificationPermission();
          }
        }
      ]
    });

    await alert.present();
  }

  private async requestPushNotificationPermission() {
    if (Capacitor.isNativePlatform()) {
      try {
        const permission = await PushNotifications.requestPermissions();
        
        if (permission.receive === 'granted') {
          // Register for push notifications
          await PushNotifications.register();
        } else {
          console.log('Push notification permission denied');
        }
      } catch (error) {
        console.error('Error requesting push notification permission:', error);
      }
    } 
  }

  navigateTo(type: string) {
    this.router.navigate([`/profile-creation/${type}`]);
  }
}
