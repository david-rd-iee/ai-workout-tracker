import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonButton, IonIcon, IonSegment, IonSegmentButton, IonLabel, ModalController, ToastController } from '@ionic/angular/standalone';
import { NavController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { calendar, personCircle, fitness, card, createOutline, trophy, chatbubbles, barbell, heart, body, checkmarkCircle, flag, walk } from 'ionicons/icons';
import { WorkoutBuilderModalComponent } from 'src/app/components/modals/workout-builder-modal/workout-builder-modal.component';
import { AppointmentSchedulerModalComponent } from 'src/app/components/modals/appointment-scheduler-modal/appointment-scheduler-modal.component';
import { HomeCustomizationModalComponent } from 'src/app/components/modals/home-customization-modal/home-customization-modal.component';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';

type VerifyFieldKey = 'heightMeters' | 'weightKg' | 'age';
type VerifyChoice = 'true' | 'false' | null;

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

  client: any = null;
  selectedTab: string = 'overview';

  // Overview stats
  currentStreak: number = 0;
  paymentStatus: string = 'N/A';

  // Progress tracking data
  strengthProgress: number = 0;
  cardioProgress: number = 0;
  bodyProgress: number = 0;

  activeGoals: any[] = [];
  personalRecords: any[] = [];
  recentActivity: any[] = [];

  // Appointments and payments
  upcomingAppointments: any[] = [];
  pastAppointments: any[] = [];
  payments: any[] = [];

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
    addIcons({ calendar, personCircle, fitness, card, createOutline, trophy, chatbubbles, barbell, heart, body, checkmarkCircle, flag, walk });

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

    // TODO: Load real data from Firebase
    // - Client stats (currentStreak, paymentStatus)
    // - Progress metrics (strengthProgress, cardioProgress, bodyProgress)
    // - Active goals and personal records
    // - Upcoming and past appointments from bookings collection
    // - Payment history from payments/transactions collection
    // - Recent activity feed
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

    const { data } = await modal.onWillDismiss();
    if (data) {
      console.log('Home page configuration saved successfully for', this.client.name);
      // Configuration is already saved to Firestore by the modal
    }
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
        console.log('Appointment scheduled successfully:', data);
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
    if (data) {
      console.log('Workout created:', data);
      // TODO: Show success message
    }
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
