import { Component, Input } from '@angular/core';
import { IonHeader, IonToolbar, IonButton, IonIcon, IonTitle } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { addIcons } from 'ionicons';
import { chevronBackOutline, personOutline, personCircleOutline } from 'ionicons/icons';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
  standalone: true,
  imports: [IonToolbar, IonHeader, IonButton, IonIcon, IonTitle, CommonModule]
})
export class HeaderComponent {
  @Input() title: string = 'ATLAS';
  @Input() showBack: boolean = false;
  @Input() transparent: boolean = true;
  @Input() backHref?: string; // Optional: if provided, navigate to this route instead of using history

  constructor(private router: Router, private location: Location) {
    addIcons({
      chevronBackOutline,
      personOutline,
      personCircleOutline
    });
  }

  goToProfile() {
    this.router.navigate(['/app/tabs/profile']);
  }
  goBack() {
    // If backHref is provided, use it instead of browser history
    if (this.backHref) {
      this.router.navigate([this.backHref]);
    } else {
      // Otherwise use browser history
      this.location.back();
    }
  }
}