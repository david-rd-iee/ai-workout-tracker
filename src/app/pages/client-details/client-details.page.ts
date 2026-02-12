import { Component, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonButton, IonIcon, IonSegment, IonSegmentButton, IonLabel, ModalController } from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { arrowBack, calendar, personCircle, fitness, card, createOutline } from 'ionicons/icons';
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

  // Fake data for demonstration
  upcomingAppointments: any[] = [];
  pastAppointments: any[] = [];
  payments: any[] = [];

  constructor(
    private router: Router,
    private location: Location,
    private modalController: ModalController
  ) {
    addIcons({ arrowBack, calendar, personCircle, fitness, card, createOutline });

    // Get client data from navigation state
    const navigation = this.router.getCurrentNavigation();
    if (navigation?.extras?.state) {
      this.client = navigation.extras.state['client'];
    }
  }

  ngOnInit() {
    // If no client data, set fake client
    if (!this.client) {
      this.client = {
        id: 'client1',
        name: 'John Smith',
        profileImage: '',
        nextSession: new Date(Date.now() + 86400000),
        totalSessions: 12,
        lastWorkout: new Date(Date.now() - 172800000)
      };
    }

    // Load fake appointments
    this.upcomingAppointments = [
      {
        id: '1',
        date: new Date(Date.now() + 86400000),
        type: 'Strength Training',
        duration: 60,
        status: 'confirmed'
      },
      {
        id: '2',
        date: new Date(Date.now() + 259200000),
        type: 'HIIT Session',
        duration: 45,
        status: 'pending'
      }
    ];

    this.pastAppointments = [
      {
        id: '3',
        date: new Date(Date.now() - 172800000),
        type: 'Upper Body Focus',
        duration: 60,
        status: 'completed'
      },
      {
        id: '4',
        date: new Date(Date.now() - 604800000),
        type: 'Cardio & Core',
        duration: 45,
        status: 'completed'
      }
    ];

    this.payments = [
      {
        id: '1',
        date: new Date(Date.now() - 86400000),
        amount: 75,
        status: 'paid',
        method: 'Credit Card'
      },
      {
        id: '2',
        date: new Date(Date.now() - 604800000),
        amount: 75,
        status: 'paid',
        method: 'Credit Card'
      },
      {
        id: '3',
        date: new Date(Date.now() + 172800000),
        amount: 75,
        status: 'pending',
        method: 'N/A'
      }
    ];
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
}
