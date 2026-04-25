import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { IonContent, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonButton, IonIcon, IonSegment, IonSegmentButton, IonLabel, ModalController, ToastController } from '@ionic/angular/standalone';
import { NavController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { calendar, personCircle, fitness, card, createOutline, trophy, chatbubbles, checkmarkCircle, flag, walk, documentTextOutline } from 'ionicons/icons';
import { WorkoutBuilderModalComponent } from 'src/app/components/modals/workout-builder-modal/workout-builder-modal.component';
import { AppointmentSchedulerModalComponent } from 'src/app/components/modals/appointment-scheduler-modal/appointment-scheduler-modal.component';
import { HomeCustomizationModalComponent } from 'src/app/components/modals/home-customization-modal/home-customization-modal.component';
import { AgreementModalComponent } from 'src/app/components/agreements/agreement-modal/agreement-modal.component';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where
} from '@angular/fire/firestore';
import { NotificationService } from '../../services/notification.service';
import { AgreementService } from '../../services/agreement.service';
import { Agreement } from 'src/app/Interfaces/Agreement';

type VerifyFieldKey = 'heightMeters' | 'weightKg' | 'age';
type VerifyChoice = 'true' | 'false' | null;

interface TrainerWorkoutExerciseDraft {
  name?: string;
  sets?: number;
  reps?: string;
  weight?: string;
  notes?: string;
}

interface TrainerWorkoutDraft {
  name?: string;
  description?: string;
  exercises?: TrainerWorkoutExerciseDraft[];
}

type StripePaymentDisplayStatus = 'paid' | 'pending' | 'failed';

interface PaymentHistoryEntry {
  amount: number;
  date: Date | null;
  method: string;
  status: StripePaymentDisplayStatus;
}

@Component({
  selector: 'app-client-details',
  standalone: true,
  templateUrl: './client-details.page.html',
  styleUrls: ['./client-details.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonButton,
    IonIcon,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    HeaderComponent,
  ],
})
export class ClientDetailsPage implements OnInit {
  private readonly verifyFieldOrder: VerifyFieldKey[] = ['heightMeters', 'weightKg', 'age'];
  private readonly verifyFieldLabels: Record<VerifyFieldKey, string> = {
    heightMeters: 'Height',
    weightKg: 'Weight',
    age: 'Age',
  };
  private readonly verifyFieldUnits: Record<VerifyFieldKey, string> = {
    heightMeters: 'm',
    weightKg: 'kg',
    age: 'years',
  };

  private router = inject(Router);
  private navCtrl = inject(NavController);
  private modalController = inject(ModalController);
  private toastController = inject(ToastController);
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private notificationService = inject(NotificationService);
  private agreementService = inject(AgreementService);
  private sanitizer = inject(DomSanitizer);

  client: any = null;
  selectedTab: string = 'sessions';

  // Overview stats
  currentStreak: number = 0;
  paymentStatus: string = 'N/A';

  recentActivity: any[] = [];

  // Appointments and payments
  upcomingAppointments: any[] = [];
  pastAppointments: any[] = [];
  payments: PaymentHistoryEntry[] = [];
  currentAgreement: Agreement | null = null;
  isLoadingCurrentAgreement = false;
  isLoadingCurrentAgreementPreview = false;
  currentAgreementPreviewUrl: SafeResourceUrl | null = null;
  currentAgreementPreviewError = '';
  isAgreementPreviewOpen = false;

  isVerifyStatsModalOpen = false;
  isLoadingVerifyStats = false;
  isSubmittingVerifyStats = false;

  verifyStatsValues: Record<VerifyFieldKey, number | null> = {
    heightMeters: null,
    weightKg: null,
    age: null,
  };
  verifyChoices: Record<VerifyFieldKey, VerifyChoice> = {
    heightMeters: null,
    weightKg: null,
    age: null,
  };
  verifyCorrections: Record<VerifyFieldKey, string> = {
    heightMeters: '',
    weightKg: '',
    age: '',
  };

  constructor() {
    addIcons({ calendar, personCircle, fitness, card, createOutline, trophy, chatbubbles, checkmarkCircle, flag, walk, documentTextOutline });

    // Get client data from navigation state
    const navigation = this.router.getCurrentNavigation();
    if (navigation?.extras?.state) {
      this.client = navigation.extras.state['client'];
    }
  }

