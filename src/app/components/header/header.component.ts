import { Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { IonHeader, IonToolbar, IonButton, IonIcon, IonTitle, IonAvatar, NavController } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { addIcons } from 'ionicons';
import { chevronBackOutline, personOutline, personCircleOutline } from 'ionicons/icons';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import type { AppUser } from '../../models/user.model';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
  standalone: true,
  imports: [IonToolbar, IonHeader, IonButton, IonIcon, IonTitle, IonAvatar, CommonModule]
})
export class HeaderComponent implements OnInit, OnDestroy {
  @Input() title: string = 'ATLAS';
  @Input() showBack: boolean = false;
  @Input() transparent: boolean = true;
  @Input() backHref?: string; // Optional: if provided, navigate to this route instead of using history
  @Input() currentUser: AppUser | null = null;

  private navCtrl = inject(NavController);
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private unsubscribeAuth?: () => void;
  private fallbackUser: AppUser | null = null;

  constructor(private router: Router) {
    addIcons({
      chevronBackOutline,
      personOutline,
      personCircleOutline
    });
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
    const first = (this.resolvedUser?.firstName || '').trim();
    const user = (this.resolvedUser?.username || '').trim();
    const source = first || user;
    return source ? source[0].toUpperCase() : '?';
  }

  get profileImageUrl(): string | null {
    const candidates = [
      this.resolvedUser?.profilepic,
      this.resolvedUser?.profileImage,
    ];

    for (const value of candidates) {
      const raw = (value || '').trim();
      if (raw.length > 0) return raw;
    }

    return null;
  }

  private async loadFallbackUser(uid: string): Promise<void> {
    try {
      const userRef = doc(this.firestore, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) return;

      const data = userSnap.data() as any;
      this.fallbackUser = {
        userId: uid,
        firstName: typeof data?.firstName === 'string' ? data.firstName : undefined,
        username: typeof data?.username === 'string' ? data.username : undefined,
        isPT: data?.isPT === true,
        profilepic: typeof data?.profilepic === 'string' ? data.profilepic : undefined,
        profileImage: typeof data?.profileImage === 'string' ? data.profileImage : undefined,
      };
    } catch (error) {
      console.error('Failed to load header fallback user:', error);
    }
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
