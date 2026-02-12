import { Component, Input } from '@angular/core';
import { IonHeader, IonToolbar, IonButton, IonIcon, IonTitle, IonAvatar } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { addIcons } from 'ionicons';
import { chevronBackOutline, personOutline, personCircleOutline } from 'ionicons/icons';
import type { AppUser } from '../../models/user.model';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
  standalone: true,
  imports: [IonToolbar, IonHeader, IonButton, IonIcon, IonTitle, IonAvatar, CommonModule]
})
export class HeaderComponent {
  @Input() title: string = 'ATLAS';
  @Input() showBack: boolean = false;
  @Input() transparent: boolean = true;
  @Input() backHref?: string; // Optional: if provided, navigate to this route instead of using history
  @Input() currentUser: AppUser | null = null;

  constructor(private router: Router, private location: Location) {
    addIcons({
      chevronBackOutline,
      personOutline,
      personCircleOutline
    });
  }

  get avatarInitial(): string {
    const first = (this.currentUser?.firstName || '').trim();
    const user = (this.currentUser?.username || '').trim();
    const source = first || user;
    return source ? source[0].toUpperCase() : '?';
  }

  get profileImageUrl(): string | null {
    const raw = (this.currentUser?.profilepic || '').trim();
    return raw.length > 0 ? raw : null;
  }

  goToProfile() {
    this.router.navigate(['/profile-user']);
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