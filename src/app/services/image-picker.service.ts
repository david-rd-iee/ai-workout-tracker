import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

@Injectable({
  providedIn: 'root',
})
export class ImagePickerService {
  async pickImageFile(): Promise<File | null> {
    if (Capacitor.isNativePlatform()) {
      try {
        const photo = await Camera.getPhoto({
          source: CameraSource.Photos,
          resultType: CameraResultType.Uri,
          quality: 90,
        });

        if (!photo.webPath) {
          return null;
        }

        const response = await fetch(photo.webPath);
        const blob = await response.blob();
        const extension = (blob.type.split('/')[1] || 'jpg').toLowerCase();
        return new File([blob], `image.${extension}`, {
          type: blob.type || 'image/jpeg',
        });
      } catch (error) {
        console.error('[ImagePickerService] Native photo pick failed:', error);
        return null;
      }
    }

    return new Promise<File | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0] ?? null;
        resolve(file);
      };
      input.click();
    });
  }
}
