import { Component, Input, inject, OnInit, effect } from '@angular/core';
import { IonHeader, IonToolbar, IonButton, IonIcon, IonTitle, IonAvatar, NavController } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { addIcons } from 'ionicons';
import { chevronBackOutline, personOutline, personCircleOutline } from 'ionicons/icons';
import type { AppUser } from '../../models/user.model';
import { UserService } from '../../services/account/user.service';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
  standalone: true,
  imports: [IonToolbar, IonHeader, IonButton, IonIcon, IonTitle, IonAvatar, CommonModule]
})
export class HeaderComponent implements OnInit {
  @Input() title: string = 'ATLAS';
  @Input() showBack: boolean = false;
  @Input() transparent: boolean = true;
  @Input() backHref?: string; // Optional: if provided, navigate to this route instead of using history
  @Input() currentUser: AppUser | null = null;

  private navCtrl = inject(NavController);
  private userService = inject(UserService);
  private loadedUser: any = null;

  constructor(private router: Router) {
    addIcons({
      chevronBackOutline,
      personOutline,
      personCircleOutline
    });

    // Keep fallback user data in sync from UserService.
    effect(() => {
      const userInfo = this.userService.getUserInfo()();
      if (userInfo) {
        this.loadedUser = {
          ...userInfo,
          profilepic: (userInfo as any).profilepic
        };
      } else {
        this.loadedUser = null;
      }
    });
  }

  ngOnInit() {
    // Initial load if currentUser not provided
    if (!this.currentUser) {
      const userInfo = this.userService.getUserInfo()();
      if (userInfo) {
        this.loadedUser = {
          ...userInfo,
          profilepic: (userInfo as any).profilepic
        };
      }
    }
  }

  private get effectiveUser(): any {
    return this.currentUser || this.loadedUser;
  }

  get avatarInitial(): string {
    const user = this.effectiveUser;
    const first = (user?.firstName || '').trim();
    const username = (user?.username || '').trim();
    const source = first || username;
    return source ? source[0].toUpperCase() : '?';
  }

  get profilepicUrl(): string | null {
    const fromInput = ((this.currentUser as any)?.profilepic || '').trim();
    if (fromInput.length > 0) {
      return fromInput;
    }

    const fromLoadedUser = ((this.loadedUser as any)?.profilepic || '').trim();
    return fromLoadedUser.length > 0 ? fromLoadedUser : null;
  }

  goToProfile() {
    if (this.router.url.startsWith('/profile-user')) {
      return;
    }
    this.navCtrl.navigateForward('/profile-user', {
      animated: true,
      animationDirection: 'forward',
    });
  }

  goBack() {
    // If backHref is provided, use it instead of browser history
    if (this.backHref) {
      const useProfileAnimation = this.router.url.startsWith('/profile-user');
      this.navCtrl.navigateBack(this.backHref, useProfileAnimation
        ? {
            animated: true,
            animationDirection: 'back',
          }
        : { animated: false });
    } else {
      // Otherwise use browser history
      this.navCtrl.back({ animated: false });
    }
  }
}
