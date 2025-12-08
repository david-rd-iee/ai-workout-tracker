import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
  IonBadge,
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
    IonBadge,
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
    sessionType: '',
    notes: '',
    volume: 0,
    calories: 0,
    exercises: [],
  };

  constructor(private router: Router) {
    addIcons({ closeOutline });

    const nav = this.router.getCurrentNavigation();
    const incoming = nav?.extras.state?.['summary'];
    if (incoming) {
      this.summary = incoming as WorkoutSessionPerformance;
    }
  }

  ngOnInit() {}

  goBackToChat() {
    this.router.navigate(['/tabs/chats']);
  }

  navigateToGroups() {
    this.router.navigate(['/tabs/groups']);
  }

  navigateToLeaderboard() {
    this.router.navigate(['/tabs/leaderboard']);
  }
}
