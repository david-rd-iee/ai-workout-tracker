// src/app/pages/home/home.page.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent, IonCard, IonCardContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { personCircleOutline, trophyOutline, fitnessOutline, peopleOutline, chatbubblesOutline } from 'ionicons/icons';

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [CommonModule, IonContent, IonCard, IonCardContent, IonIcon],
})
export class HomePage {
  constructor(private router: Router) {
    addIcons({ personCircleOutline, trophyOutline, fitnessOutline, peopleOutline, chatbubblesOutline });
  }

  navigateTo(path: string) {
    this.router.navigate([path]);
  }
}
