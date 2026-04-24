import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import type { CameraPermissionType } from '@capacitor/camera';

@Injectable({
  providedIn: 'root',
})
export class ImagePickerService {
  async pickImageFile(source: CameraSource = CameraSource.Photos): Promise<File | null> {
    if (Capacitor.isNativePlatform()) {
      try {
        const permissions = await Camera.checkPermissions();
        const requestedPermissions: CameraPermissionType[] =
          source === CameraSource.Camera ? ['camera'] : ['photos'];

        if (
          (source === CameraSource.Camera && permissions.camera !== 'granted') ||
          (source === CameraSource.Photos && permissions.photos !== 'granted')
        ) {
          const requestResult = await Camera.requestPermissions({
            permissions: requestedPermissions,
          });
          if (
            (source === CameraSource.Camera && requestResult.camera !== 'granted') ||
            (source === CameraSource.Photos && requestResult.photos !== 'granted')
          ) {
            return null;
          }
        }

        const photo = await Camera.getPhoto({
          source,
          resultType: CameraResultType.Uri,
          quality: 90,
        });

        const imageUrl = String(photo.webPath ?? photo.path ?? '').trim();
        if (!imageUrl) {
          return null;
        }

        const response = await fetch(imageUrl);
        if (!response.ok) {
          return null;
        }
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
      if (source === CameraSource.Camera) {
        input.capture = 'environment';
      }
      input.onchange = () => {
        const file = input.files?.[0] ?? null;
        resolve(file);
      };
      input.click();
    });
  }
}
