import { registerPlugin } from '@capacitor/core';

export interface PushPermissionStatus {
  receive: 'granted' | 'denied' | 'prompt' | string;
}

export interface PushNotificationToken {
  value: string;
}

export interface PushNotificationActionPerformed {
  notification: {
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
  };
}

export interface PushNotificationsPlugin {
  checkPermissions(): Promise<PushPermissionStatus>;
  requestPermissions(): Promise<PushPermissionStatus>;
  register(): Promise<void>;
  addListener(
    eventName: 'registration',
    listenerFunc: (token: PushNotificationToken) => void
  ): Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
  addListener(
    eventName: 'registrationError',
    listenerFunc: (error: unknown) => void
  ): Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
  addListener(
    eventName: 'pushNotificationReceived',
    listenerFunc: (notification: unknown) => void
  ): Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
  addListener(
    eventName: 'pushNotificationActionPerformed',
    listenerFunc: (notification: PushNotificationActionPerformed) => void
  ): Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
}

export const PushNotifications = registerPlugin<PushNotificationsPlugin>('PushNotifications');
