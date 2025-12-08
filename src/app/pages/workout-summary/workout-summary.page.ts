import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonCard, IonCardHeader, IonCardContent, IonGrid, IonRow, IonCol, IonBadge, IonButton, IonButtons, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';

@Component({
  selector: 'app-workout-summary',
  templateUrl: './workout-summary.page.html',
  styleUrls: ['./workout-summary.page.scss'],
  standalone: true,
  imports: [
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonCard, IonCardHeader, IonCardContent,
    IonGrid, IonRow, IonCol, IonBadge, IonButton,
    IonButtons, IonIcon,
    CommonModule, FormsModule
  ]
})
export class WorkoutSummaryPage implements OnInit {

  summary = {
    workScore: 100,
    calories: 204,
    effortSeries: [20, 40, 80, 60, 50],
    exercises: [
      { name: 'Squats', metric: '12 reps', formScore: 'Good' },
      { name: 'Lunges', metric: '12 reps', formScore: 'Fair' },
      { name: 'Planks', metric: '1 min', formScore: 'Good' },
    ],
  };

  constructor(private router: Router) {
    addIcons({ closeOutline });
  }

  ngOnInit() {}

  getFormColor(score: string) {
    if (score === 'Good') return 'success';
    if (score === 'Fair') return 'warning';
    return 'danger';
  }

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
