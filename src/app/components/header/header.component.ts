import { Component, EventEmitter, Input, Output, inject, OnInit, effect } from '@angular/core';
import { IonHeader, IonToolbar, IonButton, IonIcon, IonTitle, IonAvatar, NavController } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { addIcons } from 'ionicons';
import { chevronBackOutline, personOutline, personCircleOutline, settingsOutline } from 'ionicons/icons';
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
  @Input() hideTitle: boolean = false;
  @Input() showBack: boolean = false;
  @Input() transparent: boolean = true;
  @Input() neoBlend: boolean = true;
  @Input() backHref?: string; // Optional: if provided, navigate to this route instead of using history
  @Input() currentUser: AppUser | null = null;
  @Input() showProfileButtonWithBack: boolean = false;
  @Input() profileHref: string = '/profile-user';
  @Input() profileNavigationDirection: 'forward' | 'back' = 'forward';
  @Input() pinProfileButtonTopRight: boolean = false;
  @Input() showEndActionButton: boolean = false;
  @Input() endActionIconName: string = 'settings-outline';
  @Input() endActionAriaLabel: string = 'Header action';

  @Output() endAction = new EventEmitter<void>();

  private navCtrl = inject(NavController);
  private router = inject(Router);
  private userService = inject(UserService);
  private loadedUser: any = null;

  constructor() {
    addIcons({
      chevronBackOutline,
      personOutline,
      personCircleOutline,
      settingsOutline
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

  private blurActiveElement(): void {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  }

  goToProfile() {
    if (this.router.url.startsWith(this.profileHref)) {
      return;
    }

    this.blurActiveElement();
    if (this.profileNavigationDirection === 'back') {
      this.navCtrl.navigateBack(this.profileHref, {
        animated: true,
        animationDirection: 'back',
      });
      return;
    }

    this.navCtrl.navigateForward(this.profileHref, {
      animated: true,
      animationDirection: 'forward',
    });
  }

  goBack() {
    this.blurActiveElement();

    // If backHref is provided, use Ionic back navigation so transition reverses naturally.
    if (this.backHref) {
      this.navCtrl.navigateBack(this.backHref, {
        animated: true,
        animationDirection: 'back',
      });
    } else {
      // Otherwise use browser history
      this.navCtrl.back({ animated: false });
    }
  }

  onEndActionClick(): void {
    this.blurActiveElement();
    this.endAction.emit();
  }
}
