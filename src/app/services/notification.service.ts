import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '@angular/fire/firestore';
import { Functions, httpsCallable, getFunctions } from '@angular/fire/functions';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { UserService } from './account/user.service';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from './push-notifications.plugin';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  data: Record<string, unknown> | null;
  createdAtLabel: string;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private readonly TRAINERS_COLLECTION = 'trainers';
  private readonly CLIENTS_COLLECTION = 'clients';
  private firestore: Firestore = inject(Firestore);
  private functions: Functions = inject(Functions);
  private toastController = inject(ToastController);
  private router = inject(Router);
  private listenersConfigured = false;
  readonly unreadCount = signal(0);
  private notificationFeedUnsubscribe: (() => void) | null = null;
  private activeNotificationFeedUserId = '';
  private hasLoadedNotificationFeed = false;
  private knownNotificationIds = new Set<string>();
  
  constructor(private userService: UserService) {}
  /**
   * Initialize push notifications
   */
  async initPushNotifications() {
    try {
      if (!this.isPushAvailable()) {
        return;
      }

      this.setupPushListeners();

      let result = await PushNotifications.checkPermissions();
      if (result.receive !== 'granted') {
        result = await PushNotifications.requestPermissions();
      }

      if (result.receive === 'granted') {
        await PushNotifications.register();
      }
    } catch (error) {
      console.error('Error initializing push notifications:', error);
    }
  }

  /**
   * Set up push notification listeners
   */
  private setupPushListeners() {
    if (!this.isPushAvailable() || this.listenersConfigured) {
      return;
    }

    this.listenersConfigured = true;

    PushNotifications.addListener('registration', (token: any) => {
      this.logTokenInfo(token.value);
      void this.saveApnsToken(token.value);
    });

    PushNotifications.addListener('registrationError', (error: any) => {
      console.error('Push registration error:', error);
    });

    PushNotifications.addListener('pushNotificationReceived', (notification: any) => {
      void notification;
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (notification: any) => {
      void this.navigateFromPushAction(notification);
    });
  }

  startInAppNotifications(userId: string): void {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
      this.stopInAppNotifications();
      return;
    }

    if (
      this.notificationFeedUnsubscribe &&
      this.activeNotificationFeedUserId === normalizedUserId
    ) {
      return;
    }

    this.stopInAppNotifications();
    this.activeNotificationFeedUserId = normalizedUserId;

    const notificationsQuery = query(
      collection(this.firestore, `users/${normalizedUserId}/notifications`),
      orderBy('createdAt', 'desc')
    );

    this.notificationFeedUnsubscribe = onSnapshot(notificationsQuery, (snapshot) => {
      const visibleNotifications = snapshot.docs
        .map((notificationDoc) => this.mapNotification(notificationDoc))
        .filter((notification) => notification.data?.['silent'] !== true);

      this.unreadCount.set(
        visibleNotifications.filter((notification) => !notification.read).length
      );

      if (!this.hasLoadedNotificationFeed) {
        this.knownNotificationIds = new Set(visibleNotifications.map((notification) => notification.id));
        this.hasLoadedNotificationFeed = true;
        return;
      }

      snapshot.docChanges().forEach((change) => {
        const notification = this.mapNotification(change.doc);
        const isSilent = notification.data?.['silent'] === true;

        if (change.type === 'removed') {
          this.knownNotificationIds.delete(notification.id);
          return;
        }

        if (change.type === 'modified') {
          this.knownNotificationIds.add(notification.id);
          return;
        }

        if (isSilent || this.knownNotificationIds.has(notification.id)) {
          this.knownNotificationIds.add(notification.id);
          return;
        }

        this.knownNotificationIds.add(notification.id);

        if (!notification.read && !this.router.url.startsWith('/notifications')) {
          void this.presentInAppToast(notification);
        }
      });
    });
  }

  stopInAppNotifications(): void {
    this.notificationFeedUnsubscribe?.();
    this.notificationFeedUnsubscribe = null;
    this.activeNotificationFeedUserId = '';
    this.hasLoadedNotificationFeed = false;
    this.knownNotificationIds.clear();
    this.unreadCount.set(0);
  }

  observeNotifications(
    userId: string,
    callback: (notifications: AppNotification[]) => void
  ): () => void {
    const notificationsQuery = query(
      collection(this.firestore, `users/${userId}/notifications`),
      orderBy('createdAt', 'desc')
    );

    return onSnapshot(notificationsQuery, (snapshot) => {
      callback(snapshot.docs.map((notificationDoc) => this.mapNotification(notificationDoc)));
    });
  }

  async markNotificationAsRead(userId: string, notificationId: string): Promise<void> {
    await updateDoc(doc(this.firestore, `users/${userId}/notifications/${notificationId}`), {
      read: true,
      updatedAt: serverTimestamp(),
    });
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    const notificationsRef = collection(this.firestore, `users/${userId}/notifications`);
    const unsubscribe = onSnapshot(notificationsRef, async (snapshot) => {
      unsubscribe();
      await Promise.all(
        snapshot.docs
          .filter((notificationDoc) => notificationDoc.data()['read'] !== true)
          .map((notificationDoc) =>
            updateDoc(notificationDoc.ref, {
              read: true,
              updatedAt: serverTimestamp(),
            })
          )
      );
    });
  }

  async deleteNotification(userId: string, notificationId: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `users/${userId}/notifications/${notificationId}`));
  }

  /**
   * Save the APNs token to the user's profile
   * @param token The APNs token to save
   */
  /**
   * Log information about an APNs token
   * Note: Apple doesn't officially document how to distinguish between dev/prod tokens
   * @param token The APNs token to log information about
   */
  private logTokenInfo(token: string): void {
    void token;
  }

  async saveApnsToken(token: string) {
    try {
      this.logTokenInfo(token);
      
      // Get the current user - using the signal correctly
      const currentUserSignal = this.userService.getCurrentUser();
      const currentUser = currentUserSignal();
      
      if (!currentUser) {
        return;
      }
      
      // Get the user profile - using the signal correctly
      const userProfileSignal = this.userService.getUserInfo();
      const userProfile = userProfileSignal();
      
      if (!userProfile) {
        // Don't try to load the profile or retry - we'll wait for the profile to be created naturally
        return;
      }
      
      // Check if profile creation is complete by checking for accountType
      if (!userProfile.accountType) {
        return;
      }
      
      const userId = currentUser.uid;
      const collectionPath = userProfile.accountType === 'trainer' 
        ? this.TRAINERS_COLLECTION 
        : this.CLIENTS_COLLECTION;

      // Get a reference to the Firestore document
      const userDocRef = doc(this.firestore, `${collectionPath}/${userId}`);
      
      // Get the current document
      const userDoc = await getDoc(userDocRef);
      if (userDoc.exists()) {
        const userData = userDoc.data();
        
        // Create or update the apnsPushTokens array
        let apnsPushTokens = userData['apnsPushTokens'] || [];
        
        // Check if this token is already in the array
        if (!apnsPushTokens.includes(token)) {
          apnsPushTokens.push(token);
          
          // Update the document with the new token
          try {
            await updateDoc(userDocRef, { 'apnsPushTokens': apnsPushTokens });
          } catch (updateError) {
            console.error('Error updating document with token:', updateError);
            // Try with setDoc as a fallback if updateDoc fails
            try {
              const updatedData = { ...userData, apnsPushTokens };
              await setDoc(userDocRef, updatedData);
            } catch (setDocError) {
              console.error('Fallback setDoc also failed:', setDocError);
            }
          }
        }
      } else {
        console.error('User document not found');
      }
    } catch (error) {
      console.error('Error saving APNs token:', error);
    }
  }
  
  /**
   * Send a notification to a user using their APNs tokens
   * This bypasses Firebase Cloud Messaging entirely and sends directly to APNs
   * @param userId The user ID to send the notification to
   * @param title The notification title
   * @param body The notification body
   * @param data Additional data to send with the notification
   * @returns A promise that resolves with the result of the notification send
   */
  async sendNotification(userId: string, title: string, body: string, data?: any) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
      throw new Error('userId is required to send a notification');
    }

    try {
      await this.createInAppNotification(normalizedUserId, title, body, data);

      if (!this.isPushAvailable()) {
        return {
          deliveredInApp: true,
          deliveredPush: false,
          reason: 'push-unavailable',
        };
      }

      // Get the current auth user
      const currentUser = this.userService.getCurrentUser()();
      if (!currentUser) {
        return {
          deliveredInApp: true,
          deliveredPush: false,
          reason: 'missing-auth-user',
        };
      }
      
      // Get a reference to the functions in the us-central1 region (where sendApnsNotification is deployed)
      const centralFunctions = getFunctions(undefined, 'us-central1');
      
      // Call the Firebase function to send the notification
      const sendApnsNotification = httpsCallable(centralFunctions, 'sendApnsNotification');
      
      // Ensure the data object has the necessary properties for waking up the app
      const enhancedData = {
        ...data,
        // Include content-available flag to wake up the app
        contentAvailable: true,
        // Include mutable-content flag to allow notification service extension to modify content
        mutableContent: true,
        // Include a category for actionable notifications if needed
        category: data?.category || 'DEFAULT',
        // Include a unique identifier for the notification
        id: data?.id || `notification-${Date.now()}`
      };
      
      const result = await sendApnsNotification({
        userId: normalizedUserId,
        title,
        body,
        data: enhancedData
      });
      
      return {
        deliveredInApp: true,
        deliveredPush: true,
        result: result.data,
      };
    } catch (error) {
      console.error('Error sending notification:', error);
      return {
        deliveredInApp: true,
        deliveredPush: false,
        error,
      };
    }
  }

  private async createInAppNotification(userId: string, title: string, body: string, data?: any): Promise<void> {
    await addDoc(collection(this.firestore, `users/${userId}/notifications`), {
      title: String(title || '').trim() || 'Atlas Notification',
      body: String(body || '').trim(),
      data: data ?? null,
      read: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  private isPushAvailable(): boolean {
    return Capacitor.isNativePlatform() &&
      Capacitor.isPluginAvailable('PushNotifications') &&
      !!PushNotifications;
  }

  private async presentInAppToast(notification: AppNotification): Promise<void> {
    if (this.shouldSuppressToast(notification)) {
      return;
    }

    const toast = await this.toastController.create({
      header: notification.title,
      message: notification.body,
      duration: 4500,
      position: 'top',
      buttons: [
        {
          text: 'View',
          handler: () => {
            void this.navigateFromNotification(notification);
          },
        },
      ],
    });

    await toast.present();
  }

  private shouldSuppressToast(notification: AppNotification): boolean {
    const type = this.resolveNotificationType(notification.data);
    const chatId = this.resolveNotificationChatId(notification.data);
    const currentUrl = this.router.url;

    if (currentUrl.startsWith('/notifications')) {
      return true;
    }

    if (type === 'chat' && chatId && currentUrl.startsWith(`/chat/${chatId}`)) {
      return true;
    }

    return false;
  }

  private async navigateFromNotification(notification: AppNotification): Promise<void> {
    const type = this.resolveNotificationType(notification.data);
    const chatId = this.resolveNotificationChatId(notification.data);

    if (type === 'agreement' || type === 'agreement_event') {
      await this.router.navigate(['/service-agreements']);
      return;
    }

    if (type === 'chat' && chatId) {
      await this.router.navigate(['/chat', chatId]);
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
      return;
    }

    await this.router.navigate(['/notifications']);
  }

  private async navigateFromPushAction(notificationAction: unknown): Promise<void> {
    const actionPayload = this.asRecord(notificationAction);
    const actionNotification = this.asRecord(actionPayload?.['notification']);
    const data = this.asRecord(actionNotification?.['data']);

    const type = this.resolveNotificationType(data);
    const chatId = this.resolveNotificationChatId(data);

    if (type === 'agreement' || type === 'agreement_event') {
      await this.router.navigate(['/service-agreements']);
      return;
    }

    if (type === 'chat' && chatId) {
      await this.router.navigate(['/chat', chatId]);
      return;
    }
  }

  private resolveNotificationType(data: Record<string, unknown> | null | undefined): string {
    const directType = String(data?.['type'] || '').trim();
    if (directType) {
      return directType;
    }

    const nested = this.asRecord(data?.['data']);
    return String(nested?.['type'] || '').trim();
  }

  private resolveNotificationChatId(data: Record<string, unknown> | null | undefined): string {
    const directChatId = String(data?.['chatId'] || '').trim();
    if (directChatId) {
      return directChatId;
    }

    const nested = this.asRecord(data?.['data']);
    return String(nested?.['chatId'] || '').trim();
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private mapNotification(notificationDoc: any): AppNotification {
    const data = notificationDoc.data() as Record<string, unknown>;
    return {
      id: notificationDoc.id,
      title: String(data['title'] || 'Atlas Notification'),
      body: String(data['body'] || ''),
      read: data['read'] === true,
      data: (data['data'] as Record<string, unknown> | null) ?? null,
      createdAtLabel: this.toDate(data['createdAt']).toLocaleString(),
    };
  }

  private toDate(value: unknown): Date {
    const timestampValue = value as { toDate?: () => Date };
    if (timestampValue?.toDate instanceof Function) {
      return timestampValue.toDate();
    }

    const parsedDate = new Date(String(value || ''));
    return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  }
}
