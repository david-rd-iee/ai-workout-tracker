import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonCard,
  IonCardHeader,
  IonCardContent,
  IonGrid,
  IonRow,
  IonCol,
  IonButton,
  IonButtons,
  IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { WorkoutSessionPerformance } from '../../models/workout-session.model';

@Component({
  selector: 'app-workout-summary',
  templateUrl: './workout-summary.page.html',
  styleUrls: ['./workout-summary.page.scss'],
  standalone: true,
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonCard,
    IonCardHeader,
    IonCardContent,
    IonGrid,
    IonRow,
    IonCol,
    IonButton,
    IonButtons,
    IonIcon,
    CommonModule,
    FormsModule,
  ],
})
export class WorkoutSummaryPage implements OnInit {
  summary: WorkoutSessionPerformance = {
    date: new Date().toISOString().slice(0, 10),
    trainingRows: [],
    estimated_calories: 0,
    trainer_notes: '',
    isComplete: false,
    sessionType: '',
    notes: '',
    volume: 0,
    calories: 0,
    exercises: [],
  };

  constructor(private router: Router, private navCtrl: NavController) {
    addIcons({ closeOutline });

    const nav = this.router.getCurrentNavigation();
    const incoming = nav?.extras.state?.['summary'];
    if (incoming) {
      this.summary = this.normalizeSummary(incoming as Partial<WorkoutSessionPerformance>);
    }
  }

  ngOnInit() {}

  goBackToChat() {
    this.navCtrl.navigateBack('/workout-chatbot', {
      animated: true,
      animationDirection: 'back',
    });
  }

  navigateToGroups() {
    this.router.navigate(['/tabs/groups']);
  }

  navigateToLeaderboard() {
    this.router.navigate(['/tabs/leaderboard']);
  }

  navigateToHome() {
    this.navCtrl.navigateRoot('/tabs/home', {
      animated: true,
      animationDirection: 'forward',
    });
  }

  private normalizeSummary(value: Partial<WorkoutSessionPerformance>): WorkoutSessionPerformance {
    const rows = Array.isArray(value.trainingRows) ? value.trainingRows : [];
    const calories = Number(value.estimated_calories ?? value.calories ?? 0);
    const notes = value.trainer_notes ?? value.notes ?? '';

    return {
      date: typeof value.date === 'string' && value.date ? value.date : new Date().toISOString().slice(0, 10),
      trainingRows: rows,
      estimated_calories: calories,
      trainer_notes: String(notes),
      isComplete: !!value.isComplete,
      sessionType: value.sessionType ?? '',
      notes: String(notes),
      volume: Number(value.volume ?? 0),
      calories,
      exercises: Array.isArray(value.exercises) ? value.exercises : [],
    };
  }
}
