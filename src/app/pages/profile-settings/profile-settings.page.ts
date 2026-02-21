import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavController } from '@ionic/angular';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBackOutline } from 'ionicons/icons';

@Component({
  selector: 'app-profile-settings',
  templateUrl: './profile-settings.page.html',
  styleUrls: ['./profile-settings.page.scss'],
  standalone: true,
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    CommonModule,
  ],
})
export class ProfileSettingsPage {
  constructor(private navCtrl: NavController) {
    addIcons({ arrowBackOutline });
  }

  goBack(): void {
    this.navCtrl.navigateBack('/profile-user', {
      animated: true,
      animationDirection: 'back',
    });
  }
}
