import { Component, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonButton, IonIcon, IonSegment, IonSegmentButton, IonLabel, ModalController } from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { arrowBack, calendar, personCircle, fitness, card, createOutline, trophy, chatbubbles, barbell, heart, body, checkmarkCircle, flag, walk } from 'ionicons/icons';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { WorkoutBuilderModalComponent } from 'src/app/components/modals/workout-builder-modal/workout-builder-modal.component';
import { AppointmentSchedulerModalComponent } from 'src/app/components/modals/appointment-scheduler-modal/appointment-scheduler-modal.component';
import { HomeCustomizationModalComponent } from 'src/app/components/modals/home-customization-modal/home-customization-modal.component';

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
    HeaderComponent
  ],
})
export class ClientDetailsPage implements OnInit {
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

  constructor(
    private router: Router,
    private location: Location,
    private modalController: ModalController
  ) {
    addIcons({ arrowBack, calendar, personCircle, fitness, card, createOutline, trophy, chatbubbles, barbell, heart, body, checkmarkCircle, flag, walk });

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

  goBack() {
    this.location.back();
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
    const modal = await this.modalController.create({
      component: AppointmentSchedulerModalComponent,
      componentProps: {
        clientId: this.client.id,
        clientName: this.client.name
      }
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data) {
      console.log('Appointment scheduled:', data);
      // TODO: Refresh appointments list or show success message
    }
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
}
