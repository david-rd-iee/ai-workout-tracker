import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle, IonCardContent, IonGrid, IonRow, IonCol, IonBadge, IonButton } from '@ionic/angular/standalone';

@Component({
  selector: 'app-workout-summary',
  templateUrl: './workout-summary.page.html',
  styleUrls: ['./workout-summary.page.scss'],
  standalone: true,
  imports: [
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle, IonCardContent,
    IonGrid, IonRow, IonCol, IonBadge, IonButton,
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

  constructor() {}

  ngOnInit() {}

  getFormColor(score: string) {
    if (score === 'Good') return 'success';
    if (score === 'Fair') return 'warning';
    return 'danger';
  }
}
