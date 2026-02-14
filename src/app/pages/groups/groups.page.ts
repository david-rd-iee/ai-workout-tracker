import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, NavController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { addIcons } from 'ionicons';
import { arrowBackOutline } from 'ionicons/icons';

import { Group } from '../../models/groups.model';
import { GroupService } from '../../services/group.service';
import { AccountService } from '../../services/account/account.service';

@Component({
  selector: 'app-groups',
  standalone: true,
  templateUrl: './groups.page.html',
  styleUrls: ['./groups.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class GroupsPage implements OnInit, OnDestroy {
  private navCtrl = inject(NavController);
  private groupService = inject(GroupService);
  private accountService = inject(AccountService);

  selectedTab: 'training' | 'friends' = 'friends';
  loading = true;
  errorMessage: string | null = null;
  friendGroups: Group[] = [];

  private groupsSub?: Subscription;
  private authSub?: Subscription;

  constructor() {
    addIcons({ arrowBackOutline });
  }

  ngOnInit(): void {
    const uid = this.accountService.getCredentials()().uid;
    if (uid) {
      this.subscribeToGroups(uid);
      return;
    }

    this.loading = false;
    this.authSub = this.accountService.authStateChanges$.subscribe(({ user, isAuthenticated }) => {
      if (!isAuthenticated || !user?.uid) return;
      this.subscribeToGroups(user.uid);
    });
  }

  selectTab(tab: 'training' | 'friends'): void {
    this.selectedTab = tab;
  }

  goBack(): void {
    this.navCtrl.navigateBack('/profile-user', {
      animated: true,
      animationDirection: 'back',
    });
  }

  private subscribeToGroups(uid: string): void {
    this.groupsSub?.unsubscribe();
    this.loading = true;
    this.errorMessage = null;

    this.groupsSub = this.groupService.getUserGroups(uid).subscribe({
      next: ({ groups }) => {
        this.friendGroups = groups.filter((group) => !group.isPTGroup);
        this.loading = false;
      },
      error: (err) => {
        console.error('[GroupsPage] Failed to load groups:', err);
        this.friendGroups = [];
        this.errorMessage = 'Could not load your groups.';
        this.loading = false;
      },
    });
  }

  ngOnDestroy(): void {
    this.groupsSub?.unsubscribe();
    this.authSub?.unsubscribe();
  }
}