  ngOnInit() {
    // Get client data from navigation state if not already set
    if (!this.client) {
      const navigation = this.router.getCurrentNavigation();
      if (navigation?.extras?.state) {
        this.client = navigation.extras.state['client'];
      }
    }

    void this.loadClientDetailsData();
  }

  segmentChanged(event: any) {
    this.selectedTab = event.detail.value;
  }

  async customizeHomePage() {
    const modal = await this.modalController.create({
      component: HomeCustomizationModalComponent,
      componentProps: {
        clientId: this.client.id,
        clientName: this.client.name
      }
    });

    await modal.present();

    await modal.onWillDismiss();
  }

  async scheduleAppointment() {
    const trainerId = this.auth.currentUser?.uid;
    if (!trainerId) {
      console.error('No trainer logged in');
      await this.showToast('Please log in to schedule appointments', 'warning');
      return;
    }

    try {
      // Fetch trainer's profile to get their name and picture
      const trainerDoc = await getDoc(doc(this.firestore, 'users', trainerId));
      const trainerData = trainerDoc.exists() ? trainerDoc.data() : null;
      
      // Parse client name (assuming format "FirstName LastName")
      const clientNameParts = (this.client.name || '').split(' ');
      const clientFirstName = clientNameParts[0] || '';
      const clientLastName = clientNameParts.slice(1).join(' ') || '';

      const modal = await this.modalController.create({
        component: AppointmentSchedulerModalComponent,
        componentProps: {
          clientId: this.client.id,
          clientName: this.client.name,
          trainerId: trainerId,
          trainerFirstName: trainerData?.['firstName'] || '',
          trainerLastName: trainerData?.['lastName'] || '',
          trainerProfilePic: trainerData?.['profilepic'] || '',
          clientFirstName: clientFirstName,
          clientLastName: clientLastName,
          clientProfilePic: this.client.profilepic || ''
        }
      });

      await modal.present();

      const { data } = await modal.onWillDismiss();
      if (data?.success) {
        await this.showToast('Appointment scheduled successfully!', 'success');
        // TODO: Optionally refresh appointments list if displayed on this page
      }
    } catch (error) {
      console.error('Error scheduling appointment:', error);
      await this.showToast('Failed to open appointment scheduler', 'danger');
    }
  }

