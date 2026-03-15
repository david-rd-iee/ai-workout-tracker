import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonToolbar, IonButtons, IonBackButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonButton, IonIcon, IonSegment, IonSegmentButton, IonLabel, ModalController, ToastController } from '@ionic/angular/standalone';
import { NavController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { calendar, personCircle, fitness, card, createOutline, trophy, chatbubbles, barbell, heart, body, checkmarkCircle, flag, walk } from 'ionicons/icons';
import { WorkoutBuilderModalComponent } from 'src/app/components/modals/workout-builder-modal/workout-builder-modal.component';
import { AppointmentSchedulerModalComponent } from 'src/app/components/modals/appointment-scheduler-modal/appointment-scheduler-modal.component';
import { HomeCustomizationModalComponent } from 'src/app/components/modals/home-customization-modal/home-customization-modal.component';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

@Component({
  selector: 'app-client-details',
  standalone: true,
  templateUrl: './client-details.page.html',
  styleUrls: ['./client-details.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
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
  ],
})
export class ClientDetailsPage implements OnInit {
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
}
