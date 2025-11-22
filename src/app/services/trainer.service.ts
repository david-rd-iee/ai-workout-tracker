import { Injectable, signal } from '@angular/core';
import { Firestore, doc, getDoc, updateDoc, setDoc, collection, query, where, getDocs } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { trainerProfile } from '../Interfaces/Profiles/Trainer';
import { LoadingController } from '@ionic/angular';
import { FileUploadService } from './file-upload.service';
import { VideoCompressionService } from './video-compression.service';
import { DayAvailability } from '../Interfaces/Availability';

@Injectable({
  providedIn: 'root'
})
export class TrainerService {
  loadedTrainerProfile: trainerProfile | null = null;

  constructor(
    private firestore: Firestore,
    private storage: Storage,
    private loadingController: LoadingController,
    private fileUploadService: FileUploadService,
    private videoCompressionService: VideoCompressionService
  ) {}

  async getTrainerProfile(uid: string): Promise<trainerProfile> {
    const docRef = doc(this.firestore, `trainers/${uid}`);
    const docSnap = await getDoc(docRef);
    
    const profileData = docSnap.data() as trainerProfile;
    
    return profileData;
  }

  async updateTrainerProfile(uid: string, profileData: Partial<trainerProfile>, imageFile?: File, videoFile?: File, loadingSpinner?: HTMLIonLoadingElement): Promise<void> {
    try {
      if (imageFile) {
        const imageUrl = await this.uploadTrainerImage(uid, imageFile);
        profileData.profileImage = imageUrl;
      }

      if (videoFile) {
        const videoUrl = await this.uploadTrainerVideo(uid, videoFile, loadingSpinner);
        profileData.introVideoUrl = videoUrl;
      }

      const docRef = doc(this.firestore, `trainers/${uid}`);
      await updateDoc(docRef, profileData);
    } catch (error) {
      throw error;
    }
  }

  async uploadTrainerImage(uid: string, file: File): Promise<string> {
    try {
      console.log('Starting trainer image upload for uid:', uid);
      
      // Use the new FileUploadService for more reliable uploads
      const storagePath = `trainer-images/${uid}`;
      return await this.fileUploadService.uploadFile(storagePath, file);
    } catch (error: any) {
      console.error('Error in uploadTrainerImage:', error);
      throw error; // FileUploadService already handles detailed error logging
    }
  }

  async uploadTrainerVideo(uid: string, file: File, loadingSpinner?: HTMLIonLoadingElement): Promise<string> {
    try {
      console.log('Starting trainer video upload for uid:', uid);
      
      let videoToUpload = file;
      const fileSizeMB = file.size / (1024 * 1024);
      
      // Compress videos over 15MB before uploading
      if (fileSizeMB > 15 && this.videoCompressionService.isCompressionSupported()) {
        console.log(`Video is ${fileSizeMB.toFixed(1)}MB, compressing before upload...`);
        
        // Update loading message to "Uploading..." during compression
        if (loadingSpinner) {
          loadingSpinner.message = 'Uploading... 0%';
        }
        
        try {
          const compressedFile = await this.videoCompressionService.compressVideo(
            file,
            1280, // Max width 720p
            2.5, // 2.5 Mbps bitrate
            (progress) => {
              console.log(`Compression progress: ${progress.progress}% - ${progress.message}`);
              // Update loading spinner with compression progress
              if (loadingSpinner) {
                const percent = Math.floor(progress.progress);
                loadingSpinner.message = `Uploading... ${percent}%`;
              }
            }
          );
          
          const compressedSizeMB = compressedFile.size / (1024 * 1024);
          const savings = ((1 - compressedFile.size / file.size) * 100).toFixed(0);
          console.log(`Video compressed: ${fileSizeMB.toFixed(1)}MB → ${compressedSizeMB.toFixed(1)}MB (${savings}% reduction)`);
          
          videoToUpload = compressedFile;
        } catch (compressionError) {
          console.warn('Video compression failed, uploading original:', compressionError);
          // Continue with original file if compression fails
        }
      }
      
      // Update loading message to "Saving..." during actual upload
      if (loadingSpinner) {
        loadingSpinner.message = 'Saving...';
      }
      
      // Use the FileUploadService for video uploads
      const storagePath = `trainer-videos/${uid}/intro-video.mp4`;
      return await this.fileUploadService.uploadVideo(storagePath, videoToUpload);
    } catch (error: any) {
      console.error('Error in uploadTrainerVideo:', error);
      throw error; // FileUploadService already handles detailed error logging
    }
  }
  
