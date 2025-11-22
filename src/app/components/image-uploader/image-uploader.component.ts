import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { camera, cloudUploadOutline, imageOutline } from 'ionicons/icons';
import { addIcons } from 'ionicons';
import { Camera, CameraResultType, CameraSource, Photo } from '@capacitor/camera';
import { Platform } from '@ionic/angular/standalone';

@Component({
  selector: 'app-image-uploader',
  templateUrl: './image-uploader.component.html',
  styleUrls: ['./image-uploader.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class ImageUploaderComponent {
  @Input() currentImageUrl: string = '';
  @Output() imageSelected = new EventEmitter<File>();

  previewUrl: string | null = null;
  isCapacitor: boolean = false;

  constructor(private platform: Platform) { 
    addIcons({ 
      camera, 
      'cloud-upload': cloudUploadOutline,
      image: imageOutline 
    });
    this.isCapacitor = this.platform.is('capacitor');
  }
  
  /**
   * Handle image selection from file input (web)
   */
  async selectImage(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        this.previewUrl = e.target?.result as string;
      };
      reader.readAsDataURL(file);
      
      // Emit the file to parent
      this.imageSelected.emit(file);
    }
  }

  /**
   * Trigger file selection - either native camera/gallery on mobile or file input on web
   */
  async triggerFileInput() {
    if (this.isCapacitor) {
      await this.takePicture();
    } else {
      document.getElementById('fileInput')?.click();
    }
  }

  /**
   * Take a picture or select from gallery using Capacitor Camera plugin
   */
  async takePicture() {
    try {
      console.log('Starting takePicture process');
      
      // First check permissions
      const permissions = await Camera.checkPermissions();
      console.log('Current permissions:', permissions);
      
      // Request permissions if not granted
      if (permissions.camera !== 'granted' || permissions.photos !== 'granted') {
        console.log('Requesting camera and photos permissions');
        const requestResult = await Camera.requestPermissions({
          permissions: ['camera', 'photos']
        });
        console.log('Permission request result:', requestResult);
        
        // If permissions still not granted, alert the user and exit
        if (requestResult.camera !== 'granted' || requestResult.photos !== 'granted') {
          console.error('Camera or photos permission denied');
          alert('Camera and photo library permissions are required to upload images. Please enable them in your device settings.');
          return;
        }
      }
      
      console.log('Showing photo selection UI');
      // Use higher quality settings while maintaining compatibility
      const image = await Camera.getPhoto({
        quality: 100, // Higher quality for better image fidelity
        allowEditing: true, // Allow user to crop/edit the image
        resultType: CameraResultType.Base64, // Use Base64 for better iOS compatibility
        source: CameraSource.Prompt,
        width: 1200, // Higher resolution dimensions
        height: 1200,
        correctOrientation: true
      });

      console.log('Photo selected, processing image');
      if (image && image.base64String) {
        // Create preview from base64
        const dataUrl = `data:image/jpeg;base64,${image.base64String}`;
        this.previewUrl = dataUrl;
        console.log('Preview URL set');
        
        // Create a simple blob from the base64 string
        const byteCharacters = atob(image.base64String);
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
        
        const blob = new Blob(byteArrays, { type: 'image/jpeg' });
        console.log('Created blob:', blob.size, 'bytes');
        
        const file = new File([blob], 'profile-image.jpg', { type: 'image/jpeg' });
        console.log('Created file object:', file.name, file.size, 'bytes');
        
        // Emit the file to parent
        this.imageSelected.emit(file);
        console.log('File emitted to parent component');
      } else {
        console.error('No base64String in the image result');
      }
    } catch (error) {
      console.error('Error taking picture:', error);
      // User may have denied permission or cancelled
    }
  }

  /**
   * Convert a data URL to a Blob object
   */
  private dataUrlToBlob(dataUrl: string): Blob {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    
    return new Blob([u8arr], { type: mime });
  }
}
