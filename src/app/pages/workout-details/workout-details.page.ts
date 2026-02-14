import { Component, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBack, calendar, time, fitness, checkmarkCircle, barbell, chevronForward, add, chevronDown, chevronUp } from 'ionicons/icons';
import { HeaderComponent } from 'src/app/components/header/header.component';

interface Exercise {
  name: string;
  sets?: number;
  reps?: number;
  weight?: number;
  weightUnit?: string;
  duration?: number;
}

interface WorkoutDetails {
  title: string;
  date: Date;
  type?: string;
  duration?: number;
  exercises?: Exercise[];
  notes?: string;
}

@Component({
  selector: 'app-workout-details',
  standalone: true,
  templateUrl: './workout-details.page.html',
  styleUrls: ['./workout-details.page.scss'],
  imports: [
    CommonModule, 
    IonContent, 
    IonCard, 
    IonCardContent, 
    IonCardHeader,
    IonCardTitle,
    IonButton, 
    IonIcon,
    HeaderComponent
  ],
})
export class WorkoutDetailsPage implements OnInit {
  workout: WorkoutDetails | null = null;
  exercisesExpanded = false;

  constructor(
    private router: Router,
    private location: Location
  ) {
    addIcons({ arrowBack, calendar, time, fitness, checkmarkCircle, barbell, chevronForward, add, chevronDown, chevronUp });
    
    // Get workout data from navigation state
    const navigation = this.router.getCurrentNavigation();
    if (navigation?.extras?.state) {
      this.workout = navigation.extras.state['workout'];
    }
  }

  ngOnInit() {
    // If no workout data, set fake workout
    if (!this.workout) {
      this.workout = {
        title: 'Upper Body Strength',
        date: new Date(Date.now() + 86400000),
        type: 'Strength Training',
        duration: 60,
        exercises: [
          { name: 'Bench Press', sets: 4, reps: 8, weight: 135, weightUnit: 'lbs' },
          { name: 'Pull-ups', sets: 3, reps: 10 },
          { name: 'Shoulder Press', sets: 3, reps: 12, weight: 45, weightUnit: 'lbs' },
          { name: 'Bicep Curls', sets: 3, reps: 15, weight: 25, weightUnit: 'lbs' },
          { name: 'Tricep Dips', sets: 3, reps: 12 }
        ],
        notes: 'Focus on proper form and controlled movements. Take 90 seconds rest between sets.'
      };
    }
  }

  goBack() {
    this.location.back();
  }

  startWorkout() {
    // Navigate to workout chatbot to start logging
    this.router.navigate(['/tabs/chats/workout-chatbot']);
  }

  viewPreviousWorkouts() {
    // Navigate to workout summary/history page
    this.router.navigate(['/workout-summary']);
  }

  toggleExercises() {
    this.exercisesExpanded = !this.exercisesExpanded;
  }

  logCustomWorkout() {
    // Navigate to workout chatbot for custom logging
    this.router.navigate(['/tabs/chats/workout-chatbot']);
  }
}
