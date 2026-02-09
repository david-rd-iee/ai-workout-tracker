// src/app/pages/groups/groups.page.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { informationCircleOutline } from 'ionicons/icons';

import { GroupService } from '../../services/group.service';
import { Group } from '../../models/groups.model';
import { AppUser } from '../../models/user.model';

import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router';

import {
  LeaderboardService,
  LeaderboardEntry,
  Metric,
} from '../../services/leaderboard.service';

@Component({
  selector: 'app-groups',
  standalone: true,
  templateUrl: './groups.page.html',
  styleUrls: ['./groups.page.scss'],
  imports: [CommonModule, IonicModule, FormsModule],
})
export class GroupsPage implements OnInit, OnDestroy {
  appUser?: AppUser;
  groups: Group[] = [];
  loading = true;
  errorMessage: string | null = null;

  hasGroups = false;
  hasPT = false;

  // 🔹 Group leaderboard state
  selectedGroup: Group | null = null;
  groupMetricSort: Metric = 'total';
  groupEntries: LeaderboardEntry[] = [];
  groupLeaderboardLoading = false;
  groupLeaderboardError: string | null = null;

  private authUnsub?: () => void;
  private sub?: Subscription;

  constructor(
    private auth: Auth,
    private groupService: GroupService,
    private alertCtrl: AlertController,
    private router: Router,
    private leaderboardService: LeaderboardService
  ) {
    addIcons({ informationCircleOutline });
  }

  ngOnInit(): void {
    // Watch auth state and load user's groups
    this.authUnsub = onAuthStateChanged(this.auth, (user) => {
      this.sub?.unsubscribe();

      if (!user) {
        this.appUser = undefined;
        this.groups = [];
        this.hasGroups = false;
        this.hasPT = false;
        this.loading = false;
        return;
      }

      this.loading = true;
      this.errorMessage = null;

      this.sub = this.groupService.getUserGroups(user.uid).subscribe({
        next: ({ user: appUser, groups }) => {
          this.appUser = appUser;
          this.groups = groups;

          this.hasGroups = groups.some((g) => !g.isPTGroup);
          this.hasPT = groups.some((g) => g.isPTGroup);

          this.loading = false;
        },
        error: (err) => {
          console.error('[GroupsPage] Failed to load user groups', err);
          this.errorMessage = 'Could not load your groups.';
          this.loading = false;
        },
      });
    });
  }

  // 🔹 When a group is clicked - navigate to group chat
  openGroupChat(group: Group) {
    // TODO: Create dedicated group chat page
    // For now, navigate to workout-chatbot as placeholder
    // When group chat is implemented, use: this.router.navigate(['/group-chat', group.groupId]);
    console.log('Opening chat for group:', group.name);
    this.router.navigate(['/tabs/chats/workout-chatbot']);
  }

  // 🔹 When info icon is clicked - show group details
  viewGroupInfo(group: Group, event: Event) {
    // Prevent the item click from firing
    event.stopPropagation();
    
    // Show group details in right panel
    this.selectedGroup = group;
    this.groupMetricSort = 'total';
    this.loadGroupLeaderboard();
  }

  // 🔹 Legacy method - kept for compatibility
  async onGroupSelected(group: Group) {
    this.selectedGroup = group;
    this.groupMetricSort = 'total';
    await this.loadGroupLeaderboard();
  }

  // 🔹 Load leaderboard for currently selected group
  async loadGroupLeaderboard() {
    if (!this.selectedGroup) return;

    this.groupLeaderboardLoading = true;
    this.groupLeaderboardError = null;

    try {
      this.groupEntries = await this.leaderboardService.getGroupLeaderboard(
        this.selectedGroup.groupId,
        this.groupMetricSort
      );
    } catch (err) {
      console.error('[GroupsPage] Failed to load group leaderboard', err);
      this.groupLeaderboardError = 'Failed to load group leaderboard.';
      this.groupEntries = [];
    } finally {
      this.groupLeaderboardLoading = false;
    }
  }

  // 🔹 Called when user changes metric sort (ion-select with ngModel)
  async onGroupMetricSortChange() {
    await this.loadGroupLeaderboard();
  }

  // 🔹 Create group button handler (tweak to your routing/flow)
  async onCreateGroup() {
    const alert = await this.alertCtrl.create({
      header: 'Create Friends Group',
      inputs: [
        {
          name: 'name',
          type: 'text',
          placeholder: 'Group name',
        },
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Create',
          handler: async (data) => {
            const name = (data?.name || '').trim();
            if (!name || !this.appUser?.userId) return;

            try {
              await this.groupService.createGroupForOwner(
                this.appUser.userId,
                name,
                false // friends group, not PT group
              );
            } catch (err) {
              console.error('[GroupsPage] Failed to create group', err);
            }
          },
        },
      ],
    });

    await alert.present();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    if (this.authUnsub) {
      this.authUnsub();
    }
  }
}
