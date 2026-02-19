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
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonSearchbar,
  IonTitle,
  IonToolbar,
  LoadingController,
  ToastController,
} from '@ionic/angular/standalone';
import {
  Firestore,
  arrayRemove,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  updateDoc,
} from '@angular/fire/firestore';
import { Storage, deleteObject, ref } from '@angular/fire/storage';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { addOutline, arrowBackOutline, imageOutline, removeOutline } from 'ionicons/icons';
import { AccountService } from '../../services/account/account.service';
import { FileUploadService } from '../../services/file-upload.service';
import { ImagePickerService } from '../../services/image-picker.service';
import { ChatsService } from '../../services/chats.service';

type GroupMember = {
  uid: string;
  username: string;
};

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
    IonInput,
    IonModal,
    IonSearchbar,
    IonList,
    IonItem,
    IonLabel,
    FormsModule,
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
  private chatsService = inject(ChatsService);
  private alertCtrl = inject(AlertController);
  private loadingCtrl = inject(LoadingController);
  private toastCtrl = inject(ToastController);

  groupId = '';
  groupName = 'Group';
  groupNameDraft = '';
  ownerUserId = '';
  groupImageUrl = '';
  canEditGroup = false;
  groupUserIds: string[] = [];
  allUsers: GroupMember[] = [];
  memberUsers: GroupMember[] = [];
  addUserModalOpen = false;
  userSearchQuery = '';
  loadingUsers = false;

  constructor() {
    addIcons({ arrowBackOutline, imageOutline, addOutline, removeOutline });
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

      this.groupName = typeof groupData?.name === 'string' ? groupData.name : 'Group';
      this.groupNameDraft = this.groupName;
      this.ownerUserId = ownerUserId;
      this.canEditGroup = !!currentUserId && ownerUserId === currentUserId;
      this.groupImageUrl = typeof groupData?.groupImage === 'string' ? groupData.groupImage : '';
      this.groupUserIds = Array.isArray(groupData?.userIDs) ? groupData.userIDs : [];
      await this.ensureAllUsersLoaded();
      this.refreshMemberUsers();
    } catch (error) {
      console.error('[GroupSettingsPage] Failed to load group:', error);
      this.canEditGroup = false;
      this.groupImageUrl = '';
      this.groupUserIds = [];
      this.memberUsers = [];
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

  get filteredCandidateUsers(): GroupMember[] {
    const q = this.userSearchQuery.trim().toLowerCase();
    const currentUid = this.accountService.getCredentials()().uid;
    const base = this.allUsers.filter(
      (user) => !this.groupUserIds.includes(user.uid) && user.uid !== currentUid
    );

    if (!q) {
      return base.slice(0, 40);
    }

    return base
      .filter((user) => user.username.toLowerCase().includes(q))
      .slice(0, 40);
  }

  async openAddUserModal(): Promise<void> {
    if (!this.canEditGroup) {
      return;
    }

    await this.ensureAllUsersLoaded();
    this.userSearchQuery = '';
    this.addUserModalOpen = true;
  }

  closeAddUserModal(): void {
    this.addUserModalOpen = false;
  }

  async inviteUser(user: GroupMember): Promise<void> {
    const senderId = this.accountService.getCredentials()().uid;
    if (!senderId || !this.groupId) {
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Sending invite...',
    });
    await loading.present();

    try {
      const chatId = await this.chatsService.findOrCreateDirectChat(senderId, user.uid);
      await this.chatsService.sendGroupInvite(
        chatId,
        senderId,
        user.uid,
        this.groupId,
        this.groupName
      );

      this.closeAddUserModal();
      await this.showToast(`Invite sent to @${user.username}.`);
    } catch (error) {
      console.error('[GroupSettingsPage] Failed to send invite:', error);
      await this.showToast('Could not send invite.');
    } finally {
      await loading.dismiss();
    }
  }

  async saveGroupName(): Promise<void> {
    if (!this.canEditGroup || !this.groupId) {
      return;
    }

    const nextName = this.groupNameDraft.trim();
    if (!nextName) {
      await this.showToast('Group name cannot be empty.');
      this.groupNameDraft = this.groupName;
      return;
    }

    if (nextName === this.groupName) {
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Updating group name...',
    });
    await loading.present();

    try {
      const groupRef = doc(this.firestore, 'groupID', this.groupId);
      await updateDoc(groupRef, {
        name: nextName,
        updatedAt: serverTimestamp(),
      });

      this.groupName = nextName;
      this.groupNameDraft = nextName;
      await this.showToast('Group name updated.');
    } catch (error) {
      console.error('[GroupSettingsPage] Failed to update group name:', error);
      this.groupNameDraft = this.groupName;
      await this.showToast('Could not update group name.');
    } finally {
      await loading.dismiss();
    }
  }

  canRemoveMember(member: GroupMember): boolean {
    return this.canEditGroup && member.uid !== this.ownerUserId;
  }

  async promptRemoveMember(member: GroupMember): Promise<void> {
    if (!this.canRemoveMember(member)) {
      return;
    }

    const alert = await this.alertCtrl.create({
      header: 'Remove User',
      message: `Are you sure you want to remove @${member.username} from this group?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Yes',
          role: 'destructive',
          handler: () => {
            void this.removeMember(member);
          },
        },
      ],
    });

    await alert.present();
  }

  private async removeMember(member: GroupMember): Promise<void> {
    if (!this.groupId) {
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Removing user...',
    });
    await loading.present();

    try {
      const groupRef = doc(this.firestore, 'groupID', this.groupId);
      await updateDoc(groupRef, {
        userIDs: arrayRemove(member.uid),
        updatedAt: serverTimestamp(),
      });

      const userRef = doc(this.firestore, 'users', member.uid);
      await updateDoc(userRef, {
        groupID: arrayRemove(this.groupId),
      });

      this.groupUserIds = this.groupUserIds.filter((id) => id !== member.uid);
      this.refreshMemberUsers();
      await this.showToast(`Removed @${member.username}.`);
    } catch (error) {
      console.error('[GroupSettingsPage] Failed to remove member:', error);
      await this.showToast('Could not remove user.');
    } finally {
      await loading.dismiss();
    }
  }

  private async ensureAllUsersLoaded(): Promise<void> {
    if (this.allUsers.length > 0 || this.loadingUsers) {
      return;
    }

    this.loadingUsers = true;
    try {
      const usersSnap = await getDocs(collection(this.firestore, 'users'));
      this.allUsers = usersSnap.docs
        .map((userDoc) => {
          const data = userDoc.data() as any;
          const usernameRaw = typeof data?.username === 'string' ? data.username.trim() : '';
          if (!usernameRaw) return null;
          return {
            uid: userDoc.id,
            username: usernameRaw,
          } satisfies GroupMember;
        })
        .filter((user): user is GroupMember => !!user)
        .sort((a, b) => a.username.localeCompare(b.username));
    } finally {
      this.loadingUsers = false;
    }
  }

  private refreshMemberUsers(): void {
    const usersById = new Map(this.allUsers.map((user) => [user.uid, user]));
    this.memberUsers = this.groupUserIds.map((uid) => {
      const existing = usersById.get(uid);
      if (existing) return existing;
      return {
        uid,
        username: uid,
      };
    });
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
