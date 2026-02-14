import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { 
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
  IonTextarea,
  IonSelect,
  IonSelectOption,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { close, add, remove, save } from 'ionicons/icons';

interface Exercise {
  name: string;
  sets: number;
  reps: string;
  weight?: string;
  notes?: string;
}

interface Workout {
  name: string;
  description: string;
  exercises: Exercise[];
  date?: string;
}

@Component({
  selector: 'app-workout-builder-modal',
  standalone: true,
  templateUrl: './workout-builder-modal.component.html',
  styleUrls: ['./workout-builder-modal.component.scss'],
  imports: [
    CommonModule,
    FormsModule,
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
    IonTextarea,
    IonSelect,
    IonSelectOption
  ],
})
export class WorkoutBuilderModalComponent implements OnInit {
  @Input() clientId!: string;
  @Input() clientName!: string;

  workout: Workout = {
    name: '',
    description: '',
    exercises: []
  };

  commonExercises = [
    'Bench Press',
    'Squat',
    'Deadlift',
    'Overhead Press',
    'Barbell Row',
    'Pull-ups',
    'Dips',
    'Lunges',
    'Leg Press',
    'Lat Pulldown',
    'Bicep Curls',
    'Tricep Extensions',
    'Leg Curls',
    'Leg Extensions',
    'Calf Raises'
  ];

  constructor(private modalController: ModalController) {
    addIcons({ close, add, remove, save });
  }

  ngOnInit() {
    // Add one exercise by default
    this.addExercise();
  }

  addExercise() {
    this.workout.exercises.push({
      name: '',
      sets: 3,
      reps: '8-12',
      weight: '',
      notes: ''
    });
  }

  removeExercise(index: number) {
    this.workout.exercises.splice(index, 1);
  }

  dismiss() {
    this.modalController.dismiss();
  }

  async saveWorkout() {
    if (!this.workout.name || this.workout.exercises.length === 0) {
      // TODO: Show error toast
      console.error('Workout must have a name and at least one exercise');
      return;
    }

    // Filter out exercises with no name
    const validExercises = this.workout.exercises.filter(ex => ex.name.trim() !== '');
    
    if (validExercises.length === 0) {
      console.error('At least one exercise must have a name');
      return;
    }

    const workoutData = {
      ...this.workout,
      exercises: validExercises,
      clientId: this.clientId,
      createdAt: new Date().toISOString()
    };

    // TODO: Save to Firestore
    console.log('Saving workout:', workoutData);

    this.modalController.dismiss(workoutData);
  }
}