  /**
   * Convert a File to a Blob to ensure compatibility with Capacitor
   */
  private async fileToBlob(file: File): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (reader.result instanceof ArrayBuffer) {
            const blob = new Blob([reader.result], { type: file.type });
            resolve(blob);
          } else if (typeof reader.result === 'string') {
            // Handle data URL
            const base64 = reader.result.split(',')[1];
            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: file.type });
            resolve(blob);
          } else {
            reject(new Error('FileReader result is null'));
          }
        };
        reader.onerror = () => {
          reject(reader.error);
        };
        reader.readAsArrayBuffer(file);
      } catch (error) {
        console.error('Error converting file to blob:', error);
        reject(error);
      }
    });
  }

  async uploadAdditionalPhoto(uid: string, file: File): Promise<string> {
    const loading = await this.loadingController.create({
      message: 'Uploading photo...',
      backdropDismiss: false
    });
    await loading.present();

    try {
      console.log('Starting additional photo upload for uid:', uid);
      const fileName = `${Date.now()}_${file.name}`;
      
      // Use the new FileUploadService for more reliable uploads
      const storagePath = `trainer-images/${uid}/additional/${fileName}`;
      return await this.fileUploadService.uploadFile(storagePath, file);
    } catch (error: any) {
      console.error('Error uploading additional photo:', error);
      throw error; // FileUploadService already handles detailed error logging
    } finally {
      await loading.dismiss();
    }
  }

  /**
   * Get the trainer's availability settings
   * @param trainerId The trainer's ID
   * @returns Promise with the trainer's availability settings
   */
  async getTrainerAvailability(trainerId: string): Promise<DayAvailability[]> {
    try {
      // Get the availability document from the 'trainerAvailability' collection
      const docRef = doc(this.firestore, `trainerAvailability/${trainerId}`);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return docSnap.data()['availability'] || [];
      } else {
        console.log('No availability found for trainer:', trainerId);
        return [];
      }
    } catch (error) {
      console.error('Error getting trainer availability:', error);
      throw error;
    }
  }

  /**
   * Update the trainer's availability settings
   * @param trainerId The trainer's ID
   * @param availability Array of availability settings for each day
   * @returns Promise that resolves when the update is complete
   */
  async updateTrainerAvailability(trainerId: string, availability: DayAvailability[]): Promise<void> {
    try {
      const docRef = doc(this.firestore, `trainerAvailability/${trainerId}`);
      
      // Use setDoc with merge: true to create the document if it doesn't exist
      await setDoc(docRef, {
        trainerId,
        availability,
        updatedAt: new Date()
      }, { merge: true });
      
      console.log('Trainer availability updated successfully');
    } catch (error) {
      console.error('Error updating trainer availability:', error);
      throw error;
    }
  }

  /**
   * Delete the trainer's availability settings
   * @param trainerId The trainer's ID
   * @returns Promise that resolves when the deletion is complete
   */
  async deleteTrainerAvailability(trainerId: string): Promise<void> {
    try {
      const docRef = doc(this.firestore, `trainerAvailability/${trainerId}`);
      
      // Set the availability to an empty array instead of deleting the document
      await updateDoc(docRef, {
        availability: [],
        updatedAt: new Date()
      });
      
      console.log('Trainer availability deleted successfully');
    } catch (error) {
      console.error('Error deleting trainer availability:', error);
      throw error;
    }
  }

  /**
   * Get the trainer's before/after images
   * @param trainerId The trainer's ID
   * @returns Promise with array of image URLs
   */
  async getBeforeAfterImages(trainerId: string): Promise<string[]> {
    try {
      const docRef = doc(this.firestore, `trainers/${trainerId}`);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        return data['beforeAfterImages'] || [];
      }
      return [];
    } catch (error) {
      console.error('Error getting before/after images:', error);
      throw error;
    }
  }

  /**
   * Upload before/after images
   * @param trainerId The trainer's ID
   * @param files Array of image files to upload
   * @returns Promise with array of uploaded image URLs
   */
  async uploadBeforeAfterImages(trainerId: string, files: File[]): Promise<string[]> {
    const uploadedUrls: string[] = [];
    
    for (const file of files) {
      try {
        const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
        const storagePath = `trainer-images/${trainerId}/before-after/${fileName}`;
        const url = await this.fileUploadService.uploadFile(storagePath, file);
        uploadedUrls.push(url);
      } catch (error) {
        console.error('Error uploading before/after image:', error);
        // Continue with other uploads even if one fails
      }
    }
    
    return uploadedUrls;
  }

  /**
   * Update the trainer's before/after images in Firestore
   * @param trainerId The trainer's ID
   * @param imageUrls Array of image URLs
   * @returns Promise that resolves when the update is complete
   */
  async updateBeforeAfterImages(trainerId: string, imageUrls: string[]): Promise<void> {
    try {
      const docRef = doc(this.firestore, `trainers/${trainerId}`);
      await updateDoc(docRef, {
        beforeAfterImages: imageUrls,
        updatedAt: new Date()
      });
      console.log('Before/after images updated successfully');
    } catch (error) {
      console.error('Error updating before/after images:', error);
      throw error;
    }
  }

  /**
   * Get the trainer's additional photos
   * @param trainerId The trainer's ID
   * @returns Promise with array of image URLs
   */
  async getAdditionalPhotos(trainerId: string): Promise<string[]> {
    try {
      const docRef = doc(this.firestore, `trainers/${trainerId}`);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        return data['additionalPhotos'] || [];
      }
      return [];
    } catch (error) {
      console.error('Error getting additional photos:', error);
      throw error;
    }
  }

  /**
   * Upload additional photos
   * @param trainerId The trainer's ID
   * @param files Array of image files to upload
   * @returns Promise with array of uploaded image URLs
   */
  async uploadAdditionalPhotos(trainerId: string, files: File[]): Promise<string[]> {
    const uploadedUrls: string[] = [];
    
    for (const file of files) {
      try {
        const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
        const storagePath = `trainer-images/${trainerId}/additional-photos/${fileName}`;
        const url = await this.fileUploadService.uploadFile(storagePath, file);
        uploadedUrls.push(url);
      } catch (error) {
        console.error('Error uploading additional photo:', error);
        // Continue with other uploads even if one fails
      }
    }
    
    return uploadedUrls;
  }

  /**
   * Update the trainer's additional photos in Firestore
   * @param trainerId The trainer's ID
   * @param imageUrls Array of image URLs
   * @returns Promise that resolves when the update is complete
   */
  async updateAdditionalPhotos(trainerId: string, imageUrls: string[]): Promise<void> {
    try {
      const docRef = doc(this.firestore, `trainers/${trainerId}`);
      await updateDoc(docRef, {
        additionalPhotos: imageUrls,
        updatedAt: new Date()
      });
      console.log('Additional photos updated successfully');
    } catch (error) {
      console.error('Error updating additional photos:', error);
      throw error;
    }
  }
}