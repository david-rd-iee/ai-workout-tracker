import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import {
  AlertController,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonTitle,
  IonToolbar,
  LoadingController,
  ToastController,
} from '@ionic/angular/standalone';
import { Firestore, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { Storage, deleteObject, ref } from '@angular/fire/storage';
import { addIcons } from 'ionicons';
import { arrowBackOutline, imageOutline } from 'ionicons/icons';
import { AccountService } from '../services/account/account.service';
import { FileUploadService } from '../services/file-upload.service';
import { ImagePickerService } from '../services/image-picker.service';

@Component({
  selector: 'app-group-settings',
  templateUrl: './group-settings.page.html',
  styleUrls: ['./group-settings.page.scss'],
  standalone: true,
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    CommonModule,
  ],
})
export class GroupSettingsPage implements OnInit {
  private route = inject(ActivatedRoute);
  private navCtrl = inject(NavController);
  private firestore = inject(Firestore);
  private accountService = inject(AccountService);
  private storage = inject(Storage);
  private fileUploadService = inject(FileUploadService);
  private imagePickerService = inject(ImagePickerService);
  private alertCtrl = inject(AlertController);
  private loadingCtrl = inject(LoadingController);
  private toastCtrl = inject(ToastController);

  groupId = '';
  groupImageUrl = '';
  canEditGroup = false;

  constructor() {
    addIcons({ arrowBackOutline, imageOutline });
  }

  ngOnInit(): void {
    this.groupId = this.route.snapshot.paramMap.get('groupID') ?? '';
    void this.loadGroup();
  }

  goBack(): void {
    if (!this.groupId) {
      this.navCtrl.navigateBack('/groups', {
        animated: true,
        animationDirection: 'back',
      });
      return;
    }

    this.navCtrl.navigateBack(`/leaderboard/${this.groupId}`, {
      animated: true,
      animationDirection: 'back',
    });
  }

  async onGroupImageClick(): Promise<void> {
    if (!this.groupId || !this.canEditGroup) {
      return;
    }

    let shouldChangeImage = false;
    const alert = await this.alertCtrl.create({
      header: 'Group Image',
      message: 'Would you like to change this group image?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Change Image',
          handler: () => {
            shouldChangeImage = true;
          },
        },
      ],
    });

    await alert.present();
    await alert.onDidDismiss();

    if (shouldChangeImage) {
      await this.changeGroupImage();
    }
  }

  private async loadGroup(): Promise<void> {
    if (!this.groupId) {
      this.canEditGroup = false;
      this.groupImageUrl = '';
      return;
    }

    try {
      const groupRef = doc(this.firestore, 'groupID', this.groupId);
      const groupSnap = await getDoc(groupRef);

      if (!groupSnap.exists()) {
        this.canEditGroup = false;
        this.groupImageUrl = '';
        return;
      }

      const groupData = groupSnap.data() as any;
      const ownerUserId = typeof groupData?.ownerUserId === 'string' ? groupData.ownerUserId.trim() : '';
      const currentUserId = this.accountService.getCredentials()().uid;

      this.canEditGroup = !!currentUserId && ownerUserId === currentUserId;
      this.groupImageUrl = typeof groupData?.groupImage === 'string' ? groupData.groupImage : '';
    } catch (error) {
      console.error('[GroupSettingsPage] Failed to load group:', error);
      this.canEditGroup = false;
      this.groupImageUrl = '';
    }
  }

  private async changeGroupImage(): Promise<void> {
    const file = await this.imagePickerService.pickImageFile();
    if (!file) {
      return;
    }

    const previousImageUrl = this.groupImageUrl;
    const localPreviewUrl = URL.createObjectURL(file);
    this.groupImageUrl = localPreviewUrl;

    const loading = await this.loadingCtrl.create({
      message: 'Updating group image...',
    });
    await loading.present();

    try {
      const sanitizedName = file.name.replace(/\s+/g, '_');
      const storagePath = `group-images/${this.groupId}/${Date.now()}_${sanitizedName}`;
      const downloadUrl = await this.fileUploadService.uploadFile(storagePath, file);

      const groupRef = doc(this.firestore, 'groupID', this.groupId);
      await setDoc(
        groupRef,
        {
          groupImage: downloadUrl,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const oldRemoteImageUrl = this.normalizeImageUrl(previousImageUrl);
      if (oldRemoteImageUrl && oldRemoteImageUrl !== downloadUrl) {
        await this.deleteExistingGroupImage(oldRemoteImageUrl);
      }

      this.groupImageUrl = downloadUrl;
      await this.showToast('Group image updated.');
    } catch (error) {
      console.error('[GroupSettingsPage] Failed to update group image:', error);
      this.groupImageUrl = previousImageUrl;
      const message = error instanceof Error ? error.message : 'Please try again.';
      await this.showToast(`Failed to update group image: ${message}`);
    } finally {
      URL.revokeObjectURL(localPreviewUrl);
      await loading.dismiss();
    }
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'bottom',
    });
    await toast.present();
  }

  private normalizeImageUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith('blob:')) return null;
    return trimmed;
  }

  private async deleteExistingGroupImage(url: string): Promise<void> {
    const storagePath = this.extractStoragePathFromDownloadUrl(url);
    if (!storagePath) {
      return;
    }

    try {
      const imageRef = ref(this.storage, storagePath);
      await deleteObject(imageRef);
    } catch (error) {
      console.warn('[GroupSettingsPage] Failed to delete old group image:', error);
    }
  }

  private extractStoragePathFromDownloadUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const marker = '/o/';
      const idx = parsed.pathname.indexOf(marker);
      if (idx === -1) {
        return null;
      }

      const encodedPath = parsed.pathname.substring(idx + marker.length);
      return decodeURIComponent(encodedPath);
    } catch {
      return null;
    }
  }
}
