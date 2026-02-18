import { Injectable, signal, computed, Signal, effect } from '@angular/core';
import { AccountService } from './account.service';
import { trainerProfile } from '../../Interfaces/Profiles/Trainer';
import { clientProfile } from '../../Interfaces/Profiles/client';
import { Firestore, setDoc, getDoc, doc, updateDoc } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { FileUploadService } from '../file-upload.service';
import { getFunctions, httpsCallable } from 'firebase/functions';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private userInfo = signal<trainerProfile | clientProfile | null>(null);
  private readonly TRAINERS_COLLECTION = 'trainers';
  private readonly CLIENTS_COLLECTION = 'clients';
  private profileLoadPromise: Promise<boolean> | null = null;
  private loadedProfileUid: string | null = null;

  constructor(
    private accountService: AccountService,
    private firestore: Firestore,
    private fileUploadService: FileUploadService
  ) {
    effect(() => {
      if (!this.accountService.isLoggedIn()()) {
        this.userInfo.set(null);
        this.loadedProfileUid = null;
        this.profileLoadPromise = null;
      }
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
      return true;
    } else {
      throw new Error('User ID not found');
    }
  }

  async loadUserProfile(): Promise<boolean> {
    if (!this.accountService.isLoggedIn()()) {
      return false;
    }

    const credentials = this.accountService.getCredentials()();
    const userID = (credentials?.uid || '').trim();
    if (!userID) {
      throw new Error('User ID not found');
    }

    if (this.loadedProfileUid === userID && this.userInfo()) {
      return true;
    }

    if (this.profileLoadPromise) {
      return this.profileLoadPromise;
    }

    this.profileLoadPromise = this.loadUserProfileInternal(userID, credentials?.email || '');
    try {
      return await this.profileLoadPromise;
    } finally {
      this.profileLoadPromise = null;
    }
  }

  private async loadUserProfileInternal(userID: string, email: string): Promise<boolean> {
    let userDoc = await getDoc(doc(this.firestore, `${this.TRAINERS_COLLECTION}/${userID}`));

    if (!userDoc.exists()) {
      userDoc = await getDoc(doc(this.firestore, `${this.CLIENTS_COLLECTION}/${userID}`));
    }

    if (!userDoc.exists()) {
      this.userInfo.set(null);
      this.loadedProfileUid = null;
      return false;
    }

    const userData = userDoc.data() as trainerProfile | clientProfile;
    userData.email = email;

    // If profilepic is missing, load from users collection as fallback.
    if (!(userData as any).profilepic) {
      try {
        const usersDoc = await getDoc(doc(this.firestore, 'users', userID));
        if (usersDoc.exists()) {
          const usersData = usersDoc.data();
          const fallbackImage = usersData?.['profilepic'];
          if (fallbackImage) {
            (userData as any).profilepic = fallbackImage;
          }
        }
      } catch (error) {
        console.error('[UserService] Error checking users collection for profile image:', error);
      }
    }

    this.userInfo.set(userData);
    this.loadedProfileUid = userID;
    return true;
  }

  getUserInfo(): Signal<trainerProfile | clientProfile | null> {
    return this.userInfo;
  }

  getUserById(userId: string, accountType: 'trainer' | 'client'): Signal<trainerProfile | clientProfile | null> {
    const userSignal = signal<trainerProfile | clientProfile | null>(null);
    const collection = accountType === 'trainer' ? this.TRAINERS_COLLECTION : this.CLIENTS_COLLECTION;
    const userRef = doc(this.firestore, `${collection}/${userId}`);

    getDoc(userRef)
      .then(async (docSnap) => {
        if (docSnap.exists()) {
          const userData = docSnap.data() as trainerProfile | clientProfile;
          
          // If profilepic is missing, try to load from users collection as fallback
          if (!(userData as any).profilepic) {
            try {
              const usersDoc = await getDoc(doc(this.firestore, 'users', userId));
              if (usersDoc.exists()) {
                const usersData = usersDoc.data();
                const fallbackImage = usersData?.['profilepic'];
                if (fallbackImage) {
                  (userData as any).profilepic = fallbackImage;
                }
              }
            } catch (error) {
              console.error(`[UserService] Error checking users collection:`, error);
            }
          }
          
          userSignal.set(userData);
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
        profileData.profilepic = imageUrl;
      }

      const docRef = doc(this.firestore, `${this.CLIENTS_COLLECTION}/${uid}`);
      await updateDoc(docRef, profileData);
    } catch (error) {
      console.error('Error updating client profile:', error);
      throw error;
    }
  }

  async getUserProfileDirectly(uid: string, accountType: 'trainer' | 'client'): Promise<trainerProfile | clientProfile | null> {
    try {
      const collection = accountType === 'trainer' ? this.TRAINERS_COLLECTION : this.CLIENTS_COLLECTION;
      const docRef = doc(this.firestore, `${collection}/${uid}`);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const userData = docSnap.data() as (trainerProfile | clientProfile);
        
        // If profilepic is missing, try to load from users collection as fallback
        if (!(userData as any).profilepic) {
          try {
            const usersDoc = await getDoc(doc(this.firestore, 'users', uid));
            if (usersDoc.exists()) {
              const usersData = usersDoc.data();
              const fallbackImage = usersData?.['profilepic'];
              if (fallbackImage) {
                (userData as any).profilepic = fallbackImage;
              }
            }
          } catch (error) {
            console.error(`[UserService] Error checking users collection for profile image:`, error);
          }
        }
        
        return userData;
      } else {
        return null;
      }
    } catch (error) {
      console.error(`Error getting ${accountType} profile:`, error);
      return null;
    }
  }

  async uploadClientImage(uid: string, file: File): Promise<string> {
    try {
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
        return null;
      }
      
      // Use the modified linkProfile function with phone number
      const functions = getFunctions(undefined, 'us-west1');
      const linkProfileFunction = httpsCallable(functions, 'linkProfile');
      const result = await linkProfileFunction({ phoneNumber, uid, email });
      const data = result.data as any;
      
      if (data.success && data.linkedProfiles > 0) {
        return data.profileData;
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error linking profile by phone:', error);
      return null;
    }
  }
}
