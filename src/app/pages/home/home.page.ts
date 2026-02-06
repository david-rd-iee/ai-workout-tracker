// src/app/pages/home/home.page.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { IonContent, IonCard, IonCardContent, IonIcon, IonButton } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { personCircleOutline, trophyOutline, fitnessOutline, peopleOutline, chatbubblesOutline } from 'ionicons/icons';

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [CommonModule, IonContent, IonCard, IonCardContent, IonIcon, IonButton, HeaderComponent],
})
export class HomePage {
  constructor(private router: Router) {
    addIcons({ personCircleOutline, trophyOutline, fitnessOutline, peopleOutline, chatbubblesOutline });
  }

  navigateTo(path: string) {
    this.router.navigate([path]);
  }
}
