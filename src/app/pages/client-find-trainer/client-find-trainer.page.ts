import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AlertController,
  IonAvatar,
  IonButton,
  IonContent,
  IonSpinner,
  IonText,
  ToastController,
} from '@ionic/angular/standalone';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  getDocs,
  getDoc,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { User } from 'firebase/auth';
import { UserService } from '../../services/account/user.service';
import { ProfileRepositoryService } from '../../services/account/profile-repository.service';
import { HeaderComponent } from '../../components/header/header.component';
import { TrainerConnectionService } from '../../services/trainer-connection.service';

interface TrainerCard {
  uid: string;
  firstName: string;
  lastName: string;
  profileImage: string;
  specialization: string;
  experience: string;
  education: string;
  description: string;
  certifications: string[];
  hourlyRate: string;
  trainingFormats: string[];
  city: string;
  state: string;
  visible: boolean;
}

@Component({
  selector: 'app-client-find-trainer',
  templateUrl: './client-find-trainer.page.html',
  styleUrls: ['./client-find-trainer.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    IonAvatar,
    IonButton,
    IonContent,
    IonSpinner,
    IonText,
  ],
})
export class ClientFindTrainerPage implements OnInit {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);
  private userService = inject(UserService);
  private profileRepository = inject(ProfileRepositoryService);
  private trainerConnectionService = inject(TrainerConnectionService);
  private alertController = inject(AlertController);
  private toastController = inject(ToastController);

  trainers: TrainerCard[] = [];
  selectedTrainerUid = '';
  isLoading = false;
  isSaving = false;
  pendingTrainerUid = '';
  pendingRequestTargetUid = '';
  pendingRequestMessage = '';
  declinedTrainerUid = '';
  requestDrafts: Record<string, string> = {};
  expandedTrainerUid = '';
  errorMessage = '';
  successMessage = '';

  readonly fallbackProfileImage = 'assets/user_icons/profilePhoto.svg';

  ngOnInit(): void {
    void this.loadPage();
  }

  trackTrainer(_: number, trainer: TrainerCard): string {
    return trainer.uid;
  }

  isActionBlocked(trainerUid: string): boolean {
    const activeTrainerUid = this.selectedTrainerUid || this.pendingTrainerUid;
    return !!activeTrainerUid && activeTrainerUid !== trainerUid;
  }

  isActionDisabled(trainerUid: string): boolean {
    return this.isSaving || this.isActionBlocked(trainerUid);
  }

  getRequestDraft(trainerUid: string): string {
    return this.requestDrafts[trainerUid] || '';
  }

  updateRequestDraft(trainerUid: string, event: Event): void {
    const target = event.target as HTMLTextAreaElement | null;
    this.requestDrafts[trainerUid] = target?.value || '';
  }

  toggleTrainerDetails(trainerUid: string): void {
    this.expandedTrainerUid = this.expandedTrainerUid === trainerUid ? '' : trainerUid;
  }

  async onTrainerAction(trainer: TrainerCard): Promise<void> {
    if (this.isActionDisabled(trainer.uid)) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';

    const authUser = await this.resolveCurrentUser();
    if (!authUser) {
      this.errorMessage = 'You must be logged in to update your trainer.';
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }

    this.isSaving = true;
    this.pendingRequestTargetUid = trainer.uid;

    try {
      if (this.selectedTrainerUid === trainer.uid) {
        const removalReason = await this.promptForRemovalReason(trainer);
        if (removalReason === null) {
          return;
        }

        await this.removeTrainerAssignment(authUser.uid, trainer.uid, removalReason);
        this.selectedTrainerUid = '';
        this.declinedTrainerUid = '';
        this.successMessage = 'Trainer removed.';
      } else if (this.pendingTrainerUid === trainer.uid) {
        await this.trainerConnectionService.cancelConnectionRequest(authUser.uid, trainer.uid);
        this.pendingTrainerUid = '';
        this.pendingRequestMessage = '';
        this.successMessage = 'Trainer request cancelled.';
      } else {
        const requestMessage = this.getRequestDraft(trainer.uid).trim();

        await this.trainerConnectionService.submitConnectionRequest(
          authUser.uid,
          trainer.uid,
          requestMessage
        );
        this.pendingTrainerUid = trainer.uid;
        this.pendingRequestMessage = requestMessage;
        this.requestDrafts[trainer.uid] = '';
        this.declinedTrainerUid = '';
        this.successMessage = 'Trainer request sent for approval.';
      }
    } catch (error) {
      console.error('[ClientFindTrainerPage] Failed to update trainer assignment:', error);
      this.errorMessage = 'Could not update trainer assignment. Please try again.';
    } finally {
      this.isSaving = false;
      this.pendingRequestTargetUid = '';
    }
  }

  onImageError(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (!image) {
      return;
    }
    image.src = this.fallbackProfileImage;
  }

  private async loadPage(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const authUser = await this.resolveCurrentUser();
    if (!authUser) {
      this.errorMessage = 'You must be logged in to find a trainer.';
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      this.isLoading = false;
      return;
    }

    await this.userService.loadUserProfile();
    if (this.userService.getUserInfo()()?.demoMode === true) {
      // Demo users are already assigned a trainer, so we send them back to the normal client flow.
      await this.presentDemoRedirectToast();
      await this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
      this.isLoading = false;
      return;
    }

    try {
      await this.syncExistingAssignment(authUser.uid);
      await this.syncExistingRequestStatus(authUser.uid);
      await this.loadTrainers();
    } catch (error) {
      console.error('[ClientFindTrainerPage] Failed to load trainers:', error);
      this.errorMessage = 'Failed to load trainers.';
    } finally {
      this.isLoading = false;
    }
  }

  private async syncExistingAssignment(clientUid: string): Promise<void> {
    const usersRef = doc(this.firestore, 'users', clientUid);
    const userSummary = await this.userService.getUserSummaryDirectly(clientUid);
    const usersData = userSummary ? (userSummary as unknown as Record<string, unknown>) : {};

    const assignedTrainerUid = this.extractAssignedTrainerUid(usersData);
    if (!assignedTrainerUid) {
      this.selectedTrainerUid = '';
      return;
    }

    const trainerProfile = await this.userService.getUserProfileDirectly(assignedTrainerUid, 'trainer');
    if (!trainerProfile) {
      await Promise.all([
        setDoc(
          usersRef,
          {
            trainerId: '',
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ),
        setDoc(
          doc(this.firestore, 'clients', clientUid),
          {
            trainerId: '',
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ),
      ]);
      this.profileRepository.applyUserSummaryPatch(clientUid, { trainerId: '' });
      this.profileRepository.applyProfilePatch(clientUid, 'client', { trainerId: '' });
      this.userService.syncCurrentUserSummaryPatch(clientUid, { trainerId: '' });
      this.userService.syncCurrentUserProfilePatch(clientUid, 'client', { trainerId: '' });
      this.selectedTrainerUid = '';
      this.pendingTrainerUid = '';
      this.pendingRequestMessage = '';
      this.declinedTrainerUid = '';
      return;
    }

    this.selectedTrainerUid = assignedTrainerUid;
    this.pendingTrainerUid = '';
    this.pendingRequestMessage = '';
    this.declinedTrainerUid = '';

    await Promise.all([
      setDoc(
        doc(this.firestore, 'clients', clientUid),
        {
          trainerId: assignedTrainerUid,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
      this.ensureTrainerClientRecord(assignedTrainerUid, clientUid, usersData),
    ]);
    this.profileRepository.applyUserSummaryPatch(clientUid, { trainerId: assignedTrainerUid });
    this.profileRepository.applyProfilePatch(clientUid, 'client', { trainerId: assignedTrainerUid });
    this.userService.syncCurrentUserSummaryPatch(clientUid, { trainerId: assignedTrainerUid });
    this.userService.syncCurrentUserProfilePatch(clientUid, 'client', { trainerId: assignedTrainerUid });
  }

  private async syncExistingRequestStatus(clientUid: string): Promise<void> {
    if (this.selectedTrainerUid) {
      this.pendingTrainerUid = '';
      this.pendingRequestMessage = '';
      this.declinedTrainerUid = '';
      return;
    }

    const requestsSnapshot = await getDocs(collection(this.firestore, `clients/${clientUid}/trainerRequests`));
    this.pendingTrainerUid = '';
    this.pendingRequestMessage = '';
    this.declinedTrainerUid = '';

    requestsSnapshot.forEach((requestDoc) => {
      const requestData = requestDoc.data() as Record<string, unknown>;
      const status = this.pickString(requestData['status']);

      if (status === 'pending' && !this.pendingTrainerUid) {
        this.pendingTrainerUid = requestDoc.id;
        this.pendingRequestMessage = this.pickString(requestData['message']);
      }

      if (status === 'declined' && !this.declinedTrainerUid) {
        this.declinedTrainerUid = requestDoc.id;
      }
    });
  }

  private async loadTrainers(): Promise<void> {
    const trainerProfiles = await this.profileRepository.listProfiles('trainer');

    this.trainers = trainerProfiles
      .map((trainerProfile) => {
        const data = trainerProfile as unknown as Record<string, unknown>;
        const uid = this.pickString(data['id']) || this.pickString(data['userId']);
        const firstName =
          this.pickString(data['firstName']) ||
          'Trainer';
        const lastName =
          this.pickString(data['lastName']) ||
          '';
        const profileImage =
          this.pickString(data['profileImage']) ||
          this.pickString(data['profilepic']) ||
          this.pickString(data['profilePic']) ||
          this.fallbackProfileImage;
        const certifications = Array.isArray(data['certifications'])
          ? (data['certifications'] as unknown[])
              .map((value) => this.pickString(value))
              .filter(Boolean)
          : [];
        const trainingLocation =
          typeof data['trainingLocation'] === 'object' && data['trainingLocation'] !== null
            ? (data['trainingLocation'] as Record<string, unknown>)
            : {};
        const trainingFormats = [
          trainingLocation['remote'] === true ? 'Remote' : '',
          trainingLocation['inPerson'] === true ? 'In person' : '',
        ].filter(Boolean);
        const hourlyRateValue =
          typeof data['hourlyRate'] === 'number' && Number.isFinite(data['hourlyRate'])
            ? `$${Number(data['hourlyRate']).toFixed(0)}/hr`
            : '';

        return {
          uid,
          firstName,
          lastName,
          profileImage,
          specialization: this.pickString(data['specialization']),
          experience: this.pickString(data['experience']),
          education: this.pickString(data['education']),
          description: this.pickString(data['description']),
          certifications,
          hourlyRate: hourlyRateValue,
          trainingFormats,
          city: this.pickString(data['city']),
          state: this.pickString(data['state']),
          visible: data['visible'] !== false,
        };
      })
      .filter((trainer) => trainer.uid && trainer.visible)
      .sort((a, b) => {
        const aName = `${a.firstName} ${a.lastName}`.trim().toLowerCase();
        const bName = `${b.firstName} ${b.lastName}`.trim().toLowerCase();
        return aName.localeCompare(bName);
      });
  }

  private async addTrainerAssignment(clientUid: string, trainerUid: string): Promise<void> {
    await this.trainerConnectionService.submitConnectionRequest(clientUid, trainerUid, '');
  }

  private async removeTrainerAssignment(clientUid: string, trainerUid: string, reason: string): Promise<void> {
    await this.trainerConnectionService.removeConnection(clientUid, trainerUid, reason);
    this.profileRepository.applyUserSummaryPatch(clientUid, { trainerId: '' });
    this.profileRepository.applyProfilePatch(clientUid, 'client', { trainerId: '' });
    this.userService.syncCurrentUserSummaryPatch(clientUid, { trainerId: '' });
    this.userService.syncCurrentUserProfilePatch(clientUid, 'client', { trainerId: '' });
  }

  private async promptForRemovalReason(trainer: TrainerCard): Promise<string | null> {
    const alert = await this.alertController.create({
      header: 'Remove Trainer',
      message: `Let us know why you are removing ${trainer.firstName} ${trainer.lastName}.`,
      inputs: [
        {
          name: 'reason',
          type: 'textarea',
          placeholder: 'Share your reason so it can be reviewed later.',
          attributes: {
            maxlength: 300,
          },
        },
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Remove',
          handler: (value) => {
            const reason = this.pickString(value?.reason);
            if (!reason) {
              this.errorMessage = 'Please add a reason before removing your trainer.';
              return false;
            }

            this.errorMessage = '';
            return true;
          },
        },
      ],
    });

    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    if (role === 'cancel') {
      return null;
    }

    return this.pickString(data?.values?.reason) || null;
  }

  private async ensureTrainerClientRecord(
    trainerUid: string,
    clientUid: string,
    usersData?: Record<string, unknown>
  ): Promise<void> {
    const trainerClientRef = doc(this.firestore, `trainers/${trainerUid}/clients/${clientUid}`);
    const trainerClientSnap = await getDoc(trainerClientRef);

    const [clientProfile, latestUsersData] = await Promise.all([
      this.userService.getUserProfileDirectly(clientUid, 'client'),
      usersData ? Promise.resolve(null) : this.userService.getUserSummaryDirectly(clientUid),
    ]);

    const clientData = clientProfile
      ? (clientProfile as unknown as Record<string, unknown>)
      : {};
    const resolvedUsersData =
      usersData ??
      (latestUsersData
        ? (latestUsersData as unknown as Record<string, unknown>)
        : {});

    const firstName =
      this.pickString(resolvedUsersData['firstName']) || this.pickString(clientData['firstName']);
    const lastName =
      this.pickString(resolvedUsersData['lastName']) || this.pickString(clientData['lastName']);
    const clientEmail =
      this.pickString(clientData['email']) || this.pickString(resolvedUsersData['email']);
    const profilepic =
      this.pickString(resolvedUsersData['profilepic']) ||
      this.pickString(resolvedUsersData['profileImage']) ||
      this.pickString(clientData['profilepic']) ||
      this.pickString(clientData['profileImage']) ||
      this.fallbackProfileImage;
    const joinedDate =
      this.pickString((trainerClientSnap.exists() ? trainerClientSnap.data() : {})?.['joinedDate']) ||
      new Date().toISOString();

    await setDoc(
      trainerClientRef,
      {
        clientId: clientUid,
        firstName,
        lastName,
        clientName: `${firstName} ${lastName}`.trim(),
        clientEmail,
        profilepic,
        joinedDate,
        ...(trainerClientSnap.exists() ? {} : { createdAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  private extractAssignedTrainerUid(userData: Record<string, unknown>): string {
    return this.pickString(userData['trainerId']);
  }

  private pickString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private async resolveCurrentUser(): Promise<User | null> {
    if (this.auth.currentUser) {
      return this.auth.currentUser;
    }

    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(this.auth, (user) => {
        unsubscribe();
        resolve(user);
      });
    });
  }

  private async presentDemoRedirectToast(): Promise<void> {
    const toast = await this.toastController.create({
      message: 'Demo users are automatically assigned a trainer.',
      duration: 2200,
      position: 'top',
      color: 'medium',
    });
    await toast.present();
  }
}
