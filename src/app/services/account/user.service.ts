import { Injectable, signal, computed, Signal, effect, inject } from '@angular/core';
import { AccountService } from './account.service';
import { trainerProfile } from '../../Interfaces/Profiles/Trainer';
import { clientProfile } from '../../Interfaces/Profiles/client';
import { Firestore, collection, collectionData, addDoc, setDoc, getDoc, doc, onSnapshot, CollectionReference, query, updateDoc } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { NavController } from '@ionic/angular';
import { Observable, from, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { FileUploadService } from '../file-upload.service';
import { getFunctions, httpsCallable } from 'firebase/functions';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private userInfo = signal<trainerProfile | clientProfile | null>(null);
  private readonly TRAINERS_COLLECTION = 'trainers';
  private readonly CLIENTS_COLLECTION = 'clients';

  constructor(
    private accountService: AccountService,
    private firestore: Firestore,
    private navCtrl: NavController,
    private storage: Storage,
    private fileUploadService: FileUploadService
  ) { 
    console.log('UserService constructor called');
    
    effect(() => {
      if (!this.accountService.isLoggedIn()()) {
        this.userInfo.set(null);
      }
    });
    
    // Listen to authentication state changes for logging purposes
    // Navigation is now handled by AppComponent after version check
    console.log('UserService setting up auth state subscription');
    this.accountService.authStateChanges$.subscribe(async (authState) => {
      console.log('UserService received auth state change:', authState);
      // Don't navigate here - AppComponent handles navigation after version check
    });
  }

  async createUserProfile(formData: trainerProfile | clientProfile): Promise<boolean> {
    const userID = this.accountService.getCredentials()().uid;
    formData.email = this.accountService.getCredentials()().email;

    if (userID) {
      const collection = formData.accountType === 'trainer'
        ? this.TRAINERS_COLLECTION
        : this.CLIENTS_COLLECTION;

      // Add required fields for chat functionality
      const profileData = {
        ...formData,
        unreadMessageCount: 0, // Initialize unread message count
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const userDocRef = doc(this.firestore, `${collection}/${userID}`);
      await setDoc(userDocRef, profileData);
      console.log(`${formData.accountType} profile created successfully`);
      return true;
    } else {
      throw new Error('User ID not found');
    }
  }

  async loadUserProfile(): Promise<boolean> {
    try {
      // Check if user is actually logged in first
      if (!this.accountService.isLoggedIn()()) {
        console.log('User not logged in, cannot load profile');
        return false;
      }

      const credentials = this.accountService.getCredentials()();
      const userID = credentials?.uid;
      console.log('Loading user profile for UID:', userID);
      
      if (!userID || userID.trim() === '') {
        console.error('User ID not found in credentials or is empty');
        console.log('Current credentials:', credentials);
        throw new Error('User ID not found');
      }

      console.log('Attempting to load from trainers collection...');
      // Try loading from trainers collection first
      let userDoc = await getDoc(doc(this.firestore, `${this.TRAINERS_COLLECTION}/${userID}`));
      console.log('Trainers collection query result:', userDoc.exists());

      // If not found in trainers, try clients collection
      if (!userDoc.exists()) {
        console.log('Not found in trainers, trying clients collection...');
        userDoc = await getDoc(doc(this.firestore, `${this.CLIENTS_COLLECTION}/${userID}`));
        console.log('Clients collection query result:', userDoc.exists());
      }

      if (userDoc.exists()) {
        const userData = userDoc.data() as trainerProfile | clientProfile;
        userData.email = this.accountService.getCredentials()().email;
        this.userInfo.set(userData);
        console.log('User profile loaded successfully:', userData.accountType, userData.firstName);
        
        // Debug: Verify the signal was set correctly
        const currentUserInfo = this.userInfo();
        console.log('UserInfo signal after setting:', currentUserInfo);
        console.log('UserInfo signal accountType after setting:', currentUserInfo?.accountType);
        
        return true;
      } else {
        console.log('No profile found in either collection - user needs to create profile');
        // this.navCtrl.navigateRoot('/profile-creation'); // Temporarily disabled for testing
        return false;
      }
    } catch (error) {
      console.error('Error in loadUserProfile:', error);
      console.error('Error type:', typeof error);
      console.error('Error message:', error instanceof Error ? error.message : 'Unknown error');
      console.error('Full error object:', JSON.stringify(error, null, 2));
      throw error;
    }
  }

  getUserInfo(): Signal<trainerProfile | clientProfile | null> {
    return this.userInfo;
  }

  getUserById(userId: string, accountType: 'trainer' | 'client'): Signal<trainerProfile | clientProfile | null> {
    const userSignal = signal<trainerProfile | clientProfile | null>(null);
    const collection = accountType === 'trainer' ? this.TRAINERS_COLLECTION : this.CLIENTS_COLLECTION;
    const userRef = doc(this.firestore, `${collection}/${userId}`);

    console.log('Fetching user:', userId, accountType);
    getDoc(userRef)
      .then((docSnap) => {
        if (docSnap.exists()) {
          const userData = docSnap.data() as trainerProfile | clientProfile;
          userSignal.set(userData);
          console.log('User loaded successfully:', userData);
        } else {
          userSignal.set(null);
        }
      })
      .catch((error) => {
        console.error('Error fetching user:', error);
        userSignal.set(null);
      });

    return userSignal;
  }

  async updateClientProfile(uid: string, profileData: Partial<clientProfile>, imageFile?: File): Promise<void> {
    try {
      if (imageFile) {
        const imageUrl = await this.uploadClientImage(uid, imageFile);
        profileData.profileImage = imageUrl;
      }

      const docRef = doc(this.firestore, `${this.CLIENTS_COLLECTION}/${uid}`);
      await updateDoc(docRef, profileData);
      console.log('Client profile updated successfully');
    } catch (error) {
      console.error('Error updating client profile:', error);
      throw error;
    }
  }

  async getUserProfileDirectly(uid: string, accountType: 'trainer' | 'client'): Promise<trainerProfile | clientProfile | null> {
    try {
      console.log(`Getting ${accountType} profile directly for uid:`, uid);
      const collection = accountType === 'trainer' ? this.TRAINERS_COLLECTION : this.CLIENTS_COLLECTION;
      const docRef = doc(this.firestore, `${collection}/${uid}`);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const userData = docSnap.data() as (trainerProfile | clientProfile);
        console.log(`${accountType} profile data retrieved:`, userData);
        return userData;
      } else {
        console.log(`No ${accountType} profile found for uid:`, uid);
        return null;
      }
    } catch (error) {
      console.error(`Error getting ${accountType} profile:`, error);
      return null;
    }
  }

  async uploadClientImage(uid: string, file: File): Promise<string> {
    try {
      console.log('Starting client image upload for uid:', uid);
      
      // Use the new FileUploadService for more reliable uploads
      const storagePath = `client-images/${uid}`;
      return await this.fileUploadService.uploadFile(storagePath, file);
    } catch (error: any) {
      console.error('Error uploading client image:', error);
      throw error; // FileUploadService already handles detailed error logging
    }
  }
  
  /**
   * Get the current authenticated user as a Signal
   * @returns Signal with the user object containing uid and other properties
   */
  getCurrentUser(): Signal<{uid: string, email: string} | null> {
    return computed(() => this.accountService.getCredentials()());
  }


  getUserFullName(userId: string, accountType: 'trainer' | 'client'): Observable<string> {
    // Convert the Signal to an Observable using the of operator
    const userProfileSignal = this.getUserById(userId, accountType);
    return of(userProfileSignal()).pipe(
      map(userProfile => {
        if (!userProfile) return '';
        if (accountType === 'trainer') {
          const profile = userProfile as trainerProfile;
          return `${profile.firstName} ${profile.lastName}`;
        } else {
          const profile = userProfile as clientProfile;
          return `${profile.firstName} ${profile.lastName}`;
        }
      })
    );
  }

  /**
   * Increment unread message count for a user
   * @param userId The user ID to increment count for
   * @param accountType The account type (trainer or client)
   */
  async incrementUnreadMessageCount(userId: string, accountType: 'trainer' | 'client'): Promise<number> {
    try {
      const collection = accountType === 'trainer' ? this.TRAINERS_COLLECTION : this.CLIENTS_COLLECTION;
      const docRef = doc(this.firestore, `${collection}/${userId}`);
      
      // Get current profile to read current count
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        console.error('User profile not found for incrementing unread count');
        return 0;
      }
      
      const currentProfile = docSnap.data() as trainerProfile | clientProfile;
      const currentCount = currentProfile.unreadMessageCount || 0;
      const newCount = currentCount + 1;
      
      // Update the unread message count
      await updateDoc(docRef, { unreadMessageCount: newCount });
      
      console.log(`Incremented unread message count for ${userId} to ${newCount}`);
      return newCount;
    } catch (error) {
      console.error('Error incrementing unread message count:', error);
      return 0;
    }
  }

  /**
   * Reset unread message count for a user to 0
   * @param userId The user ID to reset count for
   * @param accountType The account type (trainer or client)
   */
  async resetUnreadMessageCount(userId: string, accountType: 'trainer' | 'client'): Promise<void> {
    try {
      const collection = accountType === 'trainer' ? this.TRAINERS_COLLECTION : this.CLIENTS_COLLECTION;
      const docRef = doc(this.firestore, `${collection}/${userId}`);
      
      // Reset the unread message count to 0
      await updateDoc(docRef, { unreadMessageCount: 0 });
      
      console.log(`Reset unread message count for ${userId}`);
    } catch (error) {
      console.error('Error resetting unread message count:', error);
    }
  }

  /**
   * Get current unread message count for a user
   * @param userId The user ID to get count for
   * @param accountType The account type (trainer or client)
   */
  async getUnreadMessageCount(userId: string, accountType: 'trainer' | 'client'): Promise<number> {
    try {
      const profile = await this.getUserProfileDirectly(userId, accountType);
      return profile?.unreadMessageCount || 0;
    } catch (error) {
      console.error('Error getting unread message count:', error);
      return 0;
    }
  }

  /**
   * Link partial profiles using phone number after profile creation
   */
  async linkProfileByPhone(phoneNumber: string): Promise<any> {
    try {
      const credentials = this.accountService.getCredentials()();
      const uid = credentials?.uid;
      const email = credentials?.email;
      
      if (!uid || !phoneNumber) {
        console.log('Missing UID or phone number for profile linking');
        return null;
      }

      console.log('Attempting to link profile by phone:', phoneNumber);
      
      // Use the modified linkProfile function with phone number
      const functions = getFunctions(undefined, 'us-west1');
      const linkProfileFunction = httpsCallable(functions, 'linkProfile');
      const result = await linkProfileFunction({ phoneNumber, uid, email });
      const data = result.data as any;
      
      if (data.success && data.linkedProfiles > 0) {
        console.log(`Successfully linked ${data.linkedProfiles} profile(s) by phone number`);
        return data.profileData;
      } else {
        console.log('No partial profiles found to link by phone number');
        return null;
      }
    } catch (error) {
      console.error('Error linking profile by phone:', error);
      return null;
    }
  }
}
