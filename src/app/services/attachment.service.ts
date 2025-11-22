import { Injectable, inject } from '@angular/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Platform, ToastController, ActionSheetController } from '@ionic/angular/standalone';

@Injectable({
  providedIn: 'root'
})
export class AttachmentService {
  private platform = inject(Platform);
  private toastCtrl = inject(ToastController);
  private actionSheetCtrl = inject(ActionSheetController);

  /**
   * Show an action sheet for selecting attachment options
   */
  async showAttachmentOptions(onTakePhoto: () => void, onChooseFile: () => void, onSelectFromLibrary: () => void) {
    const actionSheet = await this.actionSheetCtrl.create({
      header: 'Add Attachment',
      buttons: [
        {
          text: 'Take Photo',
          icon: 'camera',
          handler: onTakePhoto
        },
        {
          text: 'Choose File',
          icon: 'document-attach-outline',
          handler: onChooseFile
        },
        {
          text: 'Photo Library',
          icon: 'image-outline',
          handler: onSelectFromLibrary
        },
        {
          text: 'Cancel',
          icon: 'close-outline',
          role: 'cancel'
        }
      ]
    });
    
    await actionSheet.present();
    return actionSheet;
  }

  /**
   * Take a picture using the device camera
   */
  async takePicture(): Promise<File | null> {
    try {
      await this.showToast('Opening camera...');
      
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        correctOrientation: true
      });
      
      if (!image.base64String) {
        throw new Error('No image data received');
      }
      
      // Convert base64 to blob
      const blob = this.base64ToBlob(
        image.base64String,
        `image/${image.format || 'jpeg'}`
      );
      
      // Create a file from the blob
      const fileName = `photo_${Date.now()}.${image.format || 'jpeg'}`;
      const file = new File([blob], fileName, { type: `image/${image.format || 'jpeg'}` });
      
      await this.showToast('Photo captured successfully');
      return file;
    } catch (error: any) {
      console.error('Error taking picture:', error);
      if (error.message !== 'User cancelled photos app') {
        await this.showToast(error.message || 'Error taking picture', 2000, 'danger');
      }
      return null;
    }
  }

  /**
   * Select an image from the photo library
   */
  async selectFromPhotoLibrary(): Promise<File | null> {
    try {
      await this.showToast('Opening photo library...');
      
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: true,
        resultType: CameraResultType.Base64,
        source: CameraSource.Photos,
        correctOrientation: true
      });
      
      if (!image.base64String) {
        throw new Error('No image data received');
      }
      
      // Convert base64 to blob
      const blob = this.base64ToBlob(
        image.base64String,
        `image/${image.format || 'jpeg'}`
      );
      
      // Create a file from the blob
      const fileName = `photo_${Date.now()}.${image.format || 'jpeg'}`;
      const file = new File([blob], fileName, { type: `image/${image.format || 'jpeg'}` });
      
      await this.showToast('Photo selected successfully');
      return file;
    } catch (error: any) {
      console.error('Error selecting from photo library:', error);
      if (error.message !== 'User cancelled photos app') {
        await this.showToast(error.message || 'Failed to select photo', 2000, 'danger');
      }
      return null;
    }
  }

  /**
   * Select a document file (primarily for iOS)
   */
  async selectDocumentFile(): Promise<File | null> {
    try {
      await this.showToast('Opening document picker...');
      
      if (this.platform.is('capacitor')) {
        // Use the dedicated FilePicker plugin for proper document selection
        const result = await FilePicker.pickFiles({
          // Specify document types for iOS
          types: [
            'application/pdf', 
            'text/plain',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/csv'
          ],
          readData: true // Important: Read the file data directly
        });
        
        if (result && result.files && result.files.length > 0) {
          const fileData = result.files[0];
          
          // Check if we have the file data
          if (!fileData.data) {
            console.error('No file data received');
            await this.showToast('Could not read the selected document', 2000, 'danger');
            return null;
          }
          
          // Get the file name
          const fileName = fileData.name || 'document.pdf';
          
          // Create a blob from the base64 data
          const blob = this.base64ToBlob(
            fileData.data,
            fileData.mimeType || 'application/pdf'
          );
          
          // Create a File object
          const file = new File([blob], fileName, { 
            type: fileData.mimeType || 'application/pdf' 
          });
          
          await this.showToast('Document selected successfully');
          return file;
        }
      } else {
        // Web approach - create a file input element
        return await this.selectFileWeb();
      }
      
      return null;
    } catch (error: any) {
      console.error('Error selecting document:', error);
      
      // Handle permission errors specifically
      if (error.message && (
          error.message.includes('permission') || 
          error.message.includes('Permission') ||
          error.message.includes('denied') ||
          error.message.includes('Denied')
        )) {
        await this.showToast('File access permission denied. Please enable access in your device settings.', 3000, 'danger');
      } else {
        await this.showToast(error.message || 'Failed to select document', 2000, 'danger');
      }
      
      return null;
    }
  }

  /**
   * Select a file using the web file picker
   */
  async selectFileWeb(): Promise<File | null> {
    try {
      // Web approach - create a file input element
      const fileInput = window.document.createElement('input') as HTMLInputElement;
      fileInput.type = 'file';
      fileInput.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.gif';
      fileInput.style.display = 'none';
      window.document.body.appendChild(fileInput);
      
      // Create a promise that resolves when a file is selected
      const fileSelected = new Promise<File | null>((resolve, reject) => {
        fileInput.onchange = (e: Event) => {
          const target = e.target as HTMLInputElement;
          const files = target.files;
          
          if (files && files.length > 0) {
            resolve(files[0]);
          } else {
            resolve(null); // User canceled selection
          }
          
          // Clean up
          window.document.body.removeChild(fileInput);
        };
      });
      
      // Trigger file selection dialog
      fileInput.click();
      
      // Wait for file selection
      const file = await fileSelected;
      if (file) {
        await this.showToast('File selected successfully');
      }
      return file;
    } catch (error: any) {
      console.error('Error selecting file:', error);
      await this.showToast(error.message || 'Failed to select file', 2000, 'danger');
      return null;
    }
  }

  /**
   * Get the appropriate icon for a file type
   */
  getFileIcon(mimeType: string): string {
    if (mimeType.startsWith('image/')) {
      return 'image-outline';
    } else if (mimeType === 'application/pdf') {
      return 'document-text-outline';
    } else if (mimeType.includes('word') || mimeType.includes('document')) {
      return 'document-outline';
    } else if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      return 'grid-outline';
    } else {
      return 'document-attach-outline';
    }
  }

  /**
   * Show a toast message
   */
  async showToast(message: string, duration: number = 2000, color: string = 'primary') {
    const toast = await this.toastCtrl.create({
      message,
      duration,
      color
    });
    await toast.present();
    return toast;
  }

  /**
   * Convert base64 to Blob
   */
  private base64ToBlob(base64: string, contentType: string): Blob {
    const byteCharacters = atob(base64);
    const byteArrays = [];
    
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    
    return new Blob(byteArrays, { type: contentType });
  }
}
