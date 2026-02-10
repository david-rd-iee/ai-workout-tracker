import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { 
  IonModal, 
  IonHeader, 
  IonToolbar, 
  IonTitle, 
  IonContent, 
  IonButton, 
  IonButtons, 
  IonIcon,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonItem,
  IonLabel,
  IonInput,
  IonDatetime,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { close, calendar, time } from 'ionicons/icons';

interface AppointmentData {
  clientId: string;
  clientName: string;
  date: string;
  time: string;
  duration: number;
  sessionType: string;
  notes?: string;
}

@Component({
  selector: 'app-appointment-scheduler-modal',
  standalone: true,
  templateUrl: './appointment-scheduler-modal.component.html',
  styleUrls: ['./appointment-scheduler-modal.component.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButton,
    IonButtons,
    IonIcon,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonItem,
    IonLabel,
    IonInput,
    IonDatetime,
    IonSelect,
    IonSelectOption,
    IonTextarea
  ],
})
export class AppointmentSchedulerModalComponent implements OnInit {
  @Input() clientId!: string;
  @Input() clientName!: string;

  appointment: AppointmentData = {
    clientId: '',
    clientName: '',
    date: new Date().toISOString(),
    time: '09:00',
    duration: 60,
    sessionType: 'Strength Training',
    notes: ''
  };

  sessionTypes = [
    'Strength Training',
    'HIIT Session',
    'Cardio & Core',
    'Upper Body Focus',
    'Lower Body Focus',
    'Full Body Workout',
    'Mobility & Flexibility',
    'Sports Performance',
    'Weight Loss Focus',
    'Muscle Building'
  ];

  durations = [
    { value: 30, label: '30 minutes' },
    { value: 45, label: '45 minutes' },
    { value: 60, label: '60 minutes' },
    { value: 90, label: '90 minutes' },
    { value: 120, label: '2 hours' }
  ];

  timeSlots: string[] = [];

  minDate: string = new Date().toISOString();

  constructor(private modalController: ModalController) {
    addIcons({ close, calendar, time });
  }

  ngOnInit() {
    this.appointment.clientId = this.clientId;
    this.appointment.clientName = this.clientName;
    this.generateTimeSlots();
  }

  generateTimeSlots() {
    const slots: string[] = [];
    for (let hour = 6; hour < 22; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        slots.push(timeString);
      }
    }
    this.timeSlots = slots;
  }

  formatTimeSlot(time: string): string {
    const [hour, minute] = time.split(':');
    const hourNum = parseInt(hour);
    const period = hourNum >= 12 ? 'PM' : 'AM';
    const displayHour = hourNum > 12 ? hourNum - 12 : hourNum === 0 ? 12 : hourNum;
    return `${displayHour}:${minute} ${period}`;
  }

  dismiss() {
    this.modalController.dismiss();
  }

  async scheduleAppointment() {
    if (!this.appointment.date || !this.appointment.time) {
      console.error('Date and time are required');
      return;
    }

    const appointmentData = {
      ...this.appointment,
      createdAt: new Date().toISOString(),
      status: 'confirmed'
    };

    // TODO: Save to Firestore using BookingService
    console.log('Scheduling appointment:', appointmentData);

    this.modalController.dismiss(appointmentData);
  }
}
