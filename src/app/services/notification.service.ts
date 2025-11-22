import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc, updateDoc, setDoc } from '@angular/fire/firestore';
import { Functions, httpsCallable, getFunctions } from '@angular/fire/functions';
import { UserService } from './account/user.service';
import { PushNotifications } from '@capacitor/push-notifications';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private readonly TRAINERS_COLLECTION = 'trainers';
  private readonly CLIENTS_COLLECTION = 'clients';
  private firestore: Firestore = inject(Firestore);
  private functions: Functions = inject(Functions);
  
  constructor(private userService: UserService) {}
  /**
   * Initialize push notifications
   */
  async initPushNotifications() {
    try {
      // Set up listeners FIRST, before registration
      this.setupPushListeners();
      
      // Request permission to use push notifications
      const result = await PushNotifications.requestPermissions();
      
      if (result.receive === 'granted') {
        // Register with Apple / Google to receive push via APNS/FCM
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
    // Registration success listener
    PushNotifications.addListener('registration', (token) => {
      this.logTokenInfo(token.value);
      this.saveApnsToken(token.value);
    });

    // Registration error listener
    PushNotifications.addListener('registrationError', (error) => {
      console.error('Push registration error:', error);
    });

    // Notification received listener
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('Push notification received:', notification);
    });

    // Notification action performed listener
    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('Push notification action performed:', notification);
    });
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
    // Log a truncated version of the token for privacy
    const truncatedToken = `${token.substring(0, 8)}...${token.substring(token.length - 8)}`;
    console.log(`APNs token info: ${truncatedToken}`);
    console.log(`Token length: ${token.length}`);
    console.log(`First few characters: ${token.substring(0, 8)}`);
  }

  async saveApnsToken(token: string) {
    try {
      console.log('Attempting to save APNs token');
      this.logTokenInfo(token);
      
      // Get the current user - using the signal correctly
      const currentUserSignal = this.userService.getCurrentUser();
      const currentUser = currentUserSignal();
      
      if (!currentUser) {
        console.log('User not logged in, cannot save token');
        return;
      }

      console.log('Current user found:', currentUser.uid);
      
      // Get the user profile - using the signal correctly
      const userProfileSignal = this.userService.getUserInfo();
      const userProfile = userProfileSignal();
      
      if (!userProfile) {
        console.log('User profile not loaded, cannot save token');
        // Don't try to load the profile or retry - we'll wait for the profile to be created naturally
        console.log('Will wait for profile creation to complete before saving token');
        return;
      }
      
      // Check if profile creation is complete by checking for accountType
      if (!userProfile.accountType) {
        console.log('User profile exists but is incomplete (no account type), skipping token save');
        return;
      }

      console.log('User profile found and complete, account type:', userProfile.accountType);
      
      const userId = currentUser.uid;
      const collectionPath = userProfile.accountType === 'trainer' 
        ? this.TRAINERS_COLLECTION 
        : this.CLIENTS_COLLECTION;

      console.log(`Saving token to ${collectionPath}/${userId}`);
      
      // Get a reference to the Firestore document
      const userDocRef = doc(this.firestore, `${collectionPath}/${userId}`);
      
      // Get the current document
      const userDoc = await getDoc(userDocRef);
      if (userDoc.exists()) {
        const userData = userDoc.data();
        console.log('User document exists, current data:', userData);
        
        // Create or update the apnsPushTokens array
        let apnsPushTokens = userData['apnsPushTokens'] || [];
        console.log('Current apnsPushTokens:', apnsPushTokens);
        
        // Check if this token is already in the array
        if (!apnsPushTokens.includes(token)) {
          apnsPushTokens.push(token);
          console.log('Adding new token to array:', apnsPushTokens);
          
          // Update the document with the new token
          try {
            await updateDoc(userDocRef, { 'apnsPushTokens': apnsPushTokens });
            console.log('APNs token saved to user profile successfully');
          } catch (updateError) {
            console.error('Error updating document with token:', updateError);
            // Try with setDoc as a fallback if updateDoc fails
            try {
              const updatedData = { ...userData, apnsPushTokens };
              await setDoc(userDocRef, updatedData);
              console.log('APNs token saved using setDoc as fallback');
            } catch (setDocError) {
              console.error('Fallback setDoc also failed:', setDocError);
            }
          }
        } else {
          console.log('APNs token already exists in user profile');
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
    try {
      console.log(`Sending notification to user ${userId}`);
      
      // Get the current auth user
      const currentUser = this.userService.getCurrentUser()();
      if (!currentUser) {
        console.error('User not logged in, cannot send notification');
        throw new Error('User not logged in');
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
        userId,
        title,
        body,
        data: enhancedData
      });
      
      console.log('Notification sent successfully:', result.data);
      return result.data;
    } catch (error) {
      console.error('Error sending notification:', error);
      throw error;
    }
  }
}
