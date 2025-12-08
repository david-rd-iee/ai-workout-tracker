// src/app/pages/home/home.page.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent, IonButton } from '@ionic/angular/standalone';

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [CommonModule, IonContent, IonButton],
})
export class HomePage {
  onTestClick() {
    console.log('HOME TEST CLICK');
  }
}