  private async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      position: 'top',
      color
    });
    await toast.present();
  }

  async createWorkout() {
    const modal = await this.modalController.create({
      component: WorkoutBuilderModalComponent,
      componentProps: {
        clientId: this.client.id,
        clientName: this.client.name
      }
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (!data) {
      return;
    }

    await this.sendWorkoutToClient(data as TrainerWorkoutDraft);
  }

  private async sendWorkoutToClient(workoutDraft: TrainerWorkoutDraft): Promise<void> {
    const clientId = String(this.client?.id || '').trim();
    if (!clientId) {
      await this.showToast('Missing client information for workout assignment.', 'warning');
      return;
    }

    const trainerId = String(this.auth.currentUser?.uid || '').trim();
    if (!trainerId) {
      await this.showToast('Please log in to send workouts.', 'warning');
      return;
    }

    const title = String(workoutDraft?.name || '').trim();
    const notes = String(workoutDraft?.description || '').trim();
    const exercises = (Array.isArray(workoutDraft?.exercises) ? workoutDraft.exercises : [])
      .map((exercise) => ({
        name: String(exercise?.name || '').trim(),
        sets: Math.max(0, Number(exercise?.sets || 0) || 0),
        reps: String(exercise?.reps || '').trim(),
        weight: String(exercise?.weight || '').trim(),
        notes: String(exercise?.notes || '').trim(),
      }))
      .filter((exercise) => !!exercise.name);

    if (!title || exercises.length === 0) {
      await this.showToast('Workout needs a title and at least one named exercise.', 'warning');
      return;
    }

    const totalSets = exercises.reduce((sum, exercise) => sum + (exercise.sets || 0), 0);
    const estimatedDuration = Math.max(15, Math.ceil(totalSets * 3.5));
    const trainerName = await this.resolveTrainerDisplayName(trainerId);
    const scheduledDate = new Date(Date.now() + (24 * 60 * 60 * 1000));

    try {
      const workoutDocRef = await addDoc(
        collection(this.firestore, `clientWorkouts/${clientId}/workouts`),
        {
          title,
          type: 'Trainer Plan',
          duration: estimatedDuration,
          exercises,
          notes,
          clientId,
          trainerId,
          trainerName,
          isComplete: false,
          scheduledDate,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );

      await this.notificationService.sendNotification(
        clientId,
        'New workout assigned',
        `${trainerName} sent "${title}" to your Trainer Dashboard.`,
        {
          type: 'trainer_workout_assigned',
          workoutId: workoutDocRef.id,
          trainerId,
          clientId,
        }
      );

      await this.showToast('Workout sent to client dashboard.', 'success');
    } catch (error) {
      console.error('Failed to send workout to client:', error);
      await this.showToast('Unable to send workout right now. Please try again.', 'danger');
    }
  }

  private async resolveTrainerDisplayName(trainerId: string): Promise<string> {
    try {
      const [userDoc, trainerDoc] = await Promise.all([
        getDoc(doc(this.firestore, 'users', trainerId)),
        getDoc(doc(this.firestore, 'trainers', trainerId)),
      ]);

      const userData = userDoc.exists() ? userDoc.data() as Record<string, unknown> : {};
      const trainerData = trainerDoc.exists() ? trainerDoc.data() as Record<string, unknown> : {};
      const firstName = String(userData['firstName'] || trainerData['firstName'] || '').trim();
      const lastName = String(userData['lastName'] || trainerData['lastName'] || '').trim();
      const fullName = `${firstName} ${lastName}`.trim();
      if (fullName) {
        return fullName;
      }
    } catch (error) {
      console.error('Unable to resolve trainer display name:', error);
    }

    return 'Your trainer';
  }

  async sendAgreement() {
    const clientId = String(this.client?.id || '').trim();
    if (!clientId) {
      await this.showToast('Missing client information for agreement.', 'warning');
      return;
    }

    const modal = await this.modalController.create({
      component: AgreementModalComponent,
      componentProps: {
        clientId,
        clientName: this.client?.name || 'Client',
      },
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data?.action === 'send') {
      await this.showToast('Agreement sent to client.', 'success');
      await this.loadClientDetailsData();
    }
  }

  openCurrentAgreementPreview(): void {
    if (!this.currentAgreementPreviewUrl) {
      return;
    }
    this.isAgreementPreviewOpen = true;
  }

  closeCurrentAgreementPreview(): void {
    this.isAgreementPreviewOpen = false;
  }

  viewMessages() {
    // Navigate to the chat page with this client
    this.router.navigate(['/tabs/chats']);
  }

  viewClientWorkoutHistory() {
    const clientId = this.client?.id;
    if (!clientId) {
      return;
    }

    this.navCtrl.navigateForward('/workout-history', {
      animated: true,
      animationDirection: 'forward',
      queryParams: {
        userId: clientId,
        clientName: this.client?.name || 'Client',
      },
    });
  }

  async openVerifyStatsModal() {
    const clientId = String(this.client?.id ?? '').trim();
    if (!clientId) {
      await this.showToast('Unable to verify stats: missing client ID.', 'warning');
      return;
    }

    this.resetVerifyStatsState();
    this.isVerifyStatsModalOpen = true;
    this.isLoadingVerifyStats = true;

    try {
      const statsSnap = await getDoc(doc(this.firestore, 'userStats', clientId));
      const statsData = statsSnap.exists() ? statsSnap.data() : {};

      this.verifyFieldOrder.forEach((field) => {
        this.verifyStatsValues[field] = this.parseFieldValue(field, statsData[field]);
      });
    } catch (error) {
      console.error('Failed to load client stats for verification:', error);
      this.isVerifyStatsModalOpen = false;
      await this.showToast('Failed to load client stats. Please try again.', 'danger');
    } finally {
      this.isLoadingVerifyStats = false;
    }
  }

  closeVerifyStatsModal() {
    if (this.isSubmittingVerifyStats) {
      return;
    }
    this.isVerifyStatsModalOpen = false;
  }

  selectVerifyChoice(field: VerifyFieldKey, choice: Exclude<VerifyChoice, null>) {
    this.verifyChoices[field] = choice;
    if (choice === 'true') {
      this.verifyCorrections[field] = '';
    }
  }

  shouldShowCorrectionField(field: VerifyFieldKey): boolean {
    return this.verifyChoices[field] === 'false';
  }

  getVerifyFieldLabel(field: VerifyFieldKey): string {
    return this.verifyFieldLabels[field];
  }

  getVerifyFieldValueLabel(field: VerifyFieldKey): string {
    const value = this.verifyStatsValues[field];
    if (value === null) {
      return 'Not set';
    }

    if (field === 'age') {
      return `${Math.round(value)} ${this.verifyFieldUnits[field]}`;
    }

    return `${value} ${this.verifyFieldUnits[field]}`;
  }

  get canSubmitVerifyStats(): boolean {
    if (this.isLoadingVerifyStats || this.isSubmittingVerifyStats) {
      return false;
    }

    return this.verifyFieldOrder.every((field) => {
      const choice = this.verifyChoices[field];
      if (!choice) {
        return false;
      }

      if (choice === 'true') {
        return true;
      }

      return this.parseFieldValue(field, this.verifyCorrections[field]) !== null;
    });
  }

  async submitVerifyStats() {
    const clientId = String(this.client?.id ?? '').trim();
    if (!clientId) {
      await this.showToast('Unable to verify stats: missing client ID.', 'warning');
      return;
    }

    if (!this.canSubmitVerifyStats) {
      await this.showToast('Please complete all checks before submitting.', 'warning');
      return;
    }

    const patch: Record<string, unknown> = {
      trainerVerified: true,
    };

    this.verifyFieldOrder.forEach((field) => {
      if (this.verifyChoices[field] !== 'false') {
        return;
      }

      const parsedCorrection = this.parseFieldValue(field, this.verifyCorrections[field]);
      if (parsedCorrection === null) {
        return;
      }

      patch[field] = parsedCorrection;
    });

    const resolvedHeight = typeof patch['heightMeters'] === 'number'
      ? patch['heightMeters']
      : this.verifyStatsValues.heightMeters;
    const resolvedWeight = typeof patch['weightKg'] === 'number'
      ? patch['weightKg']
      : this.verifyStatsValues.weightKg;
    const resolvedBmi = this.calculateBmi(resolvedHeight, resolvedWeight);
    if (resolvedBmi !== null) {
      patch['bmi'] = resolvedBmi;
    }

    this.isSubmittingVerifyStats = true;

    try {
      await setDoc(doc(this.firestore, 'userStats', clientId), patch, { merge: true });
      this.isVerifyStatsModalOpen = false;
      await this.showToast('Stats verified successfully.', 'success');
    } catch (error) {
      console.error('Failed to submit verified stats:', error);
      await this.showToast('Failed to submit verification. Please try again.', 'danger');
    } finally {
      this.isSubmittingVerifyStats = false;
    }
  }

  private parseFieldValue(field: VerifyFieldKey, value: unknown): number | null {
    const parsed = Number(String(value ?? '').trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    if (field === 'age') {
      return Number.isInteger(parsed) ? parsed : null;
    }

    return Number(parsed.toFixed(3));
  }

  private calculateBmi(heightMeters: number | null, weightKg: number | null): number | null {
    if (
      heightMeters === null ||
      weightKg === null ||
      !Number.isFinite(heightMeters) ||
      !Number.isFinite(weightKg) ||
      heightMeters <= 0 ||
      weightKg <= 0
    ) {
      return null;
    }

    const bmi = weightKg / (heightMeters * heightMeters);
    return Number.isFinite(bmi) ? Number(bmi.toFixed(2)) : null;
  }

  private async loadClientDetailsData(): Promise<void> {
    const clientId = String(this.client?.id || '').trim();
    if (!clientId) {
      return;
    }

    const trainerId = String(this.auth.currentUser?.uid || '').trim();
    const bookingsPromise = trainerId
      ? getDocs(query(collection(this.firestore, 'bookings'), where('trainerId', '==', trainerId)))
      : getDocs(query(collection(this.firestore, 'bookings'), where('clientId', '==', clientId)));
    const transactionsPromise = trainerId
      ? getDocs(query(collection(this.firestore, 'transactions'), where('trainerId', '==', trainerId)))
      : getDocs(query(collection(this.firestore, 'transactions'), where('clientId', '==', clientId)));
    const checkoutSessionsPromise = trainerId
      ? getDocs(query(collection(this.firestore, 'checkoutSessions'), where('trainerId', '==', trainerId)))
      : getDocs(query(collection(this.firestore, 'checkoutSessions'), where('clientId', '==', clientId)));

    try {
      const [
        clientProfileSnap,
        userStatsSnap,
        bookingsSnap,
        transactionsSnap,
        checkoutSessionsSnap,
      ] = await Promise.all([
        getDoc(doc(this.firestore, 'clients', clientId)),
        getDoc(doc(this.firestore, 'userStats', clientId)),
        bookingsPromise,
        transactionsPromise,
        checkoutSessionsPromise,
      ]);

      const clientProfile = clientProfileSnap.exists() ? clientProfileSnap.data() as Record<string, any> : {};
      const userStats = userStatsSnap.exists() ? userStatsSnap.data() as Record<string, any> : {};
      const bookings = bookingsSnap.docs.map((bookingDoc) => ({
        id: bookingDoc.id,
        ...bookingDoc.data(),
      })) as Array<Record<string, any>>;
      const transactions = transactionsSnap.docs.map((transactionDoc) => ({
        id: transactionDoc.id,
        ...transactionDoc.data(),
      })) as Array<Record<string, any>>;
      const checkoutSessions = checkoutSessionsSnap.docs.map((checkoutSessionDoc) => ({
        id: checkoutSessionDoc.id,
        ...checkoutSessionDoc.data(),
      })) as Array<Record<string, any>>;

      const sortedBookings: Array<Record<string, any> & { _date: Date | null }> = bookings
        .filter((booking) => String(booking['clientId'] || '').trim() === clientId)
        .map((booking) => ({
          ...booking,
          _date: this.getBookingDate(booking),
        }))
        .sort((a, b) => (b._date?.getTime() || 0) - (a._date?.getTime() || 0));

      const now = new Date();
      const upcoming = sortedBookings
        .filter((booking) => {
          const bookingDate = booking['_date'] as Date | null;
          return String(booking['status'] || '').toLowerCase() !== 'cancelled' &&
            !!bookingDate &&
            bookingDate.getTime() >= now.getTime();
        })
        .sort((a, b) => (((a['_date'] as Date | null)?.getTime()) || 0) - (((b['_date'] as Date | null)?.getTime()) || 0));

      const past = sortedBookings
        .filter((booking) => {
          const bookingDate = booking['_date'] as Date | null;
          return String(booking['status'] || '').toLowerCase() !== 'cancelled' &&
            !!bookingDate &&
            bookingDate.getTime() < now.getTime();
        });

      this.upcomingAppointments = upcoming.map((booking) => this.mapBookingForDisplay(booking));
      this.pastAppointments = past.map((booking) => this.mapBookingForDisplay(booking));
      this.payments = this.buildStripePaymentHistory(
        clientId,
        trainerId,
        transactions,
        checkoutSessions
      );

      const streakData = userStats['streakData'] as Record<string, any> | undefined;
      this.currentStreak = Number(streakData?.['currentStreak'] ?? userStats['currentStreak'] ?? 0) || 0;

      const latestPayment = this.payments[0];
      this.paymentStatus = latestPayment
        ? this.toTitleCase(String(latestPayment.status || 'unknown'))
        : 'No payments';

      this.recentActivity = this.buildRecentActivity(clientProfile, sortedBookings, this.payments);

      this.client = {
        ...this.client,
        ...clientProfile,
        totalSessions: past.filter((booking) => String(booking['status'] || '').toLowerCase() === 'confirmed').length,
        lastWorkout: clientProfile['lastWorkout'] || past[0]?._date || this.client?.lastWorkout || null,
        nextSession: upcoming[0]?._date || this.client?.nextSession || null,
      };

      await this.loadCurrentAgreement(clientId, trainerId);
    } catch (error) {
      console.error('Failed to load client details data:', error);
      await this.showToast('Failed to load client details.', 'danger');
    }
  }

  private async loadCurrentAgreement(clientId: string, trainerId: string): Promise<void> {
    this.isLoadingCurrentAgreement = true;
    this.currentAgreement = null;
    this.currentAgreementPreviewUrl = null;
    this.currentAgreementPreviewError = '';
    this.isLoadingCurrentAgreementPreview = false;

    if (!trainerId) {
      this.isLoadingCurrentAgreement = false;
      return;
    }

    try {
      const agreementsSnap = await getDocs(
        query(
          collection(this.firestore, 'agreements'),
          where('trainerId', '==', trainerId),
          where('clientId', '==', clientId)
        )
      );

      const signedStatuses = new Set(['signed', 'completed', 'partially_signed']);
      const signedAgreements = agreementsSnap.docs
        .map((agreementDoc) => {
          const data = agreementDoc.data() as Record<string, any>;
          const status = String(data['status'] || '').trim().toLowerCase();
          return {
            id: agreementDoc.id,
            name: String(data['name'] || 'Agreement'),
            trainerId: String(data['trainerId'] || ''),
            clientId: String(data['clientId'] || ''),
            status,
            dateCreated: this.toDate(data['dateCreated']) || this.toDate(data['createdAt']) || new Date(0),
            dateUpdated: this.toDate(data['dateUpdated']) || this.toDate(data['updatedAt']) || new Date(0),
            signedAgreementStoragePath: String(data['signedAgreementStoragePath'] || ''),
            agreementStoragePath: String(data['agreementStoragePath'] || ''),
          } as Agreement;
        })
        .filter((agreement) => signedStatuses.has(String(agreement.status || '').toLowerCase()))
        .sort((left, right) => right.dateUpdated.getTime() - left.dateUpdated.getTime());

      this.currentAgreement = signedAgreements[0] || null;
      if (this.currentAgreement) {
        await this.loadCurrentAgreementPreview(this.currentAgreement);
      }
    } catch (error) {
      console.error('Failed to load current agreement:', error);
      this.currentAgreement = null;
    } finally {
      this.isLoadingCurrentAgreement = false;
    }
  }

  private async loadCurrentAgreementPreview(agreement: Agreement): Promise<void> {
    const storagePath = String(
      agreement.signedAgreementStoragePath || agreement.agreementStoragePath || ''
    ).trim();
    if (!storagePath) {
      this.currentAgreementPreviewUrl = null;
      this.currentAgreementPreviewError = 'Agreement file is unavailable.';
      return;
    }

    this.isLoadingCurrentAgreementPreview = true;
    this.currentAgreementPreviewError = '';

    try {
      const downloadUrl = await this.agreementService.resolveAgreementDownloadUrl(storagePath);
      const safeDocumentUrl = this.toSafeDocumentUrl(downloadUrl);
      if (!safeDocumentUrl) {
        throw new Error('Unable to load agreement preview URL.');
      }
      this.currentAgreementPreviewUrl =
        this.sanitizer.bypassSecurityTrustResourceUrl(safeDocumentUrl);
    } catch (error) {
      console.error('Failed to load current agreement preview:', error);
      this.currentAgreementPreviewUrl = null;
      this.currentAgreementPreviewError = 'Could not load agreement preview.';
    } finally {
      this.isLoadingCurrentAgreementPreview = false;
    }
  }

  private toSafeDocumentUrl(url: string): string | null {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl) {
      return null;
    }

    try {
      const parsed = new URL(normalizedUrl, window.location.origin);
      const isSameOrigin = parsed.origin === window.location.origin;
      const isTrustedStorageHost =
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'firebasestorage.googleapis.com' ||
          parsed.hostname === 'storage.googleapis.com');

      return isSameOrigin || isTrustedStorageHost ? parsed.toString() : null;
    } catch {
      return null;
    }
  }

  private buildRecentActivity(
    clientProfile: Record<string, any>,
    sortedBookings: Array<Record<string, any>>,
    payments: PaymentHistoryEntry[]
  ): Array<{ title: string; date: Date; icon: string; color: string }> {
    const activity: Array<{ title: string; date: Date; icon: string; color: string }> = [];

    const lastWorkoutDate = this.toDate(clientProfile['lastWorkout']);
    if (lastWorkoutDate) {
      activity.push({
        title: 'Logged a workout',
        date: lastWorkoutDate,
        icon: 'fitness',
        color: 'success',
      });
    }

    for (const booking of sortedBookings.slice(0, 4)) {
      const bookingDate = booking['_date'] instanceof Date ? booking['_date'] as Date : null;
      if (!bookingDate) {
        continue;
      }

      const status = String(booking['status'] || '').toLowerCase();
      const isFuture = bookingDate.getTime() >= Date.now();
      activity.push({
        title: isFuture
          ? `Session ${status === 'pending' ? 'requested' : 'scheduled'}`
          : 'Completed training session',
        date: bookingDate,
        icon: isFuture ? 'calendar' : 'checkmark-circle',
        color: isFuture ? 'primary' : 'success',
      });
    }

    for (const payment of payments.slice(0, 2)) {
      if (!payment.date) {
        continue;
      }

      const activityColor = payment.status === 'paid'
        ? 'success'
        : payment.status === 'failed'
          ? 'danger'
          : 'warning';
      activity.push({
        title: payment.status === 'paid' ? `Payment received: $${payment.amount}` : `Payment ${payment.status}`,
        date: payment.date,
        icon: 'card',
        color: activityColor,
      });
    }

    return activity
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 5);
  }

  private buildStripePaymentHistory(
    clientId: string,
    trainerId: string,
    transactions: Array<Record<string, unknown>>,
    checkoutSessions: Array<Record<string, unknown>>
  ): PaymentHistoryEntry[] {
    const history: Array<PaymentHistoryEntry & { dedupeKey: string; sortDate: Date }> = [];
    const seenKeys = new Set<string>();

    for (const [index, transaction] of transactions.entries()) {
      if (!this.matchesPaymentScope(transaction, clientId, trainerId)) {
        continue;
      }

      const normalizedStatus = this.normalizeStripePaymentStatus(transaction['status']);
      const amount = this.resolveStripeAmount(transaction);
      if (amount <= 0) {
        continue;
      }

      const date =
        this.toDate(transaction['createdAt']) ||
        this.toDate(transaction['date']) ||
        this.toDate(transaction['timestamp']) ||
        this.toDate(transaction['paidAt']) ||
        this.toDate(transaction['updatedAt']);
      if (!date) {
        continue;
      }

      const dedupeKey = this.resolveRevenueDedupeKey(transaction, String(transaction['id'] || index), 'txn');
      if (seenKeys.has(dedupeKey)) {
        continue;
      }

      seenKeys.add(dedupeKey);
      history.push({
        dedupeKey,
        sortDate: date,
        amount,
        date,
        method: this.resolvePaymentMethod(transaction, 'Stripe'),
        status: normalizedStatus,
      });
    }

    for (const [index, checkoutSession] of checkoutSessions.entries()) {
      if (!this.matchesPaymentScope(checkoutSession, clientId, trainerId)) {
        continue;
      }

      const normalizedStatus = this.normalizeStripePaymentStatus(
        checkoutSession['stripeStatus'] ?? checkoutSession['status']
      );
      const amount = this.resolveStripeAmount(checkoutSession);
      if (amount <= 0) {
        continue;
      }

      const date =
        this.toDate(checkoutSession['createdAt']) ||
        this.toDate(checkoutSession['updatedAt']);
      if (!date) {
        continue;
      }

      const dedupeKey = this.resolveRevenueDedupeKey(
        checkoutSession,
        String(checkoutSession['id'] || index),
        'checkout'
      );
      if (seenKeys.has(dedupeKey)) {
        continue;
      }

      seenKeys.add(dedupeKey);
      history.push({
        dedupeKey,
        sortDate: date,
        amount,
        date,
        method: this.resolvePaymentMethod(checkoutSession, 'Stripe Checkout'),
        status: normalizedStatus,
      });
    }

    return history
      .sort((left, right) => right.sortDate.getTime() - left.sortDate.getTime())
      .map(({ dedupeKey, sortDate, ...payment }) => payment);
  }

  private matchesPaymentScope(
    record: Record<string, unknown>,
    clientId: string,
    trainerId: string
  ): boolean {
    const recordClientId = String(record['clientId'] || record['clientID'] || '').trim();
    const recordTrainerId = String(record['trainerId'] || record['trainerID'] || '').trim();

    if (!recordClientId || recordClientId !== clientId) {
      return false;
    }

    if (trainerId && recordTrainerId && recordTrainerId !== trainerId) {
      return false;
    }

    return true;
  }

  private normalizeStripePaymentStatus(value: unknown): StripePaymentDisplayStatus {
    const status = String(value || '').trim().toLowerCase();
    if (
      status === 'paid' ||
      status === 'succeeded' ||
      status === 'complete' ||
      status === 'completed'
    ) {
      return 'paid';
    }

    if (
      status === 'failed' ||
      status === 'canceled' ||
      status === 'cancelled' ||
      status === 'unpaid'
    ) {
      return 'failed';
    }

    return 'pending';
  }

  private resolvePaymentMethod(record: Record<string, unknown>, fallback: string): string {
    return String(
      record['paymentMethod'] ||
      record['method'] ||
      record['source'] ||
      record['payment_method'] ||
      fallback
    ).trim() || fallback;
  }

  private resolveRevenueDedupeKey(
    record: Record<string, unknown>,
    fallbackId: string,
    source: 'txn' | 'checkout'
  ): string {
    const checkoutSessionId =
      String(record['checkoutSessionId'] || '').trim() ||
      String(record['stripeCheckoutSessionId'] || '').trim();
    if (checkoutSessionId) {
      return `checkout:${checkoutSessionId}`;
    }

    const paymentIntentId =
      String(record['paymentIntentId'] || '').trim() ||
      String(record['stripePaymentIntentId'] || '').trim();
    if (paymentIntentId) {
      return `paymentIntent:${paymentIntentId}`;
    }

    const chargeId = String(record['stripeChargeId'] || '').trim();
    if (chargeId) {
      return `charge:${chargeId}`;
    }

    return `${source}:${fallbackId}`;
  }

  private resolveStripeAmount(record: Record<string, unknown>): number {
    const centsAmount = this.toFiniteNumber(record['priceCents']) ??
      this.toFiniteNumber(record['amountCents']) ??
      this.toFiniteNumber(record['unitAmountCents']) ??
      this.toFiniteNumber(record['unit_amount']) ??
      this.toFiniteNumber(record['amount_total']);
    if (centsAmount !== null && centsAmount > 0) {
      return centsAmount / 100;
    }

    const dollarAmount = this.toFiniteNumber(record['amount']) ??
      this.toFiniteNumber(record['total']) ??
      this.toFiniteNumber(record['price']);
    if (dollarAmount === null || dollarAmount <= 0) {
      return 0;
    }

    return dollarAmount;
  }

  private toFiniteNumber(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
  }

  private mapBookingForDisplay(booking: Record<string, any>) {
    return {
      ...booking,
      type: String(booking['sessionType'] || booking['type'] || 'Training Session'),
      date: (booking['_date'] as Date | null) || this.toDate(booking['date']),
      duration: Number(booking['duration'] || 60) || 60,
      status: String(booking['status'] || 'pending').toLowerCase(),
    };
  }

  private getBookingDate(booking: Record<string, any>): Date | null {
    const rawDate = String(booking['date'] || '').trim();
    const rawTime = String(booking['time'] || booking['startTime'] || '').trim();

    if (!rawDate) {
      return this.toDate(booking['createdAt']);
    }

    const parsedDate = rawTime ? new Date(`${rawDate} ${rawTime}`) : new Date(rawDate);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate;
    }

    return this.toDate(rawDate);
  }

  private toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return value;
    }
    if (typeof (value as any)?.toDate === 'function') {
      const converted = (value as any).toDate();
      return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
    }
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private toTitleCase(value: string): string {
    return value
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }

  get verifyFieldKeys(): VerifyFieldKey[] {
    return this.verifyFieldOrder;
  }

  private resetVerifyStatsState(): void {
    this.verifyFieldOrder.forEach((field) => {
      this.verifyStatsValues[field] = null;
      this.verifyChoices[field] = null;
      this.verifyCorrections[field] = '';
    });
  }
}
