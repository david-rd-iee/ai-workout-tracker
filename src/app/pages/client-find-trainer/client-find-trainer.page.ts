import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonAvatar,
  IonButton,
  IonContent,
  IonSpinner,
  IonText,
} from '@ionic/angular/standalone';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import {
  Firestore,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { User } from 'firebase/auth';
import { UserService } from '../../services/account/user.service';
import { ProfileRepositoryService } from '../../services/account/profile-repository.service';
import { HeaderComponent } from '../../components/header/header.component';

interface TrainerCard {
  uid: string;
  firstName: string;
  lastName: string;
  profileImage: string;
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

  trainers: TrainerCard[] = [];
  selectedTrainerUid = '';
  isLoading = false;
  isSaving = false;
  pendingTrainerUid = '';
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
    return !!this.selectedTrainerUid && this.selectedTrainerUid !== trainerUid;
  }

  isActionDisabled(trainerUid: string): boolean {
    return this.isSaving || this.isActionBlocked(trainerUid);
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
    this.pendingTrainerUid = trainer.uid;

    try {
      if (this.selectedTrainerUid === trainer.uid) {
        await this.removeTrainerAssignment(authUser.uid, trainer.uid);
        this.selectedTrainerUid = '';
        this.successMessage = 'Trainer removed.';
      } else {
        await this.addTrainerAssignment(authUser.uid, trainer.uid);
        this.selectedTrainerUid = trainer.uid;
        this.successMessage = 'Trainer added.';
      }
    } catch (error) {
      console.error('[ClientFindTrainerPage] Failed to update trainer assignment:', error);
      this.errorMessage = 'Could not update trainer assignment. Please try again.';
    } finally {
      this.isSaving = false;
      this.pendingTrainerUid = '';
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

    try {
      await this.syncExistingAssignment(authUser.uid);
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
      return;
    }

    this.selectedTrainerUid = assignedTrainerUid;

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

        return {
          uid,
          firstName,
          lastName,
          profileImage,
        };
      })
      .sort((a, b) => {
        const aName = `${a.firstName} ${a.lastName}`.trim().toLowerCase();
        const bName = `${b.firstName} ${b.lastName}`.trim().toLowerCase();
        return aName.localeCompare(bName);
      });
  }

  private async addTrainerAssignment(clientUid: string, trainerUid: string): Promise<void> {
    const trainerProfile = await this.userService.getUserProfileDirectly(trainerUid, 'trainer');
    if (!trainerProfile) {
      throw new Error('Trainer not found');
    }

    const usersRef = doc(this.firestore, 'users', clientUid);
    const userSummary = await this.userService.getUserSummaryDirectly(clientUid);
    const usersData = userSummary ? (userSummary as unknown as Record<string, unknown>) : {};

    await Promise.all([
      setDoc(
        usersRef,
        {
          trainerId: trainerUid,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
      setDoc(
        doc(this.firestore, 'clients', clientUid),
        {
          trainerId: trainerUid,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
    ]);
    this.profileRepository.applyUserSummaryPatch(clientUid, { trainerId: trainerUid });
    this.profileRepository.applyProfilePatch(clientUid, 'client', { trainerId: trainerUid });
    this.userService.syncCurrentUserSummaryPatch(clientUid, { trainerId: trainerUid });
    this.userService.syncCurrentUserProfilePatch(clientUid, 'client', { trainerId: trainerUid });

    await this.ensureTrainerClientRecord(trainerUid, clientUid, usersData);
  }

  private async removeTrainerAssignment(clientUid: string, trainerUid: string): Promise<void> {
    const trainerClientRef = doc(this.firestore, `trainers/${trainerUid}/clients/${clientUid}`);
    const usersRef = doc(this.firestore, 'users', clientUid);
    const clientRef = doc(this.firestore, 'clients', clientUid);

    await Promise.all([
      deleteDoc(trainerClientRef),
      setDoc(
        usersRef,
        {
          trainerId: '',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
      setDoc(
        clientRef,
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
}
