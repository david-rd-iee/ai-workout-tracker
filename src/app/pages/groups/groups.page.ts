import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, NavController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { addIcons } from 'ionicons';
import { arrowBackOutline, addOutline, closeOutline } from 'ionicons/icons';

import { Group } from '../../models/groups.model';
import { GroupService } from '../../services/group.service';
import { AccountService } from '../../services/account/account.service';

@Component({
  selector: 'app-groups',
  standalone: true,
  templateUrl: './groups.page.html',
  styleUrls: ['./groups.page.scss'],
  imports: [CommonModule, IonicModule, FormsModule],
})
export class GroupsPage implements OnInit, OnDestroy {
  private navCtrl = inject(NavController);
  private groupService = inject(GroupService);
  private accountService = inject(AccountService);

  selectedTab: 'training' | 'friends' = 'friends';
  loading = true;
  errorMessage: string | null = null;
  friendGroups: Group[] = [];

  searchModalOpen = false;
  searchQuery = '';
  allGroups: Group[] = [];
  allGroupsLoading = false;
  allGroupsError: string | null = null;
  userGroupIds = new Set<string>();

  private groupsSub?: Subscription;
  private authSub?: Subscription;

  constructor() {
    addIcons({ arrowBackOutline, addOutline, closeOutline });
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

  openGroup(group: Group): void {
    this.searchModalOpen = false;
    this.navCtrl.navigateForward(`/leaderboard/${group.groupId}`, {
      animated: true,
      animationDirection: 'forward',
    });
  }

  get filteredAllGroups(): Group[] {
    const q = this.searchQuery.trim().toLowerCase();
    const base = this.allGroups.filter(
      (group) => !group.isPTGroup && !this.userGroupIds.has(group.groupId)
    );

    if (!q) return base.slice(0, 30);
    return base.filter((group) => (group.name || '').toLowerCase().includes(q)).slice(0, 30);
  }

  async openGroupSearch(): Promise<void> {
    this.searchModalOpen = true;
    this.searchQuery = '';

    if (this.allGroups.length > 0 || this.allGroupsLoading) {
      return;
    }

    this.allGroupsLoading = true;
    this.allGroupsError = null;
    try {
      this.allGroups = await this.groupService.getAllGroupsOnce();
    } catch (err) {
      console.error('[GroupsPage] Failed to load all groups:', err);
      this.allGroupsError = 'Could not load groups for search.';
      this.allGroups = [];
    } finally {
      this.allGroupsLoading = false;
    }
  }

  closeGroupSearch(): void {
    this.searchModalOpen = false;
  }

  private subscribeToGroups(uid: string): void {
    this.groupsSub?.unsubscribe();
    this.loading = true;
    this.errorMessage = null;

    this.groupsSub = this.groupService.getUserGroups(uid).subscribe({
      next: ({ groups }) => {
        this.userGroupIds = new Set(groups.map((group) => group.groupId));
        this.friendGroups = groups.filter((group) => !group.isPTGroup);
        this.loading = false;
      },
      error: (err) => {
        console.error('[GroupsPage] Failed to load groups:', err);
        this.userGroupIds = new Set<string>();
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
