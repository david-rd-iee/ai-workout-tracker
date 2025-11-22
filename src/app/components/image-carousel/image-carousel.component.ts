import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, close, camera, cloudUploadOutline, imageOutline } from 'ionicons/icons';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Platform } from '@ionic/angular/standalone';

export interface CarouselImage {
  id: string;
  url: string;
  file?: File;
}

@Component({
  selector: 'app-image-carousel',
  templateUrl: './image-carousel.component.html',
  styleUrls: ['./image-carousel.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class ImageCarouselComponent {
  @Input() images: CarouselImage[] = [];
  @Input() title: string = 'Photos';
  @Input() description: string = '';
  @Output() imagesChange = new EventEmitter<CarouselImage[]>();

  isCapacitor: boolean = false;
  private maxImages = 50;
  fileInputId: string = `fileInput-${Math.random().toString(36).substr(2, 9)}`;

  constructor(private platform: Platform) {
    addIcons({ 
      add, 
      close,
      camera, 
      'cloud-upload': cloudUploadOutline,
      image: imageOutline 
    });
    this.isCapacitor = this.platform.is('capacitor');
  }

  /**
   * Trigger file selection or camera on mobile
   */
  async addImage() {
    if (this.images.length >= this.maxImages) {
      return; // Silently prevent adding more images
    }

    if (this.isCapacitor) {
      await this.takePicture();
    } else {
      document.getElementById(this.fileInputId)?.click();
    }
  }

  /**
   * Handle image selection from file input (web)
   */
  async selectImage(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      if (this.images.length >= this.maxImages) {
        return; // Silently prevent adding more images
      }

      const file = input.files[0];
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        const newImage: CarouselImage = {
          id: this.generateId(),
          url: e.target?.result as string,
          file: file
        };
        this.images.push(newImage);
        this.imagesChange.emit(this.images);
      };
      reader.readAsDataURL(file);
    }
    
    // Reset input value to allow selecting the same file again
    input.value = '';
  }

  /**
   * Take a picture or select from gallery using Capacitor Camera plugin
   */
  async takePicture() {
    try {
      // Check permissions
      const permissions = await Camera.checkPermissions();
      
      // Request permissions if not granted
      if (permissions.camera !== 'granted' || permissions.photos !== 'granted') {
        const requestResult = await Camera.requestPermissions({
          permissions: ['camera', 'photos']
        });
        
        if (requestResult.camera !== 'granted' || requestResult.photos !== 'granted') {
          alert('Camera and photo library permissions are required to upload images. Please enable them in your device settings.');
          return;
        }
      }
      
      // Use higher quality settings
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: true,
        resultType: CameraResultType.Base64,
        source: CameraSource.Prompt,
        width: 1200,
        height: 1600, // Vertical aspect ratio
        correctOrientation: true
      });

      if (image && image.base64String) {
        // Create preview from base64
        const dataUrl = `data:image/jpeg;base64,${image.base64String}`;
        
        // Create blob from base64
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
        const file = new File([blob], `image-${Date.now()}.jpg`, { type: 'image/jpeg' });
        
        const newImage: CarouselImage = {
          id: this.generateId(),
          url: dataUrl,
          file: file
        };
        
        this.images.push(newImage);
        this.imagesChange.emit(this.images);
      }
    } catch (error) {
      console.error('Error taking picture:', error);
    }
  }

  /**
   * Remove an image from the carousel
   */
  removeImage(imageId: string) {
    this.images = this.images.filter(img => img.id !== imageId);
    this.imagesChange.emit(this.images);
  }

  /**
   * Generate a unique ID for images
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if we can add more images
   */
  canAddMore(): boolean {
    return this.images.length < this.maxImages;
  }
}
