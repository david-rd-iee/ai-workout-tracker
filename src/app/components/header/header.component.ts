import { Component, Input, inject, OnInit, effect } from '@angular/core';
import { IonHeader, IonToolbar, IonButton, IonIcon, IonTitle, IonAvatar, NavController } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { addIcons } from 'ionicons';
import { chevronBackOutline, personOutline, personCircleOutline } from 'ionicons/icons';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
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

    // Load user data from service if not provided via Input
    effect(() => {
      if (!this.currentUser) {
        const userInfo = this.userService.getUserInfo()();
        if (userInfo) {
          // Map profileImage to profilepic for compatibility
          this.loadedUser = {
            ...userInfo,
            profilepic: (userInfo as any).profileImage || (userInfo as any).profilepic
          };
        }
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
          profilepic: (userInfo as any).profileImage || (userInfo as any).profilepic
        };
      }
    }
  }

  private get effectiveUser(): any {
    return this.currentUser || this.loadedUser;
  }

  ngOnInit(): void {
    this.unsubscribeAuth = onAuthStateChanged(this.auth, (fbUser) => {
      if (!fbUser) {
        this.fallbackUser = null;
        return;
      }

      void this.loadFallbackUser(fbUser.uid);
    });
  }

  ngOnDestroy(): void {
    this.unsubscribeAuth?.();
  }

  private get resolvedUser(): AppUser | null {
    return this.currentUser ?? this.fallbackUser;
  }

  get avatarInitial(): string {
    const user = this.effectiveUser;
    const first = (user?.firstName || '').trim();
    const username = (user?.username || '').trim();
    const source = first || username;
    return source ? source[0].toUpperCase() : '?';
  }

  get profileImageUrl(): string | null {
    const user = this.effectiveUser;
    // Support both property names for compatibility
    const raw = ((user as any)?.profileImage || (user as any)?.profilepic || '').trim();
    return raw.length > 0 ? raw : null;
  }

  goToProfile() {
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
