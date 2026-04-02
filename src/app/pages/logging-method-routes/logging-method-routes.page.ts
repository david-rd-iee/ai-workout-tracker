import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonButton, IonContent } from '@ionic/angular/standalone';
import { NavController } from '@ionic/angular';
import { HeaderComponent } from '../../components/header/header.component';

@Component({
  selector: 'app-logging-method-routes',
  standalone: true,
  templateUrl: './logging-method-routes.page.html',
  styleUrls: ['./logging-method-routes.page.scss'],
  imports: [CommonModule, IonContent, IonButton, HeaderComponent],
})
export class LoggingMethodRoutesPage {
  private navCtrl = inject(NavController);

  goToWorkoutChatbot(): void {
    this.navCtrl.navigateForward('/workout-chatbot', {
      animated: true,
      animationDirection: 'forward',
    });
  }

  goToTreadmillLogger(): void {
    this.navCtrl.navigateForward('/treadmill-logger', {
      animated: true,
      animationDirection: 'forward',
    });
  }

  goToMapTrackingLogger(): void {
    this.navCtrl.navigateForward('/map-tracking-logger', {
      animated: true,
      animationDirection: 'forward',
    });
  }
}
