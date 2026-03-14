import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavController } from '@ionic/angular';
import {
  IonAvatar,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBackOutline } from 'ionicons/icons';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { User } from 'firebase/auth';
import { UserService } from '../../services/account/user.service';

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
    IonAvatar,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonSpinner,
    IonText,
    IonTitle,
    IonToolbar,
  ],
})
export class ClientFindTrainerPage implements OnInit {
  private navCtrl = inject(NavController);
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);
  private userService = inject(UserService);

  trainers: TrainerCard[] = [];
  selectedTrainerUid = '';
  isLoading = false;
  isSaving = false;
  pendingTrainerUid = '';
  errorMessage = '';
  successMessage = '';

  readonly fallbackProfileImage = 'assets/user_icons/profilePhoto.svg';

  constructor() {
    addIcons({ arrowBackOutline });
  }

  ngOnInit(): void {
    void this.loadPage();
  }

  goBack(): void {
    this.navCtrl.navigateBack('/profile-user', {
      animated: true,
      animationDirection: 'back',
    });
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
    const usersSnap = await getDoc(usersRef);
    const usersData = usersSnap.exists()
      ? (usersSnap.data() as Record<string, unknown>)
      : {};

    const assignedTrainerUid = this.extractAssignedTrainerUid(usersData);
    if (!assignedTrainerUid) {
      this.selectedTrainerUid = '';
      return;
    }

    const trainerRef = doc(this.firestore, 'trainers', assignedTrainerUid);
    const trainerSnap = await getDoc(trainerRef);
    if (!trainerSnap.exists()) {
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
  }

  private async loadTrainers(): Promise<void> {
    const trainersSnap = await getDocs(collection(this.firestore, 'trainers'));
    const trainerEntries = trainersSnap.docs.map((trainerDoc) => ({
      uid: trainerDoc.id,
      data: trainerDoc.data() as Record<string, unknown>,
    }));

    const needsUserFallback = trainerEntries
      .filter(({ data }) => {
        const hasFirstName = this.pickString(data['firstName']).length > 0;
        const hasLastName = this.pickString(data['lastName']).length > 0;
        const hasProfileImage =
          this.pickString(data['profileImage']).length > 0 ||
          this.pickString(data['profilepic']).length > 0 ||
          this.pickString(data['profilePic']).length > 0;
        return !hasFirstName || !hasLastName || !hasProfileImage;
      })
      .map(({ uid }) => uid);

    const usersFallbackByUid = new Map<string, Record<string, unknown>>();
    await Promise.all(
      needsUserFallback.map(async (uid) => {
        const userSummary = await this.userService.getUserSummaryDirectly(uid);
        if (userSummary) {
          usersFallbackByUid.set(uid, userSummary as unknown as Record<string, unknown>);
        }
      })
    );

    this.trainers = trainerEntries
      .map(({ uid, data }) => {
        const usersFallback = usersFallbackByUid.get(uid) ?? {};
        const firstName =
          this.pickString(data['firstName']) ||
          this.pickString(usersFallback['firstName']) ||
          'Trainer';
        const lastName =
          this.pickString(data['lastName']) ||
          this.pickString(usersFallback['lastName']) ||
          '';
        const profileImage =
          this.pickString(data['profileImage']) ||
          this.pickString(data['profilepic']) ||
          this.pickString(data['profilePic']) ||
          this.pickString(usersFallback['profileImage']) ||
          this.pickString(usersFallback['profilepic']) ||
          this.pickString(usersFallback['profilePic']) ||
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
    const trainerSnap = await getDoc(doc(this.firestore, 'trainers', trainerUid));
    if (!trainerSnap.exists()) {
      throw new Error('Trainer not found');
    }

    const usersRef = doc(this.firestore, 'users', clientUid);
    const usersSnap = await getDoc(usersRef);
    const usersData = usersSnap.exists()
      ? (usersSnap.data() as Record<string, unknown>)
      : {};

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
  }

  private async ensureTrainerClientRecord(
    trainerUid: string,
    clientUid: string,
    usersData?: Record<string, unknown>
  ): Promise<void> {
    const trainerClientRef = doc(this.firestore, `trainers/${trainerUid}/clients/${clientUid}`);
    const trainerClientSnap = await getDoc(trainerClientRef);

    const [clientSnap, latestUsersSnap] = await Promise.all([
      getDoc(doc(this.firestore, 'clients', clientUid)),
      usersData ? Promise.resolve(null) : getDoc(doc(this.firestore, 'users', clientUid)),
    ]);

    const clientData = clientSnap.exists()
      ? (clientSnap.data() as Record<string, unknown>)
      : {};
    const resolvedUsersData =
      usersData ??
      (latestUsersSnap?.exists()
        ? (latestUsersSnap.data() as Record<string, unknown>)
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
