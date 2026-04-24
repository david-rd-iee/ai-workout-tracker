import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  checkmarkDoneOutline,
  chevronForwardOutline,
  notificationsOutline,
  trashOutline,
} from 'ionicons/icons';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { AccountService } from 'src/app/services/account/account.service';
import { AppNotification, NotificationService } from 'src/app/services/notification.service';

@Component({
  selector: 'app-notifications',
  standalone: true,
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  imports: [
    CommonModule,
    HeaderComponent,
    IonButton,
    IonContent,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonSpinner,
  ],
})
export class NotificationsPage implements OnInit, OnDestroy {
  notifications: AppNotification[] = [];
  isLoading = true;
  currentUserId = '';

  private unsubscribeNotifications: (() => void) | null = null;

  constructor(
    private readonly accountService: AccountService,
    private readonly notificationService: NotificationService,
    private readonly router: Router
  ) {
    addIcons({
      notificationsOutline,
      checkmarkDoneOutline,
      trashOutline,
      chevronForwardOutline,
    });
  }

  ngOnInit(): void {
    const credentials = this.accountService.getCredentials()();
    this.currentUserId = String(credentials?.uid || '').trim();

    if (!this.currentUserId) {
      this.isLoading = false;
      return;
    }

    this.unsubscribeNotifications = this.notificationService.observeNotifications(
      this.currentUserId,
      (notifications) => {
        this.notifications = notifications.filter(
          (notification) => notification.data?.['silent'] !== true
        );
        this.isLoading = false;
      }
    );
  }

  ngOnDestroy(): void {
    this.unsubscribeNotifications?.();
    this.unsubscribeNotifications = null;
  }

  async openNotification(notification: AppNotification): Promise<void> {
    if (!this.currentUserId) {
      return;
    }

    await this.notificationService.markNotificationAsRead(this.currentUserId, notification.id);

    const type = String(notification.data?.['type'] || '').trim();
    const chatId = String(notification.data?.['chatId'] || '').trim();

    if (type === 'chat' && chatId) {
      await this.router.navigate(['/chat', chatId]);
      return;
    }

    if (type === 'agreement') {
      await this.router.navigate(['/service-agreements']);
      return;
    }

    if (type === 'trainer_approval') {
      await this.router.navigate(['/trainer-approval-admin']);
      return;
    }

    if (type === 'trainer_workout_assigned') {
      await this.router.navigate(['/client-payments'], {
        queryParams: {
          panel: 'workouts',
        },
      });
    }
  }

  async markAllAsRead(): Promise<void> {
    if (!this.currentUserId || this.notifications.length === 0) {
      return;
    }

    await this.notificationService.markAllNotificationsAsRead(this.currentUserId);
  }

  async deleteNotification(notification: AppNotification, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (!this.currentUserId) {
      return;
    }

    await this.notificationService.deleteNotification(this.currentUserId, notification.id);
  }
}
