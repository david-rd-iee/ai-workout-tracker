import { Injectable } from '@angular/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Platform } from '@ionic/angular/standalone';
import { Storage, ref, uploadString, getDownloadURL, uploadBytes } from '@angular/fire/storage';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Http } from '@capacitor-community/http';
import { Auth, getAuth, getIdToken } from '@angular/fire/auth';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FileUploadService {
  private isCapacitor: boolean;

  constructor(
    private platform: Platform,
    private storage: Storage,
    private functions: Functions,
    private auth: Auth
  ) {
    this.isCapacitor = this.platform.is('capacitor');
    console.log('FileUploadService initialized, isCapacitor:', this.isCapacitor);
  }

  /**
   * Upload a file to Firebase Storage with Capacitor-friendly approach
   * @param path Storage path where the file should be stored
   * @param file The file to upload
   * @returns Promise with the download URL
   */
  async uploadFile(path: string, file: File): Promise<string> {
    console.log(`Starting file upload to ${path}`);
    console.log('File details:', file.name, file.size, 'bytes', file.type);

    try {
      // For iOS/Capacitor, prefer Cloud Functions when configured.
      // Fall back to direct Storage upload when base URL is missing.
      if (this.isCapacitor) {
        if (environment.cloudFunctionsBaseUrl?.trim()) {
          try {
            return await this.uploadViaCloudFunction(path, file);
          } catch (error) {
            console.warn('Cloud Function upload failed; falling back to direct Storage upload.', error);
            return await this.uploadDirect(path, file);
          }
        }
        return await this.uploadDirect(path, file);
      }

      // For web, use direct Firebase Storage upload
      return await this.uploadDirect(path, file);
    } catch (error: any) {
      console.error('Error in file upload:', error);
      this.logErrorDetails(error);
      throw new Error(`File upload failed: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Upload a video file to Firebase Storage
   * On mobile, use Cloud Functions to avoid Capacitor HTTP issues
   * @param path Storage path where the video should be stored
   * @param file The video file to upload
   * @returns Promise with the download URL
   */
  async uploadVideo(path: string, file: File): Promise<string> {
    console.log(`Starting video upload to ${path}`);
    console.log('Video details:', file.name, file.size, 'bytes', file.type);

    try {
      // For iOS/Capacitor, prefer Cloud Functions when configured.
      // Fall back to direct Storage upload when base URL is missing.
      if (this.isCapacitor) {
        if (environment.cloudFunctionsBaseUrl?.trim()) {
          console.log('Using Cloud Function for video upload on Capacitor');
          try {
            return await this.uploadViaCloudFunction(path, file);
          } catch (error) {
            console.warn('Cloud Function video upload failed; falling back to direct Storage upload.', error);
            return await this.uploadDirect(path, file);
          }
        }
        return await this.uploadDirect(path, file);
      }

      // For web, use direct Firebase Storage upload
      return await this.uploadDirect(path, file);
    } catch (error: any) {
      console.error('Error in video upload:', error);
      this.logErrorDetails(error);
      throw new Error(`Video upload failed: ${this.getErrorMessage(error)}`);
    }
  }

  private async uploadDirect(path: string, file: File): Promise<string> {
    const storageRef = ref(this.storage, path);
    console.log('Storage reference created');

    const metadata = {
      contentType: file.type || 'image/jpeg',
      customMetadata: {
        'original-filename': file.name,
        'upload-timestamp': new Date().toISOString(),
      },
    };

    console.log('Uploading file to Firebase Storage...');
    await uploadBytes(storageRef, file, metadata);
    console.log('Upload completed successfully');

    let downloadUrl = await getDownloadURL(storageRef);
    console.log('Download URL obtained');

    downloadUrl = this.addCacheBustingParam(downloadUrl);
    console.log('Added cache-busting parameter to URL');
    return downloadUrl;
  }

  /**
   * Upload file using @capacitor-community/http plugin for iOS to avoid CORS issues
   */
  private async uploadViaCloudFunction(path: string, file: File): Promise<string> {
    console.log('Using Cloud Function with @capacitor-community/http');
    
    try {
      // Convert file to base64
      const base64Data = await this.fileToBase64(file);
      console.log('File converted to base64');
      
      // Extract base64 content (remove data:image/jpeg;base64, part)
      const base64Content = base64Data.split(',')[1];
      
      // Create metadata
      const metadata = {
        'original-filename': file.name,
        'upload-timestamp': new Date().toISOString(),
        'file-type': file.type.startsWith('video/') ? 'video' : 'image'
      };
      
      // Get the Firebase Storage reference for later use
      const storageRef = ref(this.storage, path);
      
      // Get the Cloud Function URL from environment configuration
      const functionUrl = `${environment.cloudFunctionsBaseUrl}/uploadFile`;
      console.log('Using Cloud Function URL:', functionUrl);
      
      // Get the current user's ID token for authentication
      const currentUser = this.auth.currentUser;
      if (!currentUser) {
        throw new Error('User not authenticated. Please log in before uploading files.');
      }
      
      // Get the Firebase ID token
      const idToken = await getIdToken(currentUser);
      console.log('Got ID token for authentication');
      
      // Determine timeout based on file size and type
      const fileSizeMB = file.size / (1024 * 1024);
      const isVideo = file.type.startsWith('video/');
      // For videos: 2 minutes per MB, minimum 60 seconds, max 540 seconds (9 minutes)
      // For images: 30 seconds default
      const timeout = isVideo 
        ? Math.min(Math.max(fileSizeMB * 120000, 60000), 540000)
        : 30000;
      
      console.log(`File size: ${fileSizeMB.toFixed(2)} MB, using timeout: ${timeout / 1000}s`);
      
      // Use @capacitor-community/http to call the Cloud Function
      console.log('Calling Cloud Function with @capacitor-community/http...');
      const response = await Http.request({
        method: 'POST',
        url: functionUrl,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        data: {
          data: {
            base64Data: base64Content,
            path: path,
            contentType: file.type || 'image/jpeg',
            metadata: metadata
          }
        },
        connectTimeout: timeout,
        readTimeout: timeout,
        responseType: 'json'
      });
      
      console.log('Cloud Function response status:', response.status);
      
      if (response.status < 200 || response.status >= 300) {
        console.error('Cloud Function response data:', response.data);
        throw new Error(`Cloud Function call failed with status ${response.status}`);
      }
      
      // Extract the download URL from the result
      const responseData = response.data;
      console.log('Cloud Function response:', responseData);
      
      // The response should contain a downloadUrl property
      let downloadUrl = responseData.result?.downloadUrl;
      if (!downloadUrl) {
        throw new Error('No download URL returned from Cloud Function');
      }
      
      console.log('Download URL obtained from Cloud Function:', downloadUrl);
      
      // Add cache-busting timestamp parameter to prevent caching issues
      downloadUrl = this.addCacheBustingParam(downloadUrl);
      console.log('Added cache-busting parameter to URL');
      
      return downloadUrl;
    } catch (error: any) {
      console.error('Error in Cloud Function upload:', error);
      this.logErrorDetails(error);
      throw new Error(`Cloud Function upload failed: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Convert a File object to base64 string
   */
  private fileToBase64(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  }
  
  /**
   * Log detailed error information
   */
  private logErrorDetails(error: any): void {
    if (error && typeof error === 'object') {
      if ('code' in error) console.error('Error code:', error.code);
      if ('message' in error) console.error('Error message:', error.message);
      if ('serverResponse' in error) console.error('Server response:', error.serverResponse);
      if ('stack' in error) console.error('Stack trace:', error.stack);
    }
  }

  /**
   * Extract error message from error object
   */
  private getErrorMessage(error: any): string {
    if (error && typeof error === 'object' && 'message' in error) {
      return error.message;
    }
    return 'Unknown error';
  }
  
  /**
   * Adds a cache-busting parameter to the URL to prevent caching issues
   * @param url The original URL
   * @returns URL with cache-busting parameter
   */
  private addCacheBustingParam(url: string): string {
    if (!url) return url;
    
    // Generate a unique timestamp
    const timestamp = Date.now();
    
    // Add cache buster parameter
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}t=${timestamp}`;
  }
}
